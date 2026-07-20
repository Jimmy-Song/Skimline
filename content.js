(function initializeYouTubeBridge() {
  "use strict";

  const MESSAGE_SOURCE = "youtube-viewpoint-map";
  const state = {
    videoId: YouTubeSummary.getVideoId(),
    videoElement: null,
    lastPlaybackSentAt: 0,
  };

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
      const requestId = `${Date.now()}:${Math.random()}`;
      const timeout = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("读取字幕信息超时，请重试"));
      }, 10000);

      function onMessage(event) {
        if (
          event.source !== window ||
          event.origin !== window.location.origin ||
          event.data?.source !== MESSAGE_SOURCE ||
          event.data?.type !== "CAPTION_TRACKS" ||
          event.data?.requestId !== requestId ||
          event.data?.videoId !== requestedVideoId
        ) {
          return;
        }
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve(event.data);
      }

      window.addEventListener("message", onMessage);
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("injected.js");
      script.dataset.yvpmRequestId = requestId;
      script.dataset.yvpmVideoId = requestedVideoId;
      script.onload = () => script.remove();
      script.onerror = () => {
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        reject(new Error("无法读取 YouTube 字幕信息"));
      };
      (document.head || document.documentElement).appendChild(script);
    });
  }

  function requestTranscriptFallback(requestedVideoId) {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}:${Math.random()}`;
      const timeout = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("读取 YouTube 文字记录超时，请重试"));
      }, 35000);

      function onMessage(event) {
        if (
          event.source !== window ||
          event.origin !== window.location.origin ||
          event.data?.source !== MESSAGE_SOURCE ||
          event.data?.type !== "TRANSCRIPT_FALLBACK_RESULT" ||
          event.data?.requestId !== requestId ||
          event.data?.videoId !== requestedVideoId
        ) {
          return;
        }
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.segments || []);
      }

      window.addEventListener("message", onMessage);
      window.postMessage(
        {
          source: MESSAGE_SOURCE,
          type: "REQUEST_TRANSCRIPT_FALLBACK",
          requestId,
          videoId: requestedVideoId,
        },
        window.location.origin,
      );
    });
  }

  async function getCaptionSegments(requestedVideoId) {
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
        segments = await requestTranscriptFallback(requestedVideoId);
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
    return {
      supported: true,
      videoId: requestedVideoId,
      duration: Number.isFinite(video?.duration) ? Math.floor(video.duration) : 0,
      sourceLang: track?.languageCode || captionInfo.sourceLang || "",
      segments,
    };
  }

  function getVideoState() {
    const video = document.querySelector("video");
    const videoId = YouTubeSummary.getVideoId();
    return {
      videoId,
      duration: Number.isFinite(video?.duration) ? Math.floor(video.duration) : 0,
      currentTime: Number.isFinite(video?.currentTime) ? video.currentTime : 0,
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
      notify({ type: "VIDEO_CHANGED", videoId: nextVideoId });
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
