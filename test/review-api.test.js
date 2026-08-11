import test from "node:test";
import assert from "node:assert/strict";
import {
  createReviewSession,
  reviewSessionCookie,
  verifyAdminToken,
  verifyReviewSession,
} from "../src/review/auth.js";
import {
  buildReviewProgressStatement,
  buildReviewQueueStatement,
  createReviewRepository,
} from "../src/repositories/review.js";
import { handleReview } from "../src/routes/review.js";

const secret = "test-review-secret-that-is-longer-than-32-characters";
const now = Date.parse("2026-08-11T03:00:00.000Z");

const candidate = {
  internal_id: 1,
  candidate_key: "doi:10.1000/review",
  title: "Molecular hydrogen candidate",
  title_normalized: "molecular hydrogen candidate",
  doi: "10.1000/review",
  pmid: "12345",
  pmcid: null,
  publication_year: 2025,
  publication_date: "2025-01-02",
  journal: "Test Journal",
  publisher: "Test Publisher",
  authors_json: "[\"A. Author\"]",
  language: "en",
  source_url: "https://example.test/source",
  screening_hint: "likely_biomedical",
  screening_reasons_json: "[\"hydrogen-intervention-title:molecular hydrogen\"]",
  review_status: "pending",
  review_reason: null,
  reviewed_by: null,
  reviewed_at: null,
};

function request(path, init = {}) {
  return new Request(`https://example.test${path}`, init);
}

async function loginCookie(token = secret) {
  const response = await handleReview(request("/api/review/v1/session", {
    method: "POST",
    headers: { origin: "https://example.test", "content-type": "application/json" },
    body: JSON.stringify({ token }),
  }), { REVIEW_ADMIN_TOKEN: secret }, { now: () => now });
  return { response, cookie: response.headers.get("set-cookie")?.split(";", 1)[0] };
}

test("review session uses a signed, expiring HttpOnly cookie without retaining the admin token", async () => {
  assert.equal(await verifyAdminToken(secret, secret), true);
  assert.equal(await verifyAdminToken("incorrect-token", secret), false);

  const value = await createReviewSession(secret, now);
  const sourceRequest = request("/review");
  const cookie = reviewSessionCookie(value, sourceRequest);
  assert.match(cookie, /HttpOnly/u);
  assert.match(cookie, /SameSite=Strict/u);
  assert.match(cookie, /Secure/u);
  assert.doesNotMatch(cookie, new RegExp(secret, "u"));

  const authenticated = request("/api/review/v1/session", {
    headers: { cookie: cookie.split(";", 1)[0] },
  });
  assert.equal(await verifyReviewSession(authenticated, secret, now), true);
  assert.equal(await verifyReviewSession(authenticated, secret, now + (31 * 24 * 60 * 60 * 1000)), false);
});

test("review repository queue and progress statements stay bound and indexable", () => {
  const queue = buildReviewQueueStatement({ screeningHint: "likely_biomedical", limit: 20 });
  assert.match(queue.sql, /screening_hint = \? AND review_status = 'pending'/u);
  assert.match(queue.sql, /ORDER BY id/u);
  assert.deepEqual(queue.bindings, ["likely_biomedical", 20]);

  const progress = buildReviewProgressStatement("needs_review");
  assert.match(progress.sql, /GROUP BY review_status/u);
  assert.deepEqual(progress.bindings, ["needs_review"]);
});

test("review repository records the audit batch, immutable event, and candidate status together", async () => {
  const prepared = [];
  let batched;
  const db = {
    prepare(sql) {
      return {
        bind(...bindings) {
          const statement = { sql, bindings };
          prepared.push(statement);
          return statement;
        },
      };
    },
    async batch(statements) {
      batched = statements;
      return statements.map(() => ({ success: true }));
    },
  };
  const repository = createReviewRepository(db);
  await repository.recordDecision({
    candidateKey: candidate.candidate_key,
    decision: "include",
    reason: "Source checked.",
    reviewer: "reviewer-1",
    reviewedAt: "2026-08-11T03:00:00.000Z",
    batchPublicId: "REVIEW-WEB-TEST",
    sourceArtifactSha256: "a".repeat(64),
  });
  assert.equal(batched.length, 3);
  assert.match(prepared[0].sql, /INSERT INTO human_review_batches/u);
  assert.match(prepared[1].sql, /INSERT INTO candidate_review_events/u);
  assert.match(prepared[2].sql, /UPDATE study_candidates/u);
  assert.ok(prepared.every((statement) => !statement.sql.includes(candidate.candidate_key)));
});

test("review API authenticates, reads a bounded queue, and saves an audited decision", async () => {
  const recorded = [];
  const repository = {
    async getQueue(input) {
      assert.deepEqual(input, { screeningHint: "likely_biomedical", limit: 20 });
      return [candidate];
    },
    async getProgress() {
      return [{ review_status: "pending", count: 1 }];
    },
    async getCandidate(key) {
      return key === candidate.candidate_key ? candidate : null;
    },
    async getDuplicateSuggestions() { return []; },
    async findDuplicateTarget() { return null; },
    async recordDecision(value) { recorded.push(value); },
  };
  const { response: loginResponse, cookie } = await loginCookie();
  assert.equal(loginResponse.status, 200);
  assert.ok(cookie);

  const queueResponse = await handleReview(request("/api/review/v1/queue", {
    headers: { cookie },
  }), { REVIEW_ADMIN_TOKEN: secret }, { repository, now: () => now });
  const queueBody = await queueResponse.json();
  assert.equal(queueResponse.status, 200);
  assert.equal(queueResponse.headers.get("cache-control"), "no-store");
  assert.equal(queueBody.data[0].candidateKey, candidate.candidate_key);
  assert.deepEqual(queueBody.data[0].authors, ["A. Author"]);

  const decisionResponse = await handleReview(request("/api/review/v1/decisions", {
    method: "POST",
    headers: { cookie, origin: "https://example.test", "content-type": "application/json" },
    body: JSON.stringify({
      candidateKey: candidate.candidate_key,
      decision: "include",
      reason: "Source checked.",
      reviewer: "reviewer-1",
    }),
  }), { REVIEW_ADMIN_TOKEN: secret }, {
    repository,
    now: () => now,
    randomUUID: () => "12345678-abcd-4000-8000-123456789abc",
  });
  const decisionBody = await decisionResponse.json();
  assert.equal(decisionResponse.status, 200);
  assert.equal(decisionBody.previousStatus, "pending");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].sourceArtifactSha256.length, 64);
  assert.equal(recorded[0].batchPublicId, "REVIEW-WEB-20260811030000-12345678-abcd-4000-8000-123456789abc");
});

test("review API rejects unauthenticated, cross-origin, and invalid duplicate writes", async () => {
  const unauthenticated = await handleReview(request("/api/review/v1/queue"), {
    REVIEW_ADMIN_TOKEN: secret,
  }, { now: () => now });
  assert.equal(unauthenticated.status, 401);

  const { cookie } = await loginCookie();
  const repository = {
    async getCandidate() { return candidate; },
    async findDuplicateTarget() { return null; },
  };
  const crossOrigin = await handleReview(request("/api/review/v1/decisions", {
    method: "POST",
    headers: { cookie, origin: "https://evil.example", "content-type": "application/json" },
    body: "{}",
  }), { REVIEW_ADMIN_TOKEN: secret }, { repository, now: () => now });
  assert.equal(crossOrigin.status, 403);

  const invalidDuplicate = await handleReview(request("/api/review/v1/decisions", {
    method: "POST",
    headers: { cookie, origin: "https://example.test", "content-type": "application/json" },
    body: JSON.stringify({
      candidateKey: candidate.candidate_key,
      decision: "duplicate",
      duplicateOf: "pmid:999",
      reason: "Compared metadata.",
      reviewer: "reviewer-1",
    }),
  }), { REVIEW_ADMIN_TOKEN: secret }, { repository, now: () => now });
  assert.equal(invalidDuplicate.status, 400);
  assert.equal((await invalidDuplicate.json()).error.code, "invalid_duplicate");
});

test("review CSV export is authenticated, no-store, and neutralizes spreadsheet formulas", async () => {
  const { cookie } = await loginCookie();
  const repository = {
    async getCompletedReviews(hint) {
      assert.equal(hint, "likely_biomedical");
      return [{
        candidate_key: candidate.candidate_key,
        decision: "exclude",
        reason: "=unsafe spreadsheet formula",
        reviewer: "reviewer-1",
        reviewed_at: "2026-08-11T03:00:00.000Z",
        screening_hint: hint,
        title: candidate.title,
        doi: candidate.doi,
        pmid: candidate.pmid,
        pmcid: candidate.pmcid,
      }];
    },
  };
  const response = await handleReview(request("/api/review/v1/export?screeningHint=likely_biomedical", {
    headers: { cookie },
  }), { REVIEW_ADMIN_TOKEN: secret }, { repository, now: () => now });
  const csv = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-disposition"), /candidate-review\.likely_biomedical\.csv/u);
  assert.match(csv, /"'=unsafe spreadsheet formula"/u);
});
