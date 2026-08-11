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
};

const elements = Object.fromEntries([
  "save-status", "login-panel", "login-form", "admin-token", "login-error",
  "review-app", "screening-hint", "reviewer", "logout", "export-csv", "show-bookmarks", "progress-text",
  "progress-detail", "progress", "candidate", "skip", "queue-status",
  "revise-last", "include", "exclude", "needs-review", "duplicate",
  "exclude-dialog", "duplicate-dialog", "duplicate-form", "duplicate-results",
  "duplicate-query", "search-duplicate", "confirm-duplicate", "reason-dialog",
  "reason-form", "reason-text", "toast",
  "abstract-dialog", "abstract-content", "close-abstract",
  "bookmark-dialog", "bookmark-results", "bookmark-summary", "bookmark-export", "close-bookmarks",
].map((id) => [id, document.querySelector(`#${id}`)]));

const excludeReasons = {
  not_h2: "分子状水素H₂を扱っていない。",
  non_biomedical: "植物・農業・食品保存など、生物医学研究の対象外。",
  industrial: "産業用水素・燃料電池・水素製造等で対象外。",
  not_report: "研究結果を報告する文献ではない。",
};

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

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.setTimeout(() => { elements.toast.hidden = true; }, 2600);
}

function showLogin(message = "") {
  elements["review-app"].hidden = true;
  elements["login-panel"].hidden = false;
  elements["login-error"].textContent = message;
  elements["login-error"].hidden = !message;
  elements["save-status"].textContent = "ログイン待ち";
}

function showApp() {
  elements["login-panel"].hidden = true;
  elements["review-app"].hidden = false;
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

function reviewerValue() {
  return elements.reviewer.value.trim();
}

function isBookmarked(candidateKey) {
  return state.bookmarkReviewer === reviewerValue() && state.bookmarks.has(candidateKey);
}

function updateBookmarkCount() {
  const count = state.bookmarkReviewer === reviewerValue() ? state.bookmarks.size : 0;
  elements["show-bookmarks"].textContent = `保存論文 ${count}`;
}

function disableDecisions(disabled) {
  document.querySelectorAll(".decision").forEach((button) => { button.disabled = disabled; });
}

function titleTranslation(candidate) {
  const container = document.createElement("section");
  container.className = "title-translation";
  const provider = candidate.translationProvider === "source" ? "原文" : "DeepL";
  container.append(text("span", `日本語参考訳 · ${provider}`, "translation-label"));
  if (candidate.translatedTitle) {
    const translation = text("p", candidate.translatedTitle);
    translation.lang = "ja";
    container.append(translation);
  } else if (candidate.translationStatus === "loading") {
    container.append(text("p", "翻訳を読み込んでいます…", "translation-pending"));
  } else {
    const message = candidate.translationError === "translation_disabled" || state.translationDisabled
      ? "DeepL APIキーの設定後に日本語訳を表示します。"
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
    const message = state.loading ? "候補を読み込んでいます…" : "このキューの未判定候補はありません。";
    elements.candidate.replaceChildren(text("p", message));
    elements["queue-status"].textContent = state.loading ? "読込中" : "完了";
    elements.skip.disabled = true;
    disableDecisions(true);
    return;
  }

  const fragment = document.createDocumentFragment();
  fragment.append(text("p", candidate.screeningHint.replaceAll("_", " "), "candidate-number"));
  fragment.append(text("p", "英語原文", "translation-label"));
  const heading = text("h2", candidate.title);
  heading.lang = candidate.language ?? "en";
  fragment.append(heading);
  fragment.append(titleTranslation(candidate));
  const metadata = [candidate.publicationYear, candidate.journal].filter(Boolean).join(" · ");
  fragment.append(text("p", metadata || "書誌metadata未収録", "metadata"));
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
  if (candidate.pmid || candidate.pmcid || candidate.doi) {
    const abstractButton = text("button", "要旨対訳", "source-link abstract-button");
    abstractButton.type = "button";
    abstractButton.addEventListener("click", () => openAbstract(candidate));
    links.append(abstractButton);
  }
  const bookmarkButton = text("button", isBookmarked(candidate.candidateKey) ? "★ 保存済み" : "☆ ブックマーク", "source-link bookmark-button");
  bookmarkButton.type = "button";
  bookmarkButton.setAttribute("aria-pressed", String(isBookmarked(candidate.candidateKey)));
  bookmarkButton.addEventListener("click", () => toggleBookmark(candidate));
  links.append(bookmarkButton);
  fragment.append(links);
  fragment.append(text("p", "判断するのは収録scopeです。研究結果がpositiveかnegativeかでは決めません。", "review-note"));
  elements.candidate.replaceChildren(fragment);

  elements["queue-status"].textContent = `端末に${state.queue.length}件読込済み`;
  elements.skip.disabled = state.queue.length < 2;
  disableDecisions(false);
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
    const result = await api(`/api/review/v1/queue?screeningHint=${encodeURIComponent(hint)}&limit=20`);
    const existing = new Set(state.queue.map((candidate) => candidate.candidateKey));
    const added = [];
    result.data.forEach((candidate) => {
      if (!existing.has(candidate.candidateKey)) {
        candidate.translationStatus = "loading";
        state.queue.push(candidate);
        added.push(candidate);
      }
    });
    elements["save-status"].textContent = "保存済み";
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

function showBookmarkedCandidate(candidate) {
  const existing = state.queue.find((item) => item.candidateKey === candidate.candidateKey);
  const viewed = existing ?? { ...candidate, translationStatus: "loading" };
  state.queue = [viewed, ...state.queue.filter((item) => item.candidateKey !== candidate.candidateKey)];
  elements["bookmark-dialog"].close();
  renderCandidate();
  if (!viewed.translatedTitle) loadTitleTranslations([viewed]);
  window.scrollTo({ top: 0, behavior: "auto" });
}

function bookmarkItem(candidate) {
  const item = document.createElement("article");
  item.className = "bookmark-item";
  item.append(text("strong", candidate.title));
  item.append(text(
    "span",
    [candidate.publicationYear, candidate.journal, candidate.reviewStatus, candidate.candidateKey].filter(Boolean).join(" · "),
    "bookmark-item-meta",
  ));
  const actions = document.createElement("div");
  actions.className = "bookmark-item-actions";
  const sourceUrl = bookmarkSourceUrl(candidate);
  if (sourceUrl) actions.append(sourceLink("原資料を開く", sourceUrl));
  const show = text("button", "レビュー画面で表示", "secondary");
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
  const reviewer = reviewerValue();
  elements["bookmark-summary"].textContent = `${reviewer} · ${state.bookmarks.size}件`;
  const candidates = [...state.bookmarks.values()];
  if (!candidates.length) {
    elements["bookmark-results"].replaceChildren(text("p", "このreviewerの保存論文はありません。", "abstract-status"));
    return;
  }
  elements["bookmark-results"].replaceChildren(...candidates.map(bookmarkItem));
}

async function loadBookmarks() {
  const reviewer = reviewerValue();
  if (!reviewer) {
    state.bookmarks.clear();
    state.bookmarkReviewer = "";
    updateBookmarkCount();
    renderCandidate();
    return;
  }
  const result = await api(`/api/review/v1/bookmarks?reviewer=${encodeURIComponent(reviewer)}`);
  if (reviewerValue() !== reviewer) return;
  state.bookmarks = new Map(result.data.map((candidate) => [candidate.candidateKey, candidate]));
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
    elements["save-status"].textContent = "保存中…";
    const result = await api("/api/review/v1/bookmarks", {
      method: "POST",
      body: JSON.stringify({ candidateKey: candidate.candidateKey, reviewer, bookmarked: next }),
    });
    if (reviewerValue() !== reviewer) {
      await loadBookmarks();
      return;
    }
    if (next) state.bookmarks.set(candidate.candidateKey, { ...candidate, bookmarkedAt: result.bookmarkedAt });
    else state.bookmarks.delete(candidate.candidateKey);
    state.bookmarkReviewer = reviewer;
    elements["save-status"].textContent = "保存済み";
    updateBookmarkCount();
    renderCandidate();
    if (elements["bookmark-dialog"].open) renderBookmarks();
    showToast(next ? "論文をブックマークしました" : "ブックマークを解除しました");
  } catch (error) {
    elements["save-status"].textContent = "保存失敗";
    showToast(error.message);
  }
}

function renderAbstract(abstract) {
  const fragment = document.createDocumentFragment();
  const meta = document.createElement("div");
  meta.className = "abstract-meta";
  meta.append(text("span", `${abstract.source} · ${abstract.provider}`));
  const sourceUrl = safeUrl(abstract.sourceUrl);
  if (sourceUrl) meta.append(sourceLink("原資料を開く", sourceUrl));
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
  elements["abstract-dialog"].showModal();
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
    const message = error.code === "translation_disabled"
      ? "DeepL APIキーの設定後に要旨対訳を表示します。"
      : error.code === "abstract_unavailable"
        ? "Europe PMCから利用可能な要旨を取得できませんでした。原資料を確認してください。"
        : "要旨対訳を取得できませんでした。時間をおいて再試行してください。";
    elements["abstract-content"].replaceChildren(text("p", message, "abstract-status"));
  }
}

async function loadReview() {
  showApp();
  elements["save-status"].textContent = "読込中…";
  await Promise.all([loadProgress(), loadQueue({ reset: true }), loadBookmarks()]);
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
  elements["save-status"].textContent = "保存中…";
  disableDecisions(true);
  try {
    const result = await api("/api/review/v1/decisions", {
      method: "POST",
      body: JSON.stringify({ candidateKey: candidate.candidateKey, decision, reason, reviewer, duplicateOf }),
    });
    state.lastSaved = { candidate: { ...candidate, reviewStatus: decision }, decision };
    state.queue.shift();
    elements["revise-last"].hidden = false;
    adjustProgress(result.previousStatus, decision);
    elements["save-status"].textContent = "保存済み";
    showToast("判定を保存しました");
    renderCandidate();
    window.scrollTo({ top: 0, behavior: "auto" });
    if (state.queue.length <= 5) await loadQueue();
  } catch (error) {
    elements["save-status"].textContent = "保存失敗";
    showToast(error.message);
    disableDecisions(false);
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
  elements["save-status"].textContent = "認証中…";
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

elements.logout.addEventListener("click", async () => {
  await api("/api/review/v1/session", { method: "DELETE" }).catch(() => {});
  showLogin();
});
elements["export-csv"].addEventListener("click", () => {
  const hint = encodeURIComponent(elements["screening-hint"].value);
  location.assign(`/api/review/v1/export?screeningHint=${hint}`);
});
elements["close-abstract"].addEventListener("click", () => elements["abstract-dialog"].close());
elements["close-bookmarks"].addEventListener("click", () => elements["bookmark-dialog"].close());
elements["show-bookmarks"].addEventListener("click", async () => {
  if (!reviewerValue()) {
    showToast("先にReviewer identifierを入力してください");
    elements.reviewer.focus();
    return;
  }
  elements["bookmark-dialog"].showModal();
  elements["bookmark-results"].replaceChildren(text("p", "保存論文を読み込んでいます…", "abstract-status"));
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

elements.reviewer.value = localStorage.getItem("candidate-reviewer") ?? "";
const savedHint = localStorage.getItem("candidate-review-hint");
if ([...elements["screening-hint"].options].some((option) => option.value === savedHint)) {
  elements["screening-hint"].value = savedHint;
}
elements.reviewer.addEventListener("input", () => {
  localStorage.setItem("candidate-reviewer", reviewerValue());
  updateBookmarkCount();
  renderCandidate();
});
elements.reviewer.addEventListener("change", () => loadBookmarks().catch((error) => showToast(error.message)));
elements["screening-hint"].addEventListener("change", () => {
  localStorage.setItem("candidate-review-hint", elements["screening-hint"].value);
  state.lastSaved = null;
  elements["revise-last"].hidden = true;
  Promise.all([loadProgress(), loadQueue({ reset: true })]).catch((error) => showToast(error.message));
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
elements.exclude.addEventListener("click", () => elements["exclude-dialog"].showModal());
elements.duplicate.addEventListener("click", () => {
  elements["duplicate-query"].value = "";
  elements["duplicate-dialog"].showModal();
  loadDuplicates();
});

elements["exclude-dialog"].addEventListener("close", () => {
  const selected = elements["exclude-dialog"].returnValue;
  if (excludeReasons[selected]) saveDecision("exclude", excludeReasons[selected]);
  else if (selected === "other") {
    elements["reason-text"].value = "";
    elements["reason-dialog"].showModal();
  }
});

elements["reason-form"].addEventListener("submit", (event) => {
  event.preventDefault();
  const reason = elements["reason-text"].value.trim();
  if (!reason) return;
  elements["reason-dialog"].close();
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
elements["duplicate-form"].addEventListener("submit", (event) => {
  if (event.submitter?.value !== "confirm") return;
  event.preventDefault();
  if (!state.duplicateTarget) return;
  const target = state.duplicateTarget;
  elements["duplicate-dialog"].close();
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
