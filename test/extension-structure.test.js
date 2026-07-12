"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

test("Manifest V3 声明 Side Panel 且不请求多余高权限", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "Skimline");
  assert.equal(manifest.action.default_title, "Skimline");
  assert.equal(
    manifest.description,
    "Skim any long YouTube video into a scannable, jump-anywhere map of its ideas.",
  );
  assert.deepEqual(manifest.permissions, ["storage", "scripting", "sidePanel"]);
  assert.ok(manifest.content_scripts[0].js.includes("content.js"));
  assert.deepEqual(manifest.content_scripts[0].matches, ["*://*.youtube.com/*"]);
  assert.equal(manifest.content_scripts[0].css, undefined);
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.equal(manifest.options_page, "options.html");
  assert.equal(manifest.background.service_worker, "background.js");
  for (const file of ["sidepanel.html", "sidepanel.js", "sidepanel.css"]) {
    assert.ok(fs.existsSync(path.join(root, file)), `缺少 Side Panel 文件：${file}`);
  }
});

test("F4 README 使用 Skimline 正式名称与 tagline", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(readme, /^# Skimline$/m);
  assert.match(readme, /Skim any long video\./);
  const legacyName = ["YouTube", "观点地图"].join(" ");
  assert.equal(readme.includes(legacyName), false);
});

test("D 流式 harness 可复现乱序块、结构阶段与长标题", () => {
  const harness = fs.readFileSync(path.join(root, "test", "harness.html"), "utf8");
  assert.match(harness, /streamMode/);
  assert.ok(harness.indexOf("index: 1") < harness.indexOf("index: 0"));
  assert.match(harness, /SUMMARY_STRUCTURE_STARTED/);
  assert.match(harness, /Routines 功能与自动触发机制的完整设计原则/);
  assert.match(harness, /keyInsights/);
  assert.match(harness, /suggestedIntents/);
  assert.match(harness, /MATCH_SUMMARY_INTENT/);
  assert.match(harness, /pointT: 691/);
  assert.match(harness, /callback\(\{ ok: true, summary: streamingSummary \}\)/);
});

test("设置页只保存本地 API Key", () => {
  const html = fs.readFileSync(path.join(root, "options.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "options.js"), "utf8");
  assert.match(html, /type="password"/);
  assert.match(js, /chrome\.storage\.local\.set/);
  assert.match(js, /deepseek_api_key/);
  assert.doesNotMatch(js, /fetch\s*\(/);
});

test("内容脚本保留字幕兜底并作为视频消息桥", () => {
  const source = fs.readFileSync(path.join(root, "content.js"), "utf8");
  assert.match(source, /yt-navigate-finish/);
  assert.match(source, /setInterval\(detectNavigation, 1000\)/);
  assert.match(source, /ensureVideoListener\(\)/);
  assert.match(source, /type === "GET_VIDEO_STATE"/);
  assert.match(source, /type === "GET_CAPTION_SEGMENTS"/);
  assert.match(source, /type === "SEEK"/);
  assert.match(source, /type: "PLAYBACK_TIME"/);
  assert.match(source, /type: "VIDEO_CHANGED"/);
  assert.match(source, /captionInfo\.videoId !== requestedVideoId/);
  assert.match(source, /event\.data\?\.requestId !== requestId/);
  assert.match(source, /event\.data\?\.videoId !== requestedVideoId/);
  assert.match(source, /fetchCaptionSegments\(track\)/);
  assert.match(source, /requestTranscriptFallback\(requestedVideoId\)/);
  assert.doesNotMatch(source, /yvpm-trigger|createShell|TOGGLE_PANEL/);
});

test("长视频文字记录优先读取已打开面板，再按需打开并关闭原生面板", () => {
  const injected = fs.readFileSync(path.join(root, "injected.js"), "utf8");
  const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
  assert.match(injected, /timeoutMs = 30000/);
  assert.match(content, /}, 35000\);/);
  assert.match(injected, /ytd-transcript-segment-renderer/);
  assert.match(injected, /transcript-segment-view-model/);
  assert.match(injected, /\.segment-timestamp/);
  assert.match(injected, /\.segment-text/);
  assert.match(injected, /parseTranscriptDom\(documentRef\)/);
  assert.match(injected, /if \(existingSegments\.length\) return existingSegments/);
  assert.match(injected, /selectMatchingPlayerResponse/);
  assert.match(injected, /waitForPlayerResponse/);
  assert.match(injected, /pendingFallbackByVideoId/);
  assert.match(content, /当前 player response 没有字幕轨道/);
  assert.match(content, /requestTranscriptFallback\(requestedVideoId\)/);
  assert.match(
    injected,
    /engagement-panel-searchable-transcript[\s\S]*\/close\|关闭\/i/,
  );
});

test("工具栏动作打开 Side Panel，不再切换页面浮层", () => {
  const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
  assert.match(background, /chrome\.sidePanel/);
  assert.match(background, /setPanelBehavior/);
  assert.match(background, /openPanelOnActionClick: true/);
  assert.match(background, /summary\?\.videoId === message\.videoId/);
  assert.match(background, /message\?\.type === "MATCH_SUMMARY_INTENT"/);
  assert.match(background, /YouTubeSummary\.matchVideoIntent/);
  assert.match(background, /YouTubeSummary\.summaryCacheKey/);
  assert.match(background, /generationId/);
  assert.match(background, /message\?\.type === "CANCEL_GENERATION"/);
  assert.match(background, /chrome\.tabs\.onRemoved\.addListener/);
  assert.match(background, /task\.subscriberTabIds\.delete\(tabId\)/);
  assert.match(background, /async function cancelTask/);
  assert.match(background, /MAX_CONCURRENT_GENERATIONS = 2/);
  assert.doesNotMatch(background, /TOGGLE_PANEL|chrome\.action\.onClicked/);
});

test("F3 模型输出标题与观点不做硬字符截断", () => {
  const generation = fs.readFileSync(path.join(root, "generation-utils.js"), "utf8");
  assert.doesNotMatch(generation, /title:[^\n]*\.slice\s*\(/);
  assert.doesNotMatch(generation, /point:[^\n]*\.slice\s*\(/);
  assert.doesNotMatch(generation, /不超过 12 个字|不超过 25 个字/);
});

test("Side Panel 覆盖活动标签、渲染、SEEK、播放跟随与 SPA 刷新", () => {
  const html = fs.readFileSync(path.join(root, "sidepanel.html"), "utf8");
  const source = fs.readFileSync(path.join(root, "sidepanel.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "sidepanel.css"), "utf8");
  assert.match(html, /id="yvpm-empty"/);
  assert.match(html, /id="yvpm-overview"/);
  assert.match(html, /id="yvpm-intent-form"/);
  assert.match(html, /id="yvpm-matchbar"/);
  assert.match(html, /id="yvpm-progress"/);
  assert.match(html, /id="yvpm-language-menu"/);
  assert.match(html, /id="yvpm-prepare"/);
  assert.match(html, /id="yvpm-generation-bar"/);
  assert.match(html, /打开一个 YouTube 视频即可生成观点地图/);
  assert.doesNotMatch(html, /<h1\b|yvpm-page-title/);
  assert.match(source, /chrome\.tabs\.query\(\{ active: true, currentWindow: true \}\)/);
  assert.match(source, /function createPointRow/);
  assert.match(source, /type: "GET_CAPTION_SEGMENTS"/);
  assert.match(source, /type: "SEEK"/);
  assert.match(source, /message\?\.type === "PLAYBACK_TIME"/);
  assert.match(source, /message\?\.type === "VIDEO_CHANGED"/);
  assert.match(source, /switchToVideo\(message\.videoId\)/);
  assert.match(source, /YouTubeSummary\.getVideoId\(changeInfo\.url\)/);
  assert.match(source, /scrollIntoView\(\{ block: "nearest", behavior: "smooth" \}\)/);
  assert.match(source, /collapseExpandedRow\(row\)/);
  assert.match(source, /const DEFAULT_SECTIONS_COLLAPSED = true/);
  assert.match(source, /function createSectionView/);
  assert.match(source, /type: "SEEK", t: group\.startT/);
  assert.match(source, /yvpm-section-current/);
  assert.match(source, /if \(!sectionBody \|\| !sectionBody\.hidden\)/);
  assert.match(source, /renderSummary\(response\.summary\)/);
  assert.match(source, /YouTubeSummary\.mergePointsByTimestamp/);
  assert.match(source, /YouTubeSummary\.pointStableKey\(state\.videoId, point\)/);
  assert.match(source, /receivedChunkIndexes\.size/);
  assert.match(source, /updateProgress\(message\.index, message\.total\)/);
  assert.match(source, /hideProgress\(\)/);
  assert.match(source, /function showOverviewPlaceholder/);
  assert.match(source, /message\?\.type === "SUMMARY_STRUCTURE_STARTED"/);
  assert.match(source, /yvpm-overview-arrive/);
  assert.match(source, /YouTubeSummary\.dedupePointsByTimestamp\(summary\?\.points\)/);
  assert.match(source, /function insightMapFromSummary/);
  assert.match(source, /function runRecommendation/);
  assert.match(source, /type: "MATCH_SUMMARY_INTENT"/);
  assert.match(source, /suggestedIntents/);
  assert.match(source, /targetLanguage: state\.targetLanguage/);
  assert.match(source, /sourceTabId: state\.tabId/);
  assert.match(source, /message\.generationId === state\.activeGenerationId/);
  assert.match(source, /PREPARE_COUNTDOWN_SECONDS = 3/);
  assert.match(source, /yvpm-recommended/);
  assert.match(source, /slice\(0, 4\)/);
  assert.match(source, /keyInsights/);
  assert.match(source, /yvpm-key-insight/);
  assert.match(source, /yvpm-insight-card/);
  assert.match(source, /为什么重要：/);
  assert.match(
    source,
    /detail\.replaceChildren\(cardHeader, why, detailText, createSeekButton\(point\)\)/,
  );
  assert.doesNotMatch(source, /yvpm-insight-card-claim/);
  assert.doesNotMatch(
    source,
    /detail\.replaceChildren\(cardHeader, claim, why, detailText, createSeekButton\(point\)\)/,
  );
  assert.match(source, /createSectionView\(group, insightMap\)/);
  assert.match(css, /\.yvpm-insight-card/);
  assert.match(css, /\.yvpm-intent/);
  assert.match(css, /\.yvpm-matchbar/);
  assert.match(css, /\.yvpm-row\.yvpm-recommended/);
  assert.match(css, /\.yvpm-insight-card-header/);
  assert.match(css, /\.yvpm-insight-card-icon/);
  assert.match(css, /\.yvpm-insight-card-time/);
  assert.match(css, /\.yvpm-insight-card-label/);
  assert.doesNotMatch(css, /\.yvpm-insight-card-claim/);
  assert.match(css, /\.yvpm-insight-card-why/);
  assert.match(css, /\.yvpm-insight-card-detail/);
  assert.match(css, /\.yvpm-key-insight \.yvpm-point-toggle \.yvpm-time::before/);
  assert.match(css, /var\(--accent-warm\)/);
  assert.match(css, /var\(--expand-fill\)/);
  assert.match(css, /prefers-color-scheme: dark[\s\S]*\.yvpm-insight-card-why/);
  assert.doesNotMatch(source, /DeepSeek|模型品牌|已缓存/);
});
