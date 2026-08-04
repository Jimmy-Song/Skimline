(function initCollectionUtils(root) {
  "use strict";

  const CLIPPINGS_SCHEMA_VERSION = 2;
  const CLIPPINGS_STORAGE_KEY = "skimline_saved_clippings_v2";
  const LEGACY_CLIPPINGS_STORAGE_KEY = "skimline_saved_clippings_v1";
  const CLIPPINGS_BACKUP_FORMAT = "skimline-clippings-backup";
  const MAX_VISIBLE_CLIPPINGS = 1000;
  const MIN_SELECTION_CHARS = 2;
  const MAX_SELECTION_CHARS = 200;
  const SOURCE_TYPES = new Set([
    "overview",
    "claim",
    "detail",
    "insightWhy",
    "insightDetail",
  ]);

  function normalizeClippingText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
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
        normalizeClippingText(value?.videoTitle).slice(0, 300) ||
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

  function clippingDedupeKey(item) {
    const normalized = normalizeStoredClipping(item);
    if (!normalized) return "";
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

  function normalizeReplicaState(value) {
    const addsById = new Map();
    const rawAdds = Array.isArray(value?.adds)
      ? value.adds
      : Array.isArray(value?.items)
        ? value.items
        : [];
    for (const rawItem of rawAdds) {
      const item = normalizeStoredClipping(rawItem);
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

    return {
      schemaVersion: CLIPPINGS_SCHEMA_VERSION,
      revision: Math.max(0, Math.floor(Number(value?.revision) || 0)),
      adds: [...addsById.values()]
        .filter((item) => !removes.has(item.id))
        .sort(compareClippings),
      removes: [...removes].sort(compareStrings),
    };
  }

  function mergeClippingStates(states) {
    const addsById = new Map();
    const removes = new Set();
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
    }
    return {
      schemaVersion: CLIPPINGS_SCHEMA_VERSION,
      adds: [...addsById.values()]
        .filter((item) => !removes.has(item.id))
        .sort(compareClippings),
      removes: [...removes].sort(compareStrings),
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
      const item = normalizeStoredClipping(rawItem);
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
    const item = normalizeStoredClipping(itemValue);
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
    const snapshot = normalizeStoredClipping(itemValue);
    if (!snapshot) throw new Error("收藏内容无效");
    const restored = createClipping(snapshot, {
      id: options.id,
      now: snapshot.savedAt,
    });
    return addClipping(storeValue, restored);
  }

  function searchClippings(items, rawQuery) {
    const query = normalizeClippingText(rawQuery).toLowerCase();
    const view = buildClippingsView(items);
    if (!query) return view;
    return view.filter((item) =>
      [
        item.selectedText,
        item.videoTitle,
        item.pointText,
        item.sectionTitle,
      ].some((field) =>
        normalizeClippingText(field).toLowerCase().includes(query),
      ),
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
    };
  }

  function normalizeClippingsBackup(value) {
    if (
      value?.format !== CLIPPINGS_BACKUP_FORMAT ||
      Number(value?.schemaVersion) !== CLIPPINGS_SCHEMA_VERSION ||
      !Array.isArray(value?.adds) ||
      !Array.isArray(value?.removes)
    ) {
      throw new Error("这不是有效的 Skimline 收藏备份");
    }
    const normalizedAdds = value.adds.map(normalizeStoredClipping);
    const normalizedRemoves = value.removes.map(normalizeClippingId);
    if (
      normalizedAdds.some((item) => !item) ||
      normalizedRemoves.some((id) => !id) ||
      new Set(normalizedAdds.map((item) => item.id)).size !==
        normalizedAdds.length ||
      new Set(normalizedRemoves).size !== normalizedRemoves.length
    ) {
      throw new Error("收藏备份包含损坏或重复的记录");
    }
    const state = normalizeReplicaState({
      adds: normalizedAdds,
      removes: normalizedRemoves,
    });
    return {
      format: CLIPPINGS_BACKUP_FORMAT,
      schemaVersion: CLIPPINGS_SCHEMA_VERSION,
      exportedAt: Math.max(0, Math.floor(Number(value.exportedAt) || 0)),
      adds: state.adds,
      removes: state.removes,
    };
  }

  function importClippingsBackup(storeValue, backupValue) {
    const store = normalizeReplicaState(storeValue);
    const backup = normalizeClippingsBackup(backupValue);
    const merged = mergeClippingStates([store, backup]);
    const before = JSON.stringify({ adds: store.adds, removes: store.removes });
    const after = JSON.stringify({ adds: merged.adds, removes: merged.removes });
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

  const api = {
    CLIPPINGS_BACKUP_FORMAT,
    CLIPPINGS_SCHEMA_VERSION,
    CLIPPINGS_STORAGE_KEY,
    LEGACY_CLIPPINGS_STORAGE_KEY,
    MAX_SELECTION_CHARS,
    MAX_VISIBLE_CLIPPINGS,
    MIN_SELECTION_CHARS,
    addClipping,
    buildClippingsView,
    clippingDedupeKey,
    createClipping,
    createClippingsBackup,
    importClippingsBackup,
    listClippings,
    materializeLiveItems,
    mergeClippingStates,
    normalizeClippingText,
    normalizeClippingsBackup,
    normalizeReplicaState,
    removeClipping,
    restoreClipping,
    searchClippings,
  };

  root.SkimlineCollections = Object.assign(root.SkimlineCollections || {}, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
