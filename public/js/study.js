const container = document.querySelector("#study");
const statusElement = document.querySelector("#study-status");

const LABELS = {
  human: "Human",
  animal: "Animal",
  in_vitro: "In-vitro",
  human_verified: "人が確認済み",
  machine_checked: "モデル間一致を確認",
  needs_human_review: "人による確認が必要",
  inhalation: "水素吸入",
  hydrogen_rich_water: "水素水",
};

function label(value) {
  if (value === null || value === undefined || value === "") return "未収録";
  if (typeof value === "boolean") return value ? "はい" : "いいえ";
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

function facts(items) {
  const list = element("dl", { className: "facts" });
  items.forEach(([term, description]) => {
    list.append(element("dt", { text: term }), element("dd", { text: label(description) }));
  });
  return list;
}

function section(title) {
  const node = element("section", { className: "study-section" });
  node.append(element("h2", { text: title }));
  return node;
}

function card(title, content) {
  const node = element("article", { className: "data-card" });
  node.append(element("h3", { text: title }), content);
  return node;
}

function renderStudy(study, evidence) {
  const fragment = document.createDocumentFragment();
  const badges = element("div", { className: "badge-row" });
  [study.bibliography.publicationYear, label(study.classification.speciesType), label(study.classification.studyDesign), label(study.verification.status)]
    .forEach((value) => badges.append(element("span", { className: "badge", text: value })));
  fragment.append(badges, element("h1", { className: "study-title", text: study.bibliography.title }));
  if (study.recordKind === "fixture") {
    fragment.append(element("p", { className: "fixture-notice", text: study.fixtureNotice }));
  }

  const overview = section("研究概要");
  overview.append(facts([
    ["Public ID", study.publicId],
    ["著者", study.bibliography.authors.map((author) => author.name).join(", ")],
    ["掲載誌", study.bibliography.journal],
    ["公開日", study.bibliography.publicationDate],
    ["言語", study.bibliography.language],
  ]));
  fragment.append(overview);

  const design = section("研究対象・デザイン");
  design.append(facts([
    ["対象", study.classification.speciesType],
    ["研究デザイン", study.classification.studyDesign],
    ["参加者数", study.population.participantCount],
    ["解析対象数", study.population.analyzedParticipantCount],
    ["疾患・状態", study.population.diseaseOrCondition],
    ["年齢", study.population.ageDescription],
    ["性別", study.population.sexDescription],
    ["ランダム化", study.classification.randomized],
    ["盲検化", study.classification.blinded],
  ]));
  fragment.append(design);

  const interventions = section("水素条件・比較対象");
  study.interventions.forEach((item, index) => interventions.append(card(`介入 ${index + 1}`, facts([
    ["投与経路", item.administrationRoute],
    ["水素濃度", [item.hydrogenConcentration, item.concentrationUnit].filter(Boolean).join(" ")],
    ["溶存水素濃度", [item.dissolvedHydrogenConcentration, item.dissolvedHydrogenUnit].filter(Boolean).join(" ")],
    ["流量", [item.flowRate, item.flowUnit].filter(Boolean).join(" ")],
    ["1回の時間", item.durationPerSession],
    ["頻度", item.frequency],
    ["総介入期間", item.totalInterventionPeriod],
    ["調製方法", item.preparationMethod],
    ["機器情報", item.deviceInformation],
    ["比較対象", item.comparator],
  ]))));
  fragment.append(interventions);

  const outcomes = section("Outcomes");
  study.outcomes.forEach((item) => outcomes.append(card(item.name, facts([
    ["分類", item.classification],
    ["測定方法", item.measurementMethod],
    ["介入群", item.interventionValue],
    ["対照群", item.controlValue],
    ["効果推定", item.effectEstimate],
    ["p値", item.pValue],
    ["信頼区間", item.confidenceInterval],
    ["方向", item.direction],
    ["時点", item.timePoint],
  ]))));
  fragment.append(outcomes);

  const safety = section("Safety");
  safety.append(facts([
    ["有害事象", study.safety?.adverseEvents],
    ["重篤な有害事象", study.safety?.seriousAdverseEvents],
    ["中止・脱落", study.safety?.withdrawals],
    ["安全性の記載", study.safety?.conclusion],
  ]));
  fragment.append(safety);

  const transparency = section("Funding / COI");
  transparency.append(facts([
    ["資金提供", study.researchTransparency?.funding],
    ["利益相反", study.researchTransparency?.conflictOfInterest],
    ["試験登録", study.researchTransparency?.trialRegistration],
    ["登録番号", study.researchTransparency?.registrationNumber],
    ["倫理承認", study.researchTransparency?.ethicsApproval],
  ]));
  fragment.append(transparency);

  const verification = section("Verification / Provenance");
  verification.append(element("p", { text: study.verification.note }));
  if (!evidence.length) verification.append(element("p", { text: "根拠スニペットは未収録です。" }));
  evidence.forEach((item) => verification.append(card(item.fieldName, facts([
    ["根拠種別", item.sourceType],
    ["セクション", item.section],
    ["位置", item.locator],
    ["短い根拠", item.evidenceSnippet],
    ["権利状態", item.rightsStatus],
    ["検証状態", item.verification.status],
    ["検証メモ", item.verification.note],
  ]))));
  fragment.append(verification);

  const original = section("Original paper");
  const links = Object.entries(study.bibliography.links)
    .map(([name, url]) => [name, safeHttpUrl(url)])
    .filter(([, url]) => url);
  if (!links.length) {
    original.append(element("p", { text: "原論文リンクは未収録です。fixtureには実在しない識別子を付与していません。" }));
  } else {
    const list = element("ul");
    links.forEach(([name, url]) => {
      const item = element("li");
      const anchor = element("a", { text: name });
      anchor.href = url;
      anchor.rel = "noopener noreferrer";
      item.append(anchor);
      list.append(item);
    });
    original.append(list);
  }
  fragment.append(original);
  container.replaceChildren(fragment);
}

async function loadStudy() {
  const publicId = new URL(location.href).searchParams.get("id");
  if (!publicId) throw new Error("研究のPublic IDが指定されていません。");
  const [studyResponse, evidenceResponse] = await Promise.all([
    fetch(`/api/v1/studies/${encodeURIComponent(publicId)}`),
    fetch(`/api/v1/studies/${encodeURIComponent(publicId)}/evidence`),
  ]);
  const studyPayload = await studyResponse.json();
  const evidencePayload = await evidenceResponse.json();
  if (!studyResponse.ok) throw new Error(studyPayload.error?.message ?? "研究を取得できませんでした。");
  if (!evidenceResponse.ok) throw new Error(evidencePayload.error?.message ?? "根拠を取得できませんでした。");
  document.title = `${studyPayload.data.bibliography.title} · Biomedical Hydrogen Evidence`;
  renderStudy(studyPayload.data, evidencePayload.data.evidence);
  statusElement.textContent = "構造化された研究情報";
}

try {
  await loadStudy();
} catch (error) {
  statusElement.textContent = "読み込みエラー";
  container.replaceChildren(element("p", { className: "error-message", text: error.message }));
}
