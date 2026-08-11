import { handleApi } from "./routes/api.js";
import { handleMcp } from "./routes/mcp.js";
import { handleReview } from "./routes/review.js";
import { createStudyService } from "./services/studies.js";
import {
  createRateLimiter,
  rateLimitKey,
  rateLimitedResponse,
} from "./utils/rate-limit.js";
import { errorResponse, jsonResponse } from "./utils/responses.js";

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
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; connect-src 'self'; img-src 'self' data:");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  return new Response(response.body, { status: response.status, headers });
}

export async function handleRequest(request, env, ctx = {}) {
  const url = new URL(request.url);

  if (url.pathname === "/healthz") return health(request, env);

  if (url.pathname === "/review" || url.pathname === "/review/") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return errorResponse(request, 405, "method_not_allowed", "Method not allowed.");
    }
    return reviewPage(request, env);
  }

  if (url.pathname.startsWith("/api/review/v1/")) {
    const limited = await enforceRateLimit(request, env.REVIEW_RATE_LIMITER, "review");
    if (limited) return limited;
    return handleReview(request, env);
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

  return errorResponse(request, 404, "not_found", "Route not found.");
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
};
