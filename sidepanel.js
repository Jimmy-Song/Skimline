(function initializeSidePanel() {
  "use strict";

  const DEFAULT_SECTIONS_COLLAPSED = true;
  const DEFAULT_FOLLOW_PLAYBACK = true;
  const LANGUAGE_SETTING_KEY = "summary_language";
  const TEXT_SCALE_SETTING_KEY = "content_text_scale";
  const CLIPPING_HINT_SETTING_KEY = "skimline_clipping_hint_seen_v1";
  const TEXT_SCALE_MIN = 85;
  const TEXT_SCALE_MAX = 125;
  const TEXT_SCALE_DEFAULT = 100;
  const TEXT_SCALE_EXPANDED_THRESHOLD = 110;
  const PREPARE_COUNTDOWN_SECONDS = 6;
  const MAX_EXPLANATION_SELECTION_CHARS = 200;
  const MAX_EXPLANATION_TURNS = 3;
  const EXPLAIN_MENU_VIEWPORT_GAP = 8;
  const EXPLAIN_MENU_ARROW_INSET = 12;
  const LANGUAGE_OPTIONS = {
    auto: "自动（跟随 Chrome）",
    "zh-CN": "简体中文",
    "zh-TW": "繁體中文",
    en: "English",
    ja: "日本語",
    ko: "한국어",
    es: "Español",
  };
  const GENERATING_LANGUAGE_LABELS = {
    "zh-CN": "简体中文",
    "zh-TW": "繁體中文",
    en: "英文",
    ja: "日文",
    ko: "韩文",
    es: "西班牙文",
  };

  const state = {
    tabId: null,
    videoId: "",
    videoTitle: "",
    libraryTitle: "",
    loaded: false,
    loading: false,
    preparing: false,
    languageSetting: "auto",
    targetLanguage: "zh-CN",
    textScale: TEXT_SCALE_DEFAULT,
    textScaleTouched: false,
    activeGenerationId: "",
    finalizedGenerationId: "",
    activeOverviewGenerationId: "",
    pendingCaptions: null,
    overviewCaptions: null,
    overviewRetrying: false,
    countdownTimer: null,
    countdownRemaining: 0,
    toastTimer: null,
    points: [],
    pointIds: new Set(),
    pointRows: new Map(),
    receivedChunkIndexes: new Set(),
    totalChunks: 0,
    epoch: 0,
    activeTabSyncId: 0,
    activatingTabId: null,
    currentTime: 0,
    currentIndex: -1,
    currentSectionIndex: -1,
    sectionGroups: [],
    sectionViews: [],
    expandedRow: null,
    followPlayback: DEFAULT_FOLLOW_PLAYBACK,
    followSeekRequestId: 0,
    playbackSnapshots: YouTubeSummary.createTabPlaybackSnapshots(),
    pendingPlaybackRestore: null,
    autoExpandedSection: null,
    recommendationRequestId: 0,
    recommendationIntent: "",
    recommendationSource: "",
    recommendationRows: [],
    recommendationIndex: -1,
    recommendationPreviousExpanded: null,
    recommendationLocalMatches: new Map(),
    recommendationLocalCount: 0,
    recommendationAiAddedCount: 0,
    recommendationSupplementStatus: "idle",
    recommendationAutoExpandedRow: null,
    defaultRecommendationRequestId: 0,
    defaultRecommendations: [],
    explanationClientId:
      globalThis.crypto?.randomUUID?.() ||
      `explain-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    explanationCaptions: null,
    explanationCaptionsPromise: null,
    explanationCaptionsPromiseVideoId: "",
    explanationRequestId: 0,
    explanationSelection: null,
    explanationRange: null,
    explanationAnchorContainer: null,
    explanationHistory: [],
    explanationTurns: 0,
    explanationResult: null,
    explanationQuestion: "",
    explanationTaskId: "",
    explanationTaskStatus: "idle",
    explanationDrawerOpen: false,
    explanationDismissed: false,
    explanationSourceTabId: null,
    answerTaskId: "",
    answerTaskStatus: "idle",
    answerQuestion: "",
    answerResult: null,
    answerTurns: 0,
    answerTaskVersion: 0,
    answerRequestId: 0,
    answerCaptionUpgradeKey: "",
    answerSavedFingerprint: "",
    answerNewQuestionNotice: "",
    activeView: "summary",
    summaryScrollTop: 0,
    clippings: [],
    videoTitles: [],
    clippingsRevision: 0,
    libraryRequestId: 0,
    libraryError: "",
    libraryBackupBusy: false,
    libraryExpandedVideoIds: new Set(),
    libraryExpansionInitialized: false,
    libraryExpansionBeforeSearch: null,
    libraryLastQuery: "",
    clippingSaving: false,
    clippingHintChecked: false,
  };

  const elements = {
    appbar: document.querySelector(".yvpm-appbar"),
    panel: document.querySelector("#yvpm-panel"),
    empty: document.querySelector("#yvpm-empty"),
    list: document.querySelector("#yvpm-list"),
    listHeading: document.querySelector("#yvpm-list-heading"),
    listHeadingTitle: document.querySelector("#yvpm-list-heading-title"),
    listHeadingMeta: document.querySelector("#yvpm-list-heading-meta"),
    followPlayback: document.querySelector("#yvpm-follow-playback"),
    overview: document.querySelector("#yvpm-overview"),
    overviewLabel: document.querySelector(".yvpm-overview-label"),
    overviewText: document.querySelector("#yvpm-overview-text"),
    overviewRetry: document.querySelector("#yvpm-overview-retry"),
    intent: document.querySelector("#yvpm-intent"),
    intentForm: document.querySelector("#yvpm-intent-form"),
    intentInput: document.querySelector("#yvpm-intent-input"),
    intentSubmit: document.querySelector("#yvpm-intent-submit"),
    intentChips: document.querySelector("#yvpm-intent-chips"),
    intentFeedback: document.querySelector("#yvpm-intent-feedback"),
    answer: document.querySelector("#yvpm-answer"),
    answerQuestion: document.querySelector("#yvpm-answer-question"),
    answerClear: document.querySelector("#yvpm-answer-clear"),
    answerLoading: document.querySelector("#yvpm-answer-loading"),
    answerLoadingCopy: document.querySelector("#yvpm-answer-loading-copy"),
    answerContent: document.querySelector("#yvpm-answer-content"),
    answerDirect: document.querySelector("#yvpm-answer-direct"),
    answerEvidence: document.querySelector("#yvpm-answer-evidence"),
    answerStepsWrap: document.querySelector("#yvpm-answer-steps-wrap"),
    answerSteps: document.querySelector("#yvpm-answer-steps"),
    answerCaptionNote: document.querySelector("#yvpm-answer-caption-note"),
    answerNotice: document.querySelector("#yvpm-answer-notice"),
    answerError: document.querySelector("#yvpm-answer-error"),
    answerSave: document.querySelector("#yvpm-answer-save"),
    answerSwitch: document.querySelector("#yvpm-answer-switch"),
    answerFollowupForm: document.querySelector("#yvpm-answer-followup-form"),
    answerFollowup: document.querySelector("#yvpm-answer-followup"),
    answerFollowupCount: document.querySelector("#yvpm-answer-followup-count"),
    answerFollowupSubmit: document.querySelector("#yvpm-answer-followup-submit"),
    answerComplete: document.querySelector("#yvpm-answer-complete"),
    matchbar: document.querySelector("#yvpm-matchbar"),
    matchbarText: document.querySelector("#yvpm-matchbar-text"),
    matchRelated: document.querySelector("#yvpm-match-related"),
    matchClear: document.querySelector("#yvpm-match-clear"),
    matchPrev: document.querySelector("#yvpm-match-prev"),
    matchNext: document.querySelector("#yvpm-match-next"),
    progress: document.querySelector("#yvpm-progress"),
    progressText: document.querySelector("#yvpm-progress-text"),
    status: document.querySelector("#yvpm-status"),
    prepare: document.querySelector("#yvpm-prepare"),
    prepareCopy: document.querySelector("#yvpm-prepare-copy"),
    countdown: document.querySelector("#yvpm-countdown"),
    generateNow: document.querySelector("#yvpm-generate-now"),
    generationBar: document.querySelector("#yvpm-generation-bar"),
    generationCopy: document.querySelector("#yvpm-generation-copy"),
    changeLanguage: document.querySelector("#yvpm-change-language"),
    textScale: document.querySelector("#yvpm-text-scale"),
    textScaleReset: document.querySelector("#yvpm-text-scale-reset"),
    languageControl: document.querySelector(".yvpm-language-control"),
    languageButton: document.querySelector("#yvpm-language-button"),
    languageLabel: document.querySelector("#yvpm-language-label"),
    languageMenu: document.querySelector("#yvpm-language-menu"),
    languageOptions: [
      ...document.querySelectorAll("#yvpm-language-menu [data-language]"),
    ],
    libraryButton: document.querySelector("#yvpm-library-button"),
    libraryCount: document.querySelector("#yvpm-library-count"),
    library: document.querySelector("#yvpm-library"),
    libraryBack: document.querySelector("#yvpm-library-back"),
    libraryTotal: document.querySelector("#yvpm-library-total"),
    librarySearch: document.querySelector("#yvpm-library-search"),
    librarySearchClear: document.querySelector("#yvpm-library-search-clear"),
    libraryExport: document.querySelector("#yvpm-library-export"),
    libraryImport: document.querySelector("#yvpm-library-import"),
    libraryImportFile: document.querySelector("#yvpm-library-import-file"),
    libraryList: document.querySelector("#yvpm-library-list"),
    libraryEmpty: document.querySelector("#yvpm-library-empty"),
    libraryEmptyTitle: document.querySelector("#yvpm-library-empty-title"),
    libraryEmptyCopy: document.querySelector("#yvpm-library-empty-copy"),
    explainMenu: document.querySelector("#yvpm-explain-menu"),
    saveSelection: document.querySelector("#yvpm-save-selection"),
    explainSelection: document.querySelector("#yvpm-explain-selection"),
    copySelection: document.querySelector("#yvpm-copy-selection"),
    explanationCard: document.querySelector("#yvpm-explanation-drawer"),
    explanationScrim: document.querySelector("#yvpm-explanation-scrim"),
    explanationTitle: document.querySelector("#yvpm-explanation-title"),
    explanationBody: document.querySelector("#yvpm-explanation-body"),
    explanationComposer: document.querySelector(
      "#yvpm-explanation-composer",
    ),
    explanationLatest: document.querySelector("#yvpm-explanation-latest"),
    explanationClose: document.querySelector("#yvpm-explanation-close"),
    toast: document.querySelector("#yvpm-toast"),
    toastMessage: document.querySelector("#yvpm-toast-message"),
    toastAction: document.querySelector("#yvpm-toast-action"),
  };

  function runtimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response);
      });
    });
  }

  function matchesGeneration(message, generationId) {
    return Boolean(
      generationId &&
        (message?.generationId === generationId ||
          (Array.isArray(message?.generationIds) &&
            message.generationIds.includes(generationId))),
    );
  }

  function tabMessage(message) {
    return new Promise((resolve, reject) => {
      if (
        Number.isInteger(state.activatingTabId) &&
        state.activatingTabId !== state.tabId
      ) {
        reject(new Error("标签页正在切换，请稍后再试"));
        return;
      }
      if (!state.tabId) {
        reject(new Error("打开一个 YouTube 视频即可生成观点地图"));
        return;
      }
      chrome.tabs.sendMessage(state.tabId, message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response);
      });
    });
  }

  function tabMessageTo(tabId, message) {
    return new Promise((resolve, reject) => {
      if (!Number.isInteger(tabId)) {
        reject(new Error("来源视频标签页已失效"));
        return;
      }
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response);
      });
    });
  }

  async function seekWithFeedback(t, { followPlayback = false } = {}) {
    const followRequestId = followPlayback
      ? ++state.followSeekRequestId
      : null;
    try {
      const response = await tabMessage({ type: "SEEK", t });
      if (!response?.ok) {
        throw new Error(response?.error || "视频跳转失败");
      }
      if (followPlayback) {
        if (followRequestId !== state.followSeekRequestId) return;
        state.currentTime = Math.max(0, Number(t) || 0);
        setFollowPlayback(true, { sync: true });
      }
    } catch (error) {
      if (
        followPlayback &&
        followRequestId !== state.followSeekRequestId
      ) {
        return;
      }
      showToast(error?.message || "视频跳转失败");
    }
  }

  function resolveTargetLanguage(setting = state.languageSetting) {
    const requested = setting === "auto" ? navigator.language : setting;
    return normalizeTargetLanguage(requested);
  }

  function cleanVideoTitle(value) {
    return String(value || "")
      .replace(/\s*-\s*YouTube\s*$/i, "")
      .replace(/^\s*[\(（]\d+[\)）]\s*/, "")
      .trim();
  }

  function normalizeTextScale(value) {
    return YouTubeSummary.normalizeTextScale(value, {
      min: TEXT_SCALE_MIN,
      max: TEXT_SCALE_MAX,
      defaultValue: TEXT_SCALE_DEFAULT,
    });
  }

  function textScaleDescription(scale) {
    if (scale === TEXT_SCALE_DEFAULT) return "标准";
    return scale < TEXT_SCALE_DEFAULT ? "缩小" : "放大";
  }

  function applyTextScale(value) {
    const scale = normalizeTextScale(value);
    const description = textScaleDescription(scale);
    const progress =
      ((scale - TEXT_SCALE_MIN) / (TEXT_SCALE_MAX - TEXT_SCALE_MIN)) * 100;
    state.textScale = scale;
    document.documentElement.style.fontSize = `${scale}%`;
    document.documentElement.dataset.textScale =
      scale > TEXT_SCALE_EXPANDED_THRESHOLD ? "expanded" : "compact";
    elements.textScale.value = String(scale);
    elements.textScale.style.setProperty(
      "--yvpm-text-scale-progress",
      `${progress}%`,
    );
    elements.textScale.setAttribute(
      "aria-valuetext",
      `${scale}%，${description}`,
    );
    elements.textScaleReset.textContent = `${scale}%`;
    elements.textScaleReset.setAttribute(
      "aria-label",
      scale === TEXT_SCALE_DEFAULT
        ? "文字大小已是默认值 100%"
        : `恢复默认文字大小，当前为 ${scale}%`,
    );
    elements.textScaleReset.classList.toggle(
      "yvpm-text-scale-custom",
      scale !== TEXT_SCALE_DEFAULT,
    );
    return scale;
  }

  let textScaleSavePromise = Promise.resolve();

  function saveTextScale(value) {
    const scale = applyTextScale(value);
    state.textScaleTouched = true;
    textScaleSavePromise = textScaleSavePromise
      .catch(() => {})
      .then(() =>
        chrome.storage.local.set({ [TEXT_SCALE_SETTING_KEY]: scale }),
      )
      .catch(() => {
        showToast("文字大小已调整，但未能保存到本地。");
      });
    return textScaleSavePromise;
  }

  function normalizeTargetLanguage(language) {
    const value = String(language || "").trim();
    if (LANGUAGE_OPTIONS[value] && value !== "auto") return value;
    const base = value.toLowerCase().split(/[-_]/)[0];
    if (base === "zh") return /tw|hk|hant/i.test(value) ? "zh-TW" : "zh-CN";
    if (LANGUAGE_OPTIONS[base] && base !== "auto") return base;
    if (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value)) {
      try {
        return Intl.getCanonicalLocales(value)[0];
      } catch {
        // 无效语言标识会回落到简体中文。
      }
    }
    return "zh-CN";
  }

  function languageDisplayName(language) {
    const normalized = normalizeTargetLanguage(language);
    if (LANGUAGE_OPTIONS[normalized]) return LANGUAGE_OPTIONS[normalized];
    try {
      return new Intl.DisplayNames([navigator.language || "zh-CN"], {
        type: "language",
      }).of(normalized);
    } catch {
      return normalized;
    }
  }

  function updateLanguageControl() {
    state.targetLanguage = resolveTargetLanguage();
    elements.languageLabel.textContent = languageDisplayName(
      state.targetLanguage,
    );
    for (const option of elements.languageOptions) {
      option.setAttribute(
        "aria-selected",
        String(option.dataset.language === state.languageSetting),
      );
    }
  }

  function toggleLanguageMenu(open = elements.languageMenu.hidden) {
    elements.languageMenu.hidden = !open;
    elements.languageButton.setAttribute("aria-expanded", String(open));
    if (state.preparing) {
      if (open) stopPrepareCountdown();
      else startPrepareCountdown();
    }
    if (open) {
      const selected = elements.languageMenu.querySelector(
        '[aria-selected="true"]',
      );
      selected?.focus();
    }
  }

  function showToast(message, options = {}) {
    clearTimeout(state.toastTimer);
    elements.toastMessage.textContent = message;
    elements.toastAction.onclick = null;
    const actionLabel = String(options.actionLabel || "").trim();
    const onAction =
      typeof options.onAction === "function" ? options.onAction : null;
    elements.toastAction.hidden = !actionLabel || !onAction;
    elements.toastAction.textContent = actionLabel;
    if (actionLabel && onAction) {
      elements.toastAction.onclick = () => {
        clearTimeout(state.toastTimer);
        elements.toast.hidden = true;
        elements.toastAction.onclick = null;
        Promise.resolve()
          .then(onAction)
          .catch(() => {
            showToast("操作失败，请重试");
          });
      };
    }
    elements.toast.hidden = false;
    state.toastTimer = setTimeout(() => {
      elements.toast.hidden = true;
      elements.toastAction.onclick = null;
    }, Math.max(800, Number(options.duration) || 1800));
  }

  function explanationAllowedContainer(range) {
    const selector = [
      "#yvpm-overview-text",
      ".yvpm-claim",
      ".yvpm-detail p",
      ".yvpm-insight-card-why",
      ".yvpm-insight-card-detail",
    ].join(", ");
    const startElement =
      range?.startContainer?.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range?.startContainer?.parentElement;
    const endElement =
      range?.endContainer?.nodeType === Node.ELEMENT_NODE
        ? range.endContainer
        : range?.endContainer?.parentElement;
    const container = startElement?.closest?.(selector);
    return container && container.contains(endElement) ? container : null;
  }

  function clearExplanationHighlight() {
    if (globalThis.CSS?.highlights) {
      CSS.highlights.delete("yvpm-explanation-selection");
    }
  }

  function highlightExplanationRange() {
    clearExplanationHighlight();
    if (
      state.explanationRange &&
      globalThis.CSS?.highlights &&
      typeof globalThis.Highlight === "function"
    ) {
      CSS.highlights.set(
        "yvpm-explanation-selection",
        new Highlight(state.explanationRange),
      );
    }
  }

  function explanationAnchorRect() {
    try {
      const rect = state.explanationRange?.getBoundingClientRect();
      if (rect?.width || rect?.height) return rect;
    } catch {
      // 重新渲染摘要后旧 Range 可能失效，使用保存的位置兜底。
    }
    return state.explanationSelection?.rect || null;
  }

  function positionExplainMenu(rect = explanationAnchorRect()) {
    if (!rect || elements.explainMenu.hidden) return;
    const menuRect = elements.explainMenu.getBoundingClientRect();
    const anchorX = rect.left + rect.width / 2;
    const left = Math.max(
      EXPLAIN_MENU_VIEWPORT_GAP,
      Math.min(
        window.innerWidth - menuRect.width - EXPLAIN_MENU_VIEWPORT_GAP,
        anchorX - menuRect.width / 2,
      ),
    );
    const positionedLeft = Math.floor(left);
    const arrowInset = Math.min(
      EXPLAIN_MENU_ARROW_INSET,
      menuRect.width / 2,
    );
    const arrowX = Math.max(
      arrowInset,
      Math.min(menuRect.width - arrowInset, anchorX - positionedLeft),
    );
    const fitsAbove = rect.top >= menuRect.height + 12;
    const top = fitsAbove
      ? rect.top - menuRect.height - 8
      : rect.bottom + 8;
    elements.explainMenu.style.left = `${positionedLeft}px`;
    elements.explainMenu.style.setProperty(
      "--yvpm-explain-menu-arrow-x",
      `${arrowX}px`,
    );
    elements.explainMenu.style.top = `${Math.round(
      Math.max(56, Math.min(window.innerHeight - menuRect.height - 8, top)),
    )}px`;
    elements.explainMenu.classList.toggle(
      "yvpm-explain-menu-below",
      !fitsAbove,
    );
  }

  let explanationDrawerCloseTimer = null;

  function setExplanationDrawerVisible(open) {
    clearTimeout(explanationDrawerCloseTimer);
    const wasOpen = state.explanationDrawerOpen;
    state.explanationDrawerOpen = open;
    if (open) {
      elements.explanationCard.hidden = false;
      elements.explanationScrim.hidden = false;
      elements.explanationCard.inert = false;
      elements.explanationCard.setAttribute("aria-hidden", "false");
      requestAnimationFrame(() => {
        elements.explanationCard.dataset.state = "open";
        elements.explanationScrim.dataset.state = "open";
        if (!wasOpen) {
          elements.explanationClose.focus({ preventScroll: true });
        }
      });
      return;
    }
    elements.explanationCard.dataset.state = "closed";
    elements.explanationScrim.dataset.state = "closed";
    elements.explanationCard.inert = true;
    elements.explanationCard.setAttribute("aria-hidden", "true");
    explanationDrawerCloseTimer = setTimeout(() => {
      if (state.explanationDrawerOpen) return;
      elements.explanationCard.hidden = true;
      elements.explanationScrim.hidden = true;
      elements.explanationBody.replaceChildren();
      elements.explanationComposer.replaceChildren();
      elements.explanationLatest.hidden = true;
    }, 260);
  }

  function hideExplainMenu() {
    elements.explainMenu.hidden = true;
  }

  function explanationAnchorData(container) {
    const row = container.closest(".yvpm-row");
    const anchorT = row ? Number(row.dataset.t) : null;
    const contextSource = row || container;
    const pointText = String(
      row?.querySelector(".yvpm-claim")?.textContent || "",
    )
      .replace(/\s+/g, " ")
      .trim();
    const sectionTitle = String(
      row
        ?.closest(".yvpm-section")
        ?.querySelector(".yvpm-section-title")?.textContent || "",
    )
      .replace(/\s+/g, " ")
      .trim();
    let sourceType = "claim";
    if (container.matches("#yvpm-overview-text")) sourceType = "overview";
    else if (container.matches(".yvpm-detail p")) sourceType = "detail";
    else if (container.matches(".yvpm-insight-card-why")) {
      sourceType = "insightWhy";
    } else if (container.matches(".yvpm-insight-card-detail")) {
      sourceType = "insightDetail";
    }
    return {
      anchorT: Number.isFinite(anchorT) ? anchorT : null,
      anchorContext: String(contextSource.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1200),
      sourceType,
      pointText,
      sectionTitle,
    };
  }

  function captureExplainableSelection() {
    if (state.explanationDrawerOpen) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      hideExplainMenu();
      return;
    }
    const range = selection.getRangeAt(0).cloneRange();
    const container = explanationAllowedContainer(range);
    if (!container) {
      hideExplainMenu();
      return;
    }
    const text = selection.toString().replace(/\s+/g, " ").trim();
    const length = [...text].length;
    if (length < SkimlineCollections.MIN_SELECTION_CHARS) {
      hideExplainMenu();
      return;
    }
    if (length > MAX_EXPLANATION_SELECTION_CHARS) {
      hideExplainMenu();
      showToast("选择一小段内容，解释会更准确");
      return;
    }
    const rect = range.getBoundingClientRect();
    const anchor = explanationAnchorData(container);
    state.explanationSelection = {
      text,
      rect: {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      },
      videoId: state.videoId,
      videoTitle: state.videoTitle,
      targetLanguage: state.targetLanguage,
      ...anchor,
    };
    state.explanationRange = range;
    state.explanationAnchorContainer = container;
    elements.explainMenu.hidden = false;
    positionExplainMenu(rect);
  }

  function explanationOutline() {
    return state.points
      .map(
        (point) =>
          `[${Math.max(0, Math.floor(Number(point.t) || 0))}] ${String(
            point.point || "",
          ).trim()}：${String(point.detail || "").trim()}`,
      )
      .join("\n")
      .slice(0, 8000);
  }

  async function getExplanationCaptions(videoId, sourceTabId = state.tabId) {
    const existing =
      state.explanationCaptions?.videoId === videoId
        ? state.explanationCaptions
        : state.overviewCaptions?.videoId === videoId
          ? state.overviewCaptions
          : null;
    if (existing?.segments?.length) return existing;
    if (
      state.explanationCaptionsPromise &&
      state.explanationCaptionsPromiseVideoId === videoId
    ) {
      return state.explanationCaptionsPromise;
    }
    state.explanationCaptionsPromiseVideoId = videoId;
    state.explanationCaptionsPromise = tabMessageTo(sourceTabId, {
      type: "GET_CAPTION_SEGMENTS",
      videoId,
    })
      .then((captions) => {
        if (
          !captions?.ok ||
          captions.videoId !== videoId ||
          !captions.supported ||
          !Array.isArray(captions.segments) ||
          !captions.segments.length
        ) {
          throw new Error(
            captions?.error || "当前视频没有可用于解释的字幕",
          );
        }
        if (state.videoId === videoId) state.explanationCaptions = captions;
        return captions;
      })
      .finally(() => {
        if (state.explanationCaptionsPromiseVideoId === videoId) {
          state.explanationCaptionsPromise = null;
          state.explanationCaptionsPromiseVideoId = "";
        }
      });
    return state.explanationCaptionsPromise;
  }

  function cancelExplanationRequest(reason = "superseded") {
    state.explanationRequestId += 1;
    const message = state.explanationTaskId
      ? {
          type: "CANCEL_CONTEXT_EXPLANATION",
          taskId: state.explanationTaskId,
          reason,
        }
      : {
          type: "CANCEL_CONTEXT_EXPLANATION",
          clientId: state.explanationClientId,
          reason,
        };
    runtimeMessage(message).catch(() => null);
  }

  function clearExplanationLocalState({
    clearTask = true,
    clearDom = true,
  } = {}) {
    if (clearDom) {
      elements.explanationBody.replaceChildren();
      elements.explanationComposer.replaceChildren();
      elements.explanationLatest.hidden = true;
      elements.explanationTitle.textContent = "";
    }
    state.explanationHistory = [];
    state.explanationTurns = 0;
    state.explanationResult = null;
    state.explanationQuestion = "";
    state.explanationTaskStatus = "idle";
    if (clearTask) state.explanationTaskId = "";
  }

  function closeExplanation({
    clearSelection = true,
    dismiss = true,
    clearTask = true,
  } = {}) {
    const returnFocus =
      state.explanationAnchorContainer?.closest?.("button") ||
      elements.panel;
    hideExplainMenu();
    setExplanationDrawerVisible(false);
    if (dismiss && state.explanationTaskId) {
      runtimeMessage({
        type: "DISMISS_CONTEXT_EXPLANATION",
        taskId: state.explanationTaskId,
      }).catch(() => null);
    }
    state.explanationDismissed = dismiss;
    if (clearSelection) {
      clearExplanationHighlight();
      state.explanationSelection = null;
      state.explanationRange = null;
      state.explanationAnchorContainer = null;
      window.getSelection()?.removeAllRanges();
    }
    clearExplanationLocalState({ clearTask, clearDom: false });
    if (returnFocus === elements.panel) {
      elements.panel.setAttribute("tabindex", "-1");
    }
    returnFocus?.focus?.({ preventScroll: true });
  }

  function resetExplanationContext({
    cancel = false,
    dismiss = false,
  } = {}) {
    if (cancel) cancelExplanationRequest("context_reset");
    closeExplanation({ dismiss, clearTask: true });
    state.explanationCaptions = null;
    state.explanationCaptionsPromise = null;
    state.explanationCaptionsPromiseVideoId = "";
  }

  function makeElement(tag, className = "", text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function updateLibraryCount(count = state.clippings.length) {
    const normalizedCount = Math.max(0, Math.floor(Number(count) || 0));
    elements.libraryCount.textContent =
      normalizedCount > 999 ? "999+" : String(normalizedCount);
    elements.libraryCount.hidden = normalizedCount === 0;
    elements.libraryButton.setAttribute(
      "aria-label",
      normalizedCount
        ? `打开洞见库，已收藏 ${normalizedCount} 条`
        : "打开洞见库，暂无收藏",
    );
  }

  function renderLibraryEmpty(title, copy) {
    elements.libraryList.replaceChildren();
    elements.libraryEmptyTitle.textContent = title;
    elements.libraryEmptyCopy.textContent = copy;
    elements.libraryEmpty.hidden = false;
  }

  function clippingSourceLabel(item) {
    if (
      item.anchorT !== null &&
      item.anchorT !== undefined &&
      Number.isFinite(Number(item.anchorT))
    ) {
      return YouTubeSummary.formatTimestamp(item.anchorT);
    }
    return "从头观看";
  }

  function currentLibraryQuery() {
    return SkimlineCollections.normalizeClippingText(
      elements.librarySearch.value,
    ).toLowerCase();
  }

  function getLibraryGroups(rawQuery = elements.librarySearch.value) {
    return SkimlineCollections.groupClippingsByVideo(
      state.clippings,
      rawQuery,
      {
        videoTitles: state.videoTitles,
        targetLanguage: state.targetLanguage,
      },
    );
  }

  function reconcileLibraryExpansionState() {
    const validVideoIds = new Set(
      state.clippings.map((item) => item.videoId),
    );
    const reconciled = YouTubeSummary.reconcileLibraryExpansion(
      state.libraryExpandedVideoIds,
      state.libraryExpansionBeforeSearch,
      validVideoIds,
    );
    state.libraryExpandedVideoIds = reconciled.expandedVideoIds;
    state.libraryExpansionBeforeSearch =
      reconciled.expansionBeforeSearch;
    if (!validVideoIds.size) state.libraryExpansionInitialized = false;
  }

  function initializeLibraryExpansion(groups) {
    if (state.libraryExpansionInitialized || !groups.length) return;
    state.libraryExpandedVideoIds.add(groups[0].videoId);
    state.libraryExpansionInitialized = true;
  }

  function initializeVisibleLibraryExpansion() {
    if (state.activeView !== "library") return;
    initializeLibraryExpansion(getLibraryGroups(""));
  }

  function applyLibrarySearchTransition() {
    const groups = getLibraryGroups();
    const transition = YouTubeSummary.transitionLibrarySearchExpansion(
      {
        expandedVideoIds: state.libraryExpandedVideoIds,
        expansionBeforeSearch: state.libraryExpansionBeforeSearch,
        previousQuery: state.libraryLastQuery,
      },
      elements.librarySearch.value,
      groups.map((group) => group.videoId),
    );
    state.libraryExpandedVideoIds = transition.expandedVideoIds;
    state.libraryExpansionBeforeSearch = transition.expansionBeforeSearch;
    state.libraryLastQuery = transition.query;
    renderLibrary();
  }

  function expandRestoredVideoGroup(videoId) {
    if (!videoId) return;
    state.libraryExpandedVideoIds.add(videoId);
    if (state.libraryExpansionBeforeSearch instanceof Set) {
      state.libraryExpansionBeforeSearch.add(videoId);
    }
    state.libraryExpansionInitialized = true;
  }

  function createClippingCard(item) {
    const card = makeElement("article", "yvpm-clipping-card");
    card.setAttribute("role", "listitem");
    card.dataset.clippingId = item.id;

    const remove = makeElement("button", "yvpm-clipping-delete", "×");
    remove.type = "button";
    remove.setAttribute(
      "aria-label",
      `删除收藏：${item.kind === "answer" ? item.question : item.selectedText}`,
    );
    remove.addEventListener("click", () => deleteClippingById(item.id));

    if (item.kind === "answer") {
      const badge = makeElement("span", "yvpm-answer-kicker", "答卷 · 来自提问");
      const question = makeElement(
        "p",
        "yvpm-clipping-context",
        item.question,
      );
      const direct = makeElement(
        "blockquote",
        "yvpm-clipping-quote",
        item.directAnswer,
      );
      card.append(remove, badge, question, direct);
      if (item.steps?.length) {
        const list = makeElement("ol", "yvpm-answer-steps");
        for (const step of item.steps) {
          list.append(makeElement("li", "", step.text));
        }
        card.append(list);
      }
      if (item.notice) {
        card.append(makeElement("p", "yvpm-answer-notice", item.notice));
      }
      const footer = makeElement("footer", "yvpm-clipping-footer");
      const source = makeElement("button", "yvpm-clipping-source");
      source.type = "button";
      source.setAttribute(
        "aria-label",
        `回到视频 ${item.videoTitle} ${clippingSourceLabel(item)}`,
      );
      source.append(
        makeElement(
          "span",
          "yvpm-clipping-source-meta",
          `${clippingSourceLabel(item)} · ${YouTubeSummary.formatLibraryDate(item.savedAt)}`,
        ),
      );
      source.addEventListener("click", () => openClippingSource(item));
      footer.append(source);
      card.append(footer);
      return card;
    }

    const quote = makeElement(
      "blockquote",
      "yvpm-clipping-quote",
      item.selectedText,
    );
    card.append(remove, quote);

    if (
      item.pointText &&
      SkimlineCollections.normalizeClippingText(item.pointText) !==
        SkimlineCollections.normalizeClippingText(item.selectedText)
    ) {
      const context = makeElement("p", "yvpm-clipping-context");
      const label = makeElement("span", "", "所属观点");
      context.append(label, document.createTextNode(item.pointText));
      card.append(context);
    }

    const footer = makeElement("footer", "yvpm-clipping-footer");
    const source = makeElement("button", "yvpm-clipping-source");
    source.type = "button";
    source.setAttribute(
      "aria-label",
      `回到视频 ${item.videoTitle} ${clippingSourceLabel(item)}`,
    );
    const sourceMeta = makeElement(
      "span",
      "yvpm-clipping-source-meta",
      `${clippingSourceLabel(item)} · ${YouTubeSummary.formatLibraryDate(item.savedAt)}`,
    );
    source.append(sourceMeta);
    source.addEventListener("click", () => openClippingSource(item));

    footer.append(source);
    card.append(footer);
    return card;
  }

  function populateVideoGroupBody(body, group) {
    if (body.dataset.populated === "true") return;
    const fragment = document.createDocumentFragment();
    for (const item of group.items) fragment.append(createClippingCard(item));
    body.append(fragment);
    body.dataset.populated = "true";
  }

  function videoGroupDomId(videoId) {
    return `yvpm-library-video-${videoId}`;
  }

  function createVideoGroup(group, expanded) {
    const wrapper = makeElement("article", "yvpm-video-group");
    wrapper.setAttribute("role", "listitem");
    wrapper.dataset.videoId = group.videoId;
    wrapper.classList.toggle("yvpm-video-group-expanded", expanded);

    const toggle = makeElement("button", "yvpm-video-group-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-controls", videoGroupDomId(group.videoId));

    const count = makeElement(
      "span",
      "yvpm-video-group-count",
      String(group.totalCount),
    );
    count.setAttribute("aria-hidden", "true");
    const copy = makeElement("span", "yvpm-video-group-copy");
    const normalizedLibraryTitle = SkimlineCollections.normalizeClippingText(
      group.libraryTitle,
    );
    const normalizedOriginTitle = SkimlineCollections.normalizeClippingText(
      group.videoTitle,
    );
    const hasDistinctLibraryTitle = Boolean(
      normalizedLibraryTitle &&
        normalizedLibraryTitle.normalize("NFKC").toLocaleLowerCase() !==
          normalizedOriginTitle.normalize("NFKC").toLocaleLowerCase(),
    );
    const displayTitle = hasDistinctLibraryTitle
      ? normalizedLibraryTitle
      : normalizedOriginTitle;
    copy.classList.toggle(
      "yvpm-video-group-copy-localized",
      hasDistinctLibraryTitle,
    );
    const title = makeElement(
      "span",
      "yvpm-video-group-title",
      displayTitle,
    );
    title.classList.toggle(
      "yvpm-video-group-title-localized",
      hasDistinctLibraryTitle,
    );
    const metaCopy =
      currentLibraryQuery() && group.visibleCount < group.totalCount
        ? `匹配 ${group.visibleCount} 条 · 共 ${group.totalCount} 条收藏`
        : `${group.totalCount} 条收藏 · 最近收藏于${YouTubeSummary.formatLibraryDate(group.latestSavedAt)}`;
    const meta = makeElement("span", "yvpm-video-group-meta", metaCopy);
    copy.append(title);
    if (hasDistinctLibraryTitle) {
      const origin = makeElement(
        "span",
        "yvpm-video-group-origin",
        normalizedOriginTitle,
      );
      origin.setAttribute("aria-hidden", "true");
      copy.append(origin);
    }
    copy.append(meta);
    const chevron = makeElement("span", "yvpm-video-group-chevron", "⌄");
    chevron.setAttribute("aria-hidden", "true");
    toggle.append(count, copy, chevron);
    toggle.setAttribute("aria-label", `${displayTitle}，${metaCopy}`);

    const body = makeElement("div", "yvpm-video-group-body");
    body.id = videoGroupDomId(group.videoId);
    body.setAttribute("role", "list");
    body.setAttribute("aria-label", `${displayTitle}的收藏`);
    body.hidden = !expanded;
    if (expanded) populateVideoGroupBody(body, group);

    toggle.addEventListener("click", () => {
      const nextExpanded = !state.libraryExpandedVideoIds.has(group.videoId);
      if (nextExpanded) state.libraryExpandedVideoIds.add(group.videoId);
      else state.libraryExpandedVideoIds.delete(group.videoId);
      wrapper.classList.toggle("yvpm-video-group-expanded", nextExpanded);
      toggle.setAttribute("aria-expanded", String(nextExpanded));
      body.hidden = !nextExpanded;
      if (nextExpanded) populateVideoGroupBody(body, group);
    });

    wrapper.append(toggle, body);
    return wrapper;
  }

  function renderLibrary() {
    const total = state.clippings.length;
    const query = currentLibraryQuery();
    const groups = getLibraryGroups();
    const matches = groups.flatMap((group) => group.items);
    const visibleMatches = matches.slice(
      0,
      SkimlineCollections.MAX_VISIBLE_CLIPPINGS,
    );
    const hiddenMatchCount = matches.length - visibleMatches.length;
    const visibleIds = new Set(visibleMatches.map((item) => item.id));
    const visibleGroups = groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => visibleIds.has(item.id)),
      }))
      .filter((group) => group.items.length);
    elements.libraryTotal.textContent = query
      ? `找到 ${groups.length} 个视频 · ${matches.length} 条收藏${
          hiddenMatchCount ? ` · 显示前 ${visibleMatches.length} 条` : ""
        }`
      : `${groups.length} 个视频 · ${total} 条收藏${
          hiddenMatchCount ? ` · 显示最近 ${visibleMatches.length} 条` : ""
        }`;
    elements.librarySearchClear.hidden = !query;
    updateLibraryCount(total);

    if (state.libraryError) {
      renderLibraryEmpty("暂时无法读取洞见库", state.libraryError);
      return;
    }
    if (!total) {
      renderLibraryEmpty(
        "还没有收藏",
        "在摘要中圈选一段文字，就可以把它留在这里。",
      );
      return;
    }
    if (!groups.length) {
      renderLibraryEmpty(
        "没有找到相关收藏",
        "换一个关键词，搜索收藏内容或视频标题。",
      );
      return;
    }

    elements.libraryEmpty.hidden = true;
    const fragment = document.createDocumentFragment();
    for (const group of visibleGroups) {
      fragment.append(
        createVideoGroup(
          group,
          state.libraryExpandedVideoIds.has(group.videoId),
        ),
      );
    }
    elements.libraryList.replaceChildren(fragment);
  }

  async function loadClippings({ render = true } = {}) {
    const requestId = ++state.libraryRequestId;
    try {
      const response = await runtimeMessage({ type: "LIST_CLIPPINGS" });
      if (requestId !== state.libraryRequestId) return false;
      if (!response?.ok) {
        throw new Error(response?.error || "读取洞见库失败");
      }
      if (
        Number(response.revision) < state.clippingsRevision
      ) {
        return false;
      }
      state.clippings = SkimlineCollections.buildClippingsView(response.items);
      state.videoTitles = SkimlineCollections.normalizeVideoTitles(
        response.videoTitles,
      );
      state.clippingsRevision = Math.max(0, Number(response.revision) || 0);
      state.libraryError = "";
      reconcileLibraryExpansionState();
      initializeVisibleLibraryExpansion();
      updateLibraryCount();
      if (render && state.activeView === "library") renderLibrary();
      return true;
    } catch (error) {
      if (requestId !== state.libraryRequestId) return false;
      state.libraryError = error?.message || "读取洞见库失败，请重试";
      if (render && state.activeView === "library") renderLibrary();
      return false;
    }
  }

  async function openLibrary() {
    if (state.activeView === "library") return;
    setFollowPlayback(false);
    state.summaryScrollTop = window.scrollY;
    state.activeView = "library";
    if (!elements.explanationCard.hidden) closeExplanation();
    else {
      hideExplainMenu();
      clearCapturedSelection();
    }
    elements.panel.hidden = true;
    elements.library.hidden = false;
    elements.libraryButton.setAttribute("aria-pressed", "true");
    window.scrollTo(0, 0);
    initializeLibraryExpansion(getLibraryGroups(""));
    renderLibrary();
    requestAnimationFrame(() => elements.librarySearch.focus());
    const loadRequestId = state.libraryRequestId + 1;
    await loadClippings({ render: false });
    if (
      state.activeView !== "library" ||
      state.libraryRequestId !== loadRequestId
    ) {
      return;
    }
    initializeLibraryExpansion(getLibraryGroups(""));
    renderLibrary();
  }

  function closeLibrary() {
    if (state.activeView !== "library") return;
    state.activeView = "summary";
    elements.library.hidden = true;
    elements.panel.hidden = false;
    elements.libraryButton.setAttribute("aria-pressed", "false");
    requestAnimationFrame(() => window.scrollTo(0, state.summaryScrollTop));
    if (state.loaded) void showClippingHintOnce();
  }

  function setLibraryBackupBusy(busy) {
    state.libraryBackupBusy = Boolean(busy);
    elements.libraryExport.disabled = state.libraryBackupBusy;
    elements.libraryImport.disabled = state.libraryBackupBusy;
  }

  async function exportClippingsBackup() {
    if (state.libraryBackupBusy) return;
    setLibraryBackupBusy(true);
    try {
      const response = await runtimeMessage({
        type: "EXPORT_CLIPPINGS_BACKUP",
      });
      if (!response?.ok || !response.backup) {
        throw new Error(response?.error || "导出收藏失败");
      }
      const blob = new Blob(
        [`${JSON.stringify(response.backup, null, 2)}\n`],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = response.filename || "skimline-clippings.json";
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      showToast(`已导出 ${Math.max(0, Number(response.count) || 0)} 条收藏`);
    } catch (error) {
      showToast(error?.message || "导出收藏失败");
    } finally {
      setLibraryBackupBusy(false);
    }
  }

  async function importClippingsBackupFile(file) {
    if (state.libraryBackupBusy || !file) return;
    setLibraryBackupBusy(true);
    try {
      if (file.size > 50 * 1024 * 1024) {
        throw new Error("备份文件不能超过 50 MB");
      }
      let backup;
      try {
        backup = JSON.parse(await file.text());
      } catch {
        throw new Error("备份文件不是有效的 JSON");
      }
      const response = await runtimeMessage({
        type: "IMPORT_CLIPPINGS_BACKUP",
        backup,
      });
      if (!response?.ok) {
        throw new Error(response?.error || "导入收藏失败");
      }
      state.clippingsRevision = Math.max(
        state.clippingsRevision,
        Number(response.revision) || 0,
      );
      await loadClippings();
      showToast(
        response.changed
          ? `导入完成，共 ${Math.max(0, Number(response.count) || 0)} 条收藏`
          : "备份内容已经存在",
      );
    } catch (error) {
      showToast(error?.message || "导入收藏失败");
    } finally {
      elements.libraryImportFile.value = "";
      setLibraryBackupBusy(false);
    }
  }

  async function restoreClippingItem(item) {
    const recreatesVideoGroup = !state.clippings.some(
      (candidate) => candidate.videoId === item?.videoId,
    );
    const response = await runtimeMessage({
      type: "RESTORE_CLIPPING",
      item,
    });
    if (!response?.ok) {
      throw new Error(response?.error || "撤销删除失败");
    }
    state.clippingsRevision = Math.max(
      state.clippingsRevision,
      Number(response.revision) || 0,
    );
    if (recreatesVideoGroup) expandRestoredVideoGroup(response.item?.videoId);
    upsertClipping(response.item);
    showToast(response.duplicate ? "这段已经在洞见库中" : "已恢复收藏");
  }

  async function deleteClippingById(id) {
    try {
      const response = await runtimeMessage({
        type: "DELETE_CLIPPING",
        id,
      });
      if (!response?.ok) {
        throw new Error(response?.error || "删除收藏失败");
      }
      if (!response.deletedItem) {
        void loadClippings();
        showToast("这条收藏已经被删除");
        return;
      }
      state.clippingsRevision = Math.max(
        state.clippingsRevision,
        Number(response.revision) || 0,
      );
      state.clippings = state.clippings.filter((item) => item.id !== id);
      reconcileLibraryExpansionState();
      renderLibrary();
      showToast("已删除", {
        actionLabel: "撤销",
        onAction: () => restoreClippingItem(response.deletedItem),
        duration: 4000,
      });
    } catch (error) {
      showToast(error?.message || "删除收藏失败");
    }
  }

  function updateTabUrl(tabId, url) {
    return new Promise((resolve, reject) => {
      chrome.tabs.update(tabId, { url }, (tab) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(tab);
      });
    });
  }

  function createTabWithUrl(url) {
    return new Promise((resolve, reject) => {
      chrome.tabs.create({ url }, (tab) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(tab);
      });
    });
  }

  async function openClippingSource(item) {
    const url = new URL("https://www.youtube.com/watch");
    url.searchParams.set("v", item.videoId);
    if (
      item.anchorT !== null &&
      item.anchorT !== undefined &&
      Number.isFinite(Number(item.anchorT))
    ) {
      url.searchParams.set("t", `${Math.floor(Number(item.anchorT))}s`);
    }
    closeLibrary();
    try {
      if (state.tabId && state.videoId) {
        await updateTabUrl(state.tabId, url.href);
      } else {
        await createTabWithUrl(url.href);
      }
    } catch {
      try {
        await createTabWithUrl(url.href);
      } catch {
        showToast("暂时无法打开来源视频");
      }
    }
  }

  async function showClippingHintOnce() {
    if (state.clippingHintChecked || state.activeView !== "summary") return;
    state.clippingHintChecked = true;
    try {
      const stored = await chrome.storage.local.get(
        CLIPPING_HINT_SETTING_KEY,
      );
      if (stored?.[CLIPPING_HINT_SETTING_KEY]) return;
      if (state.activeView !== "summary") {
        state.clippingHintChecked = false;
        return;
      }
      showToast("圈选摘要中的文字，可以收藏、解释或复制", {
        duration: 3600,
      });
      await chrome.storage.local.set({
        [CLIPPING_HINT_SETTING_KEY]: true,
      });
    } catch {
      // 首次提示失败不影响收藏功能。
    }
  }

  function showExplanationCard() {
    state.explanationDismissed = false;
    setExplanationDrawerVisible(true);
  }

  function renderExplanationLoading({
    message = "正在结合整段视频理解这段内容…",
    hint = "会优先查看当前时间附近的字幕，再检索整段视频。",
  } = {}) {
    elements.explanationTitle.textContent =
      state.explanationSelection?.text || "解释所选内容";
    const status = makeElement("div", "yvpm-explanation-loading");
    const spinner = makeElement("span", "yvpm-spinner");
    spinner.setAttribute("aria-hidden", "true");
    status.append(spinner, document.createTextNode(message));
    const hintElement = makeElement(
      "p",
      "yvpm-explanation-loading-hint",
      hint,
    );
    elements.explanationBody.replaceChildren(status, hintElement);
    elements.explanationComposer.replaceChildren();
    elements.explanationLatest.hidden = true;
    showExplanationCard();
  }

  function renderEvidenceButtons(evidence) {
    const items = Array.isArray(evidence) ? evidence : [];
    if (!items.length) return null;
    const group = makeElement("div", "yvpm-explanation-evidence");
    for (const item of items) {
      const button = makeElement(
        "button",
        "yvpm-explanation-evidence-button",
        `▶ 查看依据 · ${item.label}`,
      );
      button.type = "button";
      button.addEventListener("click", () => {
        void seekWithFeedback(item.t);
      });
      group.append(button);
    }
    return group;
  }

  function renderExplanationComposer({ busy = false } = {}) {
    elements.explanationComposer.replaceChildren();
    if (
      !state.explanationResult ||
      state.explanationTurns >= MAX_EXPLANATION_TURNS
    ) {
      return;
    }
    const meta = makeElement("div", "yvpm-explanation-composer-meta");
    meta.append(
      makeElement(
        "span",
        "",
        busy ? "正在回答本轮问题…" : "继续追问这个概念",
      ),
      makeElement(
        "strong",
        "",
        `${state.explanationTurns} / ${MAX_EXPLANATION_TURNS}`,
      ),
    );
    const form = makeElement("form", "yvpm-explanation-form");
    const input = makeElement("input");
    input.type = "text";
    input.maxLength = MAX_EXPLANATION_SELECTION_CHARS;
    input.placeholder = "继续问这个概念…";
    input.setAttribute("aria-label", "继续追问");
    input.disabled = busy;
    const submit = makeElement("button", "", "↑");
    submit.type = "submit";
    submit.disabled = busy;
    submit.setAttribute("aria-label", "发送问题");
    form.append(input, submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      askExplanation(input.value);
    });
    elements.explanationComposer.append(meta, form);
  }

  function createExplanationTurn(question, answer, index, open) {
    const details = makeElement("details", "yvpm-explanation-turn");
    details.open = open;
    const summary = document.createElement("summary");
    summary.append(
      makeElement("span", "yvpm-explanation-turn-index", String(index + 1)),
      makeElement("span", "yvpm-explanation-turn-question", question),
      makeElement("span", "yvpm-explanation-turn-chevron", "⌄"),
    );
    const response = makeElement(
      "p",
      "yvpm-explanation-turn-answer",
      answer,
    );
    details.append(summary, response);
    return details;
  }

  function renderExplanationCard({ busy = false } = {}) {
    const result = state.explanationResult;
    if (!result) return;
    elements.explanationTitle.textContent =
      state.explanationSelection?.text || "解释所选内容";
    const scroller = elements.explanationBody;
    const previousTop = scroller.scrollTop;
    const distanceFromBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const followLatest = distanceFromBottom < 72;
    const fragment = document.createDocumentFragment();

    if (result.simple) {
      const block = makeElement("section", "yvpm-explanation-block");
      block.append(
        makeElement("span", "yvpm-explanation-block-label", "简单说"),
        makeElement("p", "", result.simple),
      );
      fragment.append(block);
    }

    if (result.inVideo) {
      const block = makeElement(
        "section",
        "yvpm-explanation-block yvpm-explanation-video-block",
      );
      block.append(
        makeElement(
          "span",
          "yvpm-explanation-block-label yvpm-explanation-video-label",
          "在这段视频里",
        ),
        makeElement("p", "", result.inVideo),
      );
      const evidence = renderEvidenceButtons(result.evidence);
      if (evidence) block.append(evidence);
      fragment.append(block);
    }

    if (result.uncertain || result.notice) {
      fragment.append(
        makeElement(
          "p",
          "yvpm-explanation-notice",
          result.notice || "当前字幕不足以确定这个概念的具体含义。",
        ),
      );
    }

    const followupHistory = state.explanationHistory.slice(1);
    if (followupHistory.length || state.explanationQuestion) {
      const conversation = makeElement(
        "div",
        "yvpm-explanation-conversation",
      );
      const turns = [];
      for (let index = 0; index < followupHistory.length; index += 2) {
        const question = followupHistory[index];
        const answer = followupHistory[index + 1];
        if (question?.role !== "user" || answer?.role !== "assistant") continue;
        turns.push({ question: question.content, answer: answer.content });
      }
      turns.forEach((turn, index) => {
        conversation.append(
          createExplanationTurn(
            turn.question,
            turn.answer,
            index,
            index === turns.length - 1 && !busy,
          ),
        );
      });
      if (busy && state.explanationQuestion) {
        const pending = createExplanationTurn(
          state.explanationQuestion,
          "正在回答…",
          turns.length,
          true,
        );
        pending
          .querySelector(".yvpm-explanation-turn-answer")
          ?.classList.add("yvpm-explanation-message-pending");
        conversation.append(pending);
      }
      fragment.append(conversation);
    }

    if (
      state.explanationTurns < MAX_EXPLANATION_TURNS &&
      result.suggestedQuestions?.length
    ) {
      const suggestions = makeElement(
        "div",
        "yvpm-explanation-suggestions",
      );
      for (const question of result.suggestedQuestions) {
        const button = makeElement("button", "", question);
        button.type = "button";
        button.disabled = busy;
        button.addEventListener("click", () => askExplanation(question));
        suggestions.append(button);
      }
      fragment.append(suggestions);
    }

    if (state.explanationTurns >= MAX_EXPLANATION_TURNS) {
      fragment.append(
        makeElement(
          "p",
          "yvpm-explanation-turn-limit",
          "这次解释已完成 3 轮追问。重新圈选内容可以开始新的解释。",
        ),
      );
    }

    fragment.append(
      makeElement(
        "p",
        "yvpm-explanation-grounding",
        "解释基于完整字幕；通用定义由 AI 补充，视频观点已单独标注",
      ),
    );
    elements.explanationBody.replaceChildren(fragment);
    renderExplanationComposer({ busy });
    showExplanationCard();
    requestAnimationFrame(() => {
      if (followLatest) {
        scroller.scrollTop = scroller.scrollHeight;
        elements.explanationLatest.hidden = true;
      } else {
        scroller.scrollTop = previousTop;
        elements.explanationLatest.hidden = false;
      }
    });
  }

  function renderExplanationError(message, retry) {
    const error = makeElement(
      "p",
      "yvpm-explanation-error",
      message || "解释失败，请重试",
    );
    const button = makeElement("button", "", "重试");
    button.type = "button";
    button.addEventListener("click", retry);
    elements.explanationBody.replaceChildren(error, button);
    elements.explanationComposer.replaceChildren();
    elements.explanationLatest.hidden = true;
    showExplanationCard();
  }

  function explanationRequestPayload(
    captions,
    selection = state.explanationSelection,
    videoOutline = explanationOutline(),
  ) {
    return {
      clientId: state.explanationClientId,
      videoId: selection.videoId,
      sourceTabId: state.explanationSourceTabId,
      targetLanguage: selection.targetLanguage || state.targetLanguage,
      sourceLang: captions.sourceLang || "",
      selectedText: selection.text,
      anchorT: selection.anchorT,
      anchorContext: selection.anchorContext,
      sourceType: selection.sourceType,
      pointText: selection.pointText,
      sectionTitle: selection.sectionTitle,
      videoTitle: selection.videoTitle,
      videoOutline,
      segments: Array.isArray(captions.segments) ? captions.segments : [],
    };
  }

  function taskSelectionForUi(task) {
    const selection = task?.selection || {};
    return {
      text: String(selection.selectedText || ""),
      videoId: String(task?.videoId || selection.videoId || ""),
      videoTitle: String(selection.videoTitle || ""),
      targetLanguage: String(task?.targetLanguage || ""),
      anchorT:
        Number.isFinite(Number(selection.anchorT))
          ? Number(selection.anchorT)
          : null,
      anchorContext: String(selection.anchorContext || ""),
      sourceType: String(selection.sourceType || "claim"),
      pointText: String(selection.pointText || ""),
      sectionTitle: String(selection.sectionTitle || ""),
      rect: null,
    };
  }

  function applyExplanationTask(task, { open = true } = {}) {
    if (!task?.taskId) return;
    state.explanationTaskId = task.taskId;
    state.explanationTaskStatus = String(task.status || "idle");
    state.explanationTurns = Math.max(0, Number(task.turns) || 0);
    state.explanationHistory = Array.isArray(task.history)
      ? task.history
      : [];
    state.explanationResult = task.result || null;
    state.explanationQuestion = String(task.pendingQuestion || "");
    state.explanationDismissed = Boolean(task.dismissed);
    if (
      !state.explanationSelection ||
      state.explanationSelection.videoId !== task.videoId
    ) {
      state.explanationSelection = taskSelectionForUi(task);
      state.explanationRange = null;
      state.explanationAnchorContainer = null;
    }
    if (task.status === "failed") {
      if (open) {
        if (task.result) {
          state.explanationQuestion = "";
          renderExplanationCard();
          showToast(task.error || "本轮回答失败，可以重新提问");
        } else {
          renderExplanationError(
            task.error || "解释失败，请重试",
            runInitialExplanation,
          );
        }
      }
      return;
    }
    if (!task.result) {
      if (open) renderExplanationLoading();
      return;
    }
    if (open) {
      renderExplanationCard({
        busy:
          task.status === "queued" ||
          task.status === "running" ||
          task.status === "recovering",
      });
    }
  }

  async function restoreExplanationTaskForVideo(videoId) {
    if (!videoId) return;
    try {
      const response = await runtimeMessage({
        type: "GET_CONTEXT_EXPLANATION_TASK",
        videoId,
        targetLanguage: state.targetLanguage,
      });
      if (
        !response?.ok ||
        !response.task ||
        response.task.dismissed ||
        response.task.videoId !== state.videoId ||
        response.task.targetLanguage !== state.targetLanguage ||
        ["cancelled", "expired"].includes(response.task.status)
      ) {
        return;
      }
      applyExplanationTask(response.task, { open: true });
    } catch {
      // 解释恢复失败不影响视频摘要。
    }
  }

  async function runInitialExplanation() {
    const selection = state.explanationSelection
      ? { ...state.explanationSelection }
      : null;
    if (!selection || selection.videoId !== state.videoId) {
      hideExplainMenu();
      return;
    }
    hideExplainMenu();
    highlightExplanationRange();
    state.explanationHistory = [];
    state.explanationTurns = 0;
    state.explanationResult = null;
    state.explanationQuestion = "";
    const requestId = ++state.explanationRequestId;
    const videoId = selection.videoId;
    const sourceTabId = state.tabId;
    const videoOutline = explanationOutline();
    state.explanationSourceTabId = sourceTabId;
    renderExplanationLoading({
      message: "正在读取视频上下文…",
      hint: "会先读取当前时间附近的字幕，再检索整段视频。",
    });
    try {
      let captions = {
        videoId,
        sourceLang: "",
        segments: [],
      };
      try {
        captions = await getExplanationCaptions(videoId, sourceTabId);
      } catch {
        // 字幕暂时不可用时仍提供通用解释；后台会明确标记无法确认视频语境。
      }
      if (requestId !== state.explanationRequestId) return;
      if (state.explanationDrawerOpen) renderExplanationLoading();
      const response = await runtimeMessage({
        type: "START_CONTEXT_EXPLANATION",
        payload: explanationRequestPayload(
          captions,
          selection,
          videoOutline,
        ),
      });
      if (!response?.ok) {
        throw new Error(response?.error || "解释失败，请重试");
      }
      if (requestId !== state.explanationRequestId) {
        runtimeMessage({
          type: "CANCEL_CONTEXT_EXPLANATION",
          taskId: response.task?.taskId,
          reason: "superseded",
        }).catch(() => null);
        return;
      }
      if (state.explanationDismissed) {
        runtimeMessage({
          type: "DISMISS_CONTEXT_EXPLANATION",
          taskId: response.task?.taskId,
        }).catch(() => null);
        return;
      }
      const stillCurrentSelection =
        videoId === state.videoId &&
        state.explanationDrawerOpen;
      applyExplanationTask(response.task, { open: stillCurrentSelection });
    } catch (error) {
      if (
        requestId !== state.explanationRequestId ||
        !state.explanationDrawerOpen
      ) {
        return;
      }
      if (error?.message === "解释已取消") return;
      renderExplanationError(error?.message, runInitialExplanation);
    }
  }

  async function askExplanation(rawQuestion) {
    const question = String(rawQuestion || "").replace(/\s+/g, " ").trim();
    if (!question || !state.explanationResult) return;
    if ([...question].length > MAX_EXPLANATION_SELECTION_CHARS) {
      showToast("问题控制在 200 个字以内会更准确");
      return;
    }
    if (
      state.explanationTurns >= MAX_EXPLANATION_TURNS ||
      !state.explanationTaskId ||
      ["queued", "running", "recovering"].includes(
        state.explanationTaskStatus,
      )
    ) {
      return;
    }
    state.explanationQuestion = question;
    state.explanationTaskStatus = "queued";
    renderExplanationCard({ busy: true });
    try {
      const response = await runtimeMessage({
        type: "ASK_CONTEXT_EXPLANATION",
        payload: {
          taskId: state.explanationTaskId,
          question,
          expectedTurn: state.explanationTurns,
        },
      });
      if (!response?.ok) {
        throw new Error(response?.error || "回答失败，请重试");
      }
      applyExplanationTask(response.task, {
        open: state.explanationDrawerOpen,
      });
    } catch (error) {
      state.explanationQuestion = "";
      state.explanationTaskStatus = "complete";
      renderExplanationCard();
      if (error?.message !== "解释已取消") {
        showToast(error?.message || "回答失败，请重试");
      }
    }
  }

  function clearCapturedSelection() {
    clearExplanationHighlight();
    state.explanationSelection = null;
    state.explanationRange = null;
    state.explanationAnchorContainer = null;
    window.getSelection()?.removeAllRanges();
  }

  function upsertClipping(item) {
    if (!item) return;
    state.clippings = SkimlineCollections.buildClippingsView([
      item,
      ...state.clippings,
    ]);
    reconcileLibraryExpansionState();
    initializeVisibleLibraryExpansion();
    updateLibraryCount();
    if (state.activeView === "library") renderLibrary();
  }

  async function saveCurrentSelection() {
    const selection = state.explanationSelection;
    if (
      state.clippingSaving ||
      !selection ||
      !selection.videoId ||
      selection.videoId !== state.videoId
    ) {
      hideExplainMenu();
      return;
    }
    state.clippingSaving = true;
    elements.saveSelection.disabled = true;
    hideExplainMenu();
    try {
      const response = await runtimeMessage({
        type: "SAVE_CLIPPING",
        payload: {
          selectedText: selection.text,
          videoId: selection.videoId,
          videoTitle:
            selection.videoTitle ||
            state.videoTitle ||
            `YouTube 视频 ${selection.videoId}`,
          anchorT: selection.anchorT,
          sourceType: selection.sourceType,
          pointText: selection.pointText,
          sectionTitle: selection.sectionTitle,
          targetLanguage: selection.targetLanguage,
        },
      });
      if (!response?.ok) {
        throw new Error(response?.error || "收藏失败，请重试");
      }
      state.clippingsRevision = Math.max(
        state.clippingsRevision,
        Number(response.revision) || 0,
      );
      upsertClipping(response.item);
      clearCapturedSelection();
      showToast(response.duplicate ? "这段已收藏过" : "已收藏到洞见库");
    } catch (error) {
      showToast(error?.message || "收藏失败，请重试");
      if (
        state.explanationSelection === selection &&
        selection.videoId === state.videoId
      ) {
        elements.explainMenu.hidden = false;
        positionExplainMenu();
      }
    } finally {
      state.clippingSaving = false;
      elements.saveSelection.disabled = false;
    }
  }

  async function saveCurrentAnswer() {
    const answer = state.answerResult;
    if (!answer || !state.videoId || elements.answerSave.disabled) return;
    elements.answerSave.disabled = true;
    try {
      const response = await runtimeMessage({
        type: "SAVE_ANSWER_CLIPPING",
        payload: {
          kind: "answer",
          videoId: state.videoId,
          videoTitle: state.videoTitle,
          targetLanguage: state.targetLanguage,
          question: state.answerQuestion,
          directAnswer: answer.directAnswer,
          evidenceTs: answer.evidenceTs,
          steps: answer.steps,
          uncertain: answer.uncertain,
          notice: answer.notice,
          usedCaptions: answer.usedCaptions,
        },
      });
      if (!response?.ok) {
        throw new Error(response?.error || "收藏答卷失败，请重试");
      }
      state.clippingsRevision = Math.max(
        state.clippingsRevision,
        Number(response.revision) || 0,
      );
      upsertClipping(response.item);
      state.answerSavedFingerprint = answerFingerprint();
      updateAnswerSaveButton();
      showToast(response.replacedIds?.length ? "已更新收藏答卷" : "已收藏到洞见库");
    } catch (error) {
      showToast(error?.message || "收藏答卷失败，请重试");
      updateAnswerSaveButton();
    }
  }

  async function copyExplanationSelection() {
    const text = state.explanationSelection?.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast("已复制所选内容");
    } catch {
      showToast("复制失败，请使用系统复制快捷键");
    } finally {
      hideExplainMenu();
    }
  }

  function stopPrepareCountdown() {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }

  function startPrepareCountdown() {
    if (
      !state.preparing ||
      !state.pendingCaptions ||
      state.countdownTimer ||
      !elements.languageMenu.hidden
    ) {
      return;
    }
    elements.countdown.textContent = String(state.countdownRemaining);
    state.countdownTimer = setInterval(() => {
      state.countdownRemaining -= 1;
      elements.countdown.textContent = String(
        Math.max(0, state.countdownRemaining),
      );
      if (state.countdownRemaining <= 0) {
        const captions = state.pendingCaptions;
        stopPrepareCountdown();
        generateFromCaptions(captions);
      }
    }, 1000);
  }

  function hidePrepare() {
    stopPrepareCountdown();
    state.preparing = false;
    state.pendingCaptions = null;
    state.countdownRemaining = 0;
    elements.prepare.hidden = true;
  }

  function generationLanguageLabel() {
    return (
      GENERATING_LANGUAGE_LABELS[state.targetLanguage] ||
      languageDisplayName(state.targetLanguage)
    );
  }

  function setGeneratingVisible(visible) {
    elements.generationBar.hidden = !visible;
    elements.panel.classList.toggle("yvpm-is-generating", visible);
    if (visible) {
      elements.generationCopy.textContent =
        `正在生成${generationLanguageLabel()}摘要…`;
    }
  }

  function sourceLanguageDisplayName(sourceLanguage) {
    if (!sourceLanguage) return "当前视频";
    try {
      return new Intl.DisplayNames([navigator.language || "zh-CN"], {
        type: "language",
      }).of(sourceLanguage);
    } catch {
      return sourceLanguage;
    }
  }

  function showPrepare(captions) {
    hideProgress();
    setStatus("");
    setGeneratingVisible(false);
    state.preparing = true;
    state.pendingCaptions = captions;
    state.overviewCaptions = captions;
    elements.prepareCopy.textContent =
      `视频字幕语言为${sourceLanguageDisplayName(captions.sourceLang)}，摘要将使用右上角选择的语言呈现。`;
    elements.prepare.hidden = false;
    stopPrepareCountdown();
    state.countdownRemaining = PREPARE_COUNTDOWN_SECONDS;
    elements.countdown.textContent = String(state.countdownRemaining);
    startPrepareCountdown();
  }

  function generationId() {
    return `${state.videoId}:${state.targetLanguage}:${Date.now()}:${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  function setStatus(message, kind = "loading", action = null) {
    elements.status.className = `yvpm-status-${kind}`;
    elements.status.replaceChildren();
    if (!message) {
      elements.status.hidden = true;
      return;
    }
    if (kind === "loading") {
      const spinner = document.createElement("span");
      spinner.className = "yvpm-spinner";
      spinner.setAttribute("aria-hidden", "true");
      elements.status.append(spinner);
    }
    elements.status.append(document.createTextNode(message));
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "yvpm-status-action";
      button.textContent = action.label;
      button.addEventListener("click", action.onClick);
      elements.status.append(document.createTextNode(" "));
      elements.status.append(button);
    }
    elements.status.hidden = false;
  }

  function hideProgress() {
    elements.progress.hidden = true;
    elements.progressText.textContent = "";
  }

  function updateProgress(index, total) {
    if (Number.isInteger(index) && index >= 0) {
      state.receivedChunkIndexes.add(index);
    }
    if (Number.isInteger(total) && total > 0) state.totalChunks = total;
    if (!state.totalChunks) return;
    elements.progressText.textContent =
      `生成中 · ${state.receivedChunkIndexes.size}/${state.totalChunks} 段`;
    elements.progress.hidden = false;
  }

  function answerClientId() {
    return `answer-tab-${Number.isInteger(state.tabId) ? state.tabId : "none"}`;
  }

  function answerOperationId(prefix = "answer") {
    return `${prefix}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }

  function answerFingerprint(answer = state.answerResult) {
    if (!answer) return "";
    return JSON.stringify([
      state.answerQuestion,
      answer.directAnswer,
      answer.evidenceTs,
      (answer.steps || []).map((step) => [step.text, step.sourceTs]),
      Boolean(answer.uncertain),
      String(answer.notice || ""),
      Boolean(answer.usedCaptions),
    ]);
  }

  function savedAnswerFingerprint(item) {
    if (item?.kind !== "answer") return "";
    return JSON.stringify([
      item.question,
      item.directAnswer,
      item.evidenceTs,
      (item.steps || []).map((step) => [step.text, step.sourceTs]),
      Boolean(item.uncertain),
      String(item.notice || ""),
      Boolean(item.usedCaptions),
    ]);
  }

  function syncAnswerSavedFingerprint() {
    const normalizedQuestion = YouTubeSummary.normalizeAnswerQuestion(
      state.answerQuestion,
    );
    const saved = state.clippings.find(
      (item) =>
        item.kind === "answer" &&
        item.videoId === state.videoId &&
        item.targetLanguage === state.targetLanguage &&
        YouTubeSummary.normalizeAnswerQuestion(item.question) ===
          normalizedQuestion,
    );
    state.answerSavedFingerprint = savedAnswerFingerprint(saved);
  }

  function updateAnswerSaveButton() {
    if (!state.answerResult) {
      elements.answerSave.disabled = true;
      elements.answerSave.textContent = "收藏这份答卷";
      return;
    }
    const current = answerFingerprint();
    elements.answerSave.disabled =
      Boolean(state.answerSavedFingerprint) &&
      state.answerSavedFingerprint === current;
    elements.answerSave.textContent = elements.answerSave.disabled
      ? "已收藏"
      : state.answerSavedFingerprint
        ? "更新收藏"
        : "收藏这份答卷";
  }

  function createAnswerTimeButton(timestamp, labelPrefix = "跳到依据") {
    const value = Math.max(0, Math.floor(Number(timestamp) || 0));
    const button = makeElement(
      "button",
      "yvpm-answer-time",
      YouTubeSummary.formatTimestamp(value),
    );
    button.type = "button";
    button.setAttribute(
      "aria-label",
      `${labelPrefix} ${YouTubeSummary.formatTimestamp(value)}`,
    );
    button.addEventListener("click", () => {
      void seekWithFeedback(value, { followPlayback: true });
    });
    return button;
  }

  function renderAnswerTask(task = null) {
    const status = String(task?.status || state.answerTaskStatus || "idle");
    const answer = state.answerResult;
    const busy = status === "queued" || status === "running";
    elements.answer.hidden = false;
    elements.answerQuestion.textContent = state.answerQuestion;
    elements.answerLoading.hidden = Boolean(answer) || !busy;
    elements.answerLoadingCopy.textContent =
      status === "queued" ? "答卷正在排队…" : "正在综合摘要…";
    elements.answerContent.hidden = !answer;
    if (!answer) {
      if (status === "failed") {
        elements.answerLoading.hidden = true;
        elements.answerContent.hidden = false;
        elements.answerDirect.textContent = "";
        elements.answerEvidence.replaceChildren();
        elements.answerSteps.replaceChildren();
        elements.answerStepsWrap.hidden = true;
        elements.answerCaptionNote.hidden = true;
        elements.answerNotice.hidden = true;
        elements.answerComplete.hidden = true;
        elements.answerError.hidden = false;
        const retry = makeElement("button", "yvpm-intent-retry", "重试");
        retry.type = "button";
        retry.addEventListener("click", () => {
          void runAnswer(state.answerQuestion, { force: true });
        });
        elements.answerError.replaceChildren(
          document.createTextNode(task?.error || "答卷生成失败，请重试。"),
          document.createTextNode(" "),
          retry,
        );
        elements.answerSave.disabled = true;
        elements.answerFollowupForm.hidden = true;
      }
      return;
    }

    elements.answerDirect.textContent = answer.directAnswer;
    elements.answerEvidence.replaceChildren(
      ...(answer.evidenceTs || []).map((timestamp) =>
        createAnswerTimeButton(timestamp),
      ),
    );
    const stepItems = (answer.steps || []).map((step) => {
      const item = makeElement("li");
      const copy = makeElement("span", "yvpm-answer-step-copy", step.text);
      item.append(copy);
      for (const timestamp of step.sourceTs || []) {
        item.append(createAnswerTimeButton(timestamp, "跳到步骤依据"));
      }
      return item;
    });
    elements.answerSteps.replaceChildren(...stepItems);
    elements.answerStepsWrap.hidden = !stepItems.length;
    elements.answerCaptionNote.hidden = !answer.usedCaptions;
    elements.answerNotice.textContent = String(answer.notice || "");
    elements.answerNotice.hidden = !answer.notice;
    elements.answerError.hidden = status !== "failed" || !task?.error;
    elements.answerError.textContent =
      status === "failed" ? String(task?.error || "") : "";
    elements.answerFollowupCount.textContent = `${state.answerTurns} / 2`;
    const complete = state.answerTurns >= 2;
    elements.answerFollowupForm.hidden = complete;
    elements.answerComplete.hidden = !complete;
    elements.answerFollowup.disabled = busy;
    elements.answerFollowupSubmit.disabled = busy;
    updateAnswerSaveButton();
  }

  async function requestAnswerCaptionUpgrade(task) {
    const upgrade = task?.captionUpgrade;
    if (upgrade?.status !== "requested") return;
    const key = `${task.taskId}:${upgrade.operationId}:${upgrade.taskVersion}`;
    if (state.answerCaptionUpgradeKey === key) return;
    state.answerCaptionUpgradeKey = key;
    let segments = [];
    try {
      const captions = await getExplanationCaptions(
        task.videoId,
        task.sourceTabId,
      );
      segments = captions.segments;
    } catch {
      // fallback 已是终态；空数组只用于把升级标记为 unavailable。
    }
    if (
      task.taskId !== state.answerTaskId ||
      Number(upgrade.taskVersion) !== state.answerTaskVersion
    ) {
      return;
    }
    try {
      const response = await runtimeMessage({
        type: "CONTINUE_ANSWER_WITH_CAPTIONS",
        payload: {
          clientId: answerClientId(),
          taskId: task.taskId,
          operationId: upgrade.operationId,
          taskVersion: upgrade.taskVersion,
          segments,
        },
      });
      if (response?.ok && response.task) applyAnswerTask(response.task);
    } catch {
      // 升级失败不覆盖已经展示的 fallback。
    }
  }

  function applyAnswerTask(task) {
    if (!task?.taskId) return;
    if (task.taskId === state.answerTaskId) {
      const incomingVersion = Math.max(0, Number(task.taskVersion) || 0);
      if (incomingVersion < state.answerTaskVersion) return;
      if (
        incomingVersion === state.answerTaskVersion &&
        state.answerTaskStatus === "ready" &&
        ["queued", "running"].includes(String(task.status || ""))
      ) {
        return;
      }
    }
    state.answerTaskId = task.taskId;
    state.answerTaskStatus = String(task.status || "idle");
    state.answerQuestion = String(task.question || state.answerQuestion);
    state.answerResult = task.answer || state.answerResult;
    state.answerTurns = Math.max(0, Number(task.turns) || 0);
    state.answerTaskVersion = Math.max(0, Number(task.taskVersion) || 0);
    if (
      task.newQuestionNotice &&
      task.newQuestionNotice !== state.answerNewQuestionNotice
    ) {
      state.answerNewQuestionNotice = task.newQuestionNotice;
      showToast(task.newQuestionNotice);
    }
    syncAnswerSavedFingerprint();
    renderAnswerTask(task);
    if (task.captionUpgrade?.status === "requested") {
      void requestAnswerCaptionUpgrade(task);
    }
  }

  function clearAnswerLocal() {
    state.answerRequestId += 1;
    state.answerTaskId = "";
    state.answerTaskStatus = "idle";
    state.answerQuestion = "";
    state.answerResult = null;
    state.answerTurns = 0;
    state.answerTaskVersion = 0;
    state.answerCaptionUpgradeKey = "";
    state.answerSavedFingerprint = "";
    state.answerNewQuestionNotice = "";
    elements.answer.hidden = true;
    elements.answerContent.hidden = true;
    elements.answerLoading.hidden = true;
    elements.answerFollowup.value = "";
  }

  function cancelAnswerContext(reason = "context_changed") {
    const message = state.answerTaskId
      ? { type: "CANCEL_ANSWER", taskId: state.answerTaskId, reason }
      : { type: "CANCEL_ANSWER", clientId: answerClientId(), reason };
    runtimeMessage(message).catch(() => null);
    clearAnswerLocal();
  }

  async function restoreAnswerTaskForVideo(videoId) {
    if (!videoId || !Number.isInteger(state.tabId)) return;
    try {
      const response = await runtimeMessage({
        type: "GET_ANSWER_TASK",
        clientId: answerClientId(),
        videoId,
        sourceTabId: state.tabId,
      });
      if (
        response?.ok &&
        response.task &&
        !response.task.dismissed &&
        response.task.videoId === state.videoId &&
        response.task.targetLanguage === state.targetLanguage &&
        !["cancelled", "expired"].includes(response.task.status)
      ) {
        applyAnswerTask(response.task);
      }
    } catch {
      // 答卷恢复失败不影响摘要与导航。
    }
  }

  async function runAnswer(rawQuestion, { force = false } = {}) {
    const question = String(rawQuestion || "").trim();
    if (!question || !state.loaded || !state.videoId) return;
    if (force && state.answerTaskId) {
      await runtimeMessage({
        type: "CANCEL_ANSWER",
        taskId: state.answerTaskId,
        reason: "retry",
      }).catch(() => null);
      clearAnswerLocal();
    }
    setFollowPlayback(false);
    clearRecommendation({ restoreSections: true });
    const requestId = ++state.answerRequestId;
    // 新问题等待 Background 建立新 taskId 时先断开旧任务广播，避免旧取消快照污染 UI。
    state.answerTaskId = "";
    state.answerQuestion = question;
    state.answerResult = null;
    state.answerTaskStatus = "queued";
    state.answerTurns = 0;
    state.answerNewQuestionNotice = "";
    elements.intentInput.value = question;
    renderAnswerTask({ status: "queued" });
    try {
      const response = await runtimeMessage({
        type: "START_ANSWER",
        payload: {
          clientId: answerClientId(),
          sourceTabId: state.tabId,
          videoId: state.videoId,
          videoTitle: state.videoTitle,
          targetLanguage: state.targetLanguage,
          question,
          operationId: answerOperationId("initial"),
        },
      });
      if (requestId !== state.answerRequestId || question !== state.answerQuestion) {
        return;
      }
      if (!response?.ok) throw new Error(response?.error || "答卷生成失败");
      applyAnswerTask(response.task);
    } catch (error) {
      if (requestId !== state.answerRequestId) return;
      state.answerTaskStatus = "failed";
      renderAnswerTask({ status: "failed", error: error?.message });
    }
  }

  function updateIntentSubmitLabel() {
    elements.intentSubmit.textContent =
      YouTubeSummary.classifyIntent(elements.intentInput.value) === "answer"
        ? "回答"
        : "查找";
  }

  function showAnswerSwitchCta(question) {
    const button = makeElement(
      "button",
      "yvpm-intent-retry",
      "综合成一份答卷",
    );
    button.type = "button";
    button.addEventListener("click", () => void runAnswer(question));
    elements.intentFeedback.replaceChildren(
      document.createTextNode("这段输入也可能是在提问。"),
      document.createTextNode(" "),
      button,
    );
    elements.intentFeedback.className = "yvpm-intent-feedback";
    elements.intentFeedback.hidden = false;
  }

  function setIntentBusy(busy) {
    elements.intentInput.disabled = busy;
    elements.intentSubmit.disabled = busy;
    for (const chip of elements.intentChips.querySelectorAll("button")) {
      chip.disabled = busy;
    }
  }

  function setIntentFeedback(message, kind = "", retry = null) {
    elements.intentFeedback.className = `yvpm-intent-feedback${
      kind ? ` yvpm-intent-feedback-${kind}` : ""
    }`;
    elements.intentFeedback.replaceChildren();
    if (!message) {
      elements.intentFeedback.hidden = true;
      return;
    }
    elements.intentFeedback.append(document.createTextNode(message));
    if (retry) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "yvpm-intent-retry";
      button.textContent = "重试";
      button.addEventListener("click", retry);
      elements.intentFeedback.append(document.createTextNode(" "), button);
    }
    elements.intentFeedback.hidden = false;
  }

  function setActiveIntentChip(intent) {
    for (const chip of elements.intentChips.querySelectorAll("button")) {
      chip.classList.toggle(
        "yvpm-intent-chip-active",
        chip.dataset.intent === intent,
      );
    }
  }

  function restoreRecommendationSections() {
    if (!Array.isArray(state.recommendationPreviousExpanded)) return;
    state.sectionViews.forEach((view, index) => {
      setSectionExpanded(
        view,
        Boolean(state.recommendationPreviousExpanded[index]),
      );
    });
  }

  function recommendationIsActive() {
    return Boolean(
      state.recommendationRows.length ||
        Array.isArray(state.recommendationPreviousExpanded),
    );
  }

  function clearRecommendation({
    restoreSections = true,
    clearInput = false,
    invalidate = true,
  } = {}) {
    if (invalidate) state.recommendationRequestId += 1;
    if (
      state.recommendationAutoExpandedRow &&
      state.expandedRow === state.recommendationAutoExpandedRow
    ) {
      setRowExpanded(state.recommendationAutoExpandedRow, false);
    }
    for (const row of state.recommendationRows) {
      row.classList.remove("yvpm-recommended", "yvpm-recommendation-focus");
    }
    if (restoreSections) restoreRecommendationSections();
    state.recommendationIntent = "";
    state.recommendationSource = "";
    state.recommendationRows = [];
    state.recommendationIndex = -1;
    state.recommendationPreviousExpanded = null;
    state.recommendationLocalMatches.clear();
    state.recommendationLocalCount = 0;
    state.recommendationAiAddedCount = 0;
    state.recommendationSupplementStatus = "idle";
    state.recommendationAutoExpandedRow = null;
    elements.matchbar.hidden = true;
    elements.matchRelated.hidden = true;
    elements.matchRelated.disabled = false;
    elements.matchRelated.textContent = "查找相关观点";
    elements.panel?.classList.remove("yvpm-has-matches");
    elements.intentChips.classList.remove("yvpm-intent-chips-muted");
    setActiveIntentChip("");
    if (clearInput) elements.intentInput.value = "";
  }

  function getPointRow(timestamp) {
    const target = Math.max(0, Math.floor(Number(timestamp) || 0));
    return [...elements.list.querySelectorAll(".yvpm-row")].find(
      (row) => Number(row.dataset.t) === target,
    );
  }

  function focusRecommendation(index, { scroll = true } = {}) {
    if (!state.recommendationRows.length) return;
    const length = state.recommendationRows.length;
    state.recommendationIndex = (index + length) % length;
    for (const row of state.recommendationRows) {
      row.classList.remove("yvpm-recommendation-focus");
    }
    const row = state.recommendationRows[state.recommendationIndex];
    const timestamp = Math.max(0, Math.floor(Number(row.dataset.t) || 0));
    const localMatch = state.recommendationLocalMatches.get(timestamp);
    const needsDetail = localMatch && !localMatch.allTermsInPoint;
    if (
      !needsDetail &&
      state.recommendationAutoExpandedRow &&
      state.expandedRow === state.recommendationAutoExpandedRow
    ) {
      setRowExpanded(state.recommendationAutoExpandedRow, false);
      state.recommendationAutoExpandedRow = null;
    }
    if (needsDetail) {
      const alreadyExpanded = state.expandedRow === row;
      const alreadyOwned = state.recommendationAutoExpandedRow === row;
      if (setRowExpanded(row, true)) {
        state.recommendationAutoExpandedRow =
          !alreadyExpanded || alreadyOwned ? row : null;
      }
    }
    row.classList.add("yvpm-recommendation-focus");
    if (scroll) {
      row.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function renderMatchbar(intent, count, source = state.recommendationSource) {
    const isLocalResult = source === "local" || source === "hybrid";
    const prefix = document.createTextNode(isLocalResult ? "“" : "已为“");
    const intentStrong = document.createElement("strong");
    intentStrong.textContent = intent;
    const middle = document.createTextNode(
      isLocalResult ? "”命中 " : "”找到 ",
    );
    const countStrong = document.createElement("strong");
    countStrong.textContent = String(
      isLocalResult ? state.recommendationLocalCount : count,
    );
    const suffix = document.createTextNode(" 个观点");
    const content = [prefix, intentStrong, middle, countStrong, suffix];
    if (source === "hybrid") {
      content.push(
        document.createTextNode(
          state.recommendationAiAddedCount
            ? ` · AI 补充 ${state.recommendationAiAddedCount} 个`
            : " · AI 没有找到额外相关的观点",
        ),
      );
    }
    elements.matchbarText.replaceChildren(...content);
    const canSupplement = source === "local";
    elements.matchRelated.hidden = !canSupplement;
    elements.matchRelated.disabled =
      state.recommendationSupplementStatus === "loading";
    elements.matchRelated.textContent =
      state.recommendationSupplementStatus === "loading"
        ? "正在查找…"
        : "查找相关观点";
    elements.matchbar.classList.toggle("yvpm-matchbar-local", isLocalResult);
    elements.matchbar.hidden = false;
    elements.panel?.classList.add("yvpm-has-matches");
  }

  function applyRecommendation(
    intent,
    pointTs,
    {
      source = "custom",
      limit = 4,
      initialT = null,
      preserveFocusT = null,
    } = {},
  ) {
    const hasPreservedFocus =
      preserveFocusT !== null &&
      preserveFocusT !== undefined &&
      Number.isFinite(Number(preserveFocusT));
    const preservedReadingAnchor = hasPreservedFocus
      ? captureReadingAnchor()
      : null;
    const recommendationRows = (Array.isArray(pointTs) ? pointTs : [])
      .map(getPointRow)
      .filter(Boolean)
      .slice(0, limit);
    if (!recommendationRows.length) return false;
    state.recommendationIntent = intent;
    state.recommendationSource = source;
    state.recommendationRows = recommendationRows;

    const matchedSections = new Set(
      state.recommendationRows
        .map((row) => row.closest(".yvpm-section"))
        .filter(Boolean),
    );
    state.sectionViews.forEach((view) => {
      setSectionExpanded(view, matchedSections.has(view.section));
    });
    for (const row of state.recommendationRows) {
      row.classList.add("yvpm-recommended");
    }
    elements.intentChips.classList.toggle(
      "yvpm-intent-chips-muted",
      source !== "default",
    );
    setActiveIntentChip(intent);
    renderMatchbar(intent, state.recommendationRows.length, source);
    const hasInitialTarget =
      initialT !== null &&
      initialT !== undefined &&
      Number.isFinite(Number(initialT));
    const targetT = hasPreservedFocus
      ? Math.max(0, Math.floor(Number(preserveFocusT)))
      : hasInitialTarget
        ? Math.max(0, Math.floor(Number(initialT)))
        : null;
    const targetIndex =
      targetT === null
        ? 0
        : Math.max(
            0,
            state.recommendationRows.findIndex(
              (row) => Number(row.dataset.t) === targetT,
            ),
          );
    focusRecommendation(targetIndex, {
      scroll: !hasPreservedFocus,
    });
    if (preservedReadingAnchor) {
      restoreReadingAnchor(
        preservedReadingAnchor,
        findRenderedPointRow(preservedReadingAnchor.key),
      );
    }
    return true;
  }

  function runDefaultRecommendation(question) {
    const intent = String(question?.label || "").trim();
    if (!intent || !Array.isArray(question?.pointTs)) return;
    if (!state.loaded || !state.videoId) {
      setIntentFeedback("摘要完成后即可查看推荐片段。", "error");
      return;
    }

    setFollowPlayback(false);
    clearRecommendation({ restoreSections: true });
    state.recommendationPreviousExpanded = state.sectionViews.map(
      (view) => !view.body.hidden,
    );
    setIntentFeedback("");
    if (!applyRecommendation(intent, question.pointTs, { source: "default" })) {
      restoreRecommendationSections();
      state.recommendationPreviousExpanded = null;
      setActiveIntentChip("");
    }
  }

  async function runRecommendation(rawIntent) {
    const intent = String(rawIntent || "").trim();
    if (!intent) {
      elements.intentInput.focus();
      setIntentFeedback("请先描述你想了解什么。", "error");
      return;
    }
    if (!state.loaded || !state.videoId) {
      setIntentFeedback("摘要完成后即可按你的需求筛选。", "error");
      return;
    }

    setFollowPlayback(false);
    clearRecommendation({ restoreSections: true });
    state.recommendationPreviousExpanded = state.sectionViews.map(
      (view) => !view.body.hidden,
    );
    const localMatches = YouTubeSummary.rankPointsByQuery(state.points, intent);
    if (localMatches.length) {
      state.recommendationLocalMatches = new Map(
        localMatches.map((match) => [match.t, match]),
      );
      state.recommendationLocalCount = localMatches.length;
      state.recommendationAiAddedCount = 0;
      state.recommendationSupplementStatus = "idle";
      elements.intentInput.value = intent;
      setIntentFeedback("");
      const chronologicalTs = localMatches
        .map((match) => match.t)
        .sort((a, b) => a - b);
      applyRecommendation(intent, chronologicalTs, {
        source: "local",
        limit: Infinity,
        initialT: localMatches[0].t,
      });
      return;
    }
    const requestId = state.recommendationRequestId;
    const videoId = state.videoId;
    elements.intentInput.value = intent;
    setActiveIntentChip(intent);
    setIntentBusy(true);
    setIntentFeedback(
      `摘要中没有直接提到“${intent}”，正在按语义匹配…`,
      "loading",
    );
    try {
      const response = await runtimeMessage({
        type: "MATCH_SUMMARY_INTENT",
        payload: {
          videoId,
          intent,
          targetLanguage: state.targetLanguage,
        },
      });
      if (
        requestId !== state.recommendationRequestId ||
        videoId !== state.videoId
      ) {
        return;
      }
      if (!response?.ok) throw new Error(response?.error || "匹配失败，请重试");
      setIntentFeedback("");
      if (!applyRecommendation(intent, response.pointTs, { source: "custom" })) {
        restoreRecommendationSections();
        state.recommendationPreviousExpanded = null;
        setActiveIntentChip("");
        setIntentFeedback(
          "没有找到与该需求高度相关的观点，可以换一种描述试试。",
          "empty",
        );
      }
    } catch (error) {
      if (
        requestId !== state.recommendationRequestId ||
        videoId !== state.videoId
      ) {
        return;
      }
      restoreRecommendationSections();
      state.recommendationPreviousExpanded = null;
      setActiveIntentChip("");
      const message = error?.message || "匹配失败，请重试";
      setIntentFeedback(message, "error", () => runRecommendation(intent));
    } finally {
      if (
        requestId === state.recommendationRequestId &&
        videoId === state.videoId
      ) {
        setIntentBusy(false);
      }
    }
  }

  async function routeIntent(rawIntent) {
    const intent = String(rawIntent || "").trim();
    if (!intent) {
      await runRecommendation(intent);
      return;
    }
    const route = YouTubeSummary.classifyIntent(intent);
    if (route === "answer") {
      await runAnswer(intent);
      return;
    }
    if (state.answerTaskId) cancelAnswerContext("switched_to_navigation");
    await runRecommendation(intent);
    if (route === "ambiguous") showAnswerSwitchCta(intent);
  }

  async function runSemanticSupplement() {
    const intent = state.recommendationIntent;
    if (
      !intent ||
      state.recommendationSource !== "local" ||
      state.recommendationSupplementStatus === "loading" ||
      !state.loaded ||
      !state.videoId
    ) {
      return;
    }

    const requestId = ++state.recommendationRequestId;
    const videoId = state.videoId;
    const focusedT = Number(
      state.recommendationRows[state.recommendationIndex]?.dataset.t,
    );
    state.recommendationSupplementStatus = "loading";
    renderMatchbar(intent, state.recommendationRows.length, "local");
    setIntentFeedback("正在查找没有直接提到关键词的相关观点…", "loading");
    try {
      const response = await runtimeMessage({
        type: "MATCH_SUMMARY_INTENT",
        payload: {
          videoId,
          intent,
          targetLanguage: state.targetLanguage,
        },
      });
      if (
        requestId !== state.recommendationRequestId ||
        videoId !== state.videoId ||
        state.recommendationIntent !== intent
      ) {
        return;
      }
      if (!response?.ok) throw new Error(response?.error || "匹配失败，请重试");

      const localTs = [...state.recommendationLocalMatches.keys()];
      const localSet = new Set(localTs);
      const aiTs = (Array.isArray(response.pointTs) ? response.pointTs : [])
        .map((timestamp) => Math.max(0, Math.floor(Number(timestamp) || 0)))
        .filter((timestamp) => getPointRow(timestamp));
      const addedTs = [
        ...new Set(aiTs.filter((timestamp) => !localSet.has(timestamp))),
      ];
      const mergedTs = [...new Set([...localTs, ...addedTs])].sort(
        (a, b) => a - b,
      );
      state.recommendationAiAddedCount = addedTs.length;
      state.recommendationSupplementStatus = "complete";
      setIntentFeedback("");
      applyRecommendation(intent, mergedTs, {
        source: "hybrid",
        limit: Infinity,
        preserveFocusT: Number.isFinite(focusedT) ? focusedT : null,
      });
    } catch (error) {
      if (
        requestId !== state.recommendationRequestId ||
        videoId !== state.videoId ||
        state.recommendationIntent !== intent
      ) {
        return;
      }
      state.recommendationSource = "local";
      state.recommendationAiAddedCount = 0;
      state.recommendationSupplementStatus = "idle";
      renderMatchbar(intent, state.recommendationRows.length, "local");
      setIntentFeedback(error?.message || "匹配失败，请重试", "error", () =>
        runSemanticSupplement(),
      );
    }
  }

  function showDefaultRecommendationLoading() {
    elements.intentChips.replaceChildren();
    const placeholder = document.createElement("span");
    placeholder.className = "yvpm-intent-chip-placeholder";
    placeholder.textContent = "正在发现值得看的片段…";
    elements.intentChips.append(placeholder);
  }

  function renderDefaultRecommendationChips(recommendations) {
    elements.intentChips.replaceChildren();
    state.defaultRecommendations = Array.isArray(recommendations)
      ? recommendations.slice(0, 4)
      : [];
    for (const question of state.defaultRecommendations) {
      const intent = String(question?.label || "").trim();
      const pointTs = Array.isArray(question?.pointTs)
        ? question.pointTs.slice(0, 4)
        : [];
      if (!intent || !pointTs.length) continue;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "yvpm-intent-chip";
      chip.dataset.intent = intent;
      chip.dataset.source = "default";
      chip.textContent = intent;
      chip.addEventListener("click", () =>
        runDefaultRecommendation({ label: intent, pointTs }),
      );
      elements.intentChips.append(chip);
    }
    elements.intentChips.classList.toggle(
      "yvpm-intent-chips-muted",
      Boolean(state.recommendationSource) &&
        state.recommendationSource !== "default",
    );
    setActiveIntentChip(state.recommendationIntent);
  }

  async function loadDefaultRecommendations(summary) {
    const points = YouTubeSummary.dedupePointsByTimestamp(summary?.points);
    if (!state.videoId || !points.length) {
      renderDefaultRecommendationChips([]);
      return;
    }
    const requestId = ++state.defaultRecommendationRequestId;
    const videoId = state.videoId;
    const targetLanguage = state.targetLanguage;
    showDefaultRecommendationLoading();
    try {
      const response = await runtimeMessage({
        type: "GET_DEFAULT_RECOMMENDATIONS",
        payload: {
          videoId,
          targetLanguage,
        },
      });
      if (
        requestId !== state.defaultRecommendationRequestId ||
        videoId !== state.videoId ||
        targetLanguage !== state.targetLanguage
      ) {
        return;
      }
      renderDefaultRecommendationChips(
        response?.ok ? response.recommendations : [],
      );
    } catch {
      if (
        requestId === state.defaultRecommendationRequestId &&
        videoId === state.videoId &&
        targetLanguage === state.targetLanguage
      ) {
        renderDefaultRecommendationChips([]);
      }
    }
  }

  function renderIntentControls(summary) {
    setIntentBusy(false);
    setIntentFeedback("");
    elements.intent.hidden = false;
    updateIntentSubmitLabel();
    loadDefaultRecommendations(summary);
  }

  function showOverviewPlaceholder() {
    elements.overview.className = "yvpm-overview yvpm-overview-pending";
    elements.overviewLabel.textContent = "概览";
    elements.overviewText.textContent = "正在梳理整期视频…";
    elements.overviewRetry.hidden = true;
    elements.overview.hidden = false;
  }

  function renderOverview(overview, { animate = true } = {}) {
    const content = String(overview || "").trim();
    if (!content) return false;
    elements.overview.className = `yvpm-overview${
      animate ? " yvpm-overview-arrive" : ""
    }`;
    elements.overviewLabel.textContent = "概览";
    elements.overviewText.textContent = content;
    elements.overviewRetry.hidden = true;
    elements.overview.hidden = false;
    return true;
  }

  function showOverviewError(message = "概览生成失败") {
    elements.overview.className = "yvpm-overview yvpm-overview-error";
    elements.overviewLabel.textContent = "概览";
    elements.overviewText.textContent = message;
    elements.overviewRetry.hidden = false;
    elements.overview.hidden = false;
  }

  function clearOverview() {
    state.activeOverviewGenerationId = "";
    elements.overview.className = "yvpm-overview";
    elements.overviewLabel.textContent = "概览";
    elements.overview.hidden = true;
    elements.overviewText.textContent = "";
    elements.overviewRetry.hidden = true;
  }

  function hasResolvedOverview() {
    return Boolean(
      !elements.overview.hidden &&
        !elements.overview.classList.contains("yvpm-overview-pending") &&
        !elements.overview.classList.contains("yvpm-overview-error") &&
        elements.overviewText.textContent.trim(),
    );
  }

  function updateFollowPlaybackControl() {
    const enabled = state.followPlayback;
    elements.followPlayback.setAttribute("aria-pressed", String(enabled));
    elements.followPlayback.setAttribute(
      "aria-label",
      enabled ? "跟随播放已开启，点击关闭" : "跟随播放已关闭，点击开启",
    );
    elements.followPlayback.title = enabled
      ? "正在跟随播放，点击关闭"
      : "点击后从当前播放位置开始跟随";
  }

  function invalidateFollowSeekRequests() {
    state.followSeekRequestId += 1;
  }

  function setFollowPlayback(enabled, { sync = false } = {}) {
    const nextEnabled = Boolean(enabled);
    if (nextEnabled && recommendationIsActive()) {
      clearRecommendation({ restoreSections: true, clearInput: true });
      setIntentFeedback("");
    }
    state.followPlayback = nextEnabled;
    if (!nextEnabled) {
      invalidateFollowSeekRequests();
      state.autoExpandedSection = null;
    }
    updateFollowPlaybackControl();
    if (nextEnabled && sync) {
      updateNowPlaying({ follow: true, forceFollow: true });
    }
  }

  function saveActivePlaybackSnapshot() {
    if (!Number.isInteger(state.tabId) || !state.videoId) return null;
    const pending = state.pendingPlaybackRestore;
    if (
      pending?.tabId === state.tabId &&
      pending.videoId === state.videoId &&
      pending.epoch === state.epoch
    ) {
      return state.playbackSnapshots.get(state.tabId, state.videoId);
    }
    return state.playbackSnapshots.save(state.tabId, state.videoId, {
      followPlayback: state.followPlayback,
      anchor: state.followPlayback ? null : captureReadingAnchor(),
    });
  }

  function collapseExpandedRow(except = null) {
    if (!state.expandedRow || state.expandedRow === except) return;
    setRowExpanded(state.expandedRow, false);
  }

  function setRowExpanded(row, expanded) {
    if (!row) return false;
    const toggle = row.querySelector(".yvpm-point-toggle");
    const detail = row.querySelector(".yvpm-detail, .yvpm-insight-card");
    if (!toggle || !detail) return false;
    if (expanded) collapseExpandedRow(row);
    detail.hidden = !expanded;
    row.classList.toggle("yvpm-expanded", expanded);
    toggle.setAttribute("aria-expanded", String(expanded));
    if (expanded) state.expandedRow = row;
    else if (state.expandedRow === row) state.expandedRow = null;
    return true;
  }

  function navigatePointRows(event) {
    const direction =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (
      !direction ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      recommendationIsActive()
    ) {
      return;
    }
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) {
      return;
    }
    const currentRow = event.target.closest(".yvpm-row");
    if (!currentRow) return;
    event.preventDefault();

    const rows = [...elements.list.querySelectorAll(".yvpm-row")];
    const currentIndex = rows.indexOf(currentRow);
    if (currentIndex < 0) return;
    const targetRow = rows[currentIndex + direction];
    if (!targetRow) return;

    setFollowPlayback(false);
    const targetSection = state.sectionViews.find(
      (view) => view.section === targetRow.closest(".yvpm-section"),
    );
    if (targetSection?.body.hidden) {
      setSectionExpanded(targetSection, true);
    }
    if (!setRowExpanded(targetRow, true)) return;
    targetRow
      .querySelector(".yvpm-point-toggle")
      ?.focus({ preventScroll: true });
    targetRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function createSeekButton(point) {
    const seek = document.createElement("button");
    seek.type = "button";
    seek.className = "yvpm-seek";
    seek.textContent = "▶ 看这段";
    seek.addEventListener("click", (event) => {
      event.stopPropagation();
      void seekWithFeedback(point.t, { followPlayback: true });
    });
    return seek;
  }

  function renderInsightCard(detail, point, insightWhy) {
    detail.className = "yvpm-insight-card";

    const cardHeader = document.createElement("div");
    cardHeader.className = "yvpm-insight-card-header";

    const icon = document.createElement("span");
    icon.className = "yvpm-insight-card-icon";
    icon.textContent = "◆";
    icon.setAttribute("aria-hidden", "true");

    const timeLabel = document.createElement("span");
    timeLabel.className = "yvpm-insight-card-time";
    timeLabel.textContent = point.tLabel;

    const label = document.createElement("span");
    label.className = "yvpm-insight-card-label";
    label.textContent = "核心洞见";
    cardHeader.append(icon, timeLabel, label);

    const why = document.createElement("div");
    why.className = "yvpm-insight-card-why";
    const whyLabel = document.createElement("strong");
    whyLabel.textContent = "为什么重要：";
    why.append(whyLabel, document.createTextNode(insightWhy));

    const detailText = document.createElement("p");
    detailText.className = "yvpm-insight-card-detail";
    detailText.textContent = point.detail;

    detail.replaceChildren(cardHeader, why, detailText, createSeekButton(point));
  }

  function renderPlainDetail(detail, point) {
    detail.className = "yvpm-detail";
    const detailText = document.createElement("p");
    detailText.textContent = point.detail;
    detail.replaceChildren(detailText, createSeekButton(point));
  }

  function createPointRow(point, animate, insightWhy = null) {
    const row = document.createElement("article");
    row.className = `yvpm-row${animate ? " yvpm-row-arrive" : ""}`;
    row.dataset.t = String(point.t);
    row.dataset.key = YouTubeSummary.pointStableKey(state.videoId, point);
    row.setAttribute("role", "listitem");

    const toggle = document.createElement("div");
    toggle.className = "yvpm-point-toggle";
    toggle.setAttribute("role", "button");
    toggle.tabIndex = 0;
    toggle.setAttribute("aria-expanded", "false");

    const time = document.createElement("span");
    time.className = "yvpm-time";
    time.textContent = point.tLabel;

    const claim = document.createElement("span");
    claim.className = "yvpm-claim";
    claim.textContent = point.point;
    toggle.append(time, claim);

    const detail = document.createElement("div");
    detail.hidden = true;
    if (insightWhy) {
      row.classList.add("yvpm-key-insight");
      renderInsightCard(detail, point, insightWhy);
    } else {
      renderPlainDetail(detail, point);
    }

    const toggleDetail = () => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim()) {
        return;
      }
      if (state.recommendationAutoExpandedRow === row) {
        state.recommendationAutoExpandedRow = null;
      }
      const expanding = detail.hidden;
      setFollowPlayback(false);
      setRowExpanded(row, expanding);
    };
    toggle.addEventListener("click", toggleDetail);
    toggle.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleDetail();
    });

    row.append(toggle, detail);
    return row;
  }

  function setSectionExpanded(view, expanded) {
    view.body.hidden = !expanded;
    view.section.classList.toggle("yvpm-section-expanded", expanded);
    view.toggle.setAttribute("aria-expanded", String(expanded));
    if (!expanded && state.expandedRow && view.body.contains(state.expandedRow)) {
      collapseExpandedRow();
    }
  }

  function createSectionView(group, insightMap = new Map()) {
    const section = document.createElement("section");
    section.className = "yvpm-section";
    section.dataset.startT = String(group.startT);

    const header = document.createElement("header");
    header.className = "yvpm-section-header";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "yvpm-section-toggle";

    const chevron = document.createElement("span");
    chevron.className = "yvpm-section-chevron";
    chevron.textContent = "›";
    chevron.setAttribute("aria-hidden", "true");

    const title = document.createElement("span");
    title.className = "yvpm-section-title";
    title.textContent = group.title;
    toggle.append(chevron, title);

    const range = document.createElement("button");
    range.type = "button";
    range.className = "yvpm-section-range";
    range.textContent = group.rangeLabel;
    range.setAttribute("aria-label", `跳到 ${group.title} 开头`);

    const body = document.createElement("div");
    body.className = "yvpm-section-body";
    body.setAttribute("role", "list");
    for (const point of group.points) {
      body.append(createPointRow(point, false, insightMap.get(point.t) || null));
    }

    const initiallyExpanded = !DEFAULT_SECTIONS_COLLAPSED;
    toggle.setAttribute("aria-expanded", String(initiallyExpanded));
    body.hidden = !initiallyExpanded;
    section.classList.toggle("yvpm-section-expanded", initiallyExpanded);

    const view = { section, toggle, body };
    toggle.addEventListener("click", () => {
      setFollowPlayback(false);
      setSectionExpanded(view, body.hidden);
      updateNowPlaying({ follow: false });
    });
    range.addEventListener("click", () => {
      void seekWithFeedback(group.points[0].t, { followPlayback: true });
    });

    header.append(toggle, range);
    section.append(header, body);
    return view;
  }

  function updateNowPlaying({
    follow = true,
    forceFollow = false,
    scroll = true,
  } = {}) {
    const rows = elements.list.querySelectorAll(".yvpm-row");
    const index = YouTubeSummary.findCurrentPointIndex(
      state.points,
      state.currentTime,
    );
    const sectionIndex = YouTubeSummary.findCurrentSectionIndex(
      state.sectionGroups,
      state.currentTime,
    );
    const shouldFollow = Boolean(
      follow &&
        state.followPlayback &&
        !recommendationIsActive() &&
        index >= 0 &&
        (forceFollow || index !== state.currentIndex),
    );
    const row = shouldFollow ? rows[index] : null;
    if (row) {
      const rowSection = row.closest(".yvpm-section");
      const currentSection =
        state.sectionViews.find((view) => view.section === rowSection) || null;
      if (
        state.autoExpandedSection &&
        state.autoExpandedSection !== currentSection
      ) {
        setSectionExpanded(state.autoExpandedSection, false);
        state.autoExpandedSection = null;
      }
      if (currentSection?.body.hidden) {
        setSectionExpanded(currentSection, true);
        state.autoExpandedSection = currentSection;
      }
      setRowExpanded(row, true);
    }
    rows.forEach((pointRow, rowIndex) => {
      pointRow.classList.toggle("yvpm-now-playing", rowIndex === index);
    });
    state.sectionViews.forEach((view, viewIndex) => {
      view.section.classList.toggle(
        "yvpm-section-current",
        viewIndex === sectionIndex,
      );
    });
    if (row && scroll) {
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    state.currentIndex = index;
    state.currentSectionIndex = sectionIndex;
  }

  function updatePointRow(row, point, insightWhy = null) {
    row.dataset.t = String(point.t);
    row.classList.toggle("yvpm-key-insight", Boolean(insightWhy));
    row.querySelector(".yvpm-time").textContent = point.tLabel;
    row.querySelector(".yvpm-claim").textContent = point.point;
    const detail = row.querySelector(".yvpm-detail, .yvpm-insight-card");
    if (!detail) return;
    const wasHidden = detail.hidden;
    if (insightWhy) {
      renderInsightCard(detail, point, insightWhy);
    } else {
      renderPlainDetail(detail, point);
    }
    detail.hidden = wasHidden;
  }

  function insightMapFromSummary(summary) {
    const insightMap = new Map();
    for (const insight of Array.isArray(summary?.keyInsights)
      ? summary.keyInsights
      : []) {
      if (
        Number.isFinite(Number(insight?.pointT)) &&
        typeof insight?.why === "string" &&
        insight.why.trim()
      ) {
        insightMap.set(Math.max(0, Math.floor(Number(insight.pointT))), insight.why.trim());
      }
    }
    return insightMap;
  }

  function mergePoints(points, animate = true, insightMap = new Map()) {
    const mergedPoints = YouTubeSummary.mergePointsByTimestamp(
      state.points,
      points,
    );
    const orderedRows = [];
    for (const point of mergedPoints) {
      const key = YouTubeSummary.pointStableKey(state.videoId, point);
      let row = state.pointRows.get(key);
      if (!row) {
        row = createPointRow(point, animate, insightMap.get(point.t) || null);
        state.pointRows.set(key, row);
      } else {
        updatePointRow(row, point, insightMap.get(point.t) || null);
      }
      orderedRows.push(row);
    }
    YouTubeSummary.reconcileRowOrder(elements.list, orderedRows);
    state.points = mergedPoints;
    setListHeading("关键观点", `${state.points.length} 条观点`);
    updateNowPlaying({
      follow: state.followPlayback,
      forceFollow: state.followPlayback,
      scroll: false,
    });
  }

  function setListHeading(title = "", meta = "") {
    const visible = Boolean(title);
    elements.listHeading.hidden = !visible;
    elements.listHeadingTitle.textContent = title;
    elements.listHeadingMeta.textContent = meta;
  }

  function findRenderedPointRow(key) {
    return [...elements.list.querySelectorAll(".yvpm-row")].find(
      (row) => row.dataset.key === key,
    ) || null;
  }

  function finishSummaryRender(anchor, { scroll = true } = {}) {
    updateNowPlaying({
      follow: state.followPlayback,
      forceFollow: state.followPlayback,
      scroll,
    });
    if (state.followPlayback) return null;
    return applyReadingAnchor(anchor);
  }

  function applyReadingAnchor(anchor) {
    if (!anchor?.key) return null;
    const row = findRenderedPointRow(anchor.key);
    if (!row) return null;
    const sectionBody = row.closest(".yvpm-section-body");
    const sectionView = state.sectionViews.find(
      (view) => view.body === sectionBody,
    );
    if (sectionView) setSectionExpanded(sectionView, true);
    if (anchor.expanded) setRowExpanded(row, true);
    return row;
  }

  function renderSummary(summary, { anchor = null } = {}) {
    const hadPoints = state.points.length > 0;
    clearPoints({ preserveOverview: true });
    state.libraryTitle = YouTubeSummary.libraryTitleFromSummary(summary);
    const points = YouTubeSummary.dedupePointsByTimestamp(summary?.points);
    const groups = YouTubeSummary.groupPointsBySections(
      points,
      summary?.sections,
    );
    const insightMap = insightMapFromSummary(summary);
    if (summary?.overview && !hasResolvedOverview()) {
      renderOverview(summary.overview, { animate: false });
    }
    if (!groups.length) {
      mergePoints(points, false, insightMap);
      renderIntentControls(summary);
      void restoreAnswerTaskForVideo(state.videoId);
      if (elements.overview.hidden) showOverviewError();
      void showClippingHintOnce();
      return finishSummaryRender(anchor, { scroll: hadPoints });
    }
    state.sectionGroups = groups;
    state.points = groups.flatMap((group) => group.points);
    for (const point of state.points) {
      state.pointIds.add(String(Math.max(0, Math.floor(Number(point.t) || 0))));
    }
    const fragment = document.createDocumentFragment();
    for (const group of groups) {
      const view = createSectionView(group, insightMap);
      state.sectionViews.push(view);
      fragment.append(view.section);
    }
    elements.list.append(fragment);
    setListHeading("关键章节", `${groups.length} 个章节`);
    renderIntentControls(summary);
    void restoreAnswerTaskForVideo(state.videoId);
    if (elements.overview.hidden) showOverviewError();
    void showClippingHintOnce();
    return finishSummaryRender(anchor, { scroll: hadPoints });
  }

  function readingViewportTop() {
    const stickyElements = [
      elements.appbar,
      elements.generationBar,
      elements.matchbar,
    ];
    return stickyElements.reduce((bottom, element) => {
      if (!element || element.hidden) return bottom;
      return Math.max(bottom, element.getBoundingClientRect().bottom);
    }, 0);
  }

  function captureReadingAnchor() {
    if (state.activeView !== "summary" || elements.panel.hidden) return null;
    const rows = [...elements.list.querySelectorAll(".yvpm-row")];
    const row = YouTubeSummary.findReadingAnchorRow(
      rows,
      state.expandedRow,
      readingViewportTop(),
      window.innerHeight,
    );
    if (!row) return null;
    const detail = row.querySelector(".yvpm-detail, .yvpm-insight-card");
    return {
      key: row.dataset.key,
      top: row.getBoundingClientRect().top,
      expanded: row === state.expandedRow && Boolean(detail && !detail.hidden),
      restoreFocus: elements.list.contains(document.activeElement),
    };
  }

  function restoreReadingAnchor(anchor, row) {
    if (!anchor || !row?.isConnected) return;
    const newTop = row.getBoundingClientRect().top;
    window.scrollBy(0, newTop - anchor.top);
    if (anchor.restoreFocus) {
      row.querySelector(".yvpm-point-toggle")?.focus({ preventScroll: true });
    }
  }

  function applyPendingPlaybackRestore() {
    const pending = state.pendingPlaybackRestore;
    if (!pending) return false;
    if (
      pending.tabId !== state.tabId ||
      pending.videoId !== state.videoId ||
      pending.epoch !== state.epoch
    ) {
      state.pendingPlaybackRestore = null;
      return false;
    }
    if (!state.points.length) return false;

    state.pendingPlaybackRestore = null;
    if (state.followPlayback) return true;
    const row = applyReadingAnchor(pending.anchor);
    restoreReadingAnchor(pending.anchor, row);
    return true;
  }

  function finalizeGeneratedSummary(summary, generationId) {
    const finalizationKey = String(
      generationId || state.activeGenerationId || "",
    );
    if (!finalizationKey || state.finalizedGenerationId === finalizationKey) {
      return false;
    }
    const anchor = state.followPlayback ? null : captureReadingAnchor();
    const restoredRow = renderSummary(summary, { anchor });
    state.loaded = true;
    state.loading = false;
    hideProgress();
    setGeneratingVisible(false);
    setStatus("");
    restoreReadingAnchor(anchor, restoredRow);
    applyPendingPlaybackRestore();
    state.finalizedGenerationId = finalizationKey;
    void ensureLibraryTitleForSummary(
      state.videoId,
      state.targetLanguage,
      state.epoch,
    );
    return true;
  }

  function clearPoints({ preserveOverview = false } = {}) {
    hideExplainMenu();
    if (!state.explanationDrawerOpen) clearCapturedSelection();
    clearRecommendation({ restoreSections: false, clearInput: true });
    state.defaultRecommendationRequestId += 1;
    state.defaultRecommendations = [];
    state.points = [];
    state.pointIds.clear();
    state.pointRows.clear();
    state.receivedChunkIndexes.clear();
    state.totalChunks = 0;
    state.currentIndex = -1;
    state.currentSectionIndex = -1;
    state.sectionGroups = [];
    state.sectionViews = [];
    state.expandedRow = null;
    state.autoExpandedSection = null;
    if (!preserveOverview) clearOverview();
    elements.intent.hidden = true;
    elements.intentChips.replaceChildren();
    elements.intentChips.classList.remove("yvpm-intent-chips-muted");
    setIntentFeedback("");
    setIntentBusy(false);
    setListHeading();
    elements.list.replaceChildren();
    hideProgress();
  }

  function showEmpty() {
    setFollowPlayback(false);
    state.pendingPlaybackRestore = null;
    hidePrepare();
    setGeneratingVisible(false);
    clearPoints();
    setStatus("");
    elements.empty.hidden = false;
  }

  function switchToVideo({
    tabId = state.tabId,
    videoId = "",
    currentTime,
    videoTitle = "",
  } = {}) {
    const nextTabId = Number.isInteger(tabId) ? tabId : null;
    const nextVideoId = String(videoId || "");
    state.activatingTabId = null;
    if (
      nextVideoId &&
      state.tabId === nextTabId &&
      state.videoId === nextVideoId &&
      (state.loading || state.loaded || state.preparing)
    ) {
      if (videoTitle) state.videoTitle = cleanVideoTitle(videoTitle);
      state.currentTime = YouTubeSummary.playbackTimeOr(
        currentTime,
        state.currentTime,
      );
      updateNowPlaying({
        follow: state.followPlayback,
        forceFollow: state.followPlayback,
      });
      return;
    }
    const restoreSnapshot = nextVideoId
      ? state.playbackSnapshots.get(nextTabId, nextVideoId)
      : null;
    cancelAnswerContext("video_changed");
    resetExplanationContext();
    state.activeTabSyncId += 1;
    state.epoch += 1;
    state.tabId = nextTabId;
    state.videoId = nextVideoId;
    state.videoTitle = nextVideoId
      ? cleanVideoTitle(videoTitle) || `YouTube 视频 ${nextVideoId}`
      : "";
    state.libraryTitle = "";
    state.loaded = false;
    state.loading = false;
    state.preparing = false;
    state.activeGenerationId = "";
    state.finalizedGenerationId = "";
    state.activeOverviewGenerationId = "";
    state.overviewCaptions = null;
    state.overviewRetrying = false;
    state.currentTime = YouTubeSummary.playbackTimeOr(currentTime, 0);
    state.pendingPlaybackRestore = restoreSnapshot
      ? {
          ...restoreSnapshot,
          tabId: nextTabId,
          videoId: nextVideoId,
          epoch: state.epoch,
        }
      : null;
    if (!state.videoId) {
      showEmpty();
      return;
    }
    setFollowPlayback(
      restoreSnapshot?.followPlayback ?? DEFAULT_FOLLOW_PLAYBACK,
    );
    hidePrepare();
    setGeneratingVisible(false);
    clearPoints();
    elements.empty.hidden = true;
    setStatus("正在准备摘要…");
    loadSummary();
    void restoreExplanationTaskForVideo(state.videoId);
  }

  function showLoadError(error, retry) {
    const message = error?.message || "生成失败，请重试";
    const needsKey = message.includes("API Key");
    hideProgress();
    setGeneratingVisible(false);
    setStatus(message, "error", {
      label: needsKey ? "打开设置" : "重试",
      onClick: () => {
        if (needsKey) chrome.runtime.openOptionsPage();
        else retry();
      },
    });
  }

  async function retryOverview() {
    if (state.overviewRetrying || !state.videoId || !state.tabId) return;
    const videoId = state.videoId;
    const epoch = state.epoch;
    const targetLanguage = state.targetLanguage;
    const requestGenerationId = state.activeGenerationId || generationId();
    const isCurrent = () =>
      state.videoId === videoId &&
      state.epoch === epoch &&
      state.targetLanguage === targetLanguage &&
      state.activeOverviewGenerationId === requestGenerationId;
    state.overviewRetrying = true;
    state.activeOverviewGenerationId = requestGenerationId;
    showOverviewPlaceholder();
    try {
      let captions = state.overviewCaptions;
      if (!captions || captions.videoId !== videoId) {
        captions = await tabMessage({ type: "GET_CAPTION_SEGMENTS", videoId });
      }
      if (!isCurrent()) return;
      if (!captions?.ok || captions.videoId !== videoId || !captions.supported) {
        throw new Error(captions?.error || "读取字幕失败");
      }
      state.overviewCaptions = captions;
      const response = await runtimeMessage({
        type: "GENERATE_OVERVIEW",
        payload: {
          videoId,
          generationId: requestGenerationId,
          sourceTabId: state.tabId,
          targetLanguage,
          segments: captions.segments,
        },
      });
      if (!isCurrent()) return;
      if (!response?.ok) {
        throw new Error(response?.error || "概览生成失败，请重试");
      }
      renderOverview(response.overview);
    } catch (error) {
      if (isCurrent()) {
        showOverviewError(error?.message || "概览生成失败，请重试");
      }
    } finally {
      if (isCurrent()) state.overviewRetrying = false;
    }
  }

  function restoreTaskSnapshot(task) {
    hidePrepare();
    clearPoints({ preserveOverview: true });
    state.activeGenerationId = task.generationId;
    state.finalizedGenerationId = "";
    state.activeOverviewGenerationId = task.generationId;
    state.loading = true;
    if (
      task.overviewStatus === "complete" &&
      task.overview &&
      !hasResolvedOverview()
    ) {
      renderOverview(task.overview, { animate: false });
    } else if (task.overviewStatus === "failed" && !hasResolvedOverview()) {
      showOverviewError(task.overviewError || "概览生成失败");
    } else if (elements.overview.hidden) {
      showOverviewPlaceholder();
    }
    setStatus("");
    setGeneratingVisible(true);
    if (task.status === "queued") {
      elements.generationCopy.textContent = "正在排队等待生成…";
    }
    mergePoints(task.points || [], false);
    applyPendingPlaybackRestore();
    state.receivedChunkIndexes = new Set(task.receivedChunkIndexes || []);
    state.totalChunks = Number(task.totalChunks) || 0;
    updateProgress(undefined, state.totalChunks);
  }

  async function resumeTaskFromCaptions(task, captions) {
    const videoId = state.videoId;
    const epoch = state.epoch;
    const targetLanguage = state.targetLanguage;
    state.overviewCaptions = captions;
    const isCurrent = () =>
      state.videoId === videoId &&
      state.epoch === epoch &&
      state.targetLanguage === targetLanguage &&
      state.activeGenerationId === task.generationId;
    try {
      const response = await runtimeMessage({
        type: "GENERATE_SUMMARY",
        payload: {
          videoId,
          generationId: task.generationId,
          sourceTabId: state.tabId,
          duration: captions.duration || 0,
          sourceLang: captions.sourceLang || "",
          targetLanguage,
          segments: captions.segments,
        },
      });
      if (!isCurrent() || !response?.ok) return;
      finalizeGeneratedSummary(response.summary, task.generationId);
    } catch (error) {
      if (isCurrent()) showLoadError(error, () => loadSummary({ immediate: true }));
    } finally {
      if (isCurrent()) state.loading = false;
    }
  }

  async function generateFromCaptions(captions) {
    if (!captions || (state.loading && state.activeGenerationId)) return;
    const videoId = state.videoId;
    const epoch = state.epoch;
    const targetLanguage = state.targetLanguage;
    const requestGenerationId = generationId();
    const isCurrent = () =>
      state.videoId === videoId &&
      state.epoch === epoch &&
      state.targetLanguage === targetLanguage &&
      state.activeGenerationId === requestGenerationId;
    hidePrepare();
    clearPoints();
    state.activeGenerationId = requestGenerationId;
    state.finalizedGenerationId = "";
    state.activeOverviewGenerationId = requestGenerationId;
    state.overviewCaptions = captions;
    state.loading = true;
    showOverviewPlaceholder();
    setStatus("");
    setGeneratingVisible(true);
    try {
      const response = await runtimeMessage({
        type: "GENERATE_SUMMARY",
        payload: {
          videoId,
          generationId: requestGenerationId,
          sourceTabId: state.tabId,
          duration: captions.duration || 0,
          sourceLang: captions.sourceLang || "",
          targetLanguage,
          segments: captions.segments,
        },
      });
      if (!isCurrent()) return;
      if (!response?.ok) throw new Error(response?.error || "生成失败，请重试");
      finalizeGeneratedSummary(response.summary, requestGenerationId);
    } catch (error) {
      if (!isCurrent()) return;
      showLoadError(error, () => {
        state.loaded = false;
        state.loading = false;
        generateFromCaptions(captions);
      });
    } finally {
      if (isCurrent()) {
        state.loading = false;
        setGeneratingVisible(false);
      }
    }
  }

  async function ensureLibraryTitleForSummary(
    videoId,
    targetLanguage,
    epoch,
  ) {
    try {
      const response = await runtimeMessage({
        type: "ENSURE_LIBRARY_TITLE",
        videoId,
        targetLanguage,
      });
      if (
        !response?.ok ||
        state.videoId !== videoId ||
        state.targetLanguage !== targetLanguage ||
        state.epoch !== epoch
      ) {
        return;
      }
      state.libraryTitle = YouTubeSummary.libraryTitleFromSummary(
        response.summary,
      );
    } catch {
      // 标题是洞见库增强字段，回填失败不影响现有摘要。
    }
  }

  async function loadSummary({ immediate = false } = {}) {
    const videoId = state.videoId;
    const epoch = state.epoch;
    const targetLanguage = state.targetLanguage;
    const isCurrent = () =>
      state.videoId === videoId &&
      state.epoch === epoch &&
      state.targetLanguage === targetLanguage;
    state.loading = true;
    setStatus("正在准备摘要…");
    try {
      const [cached, cachedOverview] = await Promise.all([
        runtimeMessage({
          type: "GET_CACHED_SUMMARY",
          videoId,
          targetLanguage,
        }),
        runtimeMessage({
          type: "GET_CACHED_OVERVIEW",
          videoId,
          targetLanguage,
        }),
      ]);
      if (!isCurrent()) return;
      if (!cached?.ok) throw new Error(cached?.error || "读取缓存失败");
      if (cachedOverview?.ok && cachedOverview.overview?.overview) {
        renderOverview(cachedOverview.overview.overview, { animate: false });
      }
      if (cached.summary) {
        renderSummary(cached.summary);
        applyPendingPlaybackRestore();
        state.loaded = true;
        hideProgress();
        setStatus("");
        void ensureLibraryTitleForSummary(videoId, targetLanguage, epoch);
        return;
      }

      const existingTask = await runtimeMessage({
        type: "GET_SUMMARY_TASK",
        videoId,
        targetLanguage,
        tabId: state.tabId,
      });
      if (!isCurrent()) return;
      if (!existingTask?.ok) {
        throw new Error(existingTask?.error || "读取生成任务失败");
      }
      if (existingTask.task) {
        restoreTaskSnapshot(existingTask.task);
        if (!existingTask.task.needsResume) return;

        const keyStatus = await runtimeMessage({ type: "GET_API_KEY_STATUS" });
        if (!isCurrent()) return;
        if (!keyStatus?.ok || !keyStatus.configured) {
          throw new Error(keyStatus?.error || "请先在插件设置里填入 API Key");
        }
        const captions = await tabMessage({ type: "GET_CAPTION_SEGMENTS", videoId });
        if (!isCurrent()) return;
        if (!captions?.ok || captions.videoId !== videoId || !captions.supported) {
          throw new Error(captions?.error || "读取字幕失败");
        }
        await resumeTaskFromCaptions(existingTask.task, captions);
        return;
      }

      const keyStatus = await runtimeMessage({ type: "GET_API_KEY_STATUS" });
      if (!isCurrent()) return;
      if (!keyStatus?.ok) throw new Error(keyStatus?.error || "读取设置失败");
      if (!keyStatus.configured) {
        throw new Error("请先在插件设置里填入 API Key");
      }

      const captions = await tabMessage({
        type: "GET_CAPTION_SEGMENTS",
        videoId,
      });
      if (!isCurrent()) return;
      if (!captions?.ok) throw new Error(captions?.error || "读取字幕失败");
      if (captions.videoId !== videoId) {
        throw new Error("字幕来源与当前视频不一致");
      }
      if (!captions.supported) {
        state.loaded = true;
        hideProgress();
        setStatus("这个视频没有字幕，暂不支持", "empty");
        return;
      }

      if (immediate) await generateFromCaptions(captions);
      else showPrepare(captions);
    } catch (error) {
      if (!isCurrent()) return;
      showLoadError(error, () => {
        state.loaded = false;
        state.loading = false;
        clearPoints();
        loadSummary({ immediate });
      });
    } finally {
      if (isCurrent() && !state.activeGenerationId) state.loading = false;
    }
  }

  async function useActiveTab({ snapshotCurrent = true } = {}) {
    if (snapshotCurrent) saveActivePlaybackSnapshot();
    const syncId = ++state.activeTabSyncId;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (syncId !== state.activeTabSyncId) return;
    const nextTabId = Number.isInteger(tab?.id) ? tab.id : null;
    const nextVideoTitle = cleanVideoTitle(tab?.title);
    if (!nextTabId) {
      switchToVideo({ tabId: null });
      return;
    }
    try {
      const response = await tabMessageTo(nextTabId, {
        type: "GET_VIDEO_STATE",
      });
      if (syncId !== state.activeTabSyncId) return;
      if (!response?.ok || !response.videoId) {
        switchToVideo({ tabId: nextTabId });
        return;
      }
      switchToVideo({
        tabId: nextTabId,
        videoId: response.videoId,
        currentTime: response.currentTime,
        videoTitle: response.videoTitle || nextVideoTitle,
      });
    } catch {
      if (syncId !== state.activeTabSyncId) return;
      switchToVideo({ tabId: nextTabId });
    }
  }

  function handleActiveTabChanged(activeInfo) {
    if (
      Number.isInteger(activeInfo?.tabId) &&
      activeInfo.tabId !== state.tabId
    ) {
      state.activatingTabId = activeInfo.tabId;
      invalidateFollowSeekRequests();
    }
    useActiveTab();
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (
      message?.type === "ANSWER_TASK_UPDATED" &&
      message.task?.taskId === state.answerTaskId &&
      message.task.videoId === state.videoId &&
      message.task.targetLanguage === state.targetLanguage
    ) {
      applyAnswerTask(message.task);
      return;
    }
    if (
      message?.type === "CONTEXT_EXPLANATION_TASK_UPDATED" &&
      message.task?.taskId === state.explanationTaskId &&
      message.task.videoId === state.videoId &&
      message.task.targetLanguage === state.targetLanguage
    ) {
      applyExplanationTask(message.task, {
        open:
          state.explanationDrawerOpen &&
          !message.task.dismissed &&
          !["cancelled", "expired"].includes(message.task.status),
      });
      return;
    }
    if (
      message?.type === "SUMMARY_CHUNK" &&
      message.videoId === state.videoId &&
      matchesGeneration(message, state.activeGenerationId) &&
      message.targetLanguage === state.targetLanguage
    ) {
      mergePoints(message.points, true);
      applyPendingPlaybackRestore();
      updateProgress(message.index, message.total);
      setStatus("");
      return;
    }
    if (
      message?.type === "SUMMARY_STRUCTURE_STARTED" &&
      message.videoId === state.videoId &&
      matchesGeneration(message, state.activeGenerationId) &&
      message.targetLanguage === state.targetLanguage
    ) {
      hideProgress();
      return;
    }
    if (
      message?.type === "OVERVIEW_STARTED" &&
      message.videoId === state.videoId &&
      matchesGeneration(message, state.activeOverviewGenerationId) &&
      message.targetLanguage === state.targetLanguage
    ) {
      showOverviewPlaceholder();
      return;
    }
    if (
      message?.type === "OVERVIEW_COMPLETE" &&
      message.videoId === state.videoId &&
      matchesGeneration(message, state.activeOverviewGenerationId) &&
      message.targetLanguage === state.targetLanguage
    ) {
      state.overviewRetrying = false;
      renderOverview(message.overview);
      return;
    }
    if (
      message?.type === "OVERVIEW_FAILED" &&
      message.videoId === state.videoId &&
      matchesGeneration(message, state.activeOverviewGenerationId) &&
      message.targetLanguage === state.targetLanguage
    ) {
      state.overviewRetrying = false;
      showOverviewError(message.error || "概览生成失败，请重试");
      return;
    }
    if (
      message?.type === "SUMMARY_QUEUED" &&
      message.videoId === state.videoId &&
      matchesGeneration(message, state.activeGenerationId) &&
      message.targetLanguage === state.targetLanguage
    ) {
      elements.generationCopy.textContent = "正在排队等待生成…";
      return;
    }
    if (
      message?.type === "SUMMARY_STARTED" &&
      message.videoId === state.videoId &&
      matchesGeneration(message, state.activeGenerationId) &&
      message.targetLanguage === state.targetLanguage
    ) {
      elements.generationCopy.textContent =
        `正在生成${generationLanguageLabel()}摘要…`;
      return;
    }
    if (
      message?.type === "SUMMARY_COMPLETE" &&
      message.videoId === state.videoId &&
      matchesGeneration(message, state.activeGenerationId) &&
      message.targetLanguage === state.targetLanguage
    ) {
      finalizeGeneratedSummary(message.summary, state.activeGenerationId);
      return;
    }
    if (
      message?.type === "SUMMARY_FAILED" &&
      message.videoId === state.videoId &&
      matchesGeneration(message, state.activeGenerationId) &&
      message.targetLanguage === state.targetLanguage
    ) {
      state.loading = false;
      hideProgress();
      setGeneratingVisible(false);
      showLoadError(new Error(message.error), () => loadSummary({ immediate: true }));
      return;
    }
    if (
      message?.type === "PLAYBACK_TIME" &&
      sender.tab?.id === state.tabId &&
      message.videoId === state.videoId
    ) {
      state.currentTime = Number(message.currentTime) || 0;
      updateNowPlaying();
      return;
    }
    if (
      message?.type === "VIDEO_CHANGED" &&
      sender.tab?.id === state.tabId
    ) {
      switchToVideo({
        tabId: sender.tab.id,
        videoId: message.videoId,
        currentTime: 0,
        videoTitle: message.videoTitle,
      });
    }
  });

  chrome.tabs.onActivated.addListener(handleActiveTabChanged);
  chrome.tabs.onRemoved.addListener((tabId) => {
    state.playbackSnapshots.remove(tabId);
    if (tabId !== state.tabId) return;
    state.activatingTabId = -1;
    invalidateFollowSeekRequests();
    useActiveTab({ snapshotCurrent: false });
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId !== state.tabId) return;
    if (changeInfo.title) {
      state.videoTitle = cleanVideoTitle(changeInfo.title);
    }
    if (changeInfo.url) {
      const videoId = YouTubeSummary.getVideoId(changeInfo.url);
      if (videoId) {
        switchToVideo({
          tabId,
          videoId,
          videoTitle: state.videoTitle,
        });
        return;
      }
    }
    if (changeInfo.status === "complete") {
      useActiveTab();
    }
  });

  elements.intentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void routeIntent(elements.intentInput.value);
  });
  elements.intentInput.addEventListener("input", updateIntentSubmitLabel);
  elements.answerClear.addEventListener("click", () => {
    if (state.answerTaskId) {
      runtimeMessage({
        type: "CLEAR_ANSWER",
        taskId: state.answerTaskId,
      }).catch(() => null);
    }
    clearAnswerLocal();
  });
  elements.answerSwitch.addEventListener("click", () => {
    const question = state.answerQuestion;
    if (state.answerTaskId) cancelAnswerContext("switched_to_navigation");
    elements.intentInput.value = question;
    updateIntentSubmitLabel();
    void runRecommendation(question);
  });
  elements.answerSave.addEventListener("click", () => {
    void saveCurrentAnswer();
  });
  elements.answerFollowupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = String(elements.answerFollowup.value || "").trim();
    if (
      !question ||
      !state.answerTaskId ||
      !state.answerResult ||
      state.answerTurns >= 2 ||
      ["queued", "running"].includes(state.answerTaskStatus)
    ) {
      return;
    }
    elements.answerFollowup.value = "";
    state.answerTaskStatus = "queued";
    renderAnswerTask({ status: "queued" });
    try {
      const response = await runtimeMessage({
        type: "ASK_ANSWER_FOLLOWUP",
        payload: {
          clientId: answerClientId(),
          sourceTabId: state.tabId,
          taskId: state.answerTaskId,
          question,
          expectedTurn: state.answerTurns,
          operationId: answerOperationId("followup"),
        },
      });
      if (!response?.ok) {
        throw new Error(response?.error || "追问失败，请重试");
      }
      applyAnswerTask(response.task);
    } catch (error) {
      state.answerTaskStatus = "ready";
      renderAnswerTask({ status: "ready" });
      showToast(error?.message || "追问失败，请重试");
    }
  });
  elements.followPlayback.addEventListener("click", () => {
    state.pendingPlaybackRestore = null;
    setFollowPlayback(!state.followPlayback, {
      sync: !state.followPlayback,
    });
  });
  elements.matchClear.addEventListener("click", () => {
    clearRecommendation({ restoreSections: true, clearInput: true });
    setIntentFeedback("");
  });
  elements.matchRelated.addEventListener("click", () => {
    void runSemanticSupplement();
  });
  elements.matchPrev.addEventListener("click", () => {
    focusRecommendation(state.recommendationIndex - 1);
  });
  elements.matchNext.addEventListener("click", () => {
    focusRecommendation(state.recommendationIndex + 1);
  });
  elements.list.addEventListener("keydown", navigatePointRows);
  elements.explainMenu.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  elements.saveSelection.addEventListener("click", saveCurrentSelection);
  elements.explainSelection.addEventListener("click", runInitialExplanation);
  elements.copySelection.addEventListener("click", copyExplanationSelection);
  elements.explanationClose.addEventListener("click", () => closeExplanation());
  elements.explanationScrim.addEventListener("click", () => closeExplanation());
  elements.explanationLatest.addEventListener("click", () => {
    elements.explanationBody.scrollTo({
      top: elements.explanationBody.scrollHeight,
      behavior: "smooth",
    });
    elements.explanationLatest.hidden = true;
  });
  elements.explanationBody.addEventListener(
    "scroll",
    () => {
      const distanceFromBottom =
        elements.explanationBody.scrollHeight -
        elements.explanationBody.scrollTop -
        elements.explanationBody.clientHeight;
      elements.explanationLatest.hidden = distanceFromBottom < 72;
    },
    { passive: true },
  );
  elements.libraryButton.addEventListener("click", () => {
    if (state.activeView === "library") closeLibrary();
    else void openLibrary();
  });
  elements.libraryBack.addEventListener("click", closeLibrary);
  elements.librarySearch.addEventListener(
    "input",
    applyLibrarySearchTransition,
  );
  elements.librarySearchClear.addEventListener("click", () => {
    elements.librarySearch.value = "";
    applyLibrarySearchTransition();
    elements.librarySearch.focus();
  });
  elements.libraryExport.addEventListener("click", () => {
    void exportClippingsBackup();
  });
  elements.libraryImport.addEventListener("click", () => {
    if (!state.libraryBackupBusy) elements.libraryImportFile.click();
  });
  elements.libraryImportFile.addEventListener("change", () => {
    void importClippingsBackupFile(elements.libraryImportFile.files?.[0]);
  });

  elements.languageButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleLanguageMenu();
  });
  elements.changeLanguage.addEventListener("click", (event) => {
    event.stopPropagation();
    showToast("选择新的摘要语言后会重新生成。");
    toggleLanguageMenu(true);
  });
  elements.generateNow.addEventListener("click", () => {
    if (state.pendingCaptions) generateFromCaptions(state.pendingCaptions);
  });
  elements.overviewRetry.addEventListener("click", retryOverview);
  elements.textScale.addEventListener("input", () => {
    state.textScaleTouched = true;
    applyTextScale(elements.textScale.value);
  });
  elements.textScale.addEventListener("change", () => {
    void saveTextScale(elements.textScale.value);
  });
  elements.textScaleReset.addEventListener("click", () => {
    void saveTextScale(TEXT_SCALE_DEFAULT);
  });
  for (const option of elements.languageOptions) {
    option.addEventListener("click", async () => {
      const nextSetting = option.dataset.language;
      const unchanged = nextSetting === state.languageSetting;
      const wasPreparing = state.preparing;
      const pendingCaptions = state.pendingCaptions;
      const previousTargetLanguage = state.targetLanguage;
      toggleLanguageMenu(false);
      if (wasPreparing) stopPrepareCountdown();
      if (unchanged) {
        startPrepareCountdown();
        return;
      }
      cancelExplanationRequest("language_changed");
      closeExplanation({ dismiss: false, clearTask: true });
      cancelAnswerContext("language_changed");
      state.languageSetting = nextSetting;
      updateLanguageControl();
      if (state.activeView === "library") renderLibrary();
      await chrome.storage.local.set({
        [LANGUAGE_SETTING_KEY]: state.languageSetting,
      });
      if (!state.videoId) return;
      if (wasPreparing && pendingCaptions) {
        showPrepare(pendingCaptions);
        return;
      }
      await runtimeMessage({
        type: "CANCEL_GENERATION",
        videoId: state.videoId,
        targetLanguage: previousTargetLanguage,
        tabId: state.tabId,
      }).catch(() => null);
      state.epoch += 1;
      state.libraryTitle = "";
      state.loaded = false;
      state.loading = false;
      state.activeGenerationId = "";
      state.finalizedGenerationId = "";
      hidePrepare();
      setGeneratingVisible(false);
      clearPoints();
      loadSummary({ immediate: true });
    });
  }
  let explanationSelectionTimer = null;
  const queueSelectionCapture = () => {
    clearTimeout(explanationSelectionTimer);
    explanationSelectionTimer = setTimeout(captureExplainableSelection, 120);
  };
  document.addEventListener("selectionchange", queueSelectionCapture);
  document.addEventListener("pointerup", queueSelectionCapture);
  document.addEventListener("keyup", (event) => {
    if (
      event.shiftKey ||
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      queueSelectionCapture();
    }
  });
  window.addEventListener(
    "scroll",
    () => {
      if (!elements.explainMenu.hidden) positionExplainMenu();
    },
    { passive: true },
  );
  window.addEventListener("resize", () => {
    if (!elements.explainMenu.hidden) positionExplainMenu();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".yvpm-language-control")) {
      toggleLanguageMenu(false);
    }
    if (
      !event.target.closest("#yvpm-explain-menu") &&
      window.getSelection()?.isCollapsed
    ) {
      hideExplainMenu();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const languageWasOpen = !elements.languageMenu.hidden;
      toggleLanguageMenu(false);
      if (state.explanationDrawerOpen) {
        closeExplanation();
      } else if (!languageWasOpen && state.activeView === "library") {
        closeLibrary();
      } else {
        hideExplainMenu();
      }
      if (languageWasOpen) elements.languageButton.focus();
    }
  });

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (
      areaName !== "local" ||
      !changes?.[SkimlineCollections.CLIPPINGS_STORAGE_KEY]
    ) {
      return;
    }
    const store = SkimlineCollections.normalizeReplicaState(
      changes[SkimlineCollections.CLIPPINGS_STORAGE_KEY].newValue,
    );
    state.clippings = SkimlineCollections.listClippings([store]);
    state.videoTitles = store.videoTitles;
    state.clippingsRevision = store.revision;
    state.libraryError = "";
    if (state.answerResult) {
      syncAnswerSavedFingerprint();
      updateAnswerSaveButton();
    }
    reconcileLibraryExpansionState();
    initializeVisibleLibraryExpansion();
    updateLibraryCount();
    if (state.activeView === "library") renderLibrary();
  });

  (async () => {
    applyTextScale(TEXT_SCALE_DEFAULT);
    updateFollowPlaybackControl();
    try {
      const saved = await chrome.storage.local.get(LANGUAGE_SETTING_KEY);
      if (LANGUAGE_OPTIONS[saved?.[LANGUAGE_SETTING_KEY]]) {
        state.languageSetting = saved[LANGUAGE_SETTING_KEY];
      }
    } catch {
      // 设置读取失败时使用 Chrome 当前语言，不阻塞摘要功能。
    }
    try {
      const saved = await chrome.storage.local.get(TEXT_SCALE_SETTING_KEY);
      if (!state.textScaleTouched) {
        applyTextScale(saved?.[TEXT_SCALE_SETTING_KEY]);
      }
    } catch {
      // 文字设置读取失败时使用 100%，不阻塞 Side Panel。
    }
    updateLanguageControl();
    void loadClippings();
    useActiveTab();
  })();
})();
