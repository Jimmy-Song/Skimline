"use strict";

importScripts("generation-utils.js");

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const MAX_CONCURRENT_GENERATIONS = 2;
const TASK_TTL_MS = 24 * 60 * 60 * 1000;
const activeGenerations = new Map();
const taskRecords = new Map();
const queuedTaskKeys = [];

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
    subscriberTabIds: new Set(stored.subscriberTabIds || []),
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
  if (Number.isInteger(tabId)) task.subscriberTabIds.add(tabId);
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
    status: "queued",
    sourceLang: String(payload.sourceLang || ""),
    duration: Number(payload.duration) || 0,
    points: [],
    receivedChunkIndexes: new Set(),
    totalChunks: 0,
    nextChunkIndex: 0,
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
    targetLanguage: task.targetLanguage,
  });
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
    task.resolve?.(result);
    await broadcast({
      type: "SUMMARY_COMPLETE",
      videoId: task.videoId,
      generationId: task.generationId,
      targetLanguage: task.targetLanguage,
      summary: result.summary,
    });
    await removeTask(task);
  } catch (error) {
    if (task.cancelled || task.controller.signal.aborted) return;
    task.status = "error";
    task.error = error?.message || "生成失败，请重试";
    await persistTask(task);
    task.reject?.(new Error(task.error));
    await broadcast({
      type: "SUMMARY_FAILED",
      videoId: task.videoId,
      generationId: task.generationId,
      targetLanguage: task.targetLanguage,
      error: task.error,
    });
  } finally {
    activeGenerations.delete(task.taskKey);
    task.controller = null;
    dispatchQueuedTasks();
  }
}

function dispatchQueuedTasks() {
  while (
    activeGenerations.size < MAX_CONCURRENT_GENERATIONS &&
    queuedTaskKeys.length
  ) {
    const taskKey = queuedTaskKeys.shift();
    const task = taskRecords.get(taskKey);
    if (task && !task.cancelled) runTask(task);
  }
}

async function startOrAttachTask(payload) {
  const videoId = String(payload.videoId || "");
  const targetLanguage = YouTubeSummary.normalizeSummaryLanguage(
    payload.targetLanguage,
  );
  const taskKey = taskKeyFor(videoId, targetLanguage);
  let task = taskRecords.get(taskKey);
  if (task) {
    attachTab(task, payload.sourceTabId);
    ensureTaskPromise(task, { ...payload, generationId: task.generationId });
    await persistTask(task);
    if (!activeGenerations.has(taskKey) && !queuedTaskKeys.includes(taskKey)) {
      if (activeGenerations.size < MAX_CONCURRENT_GENERATIONS) runTask(task);
      else {
        queuedTaskKeys.push(taskKey);
        await broadcast({
          type: "SUMMARY_QUEUED",
          videoId: task.videoId,
          generationId: task.generationId,
          targetLanguage: task.targetLanguage,
        });
      }
    }
    return task;
  }
  task = createTask({ ...payload, targetLanguage });
  taskRecords.set(taskKey, task);
  await persistTask(task);
  if (activeGenerations.size < MAX_CONCURRENT_GENERATIONS) runTask(task);
  else {
    queuedTaskKeys.push(taskKey);
    await broadcast({
      type: "SUMMARY_QUEUED",
      videoId: task.videoId,
      generationId: task.generationId,
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
  })().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

  if (message?.type === "GET_SUMMARY_TASK") {
    getTaskStatus(message)
      .then((task) => sendResponse({ ok: true, task }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "读取任务失败" }));
    return true;
  }

  if (message?.type === "CANCEL_GENERATION") {
    const targetLanguage = YouTubeSummary.normalizeSummaryLanguage(message.targetLanguage);
    detachTab(
      taskRecords.get(taskKeyFor(message.videoId, targetLanguage)),
      message.tabId,
    ).then(() => sendResponse({ ok: true }));
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

  if (message?.type !== "GENERATE_SUMMARY") return false;

  (async () => {
    const task = await startOrAttachTask(message.payload);
    const result = await task.promise;
    sendResponse({ ok: true, generationId: task.generationId, targetLanguage: task.targetLanguage, ...result });
  })().catch((error) => sendResponse({ ok: false, error: error?.message || "生成失败，请重试" }));
  return true;
});
