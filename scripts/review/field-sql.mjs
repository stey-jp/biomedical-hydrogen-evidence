import { sqlValue } from "../discovery/sql.mjs";

function jsonValue(value) {
  return sqlValue(JSON.stringify(value));
}

function batchId(publicId) {
  return `(SELECT id FROM human_review_batches WHERE public_id = ${sqlValue(publicId)})`;
}

function studyId(publicId) {
  return `(SELECT id FROM studies WHERE public_id = ${sqlValue(publicId)})`;
}

function provenanceId(extractionRunPublicId, decision) {
  if (!decision.provenanceProvider) return "NULL";
  return `(SELECT ep.id FROM evidence_provenance ep JOIN extraction_runs er ON er.id = ep.extraction_run_id WHERE er.public_id = ${sqlValue(extractionRunPublicId)} AND ep.study_id = ${studyId(decision.publicId)} AND ep.field_name = ${sqlValue(decision.fieldName)} AND ep.extraction_provider = ${sqlValue(decision.provenanceProvider)})`;
}

export function generateFieldReviewSql({ batch, extractionRunPublicId, decisions, studyDecisions }) {
  const lines = [
    "PRAGMA foreign_keys = ON;",
    `INSERT INTO human_review_batches (public_id, review_type, source_artifact_sha256, reviewer, decision_count, created_at, notes) VALUES (${sqlValue(batch.publicId)}, 'field_verification', ${sqlValue(batch.sourceArtifactSha256)}, ${sqlValue(batch.reviewer)}, ${decisions.length}, ${sqlValue(batch.reviewedAt)}, 'Human review of machine-extracted fields; immutable events retain prior status.');`,
  ];
  for (const decision of decisions) {
    const provenance = provenanceId(extractionRunPublicId, decision);
    const currentStatus = `COALESCE((SELECT status FROM field_verifications WHERE study_id = ${studyId(decision.publicId)} AND field_name = ${sqlValue(decision.fieldName)}), 'unverified')`;
    lines.push(`INSERT INTO field_verification_events (review_batch_id, study_id, field_name, previous_status, decision, provenance_id, reviewer, note, reviewed_at) VALUES (${batchId(batch.publicId)}, ${studyId(decision.publicId)}, ${sqlValue(decision.fieldName)}, ${currentStatus}, ${sqlValue(decision.decision)}, ${provenance}, ${sqlValue(decision.reviewer)}, ${sqlValue(decision.note)}, ${sqlValue(batch.reviewedAt)});`);
    lines.push(`INSERT INTO field_verifications (study_id, field_name, status, provenance_id, reviewer, note, verified_at) VALUES (${studyId(decision.publicId)}, ${sqlValue(decision.fieldName)}, ${sqlValue(decision.decision)}, ${provenance}, ${sqlValue(decision.reviewer)}, ${sqlValue(decision.note)}, ${sqlValue(batch.reviewedAt)}) ON CONFLICT(study_id, field_name) DO UPDATE SET status = excluded.status, provenance_id = excluded.provenance_id, reviewer = excluded.reviewer, note = excluded.note, verified_at = excluded.verified_at;`);
  }
  const publicIds = [...new Set(decisions.map((decision) => decision.publicId))];
  for (const publicId of publicIds) {
    const explicit = studyDecisions[publicId];
    if (explicit === "human_verified") {
      lines.push(`UPDATE studies SET verification_status = CASE WHEN EXISTS (SELECT 1 FROM field_verifications WHERE study_id = studies.id AND status <> 'human_verified') THEN 'needs_human_review' WHEN NOT EXISTS (SELECT 1 FROM field_verifications WHERE study_id = studies.id) THEN 'needs_human_review' ELSE 'human_verified' END, updated_at = ${sqlValue(batch.reviewedAt)} WHERE public_id = ${sqlValue(publicId)};`);
    } else if (explicit) {
      lines.push(`UPDATE studies SET verification_status = ${sqlValue(explicit)}, updated_at = ${sqlValue(batch.reviewedAt)} WHERE public_id = ${sqlValue(publicId)};`);
    } else {
      lines.push(`UPDATE studies SET verification_status = CASE WHEN EXISTS (SELECT 1 FROM field_verifications WHERE study_id = studies.id AND status = 'disputed') THEN 'disputed' ELSE 'needs_human_review' END, updated_at = ${sqlValue(batch.reviewedAt)} WHERE public_id = ${sqlValue(publicId)};`);
    }
    lines.push(`INSERT INTO study_change_events (review_batch_id, study_id, change_type, changed_fields_json, reason, actor, changed_at) VALUES (${batchId(batch.publicId)}, ${studyId(publicId)}, 'human_verification', ${jsonValue(decisions.filter((decision) => decision.publicId === publicId).map((decision) => decision.fieldName))}, 'Human field verification batch applied.', ${sqlValue(batch.reviewer)}, ${sqlValue(batch.reviewedAt)});`);
  }
  lines.push("");
  return lines.join("\n");
}
