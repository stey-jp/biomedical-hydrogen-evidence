import test from "node:test";
import assert from "node:assert/strict";
import {
  createOpenAlexClient,
  journalLookupResult,
  normalizeJournalTitle,
} from "../src/journal-metrics/openalex.js";
import {
  currentMetricYear,
  refreshJournalMetrics,
} from "../src/services/journal-metrics.js";

test("OpenAlex journal lookup requires an exact normalized title and returns the 2-year metric", async () => {
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

test("scheduled journal metric refresh batches stale titles and records source metadata", async () => {
  const saved = [];
  const waits = [];
  const repository = {
    async getJournalMetricRefreshQueue(input) {
      assert.equal(input.metricYear, 2025);
      assert.equal(input.limit, 20);
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
  assert.deepEqual(result, { configured: true, metricYear: 2025, queued: 6, refreshed: 6 });
  assert.deepEqual(saved.map((batch) => batch.length), [5, 1]);
  assert.deepEqual(waits, [1_100]);
  assert.equal(saved[0][0].metricType, "openalex_2yr_mean_citedness");
  assert.equal(saved[0][0].metricValue, 2.5);
  assert.equal(saved[0][0].source, "openalex");
});

test("scheduled journal metric refresh safely skips an unconfigured API", async () => {
  const result = await refreshJournalMetrics({
    repository: {},
    client: { configured: false },
  });
  assert.deepEqual(result, { configured: false, refreshed: 0 });
});
