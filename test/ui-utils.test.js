"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  dedupePointsByTimestamp,
  findCurrentPointIndex,
  findCurrentSectionIndex,
  formatTimestamp,
  getVideoId,
  groupPointsBySections,
  mergePointsByTimestamp,
  pointIdentity,
  pointStableKey,
  seekVideo,
} = require("../ui-utils.js");

test("只从 YouTube watch URL 读取 videoId", () => {
  assert.equal(getVideoId("https://www.youtube.com/watch?v=abc123&t=20"), "abc123");
  assert.equal(getVideoId("https://youtu.be/abc123"), "");
  assert.equal(getVideoId("not a url"), "");
});

test("观点标识兼顾时间和内容", () => {
  assert.equal(pointIdentity({ t: 12, point: "观点" }), "12:观点");
});

test("已有缓存同秒重复观点在渲染前被清理", () => {
  const points = dedupePointsByTimestamp([
    { t: 103, point: "等待用户", detail: "短。" },
    { t: 103, point: "不应等待用户", detail: "包含更完整的说明和依据。" },
    { t: 131, point: "下一条", detail: "独立内容。" },
  ]);
  assert.deepEqual(points.map((point) => point.t), [103, 131]);
  assert.equal(points[0].point, "不应等待用户");
});

test("F1 乱序块合并后始终按时间单调递增并使用稳定 key", () => {
  let points = mergePointsByTimestamp([], [
    { t: 1200, point: "晚段", detail: "晚段详情" },
    { t: 1260, point: "更晚段", detail: "更晚段详情" },
  ]);
  points = mergePointsByTimestamp(points, [
    { t: 146, point: "早段", detail: "早段详情" },
    { t: 691, point: "中段", detail: "中段详情" },
  ]);
  assert.deepEqual(points.map((point) => point.t), [146, 691, 1200, 1260]);
  assert.ok(
    points.every((point, index) => index === 0 || points[index - 1].t <= point.t),
  );
  assert.equal(pointStableKey("video-1", points[0]), "video-1:146");
});

test("看这段会跳转并尝试播放", async () => {
  let played = 0;
  const video = {
    currentTime: 0,
    async play() {
      played += 1;
    },
  };
  await seekVideo(video, 135);
  assert.equal(video.currentTime, 135);
  assert.equal(played, 1);
});

test("播放时间对应最后一个已开始的观点", () => {
  const points = [{ t: 10 }, { t: 20 }, { t: 45 }];
  assert.equal(findCurrentPointIndex(points, 9.9), -1);
  assert.equal(findCurrentPointIndex(points, 10), 0);
  assert.equal(findCurrentPointIndex(points, 44), 1);
  assert.equal(findCurrentPointIndex(points, 999), 2);
});

test("按 startT 将全部观点归入最后一个已开始分区", () => {
  const points = [
    { t: 10, point: "开场" },
    { t: 80, point: "问题" },
    { t: 180, point: "方案" },
    { t: 3700, point: "结论" },
  ];
  const groups = groupPointsBySections(points, [
    { title: "方案", startT: 150 },
    { title: "开场", startT: 20 },
    { title: "结论", startT: 3600 },
  ]);
  assert.deepEqual(
    groups.map((group) => ({
      title: group.title,
      points: group.points.map((point) => point.t),
      range: group.rangeLabel,
    })),
    [
      { title: "开场", points: [10, 80], range: "00:10–01:20" },
      { title: "方案", points: [180], range: "03:00" },
      { title: "结论", points: [3700], range: "1:01:40" },
    ],
  );
  assert.deepEqual(groups.flatMap((group) => group.points), points);
  assert.equal(formatTimestamp(3700), "1:01:40");
});

test("B 单点分区只显示单个时间，多点分区仍显示范围", () => {
  const groups = groupPointsBySections(
    [
      { t: 263, point: "单点" },
      { t: 400, point: "范围起点" },
      { t: 460, point: "范围终点" },
    ],
    [
      { title: "单点分区", startT: 263 },
      { title: "多点分区", startT: 400 },
    ],
  );
  assert.equal(groups[0].rangeLabel, "04:23");
  assert.equal(groups[1].rangeLabel, "06:40–07:40");
});

test("播放时间命中当前分区，第一段从视频开头生效", () => {
  const groups = [
    { startT: 30 },
    { startT: 100 },
    { startT: 200 },
  ];
  assert.equal(findCurrentSectionIndex(groups, 0), 0);
  assert.equal(findCurrentSectionIndex(groups, 99), 0);
  assert.equal(findCurrentSectionIndex(groups, 100), 1);
  assert.equal(findCurrentSectionIndex(groups, 999), 2);
});

test("样式包含规范指定的明暗色、尺寸和上下布局", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "sidepanel.css"), "utf8");
  for (const expected of [
    "#fdfcfa",
    "#1c1b19",
    "#b0710f",
    "#1b1a18",
    "#ece9e3",
    "#e1a64b",
    "border-radius: 14px",
    "font: 11px",
    "font: 400 13px/1.5",
    "font: 12.5px/1.8",
  ]) {
    assert.ok(css.includes(expected), `缺少视觉规范：${expected}`);
  }
  assert.ok(css.indexOf(".yvpm-time") < css.indexOf(".yvpm-claim"));
});

test("C1 暖色只用于当前项、展开项与可操作处", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "sidepanel.css"), "utf8");
  assert.match(
    css,
    /\.yvpm-point-toggle \.yvpm-time\s*\{[\s\S]*?color: var\(--text-muted\)/,
  );
  assert.match(
    css,
    /\.yvpm-expanded \.yvpm-point-toggle \.yvpm-time,[\s\S]*?\.yvpm-now-playing \.yvpm-point-toggle \.yvpm-time\s*\{[\s\S]*?color: var\(--accent-warm\)/,
  );
  assert.match(css, /\.yvpm-seek\s*\{[\s\S]*?color: var\(--accent-warm\)/);
  assert.match(css, /\.yvpm-status-action\s*\{[\s\S]*?color: var\(--accent-warm\)/);
  assert.match(css, /border-top-color: var\(--text-muted\)/);
});

test("C2 观点宋体栈在 Side Panel 内明确生效", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "sidepanel.css"), "utf8");
  assert.match(
    css,
    /--font-claim: Georgia, "Noto Serif SC", "Songti SC", "STSong", serif;/,
  );
  assert.match(
    css,
    /\.yvpm-point-toggle \.yvpm-claim\s*\{[\s\S]*?font-family: var\(--font-claim\)/,
  );
});

test("C3 展开区使用指定的更浅暖底和描边", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "sidepanel.css"), "utf8");
  assert.match(css, /--expand-fill: rgba\(176, 113, 15, 0\.06\);/);
  assert.match(css, /--expand-border: rgba\(176, 113, 15, 0\.14\);/);
  assert.match(css, /\.yvpm-detail\s*\{[\s\S]*?background: var\(--expand-fill\)/);
  assert.match(css, /\.yvpm-detail\s*\{[\s\S]*?border: 0\.5px solid var\(--expand-border\)/);
});

test("概览与分区满足克制的三层视觉和吸顶约束", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "sidepanel.css"), "utf8");
  assert.match(css, /--overview-fill: rgba\(176, 113, 15, 0\.035\);/);
  assert.match(
    css,
    /\.yvpm-section-header\s*\{[\s\S]*?position: sticky;[\s\S]*?top: 52px;[\s\S]*?box-shadow:/,
  );
  assert.match(
    css,
    /\.yvpm-section-title\s*\{[\s\S]*?color: var\(--text-primary\);[\s\S]*?font: 500 13px/,
  );
  assert.doesNotMatch(
    css.match(/\.yvpm-section-title\s*\{[\s\S]*?\}/)?.[0] || "",
    /accent-warm/,
  );
  assert.match(
    css,
    /\.yvpm-section-current \.yvpm-section-header\s*\{[\s\S]*?inset 3px 0 0 var\(--nowplaying-bar\)/,
  );
});

test("A 分区标题使用中性灰底章节带且不含暖色", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "sidepanel.css"), "utf8");
  assert.match(css, /--surface-1: #f3f2ef;/);
  assert.match(css, /--surface-1: #262522;/);

  const headerRule =
    css.match(/\.yvpm-section-header\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.match(headerRule, /border-top: 0\.5px solid var\(--divider\)/);
  assert.match(headerRule, /border-bottom: 0\.5px solid var\(--divider\)/);
  assert.match(headerRule, /background: var\(--surface-1\)/);
  assert.doesNotMatch(headerRule, /accent-warm|expand-fill|overview-fill/);

  const chevronRule =
    css.match(/\.yvpm-section-chevron\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.match(chevronRule, /color: var\(--text-secondary\)/);

  const rangeRule =
    [...css.matchAll(/\.yvpm-section-range\s*\{[\s\S]*?\}/g)]
      .map((match) => match[0])
      .find((rule) => rule.includes("flex: none")) || "";
  assert.match(rangeRule, /color: var\(--text-muted\)/);
  assert.match(rangeRule, /font: 10px\/1\.45 var\(--font-time\)/);
  assert.doesNotMatch(rangeRule, /accent-warm/);

  const currentRule =
    css.match(/\.yvpm-section-current \.yvpm-section-header\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.match(currentRule, /inset 3px 0 0 var\(--nowplaying-bar\)/);
  assert.match(currentRule, /background: var\(--surface-1\)/);
  assert.doesNotMatch(currentRule, /accent-warm|expand-fill|overview-fill/);
});

test("F1 生成进度与 shimmer 只使用灰色 token", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "sidepanel.css"), "utf8");
  const progressRule =
    css.match(/\.yvpm-progress\s*\{[\s\S]*?\}/)?.[0] || "";
  const shimmerRule =
    css.match(/\.yvpm-progress-shimmer\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.match(progressRule, /color: var\(--text-muted\)/);
  assert.match(shimmerRule, /var\(--divider\)/);
  assert.match(shimmerRule, /var\(--text-muted\)/);
  assert.doesNotMatch(
    `${progressRule}\n${shimmerRule}`,
    /accent-warm|expand-fill|overview-fill|nowplaying-bar/,
  );
});

test("F2 概览占位使用灰色，最终概览从顶部淡入", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "sidepanel.css"), "utf8");
  const pendingRule =
    css.match(/\.yvpm-overview-pending\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.match(pendingRule, /background: var\(--surface-1\)/);
  assert.doesNotMatch(
    pendingRule,
    /accent-warm|expand-fill|overview-fill|nowplaying-bar/,
  );
  assert.match(
    css,
    /\.yvpm-overview-arrive\s*\{[\s\S]*?animation: yvpm-overview-arrive 240ms ease both/,
  );
  assert.match(css, /@keyframes yvpm-overview-arrive/);
});

test("F3 超长分区标题与观点只在 CSS 中可见省略", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "sidepanel.css"), "utf8");
  const titleRule =
    css.match(/\.yvpm-section-title\s*\{[\s\S]*?\}/)?.[0] || "";
  const pointRule =
    css.match(/\.yvpm-point-toggle \.yvpm-claim\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.match(titleRule, /overflow: hidden/);
  assert.match(titleRule, /text-overflow: ellipsis/);
  assert.match(titleRule, /white-space: nowrap/);
  assert.match(pointRule, /overflow: hidden/);
  assert.match(pointRule, /-webkit-line-clamp: 2/);
});
