export function createRateLimiter(binding) {
  return {
    async check(key) {
      if (!binding || typeof binding.limit !== "function") {
        return { allowed: true, source: "local-fallback" };
      }
      const result = await binding.limit({ key });
      return { allowed: Boolean(result.success), source: "cloudflare-binding" };
    },
  };
}

function opaqueKey(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function rateLimitKey(request, scope) {
  const authorization = request.headers.get("authorization");
  if (authorization) return `${scope}:auth:${opaqueKey(authorization)}`;
  const client = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip")
    ?? "local";
  return `${scope}:anonymous:${client}`;
}

export function rateLimitedResponse(request, scope) {
  return new Response(JSON.stringify({
    error: {
      code: "rate_limit_exceeded",
      message: `Too many ${scope} requests. Retry after 60 seconds.`,
    },
  }), {
    status: 429,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "60",
      "x-content-type-options": "nosniff",
    },
  });
}
