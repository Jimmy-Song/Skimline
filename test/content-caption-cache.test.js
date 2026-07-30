"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("内容脚本复用同一视频已读取的字幕，不重复触发原生文字记录", async () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "content.js"),
    "utf8",
  );
  let messageListener;
  let captionTrackReads = 0;
  let captionFetches = 0;
  const video = {
    currentTime: 0,
    duration: 120,
    addEventListener() {},
    removeEventListener() {},
  };
  const context = vm.createContext({
    console: { info() {}, warn() {} },
    clearTimeout,
    setTimeout,
    setInterval: () => 0,
    document: {
      addEventListener() {},
      querySelector: (selector) => (selector === "video" ? video : null),
    },
    chrome: {
      runtime: {
        lastError: null,
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          },
        },
        sendMessage(message, callback) {
          if (message.type === "READ_PLAYER_CAPTION_TRACKS") {
            captionTrackReads += 1;
            callback({
              ok: true,
              videoId: "video-cache",
              matchedVideo: true,
              sourceLang: "en",
              tracks: [
                {
                  baseUrl: "https://www.youtube.com/api/timedtext?v=video-cache",
                  languageCode: "en",
                },
              ],
            });
            return;
          }
          callback?.({ ok: true });
        },
      },
    },
    YouTubeSummary: {
      getVideoId: () => "video-cache",
      selectCaptionTrack: (tracks) => tracks[0],
      async fetchCaptionSegments() {
        captionFetches += 1;
        return [{ tMs: 0, text: "Cached caption" }];
      },
      async extractTranscriptFallback() {
        throw new Error("不应进入文字记录兜底");
      },
      async seekVideo() {},
    },
  });

  vm.runInContext(source, context, { filename: "content.js" });
  const requestCaptions = () =>
    new Promise((resolve) => {
      const keepChannelOpen = messageListener(
        { type: "GET_CAPTION_SEGMENTS", videoId: "video-cache" },
        {},
        resolve,
      );
      assert.equal(keepChannelOpen, true);
    });

  const first = await requestCaptions();
  const second = await requestCaptions();

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first.segments, [{ tMs: 0, text: "Cached caption" }]);
  assert.equal(captionTrackReads, 1);
  assert.equal(captionFetches, 1);

  const stale = await new Promise((resolve) => {
    messageListener(
      { type: "GET_CAPTION_SEGMENTS", videoId: "stale-video" },
      {},
      resolve,
    );
  });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /视频已切换/);
});
