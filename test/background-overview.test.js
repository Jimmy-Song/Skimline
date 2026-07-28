"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, message = "等待条件超时") {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function createStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      if (keys == null) return { ...data };
      if (typeof keys === "string") return { [keys]: data[keys] };
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map((key) => [key, data[key]]));
      }
      return Object.fromEntries(
        Object.entries(keys).map(([key, fallback]) => [
          key,
          data[key] === undefined ? fallback : data[key],
        ]),
      );
    },
    async set(values) {
      Object.assign(data, values);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  };
}

function createHarness({ summary, initialStorage = {} } = {}) {
  const storage = createStorage({ deepseek_api_key: "test-key", ...initialStorage });
  const broadcasts = [];
  let messageListener;
  let removedListener;
  const chrome = {
    sidePanel: {
      setPanelBehavior: async () => {},
    },
    storage: { local: storage },
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
      async sendMessage(message) {
        broadcasts.push(message);
      },
    },
    tabs: {
      onRemoved: {
        addListener(listener) {
          removedListener = listener;
        },
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
    console,
    setTimeout,
    clearTimeout,
    chrome,
    YouTubeSummary: summary,
    importScripts() {},
  });
  const source = fs.readFileSync(
    path.join(__dirname, "..", "background.js"),
    "utf8",
  );
  vm.runInContext(source, context, { filename: "background.js" });

  function invoke(message, sender = {}) {
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

  return {
    broadcasts,
    closeTab(tabId) {
      removedListener(tabId);
    },
    invoke,
    storage,
  };
}

function baseSummary(overrides = {}) {
  return {
    SUMMARY_SCHEMA_VERSION: 6,
    SUMMARY_PROMPT_VERSION: 8,
    normalizeSummaryLanguage: (language) => language || "zh-CN",
    overviewCacheKey: (videoId, language) => `overview:${videoId}:${language}:v1`,
    summaryCacheKey: (videoId, language) =>
      language === "zh-CN" ? `summary:${videoId}` : `summary:${videoId}:${language}`,
    dedupePointsByTimestamp: (points) => [...points],
    getCachedOverview: async () => null,
    generateOverview: async () => ({ overview: "概览" }),
    summarizeVideo: async ({ videoId, targetLanguage }) => ({
      summary: {
        videoId,
        targetLanguage,
        schemaVersion: 6,
        promptVersion: 8,
        overview: "",
        points: [],
        sections: [],
      },
      cached: false,
    }),
    matchVideoIntent: async () => ({ pointTs: [] }),
    ...overrides,
  };
}

function generationPayload(overrides = {}) {
  return {
    videoId: "video-1",
    generationId: "generation-1",
    sourceTabId: 11,
    targetLanguage: "zh-CN",
    duration: 120,
    sourceLang: "en",
    segments: [{ tMs: 0, text: "字幕" }],
    ...overrides,
  };
}

test("后台同时启动概览和观点，概览可先完成展示", async () => {
  const overview = deferred();
  const map = deferred();
  const calls = [];
  const harness = createHarness({
    summary: baseSummary({
      generateOverview: async () => {
        calls.push("overview");
        return overview.promise;
      },
      summarizeVideo: async () => {
        calls.push("map");
        return map.promise;
      },
    }),
  });

  const responsePromise = harness.invoke({
    type: "GENERATE_SUMMARY",
    payload: generationPayload(),
  });
  await waitFor(() => calls.length === 2, "两条生成链未并行启动");
  assert.deepEqual(new Set(calls), new Set(["overview", "map"]));

  overview.resolve({ overview: "优先返回的概览。" });
  await waitFor(() =>
    harness.broadcasts.some((message) => message.type === "OVERVIEW_COMPLETE"),
  );
  assert.equal(
    harness.broadcasts.some((message) => message.type === "SUMMARY_COMPLETE"),
    false,
  );

  map.resolve({
    summary: {
      videoId: "video-1",
      targetLanguage: "zh-CN",
      overview: "",
      points: [{ t: 0, point: "观点", detail: "详情" }],
      sections: [],
    },
    cached: false,
  });
  const response = await responsePromise;
  assert.equal(response.ok, true);
  assert.equal(
    harness.broadcasts.findIndex((message) => message.type === "OVERVIEW_COMPLETE") <
      harness.broadcasts.findIndex((message) => message.type === "SUMMARY_COMPLETE"),
    true,
  );
});

test("概览失败只广播概览错误，不阻断观点地图完成", async () => {
  const harness = createHarness({
    summary: baseSummary({
      generateOverview: async () => {
        throw new Error("概览模型返回异常");
      },
      summarizeVideo: async ({ videoId, targetLanguage }) => ({
        summary: {
          videoId,
          targetLanguage,
          overview: "",
          points: [{ t: 5, point: "仍然生成", detail: "观点链未中断" }],
          sections: [],
        },
        cached: false,
      }),
    }),
  });
  const response = await harness.invoke({
    type: "GENERATE_SUMMARY",
    payload: generationPayload(),
  });
  assert.equal(response.ok, true);
  await waitFor(() =>
    harness.broadcasts.some((message) => message.type === "OVERVIEW_FAILED"),
  );
  assert.ok(harness.broadcasts.some((message) => message.type === "OVERVIEW_FAILED"));
  assert.ok(harness.broadcasts.some((message) => message.type === "SUMMARY_COMPLETE"));
  assert.equal(
    harness.broadcasts.some((message) => message.type === "SUMMARY_FAILED"),
    false,
  );
});

test("重复重试概览按视频、语言和版本去重", async () => {
  const overview = deferred();
  let calls = 0;
  const harness = createHarness({
    summary: baseSummary({
      generateOverview: async () => {
        calls += 1;
        return overview.promise;
      },
    }),
  });
  const first = harness.invoke({
    type: "GENERATE_OVERVIEW",
    payload: generationPayload({ generationId: "retry-1" }),
  });
  const second = harness.invoke({
    type: "GENERATE_OVERVIEW",
    payload: generationPayload({ generationId: "retry-2" }),
  });
  await waitFor(() => calls === 1);
  overview.resolve({ overview: "重试成功。" });
  const [firstResponse, secondResponse] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(firstResponse.overview, "重试成功。");
  assert.equal(secondResponse.overview, "重试成功。");
});

test("同视频多标签复用任务；关闭最后一个标签才同时取消两条链", async () => {
  let overviewCalls = 0;
  let mapCalls = 0;
  let overviewSignal;
  let mapSignal;
  let mapOptions;
  const abortable = (signal) =>
    new Promise((_resolve, reject) => {
      if (signal.aborted) reject(new Error("摘要生成已取消"));
      else signal.addEventListener("abort", () => reject(new Error("摘要生成已取消")), { once: true });
    });
  const harness = createHarness({
    summary: baseSummary({
      generateOverview: async (_input, options) => {
        overviewCalls += 1;
        overviewSignal = options.signal;
        return abortable(options.signal);
      },
      summarizeVideo: async (_input, options) => {
        mapCalls += 1;
        mapSignal = options.signal;
        mapOptions = options;
        return abortable(options.signal);
      },
    }),
  });
  const first = harness.invoke({
    type: "GENERATE_SUMMARY",
    payload: generationPayload({ generationId: "tab-1", sourceTabId: 11 }),
  });
  const second = harness.invoke({
    type: "GENERATE_SUMMARY",
    payload: generationPayload({ generationId: "tab-2", sourceTabId: 22 }),
  });
  await waitFor(() => overviewCalls === 1 && mapCalls === 1);
  await mapOptions.onChunk({ index: 0, total: 1, points: [] });
  const chunk = harness.broadcasts.find((message) => message.type === "SUMMARY_CHUNK");
  assert.deepEqual(new Set(chunk.generationIds), new Set(["tab-1", "tab-2"]));

  harness.closeTab(11);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(overviewSignal.aborted, false);
  assert.equal(mapSignal.aborted, false);

  harness.closeTab(22);
  await waitFor(() => overviewSignal.aborted && mapSignal.aborted);
  const [firstResponse, secondResponse] = await Promise.all([first, second]);
  assert.equal(firstResponse.ok, false);
  assert.equal(secondResponse.ok, false);
  assert.equal(
    Object.keys(harness.storage.data).some((key) => key.startsWith("task:summary-task:")),
    false,
  );
  assert.equal(
    harness.broadcasts.some((message) => message.type === "OVERVIEW_FAILED"),
    false,
  );
});

test("Service Worker 恢复时复用已缓存概览，不重复调用概览模型", async () => {
  const taskKey = "summary-task:restored-video:zh-CN:6:8";
  const storedTask = {
    taskKey,
    videoId: "restored-video",
    targetLanguage: "zh-CN",
    generationId: "restored-generation",
    status: "running",
    sourceLang: "en",
    duration: 100,
    points: [{ t: 0, point: "已恢复观点", detail: "详情" }],
    receivedChunkIndexes: [0],
    totalChunks: 2,
    nextChunkIndex: 1,
    overviewStatus: "complete",
    overview: "已缓存概览。",
    overviewError: "",
    subscriberTabIds: [33],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  let overviewCalls = 0;
  let resumeInput;
  const harness = createHarness({
    initialStorage: { [`task:${taskKey}`]: storedTask },
    summary: baseSummary({
      getCachedOverview: async () => ({
        overview: "已缓存概览。",
        source: "overview-cache",
      }),
      generateOverview: async () => {
        overviewCalls += 1;
        return { overview: "不应生成" };
      },
      summarizeVideo: async (input) => {
        resumeInput = input;
        return {
          summary: {
            videoId: input.videoId,
            targetLanguage: input.targetLanguage,
            overview: "已缓存概览。",
            points: input.resume.points,
            sections: [],
          },
          cached: false,
        };
      },
    }),
  });
  const status = await harness.invoke({
    type: "GET_SUMMARY_TASK",
    videoId: "restored-video",
    targetLanguage: "zh-CN",
    tabId: 33,
  });
  assert.equal(status.task.needsResume, true);
  const response = await harness.invoke({
    type: "GENERATE_SUMMARY",
    payload: generationPayload({
      videoId: "restored-video",
      generationId: "restored-generation",
      sourceTabId: 33,
    }),
  });
  assert.equal(response.ok, true);
  assert.equal(overviewCalls, 0);
  assert.equal(resumeInput.resume.nextChunkIndex, 1);
  assert.equal(resumeInput.resume.points[0].point, "已恢复观点");
});

test("观点任务失败后的直接重试会创建新 Promise，不复用旧错误", async () => {
  let mapCalls = 0;
  const harness = createHarness({
    summary: baseSummary({
      getCachedOverview: async () => ({ overview: "已完成概览。" }),
      summarizeVideo: async ({ videoId, targetLanguage }) => {
        mapCalls += 1;
        if (mapCalls === 1) throw new Error("第一次观点生成失败");
        return {
          summary: {
            videoId,
            targetLanguage,
            overview: "已完成概览。",
            points: [{ t: 0, point: "重试成功", detail: "新任务已完成" }],
            sections: [],
          },
          cached: false,
        };
      },
    }),
  });
  const first = await harness.invoke({
    type: "GENERATE_SUMMARY",
    payload: generationPayload({ generationId: "failed-generation" }),
  });
  assert.equal(first.ok, false);

  const second = await harness.invoke({
    type: "GENERATE_SUMMARY",
    payload: generationPayload({ generationId: "retry-generation" }),
  });
  assert.equal(second.ok, true);
  assert.equal(second.summary.points[0].point, "重试成功");
  assert.equal(mapCalls, 2);
});

test("最多两个视频任务占槽；观点先完成时仍等待该视频概览结束再调度", async () => {
  const maps = new Map([
    ["video-1", deferred()],
    ["video-2", deferred()],
    ["video-3", deferred()],
  ]);
  const overviews = new Map([
    ["video-1", deferred()],
    ["video-2", deferred()],
    ["video-3", deferred()],
  ]);
  const startedMaps = [];
  const startedOverviews = [];
  const harness = createHarness({
    summary: baseSummary({
      generateOverview: async ({ videoId }) => {
        startedOverviews.push(videoId);
        return overviews.get(videoId).promise;
      },
      summarizeVideo: async ({ videoId, targetLanguage }) => {
        startedMaps.push(videoId);
        const result = await maps.get(videoId).promise;
        return {
          summary: {
            videoId,
            targetLanguage,
            overview: "",
            points: result.points || [],
            sections: [],
          },
          cached: false,
        };
      },
    }),
  });
  const first = harness.invoke({
    type: "GENERATE_SUMMARY",
    payload: generationPayload({ videoId: "video-1", sourceTabId: 1 }),
  });
  const second = harness.invoke({
    type: "GENERATE_SUMMARY",
    payload: generationPayload({ videoId: "video-2", sourceTabId: 2 }),
  });
  const third = harness.invoke({
    type: "GENERATE_SUMMARY",
    payload: generationPayload({ videoId: "video-3", sourceTabId: 3 }),
  });
  await waitFor(() => startedMaps.length === 2 && startedOverviews.length === 2);
  assert.equal(startedMaps.includes("video-3"), false);

  maps.get("video-1").resolve({ points: [] });
  await first;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    startedMaps.includes("video-3"),
    false,
    "同一视频的概览仍在运行时不能提前释放视频并发槽",
  );

  overviews.get("video-1").resolve({ overview: "第一条概览" });
  await waitFor(() => startedMaps.includes("video-3"));
  maps.get("video-2").resolve({ points: [] });
  maps.get("video-3").resolve({ points: [] });
  overviews.get("video-2").resolve({ overview: "第二条概览" });
  overviews.get("video-3").resolve({ overview: "第三条概览" });
  const [secondResponse, thirdResponse] = await Promise.all([second, third]);
  assert.equal(secondResponse.ok, true);
  assert.equal(thirdResponse.ok, true);
});

test("切换摘要语言会取消旧语言两条请求，取消不伪装成失败", async () => {
  let oldOverviewSignal;
  let oldMapSignal;
  const waitForAbort = (signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("摘要生成已取消")), {
        once: true,
      });
    });
  const harness = createHarness({
    summary: baseSummary({
      generateOverview: async (input, options) => {
        if (input.targetLanguage === "zh-CN") {
          oldOverviewSignal = options.signal;
          return waitForAbort(options.signal);
        }
        return { overview: "English overview." };
      },
      summarizeVideo: async (input, options) => {
        if (input.targetLanguage === "zh-CN") {
          oldMapSignal = options.signal;
          return waitForAbort(options.signal);
        }
        return {
          summary: {
            videoId: input.videoId,
            targetLanguage: input.targetLanguage,
            overview: "English overview.",
            points: [],
            sections: [],
          },
          cached: false,
        };
      },
    }),
  });
  const oldResponse = harness.invoke({
    type: "GENERATE_SUMMARY",
    payload: generationPayload({ generationId: "old-language" }),
  });
  await waitFor(() => oldOverviewSignal && oldMapSignal);
  const cancelled = await harness.invoke({
    type: "CANCEL_GENERATION",
    videoId: "video-1",
    targetLanguage: "zh-CN",
    tabId: 11,
  });
  assert.equal(cancelled.ok, true);
  await waitFor(() => oldOverviewSignal.aborted && oldMapSignal.aborted);
  assert.equal((await oldResponse).ok, false);
  assert.equal(
    harness.broadcasts.some(
      (message) =>
        message.targetLanguage === "zh-CN" &&
        ["OVERVIEW_FAILED", "SUMMARY_FAILED"].includes(message.type),
    ),
    false,
  );

  const next = await harness.invoke({
    type: "GENERATE_SUMMARY",
    payload: generationPayload({
      generationId: "new-language",
      targetLanguage: "en",
    }),
  });
  assert.equal(next.ok, true);
  assert.equal(next.targetLanguage, "en");
});
