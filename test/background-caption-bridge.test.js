"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createStorage() {
  const data = {};
  return {
    async get(keys) {
      if (keys == null) return { ...data };
      if (typeof keys === "string") return { [keys]: data[keys] };
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

function createHarness(executeScript, summaryOverrides = {}) {
  let messageListener;
  const injections = [];
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
    storage: { local: createStorage() },
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
      async sendMessage() {},
    },
    tabs: {
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
    importScripts() {},
  });
  const source = fs.readFileSync(
    path.join(__dirname, "..", "background.js"),
    "utf8",
  );
  vm.runInContext(source, context, { filename: "background.js" });

  function invoke(message, sender) {
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

  return { injections, invoke };
}

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
