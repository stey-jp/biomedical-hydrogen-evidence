import test from "node:test";
import assert from "node:assert/strict";
import { handleApi } from "../src/routes/api.js";

const service = {
  async searchStudies(input) { return { data: [{ publicId: "fixture" }], pagination: {}, query: input }; },
  async getStudy(publicId) { return { publicId }; },
  async getEvidence(publicId) { return { publicId, evidence: [] }; },
  async getFilters() { return { speciesTypes: ["human"] }; },
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

test("study and evidence routes use stable public IDs", async () => {
  const studyResponse = await handleApi(new Request("https://example.test/api/v1/studies/BHE-FIXTURE-0001"), service);
  const evidenceResponse = await handleApi(new Request("https://example.test/api/v1/studies/BHE-FIXTURE-0001/evidence"), service);
  assert.equal((await studyResponse.json()).data.publicId, "BHE-FIXTURE-0001");
  assert.deepEqual((await evidenceResponse.json()).data.evidence, []);
});

