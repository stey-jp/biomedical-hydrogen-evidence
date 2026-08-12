const state = {
  queue: [],
  loading: false,
  progress: null,
  lastSaved: null,
  duplicateTarget: null,
  translationDisabled: false,
  abstracts: new Map(),
  bookmarks: new Map(),
  bookmarkReviewer: "",
  selectedBookmarks: new Set(),
  colloquialCandidates: [],
  colloquialResponses: new Map(),
  colloquialResponse: null,
  reviewers: [],
  transitioning: false,
};

const elements = Object.fromEntries([
  "options-button", "options-dialog", "close-options", "login-panel", "login-form", "admin-token", "login-error",
  "review-app", "review-status", "screening-hint", "reviewer", "reviewer-history", "logout", "export-csv", "show-bookmarks", "bookmark-count", "progress-text",
  "progress-detail", "progress", "candidate", "skip", "queue-status",
  "revise-last", "include", "exclude", "needs-review", "duplicate",
  "exclude-dialog", "exclude-form", "duplicate-dialog", "duplicate-form", "duplicate-results",
  "duplicate-query", "search-duplicate", "confirm-duplicate", "reason-dialog", "close-reason",
  "reason-form", "reason-text", "toast",
  "abstract-dialog", "abstract-content", "close-abstract",
  "bookmark-dialog", "bookmark-results", "bookmark-summary", "bookmark-export", "bookmark-generate",
  "bookmark-selected-count", "close-bookmarks",
  "colloquial-dialog", "colloquial-dialog-title", "colloquial-sources", "colloquial-form",
  "colloquial-level", "colloquial-level-value", "colloquial-generate", "colloquial-status",
  "colloquial-result", "colloquial-items", "colloquial-copy-all", "close-colloquial",
].map((id) => [id, document.querySelector(`#${id}`)]));

const excludeReasons = {
  not_h2: "分子状水素H₂を扱っていない。",
  non_biomedical: "植物・農業・食品保存など、生物医学研究の対象外。",
  industrial: "産業用水素・燃料電池・水素製造等で対象外。",
  not_report: "研究結果を報告する文献ではない。",
};

const reviewStatusLabels = {
  pending: "未判定",
  include: "採用済み",
  exclude: "対象外",
  duplicate: "重複",
  needs_review: "保留済み",
};

const decisionToastFeedback = {
  include: { message: "「採用」として保存しました", tone: "include" },
  exclude: { message: "「対象外」として保存しました", tone: "exclude" },
  duplicate: { message: "「重複」として保存しました", tone: "duplicate" },
  needs_review: { message: "「保留」として保存しました", tone: "needs-review" },
};

const abstractErrorMessages = {
  translation_disabled: "翻訳APIの設定後に要旨対訳を表示します。",
  pubmed_abstract_missing: "PubMedには要旨が収録されていません。原資料を確認してください。",
  abstract_missing: "利用可能な要旨が収録されていません。原資料を確認してください。",
  abstract_unavailable: "利用可能な要旨が収録されていません。原資料を確認してください。",
  abstract_fetch_failed: "要旨の取得に失敗しました。時間をおいて再試行してください。",
  translation_provider_failed: "要旨は取得できましたが、翻訳に失敗しました。時間をおいて再試行してください。",
};

const colloquialErrorMessages = {
  generation_disabled: "OPENAI_REVIEW_API_KEYの設定後に生成できます。",
  generation_rate_limited: "OpenAI APIの利用上限に達しました。時間をおいて再試行してください。",
  generation_timeout: "生成がタイムアウトしました。時間をおいて再試行してください。",
  generation_refused: "選択した論文の口語訳を作成できませんでした。",
  generation_incomplete: "生成が完了しませんでした。もう一度お試しください。",
  generation_invalid_output: "生成結果の形式を確認できませんでした。もう一度お試しください。",
  generation_provider_failed: "口語訳を作成できませんでした。時間をおいて再試行してください。",
  invalid_selection: "口語訳にする論文を1〜10件選択してください。",
  bookmark_not_found: "この論文は現在のReviewerのブックマークにありません。",
  pubmed_abstract_missing: "PubMedには抄録が収録されていないため生成できません。",
  abstract_missing: "利用可能な抄録が収録されていないため生成できません。",
  abstract_fetch_failed: "抄録を取得できませんでした。時間をおいて再試行してください。",
};

const colloquialLevels = [
  { value: "elementary", label: "小学生" },
  { value: "junior_high", label: "中学生" },
  { value: "high_school", label: "高校生" },
];
const maxColloquialSelection = 10;

async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error?.message ?? `Request failed: ${response.status}`);
    error.status = response.status;
    error.code = body.error?.code;
    throw error;
  }
  return body;
}

let toastVisibilityTimer;

function showToast(message, tone = "default") {
  window.clearTimeout(toastVisibilityTimer);
  const wasHidden = elements.toast.hidden;
  elements.toast.textContent = message;
  elements.toast.dataset.tone = tone;
  elements.toast.hidden = false;
  if (wasHidden) {
    elements.toast.getBoundingClientRect();
  }
  elements.toast.classList.add("is-visible");
  toastVisibilityTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
    toastVisibilityTimer = window.setTimeout(() => {
      if (!elements.toast.classList.contains("is-visible")) elements.toast.hidden = true;
    }, 240);
  }, 2600);
}

function showLogin(message = "") {
  elements["review-app"].hidden = true;
  elements["options-button"].hidden = true;
  if (elements["options-dialog"].open) closeDialog(elements["options-dialog"]);
  elements["login-panel"].hidden = false;
  elements["login-error"].textContent = message;
  elements["login-error"].hidden = !message;
}

function showApp() {
  elements["login-panel"].hidden = true;
  elements["review-app"].hidden = false;
  elements["options-button"].hidden = false;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function text(tag, value, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}

const dialogCloseStates = new WeakMap();

function openDialog(dialog) {
  dialog.returnValue = "";
  dialog.classList.remove("is-closing", "is-visible");
  dialog.showModal();
  dialog.getBoundingClientRect();
  dialog.classList.add("is-visible");
  const focusTarget = dialog.querySelector(".dialog-card");
  if (focusTarget) {
    focusTarget.tabIndex = -1;
    focusTarget.focus({ preventScroll: true });
  }
}

function closeDialog(dialog, returnValue = "cancel") {
  if (!dialog.open) return Promise.resolve();
  const activeClose = dialogCloseStates.get(dialog);
  if (activeClose) return activeClose;
  dialog.classList.remove("is-visible");
  dialog.classList.add("is-closing");
  const pendingClose = new Promise((resolve) => {
    window.setTimeout(() => {
      dialogCloseStates.delete(dialog);
      if (dialog.open) dialog.close(returnValue);
      dialog.classList.remove("is-closing");
      resolve();
    }, 240);
  });
  dialogCloseStates.set(dialog, pendingClose);
  return pendingClose;
}

function sourceLink(label, url) {
  const anchor = document.createElement("a");
  anchor.className = "source-link";
  anchor.textContent = label;
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
}

function currentCandidate() {
  return state.queue[0];
}

const journalMetricNumber = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 3 });

function journalMetricLabel(candidate, missing = "引用指標 未収録") {
  const metric = candidate?.journalMetric;
  if (!Number.isFinite(metric?.value)) return missing;
  const year = Number.isInteger(metric.year) ? `・${metric.year}` : "";
  return `引用指標 ${journalMetricNumber.format(metric.value)}（OpenAlex${year}）`;
}

function journalMetricDescription(candidate) {
  const metric = candidate?.journalMetric;
  if (!Number.isFinite(metric?.value)) return "";
  const year = Number.isInteger(metric.year) ? `（${metric.year}年）` : "";
  return `OpenAlex 2年平均被引用数${year}。Clarivate JIFではありません。`;
}

function reviewerValue() {
  return elements.reviewer.value.trim();
}

function renderReviewerOptions() {
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = state.reviewers.length ? "履歴から選択" : "履歴はまだありません";
  const options = state.reviewers.map((entry) => {
    const option = document.createElement("option");
    option.value = entry.reviewer;
    option.textContent = `${entry.reviewer}（${entry.reviewCount}件 · 最終 ${entry.lastReviewedAt?.slice(0, 10) ?? "不明"}）`;
    return option;
  });
  elements["reviewer-history"].replaceChildren(placeholder, ...options);
  elements["reviewer-history"].value = state.reviewers.some((entry) => entry.reviewer === reviewerValue())
    ? reviewerValue()
    : "";
}

async function loadReviewers() {
  const result = await api("/api/review/v1/reviewers");
  state.reviewers = result.data;
  renderReviewerOptions();
}

function rememberReviewer(reviewer, reviewedAt) {
  const existing = state.reviewers.find((entry) => entry.reviewer === reviewer);
  state.reviewers = [
    {
      reviewer,
      reviewCount: (existing?.reviewCount ?? 0) + 1,
      lastReviewedAt: reviewedAt,
    },
    ...state.reviewers.filter((entry) => entry.reviewer !== reviewer),
  ].slice(0, 200);
  renderReviewerOptions();
}

function isBookmarked(candidateKey) {
  return state.bookmarkReviewer === reviewerValue() && state.bookmarks.has(candidateKey);
}

function updateBookmarkCount() {
  const count = state.bookmarkReviewer === reviewerValue() ? state.bookmarks.size : 0;
  elements["bookmark-count"].textContent = String(count);
  elements["bookmark-count"].setAttribute("aria-label", `${count}件`);
  elements["show-bookmarks"].setAttribute("aria-label", `ブックマーク ${count}件`);
}

function disableDecisions(disabled) {
  document.querySelectorAll(".decision").forEach((button) => { button.disabled = disabled; });
}

function updateCandidateControls(candidate) {
  elements.skip.disabled = state.transitioning || !candidate || state.queue.length < 2;
  disableDecisions(state.transitioning || !candidate);
  elements["needs-review"].textContent = candidate?.reviewStatus === "needs_review" ? "保留済み" : "保留";
  if (candidate?.reviewStatus === "needs_review") elements["needs-review"].disabled = true;
  if (candidate?.reviewStatus === "include") elements.include.disabled = true;
}

async function animateCandidate(phase, decision) {
  const className = `is-sorting-${phase}`;
  elements.candidate.dataset.sortDecision = decision;
  elements.candidate.classList.remove("is-sorting-in", "is-sorting-out");
  elements.candidate.getBoundingClientRect();
  elements.candidate.classList.add(className);
  await Promise.allSettled(elements.candidate.getAnimations().map((animation) => animation.finished));
  elements.candidate.classList.remove(className);
  if (phase === "in") delete elements.candidate.dataset.sortDecision;
}

function titleTranslation(candidate) {
  const container = document.createElement("section");
  container.className = "title-translation";
  container.append(text("span", "日本語参考訳", "translation-label"));
  if (candidate.translatedTitle) {
    const translation = text("p", candidate.translatedTitle);
    translation.lang = "ja";
    container.append(translation);
  } else if (candidate.translationStatus === "loading") {
    container.append(text("p", "翻訳を読み込んでいます…", "translation-pending"));
  } else {
    const message = candidate.translationError === "translation_disabled" || state.translationDisabled
      ? "翻訳APIの設定後に日本語訳を表示します。"
      : "日本語訳を取得できませんでした。";
    container.append(text("p", message, "translation-pending"));
    if (!state.translationDisabled) {
      const retry = text("button", "再試行", "translation-retry");
      retry.type = "button";
      retry.addEventListener("click", () => loadTitleTranslations([candidate]));
      container.append(retry);
    }
  }
  return container;
}

function renderCandidate() {
  const candidate = currentCandidate();
  if (!candidate) {
    const emptyLabel = reviewStatusLabels[elements["review-status"].value];
    const message = state.loading ? "候補を読み込んでいます…" : `このキューの${emptyLabel}候補はありません。`;
    elements.candidate.replaceChildren(text("p", message));
    elements["queue-status"].textContent = state.loading ? "読込中" : "完了";
    updateCandidateControls(null);
    return;
  }

  const fragment = document.createDocumentFragment();
  const candidateState = reviewStatusLabels[candidate.reviewStatus] ?? candidate.reviewStatus;
  fragment.append(text("p", `${candidateState} · ${candidate.screeningHint.replaceAll("_", " ")}`, "candidate-number"));
  fragment.append(text("p", "英語原文", "translation-label"));
  const heading = text("h2", candidate.title);
  heading.lang = candidate.language ?? "en";
  fragment.append(heading);
  fragment.append(titleTranslation(candidate));
  const metadata = [
    candidate.publicationYear,
    candidate.journal,
    candidate.journal ? journalMetricLabel(candidate) : null,
  ].filter(Boolean).join(" · ");
  const metadataText = text("p", metadata || "書誌metadata未収録", "metadata");
  const metricDescription = journalMetricDescription(candidate);
  if (metricDescription) metadataText.title = metricDescription;
  fragment.append(metadataText);
  if (candidate.authors.length) fragment.append(text("p", candidate.authors.join(" · "), "authors"));
  fragment.append(text("p", candidate.candidateKey, "candidate-key"));

  if (candidate.screeningReasons.length) {
    const hints = document.createElement("ul");
    hints.className = "hint-list";
    candidate.screeningReasons.forEach((reason) => hints.append(text("li", reason)));
    fragment.append(hints);
  }

  const links = document.createElement("div");
  links.className = "link-grid";
  if (candidate.doi) links.append(sourceLink("DOI", `https://doi.org/${encodeURIComponent(candidate.doi)}`));
  if (candidate.pmid) links.append(sourceLink("PubMed", `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(candidate.pmid)}/`));
  if (candidate.pmcid) links.append(sourceLink("PMC", `https://pmc.ncbi.nlm.nih.gov/articles/${encodeURIComponent(candidate.pmcid)}/`));
  const sourceUrl = safeUrl(candidate.sourceUrl);
  if (sourceUrl) links.append(sourceLink("原資料", sourceUrl));
  if (links.childElementCount) fragment.append(links);
  const actions = document.createElement("div");
  actions.className = "candidate-actions";
  const bookmarked = isBookmarked(candidate.candidateKey);
  const bookmarkButton = text("button", bookmarked ? "保存済み" : "ブックマーク", "source-link bookmark-button");
  bookmarkButton.type = "button";
  bookmarkButton.setAttribute("aria-pressed", String(bookmarked));
  bookmarkButton.addEventListener("click", () => toggleBookmark(candidate));
  actions.append(bookmarkButton);
  if (candidate.pmid || candidate.pmcid || candidate.doi) {
    const abstractButton = text("button", "要旨対訳", "source-link abstract-button");
    abstractButton.type = "button";
    abstractButton.addEventListener("click", () => openAbstract(candidate));
    actions.append(abstractButton);
  }
  fragment.append(actions);
  elements.candidate.replaceChildren(fragment);

  elements["queue-status"].textContent = `端末に${state.queue.length}件読込済み`;
  updateCandidateControls(candidate);
}

function renderProgress() {
  if (!state.progress) return;
  const completed = state.progress.total - state.progress.pending;
  elements.progress.max = Math.max(state.progress.total, 1);
  elements.progress.value = completed;
  elements["progress-text"].textContent = `${completed} / ${state.progress.total} 完了 · 残り${state.progress.pending}`;
  elements["progress-detail"].textContent = `採用${state.progress.include} · 対象外${state.progress.exclude} · 保留${state.progress.needs_review} · 重複${state.progress.duplicate}`;
}

async function loadProgress() {
  const hint = elements["screening-hint"].value;
  const result = await api(`/api/review/v1/progress?screeningHint=${encodeURIComponent(hint)}`);
  state.progress = result.data;
  renderProgress();
}

async function loadTitleTranslations(candidates) {
  const requested = candidates.filter((candidate) => !candidate.translatedTitle);
  if (!requested.length) return;
  requested.forEach((candidate) => { candidate.translationStatus = "loading"; });
  renderCandidate();
  try {
    const result = await api("/api/review/v1/translations/titles", {
      method: "POST",
      body: JSON.stringify({ candidateKeys: requested.map((candidate) => candidate.candidateKey) }),
    });
    const translations = new Map(result.data.map((item) => [item.candidateKey, item]));
    if (result.data.some((item) => item.errorCode === "translation_disabled")) {
      state.translationDisabled = true;
    }
    requested.forEach((candidate) => {
      const translation = translations.get(candidate.candidateKey);
      candidate.translatedTitle = translation?.translatedText ?? "";
      candidate.translationProvider = translation?.provider;
      candidate.translationError = translation?.errorCode;
      candidate.translationStatus = candidate.translatedTitle ? "ready" : "error";
    });
  } catch (error) {
    if (error.code === "translation_disabled") state.translationDisabled = true;
    requested.forEach((candidate) => { candidate.translationStatus = "error"; });
  }
  renderCandidate();
}

async function loadQueue({ reset = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  if (reset) state.queue = [];
  renderCandidate();
  try {
    const hint = elements["screening-hint"].value;
    const reviewStatus = elements["review-status"].value;
    const result = await api(`/api/review/v1/queue?screeningHint=${encodeURIComponent(hint)}&reviewStatus=${encodeURIComponent(reviewStatus)}&limit=20`);
    const existing = new Set(state.queue.map((candidate) => candidate.candidateKey));
    const added = [];
    result.data.forEach((candidate) => {
      if (!existing.has(candidate.candidateKey)) {
        candidate.translationStatus = "loading";
        state.queue.push(candidate);
        added.push(candidate);
      }
    });
    if (added.length) loadTitleTranslations(added);
  } finally {
    state.loading = false;
    renderCandidate();
  }
}

function bookmarkSourceUrl(candidate) {
  const direct = safeUrl(candidate.sourceUrl);
  if (direct) return direct;
  if (candidate.doi) return `https://doi.org/${encodeURIComponent(candidate.doi)}`;
  if (candidate.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(candidate.pmid)}/`;
  if (candidate.pmcid) return `https://pmc.ncbi.nlm.nih.gov/articles/${encodeURIComponent(candidate.pmcid)}/`;
  return null;
}

async function showBookmarkedCandidate(candidate) {
  const existing = state.queue.find((item) => item.candidateKey === candidate.candidateKey);
  const viewed = existing ?? { ...candidate, translationStatus: "loading" };
  state.queue = [viewed, ...state.queue.filter((item) => item.candidateKey !== candidate.candidateKey)];
  await closeDialog(elements["bookmark-dialog"]);
  renderCandidate();
  if (!viewed.translatedTitle) loadTitleTranslations([viewed]);
  window.scrollTo({ top: 0, behavior: "auto" });
}

function bookmarkJapaneseTitle(candidate) {
  return candidate.titleJa || candidate.translatedTitle || "";
}

function updateBookmarkSelection() {
  const selectedCount = state.selectedBookmarks.size;
  elements["bookmark-summary"].textContent = `全 ${state.bookmarks.size}件 · 選択中 ${selectedCount}件`;
  elements["bookmark-selected-count"].textContent = String(selectedCount);
  elements["bookmark-selected-count"].setAttribute("aria-label", `${selectedCount}件選択`);
  elements["bookmark-generate"].disabled = selectedCount === 0;
}

function bookmarkItem(candidate) {
  const item = document.createElement("article");
  item.className = "bookmark-item";

  const selection = document.createElement("label");
  selection.className = "bookmark-selection";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.selectedBookmarks.has(candidate.candidateKey);
  checkbox.setAttribute("aria-label", `${candidate.title}を口語訳の対象に選択`);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked && state.selectedBookmarks.size >= maxColloquialSelection) {
      checkbox.checked = false;
      showToast(`一度に選択できるのは${maxColloquialSelection}件までです`);
      return;
    }
    if (checkbox.checked) state.selectedBookmarks.add(candidate.candidateKey);
    else state.selectedBookmarks.delete(candidate.candidateKey);
    updateBookmarkSelection();
  });
  const titles = document.createElement("span");
  titles.className = "bookmark-titles";
  const originalTitle = text("strong", candidate.title, "bookmark-title-original");
  originalTitle.lang = candidate.language || "en";
  const japaneseTitle = text(
    "span",
    bookmarkJapaneseTitle(candidate) || "日本語訳を準備中です…",
    `bookmark-title-ja${bookmarkJapaneseTitle(candidate) ? "" : " is-pending"}`,
  );
  japaneseTitle.lang = "ja";
  titles.append(originalTitle, japaneseTitle);
  selection.append(checkbox, titles);
  item.append(selection);

  const metadata = text(
    "span",
    [
      candidate.publicationYear,
      candidate.journal,
      candidate.journal ? journalMetricLabel(candidate) : null,
      reviewStatusLabels[candidate.reviewStatus] || candidate.reviewStatus,
      candidate.candidateKey,
    ].filter(Boolean).join(" · "),
    "bookmark-item-meta",
  );
  const metricDescription = journalMetricDescription(candidate);
  if (metricDescription) metadata.title = metricDescription;
  item.append(metadata);
  const actions = document.createElement("div");
  actions.className = "bookmark-item-actions";
  const sourceUrl = bookmarkSourceUrl(candidate);
  if (sourceUrl) actions.append(sourceLink("原資料を開く", sourceUrl));
  const show = text("button", "レビュー画面", "secondary");
  show.type = "button";
  show.addEventListener("click", () => showBookmarkedCandidate(candidate));
  actions.append(show);
  const remove = text("button", "ブックマーク解除", "bookmark-remove");
  remove.type = "button";
  remove.addEventListener("click", () => toggleBookmark(candidate, false));
  actions.append(remove);
  item.append(actions);
  return item;
}

function renderBookmarks() {
  const available = new Set(state.bookmarks.keys());
  state.selectedBookmarks = new Set([...state.selectedBookmarks].filter((key) => available.has(key)));
  updateBookmarkSelection();
  const candidates = [...state.bookmarks.values()];
  if (!candidates.length) {
    elements["bookmark-results"].replaceChildren(text("p", "このReviewerのブックマークはありません。", "abstract-status"));
    return;
  }
  elements["bookmark-results"].replaceChildren(...candidates.map(bookmarkItem));
}

async function loadBookmarks() {
  const reviewer = reviewerValue();
  if (!reviewer) {
    state.bookmarks.clear();
    state.selectedBookmarks.clear();
    state.bookmarkReviewer = "";
    updateBookmarkCount();
    renderCandidate();
    return;
  }
  const result = await api(`/api/review/v1/bookmarks?reviewer=${encodeURIComponent(reviewer)}`);
  if (reviewerValue() !== reviewer) return;
  state.bookmarks = new Map(result.data.map((candidate) => [candidate.candidateKey, candidate]));
  state.selectedBookmarks = new Set([...state.selectedBookmarks].filter((key) => state.bookmarks.has(key)));
  state.bookmarkReviewer = reviewer;
  updateBookmarkCount();
  renderCandidate();
  if (elements["bookmark-dialog"].open) renderBookmarks();
}

async function ensureBookmarks(reviewer) {
  if (state.bookmarkReviewer !== reviewer) await loadBookmarks();
}

async function toggleBookmark(candidate, bookmarked) {
  const reviewer = reviewerValue();
  if (!reviewer) {
    showToast("先にReviewer identifierを入力してください");
    elements.reviewer.focus();
    return;
  }
  try {
    await ensureBookmarks(reviewer);
    const next = typeof bookmarked === "boolean" ? bookmarked : !isBookmarked(candidate.candidateKey);
    const result = await api("/api/review/v1/bookmarks", {
      method: "POST",
      body: JSON.stringify({ candidateKey: candidate.candidateKey, reviewer, bookmarked: next }),
    });
    if (reviewerValue() !== reviewer) {
      await loadBookmarks();
      return;
    }
    if (next) {
      state.bookmarks.set(candidate.candidateKey, {
        ...candidate,
        titleJa: candidate.titleJa || candidate.translatedTitle || null,
        bookmarkedAt: result.bookmarkedAt,
      });
    } else {
      state.bookmarks.delete(candidate.candidateKey);
      state.selectedBookmarks.delete(candidate.candidateKey);
    }
    state.bookmarkReviewer = reviewer;
    updateBookmarkCount();
    renderCandidate();
    if (elements["bookmark-dialog"].open) renderBookmarks();
    showToast(next ? "ブックマークしました。日本語訳を準備します" : "ブックマークを解除しました");
  } catch (error) {
    showToast(error.message);
  }
}

function selectedColloquialLevel() {
  return colloquialLevels[Number(elements["colloquial-level"].value)] ?? colloquialLevels[1];
}

function updateColloquialLevel() {
  const level = selectedColloquialLevel();
  elements["colloquial-level-value"].value = `${level.label}に分かる文章`;
}

function colloquialCacheKey(candidates) {
  return `${selectedColloquialLevel().value}\u0000${candidates.map((candidate) => candidate.candidateKey).join("\u0000")}`;
}

function resetColloquialResult() {
  state.colloquialResponse = null;
  elements["colloquial-status"].hidden = true;
  elements["colloquial-result"].hidden = true;
}

function renderColloquialSources(candidates) {
  const sources = candidates.map((candidate, index) => {
    const item = document.createElement("article");
    item.className = "colloquial-source";
    item.append(text("span", `${index + 1}`, "colloquial-source-number"));
    const copy = document.createElement("div");
    copy.append(text("span", "原文", "translation-label"));
    const original = text("p", candidate.title, "colloquial-original");
    original.lang = candidate.language || "en";
    copy.append(original, text("span", "DeepL訳", "translation-label"));
    const japanese = text("p", bookmarkJapaneseTitle(candidate) || "日本語訳を準備中です…", "colloquial-deepl");
    japanese.lang = "ja";
    copy.append(japanese);
    item.append(copy);
    return item;
  });
  elements["colloquial-sources"].replaceChildren(...sources);
}

function formatColloquialItem(item) {
  return [
    `【${item.titleJa || item.originalTitle}】`,
    item.colloquialText,
    item.sourceUrl ? `出典: ${item.sourceUrl}` : null,
  ].filter(Boolean).join("\n\n");
}

async function copyText(value, successMessage) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const field = document.createElement("textarea");
      field.value = value;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.append(field);
      field.select();
      if (!document.execCommand("copy")) throw new Error("Copy failed");
      field.remove();
    }
    showToast(successMessage, "include");
  } catch {
    showToast("コピーできませんでした。本文を選択してコピーしてください");
  }
}

function renderColloquialResult(result) {
  state.colloquialResponse = result;
  const cards = result.items.map((item, index) => {
    const card = document.createElement("article");
    card.className = "colloquial-result-item";
    card.append(text("strong", `${index + 1}. ${item.titleJa || item.originalTitle}`));
    const output = document.createElement("textarea");
    output.rows = 9;
    output.readOnly = true;
    output.value = formatColloquialItem(item);
    const copy = text("button", "この口語訳をコピー", "secondary");
    copy.type = "button";
    copy.addEventListener("click", () => copyText(output.value, "口語訳をコピーしました"));
    card.append(output, copy);
    return card;
  });
  elements["colloquial-items"].replaceChildren(...cards);
  elements["colloquial-status"].textContent = `${result.items.length}件の口語訳を作成しました · ${selectedColloquialLevel().label}`;
  elements["colloquial-status"].hidden = false;
  elements["colloquial-result"].hidden = false;
}

async function openColloquialTranslations() {
  await loadBookmarks();
  const candidates = [...state.selectedBookmarks]
    .map((key) => state.bookmarks.get(key))
    .filter(Boolean);
  if (!candidates.length) {
    showToast("口語訳にする論文を選択してください");
    return;
  }
  state.colloquialCandidates = candidates;
  await closeDialog(elements["bookmark-dialog"]);
  renderColloquialSources(candidates);
  resetColloquialResult();
  updateColloquialLevel();
  openDialog(elements["colloquial-dialog"]);
  const cached = state.colloquialResponses.get(colloquialCacheKey(candidates));
  if (cached) renderColloquialResult(cached);
}

async function generateColloquialTranslations() {
  const candidates = state.colloquialCandidates;
  if (!candidates.length) return;
  const reviewer = reviewerValue();
  if (!reviewer) {
    elements["colloquial-status"].textContent = "Reviewer identifierを入力してください。";
    elements["colloquial-status"].hidden = false;
    return;
  }
  const cacheKey = colloquialCacheKey(candidates);
  const cached = state.colloquialResponses.get(cacheKey);
  if (cached) {
    renderColloquialResult(cached);
    return;
  }
  elements["colloquial-result"].hidden = true;
  elements["colloquial-status"].textContent = `選択した${candidates.length}件の口語訳を作成しています…`;
  elements["colloquial-status"].hidden = false;
  elements["colloquial-generate"].disabled = true;
  const originalLabel = elements["colloquial-generate"].textContent;
  elements["colloquial-generate"].textContent = "作成中…";
  try {
    const result = await api("/api/review/v1/colloquial-translations", {
      method: "POST",
      body: JSON.stringify({
        candidateKeys: candidates.map((candidate) => candidate.candidateKey),
        reviewer,
        level: selectedColloquialLevel().value,
      }),
    });
    state.colloquialResponses.set(cacheKey, result.data);
    renderColloquialResult(result.data);
  } catch (error) {
    elements["colloquial-status"].textContent = colloquialErrorMessages[error.code]
      ?? "口語訳を作成できませんでした。時間をおいて再試行してください。";
    elements["colloquial-status"].hidden = false;
  } finally {
    elements["colloquial-generate"].disabled = false;
    elements["colloquial-generate"].textContent = originalLabel;
  }
}

function renderAbstract(abstract) {
  const fragment = document.createDocumentFragment();
  const meta = document.createElement("dl");
  meta.className = "abstract-meta";
  meta.append(text("dt", "抄録取得元"));
  const source = text("dd", abstract.source || "未収録");
  const sourceUrl = safeUrl(abstract.sourceUrl);
  if (sourceUrl) {
    const link = sourceLink("開く", sourceUrl);
    link.className = "abstract-meta-link";
    source.append(" ", link);
  }
  meta.append(source);
  meta.append(text("dt", "掲載誌"), text("dd", abstract.journal || "未収録"));
  meta.append(text("dt", "引用指標"));
  const metric = text("dd", journalMetricLabel(abstract, "未収録").replace(/^引用指標\s*/u, ""));
  const metricDescription = journalMetricDescription(abstract);
  if (metricDescription) metric.title = metricDescription;
  const metricUrl = safeUrl(abstract.journalMetric?.sourceUrl);
  if (metricUrl) {
    const link = sourceLink("出典", metricUrl);
    link.className = "abstract-meta-link";
    metric.append(" ", link);
  }
  meta.append(metric);
  fragment.append(meta);
  abstract.sentences.forEach((sentence, index) => {
    const pair = document.createElement("section");
    pair.className = "abstract-pair";
    const source = document.createElement("div");
    source.className = "abstract-side";
    source.append(text("span", `原文 ${index + 1}`, "translation-label"));
    const sourceText = text("p", sentence.source);
    sourceText.lang = "en";
    source.append(sourceText);
    const japanese = document.createElement("div");
    japanese.className = "abstract-side abstract-ja";
    japanese.append(text("span", `日本語参考訳 ${index + 1}`, "translation-label"));
    const translatedText = text("p", sentence.translation);
    translatedText.lang = "ja";
    japanese.append(translatedText);
    pair.append(source, japanese);
    fragment.append(pair);
  });
  fragment.append(text("p", "要旨はこの画面で一時表示するだけで、D1には保存しません。原資料の著作権・ライセンスを確認してください。", "abstract-notice"));
  elements["abstract-content"].replaceChildren(fragment);
}

async function openAbstract(candidate) {
  openDialog(elements["abstract-dialog"]);
  const cached = state.abstracts.get(candidate.candidateKey);
  if (cached) {
    renderAbstract(cached);
    return;
  }
  elements["abstract-content"].replaceChildren(text("p", "要旨を取得して翻訳しています…", "abstract-status"));
  try {
    const result = await api("/api/review/v1/translations/abstract", {
      method: "POST",
      body: JSON.stringify({ candidateKey: candidate.candidateKey }),
    });
    state.abstracts.set(candidate.candidateKey, result.data);
    renderAbstract(result.data);
  } catch (error) {
    if (error.code === "translation_disabled") state.translationDisabled = true;
    const message = abstractErrorMessages[error.code]
      ?? "要旨対訳を取得できませんでした。時間をおいて再試行してください。";
    elements["abstract-content"].replaceChildren(text("p", message, "abstract-status"));
  }
}

async function loadReview() {
  showApp();
  await Promise.all([loadProgress(), loadQueue({ reset: true }), loadBookmarks(), loadReviewers()]);
}

function adjustProgress(previousStatus, decision) {
  if (!state.progress) return;
  if (previousStatus in state.progress) state.progress[previousStatus] -= 1;
  state.progress[decision] += 1;
  renderProgress();
}

async function saveDecision(decision, reason, duplicateOf) {
  const reviewer = elements.reviewer.value.trim();
  if (!reviewer) {
    showToast("先にReviewer identifierを入力してください");
    elements.reviewer.focus();
    return;
  }
  const candidate = currentCandidate();
  if (!candidate) return;
  state.transitioning = true;
  updateCandidateControls(candidate);
  try {
    const result = await api("/api/review/v1/decisions", {
      method: "POST",
      body: JSON.stringify({ candidateKey: candidate.candidateKey, decision, reason, reviewer, duplicateOf }),
    });
    state.lastSaved = { candidate: { ...candidate, reviewStatus: decision }, decision };
    elements["revise-last"].hidden = false;
    adjustProgress(result.previousStatus, decision);
    rememberReviewer(reviewer, result.reviewedAt);
    const feedback = decisionToastFeedback[decision];
    showToast(feedback?.message ?? "判定を保存しました", feedback?.tone);
    await animateCandidate("out", decision);
    state.queue.shift();
    if (state.queue.length) renderCandidate();
    else await loadQueue();
    window.scrollTo({ top: 0, behavior: "auto" });
    if (currentCandidate()) await animateCandidate("in", decision);
    state.transitioning = false;
    updateCandidateControls(currentCandidate());
    if (state.queue.length <= 5) await loadQueue();
  } catch (error) {
    elements.candidate.classList.remove("is-sorting-in", "is-sorting-out");
    delete elements.candidate.dataset.sortDecision;
    state.transitioning = false;
    showToast(error.message);
    updateCandidateControls(currentCandidate());
  }
}

function duplicateOption(candidate) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "duplicate-option";
  button.setAttribute("aria-pressed", String(state.duplicateTarget?.candidateKey === candidate.candidateKey));
  button.append(text("strong", candidate.title));
  button.append(text("span", [candidate.publicationYear, candidate.journal, candidate.candidateKey].filter(Boolean).join(" · ")));
  button.addEventListener("click", () => {
    state.duplicateTarget = candidate;
    renderDuplicateResults([candidate]);
  });
  return button;
}

function renderDuplicateResults(candidates) {
  if (!candidates.length) {
    elements["duplicate-results"].replaceChildren(text("p", "同一タイトル候補はありません。識別子が分かる場合だけ検索してください。", "empty-duplicates"));
  } else {
    elements["duplicate-results"].replaceChildren(...candidates.map(duplicateOption));
  }
  elements["confirm-duplicate"].disabled = !state.duplicateTarget;
}

async function loadDuplicates(query = "") {
  const candidate = currentCandidate();
  if (!candidate) return;
  state.duplicateTarget = null;
  elements["duplicate-results"].replaceChildren(text("p", "検索中…", "empty-duplicates"));
  elements["confirm-duplicate"].disabled = true;
  const queryPart = query ? `&q=${encodeURIComponent(query)}` : "";
  try {
    const result = await api(`/api/review/v1/duplicates?candidateKey=${encodeURIComponent(candidate.candidateKey)}${queryPart}`);
    renderDuplicateResults(result.data);
  } catch (error) {
    renderDuplicateResults([]);
    showToast(error.message);
  }
}

elements["login-form"].addEventListener("submit", async (event) => {
  event.preventDefault();
  elements["login-error"].hidden = true;
  try {
    await api("/api/review/v1/session", {
      method: "POST",
      body: JSON.stringify({ token: elements["admin-token"].value }),
    });
    elements["admin-token"].value = "";
    await loadReview();
  } catch (error) {
    showLogin(error.message);
  }
});

elements["options-button"].addEventListener("click", () => openDialog(elements["options-dialog"]));
elements["close-options"].addEventListener("click", () => closeDialog(elements["options-dialog"]));
elements.logout.addEventListener("click", async () => {
  await api("/api/review/v1/session", { method: "DELETE" }).catch(() => {});
  showLogin();
});
elements["export-csv"].addEventListener("click", () => {
  const hint = encodeURIComponent(elements["screening-hint"].value);
  location.assign(`/api/review/v1/export?screeningHint=${hint}`);
});
elements["close-abstract"].addEventListener("click", () => closeDialog(elements["abstract-dialog"]));
elements["close-bookmarks"].addEventListener("click", () => closeDialog(elements["bookmark-dialog"]));
elements["close-colloquial"].addEventListener("click", () => closeDialog(elements["colloquial-dialog"]));
elements["close-reason"].addEventListener("click", () => closeDialog(elements["reason-dialog"]));
elements["show-bookmarks"].addEventListener("click", async () => {
  if (!reviewerValue()) {
    showToast("先にReviewer identifierを入力してください");
    elements.reviewer.focus();
    return;
  }
  await closeDialog(elements["options-dialog"]);
  openDialog(elements["bookmark-dialog"]);
  elements["bookmark-results"].replaceChildren(text("p", "ブックマークを読み込んでいます…", "abstract-status"));
  try {
    await loadBookmarks();
    renderBookmarks();
  } catch (error) {
    elements["bookmark-results"].replaceChildren(text("p", error.message, "abstract-status"));
  }
});
elements["bookmark-export"].addEventListener("click", () => {
  const reviewer = reviewerValue();
  if (!reviewer) return;
  location.assign(`/api/review/v1/bookmarks/export?reviewer=${encodeURIComponent(reviewer)}`);
});
elements["bookmark-generate"].addEventListener("click", openColloquialTranslations);
elements["colloquial-form"].addEventListener("submit", (event) => {
  event.preventDefault();
  localStorage.setItem("candidate-review-colloquial-level", elements["colloquial-level"].value);
  generateColloquialTranslations();
});
elements["colloquial-level"].addEventListener("input", () => {
  updateColloquialLevel();
  resetColloquialResult();
});
elements["colloquial-copy-all"].addEventListener("click", () => {
  if (!state.colloquialResponse) return;
  const value = state.colloquialResponse.items.map(formatColloquialItem).join("\n\n---\n\n");
  copyText(value, `${state.colloquialResponse.items.length}件の口語訳をコピーしました`);
});

elements.reviewer.value = localStorage.getItem("candidate-reviewer") ?? "";
const savedColloquialLevelValue = localStorage.getItem("candidate-review-colloquial-level");
const savedColloquialLevel = savedColloquialLevelValue == null ? null : Number(savedColloquialLevelValue);
if (Number.isInteger(savedColloquialLevel) && savedColloquialLevel >= 0 && savedColloquialLevel <= 2) {
  elements["colloquial-level"].value = String(savedColloquialLevel);
}
updateColloquialLevel();
const savedHint = localStorage.getItem("candidate-review-hint");
if ([...elements["screening-hint"].options].some((option) => option.value === savedHint)) {
  elements["screening-hint"].value = savedHint;
}
const savedReviewStatus = localStorage.getItem("candidate-review-status");
if ([...elements["review-status"].options].some((option) => option.value === savedReviewStatus)) {
  elements["review-status"].value = savedReviewStatus;
}
elements.reviewer.addEventListener("input", () => {
  localStorage.setItem("candidate-reviewer", reviewerValue());
  elements["reviewer-history"].value = state.reviewers.some((entry) => entry.reviewer === reviewerValue())
    ? reviewerValue()
    : "";
  updateBookmarkCount();
  renderCandidate();
});
elements.reviewer.addEventListener("change", () => loadBookmarks().catch((error) => showToast(error.message)));
elements["reviewer-history"].addEventListener("change", () => {
  if (!elements["reviewer-history"].value) return;
  elements.reviewer.value = elements["reviewer-history"].value;
  elements.reviewer.dispatchEvent(new Event("input", { bubbles: true }));
  loadBookmarks().catch((error) => showToast(error.message));
});
elements["screening-hint"].addEventListener("change", () => {
  localStorage.setItem("candidate-review-hint", elements["screening-hint"].value);
  state.lastSaved = null;
  elements["revise-last"].hidden = true;
  Promise.all([loadProgress(), loadQueue({ reset: true })]).catch((error) => showToast(error.message));
});
elements["review-status"].addEventListener("change", () => {
  localStorage.setItem("candidate-review-status", elements["review-status"].value);
  state.lastSaved = null;
  elements["revise-last"].hidden = true;
  loadQueue({ reset: true }).catch((error) => showToast(error.message));
});
elements.skip.addEventListener("click", () => {
  state.queue.push(state.queue.shift());
  renderCandidate();
  window.scrollTo({ top: 0, behavior: "auto" });
});
elements["revise-last"].addEventListener("click", () => {
  if (!state.lastSaved) return;
  state.queue.unshift(state.lastSaved.candidate);
  state.lastSaved = null;
  elements["revise-last"].hidden = true;
  renderCandidate();
  showToast("直前の候補を再表示しました");
});
elements.include.addEventListener("click", () => saveDecision("include", "分子状水素H₂の生物医学研究で、タイトルと書誌情報を原資料で確認。"));
elements["needs-review"].addEventListener("click", () => saveDecision("needs_review", "metadataだけでは対象判定に必要な情報が不足。"));
elements.exclude.addEventListener("click", () => openDialog(elements["exclude-dialog"]));
elements.duplicate.addEventListener("click", () => {
  elements["duplicate-query"].value = "";
  openDialog(elements["duplicate-dialog"]);
  loadDuplicates();
});

document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog(dialog);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    const insideDialog = event.clientX >= bounds.left && event.clientX <= bounds.right
      && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    if (!insideDialog) closeDialog(dialog);
  });
});

elements["exclude-form"].addEventListener("submit", (event) => {
  event.preventDefault();
  closeDialog(elements["exclude-dialog"], event.submitter?.value ?? "cancel");
});

elements["exclude-dialog"].addEventListener("close", () => {
  const selected = elements["exclude-dialog"].returnValue;
  if (excludeReasons[selected]) saveDecision("exclude", excludeReasons[selected]);
  else if (selected === "other") {
    elements["reason-text"].value = "";
    openDialog(elements["reason-dialog"]);
  }
});

elements["reason-form"].addEventListener("submit", async (event) => {
  event.preventDefault();
  const reason = elements["reason-text"].value.trim();
  if (!reason) return;
  await closeDialog(elements["reason-dialog"], "save");
  saveDecision("exclude", reason);
});

elements["search-duplicate"].addEventListener("click", () => {
  const query = elements["duplicate-query"].value.trim();
  if (query) loadDuplicates(query);
});
elements["duplicate-query"].addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    elements["search-duplicate"].click();
  }
});
elements["duplicate-form"].addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value !== "confirm") {
    closeDialog(elements["duplicate-dialog"]);
    return;
  }
  if (!state.duplicateTarget) return;
  const target = state.duplicateTarget;
  await closeDialog(elements["duplicate-dialog"], "confirm");
  saveDecision("duplicate", "タイトルと書誌識別子を比較して同一報告と確認。", target.candidateKey);
});

document.addEventListener("keydown", (event) => {
  if (event.target.matches("input, textarea, select") || document.querySelector("dialog[open]")) return;
  if (event.key.toLocaleLowerCase("en-US") === "i") elements.include.click();
  else if (event.key.toLocaleLowerCase("en-US") === "e") elements.exclude.click();
  else if (event.key.toLocaleLowerCase("en-US") === "n") elements["needs-review"].click();
  else if (event.key.toLocaleLowerCase("en-US") === "d") elements.duplicate.click();
});

api("/api/review/v1/session")
  .then(loadReview)
  .catch((error) => {
    if (error.status === 401) showLogin();
    else showLogin(error.message);
  });
