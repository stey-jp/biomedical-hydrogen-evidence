import { handleApi } from "./routes/api.js";
import { handleMcp } from "./routes/mcp.js";
import { handleReview } from "./routes/review.js";
import { createOpenAlexClient } from "./journal-metrics/openalex.js";
import { createReviewRepository } from "./repositories/review.js";
import { refreshJournalMetrics } from "./services/journal-metrics.js";
import { createStudyService } from "./services/studies.js";
import {
  createRateLimiter,
  rateLimitKey,
  rateLimitedResponse,
} from "./utils/rate-limit.js";
import { errorResponse, jsonResponse } from "./utils/responses.js";

const PUBLIC_DOCUMENT_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; connect-src 'self'; img-src 'self' data:";
const REVIEW_DOCUMENT_CSP = "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; connect-src 'self'; img-src 'self' data:";

function localDevelopmentHost(hostname) {
  return hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "127.0.0.1"
    || hostname === "[::1]";
}

function httpsRedirect(request) {
  const url = new URL(request.url);
  if (url.protocol !== "http:" || localDevelopmentHost(url.hostname)) return null;
  url.protocol = "https:";
  return new Response(null, {
    status: 308,
    headers: {
      location: url.toString(),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function securedDocument(response, contentSecurityPolicy, cacheControl) {
  const headers = new Headers(response.headers);
  if (cacheControl) headers.set("cache-control", cacheControl);
  headers.set("content-security-policy", contentSecurityPolicy);
  headers.set("strict-transport-security", "max-age=31536000");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-resource-policy", "same-origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function enforceRateLimit(request, binding, scope) {
  const limiter = createRateLimiter(binding);
  const result = await limiter.check(rateLimitKey(request, scope));
  return result.allowed ? null : rateLimitedResponse(request, scope);
}

async function health(request, env) {
  try {
    const result = await env.DB.prepare("SELECT 1 AS ok").first();
    if (result?.ok !== 1) throw new Error("D1 check returned an unexpected result");
    return jsonResponse(request, {
      status: "ok",
      database: "reachable",
      queryTimeAi: false,
    }, { cacheControl: "no-store" });
  } catch {
    return errorResponse(request, 503, "unhealthy", "The database health check failed.");
  }
}

async function reviewPage(request, env) {
  if (!env.ASSETS?.fetch) return errorResponse(request, 503, "assets_unavailable", "Review UI is unavailable.");
  const assetUrl = new URL("/review", request.url);
  const response = await env.ASSETS.fetch(new Request(assetUrl, request));
  return securedDocument(response, REVIEW_DOCUMENT_CSP, "no-store");
}

async function publicPage(request, env) {
  if (!env.ASSETS?.fetch) return errorResponse(request, 503, "assets_unavailable", "Web UI is unavailable.");
  return securedDocument(await env.ASSETS.fetch(request), PUBLIC_DOCUMENT_CSP);
}

export async function handleRequest(request, env, ctx = {}) {
  const url = new URL(request.url);

  const redirect = httpsRedirect(request);
  if (redirect) return redirect;

  if (url.pathname === "/healthz") return health(request, env);

  if (["/review", "/review/", "/review.html"].includes(url.pathname)) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return errorResponse(request, 405, "method_not_allowed", "Method not allowed.");
    }
    return reviewPage(request, env);
  }

  if (url.pathname.startsWith("/api/review/v1/")) {
    const limited = await enforceRateLimit(request, env.REVIEW_RATE_LIMITER, "review");
    if (limited) return limited;
    return handleReview(request, env, { executionContext: ctx });
  }

  if (url.pathname.startsWith("/api/v1/")) {
    const limited = await enforceRateLimit(request, env.API_RATE_LIMITER, "api");
    if (limited) return limited;
    return handleApi(request, createStudyService(env.DB));
  }

  if (url.pathname === "/mcp") {
    const limited = await enforceRateLimit(request, env.MCP_RATE_LIMITER, "mcp");
    if (limited) return limited;
    return handleMcp(request, env, ctx);
  }

  if ([
    "/", "/index.html", "/study", "/study.html",
    "/authors", "/authors.html", "/author", "/author.html",
  ].includes(url.pathname)) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return errorResponse(request, 405, "method_not_allowed", "Method not allowed.");
    }
    return publicPage(request, env);
  }

  return errorResponse(request, 404, "not_found", "Route not found.");
}

export async function handleScheduled(env, options = {}) {
  const result = await refreshJournalMetrics({
    repository: options.repository ?? createReviewRepository(env.DB),
    client: options.client ?? createOpenAlexClient({ apiKey: env.OPENALEX_API_KEY }),
    now: options.now ?? Date.now,
    waitImpl: options.waitImpl,
  });
  console.log("Journal metric refresh", JSON.stringify(result));
  return result;
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      console.error("Unhandled request error", error instanceof Error ? error.message : "unknown");
      return errorResponse(request, 500, "internal_error", "An unexpected error occurred.");
    }
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  },
};
