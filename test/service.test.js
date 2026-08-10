import test from "node:test";
import assert from "node:assert/strict";
import { createStudyServiceFromRepository } from "../src/services/studies.js";

function fakeRepository(overrides = {}) {
  return {
    async search(input) { return { rows: [], nextCursor: null, input }; },
    async getByPublicId() { return null; },
    async getEvidence() { return null; },
    async getFilters() {
      return { speciesTypes: [], studyDesigns: [], administrationRoutes: [], conditions: [], years: {} };
    },
    ...overrides,
  };
}

test("shared search service normalizes Japanese query and structured aliases", async () => {
  let received;
  const service = createStudyServiceFromRepository(fakeRepository({
    async search(input) {
      received = input;
      return { rows: [], nextCursor: null };
    },
  }));
  const result = await service.searchStudies({
    query: "水素水のヒトRCT",
    studyDesign: "RCT",
    limit: 5,
  });
  assert.equal(received.ftsQuery, '"hydrogen_rich_water" AND "human" AND "randomized_controlled_trial"');
  assert.equal(received.studyDesign, "randomized_controlled_trial");
  assert.equal(result.query.normalized, "hydrogen_rich_water human randomized_controlled_trial");
});

test("evidence response separates provenance and verification fields", async () => {
  const service = createStudyServiceFromRepository(fakeRepository({
    async getEvidence() {
      return [{
        field_name: "population.participant_count",
        source_document: "fixture",
        source_type: "metadata",
        section: "methods",
        rights_status: "cc0",
        verification_status: "human_verified",
      }];
    },
  }));
  const result = await service.getEvidence("BHE-FIXTURE-0001");
  assert.equal(result.evidence[0].fieldName, "population.participant_count");
  assert.equal(result.evidence[0].verification.status, "human_verified");
});
