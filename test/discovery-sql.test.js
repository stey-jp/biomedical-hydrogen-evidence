import test from "node:test";
import assert from "node:assert/strict";
import { generateDiscoverySql, sqlValue } from "../scripts/discovery/sql.mjs";

test("SQL values escape quotes and reject non-finite numbers", () => {
  assert.equal(sqlValue("O'Brien"), "'O''Brien'");
  assert.equal(sqlValue(null), "NULL");
  assert.throws(() => sqlValue(Number.NaN), /Non-finite/u);
});

test("generated import SQL is D1-batch compatible, idempotent for candidates, and excludes raw abstracts", () => {
  const source = {
    source: "pubmed",
    sourceIdentifier: "123",
    sourceRecordUrl: "https://pubmed.ncbi.nlm.nih.gov/123/",
    doi: "10.1000/example",
    pmid: "123",
    pmcid: null,
    sourceLicense: "unknown",
    rightsStatus: "unknown",
    queryKey: "q1",
    rank: 1,
    retrievedAt: "2026-08-11T00:00:01.000Z",
    abstract: "SECRET ABSTRACT CONTENT",
  };
  const candidate = {
    candidateKey: "doi:10.1000/example",
    title: "O'Brien molecular hydrogen study",
    titleNormalized: "o brien molecular hydrogen study",
    doi: "10.1000/example",
    pmid: "123",
    pmcid: null,
    publicationYear: 2024,
    publicationDate: "2024-01-02",
    journal: "Journal",
    publisher: null,
    authors: ["A. Author"],
    language: "eng",
    sourceRecordUrl: source.sourceRecordUrl,
    screeningHint: "likely_biomedical",
    screeningReasons: ["positive-title:therap"],
    sources: [source],
  };
  const run = {
    publicId: "DISC-TEST",
    protocolVersion: "1.0.0",
    sources: ["pubmed"],
    maxResultsPerQuery: 1,
    startedAt: "2026-08-11T00:00:00.000Z",
    completedAt: "2026-08-11T00:00:02.000Z",
    notes: null,
  };
  const queries = [{
    source: "pubmed",
    queryKey: "q1",
    endpoint: "https://example.test",
    queryText: "molecular hydrogen",
    requestUrl: "https://example.test?q=hydrogen",
    reportedResultCount: 1,
    retrievedCount: 1,
    executedAt: run.startedAt,
  }];

  const sql = generateDiscoverySql({ run, candidates: [candidate], queries });
  assert.match(sql, /^PRAGMA foreign_keys = ON;\nINSERT/u);
  assert.match(sql, /ON CONFLICT DO UPDATE SET/u);
  assert.match(sql, /O''Brien/u);
  assert.doesNotMatch(sql, /SECRET ABSTRACT CONTENT/u);
  assert.doesNotMatch(sql, /\bBEGIN;|\bCOMMIT;/u);
  assert.match(sql, /;\n$/u);
});
