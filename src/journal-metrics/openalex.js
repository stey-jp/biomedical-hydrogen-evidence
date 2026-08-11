const endpoint = "https://api.openalex.org/sources";

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
  const normalized = normalizeJournalTitle(title);
  const results = Array.isArray(body?.results) ? body.results : [];
  const exact = results.filter((item) => (
    item?.type === "journal" && normalizeJournalTitle(item?.display_name) === normalized
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

export function createOpenAlexClient({ apiKey, fetchImpl = fetch } = {}) {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  return {
    configured: Boolean(key),

    async lookup(title) {
      if (!key) throw new JournalMetricsProviderError("OpenAlex API key is not configured.", 503);
      const url = new URL(endpoint);
      url.searchParams.set("search", title);
      url.searchParams.set("filter", "type:journal");
      url.searchParams.set("select", "id,display_name,type,summary_stats,updated_date");
      url.searchParams.set("per_page", "10");
      url.searchParams.set("api_key", key);
      let response;
      try {
        response = await fetchImpl(url, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(12_000),
        });
      } catch {
        throw new JournalMetricsProviderError("OpenAlex API request failed.");
      }
      if (!response.ok) {
        const status = response.status === 401 || response.status === 403 ? 503 : 502;
        throw new JournalMetricsProviderError(`OpenAlex API request failed with status ${response.status}.`, status);
      }
      let body;
      try {
        body = await response.json();
      } catch {
        throw new JournalMetricsProviderError("OpenAlex API returned an invalid response.");
      }
      return journalLookupResult(title, body);
    },
  };
}
