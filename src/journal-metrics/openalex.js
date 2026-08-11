const endpoint = "https://api.openalex.org/sources";
const crossrefEndpoint = "https://api.crossref.org/journals";
const nlmSearchEndpoint = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const nlmSummaryEndpoint = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";
const ignoredTitleWords = new Set(["and", "de", "der", "for", "in", "of", "on", "the"]);

export class JournalMetricsProviderError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "JournalMetricsProviderError";
    this.status = status;
  }
}

export function normalizeJournalTitle(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/&/gu, " and ")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

export function journalSearchTitle(value) {
  return String(value ?? "")
    .replace(/\s*[(:]\s*(?:official journal|\d{4}|[A-Z][a-z]+,\s*[A-Z][a-z]*\.)[^)]*\)?[\s\S]*$/u, "")
    .replace(/\s+:\s+[^:]+$/u, "")
    .replace(/\s+\.\.\.[\s\S]*$/u, "")
    .trim();
}

function significantTitleWords(value) {
  return normalizeJournalTitle(value)
    .split(" ")
    .filter((word) => word && !ignoredTitleWords.has(word));
}

export function journalTitlesMatch(query, candidate) {
  const normalizedQuery = normalizeJournalTitle(query);
  const normalizedCandidate = normalizeJournalTitle(candidate);
  if (!normalizedQuery || !normalizedCandidate) return false;
  if (normalizedQuery === normalizedCandidate) return true;
  const queryWords = significantTitleWords(query);
  const candidateWords = significantTitleWords(candidate);
  return queryWords.length === candidateWords.length
    && queryWords.every((word, index) => candidateWords[index].startsWith(word));
}

function finiteMetric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function sourceUrl(hit) {
  try {
    const url = new URL(hit?.id);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function journalLookupResult(title, body) {
  const results = Array.isArray(body?.results) ? body.results : [];
  const exact = results.filter((item) => (
    item?.type === "journal" && journalTitlesMatch(title, item?.display_name)
  ));
  if (exact.length > 1) {
    return { matchStatus: "ambiguous", journalTitle: null, metricValue: null, sourceJournalId: null, sourceUrl: null, sourceUpdatedAt: null };
  }
  if (!exact.length) {
    return { matchStatus: "not_found", journalTitle: null, metricValue: null, sourceJournalId: null, sourceUrl: null, sourceUpdatedAt: null };
  }
  const item = exact[0];
  const metricValue = finiteMetric(item?.summary_stats?.["2yr_mean_citedness"]);
  return {
    matchStatus: metricValue === null ? "not_available" : "matched",
    journalTitle: String(item.display_name).trim(),
    metricValue,
    sourceJournalId: typeof item.id === "string" ? item.id.split("/").at(-1) : null,
    sourceUrl: sourceUrl(item),
    sourceUpdatedAt: typeof item.updated_date === "string" ? item.updated_date : null,
  };
}

export function crossrefJournalResult(title, body) {
  const items = Array.isArray(body?.message?.items) ? body.message.items : [];
  const matches = items.filter((item) => (
    typeof item?.title === "string"
    && journalTitlesMatch(title, item.title)
    && Array.isArray(item.ISSN)
    && item.ISSN.some((issn) => typeof issn === "string" && issn.trim())
  ));
  if (matches.length !== 1) return null;
  return {
    title: matches[0].title.trim(),
    issn: matches[0].ISSN.find((issn) => typeof issn === "string" && issn.trim()).trim(),
  };
}

export function nlmCatalogSearchResult(body) {
  const ids = Array.isArray(body?.esearchresult?.idlist) ? body.esearchresult.idlist : [];
  return ids.filter((id) => typeof id === "string" && id).slice(0, 5);
}

export function nlmCatalogSummaryResult(title, ids, body) {
  const normalizedTitle = normalizeJournalTitle(title);
  const matches = ids.flatMap((id) => {
    const item = body?.result?.[id];
    if (!item || typeof item !== "object") return [];
    const knownTitles = [
      item.medlineta,
      ...(Array.isArray(item.titlemainlist) ? item.titlemainlist.map((entry) => entry?.title) : []),
      ...(Array.isArray(item.titleotherlist) ? item.titleotherlist.map((entry) => entry?.titlealternate) : []),
    ].filter((value) => typeof value === "string");
    const exact = knownTitles.some((knownTitle) => normalizeJournalTitle(knownTitle) === normalizedTitle);
    if (!exact && !knownTitles.some((knownTitle) => journalTitlesMatch(title, knownTitle))) return [];
    const issn = Array.isArray(item.issnlist)
      ? item.issnlist.find((entry) => entry?.validyn !== "N" && typeof entry?.issn === "string" && entry.issn.trim())?.issn
      : null;
    return typeof issn === "string" ? [{ title: knownTitles[0], issn: issn.trim(), exact }] : [];
  });
  const preferred = matches.some((match) => match.exact)
    ? matches.filter((match) => match.exact)
    : matches;
  return preferred.length === 1
    ? { title: preferred[0].title, issn: preferred[0].issn }
    : null;
}

function issnLookupResult(issn, body) {
  const results = Array.isArray(body?.results) ? body.results : [];
  const matches = results.filter((item) => (
    item?.type === "journal"
    && (item.issn_l === issn || (Array.isArray(item.issn) && item.issn.includes(issn)))
  ));
  return matches.length === 1 ? journalLookupResult(matches[0].display_name, { results: matches }) : null;
}

export function createOpenAlexClient({ apiKey, fetchImpl = fetch } = {}) {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";

  async function requestJson(url, provider) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new JournalMetricsProviderError(`${provider} API request failed.`);
    }
    if (!response.ok) {
      const status = response.status === 401 || response.status === 403 ? 503 : 502;
      throw new JournalMetricsProviderError(`${provider} API request failed with status ${response.status}.`, status);
    }
    try {
      return await response.json();
    } catch {
      throw new JournalMetricsProviderError(`${provider} API returned an invalid response.`);
    }
  }

  function openAlexUrl() {
    const url = new URL(endpoint);
    url.searchParams.set("select", "id,display_name,type,summary_stats,updated_date,issn_l,issn");
    url.searchParams.set("per_page", "10");
    url.searchParams.set("api_key", key);
    return url;
  }

  async function resolveWithNlm(title) {
    const searchUrl = new URL(nlmSearchEndpoint);
    searchUrl.searchParams.set("db", "nlmcatalog");
    searchUrl.searchParams.set("term", `"${title}"[Title Abbreviation] OR "${title}"[Title]`);
    searchUrl.searchParams.set("retmode", "json");
    searchUrl.searchParams.set("retmax", "5");
    const ids = nlmCatalogSearchResult(await requestJson(searchUrl, "NLM Catalog"));
    if (!ids.length) return null;
    const summaryUrl = new URL(nlmSummaryEndpoint);
    summaryUrl.searchParams.set("db", "nlmcatalog");
    summaryUrl.searchParams.set("id", ids.join(","));
    summaryUrl.searchParams.set("retmode", "json");
    return nlmCatalogSummaryResult(title, ids, await requestJson(summaryUrl, "NLM Catalog"));
  }

  async function resolveWithCrossref(title) {
    const url = new URL(crossrefEndpoint);
    url.searchParams.set("query", title);
    url.searchParams.set("rows", "5");
    return crossrefJournalResult(title, await requestJson(url, "Crossref"));
  }

  async function lookupByIssn(resolved) {
    if (!resolved) return null;
    const url = openAlexUrl();
    url.searchParams.set("filter", `issn:${resolved.issn}`);
    return issnLookupResult(resolved.issn, await requestJson(url, "OpenAlex"));
  }

  return {
    configured: Boolean(key),

    async lookup(title) {
      if (!key) throw new JournalMetricsProviderError("OpenAlex API key is not configured.", 503);
      const searchTitle = journalSearchTitle(title) || title;
      let resolverFailed = false;
      try {
        const result = await lookupByIssn(await resolveWithNlm(searchTitle));
        if (result) return result;
      } catch {
        resolverFailed = true;
        // Continue with the next resolver when NLM Catalog is unavailable.
      }
      try {
        const result = await lookupByIssn(await resolveWithCrossref(searchTitle));
        if (result) return result;
      } catch {
        resolverFailed = true;
        // Fall back to OpenAlex title search when registry resolution is unavailable.
      }
      const url = openAlexUrl();
      url.searchParams.set("search", searchTitle);
      url.searchParams.set("filter", "type:journal");
      const result = journalLookupResult(searchTitle, await requestJson(url, "OpenAlex"));
      if (resolverFailed && result.matchStatus === "not_found") {
        throw new JournalMetricsProviderError("Journal registries were temporarily unavailable.");
      }
      return result;
    },
  };
}
