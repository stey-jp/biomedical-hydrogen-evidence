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
import { ReviewTranslationError } from "../src/services/review-translations.js";

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
  journal_metric_type: "openalex_2yr_mean_citedness",
  journal_metric_value: 3.75,
  journal_metric_year: 2025,
  journal_metric_source: "openalex",
  journal_metric_source_url: "https://openalex.org/S123",
  journal_metric_refreshed_at: "2026-08-11T00:00:00Z",
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

  const remoteHttpCookie = reviewSessionCookie(value, new Request("http://example.test/review"));
  const localHttpCookie = reviewSessionCookie(value, new Request("http://localhost:8787/review"));
  assert.match(remoteHttpCookie, /Secure/u);
  assert.doesNotMatch(localHttpCookie, /Secure/u);

  const authenticated = request("/api/review/v1/session", {
    headers: { cookie: cookie.split(";", 1)[0] },
  });
  assert.equal(await verifyReviewSession(authenticated, secret, now), true);
  assert.equal(await verifyReviewSession(authenticated, secret, now + (31 * 24 * 60 * 60 * 1000)), false);
});

test("review repository queue and progress statements stay bound and indexable", () => {
  const queue = buildReviewQueueStatement({ screeningHint: "likely_biomedical", limit: 20 });
  assert.match(queue.sql, /c\.screening_hint = \? AND c\.review_status = 'pending'/u);
  assert.match(queue.sql, /LEFT JOIN journal_metrics/u);
  assert.match(queue.sql, /ORDER BY c\.id/u);
  assert.deepEqual(queue.bindings, ["likely_biomedical", 20]);

  const progress = buildReviewProgressStatement("needs_review");
  assert.match(progress.sql, /GROUP BY review_status/u);
  assert.deepEqual(progress.bindings, ["needs_review"]);
});

test("review repository lists reviewers by latest completed review", async () => {
  const prepared = [];
  const db = {
    prepare(sql) {
      return {
        bind(...bindings) {
          prepared.push({ sql, bindings });
          return { async all() { return { results: [] }; } };
        },
      };
    },
  };
  await createReviewRepository(db).getReviewers();
  assert.equal(prepared.length, 1);
  assert.match(prepared[0].sql, /FROM candidate_review_events/u);
  assert.match(prepared[0].sql, /GROUP BY reviewer/u);
  assert.match(prepared[0].sql, /ORDER BY last_reviewed_at DESC/u);
  assert.deepEqual(prepared[0].bindings, [200]);
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

test("review repository scopes bookmarks by reviewer with bound statements", async () => {
  const prepared = [];
  const db = {
    prepare(sql) {
      return {
        bind(...bindings) {
          prepared.push({ sql, bindings });
          return {
            async all() { return { results: [] }; },
            async run() { return { success: true }; },
          };
        },
      };
    },
  };
  const repository = createReviewRepository(db);
  await repository.getBookmarks("reviewer-1");
  await repository.getBookmarksForExport("reviewer-1");
  await repository.setBookmark({
    candidateKey: candidate.candidate_key,
    reviewer: "reviewer-1",
    bookmarked: true,
    createdAt: "2026-08-11T05:00:00.000Z",
  });
  await repository.setBookmark({
    candidateKey: candidate.candidate_key,
    reviewer: "reviewer-1",
    bookmarked: false,
    createdAt: "2026-08-11T05:00:00.000Z",
  });
  assert.equal(prepared.length, 4);
  assert.match(prepared[0].sql, /WHERE b\.reviewer = \?/u);
  assert.deepEqual(prepared[0].bindings, ["reviewer-1", 500]);
  assert.match(prepared[2].sql, /ON CONFLICT\(reviewer, candidate_id\)/u);
  assert.deepEqual(prepared[2].bindings, ["reviewer-1", "2026-08-11T05:00:00.000Z", candidate.candidate_key]);
  assert.match(prepared[3].sql, /DELETE FROM candidate_review_bookmarks/u);
  assert.ok(prepared.every((statement) => !statement.sql.includes("reviewer-1")));
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
    async getReviewers() {
      return [{ reviewer: "reviewer-1", review_count: 3, last_reviewed_at: "2026-08-11T03:00:00.000Z" }];
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
  assert.deepEqual(queueBody.data[0].journalMetric, {
    type: "openalex_2yr_mean_citedness",
    value: 3.75,
    year: 2025,
    source: "openalex",
    sourceUrl: "https://openalex.org/S123",
    refreshedAt: "2026-08-11T00:00:00Z",
  });

  const reviewersResponse = await handleReview(request("/api/review/v1/reviewers", {
    headers: { cookie },
  }), { REVIEW_ADMIN_TOKEN: secret }, { repository, now: () => now });
  const reviewersBody = await reviewersResponse.json();
  assert.equal(reviewersResponse.status, 200);
  assert.deepEqual(reviewersBody.data, [{
    reviewer: "reviewer-1",
    reviewCount: 3,
    lastReviewedAt: "2026-08-11T03:00:00.000Z",
  }]);

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

test("review translation API is authenticated, same-origin, and returns aligned data", async () => {
  const { cookie } = await loginCookie();
  const calls = [];
  const translationService = {
    async translateTitles(candidateKeys) {
      calls.push(["titles", candidateKeys]);
      return candidateKeys.map((candidateKey) => ({
        candidateKey,
        translatedText: "分子状水素候補",
        cached: false,
        provider: "deepl",
      }));
    },
    async translateAbstract(candidateKey) {
      calls.push(["abstract", candidateKey]);
      return {
        source: "Europe PMC",
        provider: "DeepL API Free",
        sentences: [{ source: "Source.", translation: "原文。" }],
      };
    },
  };
  const headers = { cookie, origin: "https://example.test", "content-type": "application/json" };
  const titles = await handleReview(request("/api/review/v1/translations/titles", {
    method: "POST",
    headers,
    body: JSON.stringify({ candidateKeys: [candidate.candidate_key] }),
  }), { REVIEW_ADMIN_TOKEN: secret }, { translationService, now: () => now });
  assert.equal(titles.status, 200);
  assert.equal((await titles.json()).data[0].translatedText, "分子状水素候補");

  const abstract = await handleReview(request("/api/review/v1/translations/abstract", {
    method: "POST",
    headers,
    body: JSON.stringify({ candidateKey: candidate.candidate_key }),
  }), { REVIEW_ADMIN_TOKEN: secret }, { translationService, now: () => now });
  assert.equal(abstract.status, 200);
  assert.equal((await abstract.json()).data.sentences[0].source, "Source.");
  assert.deepEqual(calls, [
    ["titles", [candidate.candidate_key]],
    ["abstract", candidate.candidate_key],
  ]);

  const crossOrigin = await handleReview(request("/api/review/v1/translations/titles", {
    method: "POST",
    headers: { ...headers, origin: "https://evil.example" },
    body: JSON.stringify({ candidateKeys: [candidate.candidate_key] }),
  }), { REVIEW_ADMIN_TOKEN: secret }, { translationService, now: () => now });
  assert.equal(crossOrigin.status, 403);
});

test("review translation API returns a stable code when DeepL is unavailable", async () => {
  const { cookie } = await loginCookie();
  const translationService = {
    async translateTitles() {
      throw new ReviewTranslationError("DeepL API key is not configured.", 503, "translation_disabled");
    },
  };
  const response = await handleReview(request("/api/review/v1/translations/titles", {
    method: "POST",
    headers: { cookie, origin: "https://example.test", "content-type": "application/json" },
    body: JSON.stringify({ candidateKeys: [candidate.candidate_key] }),
  }), { REVIEW_ADMIN_TOKEN: secret }, { translationService, now: () => now });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "translation_disabled");
});

test("review bookmark API saves, lists, and exports reviewer-scoped candidates", async () => {
  const { cookie } = await loginCookie();
  const saved = [];
  const bookmarkedAt = "2026-08-11T05:00:00.000Z";
  const repository = {
    async getCandidate(key) { return key === candidate.candidate_key ? candidate : null; },
    async getBookmarks(reviewer) {
      assert.equal(reviewer, "reviewer-1");
      return [{ ...candidate, bookmarked_at: bookmarkedAt }];
    },
    async getBookmarksForExport(reviewer) {
      assert.equal(reviewer, "reviewer-1");
      return [{
        bookmarked_at: bookmarkedAt,
        reviewer,
        candidate_key: candidate.candidate_key,
        review_status: "pending",
        screening_hint: candidate.screening_hint,
        title: "=unsafe title",
        publication_year: candidate.publication_year,
        journal: candidate.journal,
        doi: candidate.doi,
        pmid: candidate.pmid,
        pmcid: candidate.pmcid,
        source_url: candidate.source_url,
      }];
    },
    async setBookmark(value) { saved.push(value); },
  };
  const list = await handleReview(request("/api/review/v1/bookmarks?reviewer=reviewer-1", {
    headers: { cookie },
  }), { REVIEW_ADMIN_TOKEN: secret }, { repository, now: () => now });
  const listBody = await list.json();
  assert.equal(list.status, 200);
  assert.equal(listBody.data[0].candidateKey, candidate.candidate_key);
  assert.equal(listBody.data[0].bookmarkedAt, bookmarkedAt);

  const save = await handleReview(request("/api/review/v1/bookmarks", {
    method: "POST",
    headers: { cookie, origin: "https://example.test", "content-type": "application/json" },
    body: JSON.stringify({
      candidateKey: candidate.candidate_key,
      reviewer: "reviewer-1",
      bookmarked: true,
    }),
  }), { REVIEW_ADMIN_TOKEN: secret }, { repository, now: () => Date.parse(bookmarkedAt) });
  assert.equal(save.status, 200);
  assert.equal((await save.json()).bookmarked, true);
  assert.deepEqual(saved, [{
    candidateKey: candidate.candidate_key,
    reviewer: "reviewer-1",
    bookmarked: true,
    createdAt: bookmarkedAt,
  }]);

  const exported = await handleReview(request("/api/review/v1/bookmarks/export?reviewer=reviewer-1", {
    headers: { cookie },
  }), { REVIEW_ADMIN_TOKEN: secret }, { repository, now: () => now });
  const csv = await exported.text();
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("content-disposition"), /candidate-bookmarks\.csv/u);
  assert.match(csv, /"'=unsafe title"/u);
  assert.match(csv, /"bookmarked_at","reviewer","candidate_key"/u);
});

test("review bookmark writes reject cross-origin requests", async () => {
  const { cookie } = await loginCookie();
  const response = await handleReview(request("/api/review/v1/bookmarks", {
    method: "POST",
    headers: { cookie, origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({
      candidateKey: candidate.candidate_key,
      reviewer: "reviewer-1",
      bookmarked: true,
    }),
  }), { REVIEW_ADMIN_TOKEN: secret }, { repository: {}, now: () => now });
  assert.equal(response.status, 403);
});
