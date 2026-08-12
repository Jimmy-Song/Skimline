"use strict";

importScripts("generation-utils.js", "collection-utils.js");

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const MAX_CONCURRENT_GENERATIONS = 2;
const TASK_TTL_MS = 24 * 60 * 60 * 1000;
const EXPLANATION_TASK_TTL_MS = 2 * 60 * 60 * 1000;
const EXPLANATION_TASK_STORAGE_PREFIX = "context-explanation-task:";
const MAX_CONCURRENT_EXPLANATIONS = 2;
const MAX_EXPLANATION_TURNS = 3;
const CONTENT_MESSAGE_SOURCE = "youtube-viewpoint-map";
const activeGenerations = new Map();
const taskRecords = new Map();
const queuedTaskKeys = [];
const overviewJobs = new Map();
const explanationControllers = new Map();
const explanationTasks = new Map();
const explanationTaskFingerprints = new Map();
const queuedExplanationTaskIds = [];
const explanationTaskControllers = new Map();
const libraryTitleJobs = new Map();
let explanationTasksRestorePromise = null;
let clippingMutationQueue = Promise.resolve();

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

async function readClippingsStore() {
  const key = SkimlineCollections.CLIPPINGS_STORAGE_KEY;
  const legacyKey = SkimlineCollections.LEGACY_CLIPPINGS_STORAGE_KEY;
  const stored = await chrome.storage.local.get([key, legacyKey]);
  if (stored[key] !== undefined) {
    return SkimlineCollections.normalizeReplicaState(stored[key]);
  }
  if (stored[legacyKey] === undefined) {
    return SkimlineCollections.normalizeReplicaState(null);
  }

  const migrated = SkimlineCollections.normalizeReplicaState(stored[legacyKey]);
  await chrome.storage.local.set({ [key]: migrated });
  await chrome.storage.local.remove(legacyKey);
  return migrated;
}

function queueClippingMutation(operation) {
  const pending = clippingMutationQueue
    .catch(() => undefined)
    .then(async () => operation(await readClippingsStore()));
  clippingMutationQueue = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

async function persistClippingsStore(store) {
  await chrome.storage.local.set({
    [SkimlineCollections.CLIPPINGS_STORAGE_KEY]:
      SkimlineCollections.normalizeReplicaState(store),
  });
}

function listClippingsFromStore(store) {
  return SkimlineCollections.listClippings([store]);
}

function summaryLibraryTitleEntry(summary) {
  const title = YouTubeSummary.libraryTitleFromSummary(summary);
  const videoId = String(summary?.videoId || "");
  const targetLanguage = String(summary?.targetLanguage || "").trim();
  if (!title || !videoId || !targetLanguage) return null;
  return SkimlineCollections.normalizeVideoTitleEntry({
    videoId,
    targetLanguage,
    title,
    promptVersion: summary.libraryTitlePromptVersion,
    generatedAt: summary.libraryTitleGeneratedAt,
  });
}

function isCurrentCachedSummary(summary, videoId, targetLanguage) {
  return Boolean(
    summary?.videoId === videoId &&
      YouTubeSummary.normalizeSummaryLanguage(summary?.targetLanguage) ===
        targetLanguage &&
      summary?.schemaVersion === YouTubeSummary.SUMMARY_SCHEMA_VERSION &&
      summary?.promptVersion === YouTubeSummary.SUMMARY_PROMPT_VERSION,
  );
}

async function readCachedLibraryTitleEntry(videoId, rawTargetLanguage) {
  const requestedLanguage = String(rawTargetLanguage || "").trim();
  if (!videoId || !requestedLanguage) return null;
  const targetLanguage = YouTubeSummary.normalizeSummaryLanguage(
    requestedLanguage,
  );
  const key = YouTubeSummary.summaryCacheKey(videoId, targetLanguage);
  const summary = (await chrome.storage.local.get(key))[key];
  return isCurrentCachedSummary(summary, videoId, targetLanguage)
    ? summaryLibraryTitleEntry(summary)
    : null;
}

function storeHasVideoClipping(store, videoId) {
  return listClippingsFromStore(store).some(
    (item) => item.videoId === videoId,
  );
}

async function persistSummaryLibraryTitleIfCollected(summary) {
  const entry = summaryLibraryTitleEntry(summary);
  if (!entry) return false;
  return queueClippingMutation(async (store) => {
    if (!storeHasVideoClipping(store, entry.videoId)) return false;
    const result = SkimlineCollections.upsertVideoTitle(store, entry);
    if (result.changed) await persistClippingsStore(result.store);
    return result.changed;
  });
}

function ensureCachedLibraryTitle(videoId, rawTargetLanguage) {
  const requestedLanguage = String(rawTargetLanguage || "").trim();
  if (!videoId || !requestedLanguage) return Promise.resolve(null);
  const targetLanguage = YouTubeSummary.normalizeSummaryLanguage(
    requestedLanguage,
  );
  const key = YouTubeSummary.summaryCacheKey(videoId, targetLanguage);
  const existing = libraryTitleJobs.get(key);
  if (existing) return existing;

  const job = (async () => {
    const summary = (await chrome.storage.local.get(key))[key];
    if (!isCurrentCachedSummary(summary, videoId, targetLanguage)) return null;
    let resolved = summary;
    if (YouTubeSummary.shouldBackfillLibraryTitle(summary)) {
      const { deepseek_api_key: apiKey } = await chrome.storage.local.get(
        "deepseek_api_key",
      );
      if (apiKey) {
        const result = await YouTubeSummary.backfillSummaryLibraryTitle(summary, {
          apiKey,
          baseUrl: DEFAULT_BASE_URL,
          storage: chrome.storage.local,
        });
        resolved = result.summary;
      }
    }
    await persistSummaryLibraryTitleIfCollected(resolved).catch(() => false);
    return resolved;
  })().finally(() => libraryTitleJobs.delete(key));
  libraryTitleJobs.set(key, job);
  return job;
}

function saveClipping(input) {
  return queueClippingMutation(async (store) => {
    const clipping = SkimlineCollections.createClipping(input);
    const result = SkimlineCollections.addClipping(store, clipping);
    let nextStore = result.store;
    let videoTitleChanged = false;
    const titleEntry = await readCachedLibraryTitleEntry(
      clipping.videoId,
      clipping.targetLanguage,
    );
    if (titleEntry && storeHasVideoClipping(nextStore, clipping.videoId)) {
      const titleResult = SkimlineCollections.upsertVideoTitle(
        nextStore,
        titleEntry,
      );
      nextStore = titleResult.store;
      videoTitleChanged = titleResult.changed;
    }
    const changed = !result.duplicate || videoTitleChanged;
    if (changed) {
      nextStore = SkimlineCollections.normalizeReplicaState({
        ...nextStore,
        revision: store.revision + 1,
      });
      await persistClippingsStore(nextStore);
    }
    return {
      item: result.item,
      duplicate: result.duplicate,
      count: listClippingsFromStore(nextStore).length,
      revision: nextStore.revision,
    };
  });
}

function deleteClipping(id) {
  return queueClippingMutation(async (store) => {
    const result = SkimlineCollections.removeClipping(store, id);
    if (result.deletedItem) await persistClippingsStore(result.store);
    return {
      deletedItem: result.deletedItem,
      deletedIds: result.deletedIds,
      count: listClippingsFromStore(result.store).length,
      revision: result.store.revision,
    };
  });
}

function restoreDeletedClipping(item) {
  return queueClippingMutation(async (store) => {
    const result = SkimlineCollections.restoreClipping(store, item);
    if (!result.duplicate) await persistClippingsStore(result.store);
    return {
      item: result.item,
      duplicate: result.duplicate,
      count: listClippingsFromStore(result.store).length,
      revision: result.store.revision,
    };
  });
}

async function exportClippingsBackup() {
  const store = await readClippingsStore();
  const backup = SkimlineCollections.createClippingsBackup(store);
  return {
    backup,
    filename: `skimline-clippings-${new Date(backup.exportedAt)
      .toISOString()
      .slice(0, 10)}.json`,
    count: listClippingsFromStore(store).length,
  };
}

function importClippingsBackup(backup) {
  return queueClippingMutation(async (store) => {
    const result = SkimlineCollections.importClippingsBackup(store, backup);
    if (result.changed) await persistClippingsStore(result.store);
    return {
      changed: result.changed,
      count: result.count,
      revision: result.store.revision,
    };
  });
}

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

function explanationStorageArea() {
  return chrome.storage.session || chrome.storage.local;
}

function explanationStorageKey(taskId) {
  return `${EXPLANATION_TASK_STORAGE_PREFIX}${taskId}`;
}

function hashExplanationFingerprint(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function explanationFingerprint(payload, selectedText, targetLanguage) {
  return [
    String(payload?.videoId || ""),
    targetLanguage,
    selectedText.toLocaleLowerCase(),
    Number.isFinite(Number(payload?.anchorT))
      ? Math.floor(Number(payload.anchorT))
      : "",
  ].join("\u001f");
}

function limitedExplanationText(value, maxChars) {
  return [...String(value || "").trim()].slice(0, maxChars).join("");
}

function prepareExplanationContext(payload) {
  const selectedText = YouTubeSummary.normalizeExplanationSelection(
    payload?.selectedText,
  );
  const segments = Array.isArray(payload?.segments) ? payload.segments : [];
  if (segments.length) {
    return {
      context: YouTubeSummary.buildExplanationContext(payload),
      noTranscript: false,
      selectedText,
    };
  }
  const anchorT = Number(payload?.anchorT);
  return {
    context: {
      selectedText,
      question: "",
      anchorContext: limitedExplanationText(payload?.anchorContext, 1200),
      videoOutline: limitedExplanationText(payload?.videoOutline, 8000),
      anchorT:
        Number.isFinite(anchorT) && anchorT >= 0
          ? Math.floor(anchorT)
          : null,
      localSegments: [],
      relevantSegments: [],
      evidenceSegments: [],
    },
    noTranscript: true,
    selectedText,
  };
}

function explanationTaskSnapshot(task) {
  return {
    taskId: task.taskId,
    status: task.status,
    videoId: task.videoId,
    targetLanguage: task.targetLanguage,
    sourceLang: task.sourceLang,
    selection: task.selection,
    result: task.result,
    history: task.history,
    turns: task.turns,
    pendingQuestion: task.pendingQuestion,
    dismissed: task.dismissed,
    noTranscript: task.noTranscript,
    error: task.error,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function serializeExplanationTask(task) {
  return {
    ...explanationTaskSnapshot(task),
    fingerprint: task.fingerprint,
    clientId: task.clientId,
    context: task.context,
    operationAttempts: task.operationAttempts,
  };
}

async function persistExplanationTask(task) {
  task.updatedAt = Date.now();
  await explanationStorageArea().set({
    [explanationStorageKey(task.taskId)]: serializeExplanationTask(task),
  });
}

function removeQueuedExplanationTask(taskId) {
  let index = queuedExplanationTaskIds.indexOf(taskId);
  while (index >= 0) {
    queuedExplanationTaskIds.splice(index, 1);
    index = queuedExplanationTaskIds.indexOf(taskId);
  }
}

async function removeExplanationTask(task) {
  explanationTasks.delete(task.taskId);
  if (explanationTaskFingerprints.get(task.fingerprint) === task.taskId) {
    explanationTaskFingerprints.delete(task.fingerprint);
  }
  removeQueuedExplanationTask(task.taskId);
  await explanationStorageArea().remove(explanationStorageKey(task.taskId));
}

function explanationTaskFromStored(stored) {
  if (
    !stored?.taskId ||
    !stored?.videoId ||
    !stored?.targetLanguage ||
    !stored?.fingerprint ||
    !stored?.context
  ) {
    return null;
  }
  if (
    Date.now() - Number(stored.updatedAt || 0) >
    EXPLANATION_TASK_TTL_MS
  ) {
    return null;
  }
  const wasActive = ["queued", "running", "recovering"].includes(
    stored.status,
  );
  const operationAttempts = Math.max(
    0,
    Number(stored.operationAttempts) || 0,
  );
  return {
    ...stored,
    status:
      wasActive && operationAttempts < 2
        ? "queued"
        : wasActive
          ? "failed"
          : String(stored.status || "failed"),
    history: Array.isArray(stored.history) ? stored.history.slice(-7) : [],
    turns: Math.max(0, Math.min(MAX_EXPLANATION_TURNS, Number(stored.turns) || 0)),
    pendingQuestion: String(stored.pendingQuestion || ""),
    dismissed: Boolean(stored.dismissed),
    noTranscript: Boolean(stored.noTranscript),
    result: stored.result || null,
    error:
      wasActive && operationAttempts >= 2
        ? "解释任务恢复失败，请重新发起"
        : String(stored.error || ""),
    operationAttempts,
  };
}

async function ensureExplanationTasksRestored() {
  if (explanationTasksRestorePromise) return explanationTasksRestorePromise;
  explanationTasksRestorePromise = (async () => {
    const stored = await explanationStorageArea().get(null);
    const expiredKeys = [];
    for (const [key, value] of Object.entries(stored || {})) {
      if (!key.startsWith(EXPLANATION_TASK_STORAGE_PREFIX)) continue;
      const task = explanationTaskFromStored(value);
      if (!task) {
        expiredKeys.push(key);
        continue;
      }
      explanationTasks.set(task.taskId, task);
      explanationTaskFingerprints.set(task.fingerprint, task.taskId);
      if (task.status === "queued") queuedExplanationTaskIds.push(task.taskId);
    }
    if (expiredKeys.length) {
      await explanationStorageArea().remove(expiredKeys);
    }
    dispatchExplanationTasks();
  })();
  return explanationTasksRestorePromise;
}

function mergeExplanationEvidence(current, next) {
  const seen = new Set();
  return [...(current || []), ...(next || [])]
    .filter((item) => {
      const timestamp = Number(item?.t);
      if (!Number.isFinite(timestamp) || seen.has(timestamp)) return false;
      seen.add(timestamp);
      return true;
    })
    .slice(0, 3);
}

function normalizeNoTranscriptExplanation(result) {
  return {
    ...result,
    inVideo: "",
    evidence: [],
    uncertain: true,
    notice:
      "未能读取完整字幕，当前仅提供通用解释，无法确认讲者在视频中的具体用法。",
  };
}

async function finishExplanationTask(task, updates) {
  Object.assign(task, updates);
  await persistExplanationTask(task);
  await broadcast({
    type: "CONTEXT_EXPLANATION_TASK_UPDATED",
    task: explanationTaskSnapshot(task),
  });
}

async function runExplanationTask(task) {
  if (
    explanationTaskControllers.has(task.taskId) ||
    task.status !== "queued"
  ) {
    return;
  }
  const controller = new AbortController();
  explanationTaskControllers.set(task.taskId, controller);
  task.status = "running";
  task.error = "";
  task.operationAttempts += 1;
  try {
    await persistExplanationTask(task);
    await broadcast({
      type: "CONTEXT_EXPLANATION_TASK_UPDATED",
      task: explanationTaskSnapshot(task),
    });
    const { deepseek_api_key: apiKey } =
      await chrome.storage.local.get("deepseek_api_key");
    const question = String(task.pendingQuestion || "");
    const context = { ...task.context, question };
    let result = await YouTubeSummary.requestContextExplanation(
      {
        sourceLang: task.sourceLang,
        history: task.history,
      },
      context,
      {
        apiKey,
        baseUrl: DEFAULT_BASE_URL,
        targetLanguage: task.targetLanguage,
        signal: controller.signal,
      },
    );
    if (controller.signal.aborted || task.status === "cancelled") {
      throw new Error("解释已取消");
    }
    if (task.noTranscript) result = normalizeNoTranscriptExplanation(result);
    if (question) {
      task.history = [
        ...task.history,
        { role: "user", content: question },
        { role: "assistant", content: String(result.answer || "") },
      ].slice(-7);
      task.turns = Math.min(MAX_EXPLANATION_TURNS, task.turns + 1);
      task.result = {
        ...task.result,
        evidence: mergeExplanationEvidence(
          task.result?.evidence,
          result.evidence,
        ),
        suggestedQuestions: result.suggestedQuestions,
        uncertain: Boolean(task.result?.uncertain || result.uncertain),
        notice: result.notice || task.result?.notice || "",
      };
    } else {
      task.result = result;
      task.history = [
        {
          role: "assistant",
          content: [result.simple, result.inVideo].filter(Boolean).join("\n\n"),
        },
      ];
    }
    task.pendingQuestion = "";
    task.operationAttempts = 0;
    await finishExplanationTask(task, {
      status: "complete",
      error: "",
    });
  } catch (error) {
    if (controller.signal.aborted || task.status === "cancelled") {
      if (task.status !== "cancelled") {
        await finishExplanationTask(task, {
          status: "cancelled",
          pendingQuestion: "",
          error: "",
        });
      }
    } else {
      await finishExplanationTask(task, {
        status: "failed",
        error: error?.message || "解释失败，请重试",
      });
    }
  } finally {
    explanationTaskControllers.delete(task.taskId);
    dispatchExplanationTasks();
  }
}

function dispatchExplanationTasks() {
  while (
    explanationTaskControllers.size < MAX_CONCURRENT_EXPLANATIONS &&
    queuedExplanationTaskIds.length
  ) {
    const taskId = queuedExplanationTaskIds.shift();
    const task = explanationTasks.get(taskId);
    if (!task || task.status !== "queued") continue;
    void runExplanationTask(task);
  }
}

function queueExplanationTask(task) {
  removeQueuedExplanationTask(task.taskId);
  queuedExplanationTaskIds.push(task.taskId);
  dispatchExplanationTasks();
}

async function cancelExplanationTask(task, reason = "cancelled") {
  if (!task) return;
  removeQueuedExplanationTask(task.taskId);
  task.status = "cancelled";
  task.pendingQuestion = "";
  task.error = "";
  task.cancelReason = limitedExplanationText(reason, 120);
  explanationTaskControllers.get(task.taskId)?.abort();
  await persistExplanationTask(task);
  await broadcast({
    type: "CONTEXT_EXPLANATION_TASK_UPDATED",
    task: explanationTaskSnapshot(task),
  });
}

async function startContextExplanation(payload) {
  await ensureExplanationTasksRestored();
  const videoId = String(payload?.videoId || "").trim();
  const clientId = limitedExplanationText(payload?.clientId, 128);
  if (!videoId) throw new Error("当前视频信息已失效");
  if (!clientId) throw new Error("解释会话信息无效");
  const targetLanguage = YouTubeSummary.normalizeSummaryLanguage(
    payload?.targetLanguage,
  );
  const prepared = prepareExplanationContext(payload);
  const fingerprint = explanationFingerprint(
    payload,
    prepared.selectedText,
    targetLanguage,
  );
  const existingTaskId = explanationTaskFingerprints.get(fingerprint);
  const existing = existingTaskId
    ? explanationTasks.get(existingTaskId)
    : null;
  if (
    existing &&
    !["cancelled", "expired"].includes(existing.status)
  ) {
    existing.clientId = clientId;
    existing.dismissed = false;
    if (existing.status === "failed") {
      existing.status = "queued";
      existing.error = "";
      existing.operationAttempts = 0;
      await persistExplanationTask(existing);
      queueExplanationTask(existing);
    } else {
      await persistExplanationTask(existing);
    }
    return explanationTaskSnapshot(existing);
  }
  for (const task of explanationTasks.values()) {
    if (
      task.clientId === clientId &&
      task.fingerprint !== fingerprint &&
      ["queued", "running", "recovering"].includes(task.status)
    ) {
      await cancelExplanationTask(task, "superseded");
    }
  }
  const now = Date.now();
  const taskId = `exp-${now.toString(36)}-${hashExplanationFingerprint(
    `${fingerprint}:${now}:${Math.random()}`,
  )}`;
  const task = {
    taskId,
    fingerprint,
    clientId,
    videoId,
    targetLanguage,
    sourceLang: limitedExplanationText(payload?.sourceLang, 64),
    selection: {
      selectedText: prepared.selectedText,
      videoId,
      videoTitle: limitedExplanationText(payload?.videoTitle, 500),
      anchorT: prepared.context.anchorT,
      anchorContext: prepared.context.anchorContext,
      sourceType: limitedExplanationText(payload?.sourceType, 40) || "claim",
      pointText: limitedExplanationText(payload?.pointText, 1200),
      sectionTitle: limitedExplanationText(payload?.sectionTitle, 500),
    },
    context: prepared.context,
    noTranscript: prepared.noTranscript,
    status: "queued",
    result: null,
    history: [],
    turns: 0,
    pendingQuestion: "",
    dismissed: false,
    error: "",
    operationAttempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  explanationTasks.set(taskId, task);
  explanationTaskFingerprints.set(fingerprint, taskId);
  await persistExplanationTask(task);
  queueExplanationTask(task);
  return explanationTaskSnapshot(task);
}

async function askContextExplanation(payload) {
  await ensureExplanationTasksRestored();
  const task = explanationTasks.get(String(payload?.taskId || ""));
  if (!task) throw new Error("解释会话已失效，请重新圈选内容");
  const question = YouTubeSummary.normalizeExplanationSelection(
    payload?.question,
    "问题",
  );
  const expectedTurn = Math.max(0, Number(payload?.expectedTurn) || 0);
  if (
    ["queued", "running", "recovering"].includes(task.status) &&
    task.pendingQuestion === question
  ) {
    return explanationTaskSnapshot(task);
  }
  if (!task.result) throw new Error("请等待首轮解释完成");
  if (task.turns >= MAX_EXPLANATION_TURNS) {
    throw new Error("这次解释已完成 3 轮追问");
  }
  if (task.turns !== expectedTurn) {
    return explanationTaskSnapshot(task);
  }
  if (!["complete", "failed"].includes(task.status)) {
    throw new Error("上一轮问题仍在回答中");
  }
  task.pendingQuestion = question;
  task.status = "queued";
  task.dismissed = false;
  task.error = "";
  task.operationAttempts = 0;
  await persistExplanationTask(task);
  queueExplanationTask(task);
  return explanationTaskSnapshot(task);
}

async function getContextExplanationTask(message) {
  await ensureExplanationTasksRestored();
  const taskId = String(message?.taskId || "");
  if (taskId) {
    const task = explanationTasks.get(taskId);
    return task ? explanationTaskSnapshot(task) : null;
  }
  const videoId = String(message?.videoId || "");
  const targetLanguage = YouTubeSummary.normalizeSummaryLanguage(
    message?.targetLanguage,
  );
  const tasks = [...explanationTasks.values()]
    .filter(
      (task) =>
        task.videoId === videoId &&
        task.targetLanguage === targetLanguage &&
        !["cancelled", "expired"].includes(task.status),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return tasks[0] ? explanationTaskSnapshot(tasks[0]) : null;
}

async function dismissContextExplanation(taskId) {
  await ensureExplanationTasksRestored();
  const task = explanationTasks.get(String(taskId || ""));
  if (!task) return null;
  task.dismissed = true;
  await persistExplanationTask(task);
  return explanationTaskSnapshot(task);
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
    await persistSummaryLibraryTitleIfCollected(result.summary).catch(() => false);
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

  const parseYouTubeUrl = (value) => {
    try {
      const parsed = new URL(String(value || ""));
      const hostname = parsed.hostname.toLowerCase();
      if (
        (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
        (hostname !== "youtube.com" &&
          !hostname.endsWith(".youtube.com"))
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  };

  // sender.url belongs to the content-script document and can keep the old
  // video URL after a YouTube SPA navigation. Use it only to authenticate the
  // sender's page; the live tab and MAIN-world player verify the video itself.
  const senderUrl = parseYouTubeUrl(sender.url || sender.origin);
  if (!senderUrl) {
    throw new Error("字幕请求来源无效，请刷新 YouTube 页面后重试");
  }

  let currentTab;
  try {
    currentTab = await chrome.tabs.get(tabId);
  } catch {
    throw new Error("无法确认当前 YouTube 视频页面");
  }
  const currentTabUrl = parseYouTubeUrl(
    currentTab?.url || sender.tab?.url,
  );
  if (!currentTabUrl || currentTabUrl.pathname !== "/watch") {
    throw new Error("无法确认当前 YouTube 视频页面");
  }
  if (currentTabUrl.searchParams.get("v") !== requestedVideoId) {
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

  if (message?.type === "LIST_CLIPPINGS") {
    readClippingsStore()
      .then((store) =>
        sendResponse({
          ok: true,
          items: listClippingsFromStore(store),
          videoTitles: store.videoTitles,
          revision: store.revision,
        }),
      )
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || "读取洞见库失败",
        }),
      );
    return true;
  }

  if (message?.type === "EXPORT_CLIPPINGS_BACKUP") {
    exportClippingsBackup()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || "导出收藏失败",
        }),
      );
    return true;
  }

  if (message?.type === "IMPORT_CLIPPINGS_BACKUP") {
    importClippingsBackup(message.backup)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || "导入收藏失败",
        }),
      );
    return true;
  }

  if (message?.type === "SAVE_CLIPPING") {
    saveClipping(message.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || "收藏失败，请重试",
        }),
      );
    return true;
  }

  if (message?.type === "DELETE_CLIPPING") {
    deleteClipping(message.id)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || "删除收藏失败",
        }),
      );
    return true;
  }

  if (message?.type === "RESTORE_CLIPPING") {
    restoreDeletedClipping(message.item)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || "撤销删除失败",
        }),
      );
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

  if (message?.type === "ENSURE_LIBRARY_TITLE") {
    ensureCachedLibraryTitle(
      String(message.videoId || ""),
      message.targetLanguage,
    )
      .then((summary) => sendResponse({ ok: true, summary }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || "回填洞见库标题失败",
        }),
      );
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

  if (message?.type === "START_CONTEXT_EXPLANATION") {
    startContextExplanation(message.payload)
      .then((task) => sendResponse({ ok: true, task }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || "解释失败，请重试",
        }),
      );
    return true;
  }

  if (message?.type === "ASK_CONTEXT_EXPLANATION") {
    askContextExplanation(message.payload)
      .then((task) => sendResponse({ ok: true, task }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || "回答失败，请重试",
        }),
      );
    return true;
  }

  if (message?.type === "GET_CONTEXT_EXPLANATION_TASK") {
    getContextExplanationTask(message)
      .then((task) => sendResponse({ ok: true, task }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || "读取解释任务失败",
        }),
      );
    return true;
  }

  if (message?.type === "DISMISS_CONTEXT_EXPLANATION") {
    dismissContextExplanation(message.taskId)
      .then((task) => sendResponse({ ok: true, task }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || "收起解释失败",
        }),
      );
    return true;
  }

  if (message?.type === "CANCEL_CONTEXT_EXPLANATION") {
    if (message.taskId) {
      ensureExplanationTasksRestored()
        .then(() =>
          cancelExplanationTask(
            explanationTasks.get(String(message.taskId)),
            message.reason,
          ),
        )
        .then(() => sendResponse({ ok: true }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: error?.message || "取消解释失败",
          }),
        );
      return true;
    }
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
