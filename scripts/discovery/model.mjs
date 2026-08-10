import { createHash } from "node:crypto";

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value)
    .replace(/<[^>]*>/gu, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/\s+/gu, " ")
    .trim();
  return text || null;
}

export function normalizeDoi(value) {
  const cleaned = cleanText(value)?.toLocaleLowerCase("en-US")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//u, "")
    .replace(/^doi:\s*/u, "")
    .replace(/[\s.,;]+$/u, "");
  return cleaned && /^10\.\d{4,9}\/.+/u.test(cleaned) ? cleaned : null;
}

export function normalizePmid(value) {
  const cleaned = cleanText(value);
  return cleaned && /^\d{1,12}$/u.test(cleaned) ? cleaned : null;
}

export function normalizePmcid(value) {
  const cleaned = cleanText(value)?.toLocaleUpperCase("en-US").replace(/^PMC\s*/u, "PMC");
  return cleaned && /^PMC\d+$/u.test(cleaned) ? cleaned : null;
}

export function normalizeTitle(value) {
  return cleanText(value)?.normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim() ?? "";
}

export function publicationYear(...values) {
  for (const value of values) {
    const match = /(?:^|\D)((?:18|19|20|21)\d{2})(?:\D|$)/u.exec(String(value ?? ""));
    if (match) return Number(match[1]);
  }
  return null;
}

function dateParts(value) {
  const parts = value?.["date-parts"]?.[0];
  if (!Array.isArray(parts) || !parts[0]) return null;
  const [year, month = 1, day = 1] = parts;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function articleId(item, type) {
  return item.articleids?.find((identifier) => identifier.idtype === type)?.value ?? null;
}

function crossrefRights(licenses) {
  const url = licenses?.map((license) => license.URL).find(Boolean) ?? null;
  if (!url) return { sourceLicense: null, rightsStatus: "unknown" };
  const lower = url.toLocaleLowerCase("en-US");
  if (lower.includes("creativecommons.org/publicdomain/zero")) return { sourceLicense: url, rightsStatus: "cc0" };
  if (lower.includes("creativecommons.org/licenses/by-nc")) return { sourceLicense: url, rightsStatus: "cc_by_nc" };
  if (lower.includes("creativecommons.org/licenses/by/")) return { sourceLicense: url, rightsStatus: "cc_by" };
  return { sourceLicense: url, rightsStatus: "unknown" };
}

export function fromPubmedSummary(item, context) {
  const pmid = normalizePmid(item.uid);
  const doi = normalizeDoi(articleId(item, "doi") ?? item.elocationid);
  const pmcid = normalizePmcid(articleId(item, "pmc"));
  return {
    source: "pubmed",
    queryKey: context.queryKey,
    rank: context.rank,
    sourceIdentifier: pmid,
    sourceRecordUrl: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : null,
    title: cleanText(item.title) ?? "[Title unavailable]",
    doi,
    pmid,
    pmcid,
    publicationYear: publicationYear(item.sortpubdate, item.pubdate, item.epubdate),
    publicationDate: cleanText(item.sortpubdate)?.slice(0, 10) ?? null,
    journal: cleanText(item.fulljournalname ?? item.source),
    publisher: null,
    authors: (item.authors ?? []).map((author) => cleanText(author.name)).filter(Boolean),
    language: (item.lang ?? [])[0] ?? null,
    sourceLicense: "NCBI PubMed bibliographic metadata; verify source-specific rights",
    rightsStatus: "unknown",
    retrievedAt: context.retrievedAt,
  };
}

export function fromEuropePmc(item, context) {
  const sourceCode = cleanText(item.source) ?? "MED";
  const sourceId = cleanText(item.id ?? item.pmid ?? item.pmcid);
  const pmid = normalizePmid(item.pmid ?? (sourceCode === "MED" ? sourceId : null));
  const pmcid = normalizePmcid(item.pmcid);
  const doi = normalizeDoi(item.doi);
  return {
    source: "europepmc",
    queryKey: context.queryKey,
    rank: context.rank,
    sourceIdentifier: sourceId ? `${sourceCode}:${sourceId}` : null,
    sourceRecordUrl: sourceId
      ? `https://europepmc.org/article/${encodeURIComponent(sourceCode)}/${encodeURIComponent(sourceId)}`
      : null,
    title: cleanText(item.title) ?? "[Title unavailable]",
    doi,
    pmid,
    pmcid,
    publicationYear: publicationYear(item.pubYear, item.firstPublicationDate, item.journalInfo?.printPublicationDate),
    publicationDate: cleanText(item.firstPublicationDate) ?? null,
    journal: cleanText(item.journalTitle ?? item.journalInfo?.journal?.title),
    publisher: null,
    authors: cleanText(item.authorString)?.split(/,\s*/u).filter(Boolean) ?? [],
    language: cleanText(item.language),
    sourceLicense: "Europe PMC bibliographic metadata; verify record-specific rights",
    rightsStatus: "unknown",
    retrievedAt: context.retrievedAt,
  };
}

export function fromCrossref(item, context) {
  const doi = normalizeDoi(item.DOI);
  const published = dateParts(item.published) ?? dateParts(item["published-online"]) ?? dateParts(item["published-print"]);
  const rights = crossrefRights(item.license);
  return {
    source: "crossref",
    queryKey: context.queryKey,
    rank: context.rank,
    sourceIdentifier: doi,
    sourceRecordUrl: doi ? `https://doi.org/${doi}` : cleanText(item.URL),
    title: cleanText(item.title?.[0]) ?? "[Title unavailable]",
    doi,
    pmid: null,
    pmcid: null,
    publicationYear: publicationYear(published),
    publicationDate: published,
    journal: cleanText(item["container-title"]?.[0]),
    publisher: cleanText(item.publisher),
    authors: (item.author ?? []).map((author) => cleanText([author.given, author.family].filter(Boolean).join(" "))).filter(Boolean),
    language: cleanText(item.language),
    ...rights,
    retrievedAt: context.retrievedAt,
  };
}

function screeningHint(title) {
  const normalized = normalizeTitle(title);
  const negative = [
    "fuel cell", "green hydrogen", "hydrogen production", "hydrogen storage",
    "electrolysis", "photocatal", "energy carrier", "metal hydride",
  ].filter((term) => normalized.includes(term));
  const hydrogenIntervention = [
    "molecular hydrogen", "hydrogen rich water", "hydrogen water", "hydrogen rich saline",
    "hydrogen gas", "hydrogen inhalation", "hydrogen therapy", "hydrogen medicine",
    "h2 therapy", "h2 inhalation",
  ].filter((term) => normalized.includes(term));
  if (negative.length) return { hint: "likely_non_biomedical", reasons: negative.map((term) => `negative-title:${term}`) };
  if (hydrogenIntervention.length) {
    return {
      hint: "likely_biomedical",
      reasons: hydrogenIntervention.map((term) => `hydrogen-intervention-title:${term}`),
    };
  }
  return { hint: "needs_review", reasons: ["no-hydrogen-intervention-title-signal"] };
}

function identityTokens(record) {
  const strong = [
    record.doi ? `doi:${record.doi}` : null,
    record.pmid ? `pmid:${record.pmid}` : null,
    record.pmcid ? `pmcid:${record.pmcid}` : null,
  ].filter(Boolean);
  if (strong.length) return strong;
  const title = normalizeTitle(record.title);
  return title ? [`title-year:${title}:${record.publicationYear ?? "unknown"}`] : [];
}

function candidateKey(record) {
  if (record.doi) return `doi:${record.doi}`;
  if (record.pmid) return `pmid:${record.pmid}`;
  if (record.pmcid) return `pmcid:${record.pmcid}`;
  const digest = createHash("sha256")
    .update(`${normalizeTitle(record.title)}\n${record.publicationYear ?? "unknown"}`)
    .digest("hex")
    .slice(0, 24);
  return `title-year-sha256:${digest}`;
}

function mergeValue(current, incoming) {
  return current ?? incoming ?? null;
}

export function mergeCandidates(records) {
  const validRecords = records.filter((item) => item.sourceIdentifier && item.sourceRecordUrl && item.title);
  const parents = validRecords.map((_, index) => index);
  const tokenOwner = new Map();
  const find = (index) => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  validRecords.forEach((record, index) => {
    identityTokens(record).forEach((token) => {
      if (tokenOwner.has(token)) union(index, tokenOwner.get(token));
      else tokenOwner.set(token, index);
    });
  });

  const groups = new Map();
  validRecords.forEach((record, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(record);
  });

  return [...groups.values()].map((sources) => {
    const [first, ...rest] = sources;
    const candidate = { ...first, sources, authors: [...first.authors] };
    for (const record of rest) {
      for (const field of ["doi", "pmid", "pmcid", "publicationYear", "publicationDate", "journal", "publisher", "language", "sourceRecordUrl"]) {
        candidate[field] = mergeValue(candidate[field], record[field]);
      }
      candidate.authors = [...new Set([...candidate.authors, ...record.authors])];
      if (record.title.length > candidate.title.length) candidate.title = record.title;
    }
    const screening = screeningHint(candidate.title);
    return {
      ...candidate,
      candidateKey: candidateKey(candidate),
      titleNormalized: normalizeTitle(candidate.title),
      screeningHint: screening.hint,
      screeningReasons: screening.reasons,
    };
  });
}
