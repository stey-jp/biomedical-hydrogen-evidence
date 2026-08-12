import test from "node:test";
import assert from "node:assert/strict";
import { createStudyServiceFromRepository } from "../src/services/studies.js";

function fakeRepository(overrides = {}) {
  return {
    async search(input) { return { rows: [], nextCursor: null, input }; },
    async getByPublicId() { return null; },
    async getEvidence() { return null; },
    async listAuthors() { return []; },
    async getAuthorByPublicId() { return null; },
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
        reviewer: "private-reviewer-id",
      }];
    },
  }));
  const result = await service.getEvidence("BHE-FIXTURE-0001");
  assert.equal(result.evidence[0].fieldName, "population.participant_count");
  assert.equal(result.evidence[0].verification.status, "human_verified");
  assert.equal(Object.hasOwn(result.evidence[0].verification, "reviewer"), false);
});

test("public study detail omits reviewer identifiers from field verification", async () => {
  const service = createStudyServiceFromRepository(fakeRepository({
    async getByPublicId() {
      return {
        study: {
          public_id: "BHE-FIXTURE-0001",
          title: "Synthetic study",
          biomedical_relevance: 1,
          verification_status: "human_verified",
          record_kind: "fixture",
        },
        authors: [],
        interventions: [],
        numericValues: [],
        outcomes: [],
        safety: null,
        transparency: null,
        verifications: [{
          field_name: "population.participant_count",
          status: "human_verified",
          reviewer: "private-reviewer-id",
          note: "Source checked.",
          verified_at: "2026-08-11T00:00:00.000Z",
        }],
      };
    },
  }));
  const result = await service.getStudy("BHE-FIXTURE-0001");
  assert.equal(result.verification.fields[0].status, "human_verified");
  assert.equal(Object.hasOwn(result.verification.fields[0], "reviewer"), false);
});

test("author filter uses a stable author ID and summaries include author names", async () => {
  let received;
  const service = createStudyServiceFromRepository(fakeRepository({
    async search(input) {
      received = input;
      return {
        rows: [{
          public_id: "BHE-FIXTURE-0001",
          title: "Synthetic study",
          publication_year: 2024,
          administration_routes: "inhalation",
          author_names: "Synthetic Author A\u001fSynthetic Author B",
        }],
        nextCursor: null,
      };
    },
  }));
  const result = await service.searchStudies({ authorId: "BHE-AUTHOR-FIXTURE-0001" });
  assert.equal(received.authorId, "BHE-AUTHOR-FIXTURE-0001");
  assert.deepEqual(result.data[0].authors, ["Synthetic Author A", "Synthetic Author B"]);
});

test("author detail exposes only repository-approved public contacts with provenance", async () => {
  const service = createStudyServiceFromRepository(fakeRepository({
    async getAuthorByPublicId() {
      return {
        author: {
          public_id: "BHE-AUTHOR-FIXTURE-0001",
          display_name: "Synthetic Author A",
          orcid: "0000-0001-0000-0001",
        },
        affiliations: [{
          name: "Synthetic Institute",
          is_current: 1,
          verification_status: "human_verified",
          source_url: "https://example.test/affiliation",
        }],
        contacts: [{
          contact_type: "email",
          contact_value: "author@example.test",
          is_primary: 1,
          verification_status: "human_verified",
          source_url: "https://example.test/profile",
        }],
        studies: [],
      };
    },
  }));
  const result = await service.getAuthor("BHE-AUTHOR-FIXTURE-0001");
  assert.equal(result.contacts[0].value, "author@example.test");
  assert.equal(result.contacts[0].sourceUrl, "https://example.test/profile");
  assert.equal(Object.hasOwn(result.contacts[0], "isPublic"), false);
  assert.equal(result.affiliations[0].isCurrent, true);
});
