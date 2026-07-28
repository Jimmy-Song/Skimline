(function initUiUtils(root) {
  "use strict";

  function getVideoId(url = root.location?.href || "") {
    try {
      const parsed = new URL(url);
      return parsed.hostname.endsWith("youtube.com") && parsed.pathname === "/watch"
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

  function formatTimestamp(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
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

  const api = {
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
  };
  root.YouTubeSummary = Object.assign(root.YouTubeSummary || {}, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
