import {
  fromCrossref,
  fromEuropePmc,
  fromPubmedSummary,
} from "./model.mjs";

const TOOL_NAME = "biomedical_hydrogen_evidence";

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeRequestUrl(url) {
  const safe = new URL(url);
  safe.searchParams.delete("api_key");
  safe.searchParams.delete("email");
  safe.searchParams.delete("mailto");
  return safe.href;
}

async function fetchJson(url, { fetchImpl, headers, retries = 3 }) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetchImpl(url, { headers, signal: controller.signal });
      if (response.ok) return response.json();
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === retries) {
        throw new Error(`Source request failed with HTTP ${response.status}: ${safeRequestUrl(url)}`);
      }
      const retryAfter = Number(response.headers.get("retry-after"));
      await wait(Number.isFinite(retryAfter) ? retryAfter * 1000 : 500 * (2 ** attempt));
    } catch (error) {
      if (attempt === retries || (error.name !== "AbortError" && !/fetch failed/u.test(error.message))) throw error;
      await wait(500 * (2 ** attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("Source request failed after retries");
}

function requestHeaders(contactEmail) {
  return {
    accept: "application/json",
    "user-agent": `${TOOL_NAME}/0.2 (${contactEmail})`,
  };
}

function ncbiParams(contactEmail, apiKey) {
  return {
    tool: TOOL_NAME,
    email: contactEmail,
    ...(apiKey ? { api_key: apiKey } : {}),
  };
}

export async function collectPubmed(sourceConfig, options) {
  const records = [];
  const queries = [];
  const delayMs = options.ncbiApiKey ? 110 : 350;

  for (const query of sourceConfig.queries) {
    const executedAt = new Date().toISOString();
    const searchUrl = new URL(`${sourceConfig.endpoint}/esearch.fcgi`);
    const params = {
      db: "pubmed",
      term: query.query,
      retmode: "json",
      retmax: String(options.maxResultsPerQuery),
      sort: "relevance",
      ...ncbiParams(options.contactEmail, options.ncbiApiKey),
    };
    Object.entries(params).forEach(([key, value]) => searchUrl.searchParams.set(key, value));
    const search = await fetchJson(searchUrl, options);
    const ids = search.esearchresult?.idlist ?? [];
    const reportedResultCount = Number(search.esearchresult?.count ?? 0);

    for (let offset = 0; offset < ids.length; offset += 200) {
      if (offset > 0 || ids.length) await wait(delayMs);
      const batch = ids.slice(offset, offset + 200);
      if (!batch.length) continue;
      const summaryUrl = new URL(`${sourceConfig.endpoint}/esummary.fcgi`);
      const summaryParams = {
        db: "pubmed",
        id: batch.join(","),
        retmode: "json",
        ...ncbiParams(options.contactEmail, options.ncbiApiKey),
      };
      Object.entries(summaryParams).forEach(([key, value]) => summaryUrl.searchParams.set(key, value));
      const summary = await fetchJson(summaryUrl, options);
      const uids = summary.result?.uids ?? batch;
      for (const uid of uids) {
        const item = summary.result?.[uid];
        if (!item) continue;
        records.push(fromPubmedSummary(item, {
          queryKey: query.key,
          rank: records.length + 1,
          retrievedAt: new Date().toISOString(),
        }));
      }
    }
    queries.push({
      source: "pubmed",
      queryKey: query.key,
      endpoint: sourceConfig.endpoint,
      queryText: query.query,
      requestUrl: safeRequestUrl(searchUrl),
      reportedResultCount,
      retrievedCount: ids.length,
      executedAt,
    });
  }
  return { records, queries };
}

export async function collectEuropePmc(sourceConfig, options) {
  const records = [];
  const queries = [];
  for (const query of sourceConfig.queries) {
    const executedAt = new Date().toISOString();
    let cursorMark = "*";
    let retrievedCount = 0;
    let reportedResultCount = 0;
    let firstRequestUrl = null;
    while (retrievedCount < options.maxResultsPerQuery) {
      const pageSize = Math.min(1000, options.maxResultsPerQuery - retrievedCount);
      const url = new URL(`${sourceConfig.endpoint}/search`);
      url.searchParams.set("query", query.query);
      url.searchParams.set("format", "json");
      url.searchParams.set("resultType", "lite");
      url.searchParams.set("pageSize", String(pageSize));
      url.searchParams.set("cursorMark", cursorMark);
      firstRequestUrl ??= safeRequestUrl(url);
      const payload = await fetchJson(url, options);
      const page = payload.resultList?.result ?? [];
      reportedResultCount = Number(payload.hitCount ?? 0);
      page.forEach((item, index) => records.push(fromEuropePmc(item, {
        queryKey: query.key,
        rank: retrievedCount + index + 1,
        retrievedAt: new Date().toISOString(),
      })));
      retrievedCount += page.length;
      const next = payload.nextCursorMark;
      if (!page.length || page.length < pageSize || !next || next === cursorMark) break;
      cursorMark = next;
      await wait(250);
    }
    queries.push({
      source: "europepmc",
      queryKey: query.key,
      endpoint: sourceConfig.endpoint,
      queryText: query.query,
      requestUrl: firstRequestUrl,
      reportedResultCount,
      retrievedCount,
      executedAt,
    });
  }
  return { records, queries };
}

export async function collectCrossref(sourceConfig, options) {
  const records = [];
  const queries = [];
  for (const query of sourceConfig.queries) {
    const executedAt = new Date().toISOString();
    let cursor = "*";
    let retrievedCount = 0;
    let reportedResultCount = 0;
    let firstRequestUrl = null;
    while (retrievedCount < options.maxResultsPerQuery) {
      const rows = Math.min(1000, options.maxResultsPerQuery - retrievedCount);
      const url = new URL(sourceConfig.endpoint);
      url.searchParams.set("query.bibliographic", query.query);
      url.searchParams.set("filter", "type:journal-article");
      url.searchParams.set("rows", String(rows));
      url.searchParams.set("cursor", cursor);
      url.searchParams.set("mailto", options.contactEmail);
      firstRequestUrl ??= safeRequestUrl(url);
      const payload = await fetchJson(url, options);
      const page = payload.message?.items ?? [];
      reportedResultCount = Number(payload.message?.["total-results"] ?? 0);
      page.forEach((item, index) => records.push(fromCrossref(item, {
        queryKey: query.key,
        rank: retrievedCount + index + 1,
        retrievedAt: new Date().toISOString(),
      })));
      retrievedCount += page.length;
      const next = payload.message?.["next-cursor"];
      if (!page.length || page.length < rows || !next || next === cursor) break;
      cursor = next;
      await wait(250);
    }
    queries.push({
      source: "crossref",
      queryKey: query.key,
      endpoint: sourceConfig.endpoint,
      queryText: query.query,
      requestUrl: firstRequestUrl,
      reportedResultCount,
      retrievedCount,
      executedAt,
    });
  }
  return { records, queries };
}

export const collectors = Object.freeze({
  pubmed: collectPubmed,
  europepmc: collectEuropePmc,
  crossref: collectCrossref,
});
