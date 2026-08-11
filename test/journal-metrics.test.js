import test from "node:test";
import assert from "node:assert/strict";
import {
  crossrefJournalResult,
  createOpenAlexClient,
  journalLookupResult,
  journalSearchTitle,
  journalTitlesMatch,
  nlmCatalogSearchResult,
  nlmCatalogSummaryResult,
  normalizeJournalTitle,
} from "../src/journal-metrics/openalex.js";
import {
  currentMetricYear,
  refreshJournalMetrics,
} from "../src/services/journal-metrics.js";

test("OpenAlex journal lookup accepts a safely normalized title and returns the 2-year metric", async () => {
  let request;
  const client = createOpenAlexClient({
    apiKey: "test-openalex-key",
    fetchImpl: async (url, init) => {
      request = { url: new URL(url), init };
      return Response.json({
        results: [
          {
            id: "https://openalex.org/S123",
            display_name: "Journal & Therapy",
            type: "journal",
            summary_stats: { "2yr_mean_citedness": 4.275 },
            updated_date: "2026-08-10T00:00:00Z",
          },
          {
            id: "https://openalex.org/S456",
            display_name: "Journal and Therapy Reports",
            type: "journal",
            summary_stats: { "2yr_mean_citedness": 9.9 },
          },
        ],
      });
    },
  });
  const result = await client.lookup("Journal and Therapy");

  assert.equal(normalizeJournalTitle(" Journal & Therapy "), "journal and therapy");
  assert.equal(request.url.origin, "https://api.openalex.org");
  assert.equal(request.url.searchParams.get("filter"), "type:journal");
  assert.equal(request.url.searchParams.get("api_key"), "test-openalex-key");
  assert.equal(request.init.headers.accept, "application/json");
  assert.deepEqual(result, {
    matchStatus: "matched",
    journalTitle: "Journal & Therapy",
    metricValue: 4.275,
    sourceJournalId: "S123",
    sourceUrl: "https://openalex.org/S123",
    sourceUpdatedAt: "2026-08-10T00:00:00Z",
  });
});

test("OpenAlex journal lookup does not assign a metric from a fuzzy-only match", () => {
  const result = journalLookupResult("Journal of Hydrogen", {
    results: [{
      id: "https://openalex.org/S999",
      display_name: "International Journal of Hydrogen",
      type: "journal",
      summary_stats: { "2yr_mean_citedness": 12.3 },
    }],
  });
  assert.equal(result.matchStatus, "not_found");
  assert.equal(result.metricValue, null);
});

test("journal title matching resolves common biomedical abbreviations without fuzzy reordering", () => {
  assert.equal(journalTitlesMatch("Acc Chem Res", "Accounts of Chemical Research"), true);
  assert.equal(journalTitlesMatch("Acta Cir Bras", "Acta Cirúrgica Brasileira"), true);
  assert.equal(journalTitlesMatch("J Biochem Mol Toxicol", "Journal of Biochemical and Molecular Toxicology"), true);
  assert.equal(journalTitlesMatch("J Clin Med", "Journal of Medical Clinics"), false);
  assert.equal(journalSearchTitle("Hepatology (Baltimore, Md.)"), "Hepatology");
  assert.equal(journalSearchTitle("Movement disorders : official journal of the Society"), "Movement disorders");
});

test("Crossref journal lookup only resolves a unique abbreviation match with an ISSN", () => {
  const result = crossrefJournalResult("Acc Chem Res", {
    message: {
      items: [
        { title: "Accounts of Chemical Research", ISSN: ["0001-4842", "1520-4898"] },
        { title: "Open Access Research Journal of Chemistry and Pharmacy", ISSN: ["2783-0276"] },
      ],
    },
  });
  assert.deepEqual(result, { title: "Accounts of Chemical Research", issn: "0001-4842" });
});

test("NLM Catalog lookup resolves an exact title abbreviation with an ISSN", () => {
  const searchBody = { esearchresult: { idlist: ["157313", "999"] } };
  const summaryBody = {
    result: {
      157313: {
        medlineta: "Acc Chem Res",
        titlemainlist: [{ title: "Accounts of chemical research." }],
        titleotherlist: [],
        issnlist: [{ issn: "0001-4842", validyn: "Y", issntype: "Print" }],
      },
      999: {
        medlineta: "Open Chem J",
        titlemainlist: [{ title: "Open chemistry journal." }],
        titleotherlist: [{ titlealternate: "Accounts Chemical Research" }],
        issnlist: [{ issn: "9999-9999", validyn: "Y" }],
      },
    },
  };
  assert.deepEqual(nlmCatalogSearchResult(searchBody), ["157313", "999"]);
  assert.deepEqual(
    nlmCatalogSummaryResult("Acc Chem Res", ["157313", "999"], summaryBody),
    { title: "Acc Chem Res", issn: "0001-4842" },
  );
});

test("journal lookup resolves an abbreviated NLM title by ISSN in OpenAlex", async () => {
  const requests = [];
  const client = createOpenAlexClient({
    apiKey: "test-openalex-key",
    fetchImpl: async (url) => {
      const requestUrl = new URL(url);
      requests.push(requestUrl);
      if (requestUrl.pathname.endsWith("/esearch.fcgi")) {
        return Response.json({ esearchresult: { idlist: ["157313"] } });
      }
      if (requestUrl.pathname.endsWith("/esummary.fcgi")) {
        return Response.json({
          result: {
            157313: {
              medlineta: "Acc Chem Res",
              titlemainlist: [{ title: "Accounts of chemical research." }],
              titleotherlist: [],
              issnlist: [{ issn: "0001-4842", validyn: "Y" }],
            },
          },
        });
      }
      return Response.json({
        results: [{
          id: "https://openalex.org/S101",
          display_name: "Accounts of Chemical Research",
          type: "journal",
          issn_l: "0001-4842",
          issn: ["0001-4842", "1520-4898"],
          summary_stats: { "2yr_mean_citedness": 19.32 },
          updated_date: "2026-08-10T00:00:00Z",
        }],
      });
    },
  });

  const result = await client.lookup("Acc Chem Res");

  assert.equal(requests.length, 3);
  assert.match(requests[0].searchParams.get("term"), /Acc Chem Res/u);
  assert.equal(requests[1].searchParams.get("id"), "157313");
  assert.equal(requests[2].searchParams.get("filter"), "issn:0001-4842");
  assert.equal(result.matchStatus, "matched");
  assert.equal(result.journalTitle, "Accounts of Chemical Research");
  assert.equal(result.metricValue, 19.32);
});

test("journal lookup does not cache a false not-found result when registries fail", async () => {
  const client = createOpenAlexClient({
    apiKey: "test-openalex-key",
    fetchImpl: async (url) => {
      const requestUrl = new URL(url);
      if (requestUrl.origin === "https://api.openalex.org") return Response.json({ results: [] });
      return Response.json({}, { status: 503 });
    },
  });

  await assert.rejects(
    client.lookup("J Example Med"),
    /temporarily unavailable/u,
  );
});

test("scheduled journal metric refresh batches stale titles and records source metadata", async () => {
  const saved = [];
  const waits = [];
  const repository = {
    async getJournalMetricRefreshQueue(input) {
      assert.equal(input.metricYear, 2025);
      assert.equal(input.limit, 12);
      return Array.from({ length: 6 }, (_, index) => ({
        journal: `Journal ${index + 1}`,
        lookup_title_key: `journal ${index + 1}`,
      }));
    },
    async saveJournalMetrics(records) { saved.push(records); },
  };
  const client = {
    configured: true,
    async lookup(title) {
      return {
        matchStatus: "matched",
        journalTitle: title,
        metricValue: 2.5,
        sourceJournalId: "S1",
        sourceUrl: "https://openalex.org/S1",
        sourceUpdatedAt: "2026-08-01T00:00:00Z",
      };
    },
  };
  const result = await refreshJournalMetrics({
    repository,
    client,
    now: () => Date.parse("2026-08-11T00:00:00Z"),
    waitImpl: async (milliseconds) => waits.push(milliseconds),
  });

  assert.equal(currentMetricYear(Date.parse("2026-08-11T00:00:00Z")), 2025);
  assert.deepEqual(result, { configured: true, metricYear: 2025, queued: 6, refreshed: 6, failed: 0 });
  assert.deepEqual(saved.map((batch) => batch.length), [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(waits, [1_100, 1_100, 1_100, 1_100, 1_100]);
  assert.equal(saved[0][0].metricType, "openalex_2yr_mean_citedness");
  assert.equal(saved[0][0].metricValue, 2.5);
  assert.equal(saved[0][0].source, "openalex");
});

test("scheduled journal metric refresh continues after an individual provider failure", async () => {
  const saved = [];
  const repository = {
    async getJournalMetricRefreshQueue() {
      return [
        { journal: "Journal 1", lookup_title_key: "journal 1" },
        { journal: "Journal 2", lookup_title_key: "journal 2" },
        { journal: "Journal 3", lookup_title_key: "journal 3" },
      ];
    },
    async saveJournalMetrics(records) { saved.push(...records); },
  };
  const client = {
    configured: true,
    async lookup(title) {
      if (title === "Journal 2") throw new Error("temporary provider failure");
      return {
        matchStatus: "matched",
        journalTitle: title,
        metricValue: 1.5,
        sourceJournalId: "S1",
        sourceUrl: "https://openalex.org/S1",
        sourceUpdatedAt: null,
      };
    },
  };

  const result = await refreshJournalMetrics({
    repository,
    client,
    now: () => Date.parse("2026-08-11T00:00:00Z"),
    waitImpl: async () => {},
  });

  assert.equal(result.refreshed, 2);
  assert.equal(result.failed, 1);
  assert.deepEqual(saved.map((record) => record.lookupTitle), ["Journal 1", "Journal 3"]);
});

test("scheduled journal metric refresh safely skips an unconfigured API", async () => {
  const result = await refreshJournalMetrics({
    repository: {},
    client: { configured: false },
  });
  assert.deepEqual(result, { configured: false, refreshed: 0 });
});
