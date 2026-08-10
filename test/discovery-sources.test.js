import test from "node:test";
import assert from "node:assert/strict";
import { collectCrossref, collectEuropePmc, collectPubmed } from "../scripts/discovery/sources.mjs";

function response(payload) {
  return { ok: true, json: async () => payload };
}

const options = {
  contactEmail: "contact@example.test",
  fetchImpl: null,
  maxResultsPerQuery: 1,
  ncbiApiKey: "secret-key",
};

test("PubMed records a reproducible request without contact secrets", async () => {
  const result = await collectPubmed({
    endpoint: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils",
    queries: [{ key: "q1", query: "molecular hydrogen" }],
  }, {
    ...options,
    fetchImpl: async () => response({ esearchresult: { count: "0", idlist: [] } }),
  });

  assert.equal(result.queries[0].reportedResultCount, 0);
  assert.doesNotMatch(result.queries[0].requestUrl, /secret-key|contact%40example/u);
  assert.match(result.queries[0].requestUrl, /term=molecular\+hydrogen/u);
});

test("Europe PMC maps lite search results", async () => {
  const result = await collectEuropePmc({
    endpoint: "https://www.ebi.ac.uk/europepmc/webservices/rest",
    queries: [{ key: "q1", query: "TITLE:molecular hydrogen" }],
  }, {
    ...options,
    fetchImpl: async () => response({
      hitCount: 4,
      resultList: { result: [{ source: "MED", id: "123", pmid: "123", title: "Molecular hydrogen therapy" }] },
    }),
  });

  assert.equal(result.records[0].pmid, "123");
  assert.equal(result.queries[0].retrievedCount, 1);
  assert.equal(result.queries[0].reportedResultCount, 4);
});

test("Crossref removes mailto from the stored request URL", async () => {
  const result = await collectCrossref({
    endpoint: "https://api.crossref.org/v1/works",
    queries: [{ key: "q1", query: "molecular hydrogen" }],
  }, {
    ...options,
    fetchImpl: async () => response({
      message: {
        "total-results": 2,
        items: [{ DOI: "10.1000/test", title: ["Molecular hydrogen therapy"] }],
      },
    }),
  });

  assert.equal(result.records[0].doi, "10.1000/test");
  assert.doesNotMatch(result.queries[0].requestUrl, /mailto|contact/u);
});
