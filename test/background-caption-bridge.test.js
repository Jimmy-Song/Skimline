"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const YouTubeSummary = require("../generation-utils.js");
const SkimlineCollections = require("../collection-utils.js");

function createStorage(initial = {}) {
  const data = { ...initial };
  return {
    async get(keys) {
      if (keys == null) return { ...data };
      if (typeof keys === "string") return { [keys]: data[keys] };
      if (Array.isArray(keys)) {
        return Object.fromEntries(
          keys.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]),
        );
      }
      return {};
    },
    async set(values) {
      Object.assign(data, values);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  };
}

function createHarness(executeScript, summaryOverrides = {}, options = {}) {
  let messageListener;
  const injections = [];
  const tabsById = new Map();
  const storage = options.storage || createStorage();
  const chrome = {
    sidePanel: {
      setPanelBehavior: async () => {},
    },
    scripting: {
      async executeScript(injection) {
        injections.push(injection);
        return executeScript(injection);
      },
    },
    storage: { local: storage },
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
      async sendMessage() {},
    },
    tabs: {
      async get(tabId) {
        if (options.getTab) return options.getTab(tabId);
        const tab = tabsById.get(tabId);
        if (!tab) throw new Error("No tab");
        return tab;
      },
      onRemoved: {
        addListener() {},
      },
    },
  };
  const context = vm.createContext({
    AbortController,
    Date,
    Error,
    Map,
    Promise,
    Set,
    String,
    Number,
    Object,
    Array,
    Math,
    URL,
    console,
    setTimeout,
    clearTimeout,
    chrome,
    YouTubeSummary: summaryOverrides,
    SkimlineCollections,
    importScripts() {},
  });
  const source = fs.readFileSync(
    path.join(__dirname, "..", "background.js"),
    "utf8",
  );
  vm.runInContext(source, context, { filename: "background.js" });

  function invoke(message, sender) {
    if (Number.isInteger(sender?.tab?.id)) {
      tabsById.set(sender.tab.id, { ...sender.tab });
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`消息未响应：${message.type}`)),
        1000,
      );
      const keepOpen = messageListener(message, sender, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
      if (keepOpen !== true) {
        clearTimeout(timeout);
        reject(new Error(`消息未异步处理：${message.type}`));
      }
    });
  }

  return { injections, invoke, storage };
}

test("收藏后台支持保存、去重、列出、删除和撤销", async () => {
  const harness = createHarness(async () => []);
  const payload = {
    selectedText: "小团队的优势是方向错误时还能迅速转向。",
    videoId: "abcdefghijk",
    videoTitle: "如何建立高判断力团队",
    anchorT: 768,
    sourceType: "claim",
    pointText: "小团队的优势不是成本更低",
    sectionTitle: "从扩张冲动到组织约束",
    targetLanguage: "zh-CN",
  };

  const saved = await harness.invoke({ type: "SAVE_CLIPPING", payload });
  assert.equal(saved.ok, true);
  assert.equal(saved.duplicate, false);
  assert.equal(saved.count, 1);

  const duplicate = await harness.invoke({ type: "SAVE_CLIPPING", payload });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.count, 1);

  const listed = await harness.invoke({ type: "LIST_CLIPPINGS" });
  assert.equal(listed.ok, true);
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].selectedText, payload.selectedText);

  const removed = await harness.invoke({
    type: "DELETE_CLIPPING",
    id: saved.item.id,
  });
  assert.equal(removed.ok, true);
  assert.equal(removed.deletedItem.id, saved.item.id);
  assert.equal(removed.count, 0);

  const restored = await harness.invoke({
    type: "RESTORE_CLIPPING",
    item: removed.deletedItem,
  });
  assert.equal(restored.ok, true);
  assert.equal(restored.duplicate, false);
  assert.notEqual(restored.item.id, saved.item.id);
  assert.equal(restored.count, 1);
});

test("收藏后台迁移 v1，并完整导出导入 adds 与 removes", async () => {
  const legacyItem = {
    id: "legacy-item",
    selectedText: "迁移后仍然存在的收藏",
    videoId: "abcdefghijk",
    videoTitle: "迁移测试",
    anchorT: 12,
    sourceType: "claim",
    pointText: "迁移测试观点",
    sectionTitle: "迁移",
    targetLanguage: "zh-CN",
    savedAt: 1000,
  };
  const storage = createStorage({
    [SkimlineCollections.LEGACY_CLIPPINGS_STORAGE_KEY]: {
      schemaVersion: 1,
      revision: 3,
      items: [legacyItem],
    },
  });
  const harness = createHarness(async () => [], {}, { storage });
  const listed = await harness.invoke({ type: "LIST_CLIPPINGS" });
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.items.map((item) => item.id), ["legacy-item"]);

  const removed = await harness.invoke({
    type: "DELETE_CLIPPING",
    id: "legacy-item",
  });
  assert.equal(removed.ok, true);
  const exported = await harness.invoke({ type: "EXPORT_CLIPPINGS_BACKUP" });
  assert.equal(exported.ok, true);
  assert.deepEqual(exported.backup.removes, ["legacy-item"]);
  assert.equal(exported.backup.revision, undefined);

  const target = createHarness(async () => []);
  const imported = await target.invoke({
    type: "IMPORT_CLIPPINGS_BACKUP",
    backup: exported.backup,
  });
  assert.equal(imported.ok, true);
  assert.equal(imported.changed, true);
  assert.equal(imported.count, 0);
  const importedAgain = await target.invoke({
    type: "IMPORT_CLIPPINGS_BACKUP",
    backup: exported.backup,
  });
  assert.equal(importedAgain.ok, true);
  assert.equal(importedAgain.changed, false);
});

test("v1 迁移写入失败时不删除旧数据，下一次读取仍可恢复", async () => {
  const legacyKey = SkimlineCollections.LEGACY_CLIPPINGS_STORAGE_KEY;
  const data = {
    [legacyKey]: {
      schemaVersion: 1,
      revision: 2,
      items: [
        {
          id: "migration-survivor",
          selectedText: "迁移失败后仍然保留",
          videoId: "abcdefghijk",
          videoTitle: "迁移故障测试",
          anchorT: 5,
          sourceType: "claim",
          pointText: "",
          sectionTitle: "",
          targetLanguage: "zh-CN",
          savedAt: 1000,
        },
      ],
    },
  };
  let failNextSet = true;
  const storage = {
    async get(keys) {
      return Object.fromEntries(
        keys.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]),
      );
    },
    async set(values) {
      if (failNextSet) {
        failNextSet = false;
        throw new Error("migration write failed");
      }
      Object.assign(data, values);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  };
  const harness = createHarness(async () => [], {}, { storage });
  const failed = await harness.invoke({ type: "LIST_CLIPPINGS" });
  assert.equal(failed.ok, false);
  assert.equal(data[legacyKey].items[0].id, "migration-survivor");

  const recovered = await harness.invoke({ type: "LIST_CLIPPINGS" });
  assert.equal(recovered.ok, true);
  assert.deepEqual(recovered.items.map((item) => item.id), [
    "migration-survivor",
  ]);
  assert.equal(data[legacyKey], undefined);
});

test("并发收藏通过后台写队列串行化，不丢失数据", async () => {
  const harness = createHarness(async () => []);
  const requests = Array.from({ length: 20 }, (_, index) =>
    harness.invoke({
      type: "SAVE_CLIPPING",
      payload: {
        selectedText: `第 ${index + 1} 条并发收藏内容`,
        videoId: "abcdefghijk",
        videoTitle: "并发测试视频",
        anchorT: index,
        sourceType: "claim",
        pointText: `观点 ${index + 1}`,
        sectionTitle: "并发测试",
        targetLanguage: "zh-CN",
      },
    }),
  );
  const responses = await Promise.all(requests);
  assert.equal(responses.every((response) => response.ok), true);
  const listed = await harness.invoke({ type: "LIST_CLIPPINGS" });
  assert.equal(listed.items.length, 20);
  assert.equal(new Set(listed.items.map((item) => item.id)).size, 20);
});

test("后台再次校验收藏输入，不接受过短文字或非法视频来源", async () => {
  const harness = createHarness(async () => []);
  const tooShort = await harness.invoke({
    type: "SAVE_CLIPPING",
    payload: { selectedText: "一", videoId: "abcdefghijk" },
  });
  assert.equal(tooShort.ok, false);
  assert.match(tooShort.error, /2–200/);

  const invalidVideo = await harness.invoke({
    type: "SAVE_CLIPPING",
    payload: { selectedText: "有效文本", videoId: "<script>" },
  });
  assert.equal(invalidVideo.ok, false);
  assert.match(invalidVideo.error, /来源视频无效/);
});

test("收藏写入失败后队列可以恢复，后续保存不会被旧错误阻塞", async () => {
  const data = {};
  let failNextSet = true;
  const storage = {
    async get(keys) {
      if (keys == null) return { ...data };
      if (typeof keys === "string") return { [keys]: data[keys] };
      return Object.fromEntries(
        keys.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]),
      );
    },
    async set(values) {
      if (failNextSet) {
        failNextSet = false;
        throw new Error("disk unavailable");
      }
      Object.assign(data, values);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  };
  const harness = createHarness(async () => [], {}, { storage });
  const payload = {
    selectedText: "第一次写入会失败",
    videoId: "abcdefghijk",
    videoTitle: "恢复测试",
    anchorT: 1,
    sourceType: "claim",
  };
  const failed = await harness.invoke({ type: "SAVE_CLIPPING", payload });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /disk unavailable/);

  const saved = await harness.invoke({
    type: "SAVE_CLIPPING",
    payload: { ...payload, selectedText: "第二次写入应该成功" },
  });
  assert.equal(saved.ok, true);
  const listed = await harness.invoke({ type: "LIST_CLIPPINGS" });
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].selectedText, "第二次写入应该成功");
});

test("同一侧栏的新解释请求会取消旧请求，显式关闭也能中止进行中请求", async () => {
  let callCount = 0;
  let abortCount = 0;
  const pending = [];
  const harness = createHarness(async () => [], {
    explainVideoSelection(_input, options) {
      callCount += 1;
      return new Promise((resolve, reject) => {
        const record = { resolve, reject };
        pending.push(record);
        options.signal.addEventListener(
          "abort",
          () => {
            abortCount += 1;
            const error = new Error("解释已取消");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      });
    },
  });
  const waitForCalls = async (expected) => {
    for (let attempt = 0; attempt < 50 && callCount < expected; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.equal(callCount, expected);
  };
  const first = harness.invoke({
    type: "EXPLAIN_VIDEO_SELECTION",
    payload: { clientId: "panel-1", videoId: "video-1" },
  });
  await waitForCalls(1);
  const second = harness.invoke({
    type: "EXPLAIN_VIDEO_SELECTION",
    payload: { clientId: "panel-1", videoId: "video-1" },
  });
  await waitForCalls(2);
  assert.equal(abortCount, 1);
  pending[1].resolve({ simple: "解释", inVideo: "语境" });
  assert.equal((await second).ok, true);
  assert.equal((await first).cancelled, true);

  const third = harness.invoke({
    type: "EXPLAIN_VIDEO_SELECTION",
    payload: { clientId: "panel-1", videoId: "video-1" },
  });
  await waitForCalls(3);
  const cancelled = await harness.invoke({
    type: "CANCEL_CONTEXT_EXPLANATION",
    clientId: "panel-1",
  });
  assert.equal(cancelled.ok, true);
  assert.equal((await third).cancelled, true);
  assert.equal(abortCount, 2);
});

function explanationPayload(overrides = {}) {
  return {
    clientId: "panel-task-test",
    videoId: "video-task-1",
    targetLanguage: "zh-CN",
    sourceLang: "en",
    selectedText: "通用函数逼近器",
    anchorT: 690,
    anchorContext: "AlexNet 证明了深度学习是通用函数逼近器。",
    videoOutline: "[690] AlexNet 的真正突破",
    videoTitle: "Fixture",
    sourceType: "claim",
    pointText: "AlexNet 的真正突破",
    sectionTitle: "深度学习",
    segments: [
      { tMs: 680000, text: "AlexNet showed a surprising breakthrough." },
      { tMs: 690000, text: "Deep learning is a universal function approximator." },
    ],
    ...overrides,
  };
}

async function waitForExplanationTask(harness, taskId, expectedStatus) {
  let task = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await harness.invoke({
      type: "GET_CONTEXT_EXPLANATION_TASK",
      taskId,
    });
    task = response.task;
    if (task?.status === expectedStatus) return task;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(task?.status, expectedStatus);
  return task;
}

test("任务化解释在抽屉收起后继续执行，并可按视频恢复结果", async () => {
  let resolveExplanation;
  let abortCount = 0;
  const harness = createHarness(async () => [], {
    ...YouTubeSummary,
    requestContextExplanation(_input, _context, options) {
      return new Promise((resolve, reject) => {
        resolveExplanation = resolve;
        options.signal.addEventListener(
          "abort",
          () => {
            abortCount += 1;
            reject(new Error("解释已取消"));
          },
          { once: true },
        );
      });
    },
  });

  const started = await harness.invoke({
    type: "START_CONTEXT_EXPLANATION",
    payload: explanationPayload(),
  });
  assert.equal(started.ok, true);
  assert.match(started.task.status, /running|queued/);

  const dismissed = await harness.invoke({
    type: "DISMISS_CONTEXT_EXPLANATION",
    taskId: started.task.taskId,
  });
  assert.equal(dismissed.ok, true);
  assert.equal(abortCount, 0);

  resolveExplanation({
    simple: "可逼近复杂输入输出映射的模型。",
    inVideo: "黄仁勋据此判断深度学习会改变计算方式。",
    answer: "",
    evidence: [{ t: 690, label: "11:30" }],
    suggestedQuestions: ["为什么重要？"],
    uncertain: false,
    notice: "",
  });
  const completed = await waitForExplanationTask(
    harness,
    started.task.taskId,
    "complete",
  );
  assert.equal(completed.dismissed, true);
  assert.equal(completed.result.simple, "可逼近复杂输入输出映射的模型。");
  assert.equal(abortCount, 0);

  const restored = await harness.invoke({
    type: "START_CONTEXT_EXPLANATION",
    payload: explanationPayload(),
  });
  assert.equal(restored.task.taskId, started.task.taskId);
  assert.equal(restored.task.dismissed, false);
  assert.equal(restored.task.status, "complete");
});

test("无字幕时仍返回通用解释，但移除伪造的视频语境和时间依据", async () => {
  const harness = createHarness(async () => [], {
    ...YouTubeSummary,
    async requestContextExplanation() {
      return {
        simple: "一个通用定义。",
        inVideo: "模型猜测的视频观点。",
        answer: "",
        evidence: [{ t: 12, label: "0:12" }],
        suggestedQuestions: [],
        uncertain: false,
        notice: "",
      };
    },
  });
  const started = await harness.invoke({
    type: "START_CONTEXT_EXPLANATION",
    payload: explanationPayload({ segments: [] }),
  });
  const completed = await waitForExplanationTask(
    harness,
    started.task.taskId,
    "complete",
  );
  assert.equal(completed.noTranscript, true);
  assert.equal(completed.result.simple, "一个通用定义。");
  assert.equal(completed.result.inVideo, "");
  assert.equal(completed.result.evidence.length, 0);
  assert.equal(completed.result.uncertain, true);
  assert.match(completed.result.notice, /未能读取完整字幕/);
});

test("Service Worker 重启后恢复未完成解释任务，不依赖原标签页继续打开", async () => {
  const storage = createStorage();
  let firstCallCount = 0;
  const firstHarness = createHarness(
    async () => [],
    {
      ...YouTubeSummary,
      requestContextExplanation() {
        firstCallCount += 1;
        return new Promise(() => {});
      },
    },
    { storage },
  );
  const started = await firstHarness.invoke({
    type: "START_CONTEXT_EXPLANATION",
    payload: explanationPayload({ clientId: "restart-panel" }),
  });
  for (
    let attempt = 0;
    attempt < 50 && firstCallCount < 1;
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(firstCallCount, 1);

  let recoveredCallCount = 0;
  const recoveredHarness = createHarness(
    async () => [],
    {
      ...YouTubeSummary,
      async requestContextExplanation() {
        recoveredCallCount += 1;
        return {
          simple: "恢复后的解释",
          inVideo: "恢复后的语境",
          answer: "",
          evidence: [],
          suggestedQuestions: [],
          uncertain: false,
          notice: "",
        };
      },
    },
    { storage },
  );
  const completed = await waitForExplanationTask(
    recoveredHarness,
    started.task.taskId,
    "complete",
  );
  assert.equal(recoveredCallCount, 1);
  assert.equal(completed.result.simple, "恢复后的解释");
});

test("任务化追问严格限制为三轮，并保留完整问答历史", async () => {
  const harness = createHarness(async () => [], {
    ...YouTubeSummary,
    async requestContextExplanation(_input, context) {
      if (!context.question) {
        return {
          simple: "首轮定义",
          inVideo: "首轮语境",
          answer: "",
          evidence: [],
          suggestedQuestions: ["第一问"],
          uncertain: false,
          notice: "",
        };
      }
      return {
        simple: "",
        inVideo: "",
        answer: `回答：${context.question}`,
        evidence: [],
        suggestedQuestions: [],
        uncertain: false,
        notice: "",
      };
    },
  });
  const started = await harness.invoke({
    type: "START_CONTEXT_EXPLANATION",
    payload: explanationPayload({ clientId: "turn-limit-panel" }),
  });
  let task = await waitForExplanationTask(
    harness,
    started.task.taskId,
    "complete",
  );
  for (let turn = 0; turn < 3; turn += 1) {
    const asked = await harness.invoke({
      type: "ASK_CONTEXT_EXPLANATION",
      payload: {
        taskId: task.taskId,
        question: `第 ${turn + 1} 个追问`,
        expectedTurn: turn,
      },
    });
    assert.equal(asked.ok, true);
    task = await waitForExplanationTask(harness, task.taskId, "complete");
    assert.equal(task.turns, turn + 1);
  }
  assert.equal(task.history.length, 7);
  assert.equal(task.history[6].content, "回答：第 3 个追问");

  const rejected = await harness.invoke({
    type: "ASK_CONTEXT_EXPLANATION",
    payload: {
      taskId: task.taskId,
      question: "第四个追问",
      expectedTurn: 3,
    },
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /3 轮/);
});

test("取消任务后即使模型忽略 Abort 并迟到，也不能把状态反转成完成", async () => {
  let resolveLateResult;
  let callCount = 0;
  const harness = createHarness(async () => [], {
    ...YouTubeSummary,
    requestContextExplanation() {
      callCount += 1;
      return new Promise((resolve) => {
        resolveLateResult = resolve;
      });
    },
  });
  const started = await harness.invoke({
    type: "START_CONTEXT_EXPLANATION",
    payload: explanationPayload({ clientId: "late-result-panel" }),
  });
  for (let attempt = 0; attempt < 50 && callCount < 1; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const cancelled = await harness.invoke({
    type: "CANCEL_CONTEXT_EXPLANATION",
    taskId: started.task.taskId,
    reason: "language_changed",
  });
  assert.equal(cancelled.ok, true);

  resolveLateResult({
    simple: "不应落地的迟到结果",
    inVideo: "不应落地的迟到语境",
    answer: "",
    evidence: [],
    suggestedQuestions: [],
    uncertain: false,
    notice: "",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const response = await harness.invoke({
    type: "GET_CONTEXT_EXPLANATION_TASK",
    taskId: started.task.taskId,
  });
  assert.equal(response.task.status, "cancelled");
  assert.equal(response.task.result, null);
});

function sender(videoId = "video-1") {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  return {
    frameId: 0,
    url,
    tab: { id: 7, url },
  };
}

function request(videoId = "video-1") {
  return {
    source: "youtube-viewpoint-map",
    type: "READ_PLAYER_CAPTION_TRACKS",
    videoId,
  };
}

test("字幕轨道只通过 MAIN world 注入读取并绑定发送标签页", async () => {
  const harness = createHarness(async () => [
    {
      frameId: 0,
      result: {
        status: "ok",
        videoId: "video-1",
        matchedVideo: true,
        rawTrackCount: 1,
        tracks: [
          {
            baseUrl: "https://www.youtube.com/api/timedtext?lang=en",
            languageCode: "en",
            kind: "",
            name: { simpleText: "English" },
            vssId: ".en",
          },
        ],
        sourceLang: "en",
      },
    },
  ]);

  const response = await harness.invoke(request(), sender());
  assert.equal(response.ok, true);
  assert.equal(response.videoId, "video-1");
  assert.equal(response.tracks.length, 1);
  assert.equal(harness.injections.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.injections[0].target)),
    { tabId: 7, frameIds: [0] },
  );
  assert.equal(harness.injections[0].world, "MAIN");
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.injections[0].args)),
    ["video-1"],
  );
  assert.equal(typeof harness.injections[0].func, "function");
});

test("YouTube SPA 从旧视频或首页切换后，以当前标签和播放器为准", async () => {
  const harness = createHarness(async (injection) => {
    const playerResponse = {
      videoDetails: {
        videoId: "video-2",
        defaultAudioLanguage: "en",
      },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [],
        },
      },
    };
    const page = vm.createContext({
      Array,
      Date,
      JSON,
      Object,
      Promise,
      String,
      URL,
      document: {
        getElementById() {
          return { getPlayerResponse: () => playerResponse };
        },
      },
      location: { href: "https://www.youtube.com/watch?v=video-2" },
      setTimeout,
    });
    const result = await vm.runInContext(
      `(${injection.func.toString()})(${JSON.stringify(injection.args[0])})`,
      page,
    );
    return [{ frameId: 0, result }];
  });
  const spaSender = sender("video-1");
  spaSender.url = "https://www.youtube.com/";
  spaSender.tab.url = "https://www.youtube.com/watch?v=video-2";

  const response = await harness.invoke(request("video-2"), spaSender);
  assert.equal(response.ok, true);
  assert.equal(response.videoId, "video-2");
  assert.equal(harness.injections.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.injections[0].args)),
    ["video-2"],
  );
});

test("发送者 URL 缺失时可用可信 YouTube origin 完成来源校验", async () => {
  const harness = createHarness(async () => [
    {
      frameId: 0,
      result: {
        status: "ok",
        videoId: "video-1",
        matchedVideo: true,
        rawTrackCount: 0,
        tracks: [],
        sourceLang: "",
      },
    },
  ]);
  const originSender = sender("video-1");
  delete originSender.url;
  originSender.origin = "https://www.youtube.com";

  const response = await harness.invoke(request(), originSender);
  assert.equal(response.ok, true);
  assert.equal(harness.injections.length, 1);
});

test("标签查询未暴露 URL 时安全回退到 Chrome 提供的 sender.tab.url", async () => {
  const harness = createHarness(
    async () => [
      {
        frameId: 0,
        result: {
          status: "ok",
          videoId: "video-1",
          matchedVideo: true,
          rawTrackCount: 0,
          tracks: [],
          sourceLang: "",
        },
      },
    ],
    {},
    {
      async getTab(tabId) {
        return { id: tabId };
      },
    },
  );

  const response = await harness.invoke(request(), sender());
  assert.equal(response.ok, true);
  assert.equal(harness.injections.length, 1);
});

test("旧内容脚本不能在标签已切换后继续读取旧视频", async () => {
  let called = 0;
  const harness = createHarness(async () => {
    called += 1;
    return [];
  });
  const staleSender = sender("video-1");
  staleSender.tab.url = "https://www.youtube.com/watch?v=video-2";

  const response = await harness.invoke(request("video-1"), staleSender);
  assert.equal(response.ok, false);
  assert.match(response.error, /视频已切换/);
  assert.equal(called, 0);
});

test("MAIN world 读取函数无闭包依赖并过滤非 YouTube 字幕地址", async () => {
  const harness = createHarness(async (injection) => {
    const playerResponse = {
      videoDetails: {
        videoId: "video-1",
        defaultAudioLanguage: "en",
      },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: "https://www.youtube.com/api/timedtext?lang=en",
              languageCode: "en",
              name: { simpleText: "English" },
            },
            {
              baseUrl: "https://attacker.example/caption",
              languageCode: "en",
              name: { simpleText: "Injected" },
            },
          ],
        },
      },
    };
    const page = vm.createContext({
      Array,
      Date,
      JSON,
      Object,
      Promise,
      String,
      URL,
      document: {
        getElementById() {
          return { getPlayerResponse: () => playerResponse };
        },
      },
      location: { href: "https://www.youtube.com/watch?v=video-1" },
      setTimeout,
    });
    const result = await vm.runInContext(
      `(${injection.func.toString()})(${JSON.stringify(injection.args[0])})`,
      page,
    );
    return [{ frameId: 0, result }];
  });

  const response = await harness.invoke(request(), sender());
  assert.equal(response.ok, true);
  assert.equal(response.tracks.length, 1);
  assert.match(response.tracks[0].baseUrl, /^https:\/\/www\.youtube\.com\//);
});

test("已匹配播放器但没有轨道时保留无字幕语义", async () => {
  const harness = createHarness(async () => [
    {
      frameId: 0,
      result: {
        status: "ok",
        videoId: "video-1",
        matchedVideo: true,
        rawTrackCount: 0,
        tracks: [],
        sourceLang: "",
      },
    },
  ]);
  const response = await harness.invoke(request(), sender());
  assert.deepEqual(JSON.parse(JSON.stringify(response)), {
    ok: true,
    videoId: "video-1",
    matchedVideo: true,
    tracks: [],
    sourceLang: "",
  });
});

test("播放器未就绪、视频切换和无效轨道不会伪装成无字幕", async () => {
  for (const result of [
    {
      status: "player_unavailable",
      videoId: "video-1",
      matchedVideo: false,
      rawTrackCount: 0,
      tracks: [],
    },
    {
      status: "player_error",
      videoId: "video-1",
      matchedVideo: false,
      rawTrackCount: 0,
      tracks: [],
    },
    {
      status: "video_changed",
      videoId: "video-2",
      matchedVideo: false,
      rawTrackCount: 0,
      tracks: [],
    },
    {
      status: "ok",
      videoId: "video-1",
      matchedVideo: true,
      rawTrackCount: 1,
      tracks: [],
    },
  ]) {
    const harness = createHarness(async () => [{ frameId: 0, result }]);
    const response = await harness.invoke(request(), sender());
    assert.equal(response.ok, false);
    assert.match(
      response.error,
      /播放器数据|视频已切换|无法验证的字幕轨道/,
    );
  }
});

test("拒绝 Side Panel 冒充内容脚本或跨视频读取", async () => {
  let called = 0;
  const harness = createHarness(async () => {
    called += 1;
    return [];
  });

  const missingTab = await harness.invoke(request(), {
    frameId: 0,
    url: "chrome-extension://test/sidepanel.html",
  });
  assert.equal(missingTab.ok, false);

  const wrongVideo = await harness.invoke(request("video-1"), sender("video-2"));
  assert.equal(wrongVideo.ok, false);
  assert.equal(called, 0);
});

test("拒绝伪造的非 YouTube 来源和非顶层 Frame", async () => {
  let called = 0;
  const harness = createHarness(async () => {
    called += 1;
    return [];
  });

  const forgedSender = sender("video-1");
  forgedSender.url = "https://attacker.example/watch?v=video-1";
  const forged = await harness.invoke(request(), forgedSender);
  assert.equal(forged.ok, false);

  const iframeSender = sender("video-1");
  iframeSender.frameId = 3;
  const iframe = await harness.invoke(request(), iframeSender);
  assert.equal(iframe.ok, false);
  assert.equal(called, 0);
});

test("标签查询失败时不会继续向页面注入字幕读取函数", async () => {
  let called = 0;
  const harness = createHarness(
    async () => {
      called += 1;
      return [];
    },
    {},
    {
      async getTab() {
        throw new Error("tab closed");
      },
    },
  );

  const response = await harness.invoke(request(), sender());
  assert.equal(response.ok, false);
  assert.match(response.error, /无法确认当前 YouTube 视频页面/);
  assert.equal(called, 0);
});
