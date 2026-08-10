const HUMAN_RESULTS = new Set(["human_verified", "disputed"]);

export function determineVerificationStatus({
  extractionCount = 0,
  hasProvenance = false,
  consensusStatus = null,
  humanReview = null,
} = {}) {
  if (HUMAN_RESULTS.has(humanReview)) return humanReview;
  if (consensusStatus === "needs_human_review") return "needs_human_review";
  if (extractionCount > 0 && !hasProvenance) return "needs_human_review";
  if (consensusStatus === "agreement" && hasProvenance) return "machine_checked";
  if (extractionCount > 0) return "machine_extracted";
  return "unverified";
}

export const verificationStatuses = Object.freeze([
  "unverified",
  "machine_extracted",
  "machine_checked",
  "needs_human_review",
  "human_verified",
  "disputed",
]);

