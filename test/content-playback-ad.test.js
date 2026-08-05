"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("YouTube 中插广告期间保留正片时间且不驱动摘要回到开头", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "content.js"),
    "utf8",
  );
  const runtimeMessages = [];
  const videoListeners = new Map();
  let messageListener;
  const playerClasses = new Set();
  const player = {
    classList: {
      contains(name) {
        return playerClasses.has(name);
      },
    },
  };
  const video = {
    currentTime: 88,
    duration: 600,
    addEventListener(type, listener) {
      videoListeners.set(type, listener);
    },
    removeEventListener(type) {
      videoListeners.delete(type);
    },
  };
  const context = vm.createContext({
    console: { info() {}, warn() {} },
    clearTimeout,
    setTimeout,
    setInterval: () => 0,
    document: {
      title: "Test video - YouTube",
      addEventListener() {},
      querySelector(selector) {
        if (selector === "video") return video;
        if (selector === "#movie_player") return player;
        return null;
      },
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
          runtimeMessages.push(message);
          callback?.({ ok: true });
        },
      },
    },
    YouTubeSummary: {
      getVideoId: () => "video-with-midroll",
      async seekVideo() {},
    },
  });

  vm.runInContext(source, context, { filename: "content.js" });
  assert.equal(runtimeMessages.at(-1).currentTime, 88);

  playerClasses.add("ad-showing");
  video.currentTime = 10;
  video.duration = 51;
  videoListeners.get("timeupdate")({ type: "timeupdate" });

  assert.equal(runtimeMessages.length, 1);
  let response;
  messageListener({ type: "GET_VIDEO_STATE" }, {}, (value) => {
    response = value;
  });
  assert.equal(response.currentTime, 88);
  assert.equal(response.duration, 600);

  playerClasses.delete("ad-showing");
  video.currentTime = 89;
  video.duration = 600;
  videoListeners.get("timeupdate")({ type: "timeupdate" });

  assert.equal(runtimeMessages.length, 2);
  assert.equal(runtimeMessages.at(-1).currentTime, 89);
});
