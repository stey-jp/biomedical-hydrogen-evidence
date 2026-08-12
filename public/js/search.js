const form = document.querySelector("#search-form");
const resultsElement = document.querySelector("#results");
const statusElement = document.querySelector("#result-status");
const loadMoreButton = document.querySelector("#load-more");
let nextCursor = null;

const LABELS = {
  human: "Human",
  animal: "Animal",
  in_vitro: "In-vitro",
  review: "Review",
  other: "Other",
  inhalation: "水素吸入",
  hydrogen_rich_water: "水素水",
  randomized_controlled_trial: "RCT",
  human_verified: "人が確認済み",
  machine_checked: "モデル間一致を確認",
  needs_human_review: "人による確認が必要",
  machine_extracted: "機械抽出",
  unverified: "未確認",
  disputed: "見解相違あり",
};

function label(value) {
  return LABELS[value] ?? String(value ?? "—").replaceAll("_", " ");
}

function element(tag, { className, text } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderCard(study) {
  const article = element("article", { className: "result-card" });
  const badges = element("div", { className: "badge-row" });
  [study.publicationYear, label(study.speciesType), label(study.studyDesign), label(study.verificationStatus)]
    .forEach((value) => badges.append(element("span", { className: "badge", text: value })));
  article.append(badges);

  const heading = element("h3");
  const link = element("a", { text: study.title });
  link.href = `/study?id=${encodeURIComponent(study.publicId)}`;
  heading.append(link);
  article.append(heading);

  const population = study.participantCount === null
    ? "参加者数：該当なし／未収録"
    : `参加者数：${study.participantCount}`;
  const routes = study.administrationRoutes.length
    ? `投与経路：${study.administrationRoutes.map(label).join("、")}`
    : "投与経路：未収録";
  const authors = study.authors?.length ? `著者：${study.authors.join("、")}` : "著者：未収録";
  article.append(element("p", { className: "result-meta", text: authors }));
  article.append(element("p", { className: "result-meta", text: `${population} · ${routes}` }));
  if (study.recordKind === "fixture") {
    article.append(element("p", { className: "fixture-notice", text: study.fixtureNotice }));
  }
  return article;
}

function currentParams(cursor) {
  const data = new FormData(form);
  const params = new URLSearchParams();
  for (const [key, value] of data) {
    if (value) params.set(key, value);
  }
  if (document.querySelector("#verified-only").checked) params.set("humanVerifiedOnly", "true");
  params.set("limit", "10");
  if (cursor) params.set("cursor", cursor);
  return params;
}

async function search({ append = false } = {}) {
  statusElement.textContent = "検索中…";
  loadMoreButton.hidden = true;
  try {
    const response = await fetch(`/api/v1/search?${currentParams(append ? nextCursor : null)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message ?? "検索に失敗しました。");
    if (!append) resultsElement.replaceChildren();
    payload.data.forEach((study) => resultsElement.append(renderCard(study)));
    nextCursor = payload.pagination.nextCursor;
    loadMoreButton.hidden = !nextCursor;
    const count = resultsElement.childElementCount;
    statusElement.textContent = count ? `${count}件を表示` : "該当する研究はありません";
  } catch (error) {
    if (!append) resultsElement.replaceChildren();
    resultsElement.append(element("p", { className: "error-message", text: error.message }));
    statusElement.textContent = "エラー";
  }
}

function fillSelect(id, items, labelForItem = label) {
  const select = document.querySelector(id);
  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = typeof item === "string" ? item : item.value;
    option.textContent = labelForItem(item);
    select.append(option);
  });
}

async function loadFilters() {
  try {
    const response = await fetch("/api/v1/meta/filters");
    const payload = await response.json();
    if (!response.ok) return;
    const filters = payload.data;
    fillSelect("#species-type", filters.speciesTypes);
    fillSelect("#study-design", filters.studyDesigns);
    fillSelect("#administration-route", filters.administrationRoutes);
    fillSelect("#condition", filters.conditions, (item) => item.label ?? label(item.value));
    fillSelect("#author", filters.authors, (item) => `${item.label}（${item.studyCount}件）`);
    document.querySelector("#year-from").placeholder = filters.publicationYear.min ?? "";
    document.querySelector("#year-to").placeholder = filters.publicationYear.max ?? "";
  } catch {
    // Filters are an enhancement; keyword search remains usable if metadata fails.
  }
}

function restoreFiltersFromUrl() {
  const params = new URL(location.href).searchParams;
  for (const element of form.elements) {
    if (!element.name || !params.has(element.name)) continue;
    if (element.type === "checkbox") {
      element.checked = ["true", "1"].includes(params.get(element.name));
    } else {
      element.value = params.get(element.name);
    }
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  nextCursor = null;
  search();
});

document.querySelectorAll(".example").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector("#query").value = button.dataset.query;
    nextCursor = null;
    search();
  });
});

loadMoreButton.addEventListener("click", () => search({ append: true }));

await loadFilters();
restoreFiltersFromUrl();
await search();
