(function initCollectionUtils(root) {
  "use strict";

  const CLIPPINGS_SCHEMA_VERSION = 1;
  const CLIPPINGS_STORAGE_KEY = "skimline_saved_clippings_v1";
  const MAX_CLIPPINGS = 1000;
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

  function normalizeStoredClipping(value) {
    const selectedText = normalizeClippingText(value?.selectedText);
    const videoId = normalizeVideoId(value?.videoId);
    const savedAt = Math.max(0, Math.floor(Number(value?.savedAt) || 0));
    const id = String(value?.id || "").trim().slice(0, 128);
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
    const id = String(
      options.id || root.crypto?.randomUUID?.() || fallbackId,
    )
      .trim()
      .slice(0, 128);
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
      normalized.selectedText.toLocaleLowerCase(),
    ]);
  }

  function normalizeClippingsStore(value, limit = MAX_CLIPPINGS) {
    const byId = new Set();
    const byContent = new Set();
    const items = [];
    const safeLimit = Math.max(1, Math.floor(Number(limit) || MAX_CLIPPINGS));
    for (const rawItem of Array.isArray(value?.items) ? value.items : []) {
      const item = normalizeStoredClipping(rawItem);
      if (!item || byId.has(item.id)) continue;
      const contentKey = clippingDedupeKey(item);
      if (!contentKey || byContent.has(contentKey)) continue;
      byId.add(item.id);
      byContent.add(contentKey);
      items.push(item);
    }
    items.sort((a, b) => b.savedAt - a.savedAt || a.id.localeCompare(b.id));
    return {
      schemaVersion: CLIPPINGS_SCHEMA_VERSION,
      revision: Math.max(0, Math.floor(Number(value?.revision) || 0)),
      items: items.slice(0, safeLimit),
    };
  }

  function addClipping(storeValue, itemValue, limit = MAX_CLIPPINGS) {
    const store = normalizeClippingsStore(storeValue, limit);
    const item = normalizeStoredClipping(itemValue);
    if (!item) throw new Error("收藏内容无效");
    const key = clippingDedupeKey(item);
    const existing = store.items.find(
      (candidate) => clippingDedupeKey(candidate) === key,
    );
    if (existing) {
      return { store, item: existing, duplicate: true, limitReached: false };
    }
    if (store.items.length >= limit) {
      return { store, item: null, duplicate: false, limitReached: true };
    }
    const nextStore = normalizeClippingsStore(
      {
        schemaVersion: CLIPPINGS_SCHEMA_VERSION,
        revision: store.revision + 1,
        items: [item, ...store.items],
      },
      limit,
    );
    return {
      store: nextStore,
      item,
      duplicate: false,
      limitReached: false,
    };
  }

  function removeClipping(storeValue, id, limit = MAX_CLIPPINGS) {
    const store = normalizeClippingsStore(storeValue, limit);
    const targetId = String(id || "");
    const deletedItem = store.items.find((item) => item.id === targetId) || null;
    if (!deletedItem) return { store, deletedItem: null };
    return {
      store: {
        ...store,
        revision: store.revision + 1,
        items: store.items.filter((item) => item.id !== targetId),
      },
      deletedItem,
    };
  }

  function restoreClipping(storeValue, itemValue, limit = MAX_CLIPPINGS) {
    return addClipping(storeValue, itemValue, limit);
  }

  function searchClippings(items, rawQuery) {
    const query = normalizeClippingText(rawQuery).toLocaleLowerCase();
    const normalizedItems = normalizeClippingsStore({
      schemaVersion: CLIPPINGS_SCHEMA_VERSION,
      items,
    }).items;
    if (!query) return normalizedItems;
    return normalizedItems.filter((item) =>
      [
        item.selectedText,
        item.videoTitle,
        item.pointText,
        item.sectionTitle,
      ].some((field) => normalizeClippingText(field).toLocaleLowerCase().includes(query)),
    );
  }

  const api = {
    CLIPPINGS_SCHEMA_VERSION,
    CLIPPINGS_STORAGE_KEY,
    MAX_CLIPPINGS,
    MAX_SELECTION_CHARS,
    MIN_SELECTION_CHARS,
    addClipping,
    clippingDedupeKey,
    createClipping,
    normalizeClippingText,
    normalizeClippingsStore,
    removeClipping,
    restoreClipping,
    searchClippings,
  };

  root.SkimlineCollections = Object.assign(root.SkimlineCollections || {}, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
