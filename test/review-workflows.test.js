import test from "node:test";
import assert from "node:assert/strict";
import { generateCandidateReviewSql } from "../scripts/review/candidate-sql.mjs";
import { encodeCsv, parseCsv } from "../scripts/review/csv.mjs";
import { generateFieldReviewSql } from "../scripts/review/field-sql.mjs";

test("review CSV round-trips commas, quotes, and line breaks", () => {
  const columns = ["candidate_key", "reason"];
  const rows = [{ candidate_key: "doi:10.1/test", reason: "Checked, with \"source\"\nline two" }];
  assert.deepEqual(parseCsv(encodeCsv(rows, columns)), rows);
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
