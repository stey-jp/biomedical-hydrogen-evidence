import test from "node:test";
import assert from "node:assert/strict";
import {
  getBiomedicalHydrogenStudy,
  searchBiomedicalHydrogenEvidence,
} from "../src/routes/mcp-tools.js";

test("MCP search delegates to the shared service with default limit 5", async () => {
  let received;
  const service = {
    async searchStudies(input) {
      received = input;
      return { data: [], pagination: {}, query: {} };
    },
  };
  const result = await searchBiomedicalHydrogenEvidence(service, { query: "水素吸入" });
  assert.equal(received.limit, 5);
  assert.match(result.scopeNotice, /excludes energy/u);
});

test("MCP detail returns study and provenance without an AI provider", async () => {
  const service = {
    async getStudy(publicId) { return { publicId }; },
    async getEvidence() { return { evidence: [{ fieldName: "title" }] }; },
  };
  const result = await getBiomedicalHydrogenStudy(service, { publicId: "BHE-FIXTURE-0001" });
  assert.equal(result.study.publicId, "BHE-FIXTURE-0001");
  assert.equal(result.provenance[0].fieldName, "title");
});

