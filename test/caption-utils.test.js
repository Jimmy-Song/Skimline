"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  buildJson3Url,
  fetchCaptionSegments,
  isTranslatedTrack,
  parseJson3,
  selectCaptionTrack,
} = require("../caption-utils.js");
const {
  getVideoIdFromUrl,
  parseTranscriptDom,
  parseTimestampLabel,
  parseTranscriptEntries,
  parseTranscriptSegment,
  selectMatchingPlayerResponse,
} = require("../injected.js");

function fixture(name) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8"),
  );
}

test("从 player response 选择非翻译的英文人工字幕", () => {
  const response = fixture("sample_player_response_captions.json");
  const tracks = response.captions.playerCaptionsTracklistRenderer.captionTracks;
  const selected = selectCaptionTrack(tracks);
  assert.equal(selected.vssId, ".en");
});

test("优先选择视频原语言，且允许 asr 自动字幕", () => {
  const tracks = [
    { baseUrl: "https://example.test?lang=en", languageCode: "en" },
    {
      baseUrl: "https://example.test?lang=zh-Hans&kind=asr",
      languageCode: "zh-Hans",
      kind: "asr",
    },
  ];
  assert.equal(selectCaptionTrack(tracks, "zh-CN").languageCode, "zh-Hans");
});

test("排除带 tlang 的 YouTube 翻译轨道", () => {
  const translated = {
    baseUrl: "https://example.test?lang=en&tlang=zh-Hans",
    languageCode: "zh-Hans",
  };
  assert.equal(isTranslatedTrack(translated), true);
  assert.equal(selectCaptionTrack([translated]), null);
});

test("为 timedtext URL 设置唯一 fmt=json3 参数", () => {
  const url = new URL(buildJson3Url("https://example.test/api?lang=en&fmt=srv3"));
  assert.equal(url.searchParams.get("fmt"), "json3");
  assert.equal(url.searchParams.getAll("fmt").length, 1);
});

test("解析 json3 为完整的带时间戳字幕并忽略空事件", () => {
  const parsed = parseJson3(fixture("sample_timedtext_json3.json"));
  assert.deepEqual(parsed, [
    { tMs: 0, text: "So I think the biggest mistake that early founders make" },
    { tMs: 5200, text: "is scaling the team too fast." },
    { tMs: 9300, text: "When I hired twenty people at my first company," },
    { tMs: 13900, text: "decisions got slower and the goal got blurry." },
    { tMs: 18500, text: "We ended up missing the window to pivot." },
  ]);
});

test("字幕请求携带登录态并检查 HTTP 状态", async () => {
  let request;
  const segments = await fetchCaptionSegments(
    { baseUrl: "https://example.test/api?lang=en" },
    async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => fixture("sample_timedtext_json3.json"),
      };
    },
  );
  assert.equal(new URL(request.url).searchParams.get("fmt"), "json3");
  assert.equal(request.options.credentials, "include");
  assert.equal(segments.length, 5);

  await assert.rejects(
    () =>
      fetchCaptionSegments(
        { baseUrl: "https://example.test/api?lang=en" },
        async () => ({ ok: false, status: 403 }),
      ),
    /HTTP 403/,
  );
});

test("timedtext 200 空响应交给官方文字记录兜底", async () => {
  const segments = await fetchCaptionSegments(
    { baseUrl: "https://example.test/api?lang=en" },
    async () => ({
      ok: true,
      status: 200,
      text: async () => "",
    }),
  );
  assert.deepEqual(segments, []);
});

test("解析新版 YouTube 文字记录时间戳和文本", () => {
  assert.equal(parseTimestampLabel("0:01"), 1000);
  assert.equal(parseTimestampLabel("1:02:03"), 3723000);
  assert.equal(parseTimestampLabel("bad"), null);
  assert.deepEqual(
    parseTranscriptEntries([
      { timeLabel: "0:01", text: " First point. " },
      { timeLabel: "0:07", text: "Second point." },
      { timeLabel: "", text: "ignored" },
    ]),
    [
      { tMs: 1000, text: "First point." },
      { tMs: 7000, text: "Second point." },
    ],
  );
});

test("页面文稿已可见时可直接从当前 DOM 读取", () => {
  const segment = {
    textContent:
      "0:12 Please welcome to the stage member of technical staff at Anthropic.",
    querySelector: () => null,
  };
  assert.deepEqual(parseTranscriptSegment(segment), {
    timeLabel: "0:12",
    text: "Please welcome to the stage member of technical staff at Anthropic.",
  });

  const documentRef = {
    querySelectorAll: () => [
      {
        textContent: "9:99 Hidden stale transcript.",
        getClientRects: () => [],
        querySelector: () => null,
      },
      {
        textContent: "",
        getClientRects: () => [{ width: 100, height: 20 }],
        querySelector: (selector) => {
          if (selector.includes("Timestamp")) return { textContent: "0:20" };
          if (selector.includes("SegmentText")) return { textContent: "[music]" };
          return null;
        },
      },
    ],
  };
  assert.deepEqual(parseTranscriptDom(documentRef), [
    { tMs: 20000, text: "[music]" },
  ]);
});

test("SPA 切换后只接受与当前 URL videoId 一致的 player response", () => {
  const previous = {
    videoDetails: { videoId: "previous-video" },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
  };
  const current = {
    videoDetails: { videoId: "current-video" },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
  };

  assert.equal(
    getVideoIdFromUrl("https://www.youtube.com/watch?v=current-video&list=WL"),
    "current-video",
  );
  assert.equal(
    selectMatchingPlayerResponse([previous, current], "current-video"),
    current,
  );
  assert.equal(
    selectMatchingPlayerResponse([previous], "current-video"),
    null,
  );
});
