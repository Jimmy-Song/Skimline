(function initUiUtils(root) {
  "use strict";

  function getVideoId(url = root.location?.href || "") {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      return (hostname === "youtube.com" || hostname.endsWith(".youtube.com")) &&
        parsed.pathname === "/watch"
        ? parsed.searchParams.get("v") || ""
        : "";
    } catch {
      return "";
    }
  }

  async function seekVideo(video, seconds) {
    if (!video) throw new Error("未找到视频播放器");
    video.currentTime = Math.max(0, Number(seconds) || 0);
    try {
      await video.play();
    } catch {
      // 浏览器可能因自动播放策略拒绝；时间跳转仍然有效。
    }
  }

  function pointIdentity(point) {
    return `${Number(point?.t) || 0}:${String(point?.point || "")}`;
  }

  function pointQuality(point) {
    return String(point?.detail || "").trim().length * 2 +
      String(point?.point || "").trim().length;
  }

  function dedupePointsByTimestamp(points) {
    const byTimestamp = new Map();
    for (const point of (points || [])
      .filter((item) => Number.isFinite(Number(item?.t)))
      .slice()
      .sort((a, b) => Number(a.t) - Number(b.t))) {
      const timestamp = Math.max(0, Math.floor(Number(point.t)));
      const normalized = { ...point, t: timestamp };
      const existing = byTimestamp.get(timestamp);
      if (!existing || pointQuality(normalized) > pointQuality(existing)) {
        byTimestamp.set(timestamp, normalized);
      }
    }
    return [...byTimestamp.values()].sort((a, b) => a.t - b.t);
  }

  function mergePointsByTimestamp(currentPoints, incomingPoints) {
    return dedupePointsByTimestamp([
      ...(currentPoints || []),
      ...(incomingPoints || []),
    ]);
  }

  function pointStableKey(videoId, point) {
    const timestamp = Math.max(0, Math.floor(Number(point?.t) || 0));
    return `${String(videoId || "")}:${timestamp}`;
  }

  function reconcileRowOrder(container, rows) {
    let cursor = container.firstChild;
    for (const row of rows) {
      if (row === cursor) {
        cursor = row.nextSibling;
        continue;
      }
      container.insertBefore(row, cursor);
    }
  }

  function findReadingAnchorRow(
    rows,
    expandedRow,
    viewportTop = 0,
    viewportBottom = root.innerHeight || 0,
  ) {
    const visibleRows = [];
    for (const row of rows || []) {
      const rect = row?.getBoundingClientRect?.();
      if (!rect || rect.bottom <= viewportTop || rect.top >= viewportBottom) {
        continue;
      }
      visibleRows.push({ row, top: rect.top });
    }
    const visibleExpanded = visibleRows.find(
      (entry) => entry.row === expandedRow,
    );
    if (visibleExpanded) return visibleExpanded.row;
    visibleRows.sort((a, b) => a.top - b.top);
    return visibleRows[0]?.row || null;
  }

  function formatTimestamp(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  function sameLocalDate(a, b) {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }

  function formatLibraryDate(timestamp, now = Date.now()) {
    const date = new Date(Number(timestamp));
    const current = new Date(Number(now));
    if (
      !Number.isFinite(date.getTime()) ||
      !Number.isFinite(current.getTime())
    ) {
      return "";
    }
    if (sameLocalDate(date, current)) return "今天";
    const yesterday = new Date(
      current.getFullYear(),
      current.getMonth(),
      current.getDate() - 1,
    );
    if (sameLocalDate(date, yesterday)) return "昨天";
    const monthAndDay = `${date.getMonth() + 1}月${date.getDate()}日`;
    return date.getFullYear() === current.getFullYear()
      ? monthAndDay
      : `${date.getFullYear()}年${monthAndDay}`;
  }

  function normalizeLibraryQuery(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  }

  function normalizePointQueryText(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function isAsciiAlphaNumeric(character) {
    return Boolean(character) && /[a-z0-9]/.test(character);
  }

  function countPointQueryToken(text, token) {
    if (!text || !token) return 0;
    // v1 没有关键词高亮：拉丁数字词优先避免 code → codex 这类不可见误报。
    // 高亮或实时预览落地后，应根据实际查询行为重新评估前缀匹配。
    const requiresWordBoundary = /^[a-z0-9]+$/.test(token);
    let count = 0;
    let offset = 0;
    while (offset <= text.length - token.length) {
      const index = text.indexOf(token, offset);
      if (index < 0) break;
      const before = index > 0 ? text[index - 1] : "";
      const after = text[index + token.length] || "";
      if (
        !requiresWordBoundary ||
        (!isAsciiAlphaNumeric(before) && !isAsciiAlphaNumeric(after))
      ) {
        count += 1;
      }
      offset = index + Math.max(1, token.length);
    }
    return count;
  }

  function rankPointsByQuery(points, rawQuery) {
    const query = normalizePointQueryText(rawQuery);
    if (!query) return [];
    const tokens = [...new Set(query.split(" ").filter(Boolean))];
    if (!tokens.length) return [];

    return (points || [])
      .filter((point) => Number.isFinite(Number(point?.t)))
      .map((point) => {
        const pointText = normalizePointQueryText(point?.point);
        const detailText = normalizePointQueryText(point?.detail);
        const tokenMatches = tokens.map((token) => ({
          pointCount: countPointQueryToken(pointText, token),
          detailCount: countPointQueryToken(detailText, token),
        }));
        if (
          tokenMatches.some(
            ({ pointCount, detailCount }) => pointCount + detailCount === 0,
          )
        ) {
          return null;
        }
        return {
          t: Math.max(0, Math.floor(Number(point.t))),
          score: tokenMatches.reduce(
            (total, { pointCount, detailCount }) =>
              total + pointCount * 3 + detailCount,
            0,
          ),
          allTermsInPoint: tokenMatches.every(
            ({ pointCount }) => pointCount > 0,
          ),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.t - b.t);
  }

  function transitionLibrarySearchExpansion(
    {
      expandedVideoIds,
      expansionBeforeSearch = null,
      previousQuery = "",
    },
    nextRawQuery,
    matchedVideoIds = [],
  ) {
    const previous = normalizeLibraryQuery(previousQuery);
    const next = normalizeLibraryQuery(nextRawQuery);
    let expanded = new Set(expandedVideoIds || []);
    let beforeSearch =
      expansionBeforeSearch === null
        ? null
        : new Set(expansionBeforeSearch || []);

    if (previous !== next) {
      if (!previous && next) beforeSearch = new Set(expanded);
      if (next) {
        for (const videoId of matchedVideoIds || []) {
          if (videoId) expanded.add(String(videoId));
        }
      } else if (previous) {
        expanded = new Set(beforeSearch || []);
        beforeSearch = null;
      }
    }

    return {
      expandedVideoIds: expanded,
      expansionBeforeSearch: beforeSearch,
      query: next,
    };
  }

  function reconcileLibraryExpansion(
    expandedVideoIds,
    expansionBeforeSearch,
    validVideoIds,
  ) {
    const valid = new Set(validVideoIds || []);
    const filterValid = (values) =>
      new Set([...new Set(values || [])].filter((videoId) => valid.has(videoId)));
    return {
      expandedVideoIds: filterValid(expandedVideoIds),
      expansionBeforeSearch:
        expansionBeforeSearch === null
          ? null
          : filterValid(expansionBeforeSearch),
    };
  }

  function normalizeTextScale(
    value,
    { min = 85, max = 125, defaultValue = 100 } = {},
  ) {
    const lower = Math.min(Number(min), Number(max));
    const upper = Math.max(Number(min), Number(max));
    const fallback = Number.isFinite(Number(defaultValue))
      ? Number(defaultValue)
      : 100;
    if (
      value === null ||
      value === undefined ||
      (typeof value === "string" && !value.trim())
    ) {
      return Math.min(upper, Math.max(lower, Math.round(fallback)));
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return Math.min(upper, Math.max(lower, Math.round(fallback)));
    }
    return Math.min(upper, Math.max(lower, Math.round(parsed)));
  }

  function groupPointsBySections(points, sections) {
    const sortedPoints = (points || [])
      .slice()
      .sort((a, b) => Number(a.t) - Number(b.t));
    const seenStarts = new Set();
    const groups = (sections || [])
      .filter(
        (section) =>
          section &&
          section.title &&
          Number.isFinite(Number(section.startT)),
      )
      .map((section) => ({
        title: String(section.title),
        startT: Math.max(0, Math.floor(Number(section.startT))),
        points: [],
      }))
      .sort((a, b) => a.startT - b.startT)
      .filter((section) => {
        if (seenStarts.has(section.startT)) return false;
        seenStarts.add(section.startT);
        return true;
      });
    if (!sortedPoints.length || !groups.length) return [];

    for (const point of sortedPoints) {
      let groupIndex = 0;
      for (let index = 1; index < groups.length; index += 1) {
        if (groups[index].startT <= Number(point.t)) groupIndex = index;
        else break;
      }
      groups[groupIndex].points.push(point);
    }

    return groups
      .filter((group) => group.points.length)
      .map((group) => {
        const firstT = Number(group.points[0].t) || 0;
        const lastT = Number(group.points[group.points.length - 1].t) || firstT;
        const startLabel = formatTimestamp(firstT);
        const endLabel = formatTimestamp(lastT);
        return {
          ...group,
          startLabel,
          endLabel,
          rangeLabel:
            firstT === lastT ? startLabel : `${startLabel}–${endLabel}`,
        };
      });
  }

  function findCurrentPointIndex(points, currentTime) {
    const time = Number(currentTime);
    if (!Number.isFinite(time)) return -1;
    let current = -1;
    for (let index = 0; index < (points || []).length; index += 1) {
      if (Number(points[index]?.t) <= time) current = index;
      else break;
    }
    return current;
  }

  function findCurrentSectionIndex(groups, currentTime) {
    if (!(groups || []).length) return -1;
    const time = Number(currentTime);
    if (!Number.isFinite(time) || time < 0) return -1;
    let current = 0;
    for (let index = 1; index < groups.length; index += 1) {
      if (Number(groups[index]?.startT) <= time) current = index;
      else break;
    }
    return current;
  }

  function createTabPlaybackSnapshots() {
    const snapshots = new Map();

    return {
      save(tabId, videoId, snapshot = {}) {
        const normalizedVideoId = String(videoId || "");
        if (!Number.isInteger(tabId) || !normalizedVideoId) return null;
        const saved = {
          videoId: normalizedVideoId,
          followPlayback: Boolean(snapshot.followPlayback),
          anchor: snapshot.anchor || null,
        };
        snapshots.set(tabId, saved);
        return saved;
      },

      get(tabId, videoId) {
        if (!Number.isInteger(tabId)) return null;
        const saved = snapshots.get(tabId) || null;
        if (!saved) return null;
        if (saved.videoId !== String(videoId || "")) {
          snapshots.delete(tabId);
          return null;
        }
        return saved;
      },

      remove(tabId) {
        return snapshots.delete(tabId);
      },
    };
  }

  function playbackTimeOr(currentTime, fallback = 0) {
    const time = Number(currentTime);
    return Number.isFinite(time) ? Math.max(0, time) : fallback;
  }

  const api = {
    createTabPlaybackSnapshots,
    dedupePointsByTimestamp,
    findReadingAnchorRow,
    findCurrentPointIndex,
    findCurrentSectionIndex,
    formatLibraryDate,
    formatTimestamp,
    getVideoId,
    groupPointsBySections,
    mergePointsByTimestamp,
    normalizeTextScale,
    playbackTimeOr,
    pointIdentity,
    pointStableKey,
    rankPointsByQuery,
    reconcileLibraryExpansion,
    reconcileRowOrder,
    seekVideo,
    transitionLibrarySearchExpansion,
  };
  root.YouTubeSummary = Object.assign(root.YouTubeSummary || {}, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
