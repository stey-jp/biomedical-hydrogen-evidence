import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/index.js";
import { handleApi } from "../src/routes/api.js";

const service = {
  async searchStudies(input) { return { data: [{ publicId: "fixture" }], pagination: {}, query: input }; },
  async getStudy(publicId) { return { publicId }; },
  async getEvidence(publicId) { return { publicId, evidence: [] }; },
  async getFilters() { return { speciesTypes: ["human"] }; },
  async listAuthors(input) { return { data: [{ publicId: "BHE-AUTHOR-1" }], query: input.query ?? "" }; },
  async getAuthor(publicId) { return { publicId, name: "Synthetic Author" }; },
};

test("API search is read-only and does not emit wildcard CORS", async () => {
  const request = new Request("https://example.test/api/v1/search?query=H2&limit=5");
  const response = await handleApi(request, service);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("x-api-purpose"), "first-party-read-only");
  assert.equal(body.data[0].publicId, "fixture");
});

test("API rejects write methods", async () => {
  const request = new Request("https://example.test/api/v1/studies", { method: "POST" });
  const response = await handleApi(request, service);
  assert.equal(response.status, 405);
  assert.equal((await response.json()).error.code, "method_not_allowed");
});

test("review page CSP permits the Google Material Symbols stylesheet and font only", async () => {
  const response = await handleRequest(new Request("https://example.test/review"), {
    ASSETS: { async fetch() { return new Response("<!doctype html>", { headers: { "content-type": "text/html" } }); } },
  });
  const policy = response.headers.get("content-security-policy");
  assert.match(policy, /style-src 'self' https:\/\/fonts\.googleapis\.com/u);
  assert.match(policy, /font-src 'self' https:\/\/fonts\.gstatic\.com/u);
  assert.doesNotMatch(policy, /\*/u);
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000");
  assert.equal(response.headers.get("permissions-policy"), "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
});

test("review HTML aliases share the protected no-store response", async () => {
  const response = await handleRequest(new Request("https://example.test/review.html"), {
    ASSETS: { async fetch() { return new Response("<!doctype html>"); } },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-security-policy"), /fonts\.googleapis\.com/u);
});

test("public HTML receives restrictive security headers", async () => {
  const response = await handleRequest(new Request("https://example.test/"), {
    ASSETS: { async fetch() { return new Response("<!doctype html>", { headers: { "content-type": "text/html" } }); } },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/u);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000");
});

test("production HTTP requests redirect to HTTPS while localhost remains usable", async () => {
  const production = await handleRequest(new Request("http://example.test/review?queue=pending"), {});
  assert.equal(production.status, 308);
  assert.equal(production.headers.get("location"), "https://example.test/review?queue=pending");

  const local = await handleRequest(new Request("http://localhost:8787/"), {
    ASSETS: { async fetch() { return new Response("<!doctype html>"); } },
  });
  assert.equal(local.status, 200);
});

test("study and evidence routes use stable public IDs", async () => {
  const studyResponse = await handleApi(new Request("https://example.test/api/v1/studies/BHE-FIXTURE-0001"), service);
  const evidenceResponse = await handleApi(new Request("https://example.test/api/v1/studies/BHE-FIXTURE-0001/evidence"), service);
  assert.equal((await studyResponse.json()).data.publicId, "BHE-FIXTURE-0001");
  assert.deepEqual((await evidenceResponse.json()).data.evidence, []);
});

test("author directory routes list and retrieve authors by stable IDs", async () => {
  const listResponse = await handleApi(new Request("https://example.test/api/v1/authors?query=Synthetic"), service);
  const detailResponse = await handleApi(new Request("https://example.test/api/v1/authors/BHE-AUTHOR-1"), service);
  assert.equal((await listResponse.json()).data[0].publicId, "BHE-AUTHOR-1");
  assert.equal((await detailResponse.json()).data.name, "Synthetic Author");
});
