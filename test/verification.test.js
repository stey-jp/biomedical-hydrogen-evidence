import test from "node:test";
import assert from "node:assert/strict";
import { determineVerificationStatus } from "../src/verification/status.js";

test("agreement with provenance is machine_checked, never human_verified", () => {
  assert.equal(determineVerificationStatus({
    extractionCount: 3,
    hasProvenance: true,
    consensusStatus: "agreement",
  }), "machine_checked");
});

test("disagreement and missing provenance require human review", () => {
  assert.equal(determineVerificationStatus({
    extractionCount: 3,
    hasProvenance: true,
    consensusStatus: "needs_human_review",
  }), "needs_human_review");
  assert.equal(determineVerificationStatus({ extractionCount: 1 }), "needs_human_review");
});

test("only an explicit human result can produce human_verified", () => {
  assert.equal(determineVerificationStatus({ humanReview: "human_verified" }), "human_verified");
});

