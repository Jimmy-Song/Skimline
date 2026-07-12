(function initializeSidePanel() {
  "use strict";

  const DEFAULT_SECTIONS_COLLAPSED = true;
  const LANGUAGE_SETTING_KEY = "summary_language";
  const PREPARE_COUNTDOWN_SECONDS = 3;
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
    loaded: false,
    loading: false,
    preparing: false,
    languageSetting: "auto",
    targetLanguage: "zh-CN",
    activeGenerationId: "",
    pendingCaptions: null,
    countdownTimer: null,
    toastTimer: null,
    points: [],
    pointIds: new Set(),
    pointRows: new Map(),
    receivedChunkIndexes: new Set(),
    totalChunks: 0,
    epoch: 0,
    currentTime: 0,
    currentIndex: -1,
    currentSectionIndex: -1,
    sectionGroups: [],
    sectionViews: [],
    expandedRow: null,
    recommendationRequestId: 0,
    recommendationIntent: "",
    recommendationRows: [],
    recommendationIndex: -1,
    recommendationPreviousExpanded: null,
  };

  const elements = {
    panel: document.querySelector("#yvpm-panel"),
    empty: document.querySelector("#yvpm-empty"),
    list: document.querySelector("#yvpm-list"),
    overview: document.querySelector("#yvpm-overview"),
    overviewLabel: document.querySelector(".yvpm-overview-label"),
    overviewText: document.querySelector("#yvpm-overview-text"),
    intent: document.querySelector("#yvpm-intent"),
    intentForm: document.querySelector("#yvpm-intent-form"),
    intentInput: document.querySelector("#yvpm-intent-input"),
    intentSubmit: document.querySelector("#yvpm-intent-submit"),
    intentChips: document.querySelector("#yvpm-intent-chips"),
    intentFeedback: document.querySelector("#yvpm-intent-feedback"),
    matchbar: document.querySelector("#yvpm-matchbar"),
    matchbarText: document.querySelector("#yvpm-matchbar-text"),
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
    languageControl: document.querySelector(".yvpm-language-control"),
    languageButton: document.querySelector("#yvpm-language-button"),
    languageLabel: document.querySelector("#yvpm-language-label"),
    languageMenu: document.querySelector("#yvpm-language-menu"),
    languageOptions: [
      ...document.querySelectorAll("#yvpm-language-menu [data-language]"),
    ],
    toast: document.querySelector("#yvpm-toast"),
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

  function tabMessage(message) {
    return new Promise((resolve, reject) => {
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

  function resolveTargetLanguage(setting = state.languageSetting) {
    const requested = setting === "auto" ? navigator.language : setting;
    return normalizeTargetLanguage(requested);
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
    if (open) {
      const selected = elements.languageMenu.querySelector(
        '[aria-selected="true"]',
      );
      selected?.focus();
    }
  }

  function showToast(message) {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    state.toastTimer = setTimeout(() => {
      elements.toast.hidden = true;
    }, 1800);
  }

  function stopPrepareCountdown() {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }

  function hidePrepare() {
    stopPrepareCountdown();
    state.preparing = false;
    state.pendingCaptions = null;
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
    elements.prepareCopy.textContent =
      `视频字幕语言为${sourceLanguageDisplayName(captions.sourceLang)}，摘要将使用右上角选择的语言呈现。`;
    elements.prepare.hidden = false;
    stopPrepareCountdown();
    let seconds = PREPARE_COUNTDOWN_SECONDS;
    elements.countdown.textContent = String(seconds);
    state.countdownTimer = setInterval(() => {
      seconds -= 1;
      elements.countdown.textContent = String(Math.max(0, seconds));
      if (seconds <= 0) {
        stopPrepareCountdown();
        generateFromCaptions(captions);
      }
    }, 1000);
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

  function clearRecommendation({
    restoreSections = true,
    clearInput = false,
    invalidate = true,
  } = {}) {
    if (invalidate) state.recommendationRequestId += 1;
    for (const row of state.recommendationRows) {
      row.classList.remove("yvpm-recommended", "yvpm-recommendation-focus");
    }
    if (restoreSections) restoreRecommendationSections();
    state.recommendationIntent = "";
    state.recommendationRows = [];
    state.recommendationIndex = -1;
    state.recommendationPreviousExpanded = null;
    elements.matchbar.hidden = true;
    elements.panel?.classList.remove("yvpm-has-matches");
    setActiveIntentChip("");
    if (clearInput) elements.intentInput.value = "";
  }

  function getPointRow(timestamp) {
    const target = Math.max(0, Math.floor(Number(timestamp) || 0));
    return [...elements.list.querySelectorAll(".yvpm-row")].find(
      (row) => Number(row.dataset.t) === target,
    );
  }

  function focusRecommendation(index) {
    if (!state.recommendationRows.length) return;
    const length = state.recommendationRows.length;
    state.recommendationIndex = (index + length) % length;
    for (const row of state.recommendationRows) {
      row.classList.remove("yvpm-recommendation-focus");
    }
    const row = state.recommendationRows[state.recommendationIndex];
    row.classList.add("yvpm-recommendation-focus");
    row.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function renderMatchbar(intent, count) {
    const prefix = document.createTextNode("已为“");
    const intentStrong = document.createElement("strong");
    intentStrong.textContent = intent;
    const middle = document.createTextNode("”找到 ");
    const countStrong = document.createElement("strong");
    countStrong.textContent = String(count);
    const suffix = document.createTextNode(" 个观点");
    elements.matchbarText.replaceChildren(
      prefix,
      intentStrong,
      middle,
      countStrong,
      suffix,
    );
    elements.matchbar.hidden = false;
    elements.panel?.classList.add("yvpm-has-matches");
  }

  function applyRecommendation(intent, pointTs) {
    state.recommendationIntent = intent;
    state.recommendationRows = (Array.isArray(pointTs) ? pointTs : [])
      .map(getPointRow)
      .filter(Boolean)
      .slice(0, 4);
    if (!state.recommendationRows.length) return false;

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
    setActiveIntentChip(intent);
    renderMatchbar(intent, state.recommendationRows.length);
    focusRecommendation(0);
    return true;
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

    clearRecommendation({ restoreSections: true, invalidate: false });
    state.recommendationPreviousExpanded = state.sectionViews.map(
      (view) => !view.body.hidden,
    );
    const requestId = ++state.recommendationRequestId;
    const videoId = state.videoId;
    elements.intentInput.value = intent;
    setActiveIntentChip(intent);
    setIntentBusy(true);
    setIntentFeedback("正在匹配现有摘要中的相关观点…", "loading");
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
      if (!applyRecommendation(intent, response.pointTs)) {
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

  function renderIntentControls(summary) {
    elements.intentChips.replaceChildren();
    const intents = Array.isArray(summary?.suggestedIntents)
      ? summary.suggestedIntents.slice(0, 3)
      : [];
    for (const intent of intents) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "yvpm-intent-chip";
      chip.dataset.intent = intent;
      chip.textContent = intent;
      chip.addEventListener("click", () => runRecommendation(intent));
      elements.intentChips.append(chip);
    }
    setIntentBusy(false);
    setIntentFeedback("");
    elements.intent.hidden = false;
  }

  function showOverviewPlaceholder() {
    elements.overview.className = "yvpm-overview yvpm-overview-pending";
    elements.overviewLabel.textContent = "概览生成中…";
    elements.overviewText.textContent = "";
    elements.overview.hidden = false;
  }

  function collapseExpandedRow(except = null) {
    if (!state.expandedRow || state.expandedRow === except) return;
    const toggle = state.expandedRow.querySelector(".yvpm-point-toggle");
    const detail = state.expandedRow.querySelector(
      ".yvpm-detail, .yvpm-insight-card",
    );
    state.expandedRow.classList.remove("yvpm-expanded");
    toggle?.setAttribute("aria-expanded", "false");
    if (detail) detail.hidden = true;
    state.expandedRow = null;
  }

  function createSeekButton(point) {
    const seek = document.createElement("button");
    seek.type = "button";
    seek.className = "yvpm-seek";
    seek.textContent = "▶ 看这段";
    seek.addEventListener("click", async (event) => {
      event.stopPropagation();
      const response = await tabMessage({ type: "SEEK", t: point.t });
      if (!response?.ok) throw new Error(response?.error || "视频跳转失败");
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
    row.setAttribute("role", "listitem");

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "yvpm-point-toggle";
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

    toggle.addEventListener("click", () => {
      const expanding = detail.hidden;
      collapseExpandedRow(row);
      detail.hidden = !expanding;
      row.classList.toggle("yvpm-expanded", expanding);
      toggle.setAttribute("aria-expanded", String(expanding));
      state.expandedRow = expanding ? row : null;
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
      setSectionExpanded(view, body.hidden);
      updateNowPlaying({ follow: false });
    });
    range.addEventListener("click", async () => {
      const response = await tabMessage({ type: "SEEK", t: group.startT });
      if (!response?.ok) throw new Error(response?.error || "视频跳转失败");
    });

    header.append(toggle, range);
    section.append(header, body);
    return view;
  }

  function updateNowPlaying({ follow = true } = {}) {
    const rows = elements.list.querySelectorAll(".yvpm-row");
    const index = YouTubeSummary.findCurrentPointIndex(
      state.points,
      state.currentTime,
    );
    rows.forEach((row, rowIndex) => {
      row.classList.toggle("yvpm-now-playing", rowIndex === index);
    });
    const sectionIndex = YouTubeSummary.findCurrentSectionIndex(
      state.sectionGroups,
      state.currentTime,
    );
    state.sectionViews.forEach((view, viewIndex) => {
      view.section.classList.toggle(
        "yvpm-section-current",
        viewIndex === sectionIndex,
      );
    });
    if (
      follow &&
      !state.recommendationRows.length &&
      index >= 0 &&
      index !== state.currentIndex
    ) {
      const row = rows[index];
      const sectionBody = row?.closest(".yvpm-section-body");
      if (!sectionBody || !sectionBody.hidden) {
        row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
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
    const fragment = document.createDocumentFragment();
    for (const point of mergedPoints) {
      const key = YouTubeSummary.pointStableKey(state.videoId, point);
      let row = state.pointRows.get(key);
      if (!row) {
        row = createPointRow(point, animate, insightMap.get(point.t) || null);
        row.dataset.key = key;
        state.pointRows.set(key, row);
      } else {
        updatePointRow(row, point, insightMap.get(point.t) || null);
      }
      fragment.append(row);
    }
    elements.list.append(fragment);
    state.points = mergedPoints;
    updateNowPlaying({ follow: false });
  }

  function renderSummary(summary) {
    clearPoints();
    const points = YouTubeSummary.dedupePointsByTimestamp(summary?.points);
    const groups = YouTubeSummary.groupPointsBySections(
      points,
      summary?.sections,
    );
    const insightMap = insightMapFromSummary(summary);
    if (!summary?.overview || !groups.length) {
      mergePoints(points, false, insightMap);
      renderIntentControls(summary);
      return;
    }

    elements.overviewText.textContent = summary.overview;
    elements.overviewLabel.textContent = "概览";
    elements.overview.className = "yvpm-overview yvpm-overview-arrive";
    elements.overview.hidden = false;
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
    renderIntentControls(summary);
    updateNowPlaying({ follow: false });
  }

  function clearPoints() {
    clearRecommendation({ restoreSections: false, clearInput: true });
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
    elements.overview.className = "yvpm-overview";
    elements.overviewLabel.textContent = "概览";
    elements.overview.hidden = true;
    elements.overviewText.textContent = "";
    elements.intent.hidden = true;
    elements.intentChips.replaceChildren();
    setIntentFeedback("");
    setIntentBusy(false);
    elements.list.replaceChildren();
    hideProgress();
  }

  function showEmpty() {
    hidePrepare();
    setGeneratingVisible(false);
    clearPoints();
    setStatus("");
    elements.empty.hidden = false;
  }

  function switchToVideo(videoId, currentTime = 0) {
    if (
      videoId &&
      state.videoId === videoId &&
      (state.loading || state.loaded || state.preparing)
    ) {
      state.currentTime = Number(currentTime) || state.currentTime;
      updateNowPlaying({ follow: false });
      return;
    }
    state.epoch += 1;
    state.videoId = videoId || "";
    state.loaded = false;
    state.loading = false;
    state.preparing = false;
    state.activeGenerationId = "";
    state.currentTime = Number(currentTime) || 0;
    hidePrepare();
    setGeneratingVisible(false);
    clearPoints();
    if (!state.videoId) {
      showEmpty();
      return;
    }
    elements.empty.hidden = true;
    setStatus("正在准备摘要…");
    loadSummary();
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

  function restoreTaskSnapshot(task) {
    hidePrepare();
    clearPoints();
    state.activeGenerationId = task.generationId;
    state.loading = true;
    showOverviewPlaceholder();
    setStatus("");
    setGeneratingVisible(true);
    if (task.status === "queued") {
      elements.generationCopy.textContent = "正在排队等待生成…";
    }
    mergePoints(task.points || [], false);
    state.receivedChunkIndexes = new Set(task.receivedChunkIndexes || []);
    state.totalChunks = Number(task.totalChunks) || 0;
    updateProgress(undefined, state.totalChunks);
  }

  async function resumeTaskFromCaptions(task, captions) {
    const videoId = state.videoId;
    const epoch = state.epoch;
    const targetLanguage = state.targetLanguage;
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
      renderSummary(response.summary);
      state.loaded = true;
      hideProgress();
      setGeneratingVisible(false);
      setStatus("");
    } catch (error) {
      if (isCurrent()) showLoadError(error, () => loadSummary({ immediate: true }));
    } finally {
      if (isCurrent()) state.loading = false;
    }
  }

  async function generateFromCaptions(captions) {
    const videoId = state.videoId;
    const epoch = state.epoch;
    const targetLanguage = state.targetLanguage;
    const requestGenerationId = generationId();
    state.activeGenerationId = requestGenerationId;
    const isCurrent = () =>
      state.videoId === videoId &&
      state.epoch === epoch &&
      state.targetLanguage === targetLanguage &&
      state.activeGenerationId === requestGenerationId;
    hidePrepare();
    clearPoints();
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
      renderSummary(response.summary);
      state.loaded = true;
      hideProgress();
      setGeneratingVisible(false);
      setStatus("");
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
      const cached = await runtimeMessage({
        type: "GET_CACHED_SUMMARY",
        videoId,
        targetLanguage,
      });
      if (!isCurrent()) return;
      if (!cached?.ok) throw new Error(cached?.error || "读取缓存失败");
      if (cached.summary) {
        renderSummary(cached.summary);
        state.loaded = true;
        hideProgress();
        setStatus("");
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

  async function useActiveTab() {
    const epoch = ++state.epoch;
    state.loaded = false;
    state.loading = false;
    state.preparing = false;
    state.activeGenerationId = "";
    hidePrepare();
    setGeneratingVisible(false);
    clearPoints();
    setStatus("");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (epoch !== state.epoch) return;
    state.tabId = tab?.id || null;
    if (!state.tabId) {
      state.videoId = "";
      showEmpty();
      return;
    }
    try {
      const response = await tabMessage({ type: "GET_VIDEO_STATE" });
      if (epoch !== state.epoch) return;
      if (!response?.ok || !response.videoId) {
        switchToVideo("");
        return;
      }
      switchToVideo(response.videoId, response.currentTime);
    } catch {
      if (epoch !== state.epoch) return;
      switchToVideo("");
    }
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (
      message?.type === "SUMMARY_CHUNK" &&
      message.videoId === state.videoId &&
      message.generationId === state.activeGenerationId &&
      message.targetLanguage === state.targetLanguage
    ) {
      mergePoints(message.points, true);
      updateProgress(message.index, message.total);
      setStatus("");
      return;
    }
    if (
      message?.type === "SUMMARY_STRUCTURE_STARTED" &&
      message.videoId === state.videoId &&
      message.generationId === state.activeGenerationId &&
      message.targetLanguage === state.targetLanguage
    ) {
      hideProgress();
      showOverviewPlaceholder();
      return;
    }
    if (
      message?.type === "SUMMARY_QUEUED" &&
      message.videoId === state.videoId &&
      message.generationId === state.activeGenerationId &&
      message.targetLanguage === state.targetLanguage
    ) {
      elements.generationCopy.textContent = "正在排队等待生成…";
      return;
    }
    if (
      message?.type === "SUMMARY_STARTED" &&
      message.videoId === state.videoId &&
      message.generationId === state.activeGenerationId &&
      message.targetLanguage === state.targetLanguage
    ) {
      elements.generationCopy.textContent =
        `正在生成${generationLanguageLabel()}摘要…`;
      return;
    }
    if (
      message?.type === "SUMMARY_COMPLETE" &&
      message.videoId === state.videoId &&
      message.generationId === state.activeGenerationId &&
      message.targetLanguage === state.targetLanguage
    ) {
      renderSummary(message.summary);
      state.loaded = true;
      state.loading = false;
      hideProgress();
      setGeneratingVisible(false);
      setStatus("");
      return;
    }
    if (
      message?.type === "SUMMARY_FAILED" &&
      message.videoId === state.videoId &&
      message.generationId === state.activeGenerationId &&
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
      switchToVideo(message.videoId);
    }
  });

  chrome.tabs.onActivated.addListener(useActiveTab);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId !== state.tabId) return;
    if (changeInfo.url) {
      const videoId = YouTubeSummary.getVideoId(changeInfo.url);
      if (videoId) {
        switchToVideo(videoId);
        return;
      }
    }
    if (changeInfo.status === "complete") {
      useActiveTab();
    }
  });

  elements.intentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runRecommendation(elements.intentInput.value);
  });
  elements.matchClear.addEventListener("click", () => {
    clearRecommendation({ restoreSections: true });
    setIntentFeedback("");
  });
  elements.matchPrev.addEventListener("click", () => {
    focusRecommendation(state.recommendationIndex - 1);
  });
  elements.matchNext.addEventListener("click", () => {
    focusRecommendation(state.recommendationIndex + 1);
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
  for (const option of elements.languageOptions) {
    option.addEventListener("click", async () => {
      const nextSetting = option.dataset.language;
      const unchanged = nextSetting === state.languageSetting;
      toggleLanguageMenu(false);
      if (unchanged) {
        if (state.preparing && state.pendingCaptions) {
          generateFromCaptions(state.pendingCaptions);
        }
        return;
      }
      state.languageSetting = nextSetting;
      updateLanguageControl();
      await chrome.storage.local.set({
        [LANGUAGE_SETTING_KEY]: state.languageSetting,
      });
      if (!state.videoId) return;
      await runtimeMessage({
        type: "CANCEL_GENERATION",
        videoId: state.videoId,
        targetLanguage: state.targetLanguage,
        tabId: state.tabId,
      }).catch(() => null);
      state.epoch += 1;
      state.loaded = false;
      state.loading = false;
      state.activeGenerationId = "";
      hidePrepare();
      setGeneratingVisible(false);
      clearPoints();
      loadSummary({ immediate: true });
    });
  }
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".yvpm-language-control")) {
      toggleLanguageMenu(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      toggleLanguageMenu(false);
      elements.languageButton.focus();
    }
  });

  (async () => {
    try {
      const saved = await chrome.storage.local.get(LANGUAGE_SETTING_KEY);
      if (LANGUAGE_OPTIONS[saved?.[LANGUAGE_SETTING_KEY]]) {
        state.languageSetting = saved[LANGUAGE_SETTING_KEY];
      }
    } catch {
      // 设置读取失败时使用 Chrome 当前语言，不阻塞摘要功能。
    }
    updateLanguageControl();
    useActiveTab();
  })();
})();
