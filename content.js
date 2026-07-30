(function initializeYouTubeBridge() {
  "use strict";

  const MESSAGE_SOURCE = "youtube-viewpoint-map";
  const state = {
    videoId: YouTubeSummary.getVideoId(),
    videoElement: null,
    lastPlaybackSentAt: 0,
    captionCache: new Map(),
    captionRequests: new Map(),
  };
  const MAX_CACHED_CAPTION_VIDEOS = 3;

  function notify(message) {
    try {
      chrome.runtime.sendMessage(message, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // 扩展重载时页面里的旧内容脚本可能短暂失去运行时连接。
    }
  }

  function assertCurrentVideo(videoId) {
    if (YouTubeSummary.getVideoId() !== videoId) {
      throw new Error("视频已切换，已取消旧字幕请求");
    }
  }

  function requestCaptionTracks(requestedVideoId) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback();
      };
      timeout = setTimeout(() => {
        finish(() => reject(new Error("读取字幕信息超时，请重试")));
      }, 10000);
      chrome.runtime.sendMessage(
        {
          source: MESSAGE_SOURCE,
          type: "READ_PLAYER_CAPTION_TRACKS",
          videoId: requestedVideoId,
        },
        (response) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            finish(() =>
              reject(new Error(runtimeError.message || "读取字幕信息失败")),
            );
            return;
          }
          if (!response?.ok) {
            finish(() =>
              reject(
                new Error(
                  response?.error || "无法读取 YouTube 播放器字幕信息",
                ),
              ),
            );
            return;
          }
          finish(() => resolve(response));
        },
      );
    });
  }

  function rememberCaptionResult(videoId, result) {
    if (!result?.supported || !result.segments?.length) return;
    state.captionCache.delete(videoId);
    state.captionCache.set(videoId, result);
    while (state.captionCache.size > MAX_CACHED_CAPTION_VIDEOS) {
      state.captionCache.delete(state.captionCache.keys().next().value);
    }
  }

  async function loadCaptionSegments(requestedVideoId) {
    assertCurrentVideo(requestedVideoId);
    const captionInfo = await requestCaptionTracks(requestedVideoId);
    assertCurrentVideo(requestedVideoId);
    if (captionInfo.videoId !== requestedVideoId) {
      throw new Error("字幕来源与当前视频不一致");
    }
    const track = YouTubeSummary.selectCaptionTrack(
      captionInfo.tracks,
      captionInfo.sourceLang,
    );

    let segments = [];
    try {
      if (!track) throw new Error("当前 player response 没有字幕轨道");
      segments = await YouTubeSummary.fetchCaptionSegments(track);
    } catch (error) {
      console.warn(
        "[Skimline] timedtext 不可用，改用页面文字记录",
        error?.message || error,
      );
    }
    assertCurrentVideo(requestedVideoId);
    if (!segments.length) {
      try {
        segments = await YouTubeSummary.extractTranscriptFallback(
          requestedVideoId,
        );
      } catch (error) {
        if (
          !track &&
          captionInfo.matchedVideo &&
          /没有可读取的文字记录/.test(error?.message || "")
        ) {
          return { supported: false, videoId: requestedVideoId, segments: [] };
        }
        throw error;
      }
    }
    assertCurrentVideo(requestedVideoId);
    if (!segments.length) throw new Error("字幕内容为空，暂时无法生成");

    console.info("[Skimline] 带时间戳字幕", segments);
    const video = document.querySelector("video");
    const result = {
      supported: true,
      videoId: requestedVideoId,
      duration: Number.isFinite(video?.duration) ? Math.floor(video.duration) : 0,
      sourceLang: track?.languageCode || captionInfo.sourceLang || "",
      segments,
    };
    rememberCaptionResult(requestedVideoId, result);
    return result;
  }

  async function getCaptionSegments(requestedVideoId) {
    assertCurrentVideo(requestedVideoId);
    const cached = state.captionCache.get(requestedVideoId);
    if (cached) {
      state.captionCache.delete(requestedVideoId);
      state.captionCache.set(requestedVideoId, cached);
      return Promise.resolve(cached);
    }
    if (state.captionRequests.has(requestedVideoId)) {
      return state.captionRequests.get(requestedVideoId);
    }
    const pending = loadCaptionSegments(requestedVideoId).finally(() => {
      if (state.captionRequests.get(requestedVideoId) === pending) {
        state.captionRequests.delete(requestedVideoId);
      }
    });
    state.captionRequests.set(requestedVideoId, pending);
    return pending;
  }

  function getVideoState() {
    const video = document.querySelector("video");
    const videoId = YouTubeSummary.getVideoId();
    const videoTitle = String(document.title || "")
      .replace(/\s*-\s*YouTube\s*$/i, "")
      .trim();
    return {
      videoId,
      duration: Number.isFinite(video?.duration) ? Math.floor(video.duration) : 0,
      currentTime: Number.isFinite(video?.currentTime) ? video.currentTime : 0,
      videoTitle,
    };
  }

  function reportPlayback(force = false) {
    const video = state.videoElement;
    if (!video || !state.videoId) return;
    const now = Date.now();
    if (!force && now - state.lastPlaybackSentAt < 500) return;
    state.lastPlaybackSentAt = now;
    notify({
      type: "PLAYBACK_TIME",
      videoId: state.videoId,
      currentTime: Number(video.currentTime) || 0,
    });
  }

  function ensureVideoListener() {
    const video = document.querySelector("video");
    if (video === state.videoElement) return;
    state.videoElement?.removeEventListener("timeupdate", reportPlayback);
    state.videoElement = video;
    state.videoElement?.addEventListener("timeupdate", reportPlayback);
    reportPlayback(true);
  }

  function detectNavigation() {
    const nextVideoId = YouTubeSummary.getVideoId();
    if (nextVideoId !== state.videoId) {
      state.videoId = nextVideoId;
      const videoTitle = String(document.title || "")
        .replace(/\s*-\s*YouTube\s*$/i, "")
        .trim();
      notify({ type: "VIDEO_CHANGED", videoId: nextVideoId, videoTitle });
    }
    ensureVideoListener();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GET_VIDEO_STATE") {
      sendResponse({ ok: true, ...getVideoState() });
      return false;
    }

    if (message?.type === "GET_CAPTION_SEGMENTS") {
      const requestedVideoId = String(message.videoId || "");
      getCaptionSegments(requestedVideoId)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error?.message || "无法读取 YouTube 字幕",
          });
        });
      return true;
    }

    if (message?.type === "SEEK") {
      YouTubeSummary.seekVideo(document.querySelector("video"), message.t)
        .then(() => {
          reportPlayback(true);
          sendResponse({ ok: true });
        })
        .catch((error) => {
          sendResponse({ ok: false, error: error?.message || "视频跳转失败" });
        });
      return true;
    }

    return false;
  });

  document.addEventListener("yt-navigate-finish", detectNavigation);
  setInterval(detectNavigation, 1000);
  ensureVideoListener();
})();
