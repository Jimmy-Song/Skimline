(function initCaptionUtils(root) {
  "use strict";

  function isTranslatedTrack(track) {
    if (!track || typeof track !== "object") return true;
    const url = String(track.baseUrl || "");
    const name = String(track.name?.simpleText || track.name?.runs?.[0]?.text || "");
    return (
      track.kind === "translated" ||
      /(?:[?&])tlang=/.test(url) ||
      /\btranslated\b|翻译|翻譯/i.test(name)
    );
  }

  function normalizeLanguage(languageCode) {
    return String(languageCode || "").trim().toLowerCase().replace("_", "-");
  }

  function languageMatches(trackLanguage, preferredLanguage) {
    const track = normalizeLanguage(trackLanguage);
    const preferred = normalizeLanguage(preferredLanguage);
    if (!track || !preferred) return false;
    return track === preferred || track.split("-")[0] === preferred.split("-")[0];
  }

  function selectCaptionTrack(tracks, preferredLanguage) {
    if (!Array.isArray(tracks)) return null;
    const candidates = tracks.filter(
      (track) => track?.baseUrl && track?.languageCode && !isTranslatedTrack(track),
    );
    if (!candidates.length) return null;

    // 先匹配视频原语言，再匹配英文；同语言下优先人工字幕，但保留 asr 作为有效轨道。
    const score = (track, index) => {
      let value = -index;
      if (languageMatches(track.languageCode, preferredLanguage)) value += 1000;
      if (normalizeLanguage(track.languageCode).split("-")[0] === "en") value += 500;
      if (track.kind !== "asr") value += 20;
      return value;
    };

    return candidates.reduce((best, track, index) => {
      const current = { track, score: score(track, index) };
      return !best || current.score > best.score ? current : best;
    }, null).track;
  }

  function buildJson3Url(baseUrl) {
    if (!baseUrl) throw new TypeError("字幕轨道缺少 baseUrl");
    const url = new URL(baseUrl);
    url.searchParams.set("fmt", "json3");
    return url.toString();
  }

  function parseJson3(payload) {
    if (!payload || !Array.isArray(payload.events)) return [];
    return payload.events.flatMap((event) => {
      if (!Array.isArray(event?.segs) || !Number.isFinite(Number(event.tStartMs))) return [];
      const text = event.segs.map((segment) => segment?.utf8 || "").join("").trim();
      return text ? [{ tMs: Number(event.tStartMs), text }] : [];
    });
  }

  async function fetchCaptionSegments(track, fetchImpl = fetch) {
    if (!track) throw new TypeError("没有可用的字幕轨道");
    const response = await fetchImpl(buildJson3Url(track.baseUrl), {
      credentials: "include",
    });
    if (!response.ok) throw new Error(`字幕请求失败（HTTP ${response.status}）`);
    if (typeof response.text === "function") {
      const body = await response.text();
      if (!body.trim()) return [];
      try {
        return parseJson3(JSON.parse(body));
      } catch {
        throw new Error("字幕响应不是有效 JSON");
      }
    }
    return parseJson3(await response.json());
  }

  const api = {
    buildJson3Url,
    fetchCaptionSegments,
    isTranslatedTrack,
    languageMatches,
    normalizeLanguage,
    parseJson3,
    selectCaptionTrack,
  };

  root.YouTubeSummary = Object.assign(root.YouTubeSummary || {}, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
