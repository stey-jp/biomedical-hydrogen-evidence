const form = document.querySelector("#author-search-form");
const queryInput = document.querySelector("#author-query");
const resultsElement = document.querySelector("#authors");
const statusElement = document.querySelector("#author-status");

function element(tag, { className, text } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderAuthor(author) {
  const article = element("article", { className: "result-card" });
  const badges = element("div", { className: "badge-row" });
  badges.append(element("span", { className: "badge", text: `収録研究 ${author.studyCount}件` }));
  if (author.orcid) badges.append(element("span", { className: "badge", text: `ORCID ${author.orcid}` }));

  const heading = element("h3");
  const link = element("a", { text: author.name });
  link.href = `/author?id=${encodeURIComponent(author.publicId)}`;
  heading.append(link);
  article.append(badges, heading);
  if (author.nativeName && author.nativeName !== author.name) {
    article.append(element("p", { className: "result-meta", text: author.nativeName }));
  }
  article.append(element("p", {
    className: "result-meta",
    text: author.primaryAffiliation ? `所属：${author.primaryAffiliation}` : "所属：未収録",
  }));
  return article;
}

async function loadAuthors() {
  statusElement.textContent = "検索中…";
  const params = new URLSearchParams({ limit: "100" });
  if (queryInput.value.trim()) params.set("query", queryInput.value.trim());
  try {
    const response = await fetch(`/api/v1/authors?${params}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message ?? "著者を取得できませんでした。");
    resultsElement.replaceChildren();
    payload.data.forEach((author) => resultsElement.append(renderAuthor(author)));
    if (!payload.data.length) {
      resultsElement.append(element("p", { className: "empty-state", text: "該当する著者はいません。" }));
    }
    statusElement.textContent = `${payload.data.length}件を表示`;
  } catch (error) {
    resultsElement.replaceChildren(element("p", { className: "error-message", text: error.message }));
    statusElement.textContent = "エラー";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const url = new URL(location.href);
  if (queryInput.value.trim()) url.searchParams.set("query", queryInput.value.trim());
  else url.searchParams.delete("query");
  history.replaceState(null, "", url);
  loadAuthors();
});

queryInput.value = new URL(location.href).searchParams.get("query") ?? "";
await loadAuthors();
