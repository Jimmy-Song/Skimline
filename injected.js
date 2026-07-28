(function initializePageBridge(root) {
  "use strict";

  const MESSAGE_SOURCE = "youtube-viewpoint-map";
  const TRANSCRIPT_SEGMENT_SELECTOR =
    "transcript-segment-view-model, ytd-transcript-segment-renderer";
  const TRANSCRIPT_TIME_SELECTOR =
    ".ytwTranscriptSegmentViewModelTimestamp, .segment-timestamp, [class*='Timestamp']";
  const TRANSCRIPT_TEXT_SELECTOR =
    "span[role='text'], .segment-text, [class*='SegmentText']";

  function parseTimestampLabel(label) {
    const parts = String(label || "")
      .trim()
      .split(":")
      .map(Number);
    if (
      parts.length < 2 ||
      parts.length > 3 ||
      parts.some((part) => !Number.isFinite(part) || part < 0)
    ) {
      return null;
    }
    const seconds = parts.reduce((total, part) => total * 60 + part, 0);
    return Math.round(seconds * 1000);
  }

  function parseTranscriptEntries(entries) {
    return (Array.isArray(entries) ? entries : []).flatMap((entry) => {
      const tMs = parseTimestampLabel(entry?.timeLabel);
      const text = String(entry?.text || "").trim();
      return tMs === null || !text ? [] : [{ tMs, text }];
    });
  }

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function extractTimestampFromText(text) {
    const match = normalizeText(text).match(/(?:^|\s)(\d{1,2}:\d{2}(?::\d{2})?)(?:\s|$)/);
    return match?.[1] || "";
  }

  function removeLeadingTimestamp(text, timeLabel) {
    const normalized = normalizeText(text);
    if (!timeLabel) return normalized;
    return normalized.replace(new RegExp(`^${timeLabel.replace(/:/g, "\\:")}\\s*`), "").trim();
  }

  function parseTranscriptSegment(segment) {
    const rawText = normalizeText(segment?.textContent || "");
    const timeLabel =
      normalizeText(segment?.querySelector?.(TRANSCRIPT_TIME_SELECTOR)?.textContent) ||
      extractTimestampFromText(rawText);
    const explicitText = normalizeText(
      segment?.querySelector?.(TRANSCRIPT_TEXT_SELECTOR)?.textContent,
    );
    return {
      timeLabel,
      text: explicitText || removeLeadingTimestamp(rawText, timeLabel),
    };
  }

  function transcriptSegmentIsReadable(segment) {
    const rects = segment?.getClientRects?.();
    return !rects || rects.length > 0;
  }

  function parseTranscriptDom(documentRef) {
    const entries = Array.from(
      documentRef.querySelectorAll(TRANSCRIPT_SEGMENT_SELECTOR),
    )
      .filter(transcriptSegmentIsReadable)
      .map(parseTranscriptSegment);
    return parseTranscriptEntries(entries);
  }

  function getVideoIdFromUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname.endsWith("youtube.com") &&
        parsed.pathname === "/watch"
        ? parsed.searchParams.get("v") || ""
        : "";
    } catch {
      return "";
    }
  }

  function parsePlayerResponse(value) {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function selectMatchingPlayerResponse(candidates, videoId) {
    for (const candidate of candidates || []) {
      const response = parsePlayerResponse(candidate);
      if (response?.videoDetails?.videoId === videoId) return response;
    }
    return null;
  }

  function assertCurrentVideo(videoId) {
    if (getVideoIdFromUrl(root.location?.href) !== videoId) {
      throw new Error("视频已切换，已取消旧字幕请求");
    }
  }

  function transcriptPanelIsReady(documentRef) {
    return parseTranscriptDom(documentRef).length > 0;
  }

  function waitForTranscriptDom(documentRef, timeoutMs = 30000) {
    const existing = parseTranscriptDom(documentRef);
    if (existing.length) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timeout = root.setTimeout(() => {
        observer.disconnect();
        reject(new Error("读取 YouTube 文字记录超时"));
      }, timeoutMs);
      const observer = new MutationObserver(() => {
        const segments = parseTranscriptDom(documentRef);
        if (!segments.length) return;
        root.clearTimeout(timeout);
        observer.disconnect();
        resolve(segments);
      });
      observer.observe(documentRef.documentElement, {
        childList: true,
        subtree: true,
      });
    });
  }

  function closeTranscriptPanel(documentRef) {
    const panel =
      documentRef.querySelector(
        'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
      ) ||
      documentRef.querySelector(
        'ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]',
      );
    if (!panel) return;

    const closeButton = Array.from(panel.querySelectorAll("button")).find(
      (button) =>
        /close|关闭/i.test(
          `${button.getAttribute("aria-label") || ""} ${
            button.getAttribute("title") || ""
          }`,
        ),
    );
    (
      closeButton ||
      panel.querySelector(
        "ytd-engagement-panel-title-header-renderer button, #visibility-button button",
      )
    )?.click();
  }

  async function extractTranscriptFallback(videoId) {
    assertCurrentVideo(videoId);
    const documentRef = root.document;

    const existingSegments = parseTranscriptDom(documentRef);
    if (existingSegments.length) return existingSegments;

    const openButton = documentRef.querySelector(
      "ytd-video-description-transcript-section-renderer button",
    );
    if (!openButton) throw new Error("当前视频没有可读取的文字记录");

    // YouTube 新版可能让 timedtext 返回空体；隐藏其原生面板，读取后立即关闭。
    const hidingStyle = documentRef.createElement("style");
    hidingStyle.textContent =
      'ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]{visibility:hidden!important}';
    documentRef.documentElement.appendChild(hidingStyle);
    try {
      assertCurrentVideo(videoId);
      openButton.click();
      const segments = await waitForTranscriptDom(documentRef);
      assertCurrentVideo(videoId);
      return segments;
    } finally {
      closeTranscriptPanel(documentRef);
      hidingStyle.remove();
    }
  }

  function readCurrentPlayerResponse() {
    try {
      return root.document
        ?.getElementById("movie_player")
        ?.getPlayerResponse?.();
    } catch {
      return null;
    }
  }

  function findPlayerResponse(videoId) {
    return selectMatchingPlayerResponse(
      [
        readCurrentPlayerResponse(),
        root.ytplayer?.config?.args?.player_response,
        root.ytInitialPlayerResponse,
      ],
      videoId,
    );
  }

  function waitForPlayerResponse(videoId, timeoutMs = 5000) {
    const startedAt = Date.now();
    return new Promise((resolve) => {
      function check() {
        const response = findPlayerResponse(videoId);
        if (response || Date.now() - startedAt >= timeoutMs) {
          resolve(response);
          return;
        }
        root.setTimeout(check, 100);
      }
      check();
    });
  }

  async function postCaptionTracks(requestId, videoId) {
    const response = await waitForPlayerResponse(videoId);
    const renderer = response?.captions?.playerCaptionsTracklistRenderer;
    const sourceLang =
      response?.videoDetails?.defaultAudioLanguage ||
      response?.microformat?.playerMicroformatRenderer?.audioLanguage ||
      renderer?.audioTracks?.[
        renderer.defaultAudioTrackIndex || 0
      ]?.audioTrackId?.split(".")[0] ||
      "";

    root.postMessage(
      {
        source: MESSAGE_SOURCE,
        type: "CAPTION_TRACKS",
        requestId,
        videoId,
        matchedVideo: Boolean(response),
        tracks: Array.isArray(renderer?.captionTracks)
          ? renderer.captionTracks
          : [],
        sourceLang,
      },
      root.location.origin,
    );
  }

  const api = {
    getVideoIdFromUrl,
    parseTimestampLabel,
    parseTranscriptDom,
    parseTranscriptEntries,
    parseTranscriptSegment,
    transcriptSegmentIsReadable,
    selectMatchingPlayerResponse,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (!root?.document || !root?.location) return;

  if (!root.__yvpmTranscriptFallbackInstalled) {
    root.__yvpmTranscriptFallbackInstalled = true;
    const pendingFallbackByVideoId = new Map();
    root.addEventListener("message", async (event) => {
      if (
        event.source !== root ||
        event.origin !== root.location.origin ||
        event.data?.source !== MESSAGE_SOURCE ||
        event.data?.type !== "REQUEST_TRANSCRIPT_FALLBACK"
      ) {
        return;
      }
      const videoId = String(event.data.videoId || "");
      try {
        assertCurrentVideo(videoId);
        if (!pendingFallbackByVideoId.has(videoId)) {
          const pending = extractTranscriptFallback(videoId).finally(() => {
            pendingFallbackByVideoId.delete(videoId);
          });
          pendingFallbackByVideoId.set(videoId, pending);
        }
        const segments = await pendingFallbackByVideoId.get(videoId);
        assertCurrentVideo(videoId);
        root.postMessage(
          {
            source: MESSAGE_SOURCE,
            type: "TRANSCRIPT_FALLBACK_RESULT",
            requestId: event.data.requestId,
            videoId,
            segments,
          },
          root.location.origin,
        );
      } catch (error) {
        root.postMessage(
          {
            source: MESSAGE_SOURCE,
            type: "TRANSCRIPT_FALLBACK_RESULT",
            requestId: event.data.requestId,
            videoId,
            error: error?.message || "无法读取 YouTube 文字记录",
            segments: [],
          },
          root.location.origin,
        );
      }
    });
  }

  const currentScript = root.document.currentScript;
  const requestId = currentScript?.dataset?.yvpmRequestId || "";
  const requestedVideoId =
    currentScript?.dataset?.yvpmVideoId ||
    getVideoIdFromUrl(root.location.href);
  postCaptionTracks(requestId, requestedVideoId);
})(typeof window !== "undefined" ? window : globalThis);
