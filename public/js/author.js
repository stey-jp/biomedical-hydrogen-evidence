const container = document.querySelector("#author-profile");
const statusElement = document.querySelector("#author-status");

const LABELS = {
  email: "メール",
  institutional_profile: "研究機関プロフィール",
  website: "Webサイト",
  other: "その他",
  human_verified: "人が確認済み",
  source_recorded: "出典を記録済み",
  unverified: "未確認",
};

function label(value) {
  if (value === null || value === undefined || value === "") return "未収録";
  return LABELS[value] ?? String(value).replaceAll("_", " ");
}

function element(tag, { className, text } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function link(text, href) {
  const anchor = element("a", { text });
  anchor.href = href;
  if (/^https?:/u.test(href)) anchor.rel = "noopener noreferrer";
  return anchor;
}

function facts(items) {
  const list = element("dl", { className: "facts" });
  items.forEach(([term, value]) => {
    const detail = element("dd");
    if (value instanceof Node) detail.append(value);
    else detail.textContent = label(value);
    list.append(element("dt", { text: term }), detail);
  });
  return list;
}

function section(title) {
  const node = element("section", { className: "study-section" });
  node.append(element("h2", { text: title }));
  return node;
}

function sourceLink(url) {
  const safeUrl = safeHttpUrl(url);
  return safeUrl ? link("出典を確認", safeUrl) : document.createTextNode("出典未収録");
}

function contactValue(contact) {
  if (contact.type === "email" && /^[^\s@]+@[^\s@]+$/u.test(contact.value)) {
    return link(contact.value, `mailto:${contact.value}`);
  }
  const safeUrl = safeHttpUrl(contact.value);
  return safeUrl ? link(contact.value, safeUrl) : document.createTextNode(contact.value);
}

function renderAuthor(author) {
  const fragment = document.createDocumentFragment();
  const badges = element("div", { className: "badge-row" });
  badges.append(element("span", { className: "badge", text: `収録研究 ${author.studies.length}件` }));
  if (author.orcid) badges.append(element("span", { className: "badge", text: `ORCID ${author.orcid}` }));
  fragment.append(badges, element("h1", { className: "study-title", text: author.name }));
  if (author.nativeName && author.nativeName !== author.name) {
    fragment.append(element("p", { className: "lede", text: author.nativeName }));
  }

  const overview = section("著者情報");
  const orcidUrl = author.orcid ? safeHttpUrl(`https://orcid.org/${author.orcid}`) : null;
  const profileUrl = safeHttpUrl(author.profileUrl);
  overview.append(facts([
    ["著者ID", author.publicId],
    ["名", author.givenName],
    ["姓", author.familyName],
    ["ORCID", orcidUrl ? link(author.orcid, orcidUrl) : author.orcid],
    ["プロフィール", profileUrl ? link("外部プロフィール", profileUrl) : null],
  ]));
  const filterLink = link("この著者の研究だけを検索", `/?authorId=${encodeURIComponent(author.publicId)}`);
  const filterParagraph = element("p");
  filterParagraph.append(filterLink);
  overview.append(filterParagraph);
  fragment.append(overview);

  const affiliations = section("所属");
  if (!author.affiliations.length) {
    affiliations.append(element("p", { className: "empty-state", text: "所属は未収録です。" }));
  } else {
    const list = element("div", { className: "card-list" });
    author.affiliations.forEach((affiliation) => {
      const card = element("article", { className: "data-card" });
      card.append(element("h3", { text: affiliation.name }));
      const study = affiliation.study
        ? link(`${affiliation.study.publicationYear} · ${affiliation.study.title}`, `/study?id=${encodeURIComponent(affiliation.study.publicId)}`)
        : (affiliation.isCurrent ? "現所属として収録" : null);
      card.append(facts([
        ["部門", affiliation.department],
        ["役職", affiliation.roleTitle],
        ["所在地", [affiliation.city, affiliation.region, affiliation.countryCode].filter(Boolean).join("、")],
        ["関連研究", study],
        ["確認状態", label(affiliation.verificationStatus)],
        ["出典", sourceLink(affiliation.sourceUrl)],
      ]));
      list.append(card);
    });
    affiliations.append(list);
  }
  fragment.append(affiliations);

  const contacts = section("公開連絡先");
  contacts.append(element("p", { className: "contact-notice", text: author.contactNotice }));
  if (!author.contacts.length) {
    contacts.append(element("p", { className: "empty-state", text: "公開連絡先は未収録です。" }));
  } else {
    author.contacts.forEach((contact) => contacts.append(facts([
      [contact.label || label(contact.type), contactValue(contact)],
      ["確認状態", label(contact.verificationStatus)],
      ["出典", sourceLink(contact.sourceUrl)],
    ])));
  }
  fragment.append(contacts);

  const studies = section("収録研究");
  if (!author.studies.length) {
    studies.append(element("p", { className: "empty-state", text: "公開中の収録研究はありません。" }));
  } else {
    author.studies.forEach((study) => {
      const card = element("article", { className: "result-card" });
      const heading = element("h3");
      heading.append(link(study.title, `/study?id=${encodeURIComponent(study.publicId)}`));
      card.append(heading, element("p", {
        className: "result-meta",
        text: [study.publicationYear, study.journal, `著者順 ${study.authorOrder}`].filter(Boolean).join(" · "),
      }));
      studies.append(card);
    });
  }
  fragment.append(studies);
  container.replaceChildren(fragment);
}

async function loadAuthor() {
  const publicId = new URL(location.href).searchParams.get("id");
  if (!publicId) throw new Error("著者IDが指定されていません。");
  const response = await fetch(`/api/v1/authors/${encodeURIComponent(publicId)}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "著者を取得できませんでした。");
  document.title = `${payload.data.name} · Biomedical Hydrogen Evidence`;
  renderAuthor(payload.data);
  statusElement.textContent = "著者プロフィール";
}

try {
  await loadAuthor();
} catch (error) {
  statusElement.textContent = "読み込みエラー";
  container.replaceChildren(element("p", { className: "error-message", text: error.message }));
}
