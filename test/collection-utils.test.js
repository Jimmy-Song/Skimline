"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Collections = require("../collection-utils.js");

function input(overrides = {}) {
  return {
    selectedText: "小团队的优势不是成本更低，而是方向错误时还能迅速转向。",
    videoId: "abcdefghijk",
    videoTitle: "如何建立高判断力团队",
    anchorT: 768,
    sourceType: "claim",
    pointText: "小团队的优势不是成本更低，而是方向错误时还能迅速转向。",
    sectionTitle: "从扩张冲动到组织约束",
    targetLanguage: "zh-CN",
    ...overrides,
  };
}

function clipping(overrides = {}) {
  return Collections.createClipping(input(overrides), {
    id: overrides.id || "clip-1",
    now: overrides.savedAt || 1000,
  });
}

function state(adds = [], removes = [], revision = 0) {
  return { schemaVersion: 2, revision, adds, removes };
}

test("收藏文本压缩连续空白并保留内容", () => {
  assert.equal(
    Collections.normalizeClippingText("  小团队\n 的\t优势  "),
    "小团队 的 优势",
  );
  assert.equal(
    clipping({ selectedText: "  小团队\n 的\t优势  " }).selectedText,
    "小团队 的 优势",
  );
});

test("收藏内容限制为 2–200 个 Unicode 字符", () => {
  assert.throws(() => clipping({ selectedText: "一" }), /2–200/);
  assert.equal(clipping({ selectedText: "两个" }).selectedText, "两个");
  assert.equal(
    clipping({ selectedText: "😀".repeat(200) }).selectedText,
    "😀".repeat(200),
  );
  assert.throws(() => clipping({ selectedText: "😀".repeat(201) }), /2–200/);
});

test("非法来源被拒绝，标题和来源字段安全归一化", () => {
  assert.throws(() => clipping({ videoId: "bad!" }), /来源视频无效/);
  const item = clipping({ videoTitle: "", anchorT: -2.8, sourceType: "unknown" });
  assert.equal(item.videoTitle, "YouTube 视频 abcdefghijk");
  assert.equal(item.anchorT, 0);
  assert.equal(item.sourceType, "claim");
});

test("schema v2 归一化按 ID 保留活跃 adds，并让 removes 单调去重", () => {
  const first = clipping({ id: "first", savedAt: 1000 });
  const sameContent = clipping({ id: "same-content", savedAt: 2000 });
  const normalized = Collections.normalizeReplicaState({
    schemaVersion: 99,
    revision: 4,
    adds: [first, sameContent, { ...first }, { id: "broken" }],
    removes: ["first", "first", "", null],
  });
  assert.equal(normalized.schemaVersion, 2);
  assert.equal(normalized.revision, 4);
  assert.deepEqual(normalized.adds.map((item) => item.id), ["same-content"]);
  assert.deepEqual(normalized.removes, ["first"]);
  assert.deepEqual(Collections.materializeLiveItems([normalized]), [sameContent]);
});

test("v1 items 会迁移为无墓碑的 v2 adds，且不截断超过 1000 条", () => {
  const items = Array.from({ length: 1205 }, (_, index) =>
    clipping({
      id: `legacy-${String(index).padStart(4, "0")}`,
      savedAt: index + 1,
      selectedText: `旧收藏 ${index}`,
      anchorT: index,
    }),
  );
  const migrated = Collections.normalizeReplicaState({
    schemaVersion: 1,
    revision: 9,
    items,
  });
  assert.equal(migrated.adds.length, 1205);
  assert.equal(migrated.removes.length, 0);
  assert.equal(Collections.listClippings([migrated]).length, 1205);
});

test("同视频、同时间和同文本在单副本保存时去重", () => {
  const first = clipping({ id: "first", savedAt: 1000 });
  const duplicate = Collections.addClipping(
    state([first]),
    clipping({
      id: "duplicate",
      savedAt: 2000,
      selectedText: `  ${first.selectedText.toUpperCase()}  `,
    }),
  );
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.item.id, "first");
  assert.equal(duplicate.store.adds.length, 1);

  const distinct = Collections.addClipping(
    state([first]),
    clipping({
      id: "distinct",
      savedAt: 2000,
      selectedText: "同一观点中的另一段摘录",
    }),
  );
  assert.equal(distinct.duplicate, false);
  assert.equal(Collections.listClippings([distinct.store]).length, 2);
});

test("多副本同内容不同 ID 在合并层保留，展示层才去重", () => {
  const a1 = clipping({ id: "A1", savedAt: 1000 });
  const b1 = clipping({ id: "B1", savedAt: 2000 });
  const live = Collections.materializeLiveItems([state([a1]), state([b1])]);
  assert.deepEqual(live.map((item) => item.id), ["B1", "A1"]);
  assert.deepEqual(Collections.buildClippingsView(live).map((item) => item.id), [
    "B1",
  ]);
});

test("删除展示项会墓碑化所有已观察到的同内容 ID，幽灵副本不会复活", () => {
  const a1 = clipping({ id: "A1", savedAt: 1000 });
  const b1 = clipping({ id: "B1", savedAt: 2000 });
  const stateA = state([a1]);
  const stateB = state([b1]);
  // 删除目标可以完全来自远端副本；本设备只需要写入观察到的墓碑。
  const removed = Collections.removeClipping(state(), "B1", [stateA, stateB]);
  assert.deepEqual(removed.deletedIds, ["A1", "B1"]);
  assert.deepEqual(removed.store.removes, ["A1", "B1"]);
  assert.equal(
    Collections.listClippings([stateA, stateB, removed.store]).length,
    0,
  );
});

test("未观察到的并发新增可以存活，已观察到的并发删除优先", () => {
  const shared = clipping({ id: "shared", savedAt: 1000 });
  const removed = Collections.removeClipping(state([shared]), "shared");
  const unseen = clipping({ id: "unseen", savedAt: 2000 });
  assert.equal(
    Collections.materializeLiveItems([removed.store, state([shared])]).length,
    0,
  );
  assert.deepEqual(
    Collections.listClippings([removed.store, state([unseen])]).map(
      (item) => item.id,
    ),
    ["unseen"],
  );
});

test("撤销删除生成新 ID，不会被旧墓碑杀死", () => {
  const original = clipping({ id: "original", savedAt: 1000 });
  const removed = Collections.removeClipping(state([original], [], 2), "original");
  const restored = Collections.restoreClipping(removed.store, original, {
    id: "restored",
  });
  assert.equal(restored.duplicate, false);
  assert.equal(restored.item.id, "restored");
  assert.equal(restored.item.savedAt, original.savedAt);
  assert.deepEqual(restored.store.removes, ["original"]);
  assert.deepEqual(Collections.listClippings([restored.store]).map((item) => item.id), [
    "restored",
  ]);
});

test("合并满足幂等、交换和结合，且同 ID 脏冲突结果确定", () => {
  const a = state([
    clipping({ id: "a", savedAt: 1000, selectedText: "来自 A 的内容" }),
  ]);
  const b = state([
    clipping({ id: "b", savedAt: 2000, selectedText: "来自 B 的内容" }),
  ]);
  const c = state([], ["a"]);
  const ab = Collections.mergeClippingStates([a, b]);
  assert.deepEqual(Collections.mergeClippingStates([a, a]), Collections.mergeClippingStates([a]));
  assert.deepEqual(ab, Collections.mergeClippingStates([b, a]));
  assert.deepEqual(
    Collections.mergeClippingStates([Collections.mergeClippingStates([a, b]), c]),
    Collections.mergeClippingStates([a, Collections.mergeClippingStates([b, c])]),
  );

  const collisionA = state([
    clipping({ id: "collision", savedAt: 1, selectedText: "冲突版本甲" }),
  ]);
  const collisionB = state([
    clipping({ id: "collision", savedAt: 2, selectedText: "冲突版本乙" }),
  ]);
  assert.deepEqual(
    Collections.mergeClippingStates([collisionA, collisionB]),
    Collections.mergeClippingStates([collisionB, collisionA]),
  );
});

test("搜索覆盖全部数据而不受 1000 条渲染上限影响", () => {
  const items = Array.from({ length: 1100 }, (_, index) =>
    clipping({
      id: `search-${index}`,
      savedAt: index + 1,
      selectedText: index === 1 ? "唯一的深层命中" : `普通收藏 ${index}`,
      anchorT: index,
    }),
  );
  assert.equal(Collections.searchClippings(items, "").length, 1100);
  assert.deepEqual(
    Collections.searchClippings(items, "深层命中").map((item) => item.id),
    ["search-1"],
  );
});

test("完整备份包含墓碑，重复导入幂等且不会复活已删除内容", () => {
  const original = clipping({ id: "deleted", savedAt: 1000 });
  const removed = Collections.removeClipping(state([original]), original.id);
  const active = clipping({
    id: "active",
    savedAt: 2000,
    selectedText: "仍然保留的收藏",
  });
  const source = Collections.normalizeReplicaState({
    ...removed.store,
    adds: [...removed.store.adds, active],
  });
  const backup = Collections.createClippingsBackup(source, { now: 3000 });
  assert.deepEqual(backup.removes, ["deleted"]);
  assert.equal(backup.adds.some((item) => item.id === "deleted"), false);
  assert.equal(backup.revision, undefined);

  const firstImport = Collections.importClippingsBackup(state(), backup);
  assert.equal(firstImport.changed, true);
  assert.deepEqual(Collections.listClippings([firstImport.store]).map((item) => item.id), [
    "active",
  ]);
  const secondImport = Collections.importClippingsBackup(firstImport.store, backup);
  assert.equal(secondImport.changed, false);
  assert.equal(secondImport.store.revision, firstImport.store.revision);
  assert.deepEqual(secondImport.store.removes, ["deleted"]);
});

test("无效备份被拒绝，落盘与导出只包含 JSON 数组", () => {
  assert.throws(
    () => Collections.normalizeClippingsBackup({ schemaVersion: 2 }),
    /有效的 Skimline 收藏备份/,
  );
  const item = clipping({ id: "json", savedAt: 1000 });
  const backup = Collections.createClippingsBackup(state([item]));
  assert.equal(Array.isArray(backup.adds), true);
  assert.equal(Array.isArray(backup.removes), true);
  assert.equal(JSON.parse(JSON.stringify(backup)).adds[0].id, "json");
  assert.throws(
    () =>
      Collections.normalizeClippingsBackup({
        ...backup,
        adds: [...backup.adds, { id: "broken" }],
      }),
    /损坏或重复/,
  );
  assert.throws(
    () =>
      Collections.normalizeClippingsBackup({
        ...backup,
        removes: ["removed", "removed"],
      }),
    /损坏或重复/,
  );
});

test("未知 tombstone 在任意合并顺序中都不会被清理", () => {
  const add = clipping({ id: "late-add", savedAt: 1000 });
  const tombstoneOnly = state([], ["late-add", "unknown-id"]);
  const addOnly = state([add]);
  for (const states of [
    [tombstoneOnly, addOnly],
    [addOnly, tombstoneOnly],
    [tombstoneOnly, addOnly, tombstoneOnly],
  ]) {
    const merged = Collections.mergeClippingStates(states);
    assert.deepEqual(merged.removes, ["late-add", "unknown-id"]);
    assert.equal(Collections.materializeLiveItems([merged]).length, 0);
  }
});

test("收藏按 videoId 分组，组间和组内都按最近收藏排序", () => {
  const items = [
    clipping({
      id: "video-a-old",
      savedAt: 1000,
      videoId: "abcdefghijk",
      videoTitle: "视频 A 的旧标题",
      selectedText: "视频 A 的第一条收藏",
    }),
    clipping({
      id: "video-b",
      savedAt: 2000,
      videoId: "zyxwvutsrqp",
      videoTitle: "视频 B",
      selectedText: "视频 B 的收藏",
    }),
    clipping({
      id: "video-a-new",
      savedAt: 3000,
      videoId: "abcdefghijk",
      videoTitle: "视频 A 的新标题",
      selectedText: "视频 A 的第二条收藏",
    }),
  ];

  const groups = Collections.groupClippingsByVideo(items, "");
  assert.deepEqual(groups.map((group) => group.videoId), [
    "abcdefghijk",
    "zyxwvutsrqp",
  ]);
  assert.equal(groups[0].videoTitle, "视频 A 的新标题");
  assert.equal(groups[0].latestSavedAt, 3000);
  assert.equal(groups[0].totalCount, 2);
  assert.equal(groups[0].visibleCount, 2);
  assert.deepEqual(groups[0].items.map((item) => item.id), [
    "video-a-new",
    "video-a-old",
  ]);
});

test("搜索任一历史视频标题时返回该视频的全部收藏", () => {
  const items = [
    clipping({
      id: "old-title",
      savedAt: 1000,
      videoTitle: "Anthropic Context Rules",
      selectedText: "第一条收藏",
    }),
    clipping({
      id: "new-title",
      savedAt: 2000,
      videoTitle: "Claude Code Context Rules",
      selectedText: "第二条收藏",
    }),
  ];

  const groups = Collections.groupClippingsByVideo(
    items,
    "  ANTHROPIC   CONTEXT ",
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].titleMatched, true);
  assert.equal(groups[0].videoTitle, "Claude Code Context Rules");
  assert.equal(groups[0].visibleCount, 2);
  assert.deepEqual(groups[0].items.map((item) => item.id), [
    "new-title",
    "old-title",
  ]);
});

test("搜索收藏内容时保留视频父级并只返回命中的子项", () => {
  const items = [
    clipping({
      id: "json",
      savedAt: 3000,
      selectedText: "可以用代码检查输出是否为 JSON",
      pointText: "自动化评估器适合结构检查",
    }),
    clipping({
      id: "handoff",
      savedAt: 2000,
      selectedText: "交接失败需要 LLM 评判",
      sectionTitle: "复杂失败模式",
    }),
    clipping({
      id: "other-video",
      savedAt: 1000,
      videoId: "zyxwvutsrqp",
      videoTitle: "另一个视频",
      selectedText: "没有命中的收藏",
    }),
  ];

  const groups = Collections.groupClippingsByVideo(items, "  复杂失败   ");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].videoId, "abcdefghijk");
  assert.equal(groups[0].titleMatched, false);
  assert.equal(groups[0].totalCount, 2);
  assert.equal(groups[0].visibleCount, 1);
  assert.equal(groups[0].items[0].id, "handoff");
});

test("视频分组不会修改调用方传入的收藏数组", () => {
  const items = [
    clipping({ id: "older", savedAt: 1000, selectedText: "较早收藏" }),
    clipping({ id: "newer", savedAt: 2000, selectedText: "较新收藏" }),
  ];
  const snapshot = items.map((item) => ({ ...item }));
  Collections.groupClippingsByVideo(items, "收藏");
  assert.deepEqual(items, snapshot);
});
