"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

function readPngDimensions(file) {
  const image = fs.readFileSync(file);
  assert.equal(image.subarray(1, 4).toString("ascii"), "PNG");
  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
  };
}

test("Manifest V3 声明 Side Panel 且不请求多余高权限", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "Skimline");
  assert.equal(manifest.action.default_title, "Skimline");
  assert.equal(
    manifest.description,
    "Skim any long YouTube video into a scannable, jump-anywhere map of its ideas.",
  );
  assert.deepEqual(manifest.permissions, [
    "storage",
    "unlimitedStorage",
    "scripting",
    "sidePanel",
  ]);
  assert.deepEqual(manifest.host_permissions, [
    "https://*.youtube.com/*",
    "https://api.deepseek.com/*",
  ]);
  assert.ok(manifest.content_scripts[0].js.includes("content.js"));
  assert.ok(manifest.content_scripts[0].js.includes("transcript-utils.js"));
  assert.deepEqual(manifest.content_scripts[0].matches, [
    "https://*.youtube.com/*",
  ]);
  assert.equal(manifest.content_scripts[0].css, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.equal(manifest.minimum_chrome_version, "114");
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.equal(manifest.options_page, "options.html");
  assert.equal(manifest.background.service_worker, "background.js");
  assert.deepEqual(manifest.icons, {
    16: "icons/icon16.png",
    32: "icons/icon32.png",
    48: "icons/icon48.png",
    128: "icons/icon128.png",
  });
  assert.deepEqual(manifest.action.default_icon, {
    16: "icons/icon16.png",
    32: "icons/icon32.png",
  });
  for (const file of [
    "icons/icon16.png",
    "icons/icon32.png",
    "icons/icon48.png",
    "icons/icon128.png",
    "collection-utils.js",
    "sidepanel.html",
    "sidepanel.js",
    "sidepanel.css",
  ]) {
    assert.ok(fs.existsSync(path.join(root, file)), `缺少 Side Panel 文件：${file}`);
  }
});

test("扩展头像提供 Chrome 所需的准确 PNG 尺寸", () => {
  for (const size of [16, 32, 48, 128]) {
    assert.deepEqual(
      readPngDimensions(path.join(root, "icons", `icon${size}.png`)),
      { width: size, height: size },
    );
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
  assert.match(harness, /defaultRecommendations/);
  assert.match(harness, /GET_DEFAULT_RECOMMENDATIONS/);
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

test("收藏 schema v2 只在最终 DOM 渲染限制数量", () => {
  const collections = fs.readFileSync(
    path.join(root, "collection-utils.js"),
    "utf8",
  );
  const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
  const sidepanel = fs.readFileSync(path.join(root, "sidepanel.js"), "utf8");
  assert.match(collections, /const CLIPPINGS_SCHEMA_VERSION = 2/);
  assert.match(collections, /function materializeLiveItems\(states\)/);
  assert.match(collections, /function buildClippingsView\(items\)/);
  assert.match(collections, /Tombstones are monotonic in schema v2/);
  assert.doesNotMatch(collections, /MAX_CLIPPINGS|normalizeClippingsStore/);
  assert.doesNotMatch(background, /limitReached|MAX_VISIBLE_CLIPPINGS/);
  assert.match(
    sidepanel,
    /matches\.slice\(\s*0,\s*SkimlineCollections\.MAX_VISIBLE_CLIPPINGS/,
  );
  assert.equal(
    sidepanel.match(/SkimlineCollections\.MAX_VISIBLE_CLIPPINGS/g)?.length,
    1,
  );
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
  assert.match(source, /type: "READ_PLAYER_CAPTION_TRACKS"/);
  assert.match(source, /fetchCaptionSegments\(track\)/);
  assert.match(source, /extractTranscriptFallback/);
  assert.match(source, /captionCache: new Map\(\)/);
  assert.match(source, /captionRequests: new Map\(\)/);
  assert.match(source, /videoTitle/);
  assert.match(source, /document\.title/);
  assert.doesNotMatch(source, /createElement\(["']script["']\)/);
  assert.doesNotMatch(source, /runtime\.getURL\(["']injected\.js["']\)/);
  assert.doesNotMatch(source, /window\.postMessage/);
  assert.doesNotMatch(source, /yvpm-trigger|createShell|TOGGLE_PANEL/);
  assert.doesNotMatch(source, /console\.info\([^\n]*带时间戳字幕/);
});

test("长视频文字记录优先读取已打开面板，再按需打开并关闭原生面板", () => {
  const transcript = fs.readFileSync(
    path.join(root, "transcript-utils.js"),
    "utf8",
  );
  const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
  assert.match(transcript, /timeoutMs = 30000/);
  assert.match(transcript, /ytd-transcript-segment-renderer/);
  assert.match(transcript, /transcript-segment-view-model/);
  assert.match(transcript, /\.segment-timestamp/);
  assert.match(transcript, /\.segment-text/);
  assert.match(transcript, /parseTranscriptDom\(documentRef\)/);
  assert.match(
    transcript,
    /if \(existingSegments\.length\) return existingSegments/,
  );
  assert.match(transcript, /findTranscriptOpenButton/);
  assert.match(transcript, /findDescriptionExpandButton/);
  assert.match(transcript, /waitForTranscriptOpenButton/);
  assert.match(content, /当前 player response 没有字幕轨道/);
  assert.match(content, /extractTranscriptFallback/);
  assert.match(
    transcript,
    /engagement-panel-searchable-transcript[\s\S]*\/close\|关闭\|關閉/,
  );
});

test("工具栏动作打开 Side Panel，不再切换页面浮层", () => {
  const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
  assert.match(background, /chrome\.sidePanel/);
  assert.match(background, /chrome\.scripting\.executeScript/);
  assert.match(background, /world: "MAIN"/);
  assert.match(background, /sender\?\.frameId !== 0/);
  assert.match(background, /READ_PLAYER_CAPTION_TRACKS/);
  assert.match(background, /result\.status === "player_unavailable"/);
  assert.doesNotMatch(background, /runtime\.getURL\(["']injected\.js["']\)/);
  assert.match(background, /setPanelBehavior/);
  assert.match(background, /openPanelOnActionClick: true/);
  assert.match(background, /summary\?\.videoId === message\.videoId/);
  assert.match(background, /message\?\.type === "MATCH_SUMMARY_INTENT"/);
  assert.match(background, /YouTubeSummary\.matchVideoIntent/);
  assert.match(background, /message\?\.type === "GET_DEFAULT_RECOMMENDATIONS"/);
  assert.match(background, /YouTubeSummary\.generateDefaultRecommendations/);
  assert.match(background, /message\?\.type === "EXPLAIN_VIDEO_SELECTION"/);
  assert.match(background, /YouTubeSummary\.explainVideoSelection/);
  assert.match(background, /message\?\.type === "CANCEL_CONTEXT_EXPLANATION"/);
  assert.match(background, /const explanationControllers = new Map\(\)/);
  assert.match(background, /importScripts\("generation-utils\.js", "collection-utils\.js"\)/);
  assert.match(background, /message\?\.type === "LIST_CLIPPINGS"/);
  assert.match(background, /message\?\.type === "SAVE_CLIPPING"/);
  assert.match(background, /message\?\.type === "DELETE_CLIPPING"/);
  assert.match(background, /message\?\.type === "RESTORE_CLIPPING"/);
  assert.match(background, /clippingMutationQueue/);
  assert.match(background, /YouTubeSummary\.summaryCacheKey/);
  assert.match(background, /generationId/);
  assert.match(background, /message\?\.type === "CANCEL_GENERATION"/);
  assert.match(background, /chrome\.tabs\.onRemoved\.addListener/);
  assert.match(background, /task\.subscriberTabIds\.delete\(tabId\)/);
  assert.match(background, /async function cancelTask/);
  assert.match(background, /MAX_CONCURRENT_GENERATIONS = 2/);
  assert.match(background, /const overviewJobs = new Map\(\)/);
  assert.match(background, /type: "OVERVIEW_STARTED"/);
  assert.match(background, /type: "OVERVIEW_COMPLETE"/);
  assert.match(background, /type: "OVERVIEW_FAILED"/);
  assert.match(background, /message\?\.type === "GENERATE_OVERVIEW"/);
  assert.match(background, /function attachGenerationAlias/);
  assert.match(background, /if \(task\?\.status === "error"\)/);
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
  assert.match(html, /id="yvpm-save-selection"/);
  assert.match(html, /id="yvpm-library-button"/);
  assert.match(html, /id="yvpm-library"/);
  assert.match(html, /id="yvpm-library-search"/);
  assert.match(html, /id="yvpm-library-export"/);
  assert.match(html, /id="yvpm-library-import"/);
  assert.match(html, /id="yvpm-library-import-file"/);
  assert.ok(
    html.indexOf('id="yvpm-explain-selection"') <
      html.indexOf('id="yvpm-save-selection"'),
  );
  assert.ok(
    html.indexOf('id="yvpm-save-selection"') <
      html.indexOf('id="yvpm-copy-selection"'),
  );
  assert.ok(
    html.indexOf('src="collection-utils.js"') <
      html.indexOf('src="sidepanel.js"'),
  );
  const css = fs.readFileSync(path.join(root, "sidepanel.css"), "utf8");
  assert.match(html, /id="yvpm-empty"/);
  assert.match(html, /id="yvpm-overview"/);
  assert.match(html, /id="yvpm-intent-form"/);
  assert.match(html, /id="yvpm-matchbar"/);
  assert.match(html, /id="yvpm-list-heading"/);
  assert.match(html, /id="yvpm-list-heading-title"/);
  assert.match(html, /id="yvpm-list-heading-meta"/);
  assert.match(html, /id="yvpm-progress"/);
  assert.match(html, /id="yvpm-language-menu"/);
  assert.match(html, /id="yvpm-prepare"/);
  assert.match(html, /id="yvpm-generation-bar"/);
  assert.match(html, /id="yvpm-overview-retry"/);
  assert.match(html, /id="yvpm-explain-menu"/);
  assert.match(html, /id="yvpm-explanation-scrim"/);
  assert.match(html, /id="yvpm-explanation-drawer"/);
  assert.match(html, /id="yvpm-explanation-composer"/);
  assert.match(html, /id="yvpm-explanation-latest"/);
  assert.match(html, /id="yvpm-explanation-body"[^>]*aria-live="polite"/);
  assert.doesNotMatch(html, />\s*展开解释\s*</);
  assert.match(html, /id="yvpm-countdown">6</);
  assert.match(html, /id="yvpm-overview"[^>]*aria-live="polite"/);
  assert.match(html, /打开一个 YouTube 视频即可生成观点地图/);
  assert.doesNotMatch(html, /<h1\b|yvpm-page-title/);
  assert.match(source, /chrome\.tabs\.query\(\{ active: true, currentWindow: true \}\)/);
  assert.match(source, /function createPointRow/);
  assert.match(source, /function setListHeading/);
  assert.match(source, /setListHeading\("关键章节", `\$\{groups\.length\} 个章节`\)/);
  assert.match(source, /type: "GET_CAPTION_SEGMENTS"/);
  assert.match(source, /type: "SEEK"/);
  assert.match(
    source,
    /async function seekWithFeedback\(t, \{ followPlayback = false \} = \{\}\)[\s\S]*?catch \(error\)[\s\S]*?showToast\(error\?\.message \|\| "视频跳转失败"\)/,
  );
  assert.equal(source.match(/seekWithFeedback\(/g)?.length, 4);
  assert.match(source, /message\?\.type === "PLAYBACK_TIME"/);
  assert.match(source, /message\?\.type === "VIDEO_CHANGED"/);
  assert.match(source, /switchToVideo\(message\.videoId/);
  assert.match(source, /YouTubeSummary\.getVideoId\(changeInfo\.url\)/);
  assert.match(source, /scrollIntoView\(\{ block: "nearest", behavior: "smooth" \}\)/);
  assert.match(source, /collapseExpandedRow\(row\)/);
  assert.match(source, /function setRowExpanded/);
  assert.match(source, /setRowExpanded\(row, expanding\)/);
  assert.match(source, /const DEFAULT_SECTIONS_COLLAPSED = true/);
  assert.match(source, /function createSectionView/);
  assert.match(
    source,
    /seekWithFeedback\(group\.points\[0\]\.t, \{ followPlayback: true \}\)/,
  );
  assert.match(source, /yvpm-section-current/);
  assert.match(source, /function setFollowPlayback/);
  assert.match(source, /followRequestId !== state\.followSeekRequestId/);
  assert.match(source, /forceFollow \|\| index !== state\.currentIndex/);
  assert.match(source, /renderSummary\(cached\.summary\)/);
  assert.match(
    source,
    /finalizeGeneratedSummary\(response\.summary, requestGenerationId\)/,
  );
  assert.match(source, /YouTubeSummary\.mergePointsByTimestamp/);
  assert.match(source, /YouTubeSummary\.pointStableKey\(state\.videoId, point\)/);
  assert.match(source, /receivedChunkIndexes\.size/);
  assert.match(source, /updateProgress\(message\.index, message\.total\)/);
  assert.match(source, /hideProgress\(\)/);
  assert.match(source, /function captureReadingAnchor/);
  assert.match(source, /YouTubeSummary\.findReadingAnchorRow/);
  assert.match(source, /function restoreReadingAnchor/);
  assert.match(source, /window\.scrollBy\(0, newTop - anchor\.top\)/);
  assert.match(source, /focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /function finalizeGeneratedSummary/);
  assert.match(source, /state\.finalizedGenerationId === finalizationKey/);
  assert.equal(source.match(/finalizeGeneratedSummary\(/g)?.length, 4);
  const finalizeBlock = source.slice(
    source.indexOf("function finalizeGeneratedSummary"),
    source.indexOf("function clearPoints"),
  );
  assert.ok(
    finalizeBlock.indexOf("captureReadingAnchor()") <
      finalizeBlock.indexOf("renderSummary(summary, { anchor })"),
  );
  assert.ok(
    finalizeBlock.indexOf("setGeneratingVisible(false)") <
      finalizeBlock.indexOf("restoreReadingAnchor(anchor, restoredRow)"),
  );
  assert.doesNotMatch(finalizeBlock, /requestAnimationFrame/);
  assert.match(source, /function showOverviewPlaceholder/);
  assert.match(source, /function hasResolvedOverview/);
  assert.match(source, /summary\?\.overview && !hasResolvedOverview\(\)/);
  assert.match(source, /message\?\.type === "SUMMARY_STRUCTURE_STARTED"/);
  assert.match(source, /yvpm-overview-arrive/);
  assert.match(source, /YouTubeSummary\.dedupePointsByTimestamp\(summary\?\.points\)/);
  assert.match(source, /function insightMapFromSummary/);
  assert.match(source, /function runRecommendation/);
  assert.match(source, /function runDefaultRecommendation/);
  assert.match(source, /function loadDefaultRecommendations/);
  assert.match(source, /function captureExplainableSelection/);
  assert.match(source, /function saveCurrentSelection/);
  assert.match(source, /function renderLibrary/);
  assert.match(source, /function createVideoGroup/);
  assert.match(source, /function populateVideoGroupBody/);
  assert.match(source, /function initializeLibraryExpansion/);
  assert.match(source, /function initializeVisibleLibraryExpansion/);
  assert.equal(source.match(/initializeVisibleLibraryExpansion\(\)/g)?.length, 4);
  assert.match(source, /function applyLibrarySearchTransition/);
  assert.match(source, /function reconcileLibraryExpansionState/);
  assert.match(source, /function deleteClippingById/);
  assert.match(source, /function restoreClippingItem/);
  assert.match(source, /function openClippingSource/);
  assert.match(source, /Number\(response\.revision\) < state\.clippingsRevision/);
  assert.match(source, /state\.activeView !== "summary"/);
  assert.match(source, /Promise\.resolve\(\)[\s\S]*?\.then\(onAction\)/);
  assert.match(source, /type: "SAVE_CLIPPING"/);
  assert.match(source, /type: "LIST_CLIPPINGS"/);
  assert.match(source, /type: "DELETE_CLIPPING"/);
  assert.match(source, /type: "RESTORE_CLIPPING"/);
  assert.match(source, /chrome\.storage\?\.onChanged\?\.addListener/);
  const renderLibraryBlock = source.slice(
    source.indexOf("function renderLibrary()"),
    source.indexOf("async function loadClippings"),
  );
  assert.match(renderLibraryBlock, /getLibraryGroups\(\)/);
  assert.match(source, /function getLibraryGroups[\s\S]*?groupClippingsByVideo/);
  assert.doesNotMatch(
    renderLibraryBlock,
    /libraryExpandedVideoIds\.(?:add|delete|clear)|initializeLibraryExpansion|applyLibrarySearchTransition|reconcileLibraryExpansionState/,
  );
  const createVideoGroupBlock = source.slice(
    source.indexOf("function createVideoGroup"),
    source.indexOf("function renderLibrary()"),
  );
  assert.match(
    createVideoGroupBlock,
    /if \(expanded\) populateVideoGroupBody\(body, group\)/,
  );
  assert.match(
    createVideoGroupBlock,
    /if \(nextExpanded\) populateVideoGroupBody\(body, group\)/,
  );
  assert.match(source, /loadClippings\(\{ render: false \}\)/);
  assert.match(source, /state\.libraryRequestId !== loadRequestId/);
  const saveSelectionBlock = source.slice(
    source.indexOf("async function saveCurrentSelection"),
    source.indexOf("async function copyExplanationSelection"),
  );
  assert.match(saveSelectionBlock, /type: "SAVE_CLIPPING"/);
  assert.doesNotMatch(
    saveSelectionBlock,
    /fetch\s*\(|EXPLAIN_VIDEO_SELECTION|getExplanationCaptions/,
  );
  assert.doesNotMatch(source, /innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/);
  assert.match(source, /function runInitialExplanation/);
  assert.match(source, /function askExplanation/);
  assert.match(source, /function handleActiveTabChanged/);
  assert.match(source, /function restoreExplanationTaskForVideo/);
  assert.match(source, /chrome\.tabs\.onRemoved\.addListener/);
  assert.match(source, /type: "START_CONTEXT_EXPLANATION"/);
  assert.match(source, /type: "ASK_CONTEXT_EXPLANATION"/);
  assert.match(source, /type: "GET_CONTEXT_EXPLANATION_TASK"/);
  assert.match(source, /type: "DISMISS_CONTEXT_EXPLANATION"/);
  assert.match(
    source,
    /if \(state\.explanationDismissed\)[\s\S]*?type: "DISMISS_CONTEXT_EXPLANATION"/,
  );
  assert.match(source, /type: "CANCEL_CONTEXT_EXPLANATION"/);
  assert.match(source, /type: "GET_CAPTION_SEGMENTS"/);
  assert.match(source, /MAX_EXPLANATION_SELECTION_CHARS = 200/);
  assert.match(source, /MAX_EXPLANATION_TURNS = 3/);
  assert.match(source, /type: "MATCH_SUMMARY_INTENT"/);
  assert.match(source, /type: "GET_DEFAULT_RECOMMENDATIONS"/);
  assert.match(source, /applyRecommendation\(intent, question\.pointTs, \{ source: "default" \}\)/);
  assert.match(source, /applyRecommendation\(intent, response\.pointTs, \{ source: "custom" \}\)/);
  assert.match(source, /clearRecommendation\(\{ restoreSections: true, clearInput: true \}\)/);
  assert.match(source, /targetLanguage: state\.targetLanguage/);
  assert.match(source, /sourceTabId: state\.tabId/);
  assert.match(source, /matchesGeneration\(message, state\.activeGenerationId\)/);
  assert.match(source, /function matchesGeneration/);
  assert.match(source, /message\.generationIds\.includes\(generationId\)/);
  assert.match(source, /PREPARE_COUNTDOWN_SECONDS = 6/);
  assert.match(source, /message\?\.type === "OVERVIEW_STARTED"/);
  assert.match(source, /message\?\.type === "OVERVIEW_COMPLETE"/);
  assert.match(source, /message\?\.type === "OVERVIEW_FAILED"/);
  assert.match(source, /type: "GENERATE_OVERVIEW"/);
  assert.match(source, /function retryOverview/);
  assert.match(source, /stopPrepareCountdown\(\)/);
  assert.match(source, /startPrepareCountdown\(\)/);
  assert.match(source, /if \(wasPreparing\) stopPrepareCountdown\(\)/);
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
  assert.match(css, /\.yvpm-intent-chip-placeholder/);
  assert.match(css, /\.yvpm-intent-chips-muted/);
  assert.match(css, /\.yvpm-matchbar/);
  assert.match(css, /\.yvpm-row\.yvpm-recommended/);
  assert.match(css, /\.yvpm-insight-card-header/);
  assert.match(css, /\.yvpm-explain-menu/);
  assert.match(css, /--adaptive-hover-fill: color-mix/);
  assert.match(
    css,
    /\.yvpm-explain-menu button:hover,[\s\S]*?background: var\(--adaptive-hover-fill\)/,
  );
  assert.match(css, /\.yvpm-explanation-drawer/);
  assert.match(css, /\.yvpm-explanation-scrim/);
  assert.match(css, /::highlight\(yvpm-explanation-selection\)/);
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

test("播放跟随是可见二态开关，并覆盖跨章节、推荐和 DOM 生命周期", () => {
  const html = fs.readFileSync(path.join(root, "sidepanel.html"), "utf8");
  const source = fs.readFileSync(path.join(root, "sidepanel.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "sidepanel.css"), "utf8");

  assert.match(html, /id="yvpm-follow-playback"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(css, /\.yvpm-follow-playback\[aria-pressed="true"\]/);

  assert.match(
    source,
    /seekWithFeedback\(point\.t, \{ followPlayback: true \}\)/,
  );
  assert.match(
    source,
    /seekWithFeedback\(group\.points\[0\]\.t, \{ followPlayback: true \}\)/,
  );
  assert.match(
    source,
    /elements\.followPlayback\.addEventListener\("click", \(\) => \{[\s\S]*?sync: !state\.followPlayback/,
  );

  const nowPlaying = source.slice(
    source.indexOf("function updateNowPlaying"),
    source.indexOf("function updatePointRow"),
  );
  assert.ok(
    nowPlaying.indexOf("setSectionExpanded(state.autoExpandedSection, false)") <
      nowPlaying.indexOf("setSectionExpanded(currentSection, true)"),
  );
  assert.ok(
    nowPlaying.indexOf("setSectionExpanded(currentSection, true)") <
      nowPlaying.indexOf("setRowExpanded(row, true)"),
  );
  assert.ok(
    nowPlaying.indexOf("setRowExpanded(row, true)") <
      nowPlaying.indexOf('classList.toggle("yvpm-now-playing"'),
  );
  assert.ok(
    nowPlaying.indexOf('classList.toggle("yvpm-now-playing"') <
      nowPlaying.indexOf("row.scrollIntoView"),
  );
  assert.match(nowPlaying, /!recommendationIsActive\(\)/);
  assert.match(nowPlaying, /row\.closest\("\.yvpm-section"\)/);

  const seekWithFeedback = source.slice(
    source.indexOf("async function seekWithFeedback"),
    source.indexOf("function resolveTargetLanguage"),
  );
  assert.match(seekWithFeedback, /\+\+state\.followSeekRequestId/);
  assert.match(
    seekWithFeedback,
    /if \(followRequestId !== state\.followSeekRequestId\) return/,
  );

  const defaultRecommendation = source.slice(
    source.indexOf("function runDefaultRecommendation"),
    source.indexOf("async function runRecommendation"),
  );
  const customRecommendation = source.slice(
    source.indexOf("async function runRecommendation"),
    source.indexOf("function showDefaultRecommendationLoading"),
  );
  assert.ok(
    defaultRecommendation.indexOf("setFollowPlayback(false)") <
      defaultRecommendation.indexOf("recommendationPreviousExpanded"),
  );
  assert.ok(
    customRecommendation.indexOf("setFollowPlayback(false)") <
      customRecommendation.indexOf("recommendationPreviousExpanded"),
  );

  const clearPoints = source.slice(
    source.indexOf("function clearPoints"),
    source.indexOf("function showEmpty"),
  );
  const openLibrary = source.slice(
    source.indexOf("function openLibrary"),
    source.indexOf("function closeLibrary"),
  );
  assert.match(clearPoints, /setFollowPlayback\(false\)/);
  assert.match(clearPoints, /state\.autoExpandedSection = null/);
  assert.match(openLibrary, /setFollowPlayback\(false\)/);
});
