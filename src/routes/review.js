import {
  createReviewSession,
  expiredReviewSessionCookie,
  reviewSessionCookie,
  validReviewSecret,
  verifyAdminToken,
  verifyReviewSession,
} from "../review/auth.js";
import { createReviewRepository, reviewHints } from "../repositories/review.js";
import { errorResponse, jsonResponse } from "../utils/responses.js";

const decisions = new Set(["include", "exclude", "duplicate", "needs_review"]);
const textEncoder = new TextEncoder();

function securedJson(request, value, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  return jsonResponse(request, value, { ...init, headers, cacheControl: "no-store" });
}

function securedError(request, status, code, message, details) {
  const response = errorResponse(request, status, code, message, details);
  const headers = new Headers(response.headers);
  headers.set("referrer-policy", "no-referrer");
  return new Response(response.body, { status: response.status, headers });
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function reviewCsv(rows) {
  const columns = [
    "candidate_key", "decision", "reason", "reviewer", "reviewed_at",
    "screening_hint", "title", "doi", "pmid", "pmcid",
  ];
  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\r\n") + "\r\n";
}

function csvResponse(body, screeningHint) {
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="candidate-review.${screeningHint}.csv"`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

function sameOrigin(request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}

async function jsonBody(request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLocaleLowerCase("en-US").startsWith("application/json")) {
    throw new TypeError("content-type must be application/json");
  }
  const text = await request.text();
  if (textEncoder.encode(text).byteLength > 12_000) throw new RangeError("request body is too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new SyntaxError("request body must contain valid JSON");
  }
}

function cleanText(value, field, maxLength) {
  if (typeof value !== "string") throw new TypeError(`${field} is required`);
  const text = value.trim();
  if (!text || text.length > maxLength) throw new RangeError(`${field} must contain 1–${maxLength} characters`);
  return text;
}

function screeningHint(value) {
  return reviewHints.includes(value) ? value : "likely_biomedical";
}

function queueLimit(value) {
  const parsed = Number(value ?? 20);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 40 ? parsed : 20;
}

function parseJsonArray(value) {
  try {
    const result = JSON.parse(value ?? "[]");
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

function candidateView(row) {
  return {
    candidateKey: row.candidate_key,
    title: row.title,
    doi: row.doi,
    pmid: row.pmid,
    pmcid: row.pmcid,
    publicationYear: row.publication_year,
    publicationDate: row.publication_date,
    journal: row.journal,
    publisher: row.publisher,
    authors: parseJsonArray(row.authors_json),
    language: row.language,
    sourceUrl: row.source_url,
    screeningHint: row.screening_hint,
    screeningReasons: parseJsonArray(row.screening_reasons_json),
    reviewStatus: row.review_status,
    reviewReason: row.review_reason,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
  };
}

function progressView(rows) {
  const counts = Object.fromEntries([
    "pending", "include", "exclude", "duplicate", "needs_review",
  ].map((status) => [status, 0]));
  rows.forEach((row) => {
    if (row.review_status in counts) counts[row.review_status] = Number(row.count);
  });
  return { ...counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) };
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function snapshot(row) {
  return JSON.stringify({
    candidateKey: row.candidate_key,
    title: row.title,
    doi: row.doi,
    pmid: row.pmid,
    pmcid: row.pmcid,
    publicationYear: row.publication_year,
    publicationDate: row.publication_date,
    journal: row.journal,
    publisher: row.publisher,
    authors: parseJsonArray(row.authors_json),
    language: row.language,
    sourceUrl: row.source_url,
    screeningHint: row.screening_hint,
    screeningReasons: parseJsonArray(row.screening_reasons_json),
  });
}

async function login(request, secret, now) {
  if (!sameOrigin(request)) return securedError(request, 403, "invalid_origin", "Same-origin request required.");
  let body;
  try {
    body = await jsonBody(request);
  } catch (error) {
    return securedError(request, 400, "invalid_request", error.message);
  }
  if (!await verifyAdminToken(body.token, secret)) {
    return securedError(request, 401, "invalid_credentials", "管理トークンが正しくありません。");
  }
  const session = await createReviewSession(secret, now);
  return securedJson(request, { authenticated: true }, {
    headers: { "set-cookie": reviewSessionCookie(session, request) },
  });
}

async function saveDecision(request, repository, options) {
  if (!sameOrigin(request)) return securedError(request, 403, "invalid_origin", "Same-origin request required.");
  let body;
  try {
    body = await jsonBody(request);
    body.candidateKey = cleanText(body.candidateKey, "candidateKey", 240);
    body.reviewer = cleanText(body.reviewer, "reviewer", 200);
    body.reason = cleanText(body.reason, "reason", 2000);
    if (!decisions.has(body.decision)) throw new RangeError("decision is invalid");
  } catch (error) {
    return securedError(request, 400, "invalid_request", error.message);
  }

  const candidate = await repository.getCandidate(body.candidateKey);
  if (!candidate) return securedError(request, 404, "candidate_not_found", "Candidate not found.");

  if (body.decision === "duplicate") {
    try {
      body.duplicateOf = cleanText(body.duplicateOf, "duplicateOf", 240);
    } catch (error) {
      return securedError(request, 400, "invalid_request", error.message);
    }
    if (body.duplicateOf === body.candidateKey) {
      return securedError(request, 400, "invalid_duplicate", "A candidate cannot duplicate itself.");
    }
    const target = await repository.findDuplicateTarget(body.duplicateOf, body.candidateKey);
    if (!target) return securedError(request, 400, "invalid_duplicate", "Duplicate target was not found.");
    body.reason = `Duplicate of ${target.candidate_key}. ${body.reason}`;
    if (body.reason.length > 2000) {
      return securedError(request, 400, "invalid_request", "reason must contain 1–2000 characters");
    }
  }

  const reviewedAt = new Date(options.now()).toISOString();
  const timestamp = reviewedAt.replace(/[-:.TZ]/gu, "").slice(0, 14);
  const batchPublicId = `REVIEW-WEB-${timestamp}-${options.randomUUID()}`;
  await repository.recordDecision({
    candidateKey: body.candidateKey,
    decision: body.decision,
    reason: body.reason,
    reviewer: body.reviewer,
    reviewedAt,
    batchPublicId,
    sourceArtifactSha256: await sha256(snapshot(candidate)),
  });
  return securedJson(request, {
    saved: true,
    candidateKey: body.candidateKey,
    previousStatus: candidate.review_status,
    decision: body.decision,
    reviewedAt,
    reviewBatch: batchPublicId,
  });
}

export async function handleReview(request, env, options = {}) {
  const secret = env.REVIEW_ADMIN_TOKEN;
  if (!validReviewSecret(secret)) {
    return securedError(request, 503, "review_disabled", "Review access is not configured.");
  }
  const url = new URL(request.url);
  const now = options.now ?? Date.now;
  const repository = options.repository ?? createReviewRepository(env.DB);
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID());

  if (url.pathname === "/api/review/v1/session" && request.method === "POST") {
    return login(request, secret, now());
  }
  if (url.pathname === "/api/review/v1/session" && request.method === "DELETE") {
    if (!sameOrigin(request)) return securedError(request, 403, "invalid_origin", "Same-origin request required.");
    return securedJson(request, { authenticated: false }, {
      headers: { "set-cookie": expiredReviewSessionCookie(request) },
    });
  }

  if (!await verifyReviewSession(request, secret, now())) {
    return securedError(request, 401, "authentication_required", "Review login is required.");
  }
  if (url.pathname === "/api/review/v1/session" && request.method === "GET") {
    return securedJson(request, { authenticated: true });
  }
  if (url.pathname === "/api/review/v1/queue" && request.method === "GET") {
    const hint = screeningHint(url.searchParams.get("screeningHint"));
    const rows = await repository.getQueue({
      screeningHint: hint,
      limit: queueLimit(url.searchParams.get("limit")),
    });
    return securedJson(request, { data: rows.map(candidateView), screeningHint: hint });
  }
  if (url.pathname === "/api/review/v1/progress" && request.method === "GET") {
    const hint = screeningHint(url.searchParams.get("screeningHint"));
    return securedJson(request, {
      data: progressView(await repository.getProgress(hint)),
      screeningHint: hint,
    });
  }
  if (url.pathname === "/api/review/v1/export" && request.method === "GET") {
    const hint = screeningHint(url.searchParams.get("screeningHint"));
    return csvResponse(reviewCsv(await repository.getCompletedReviews(hint)), hint);
  }
  if (url.pathname === "/api/review/v1/duplicates" && request.method === "GET") {
    const candidateKey = url.searchParams.get("candidateKey")?.trim();
    if (!candidateKey || candidateKey.length > 240) {
      return securedError(request, 400, "invalid_request", "candidateKey is required.");
    }
    const query = url.searchParams.get("q")?.trim();
    const rows = query
      ? [await repository.findDuplicateTarget(query, candidateKey)].filter(Boolean)
      : await repository.getDuplicateSuggestions(candidateKey);
    return securedJson(request, { data: rows.map(candidateView) });
  }
  if (url.pathname === "/api/review/v1/decisions" && request.method === "POST") {
    return saveDecision(request, repository, { now, randomUUID });
  }
  return securedError(request, 404, "not_found", "Review route not found.");
}
