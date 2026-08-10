import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter, rateLimitKey, rateLimitedResponse } from "../src/utils/rate-limit.js";

test("rate limiter adapter has a local allow fallback", async () => {
  assert.deepEqual(await createRateLimiter(undefined).check("test"), {
    allowed: true,
    source: "local-fallback",
  });
});

test("rate limiter adapter exposes binding rejection", async () => {
  const limiter = createRateLimiter({ async limit() { return { success: false }; } });
  assert.equal((await limiter.check("test")).allowed, false);
  const response = rateLimitedResponse(new Request("https://example.test"), "api");
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
});

test("anonymous rate-limit key is scoped", () => {
  const request = new Request("https://example.test", { headers: { "x-real-ip": "192.0.2.1" } });
  assert.equal(rateLimitKey(request, "mcp"), "mcp:anonymous:192.0.2.1");
});

test("authorization values are never placed directly in rate-limit keys", () => {
  const request = new Request("https://example.test", { headers: { authorization: "Bearer private-token" } });
  const key = rateLimitKey(request, "api");
  assert.match(key, /^api:auth:[a-f0-9]{8}$/u);
  assert.ok(!key.includes("private-token"));
});
