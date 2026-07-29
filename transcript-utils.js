(function initTranscriptUtils(root) {
  "use strict";

  const TRANSCRIPT_SEGMENT_SELECTOR =
    "transcript-segment-view-model, ytd-transcript-segment-renderer";
  const TRANSCRIPT_TIME_SELECTOR =
    ".ytwTranscriptSegmentViewModelTimestamp, .segment-timestamp, [class*='Timestamp']";
  const TRANSCRIPT_TEXT_SELECTOR =
    "span[role='text'], .segment-text, [class*='SegmentText']";
  const TRANSCRIPT_PANEL_SELECTOR =
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]';
  const TRANSCRIPT_BUTTON_SELECTORS = [
    "ytd-video-description-transcript-section-renderer button",
    'button[aria-label*="transcript" i]',
    'button[title*="transcript" i]',
    "#description button",
    "ytd-watch-metadata button",
  ];
  const TRANSCRIPT_BUTTON_LABEL =
    /transcript|transkrip|transcri|文字记录|内容转文字|文字稿|逐字稿|文字起こし|스크립트/i;
  const DESCRIPTION_EXPAND_SELECTORS = [
    "#description-inline-expander #expand",
    "#description #expand",
    "ytd-text-inline-expander #expand",
    "#description-inline-expander button",
    "#description button",
  ];
  const DESCRIPTION_EXPAND_LABEL =
    /(?:^|\s)(?:\.\.\.)?(?:show\s+more|more|更多|展开|展開|もっと見る|더보기)(?:\s|$)/i;
  const pendingTranscriptFallbacks = new Map();

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
    const match = normalizeText(text).match(
      /(?:^|\s)(\d{1,2}:\d{2}(?::\d{2})?)(?:\s|$)/,
    );
    return match?.[1] || "";
  }

  function removeLeadingTimestamp(text, timeLabel) {
    const normalized = normalizeText(text);
    if (!timeLabel) return normalized;
    return normalized
      .replace(new RegExp(`^${timeLabel.replace(/:/g, "\\:")}\\s*`), "")
      .trim();
  }

  function parseTranscriptSegment(segment) {
    const rawText = normalizeText(segment?.textContent || "");
    const timeLabel =
      normalizeText(
        segment?.querySelector?.(TRANSCRIPT_TIME_SELECTOR)?.textContent,
      ) || extractTimestampFromText(rawText);
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
    const segments = Array.from(
      documentRef.querySelectorAll(TRANSCRIPT_SEGMENT_SELECTOR),
    );
    const leafSegments = segments.filter(
      (segment) => !segment.querySelector?.(TRANSCRIPT_SEGMENT_SELECTOR),
    );
    const entries = (leafSegments.length ? leafSegments : segments)
      .filter(transcriptSegmentIsReadable)
      .map(parseTranscriptSegment);
    const seen = new Set();
    return parseTranscriptEntries(entries).filter((entry) => {
      const key = `${entry.tMs}\n${entry.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function getVideoIdFromUrl(url) {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      return (hostname === "youtube.com" ||
        hostname.endsWith(".youtube.com")) &&
        parsed.pathname === "/watch"
        ? parsed.searchParams.get("v") || ""
        : "";
    } catch {
      return "";
    }
  }

  function assertCurrentVideo(videoId, rootRef = root) {
    if (getVideoIdFromUrl(rootRef.location?.href) !== videoId) {
      throw new Error("视频已切换，已取消旧字幕请求");
    }
  }

  function waitForTranscriptDom(documentRef, rootRef = root, timeoutMs = 30000) {
    const existing = parseTranscriptDom(documentRef);
    if (existing.length) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const Observer = rootRef.MutationObserver || MutationObserver;
      const observer = new Observer(() => {
        const segments = parseTranscriptDom(documentRef);
        if (!segments.length) return;
        rootRef.clearTimeout(timeout);
        observer.disconnect();
        resolve(segments);
      });
      const timeout = rootRef.setTimeout(() => {
        observer.disconnect();
        reject(new Error("读取 YouTube 文字记录超时"));
      }, timeoutMs);
      observer.observe(documentRef.documentElement, {
        childList: true,
        subtree: true,
      });
    });
  }

  function buttonIsUsable(button) {
    return Boolean(
      button?.isConnected !== false &&
        !button?.disabled &&
        button?.getAttribute?.("aria-disabled") !== "true",
    );
  }

  function buttonLabel(button) {
    return normalizeText(
      `${button?.getAttribute?.("aria-label") || ""} ${
        button?.getAttribute?.("title") || ""
      } ${button?.textContent || ""}`,
    );
  }

  function findTranscriptOpenButton(documentRef) {
    const candidates = [];
    const seen = new Set();
    for (const selector of TRANSCRIPT_BUTTON_SELECTORS) {
      for (const button of documentRef.querySelectorAll(selector)) {
        if (seen.has(button) || !buttonIsUsable(button)) continue;
        seen.add(button);
        if (
          selector.startsWith("ytd-video-description") ||
          TRANSCRIPT_BUTTON_LABEL.test(buttonLabel(button))
        ) {
          candidates.push(button);
        }
      }
    }
    return (
      candidates.find((button) => button.getClientRects?.().length > 0) || null
    );
  }

  function findDescriptionExpandButton(documentRef) {
    const seen = new Set();
    for (const selector of DESCRIPTION_EXPAND_SELECTORS) {
      for (const button of documentRef.querySelectorAll(selector)) {
        if (
          seen.has(button) ||
          !buttonIsUsable(button) ||
          button.getClientRects?.().length === 0
        ) {
          continue;
        }
        seen.add(button);
        if (
          selector.endsWith("#expand") ||
          DESCRIPTION_EXPAND_LABEL.test(buttonLabel(button))
        ) {
          return button;
        }
      }
    }
    return null;
  }

  function waitForTranscriptOpenButton(
    documentRef,
    rootRef = root,
    timeoutMs = 3000,
  ) {
    const existing = findTranscriptOpenButton(documentRef);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const check = () => {
        const button = findTranscriptOpenButton(documentRef);
        if (button || Date.now() - startedAt >= timeoutMs) {
          resolve(button || null);
          return;
        }
        rootRef.setTimeout(check, 50);
      };
      check();
    });
  }

  function closeTranscriptPanel(documentRef) {
    const panel =
      documentRef.querySelector(TRANSCRIPT_PANEL_SELECTOR) ||
      documentRef
        .querySelector(TRANSCRIPT_SEGMENT_SELECTOR)
        ?.closest?.("ytd-engagement-panel-section-list-renderer");
    if (!panel) return;

    const closeButton = Array.from(panel.querySelectorAll("button")).find(
      (button) =>
        /close|关闭|關閉|閉じる|닫기/i.test(
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

  async function extractTranscriptFallbackOnce(
    videoId,
    rootRef = root,
    timeoutMs = 30000,
  ) {
    assertCurrentVideo(videoId, rootRef);
    const documentRef = rootRef.document;
    const existingSegments = parseTranscriptDom(documentRef);
    if (existingSegments.length) return existingSegments;

    const existingPanel = documentRef.querySelector(TRANSCRIPT_PANEL_SELECTOR);
    if (
      existingPanel &&
      (existingPanel.getAttribute?.("visibility") ===
        "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED" ||
        existingPanel.getClientRects?.().length > 0)
    ) {
      return waitForTranscriptDom(documentRef, rootRef, timeoutMs);
    }

    let openButton = findTranscriptOpenButton(documentRef);
    if (!openButton) {
      const expandButton = findDescriptionExpandButton(documentRef);
      if (expandButton) {
        expandButton.click();
        openButton = await waitForTranscriptOpenButton(
          documentRef,
          rootRef,
          Math.min(3000, timeoutMs),
        );
      }
    }
    if (!openButton) throw new Error("当前视频没有可读取的文字记录");

    const hidingStyle = documentRef.createElement("style");
    hidingStyle.textContent =
      `${TRANSCRIPT_PANEL_SELECTOR},` +
      `ytd-engagement-panel-section-list-renderer:has(${TRANSCRIPT_SEGMENT_SELECTOR})` +
      "{visibility:hidden!important}";
    documentRef.documentElement.appendChild(hidingStyle);
    try {
      assertCurrentVideo(videoId, rootRef);
      openButton.click();
      const segments = await waitForTranscriptDom(
        documentRef,
        rootRef,
        timeoutMs,
      );
      assertCurrentVideo(videoId, rootRef);
      return segments;
    } finally {
      closeTranscriptPanel(documentRef);
      hidingStyle.remove();
    }
  }

  function extractTranscriptFallback(
    videoId,
    rootRef = root,
    timeoutMs = 30000,
  ) {
    if (pendingTranscriptFallbacks.has(videoId)) {
      return pendingTranscriptFallbacks.get(videoId);
    }
    const pending = extractTranscriptFallbackOnce(
      videoId,
      rootRef,
      timeoutMs,
    ).finally(() => {
      if (pendingTranscriptFallbacks.get(videoId) === pending) {
        pendingTranscriptFallbacks.delete(videoId);
      }
    });
    pendingTranscriptFallbacks.set(videoId, pending);
    return pending;
  }

  const api = {
    extractTranscriptFallback,
    findDescriptionExpandButton,
    findTranscriptOpenButton,
    getVideoIdFromUrl,
    parseTimestampLabel,
    parseTranscriptDom,
    parseTranscriptEntries,
    parseTranscriptSegment,
    transcriptSegmentIsReadable,
  };

  root.YouTubeSummary = Object.assign(root.YouTubeSummary || {}, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
