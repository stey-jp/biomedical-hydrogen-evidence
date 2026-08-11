import test from "node:test";
import assert from "node:assert/strict";
import { generateCandidateReviewSql } from "../scripts/review/candidate-sql.mjs";
import {
  assertReviewRowsReady,
  buildCandidateReviewRows,
  chunkReviewRows,
  summarizeReviewRows,
} from "../scripts/review/candidate-batches.mjs";
import { encodeCsv, parseCsv } from "../scripts/review/csv.mjs";
import { generateFieldReviewSql } from "../scripts/review/field-sql.mjs";

test("review CSV round-trips commas, quotes, and line breaks", () => {
  const columns = ["candidate_key", "reason"];
  const rows = [{ candidate_key: "doi:10.1/test", reason: "Checked, with \"source\"\nline two" }];
  assert.deepEqual(parseCsv(encodeCsv(rows, columns)), rows);
});

test("candidate review batches filter and prioritize deterministically without making decisions", () => {
  const candidates = [
    {
      candidateKey: "pmid:2",
      title: "Single source",
      doi: null,
      pmid: "2",
      pmcid: null,
      publicationYear: 2026,
      screeningHint: "likely_biomedical",
      sources: [{ source: "pubmed", sourceRecordUrl: "https://example.test/2" }],
    },
    {
      candidateKey: "doi:10.1/older",
      title: "Multi source older",
      doi: "10.1/older",
      pmid: "1",
      pmcid: null,
      publicationYear: 2020,
      screeningHint: "likely_biomedical",
      sourceRecordUrl: "https://example.test/1",
      sources: [
        { source: "pubmed", sourceRecordUrl: "https://example.test/1" },
        { source: "crossref", sourceRecordUrl: "https://example.test/crossref/1" },
      ],
    },
    {
      candidateKey: "doi:10.1/excluded",
      title: "Different hint",
      doi: "10.1/excluded",
      publicationYear: 2025,
      screeningHint: "needs_review",
      sources: [{ source: "crossref", sourceRecordUrl: "not-a-url" }],
    },
  ];
  const rows = buildCandidateReviewRows(candidates, { screeningHint: "likely_biomedical" });
  assert.deepEqual(rows.map((row) => row.candidate_key), ["doi:10.1/older", "pmid:2"]);
  assert.ok(rows.every((row) => row.decision === "" && row.reason === "" && row.reviewer === ""));
  assert.deepEqual(chunkReviewRows(rows, 1).map((batch) => batch.length), [1, 1]);

  const quality = summarizeReviewRows(rows);
  assert.equal(quality.candidateCount, 2);
  assert.equal(quality.uniqueCandidateKeyCount, 2);
  assert.equal(quality.sourceCoverage.multipleSources.count, 1);
  assert.equal(quality.sourceCoverage.invalidSourceRecordUrlCount, 0);
  assert.equal(quality.blankDecisionCount, 2);
  assert.deepEqual(assertReviewRowsReady(rows), quality);
  assert.throws(
    () => assertReviewRowsReady([{ ...rows[0], source_urls: "not-a-url" }]),
    /invalid source record URLs/u,
  );
});

test("candidate review SQL records immutable decisions without public promotion by default", () => {
  const sql = generateCandidateReviewSql({
    batch: {
      publicId: "REVIEW-TEST",
      sourceArtifactSha256: "a".repeat(64),
      reviewer: "reviewer-1",
      reviewedAt: "2026-08-11T00:00:00.000Z",
    },
    decisions: [{ candidateKey: "doi:10.1000/test", decision: "include", reason: "Scope checked", reviewer: "reviewer-1" }],
    candidates: [],
    promoteIncludes: false,
  });
  assert.match(sql, /candidate_review_events/u);
  assert.match(sql, /review_status = 'include'/u);
  assert.doesNotMatch(sql, /INSERT OR IGNORE INTO studies/u);
});

test("explicit candidate promotion creates an unverified public study and audit event", () => {
  const candidate = {
    candidateKey: "doi:10.1000/test",
    title: "Molecular hydrogen study",
    doi: "10.1000/test",
    pmid: "123",
    pmcid: null,
    journal: "Test Journal",
    publicationYear: 2025,
    publicationDate: "2025-01-01",
    language: "en",
    publisher: "Publisher",
    sourceRecordUrl: "https://pubmed.ncbi.nlm.nih.gov/123/",
    authors: ["A. Author"],
    sources: [{
      source: "pubmed",
      sourceRecordUrl: "https://pubmed.ncbi.nlm.nih.gov/123/",
      sourceLicense: "metadata rights unknown",
      rightsStatus: "unknown",
    }],
  };
  const sql = generateCandidateReviewSql({
    batch: {
      publicId: "REVIEW-TEST",
      sourceArtifactSha256: "a".repeat(64),
      reviewer: "reviewer-1",
      reviewedAt: "2026-08-11T00:00:00.000Z",
    },
    decisions: [{ candidateKey: candidate.candidateKey, decision: "include", reason: "Scope checked", reviewer: "reviewer-1" }],
    candidates: [candidate],
    promoteIncludes: true,
  });
  assert.match(sql, /INSERT OR IGNORE INTO studies/u);
  assert.match(sql, /'published', 'unverified'/u);
  assert.match(sql, /'candidate_promotion'/u);
  assert.match(sql, /source_candidate_id/u);
});

test("field review SQL preserves review history and can explicitly verify a study", () => {
  const sql = generateFieldReviewSql({
    batch: {
      publicId: "VERIFY-TEST",
      sourceArtifactSha256: "b".repeat(64),
      reviewer: "reviewer-2",
      reviewedAt: "2026-08-11T00:00:00.000Z",
    },
    extractionRunPublicId: "EXTR-TEST",
    decisions: [{
      publicId: "BHE-FIXTURE-0001",
      fieldName: "population.participant_count",
      decision: "human_verified",
      provenanceProvider: "openai",
      reviewer: "reviewer-2",
      note: "Checked against source.",
    }],
    studyDecisions: { "BHE-FIXTURE-0001": "human_verified" },
  });
  assert.match(sql, /field_verification_events/u);
  assert.match(sql, /extraction_provider = 'openai'/u);
  assert.match(sql, /status <> 'human_verified'/u);
  assert.match(sql, /ELSE 'human_verified'/u);
  assert.match(sql, /study_change_events/u);
});
