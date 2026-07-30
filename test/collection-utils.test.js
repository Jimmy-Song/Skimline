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
  assert.throws(
    () => clipping({ selectedText: "一" }),
    /2–200/,
  );
  assert.equal(clipping({ selectedText: "两个" }).selectedText, "两个");
  assert.equal(
    clipping({ selectedText: "😀".repeat(200) }).selectedText,
    "😀".repeat(200),
  );
  assert.throws(
    () => clipping({ selectedText: "😀".repeat(201) }),
    /2–200/,
  );
});

test("非法来源被拒绝，标题和来源字段安全归一化", () => {
  assert.throws(
    () => clipping({ videoId: "bad!" }),
    /来源视频无效/,
  );
  const item = clipping({
    videoTitle: "",
    anchorT: -2.8,
    sourceType: "unknown",
  });
  assert.equal(item.videoTitle, "YouTube 视频 abcdefghijk");
  assert.equal(item.anchorT, 0);
  assert.equal(item.sourceType, "claim");
});

test("存储归一化按时间倒序并过滤重复和非法数据", () => {
  const first = clipping({ id: "first", savedAt: 1000 });
  const newer = clipping({
    id: "newer",
    savedAt: 2000,
    selectedText: "另一个值得保存的观点",
  });
  const duplicate = { ...first, id: "duplicate", savedAt: 3000 };
  const store = Collections.normalizeClippingsStore({
    schemaVersion: 99,
    revision: 4,
    items: [first, newer, duplicate, { id: "broken" }],
  });
  assert.equal(store.schemaVersion, 1);
  assert.equal(store.revision, 4);
  assert.deepEqual(store.items.map((item) => item.id), ["newer", "first"]);
});

test("同视频、同时间和同文本去重，文本不同可分别收藏", () => {
  const first = clipping({ id: "first", savedAt: 1000 });
  const initial = { schemaVersion: 1, revision: 0, items: [first] };
  const duplicate = Collections.addClipping(
    initial,
    clipping({
      id: "duplicate",
      savedAt: 2000,
      selectedText: `  ${first.selectedText.toUpperCase()}  `,
    }),
  );
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.store.items.length, 1);

  const distinct = Collections.addClipping(
    initial,
    clipping({
      id: "distinct",
      savedAt: 2000,
      selectedText: "同一观点中的另一段摘录",
    }),
  );
  assert.equal(distinct.duplicate, false);
  assert.equal(distinct.store.items.length, 2);
});

test("概览 anchorT 为 null 并参与去重", () => {
  const overview = clipping({
    id: "overview",
    savedAt: 1000,
    anchorT: null,
    sourceType: "overview",
    selectedText: "这期视频讨论组织判断力",
  });
  assert.equal(overview.anchorT, null);
  const malformedOverview = clipping({
    id: "overview-with-time",
    savedAt: 900,
    anchorT: 123,
    sourceType: "overview",
    selectedText: "概览不能伪造时间戳",
  });
  assert.equal(malformedOverview.anchorT, null);
  const result = Collections.addClipping(
    { schemaVersion: 1, items: [overview] },
    { ...overview, id: "overview-2", savedAt: 2000 },
  );
  assert.equal(result.duplicate, true);
});

test("容量到达上限时不自动覆盖旧收藏", () => {
  const first = clipping({ id: "first", savedAt: 1000 });
  const second = clipping({
    id: "second",
    savedAt: 2000,
    selectedText: "第二条收藏",
  });
  const third = clipping({
    id: "third",
    savedAt: 3000,
    selectedText: "第三条收藏",
  });
  const result = Collections.addClipping(
    { schemaVersion: 1, items: [first, second] },
    third,
    2,
  );
  assert.equal(result.limitReached, true);
  assert.deepEqual(result.store.items.map((item) => item.id), ["second", "first"]);
});

test("删除与恢复保留原始收藏快照", () => {
  const item = clipping({ id: "kept", savedAt: 1000 });
  const removed = Collections.removeClipping(
    { schemaVersion: 1, revision: 2, items: [item] },
    item.id,
  );
  assert.deepEqual(removed.deletedItem, item);
  assert.equal(removed.store.items.length, 0);
  assert.equal(removed.store.revision, 3);

  const restored = Collections.restoreClipping(removed.store, item);
  assert.equal(restored.duplicate, false);
  assert.deepEqual(restored.item, item);
  assert.equal(restored.store.items.length, 1);
});

test("搜索覆盖摘录、标题、所属观点和分区，忽略大小写与空白", () => {
  const items = [
    clipping({ id: "team", savedAt: 1000 }),
    clipping({
      id: "strategy",
      savedAt: 2000,
      selectedText: "Strategy is choosing what not to do.",
      videoTitle: "Founder Focus",
      pointText: "Attention is the real constraint",
      sectionTitle: "Decision quality",
    }),
  ];
  assert.deepEqual(
    Collections.searchClippings(items, "  founder   focus ").map(
      (item) => item.id,
    ),
    ["strategy"],
  );
  assert.deepEqual(
    Collections.searchClippings(items, "DECISION").map((item) => item.id),
    ["strategy"],
  );
  assert.deepEqual(
    Collections.searchClippings(items, "所属观点").map((item) => item.id),
    [],
  );
  assert.equal(Collections.searchClippings(items, "").length, 2);
});
