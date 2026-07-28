"use strict";

importScripts("generation-utils.js");

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const MAX_CONCURRENT_GENERATIONS = 2;
const TASK_TTL_MS = 24 * 60 * 60 * 1000;
const CONTENT_MESSAGE_SOURCE = "youtube-viewpoint-map";
const activeGenerations = new Map();
const taskRecords = new Map();
const queuedTaskKeys = [];
const overviewJobs = new Map();
const explanationControllers = new Map();

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

function taskKeyFor(videoId, targetLanguage) {
  return [
    "summary-task",
    videoId,
    targetLanguage,
    YouTubeSummary.SUMMARY_SCHEMA_VERSION,
    YouTubeSummary.SUMMARY_PROMPT_VERSION,
  ].join(":");
}

function taskStorageKey(taskKey) {
  return `task:${taskKey}`;
}

function overviewJobKey(videoId, targetLanguage) {
  return YouTubeSummary.overviewCacheKey(videoId, targetLanguage);
}

function serializeTask(task) {
  return {
    taskKey: task.taskKey,
    videoId: task.videoId,
    targetLanguage: task.targetLanguage,
    generationId: task.generationId,
    status: task.status,
    sourceLang: task.sourceLang,
    duration: task.duration,
    points: task.points,
    receivedChunkIndexes: [...task.receivedChunkIndexes],
    totalChunks: task.totalChunks,
    nextChunkIndex: task.nextChunkIndex,
    overviewStatus: task.overviewStatus || "pending",
    overview: task.overview || "",
    overviewError: task.overviewError || "",
    subscriberTabIds: [...task.subscriberTabIds],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

async function persistTask(task) {
  task.updatedAt = Date.now();
  await chrome.storage.local.set({
    [taskStorageKey(task.taskKey)]: serializeTask(task),
  });
}

async function removeTask(task) {
  taskRecords.delete(task.taskKey);
  const queuedIndex = queuedTaskKeys.indexOf(task.taskKey);
  if (queuedIndex >= 0) queuedTaskKeys.splice(queuedIndex, 1);
  await chrome.storage.local.remove(taskStorageKey(task.taskKey));
}

function taskFromStored(stored) {
  if (!stored?.taskKey || !stored?.videoId || !stored?.targetLanguage) return null;
  if (Date.now() - Number(stored.updatedAt || 0) > TASK_TTL_MS) return null;
  return {
    ...stored,
    status:
      stored.status === "queued"
        ? "queued"
        : stored.status === "error"
          ? "error"
          : "running",
    points: YouTubeSummary.dedupePointsByTimestamp(stored.points || []),
    receivedChunkIndexes: new Set(stored.receivedChunkIndexes || []),
    totalChunks: Number(stored.totalChunks) || 0,
    nextChunkIndex: Math.max(0, Number(stored.nextChunkIndex) || 0),
    overviewStatus: String(stored.overviewStatus || "pending"),
    overview: String(stored.overview || ""),
    overviewError: String(stored.overviewError || ""),
    subscriberTabIds: new Set(stored.subscriberTabIds || []),
    generationIds: new Set([String(stored.generationId || "")].filter(Boolean)),
    controller: null,
    promise: null,
    resolve: null,
    reject: null,
    resumedAfterRestart: true,
  };
}

async function broadcast(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
    // Side Panel 关闭不影响任务继续。
  }
}

function attachOverviewSubscriber(job, tabId) {
  if (Number.isInteger(tabId)) job.subscriberTabIds.add(tabId);
}

function attachGenerationAlias(target, generationId) {
  const alias = String(generationId || "");
  if (alias) target.generationIds.add(alias);
}

function generationAliases(target) {
  return [...(target.generationIds || [])];
}

async function updateTaskOverview(job, updates) {
  const task = taskRecords.get(
    taskKeyFor(job.videoId, job.targetLanguage),
  );
  if (!task || task.generationId !== job.generationId || task.cancelled) return;
  Object.assign(task, updates);
  try {
    await persistTask(task);
  } catch {
    // 独立概览缓存是权威来源；任务快照写入失败不能反转已成功的概览。
  }
}

async function startOrAttachOverview(payload, fallbackGenerationId = "") {
  const videoId = String(payload?.videoId || "");
  const targetLanguage = YouTubeSummary.normalizeSummaryLanguage(
    payload?.targetLanguage,
  );
  const key = overviewJobKey(videoId, targetLanguage);
  const cached = await YouTubeSummary.getCachedOverview(
    videoId,
    targetLanguage,
    chrome.storage.local,
  );
  if (cached) {
    return {
      key,
      videoId,
      targetLanguage,
      generationId: String(payload?.generationId || fallbackGenerationId),
      cached: true,
      promise: Promise.resolve(cached),
      subscriberTabIds: new Set(),
    };
  }

  let job = overviewJobs.get(key);
  if (job) {
    attachOverviewSubscriber(job, payload?.sourceTabId);
    attachGenerationAlias(job, payload?.generationId);
    return job;
  }

  const generationId = String(
    payload?.generationId || fallbackGenerationId || `${key}:${Date.now()}`,
  );
  job = {
    key,
    videoId,
    targetLanguage,
    generationId,
    generationIds: new Set([generationId]),
    subscriberTabIds: new Set(),
    controller: new AbortController(),
    cancelled: false,
    promise: null,
  };
  attachOverviewSubscriber(job, payload?.sourceTabId);
  const relatedTask = taskRecords.get(taskKeyFor(videoId, targetLanguage));
  for (const tabId of relatedTask?.subscriberTabIds || []) {
    attachOverviewSubscriber(job, tabId);
  }
  overviewJobs.set(key, job);
  job.promise = (async () => {
    await updateTaskOverview(job, {
      overviewStatus: "running",
      overviewError: "",
    });
    await broadcast({
      type: "OVERVIEW_STARTED",
      videoId,
      generationId,
      generationIds: generationAliases(job),
      targetLanguage,
    });
    try {
      const { deepseek_api_key: apiKey } = await chrome.storage.local.get(
        "deepseek_api_key",
      );
      const result = await YouTubeSummary.generateOverview(
        {
          videoId,
          targetLanguage,
          segments: payload?.segments,
        },
        {
          apiKey,
          baseUrl: DEFAULT_BASE_URL,
          storage: chrome.storage.local,
          signal: job.controller.signal,
        },
      );
      if (job.cancelled || job.controller.signal.aborted) {
        throw new Error("摘要生成已取消");
      }
      await updateTaskOverview(job, {
        overviewStatus: "complete",
        overview: result.overview,
        overviewError: "",
      });
      await broadcast({
        type: "OVERVIEW_COMPLETE",
        videoId,
        generationId,
        generationIds: generationAliases(job),
        targetLanguage,
        overview: result.overview,
      });
      return result;
    } catch (error) {
      if (job.cancelled || job.controller.signal.aborted) throw error;
      const message = error?.message || "概览生成失败，请重试";
      await updateTaskOverview(job, {
        overviewStatus: "failed",
        overviewError: message,
      });
      await broadcast({
        type: "OVERVIEW_FAILED",
        videoId,
        generationId,
        generationIds: generationAliases(job),
        targetLanguage,
        error: message,
      });
      throw error;
    } finally {
      if (overviewJobs.get(key) === job) overviewJobs.delete(key);
    }
  })();
  return job;
}

async function detachOverviewSubscriber(videoId, targetLanguage, tabId) {
  if (!Number.isInteger(tabId)) return;
  const key = overviewJobKey(videoId, targetLanguage);
  const job = overviewJobs.get(key);
  if (!job) return;
  job.subscriberTabIds.delete(tabId);
  if (job.subscriberTabIds.size === 0) {
    job.cancelled = true;
    job.controller.abort();
    overviewJobs.delete(key);
  }
}

async function sendChunk(task, chunk) {
  task.points = YouTubeSummary.dedupePointsByTimestamp([
    ...task.points,
    ...(chunk.points || []),
  ]);
  task.receivedChunkIndexes.add(chunk.index);
  task.totalChunks = Number(chunk.total) || task.totalChunks;
  task.nextChunkIndex = Math.max(task.nextChunkIndex, Number(chunk.index) + 1);
  await persistTask(task);
  await broadcast({
    type: "SUMMARY_CHUNK",
    videoId: task.videoId,
    generationId: task.generationId,
    generationIds: generationAliases(task),
    targetLanguage: task.targetLanguage,
    ...chunk,
  });
}

async function sendStructureStarted(task, structure) {
  task.status = "structuring";
  await persistTask(task);
  await broadcast({
    type: "SUMMARY_STRUCTURE_STARTED",
    videoId: task.videoId,
    generationId: task.generationId,
    generationIds: generationAliases(task),
    targetLanguage: task.targetLanguage,
    ...structure,
  });
}

function taskSnapshot(task, { active = false, needsResume = false } = {}) {
  return {
    ...serializeTask(task),
    active,
    needsResume,
  };
}

function attachTab(task, tabId) {
  if (!Number.isInteger(tabId)) return;
  task.subscriberTabIds.add(tabId);
  const overviewJob = overviewJobs.get(
    overviewJobKey(task.videoId, task.targetLanguage),
  );
  if (overviewJob) attachOverviewSubscriber(overviewJob, tabId);
}

function attachTaskGeneration(task, generationId) {
  attachGenerationAlias(task, generationId);
  const overviewJob = overviewJobs.get(
    overviewJobKey(task.videoId, task.targetLanguage),
  );
  if (overviewJob) attachGenerationAlias(overviewJob, generationId);
}

async function cancelTask(task, reason = "cancelled") {
  if (!task) return;
  task.cancelled = true;
  task.controller?.abort();
  activeGenerations.delete(task.taskKey);
  if (task.reject) task.reject(new Error(reason));
  await removeTask(task);
  dispatchQueuedTasks();
}

async function detachTab(task, tabId) {
  if (!task || !Number.isInteger(tabId)) return;
  task.subscriberTabIds.delete(tabId);
  await detachOverviewSubscriber(task.videoId, task.targetLanguage, tabId);
  if (task.subscriberTabIds.size === 0) {
    await cancelTask(task, "已不再需要此摘要任务");
  } else {
    await persistTask(task);
  }
}

function createTask(payload) {
  const videoId = String(payload.videoId || "");
  const targetLanguage = YouTubeSummary.normalizeSummaryLanguage(
    payload.targetLanguage,
  );
  const taskKey = taskKeyFor(videoId, targetLanguage);
  let resolve;
  let reject;
  const task = {
    taskKey,
    videoId,
    targetLanguage,
    generationId: String(payload.generationId || `${taskKey}:${Date.now()}`),
    generationIds: new Set(),
    status: "queued",
    sourceLang: String(payload.sourceLang || ""),
    duration: Number(payload.duration) || 0,
    points: [],
    receivedChunkIndexes: new Set(),
    totalChunks: 0,
    nextChunkIndex: 0,
    overviewStatus: "pending",
    overview: "",
    overviewError: "",
    subscriberTabIds: new Set(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    controller: null,
    promise: new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    }),
    resolve,
    reject,
    payload,
  };
  attachTaskGeneration(task, task.generationId);
  attachTab(task, payload.sourceTabId);
  return task;
}

function ensureTaskPromise(task, payload) {
  if (task.promise) return;
  let resolve;
  let reject;
  task.promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  task.resolve = resolve;
  task.reject = reject;
  task.payload = payload;
  task.sourceLang = String(payload.sourceLang || task.sourceLang || "");
  task.duration = Number(payload.duration) || task.duration || 0;
  task.status = "queued";
  task.resumedAfterRestart = false;
}

async function runTask(task) {
  if (task.cancelled || activeGenerations.has(task.taskKey)) return;
  task.status = "running";
  task.controller = new AbortController();
  activeGenerations.set(task.taskKey, task);
  await persistTask(task);
  await broadcast({
    type: "SUMMARY_STARTED",
    videoId: task.videoId,
    generationId: task.generationId,
    generationIds: generationAliases(task),
    targetLanguage: task.targetLanguage,
  });
  let mapSucceeded = false;
  const overviewPromise = startOrAttachOverview(
    {
      ...task.payload,
      videoId: task.videoId,
      generationId: task.generationId,
      generationIds: generationAliases(task),
      targetLanguage: task.targetLanguage,
    },
    task.generationId,
  )
    .then((job) => job.promise)
    .catch(() => null);
  try {
    const { deepseek_api_key: apiKey } = await chrome.storage.local.get(
      "deepseek_api_key",
    );
    const result = await YouTubeSummary.summarizeVideo(
      {
        ...task.payload,
        videoId: task.videoId,
        targetLanguage: task.targetLanguage,
        resume: {
          points: task.points,
          nextChunkIndex: task.nextChunkIndex,
        },
      },
      {
        apiKey,
        baseUrl: DEFAULT_BASE_URL,
        storage: chrome.storage.local,
        signal: task.controller.signal,
        onChunk: (chunk) => sendChunk(task, chunk),
        onStructureStart: (structure) => sendStructureStarted(task, structure),
      },
    );
    if (task.cancelled) return;
    mapSucceeded = true;
    task.status = "complete";
    task.resolve?.(result);
    await broadcast({
      type: "SUMMARY_COMPLETE",
      videoId: task.videoId,
      generationId: task.generationId,
      generationIds: generationAliases(task),
      targetLanguage: task.targetLanguage,
      summary: result.summary,
    });
  } catch (error) {
    if (task.cancelled || task.controller.signal.aborted) return;
    task.status = "error";
    task.error = error?.message || "生成失败，请重试";
    task.reject?.(new Error(task.error));
    await persistTask(task);
    await broadcast({
      type: "SUMMARY_FAILED",
      videoId: task.videoId,
      generationId: task.generationId,
      generationIds: generationAliases(task),
      targetLanguage: task.targetLanguage,
      error: task.error,
    });
  } finally {
    await overviewPromise;
    if (mapSucceeded && !task.cancelled) await removeTask(task);
    activeGenerations.delete(task.taskKey);
    task.controller = null;
    dispatchQueuedTasks();
  }
}

function launchTask(task) {
  void runTask(task).catch(async (error) => {
    activeGenerations.delete(task.taskKey);
    task.controller?.abort();
    task.controller = null;
    if (!task.cancelled && task.status !== "complete" && task.status !== "error") {
      task.status = "error";
      task.error = error?.message || "生成失败，请重试";
      task.reject?.(new Error(task.error));
      try {
        await persistTask(task);
      } catch {
        // 存储异常不能再产生未处理的 Promise rejection。
      }
      await broadcast({
        type: "SUMMARY_FAILED",
        videoId: task.videoId,
        generationId: task.generationId,
        generationIds: generationAliases(task),
        targetLanguage: task.targetLanguage,
        error: task.error,
      });
    }
    dispatchQueuedTasks();
  });
}

function dispatchQueuedTasks() {
  while (
    activeGenerations.size < MAX_CONCURRENT_GENERATIONS &&
    queuedTaskKeys.length
  ) {
    const taskKey = queuedTaskKeys.shift();
    const task = taskRecords.get(taskKey);
    if (task && !task.cancelled) launchTask(task);
  }
}

async function startOrAttachTask(payload) {
  const videoId = String(payload.videoId || "");
  const targetLanguage = YouTubeSummary.normalizeSummaryLanguage(
    payload.targetLanguage,
  );
  const taskKey = taskKeyFor(videoId, targetLanguage);
  let task = taskRecords.get(taskKey);
  if (task?.status === "error") {
    await removeTask(task);
    task = null;
  }
  if (task) {
    attachTaskGeneration(task, payload.generationId);
    attachTab(task, payload.sourceTabId);
    ensureTaskPromise(task, { ...payload, generationId: task.generationId });
    await persistTask(task);
    if (!activeGenerations.has(taskKey) && !queuedTaskKeys.includes(taskKey)) {
      if (activeGenerations.size < MAX_CONCURRENT_GENERATIONS) launchTask(task);
      else {
        queuedTaskKeys.push(taskKey);
        await broadcast({
          type: "SUMMARY_QUEUED",
          videoId: task.videoId,
          generationId: task.generationId,
          generationIds: generationAliases(task),
          targetLanguage: task.targetLanguage,
        });
      }
    }
    return task;
  }
  task = createTask({ ...payload, targetLanguage });
  taskRecords.set(taskKey, task);
  await persistTask(task);
  if (
    !activeGenerations.has(taskKey) &&
    activeGenerations.size < MAX_CONCURRENT_GENERATIONS
  ) {
    launchTask(task);
  } else {
    queuedTaskKeys.push(taskKey);
    await broadcast({
      type: "SUMMARY_QUEUED",
      videoId: task.videoId,
      generationId: task.generationId,
      generationIds: generationAliases(task),
      targetLanguage: task.targetLanguage,
    });
  }
  return task;
}

async function getTaskStatus(message) {
  const targetLanguage = YouTubeSummary.normalizeSummaryLanguage(
    message.targetLanguage,
  );
  const taskKey = taskKeyFor(String(message.videoId || ""), targetLanguage);
  let task = taskRecords.get(taskKey);
  if (task) {
    if (task.status === "error") {
      await removeTask(task);
      return null;
    }
    attachTab(task, message.tabId);
    await persistTask(task);
    return taskSnapshot(task, { active: activeGenerations.has(taskKey) });
  }
  const stored = (await chrome.storage.local.get(taskStorageKey(taskKey)))[
    taskStorageKey(taskKey)
  ];
  task = taskFromStored(stored);
  if (!task || task.status === "error") {
    if (stored) await chrome.storage.local.remove(taskStorageKey(taskKey));
    return null;
  }
  attachTab(task, message.tabId);
  taskRecords.set(taskKey, task);
  await persistTask(task);
  return taskSnapshot(task, { needsResume: true });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  (async () => {
    const known = [...taskRecords.values()];
    const storedTasks = await chrome.storage.local.get(null);
    for (const [key, stored] of Object.entries(storedTasks)) {
      if (!key.startsWith("task:summary-task:")) continue;
      const task = taskFromStored(stored);
      if (task && !taskRecords.has(task.taskKey)) {
        taskRecords.set(task.taskKey, task);
        known.push(task);
      }
    }
    for (const task of known) {
      if (task.subscriberTabIds.has(tabId)) await detachTab(task, tabId);
    }
    for (const job of [...overviewJobs.values()]) {
      if (job.subscriberTabIds.has(tabId)) {
        await detachOverviewSubscriber(job.videoId, job.targetLanguage, tabId);
      }
    }
  })().catch(() => {});
});

function readPlayerCaptionTracksInMainWorld(requestedVideoId) {
  const getVideoId = () => {
    try {
      const parsed = new URL(location.href);
      const hostname = parsed.hostname.toLowerCase();
      return (hostname === "youtube.com" ||
        hostname.endsWith(".youtube.com")) &&
        parsed.pathname === "/watch"
        ? parsed.searchParams.get("v") || ""
        : "";
    } catch {
      return "";
    }
  };
  const parseResponse = (value) => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };
  const currentResponse = () => {
    const candidates = [];
    try {
      candidates.push(
        document.getElementById("movie_player")?.getPlayerResponse?.(),
      );
    } catch {
      // 播放器实验可能暂时不暴露方法，继续尝试其他官方响应入口。
    }
    candidates.push(
      globalThis.ytplayer?.config?.args?.player_response,
      globalThis.ytInitialPlayerResponse,
    );
    for (const candidate of candidates) {
      const response = parseResponse(candidate);
      if (response?.videoDetails?.videoId === requestedVideoId) return response;
    }
    return null;
  };
  const sanitizeTrack = (track) => {
    try {
      if (!track || typeof track !== "object") return null;
      const baseUrl = new URL(String(track.baseUrl || ""));
      const hostname = baseUrl.hostname.toLowerCase();
      if (
        baseUrl.protocol !== "https:" ||
        (hostname !== "youtube.com" && !hostname.endsWith(".youtube.com"))
      ) {
        return null;
      }
      const languageCode = String(track.languageCode || "").slice(0, 64);
      if (!languageCode) return null;
      const name = String(
        track.name?.simpleText ||
          (Array.isArray(track.name?.runs)
            ? track.name.runs.map((run) => run?.text || "").join("")
            : "") ||
          "",
      ).slice(0, 200);
      return {
        baseUrl: baseUrl.toString(),
        languageCode,
        kind: String(track.kind || "").slice(0, 32),
        name: { simpleText: name },
        vssId: String(track.vssId || "").slice(0, 128),
      };
    } catch {
      return null;
    }
  };

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      try {
        const currentVideoId = getVideoId();
        if (currentVideoId !== requestedVideoId) {
          resolve({
            status: "video_changed",
            videoId: currentVideoId,
            matchedVideo: false,
            tracks: [],
            rawTrackCount: 0,
            sourceLang: "",
          });
          return;
        }
        const response = currentResponse();
        if (response) {
          const renderer =
            response?.captions?.playerCaptionsTracklistRenderer || null;
          const rawTracks = Array.isArray(renderer?.captionTracks)
            ? renderer.captionTracks.slice(0, 100)
            : [];
          const tracks = rawTracks.map(sanitizeTrack).filter(Boolean);
          const sourceLang =
            response?.videoDetails?.defaultAudioLanguage ||
            response?.microformat?.playerMicroformatRenderer?.audioLanguage ||
            renderer?.audioTracks?.[
              renderer.defaultAudioTrackIndex || 0
            ]?.audioTrackId?.split(".")[0] ||
            "";
          resolve({
            status: "ok",
            videoId: requestedVideoId,
            matchedVideo: true,
            tracks,
            rawTrackCount: rawTracks.length,
            sourceLang: String(sourceLang).slice(0, 64),
          });
          return;
        }
        if (Date.now() - startedAt >= 5000) {
          resolve({
            status: "player_unavailable",
            videoId: requestedVideoId,
            matchedVideo: false,
            tracks: [],
            rawTrackCount: 0,
            sourceLang: "",
          });
          return;
        }
        setTimeout(check, 100);
      } catch {
        resolve({
          status: "player_error",
          videoId: requestedVideoId,
          matchedVideo: false,
          tracks: [],
          rawTrackCount: 0,
          sourceLang: "",
        });
      }
    };
    check();
  });
}

async function readPlayerCaptionTracks(message, sender) {
  const requestedVideoId = String(message?.videoId || "").trim();
  const tabId = sender?.tab?.id;
  if (
    message?.source !== CONTENT_MESSAGE_SOURCE ||
    !requestedVideoId ||
    !Number.isInteger(tabId) ||
    sender?.frameId !== 0
  ) {
    throw new Error("字幕请求来源无效，请刷新 YouTube 页面后重试");
  }

  let senderUrl;
  try {
    senderUrl = new URL(String(sender.url || sender.tab?.url || ""));
  } catch {
    throw new Error("无法确认当前 YouTube 视频页面");
  }
  const senderHostname = senderUrl.hostname.toLowerCase();
  if (
    (senderHostname !== "youtube.com" &&
      !senderHostname.endsWith(".youtube.com")) ||
    senderUrl.pathname !== "/watch" ||
    senderUrl.searchParams.get("v") !== requestedVideoId
  ) {
    throw new Error("视频已切换，已取消旧字幕请求");
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world: "MAIN",
    func: readPlayerCaptionTracksInMainWorld,
    args: [requestedVideoId],
  });
  const result = results?.find((entry) => entry.frameId === 0)?.result;
  if (
    !result ||
    result.status === "player_unavailable" ||
    result.status === "player_error"
  ) {
    throw new Error("未能读取当前视频的播放器数据，请刷新页面后重试");
  }
  if (
    result.status === "video_changed" ||
    result.videoId !== requestedVideoId
  ) {
    throw new Error("视频已切换，已取消旧字幕请求");
  }
  if (!result.matchedVideo) {
    throw new Error("播放器返回了不匹配的视频数据，请刷新页面后重试");
  }
  if (result.rawTrackCount > 0 && !result.tracks?.length) {
    throw new Error("YouTube 返回了无法验证的字幕轨道，请刷新页面后重试");
  }
  return {
    videoId: requestedVideoId,
    matchedVideo: true,
    tracks: Array.isArray(result.tracks) ? result.tracks : [],
    sourceLang: String(result.sourceLang || ""),
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "READ_PLAYER_CAPTION_TRACKS") {
    readPlayerCaptionTracks(message, sender)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || "读取 YouTube 播放器字幕信息失败",
        }),
      );
    return true;
  }

  if (message?.type === "GET_API_KEY_STATUS") {
    chrome.storage.local
      .get("deepseek_api_key")
      .then((result) => sendResponse({ ok: true, configured: Boolean(result.deepseek_api_key) }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "读取设置失败" }));
    return true;
  }

  if (message?.type === "GET_CACHED_SUMMARY") {
    const targetLanguage = YouTubeSummary.normalizeSummaryLanguage(message.targetLanguage);
    const key = YouTubeSummary.summaryCacheKey(message.videoId, targetLanguage);
    chrome.storage.local.get(key).then((result) => {
      const summary = result[key];
      sendResponse({
        ok: true,
        summary: summary?.videoId === message.videoId &&
          YouTubeSummary.normalizeSummaryLanguage(summary?.targetLanguage) === targetLanguage &&
          summary?.schemaVersion === YouTubeSummary.SUMMARY_SCHEMA_VERSION &&
          summary?.promptVersion === YouTubeSummary.SUMMARY_PROMPT_VERSION ? summary : null,
      });
    }).catch((error) => sendResponse({ ok: false, error: error?.message || "读取缓存失败" }));
    return true;
  }

  if (message?.type === "GET_CACHED_OVERVIEW") {
    const targetLanguage = YouTubeSummary.normalizeSummaryLanguage(
      message.targetLanguage,
    );
    YouTubeSummary.getCachedOverview(
      String(message.videoId || ""),
      targetLanguage,
      chrome.storage.local,
    )
      .then((overview) => sendResponse({ ok: true, overview }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || "读取概览缓存失败",
        }),
      );
    return true;
  }

  if (message?.type === "GET_SUMMARY_TASK") {
    getTaskStatus(message)
      .then((task) => sendResponse({ ok: true, task }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "读取任务失败" }));
    return true;
  }

  if (message?.type === "CANCEL_GENERATION") {
    const targetLanguage = YouTubeSummary.normalizeSummaryLanguage(message.targetLanguage);
    const task = taskRecords.get(taskKeyFor(message.videoId, targetLanguage));
    (task
      ? detachTab(task, message.tabId)
      : detachOverviewSubscriber(
          message.videoId,
          targetLanguage,
          message.tabId,
        )
    ).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "GENERATE_OVERVIEW") {
    startOrAttachOverview(message.payload, message.payload?.generationId)
      .then(async (job) => {
        const result = await job.promise;
        sendResponse({
          ok: true,
          generationId: job.generationId,
          targetLanguage: job.targetLanguage,
          overview: result.overview,
          cached: Boolean(result.cached),
        });
      })
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || "概览生成失败，请重试",
        }),
      );
    return true;
  }

  if (message?.type === "MATCH_SUMMARY_INTENT") {
    (async () => {
      const { deepseek_api_key: apiKey } = await chrome.storage.local.get("deepseek_api_key");
      const result = await YouTubeSummary.matchVideoIntent(message.payload, { apiKey, baseUrl: DEFAULT_BASE_URL, storage: chrome.storage.local });
      sendResponse({ ok: true, ...result });
    })().catch((error) => sendResponse({ ok: false, error: error?.message || "匹配失败，请重试" }));
    return true;
  }

  if (message?.type === "GET_DEFAULT_RECOMMENDATIONS") {
    (async () => {
      const { deepseek_api_key: apiKey } = await chrome.storage.local.get("deepseek_api_key");
      const result = await YouTubeSummary.generateDefaultRecommendations(
        message.payload,
        {
          apiKey,
          baseUrl: DEFAULT_BASE_URL,
          storage: chrome.storage.local,
        },
      );
      sendResponse({ ok: true, ...result });
    })().catch((error) =>
      sendResponse({
        ok: false,
        error: error?.message || "默认推荐生成失败",
      }),
    );
    return true;
  }

  if (message?.type === "CANCEL_CONTEXT_EXPLANATION") {
    const clientId = String(message.clientId || "");
    explanationControllers.get(clientId)?.abort();
    explanationControllers.delete(clientId);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "EXPLAIN_VIDEO_SELECTION") {
    const clientId = String(message.payload?.clientId || "").slice(0, 128);
    if (!clientId) {
      sendResponse({ ok: false, error: "解释会话信息无效" });
      return false;
    }
    explanationControllers.get(clientId)?.abort();
    const controller = new AbortController();
    explanationControllers.set(clientId, controller);
    const releaseController = () => {
      if (explanationControllers.get(clientId) === controller) {
        explanationControllers.delete(clientId);
      }
    };
    (async () => {
      const { deepseek_api_key: apiKey } =
        await chrome.storage.local.get("deepseek_api_key");
      const result = await YouTubeSummary.explainVideoSelection(
        message.payload,
        {
          apiKey,
          baseUrl: DEFAULT_BASE_URL,
          signal: controller.signal,
        },
      );
      releaseController();
      sendResponse({ ok: true, ...result });
    })()
      .catch((error) => {
        releaseController();
        sendResponse({
          ok: false,
          cancelled: controller.signal.aborted,
          error: error?.message || "解释失败，请重试",
        });
      });
    return true;
  }

  if (message?.type !== "GENERATE_SUMMARY") return false;

  (async () => {
    const task = await startOrAttachTask(message.payload);
    const result = await task.promise;
    sendResponse({ ok: true, generationId: task.generationId, targetLanguage: task.targetLanguage, ...result });
  })().catch((error) => sendResponse({ ok: false, error: error?.message || "生成失败，请重试" }));
  return true;
});
