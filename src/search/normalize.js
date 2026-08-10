const ALIASES = new Map([
  ["hydrogen gas inhalation", "inhalation"],
  ["hydrogen inhalation", "inhalation"],
  ["h2 inhalation", "inhalation"],
  ["hydrogen-rich water", "hydrogen_rich_water"],
  ["hydrogen rich water", "hydrogen_rich_water"],
  ["hydrogen water", "hydrogen_rich_water"],
  ["molecular hydrogen", "molecular_hydrogen"],
  ["分子状水素", "molecular_hydrogen"],
  ["ランダム化比較試験", "randomized_controlled_trial"],
  ["パーキンソン病", "parkinson_disease"],
  ["水素吸入", "inhalation"],
  ["水素水", "hydrogen_rich_water"],
  ["水素", "molecular_hydrogen"],
  ["ヒト", "human"],
  ["認知症", "dementia"],
  ["睡眠", "sleep"],
  ["hrw", "hydrogen_rich_water"],
  ["rct", "randomized_controlled_trial"],
  ["h2", "molecular_hydrogen"],
]);

const STOP_WORDS = new Set([
  "and", "about", "study", "studies", "research", "with", "for", "of", "the",
  "と", "の", "に", "を", "で", "関する", "研究",
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeUnicode(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replaceAll("₂", "2")
    .toLocaleLowerCase("en-US")
    .trim();
}

export function normalizeSearchQuery(value) {
  const original = String(value ?? "").trim();
  let expanded = normalizeUnicode(original);

  for (const [alias, canonical] of [...ALIASES.entries()].sort((a, b) => b[0].length - a[0].length)) {
    expanded = expanded.replace(new RegExp(escapeRegExp(alias), "giu"), ` ${canonical} `);
  }

  const terms = expanded
    .replace(/[\u3000,、。/|:;!?！？()\[\]{}]+/gu, " ")
    .split(/\s+/u)
    .map((term) => term.replace(/^[-+]+|[-+]+$/g, ""))
    .filter((term) => term && !STOP_WORDS.has(term))
    .filter((term, index, all) => all.indexOf(term) === index)
    .slice(0, 12);

  return {
    original,
    terms,
    canonical: terms.join(" "),
    ftsQuery: terms.length
      ? terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" AND ")
      : "",
  };
}

export function normalizeStructuredTerm(value) {
  const normalized = normalizeUnicode(value).replace(/[\s-]+/g, "_");
  return ALIASES.get(normalizeUnicode(value)) ?? normalized;
}

export const searchAliases = Object.freeze(Object.fromEntries(ALIASES));
