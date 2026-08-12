(function initCollectionUtils(root) {
  "use strict";

  const CLIPPINGS_SCHEMA_VERSION = 2;
  const CLIPPINGS_STORAGE_KEY = "skimline_saved_clippings_v2";
  const LEGACY_CLIPPINGS_STORAGE_KEY = "skimline_saved_clippings_v1";
  const CLIPPINGS_BACKUP_FORMAT = "skimline-clippings-backup";
  const MAX_VISIBLE_CLIPPINGS = 1000;
  const MIN_SELECTION_CHARS = 2;
  const MAX_SELECTION_CHARS = 200;
  const MAX_ANSWER_QUESTION_CHARS = 200;
  const MAX_ANSWER_DIRECT_CHARS = 2000;
  const MAX_ANSWER_STEP_CHARS = 500;
  const MAX_ANSWER_NOTICE_CHARS = 200;
  const SOURCE_TYPES = new Set([
    "overview",
    "claim",
    "detail",
    "insightWhy",
    "insightDetail",
  ]);
  const CLIPPING_SEARCH_FIELDS = [
    "selectedText",
    "videoTitle",
    "pointText",
    "sectionTitle",
  ];
  const CLIPPING_CONTENT_FIELDS = [
    "selectedText",
    "pointText",
    "sectionTitle",
  ];

  function normalizeClippingText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeSearchText(value) {
    return normalizeClippingText(value).toLowerCase();
  }

  function clippingMatchesFields(item, query, fields) {
    return fields.some((field) =>
      normalizeSearchText(item?.[field]).includes(query),
    );
  }

  function characterLength(value) {
    return [...String(value || "")].length;
  }

  function normalizeAnchorT(value) {
    if (value === null || value === undefined || value === "") return null;
    const seconds = Number(value);
    return Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : null;
  }

  function normalizeSourceType(value) {
    const sourceType = String(value || "");
    return SOURCE_TYPES.has(sourceType) ? sourceType : "claim";
  }

  function normalizeVideoId(value) {
    const videoId = String(value || "").trim();
    return /^[A-Za-z0-9_-]{6,32}$/.test(videoId) ? videoId : "";
  }

  function normalizeClippingId(value) {
    return String(value || "").trim().slice(0, 128);
  }

  function normalizeStoredVideoTitle(value) {
    return normalizeClippingText(value)
      .replace(/^\s*[\(（]\d+[\)）]\s*/, "")
      .slice(0, 300);
  }

  function normalizeTitleLanguage(value) {
    const raw = String(value || "").trim().slice(0, 32);
    if (!raw) return "";
    try {
      return Intl.getCanonicalLocales(raw)[0] || "";
    } catch {
      return "";
    }
  }

  function normalizeVideoTitleEntry(value) {
    const videoId = normalizeVideoId(value?.videoId);
    const targetLanguage = normalizeTitleLanguage(value?.targetLanguage);
    const title = [...normalizeClippingText(value?.title)]
      .slice(0, 120)
      .join("");
    const promptVersion = Math.max(
      0,
      Math.floor(Number(value?.promptVersion) || 0),
    );
    const generatedAt = Math.max(
      0,
      Math.floor(Number(value?.generatedAt) || 0),
    );
    if (
      !videoId ||
      !targetLanguage ||
      !title ||
      !promptVersion ||
      !generatedAt
    ) {
      return null;
    }
    return { videoId, targetLanguage, title, promptVersion, generatedAt };
  }

  function videoTitleEntryKey(value) {
    const entry = normalizeVideoTitleEntry(value);
    return entry
      ? JSON.stringify([entry.videoId, entry.targetLanguage])
      : "";
  }

  function normalizeStoredClipping(value) {
    const selectedText = normalizeClippingText(value?.selectedText);
    const videoId = normalizeVideoId(value?.videoId);
    const savedAt = Math.max(0, Math.floor(Number(value?.savedAt) || 0));
    const id = normalizeClippingId(value?.id);
    const length = characterLength(selectedText);
    if (
      !id ||
      !videoId ||
      !savedAt ||
      length < MIN_SELECTION_CHARS ||
      length > MAX_SELECTION_CHARS
    ) {
      return null;
    }
    const sourceType = normalizeSourceType(value?.sourceType);
    return {
      id,
      selectedText,
      videoId,
      videoTitle:
        normalizeStoredVideoTitle(value?.videoTitle) ||
        `YouTube 视频 ${videoId}`,
      anchorT:
        sourceType === "overview" ? null : normalizeAnchorT(value?.anchorT),
      sourceType,
      pointText: normalizeClippingText(value?.pointText).slice(0, 1200),
      sectionTitle: normalizeClippingText(value?.sectionTitle).slice(0, 300),
      targetLanguage: String(value?.targetLanguage || "")
        .trim()
        .slice(0, 32),
      savedAt,
    };
  }

  function normalizeAnswerQuestion(value) {
    return normalizeClippingText(value)
      .toLocaleLowerCase()
      .replace(/[?？。.!！]+$/g, "")
      .trim();
  }

  function normalizeAnswerTimestamps(value, limit = 3) {
    const seen = new Set();
    return (Array.isArray(value) ? value : [])
      .filter((timestamp) => Number.isFinite(Number(timestamp)))
      .map((timestamp) => Math.max(0, Math.floor(Number(timestamp))))
      .filter((timestamp) => {
        if (seen.has(timestamp)) return false;
        seen.add(timestamp);
        return true;
      })
      .slice(0, limit);
  }

  function normalizeAnswerSteps(value) {
    return (Array.isArray(value) ? value : [])
      .map((step) => ({
        text: normalizeClippingText(step?.text).slice(0, MAX_ANSWER_STEP_CHARS),
        sourceTs: normalizeAnswerTimestamps(step?.sourceTs, 3),
      }))
      .filter((step) => step.text && step.sourceTs.length)
      .slice(0, 5);
  }

  function answerSelectedText(directAnswer) {
    return [...`答卷：${normalizeClippingText(directAnswer)}`]
      .slice(0, MAX_SELECTION_CHARS)
      .join("");
  }

  function normalizeStoredAnswer(value) {
    const id = normalizeClippingId(value?.id);
    const videoId = normalizeVideoId(value?.videoId);
    const savedAt = Math.max(0, Math.floor(Number(value?.savedAt) || 0));
    const question = normalizeClippingText(value?.question).slice(
      0,
      MAX_ANSWER_QUESTION_CHARS,
    );
    const directAnswer = normalizeClippingText(value?.directAnswer).slice(
      0,
      MAX_ANSWER_DIRECT_CHARS,
    );
    const evidenceTs = normalizeAnswerTimestamps(value?.evidenceTs, 3);
    const steps = normalizeAnswerSteps(value?.steps);
    if (
      !id ||
      !videoId ||
      !savedAt ||
      !question ||
      !directAnswer ||
      (!evidenceTs.length && !steps.length)
    ) {
      return null;
    }
    const firstStepT = steps[0]?.sourceTs?.[0];
    const anchorT = Number.isFinite(firstStepT) ? firstStepT : evidenceTs[0];
    return {
      kind: "answer",
      id,
      videoId,
      videoTitle:
        normalizeClippingText(value?.videoTitle).slice(0, 300) ||
        `YouTube 视频 ${videoId}`,
      targetLanguage: String(value?.targetLanguage || "")
        .trim()
        .slice(0, 32),
      question,
      directAnswer,
      evidenceTs,
      steps,
      uncertain: Boolean(value?.uncertain),
      notice: normalizeClippingText(value?.notice).slice(
        0,
        MAX_ANSWER_NOTICE_CHARS,
      ),
      usedCaptions: Boolean(value?.usedCaptions),
      anchorT,
      selectedText: answerSelectedText(directAnswer),
      sourceType: "claim",
      pointText: "",
      sectionTitle: "",
      savedAt,
    };
  }

  function normalizeStoredItem(value) {
    return value?.kind === "answer"
      ? normalizeStoredAnswer(value)
      : normalizeStoredClipping(value);
  }

  function createClipping(input, options = {}) {
    const selectedText = normalizeClippingText(input?.selectedText);
    const videoId = normalizeVideoId(input?.videoId);
    const length = characterLength(selectedText);
    if (length < MIN_SELECTION_CHARS || length > MAX_SELECTION_CHARS) {
      throw new Error(`收藏内容需要在 ${MIN_SELECTION_CHARS}–${MAX_SELECTION_CHARS} 个字以内`);
    }
    if (!videoId) throw new Error("收藏来源视频无效");

    const now = Math.max(1, Math.floor(Number(options.now) || Date.now()));
    const fallbackId = `${videoId}-${now}-${Math.random().toString(36).slice(2)}`;
    const id = normalizeClippingId(
      options.id || root.crypto?.randomUUID?.() || fallbackId,
    );
    return normalizeStoredClipping({
      ...input,
      id,
      selectedText,
      videoId,
      savedAt: now,
    });
  }

  function createAnswerClipping(input, options = {}) {
    const now = Math.max(1, Math.floor(Number(options.now) || Date.now()));
    const videoId = normalizeVideoId(input?.videoId);
    const fallbackId = `answer-${videoId}-${now}-${Math.random()
      .toString(36)
      .slice(2)}`;
    const answer = normalizeStoredAnswer({
      ...input,
      kind: "answer",
      id:
        options.id ||
        root.crypto?.randomUUID?.() ||
        fallbackId,
      savedAt: now,
    });
    if (!answer) throw new Error("答卷内容无效");
    return answer;
  }

  function clippingDedupeKey(item) {
    const normalized = normalizeStoredItem(item);
    if (!normalized) return "";
    if (normalized.kind === "answer") {
      return JSON.stringify([
        "answer",
        normalized.videoId,
        normalized.targetLanguage,
        normalizeAnswerQuestion(normalized.question),
      ]);
    }
    return JSON.stringify([
      normalized.videoId,
      normalized.anchorT,
      normalized.selectedText.toLowerCase(),
    ]);
  }

  function compareStrings(left, right) {
    if (left === right) return 0;
    return left < right ? -1 : 1;
  }

  function compareClippings(left, right) {
    return right.savedAt - left.savedAt || compareStrings(left.id, right.id);
  }

  function chooseCanonicalIdCollision(left, right) {
    return JSON.stringify(left) >= JSON.stringify(right) ? left : right;
  }

  function chooseCanonicalVideoTitle(left, right) {
    if (left.promptVersion !== right.promptVersion) {
      return left.promptVersion > right.promptVersion ? left : right;
    }
    if (left.generatedAt !== right.generatedAt) {
      return left.generatedAt > right.generatedAt ? left : right;
    }
    return JSON.stringify(left) >= JSON.stringify(right) ? left : right;
  }

  function normalizeVideoTitles(values) {
    const byKey = new Map();
    for (const rawEntry of Array.isArray(values) ? values : []) {
      const entry = normalizeVideoTitleEntry(rawEntry);
      if (!entry) continue;
      const key = videoTitleEntryKey(entry);
      const existing = byKey.get(key);
      byKey.set(
        key,
        existing ? chooseCanonicalVideoTitle(existing, entry) : entry,
      );
    }
    return [...byKey.values()].sort((left, right) =>
      compareStrings(videoTitleEntryKey(left), videoTitleEntryKey(right)),
    );
  }

  function normalizeReplicaState(value) {
    const addsById = new Map();
    const rawAdds = Array.isArray(value?.adds)
      ? value.adds
      : Array.isArray(value?.items)
        ? value.items
        : [];
    for (const rawItem of rawAdds) {
      const item = normalizeStoredItem(rawItem);
      if (!item) continue;
      const existing = addsById.get(item.id);
      addsById.set(
        item.id,
        existing ? chooseCanonicalIdCollision(existing, item) : item,
      );
    }

    // Tombstones are monotonic in schema v2. Never remove individual entries.
    // Garbage collection is only safe under a future checkpoint protocol that
    // provably subsumes every replica that may still contain the matching add.
    const removes = new Set(
      (Array.isArray(value?.removes) ? value.removes : [])
        .map(normalizeClippingId)
        .filter(Boolean),
    );

    // videoTitles is a grow-only LWW map. Without a replicated deletion
    // protocol, orphaned entries must remain so merges stay monotonic.
    const videoTitles = normalizeVideoTitles(value?.videoTitles);

    return {
      schemaVersion: CLIPPINGS_SCHEMA_VERSION,
      revision: Math.max(0, Math.floor(Number(value?.revision) || 0)),
      adds: [...addsById.values()]
        .filter((item) => !removes.has(item.id))
        .sort(compareClippings),
      removes: [...removes].sort(compareStrings),
      videoTitles,
    };
  }

  function mergeClippingStates(states) {
    const addsById = new Map();
    const removes = new Set();
    const videoTitlesByKey = new Map();
    for (const rawState of Array.isArray(states) ? states : []) {
      const state = normalizeReplicaState(rawState);
      for (const item of state.adds) {
        const existing = addsById.get(item.id);
        addsById.set(
          item.id,
          existing ? chooseCanonicalIdCollision(existing, item) : item,
        );
      }
      for (const id of state.removes) removes.add(id);
      for (const entry of state.videoTitles) {
        const key = videoTitleEntryKey(entry);
        const existing = videoTitlesByKey.get(key);
        videoTitlesByKey.set(
          key,
          existing ? chooseCanonicalVideoTitle(existing, entry) : entry,
        );
      }
    }
    return {
      schemaVersion: CLIPPINGS_SCHEMA_VERSION,
      adds: [...addsById.values()]
        .filter((item) => !removes.has(item.id))
        .sort(compareClippings),
      removes: [...removes].sort(compareStrings),
      videoTitles: normalizeVideoTitles([...videoTitlesByKey.values()]),
    };
  }

  function upsertVideoTitle(storeValue, entryValue) {
    const store = normalizeReplicaState(storeValue);
    const entry = normalizeVideoTitleEntry(entryValue);
    if (!entry) throw new Error("视频标题元数据无效");
    const key = videoTitleEntryKey(entry);
    const existing = store.videoTitles.find(
      (candidate) => videoTitleEntryKey(candidate) === key,
    );
    const canonical = existing
      ? chooseCanonicalVideoTitle(existing, entry)
      : entry;
    const changed =
      !existing || JSON.stringify(canonical) !== JSON.stringify(existing);
    if (!changed) return { store, entry: existing, changed: false };
    return {
      store: normalizeReplicaState({
        ...store,
        revision: store.revision + 1,
        videoTitles: [
          ...store.videoTitles.filter(
            (candidate) => videoTitleEntryKey(candidate) !== key,
          ),
          canonical,
        ],
      }),
      entry: canonical,
      changed: true,
    };
  }

  function materializeLiveItems(states) {
    const merged = mergeClippingStates(states);
    const removedIds = new Set(merged.removes);
    return merged.adds.filter((item) => !removedIds.has(item.id));
  }

  function buildClippingsView(items) {
    const byId = new Map();
    for (const rawItem of Array.isArray(items) ? items : []) {
      const item = normalizeStoredItem(rawItem);
      if (!item) continue;
      const existing = byId.get(item.id);
      byId.set(
        item.id,
        existing ? chooseCanonicalIdCollision(existing, item) : item,
      );
    }
    const byContent = new Set();
    const view = [];
    for (const item of [...byId.values()].sort(compareClippings)) {
      const key = clippingDedupeKey(item);
      if (!key || byContent.has(key)) continue;
      byContent.add(key);
      view.push(item);
    }
    return view;
  }

  function listClippings(states) {
    return buildClippingsView(materializeLiveItems(states));
  }

  function addClipping(storeValue, itemValue) {
    const store = normalizeReplicaState(storeValue);
    const item = normalizeStoredItem(itemValue);
    if (!item) throw new Error("收藏内容无效");
    const key = clippingDedupeKey(item);
    const existing = listClippings([store]).find(
      (candidate) => clippingDedupeKey(candidate) === key,
    );
    if (existing) return { store, item: existing, duplicate: true };
    if (store.removes.includes(item.id)) {
      throw new Error("已删除的收藏标识不能重复使用");
    }
    const sameId = store.adds.find((candidate) => candidate.id === item.id);
    if (sameId) {
      if (JSON.stringify(sameId) === JSON.stringify(item)) {
        return { store, item: sameId, duplicate: true };
      }
      throw new Error("收藏标识冲突");
    }
    return {
      store: normalizeReplicaState({
        ...store,
        revision: store.revision + 1,
        adds: [item, ...store.adds],
      }),
      item,
      duplicate: false,
    };
  }

  function upsertAnswerClipping(storeValue, itemValue) {
    const store = normalizeReplicaState(storeValue);
    const item = normalizeStoredAnswer(itemValue);
    if (!item) throw new Error("答卷内容无效");
    const targetKey = clippingDedupeKey(item);
    const replacedIds = materializeLiveItems([store])
      .filter(
        (candidate) =>
          candidate.id !== item.id &&
          candidate.kind === "answer" &&
          clippingDedupeKey(candidate) === targetKey,
      )
      .map((candidate) => candidate.id);
    if (store.removes.includes(item.id)) {
      throw new Error("已删除的答卷标识不能重复使用");
    }
    const sameId = store.adds.find((candidate) => candidate.id === item.id);
    if (sameId && JSON.stringify(sameId) !== JSON.stringify(item)) {
      throw new Error("答卷标识冲突");
    }
    const nextAdds = [
      item,
      ...store.adds.filter((candidate) => candidate.id !== item.id),
    ];
    return {
      store: normalizeReplicaState({
        ...store,
        revision: store.revision + 1,
        adds: nextAdds,
        removes: [...store.removes, ...replacedIds],
      }),
      item,
      replacedIds: [...new Set(replacedIds)].sort(compareStrings),
    };
  }

  function removeClipping(storeValue, id, observedStates = [storeValue]) {
    const store = normalizeReplicaState(storeValue);
    const liveItems = materializeLiveItems([store, ...observedStates]);
    const targetId = normalizeClippingId(id);
    const deletedItem = liveItems.find((item) => item.id === targetId) || null;
    if (!deletedItem) return { store, deletedItem: null, deletedIds: [] };
    const targetKey = clippingDedupeKey(deletedItem);
    const deletedIds = liveItems
      .filter((item) => clippingDedupeKey(item) === targetKey)
      .map((item) => item.id)
      .sort(compareStrings);
    return {
      store: normalizeReplicaState({
        ...store,
        revision: store.revision + 1,
        removes: [...store.removes, ...deletedIds],
      }),
      deletedItem,
      deletedIds,
    };
  }

  function restoreClipping(storeValue, itemValue, options = {}) {
    const snapshot = normalizeStoredItem(itemValue);
    if (!snapshot) throw new Error("收藏内容无效");
    if (snapshot.kind === "answer") {
      const restored = createAnswerClipping(snapshot, {
        id: options.id,
        now: snapshot.savedAt,
      });
      const result = upsertAnswerClipping(storeValue, restored);
      return { ...result, duplicate: false };
    }
    const restored = createClipping(snapshot, {
      id: options.id,
      now: snapshot.savedAt,
    });
    return addClipping(storeValue, restored);
  }

  function searchClippings(items, rawQuery) {
    const query = normalizeSearchText(rawQuery);
    const view = buildClippingsView(items);
    if (!query) return view;
    return view.filter((item) =>
      item.kind === "answer"
        ? [
            item.question,
            item.directAnswer,
            item.notice,
            ...item.steps.map((step) => step.text),
            item.videoTitle,
          ].some((value) => normalizeSearchText(value).includes(query))
        : clippingMatchesFields(item, query, CLIPPING_SEARCH_FIELDS),
    );
  }

  function createClippingsBackup(storeValue, options = {}) {
    const store = normalizeReplicaState(storeValue);
    return {
      format: CLIPPINGS_BACKUP_FORMAT,
      schemaVersion: CLIPPINGS_SCHEMA_VERSION,
      exportedAt: Math.max(1, Math.floor(Number(options.now) || Date.now())),
      adds: store.adds,
      removes: store.removes,
      ...(store.videoTitles.length
        ? { videoTitles: store.videoTitles }
        : {}),
    };
  }

  function normalizeClippingsBackup(value) {
    if (
      value?.format !== CLIPPINGS_BACKUP_FORMAT ||
      Number(value?.schemaVersion) !== CLIPPINGS_SCHEMA_VERSION ||
      !Array.isArray(value?.adds) ||
      !Array.isArray(value?.removes) ||
      (value?.videoTitles !== undefined &&
        !Array.isArray(value.videoTitles))
    ) {
      throw new Error("这不是有效的 Skimline 收藏备份");
    }
    const normalizedAdds = value.adds.map(normalizeStoredItem);
    const normalizedRemoves = value.removes.map(normalizeClippingId);
    const rawVideoTitles = Array.isArray(value?.videoTitles)
      ? value.videoTitles
      : [];
    const normalizedVideoTitles = rawVideoTitles.map(normalizeVideoTitleEntry);
    if (
      normalizedAdds.some((item) => !item) ||
      normalizedRemoves.some((id) => !id) ||
      normalizedVideoTitles.some((entry) => !entry) ||
      new Set(normalizedAdds.map((item) => item.id)).size !==
      normalizedAdds.length ||
      new Set(normalizedRemoves).size !== normalizedRemoves.length ||
      new Set(normalizedVideoTitles.map(videoTitleEntryKey)).size !==
        normalizedVideoTitles.length
    ) {
      throw new Error("收藏备份包含损坏或重复的记录");
    }
    const state = normalizeReplicaState({
      adds: normalizedAdds,
      removes: normalizedRemoves,
      videoTitles: normalizedVideoTitles,
    });
    return {
      format: CLIPPINGS_BACKUP_FORMAT,
      schemaVersion: CLIPPINGS_SCHEMA_VERSION,
      exportedAt: Math.max(0, Math.floor(Number(value.exportedAt) || 0)),
      adds: state.adds,
      removes: state.removes,
      videoTitles: state.videoTitles,
    };
  }

  function importClippingsBackup(storeValue, backupValue) {
    const store = normalizeReplicaState(storeValue);
    const backup = normalizeClippingsBackup(backupValue);
    const merged = mergeClippingStates([store, backup]);
    const before = JSON.stringify({
      adds: store.adds,
      removes: store.removes,
      videoTitles: store.videoTitles,
    });
    const after = JSON.stringify({
      adds: merged.adds,
      removes: merged.removes,
      videoTitles: merged.videoTitles,
    });
    const changed = before !== after;
    return {
      store: normalizeReplicaState({
        ...merged,
        revision: changed ? store.revision + 1 : store.revision,
      }),
      changed,
      count: listClippings([merged]).length,
    };
  }

  function groupClippingsByVideo(items, rawQuery, options = {}) {
    const query = normalizeSearchText(rawQuery);
    const normalizedItems = buildClippingsView(items);
    const videoTitles = normalizeVideoTitles(options.videoTitles);
    const targetLanguage = normalizeTitleLanguage(options.targetLanguage);
    const groupsByVideoId = new Map();

    for (const item of normalizedItems) {
      let group = groupsByVideoId.get(item.videoId);
      if (!group) {
        group = {
          videoId: item.videoId,
          videoTitle: item.videoTitle,
          latestSavedAt: item.savedAt,
          searchableTitles: new Set(),
          allItems: [],
        };
        groupsByVideoId.set(item.videoId, group);
      }
      group.allItems.push(item);
      group.searchableTitles.add(normalizeSearchText(item.videoTitle));
      if (item.savedAt > group.latestSavedAt) {
        group.latestSavedAt = item.savedAt;
        group.videoTitle = item.videoTitle;
      }
    }

    for (const entry of videoTitles) {
      const group = groupsByVideoId.get(entry.videoId);
      if (!group) continue;
      group.searchableTitles.add(normalizeSearchText(entry.title));
      if (entry.targetLanguage === targetLanguage) {
        group.libraryTitle = entry.title;
      }
    }

    return [...groupsByVideoId.values()]
      .map((group) => {
        const titleMatched = Boolean(
          query &&
            [...group.searchableTitles].some((title) => title.includes(query)),
        );
        const visibleItems =
          !query || titleMatched
            ? group.allItems
            : group.allItems.filter((item) =>
                item.kind === "answer"
                  ? [
                      item.question,
                      item.directAnswer,
                      item.notice,
                      ...item.steps.map((step) => step.text),
                    ].some((value) =>
                      normalizeSearchText(value).includes(query),
                    )
                  : clippingMatchesFields(
                      item,
                      query,
                      CLIPPING_CONTENT_FIELDS,
                    ),
              );
        return {
          videoId: group.videoId,
          videoTitle: group.videoTitle,
          libraryTitle: group.libraryTitle || "",
          latestSavedAt: group.latestSavedAt,
          totalCount: group.allItems.length,
          visibleCount: visibleItems.length,
          titleMatched,
          items: visibleItems,
        };
      })
      .filter((group) => group.visibleCount > 0)
      .sort(
        (a, b) =>
          b.latestSavedAt - a.latestSavedAt ||
          compareStrings(a.videoId, b.videoId),
      );
  }

  const api = {
    CLIPPINGS_BACKUP_FORMAT,
    CLIPPINGS_SCHEMA_VERSION,
    CLIPPINGS_STORAGE_KEY,
    LEGACY_CLIPPINGS_STORAGE_KEY,
    MAX_SELECTION_CHARS,
    MAX_VISIBLE_CLIPPINGS,
    MIN_SELECTION_CHARS,
    addClipping,
    answerSelectedText,
    buildClippingsView,
    clippingDedupeKey,
    createClipping,
    createAnswerClipping,
    createClippingsBackup,
    groupClippingsByVideo,
    importClippingsBackup,
    listClippings,
    materializeLiveItems,
    mergeClippingStates,
    normalizeClippingText,
    normalizeVideoTitleEntry,
    normalizeVideoTitles,
    normalizeClippingsBackup,
    normalizeReplicaState,
    removeClipping,
    restoreClipping,
    searchClippings,
    upsertVideoTitle,
    videoTitleEntryKey,
    upsertAnswerClipping,
  };

  root.SkimlineCollections = Object.assign(root.SkimlineCollections || {}, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
