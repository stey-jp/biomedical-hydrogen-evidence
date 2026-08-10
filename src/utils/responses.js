function weakEtag(body) {
  let hash = 2166136261;
  for (let index = 0; index < body.length; index += 1) {
    hash ^= body.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `W/"${(hash >>> 0).toString(16)}-${body.length}"`;
}

export function jsonResponse(request, value, init = {}) {
  const body = JSON.stringify(value);
  const etag = weakEtag(body);
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", init.cacheControl ?? "public, max-age=60, stale-while-revalidate=300");
  headers.set("etag", etag);
  headers.set("x-content-type-options", "nosniff");
  if (request?.headers.get("if-none-match") === etag && (init.status ?? 200) === 200) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { ...init, headers });
}

export function errorResponse(request, status, code, message, details) {
  return jsonResponse(request, {
    error: { code, message, ...(details ? { details } : {}) },
  }, {
    status,
    cacheControl: "no-store",
  });
}

