import test from "node:test";
import assert from "node:assert/strict";
import { profileDiscovery } from "../scripts/discovery/quality.mjs";

function source(overrides = {}) {
  return {
    source: "pubmed",
    sourceIdentifier: "1",
    sourceRecordUrl: "https://example.test/1",
    title: "Molecular hydrogen therapy",
    doi: "10.1000/example",
    pmid: "1",
    pmcid: null,
    publicationYear: 2024,
    ...overrides,
  };
}

test("quality profile reports grain, completeness, deduplication, and source coverage", () => {
  const pubmed = source();
  const crossref = source({ source: "crossref", sourceIdentifier: "10.1000/example", pmid: null });
  const candidates = [{
    ...pubmed,
    candidateKey: "doi:10.1000/example",
    screeningHint: "likely_biomedical",
    sources: [pubmed, crossref],
  }];
  const quality = profileDiscovery([pubmed, crossref], candidates, [{
    source: "pubmed",
    queryKey: "q1",
    reportedResultCount: 100,
    retrievedCount: 2,
  }], new Date("2026-08-11T00:00:00Z"));

  assert.equal(quality.rawRecordCount, 2);
  assert.equal(quality.candidateCount, 1);
  assert.equal(quality.deduplicationRate, 0.5);
  assert.equal(quality.identifierCompleteness.doi.rate, 1);
  assert.equal(quality.crossSourceCandidates.rate, 1);
  assert.equal(quality.queryRetrieval[0].retrievalRate, 0.02);
  assert.equal(quality.passedBlockingChecks, true);
});

test("invalid source records and post-merge duplicate identifiers block import", () => {
  const invalid = source({ sourceIdentifier: null });
  const candidates = [
    { ...source(), candidateKey: "a", screeningHint: "needs_review", sources: [] },
    { ...source({ sourceIdentifier: "2" }), candidateKey: "b", screeningHint: "needs_review", sources: [] },
  ];
  const quality = profileDiscovery([invalid], candidates, [], new Date("2026-08-11T00:00:00Z"));

  assert.equal(quality.checks.invalidRawRecords, 1);
  assert.equal(quality.checks.duplicateStrongIdentifiersAfterMerge.doi, 1);
  assert.equal(quality.passedBlockingChecks, false);
});
