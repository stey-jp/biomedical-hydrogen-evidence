import { sqlValue } from "../discovery/sql.mjs";

function jsonValue(value) {
  return sqlValue(JSON.stringify(value));
}

function runId(publicId) {
  return `(SELECT id FROM extraction_runs WHERE public_id = ${sqlValue(publicId)})`;
}

function studyId(publicId) {
  return `(SELECT id FROM studies WHERE public_id = ${sqlValue(publicId)})`;
}

function provenanceId(runPublicId, publicId, provider, fieldName) {
  return `(SELECT id FROM evidence_provenance WHERE study_id = ${studyId(publicId)} AND field_name = ${sqlValue(fieldName)} AND extraction_run_id = ${runId(runPublicId)} AND extraction_provider = ${sqlValue(provider)})`;
}

function fieldVerificationStatus(consensus) {
  if (!consensus.allEvidenceSourceAligned) return "needs_human_review";
  if (consensus.status === "agreement") return "machine_checked";
  if (consensus.status === "insufficient_data") return "machine_extracted";
  return "needs_human_review";
}

export function generateExtractionSql(result) {
  const { run } = result;
  const lines = [
    "PRAGMA foreign_keys = ON;",
    `INSERT INTO extraction_runs (public_id, status, extraction_schema_version, prompt_version, source_bundle_sha256, plan_sha256, providers_json, max_documents, max_requests, max_input_characters_per_document, max_output_tokens_per_request, request_count, input_token_count, output_token_count, started_at, completed_at, notes) VALUES (${sqlValue(run.publicId)}, ${sqlValue(run.status)}, ${sqlValue(run.extractionSchemaVersion)}, ${sqlValue(run.promptVersion)}, ${sqlValue(run.sourceBundleSha256)}, ${sqlValue(run.planSha256)}, ${jsonValue(run.providers)}, ${run.budget.maxDocuments}, ${run.budget.maxRequests}, ${run.budget.maxInputCharactersPerDocument}, ${run.budget.maxOutputTokensPerRequest}, ${run.requestCount}, ${run.inputTokenCount}, ${run.outputTokenCount}, ${sqlValue(run.startedAt)}, ${sqlValue(run.completedAt)}, 'Raw provider responses and source document content are not stored.');`,
  ];

  for (const document of result.documents) {
    lines.push(`INSERT INTO extraction_sources (extraction_run_id, study_id, source_document, source_type, section, content_sha256, content_character_count, source_license, rights_status, content_stored) VALUES (${runId(run.publicId)}, ${studyId(document.publicId)}, ${sqlValue(document.sourceDocument)}, ${sqlValue(document.sourceType)}, ${sqlValue(document.section)}, ${sqlValue(document.contentSha256)}, ${document.contentCharacterCount}, ${sqlValue(document.sourceLicense)}, ${sqlValue(document.rightsStatus)}, 0);`);
  }

  for (const call of result.calls) {
    lines.push(`INSERT INTO extraction_provider_calls (extraction_run_id, study_id, provider, model, model_version, request_sequence, request_fingerprint, status, external_request_id, input_character_count, input_token_count, output_token_count, error_code, started_at, completed_at) VALUES (${runId(run.publicId)}, ${studyId(call.publicId)}, ${sqlValue(call.provider)}, ${sqlValue(call.model)}, ${sqlValue(call.modelVersion)}, ${call.sequence}, ${sqlValue(call.requestFingerprint)}, ${sqlValue(call.status)}, ${sqlValue(call.externalRequestId)}, ${call.inputCharacterCount}, ${sqlValue(call.inputTokenCount)}, ${sqlValue(call.outputTokenCount)}, ${sqlValue(call.errorCode)}, ${sqlValue(call.startedAt)}, ${sqlValue(call.completedAt)});`);
    if (call.status !== "completed") continue;
    const source = result.documents.find((document) => document.publicId === call.publicId);
    for (const field of call.result.fields) {
      lines.push(`INSERT INTO evidence_provenance (study_id, field_name, source_document, source_type, section, page_number, locator, evidence_snippet, source_license, rights_status, created_at, extraction_run_id, extraction_provider) VALUES (${studyId(call.publicId)}, ${sqlValue(field.fieldName)}, ${sqlValue(source.sourceDocument)}, ${sqlValue(source.sourceType)}, ${sqlValue(field.section)}, ${sqlValue(field.pageNumber)}, ${sqlValue(field.locator)}, ${sqlValue(field.evidenceSnippet)}, ${sqlValue(source.sourceLicense)}, ${sqlValue(source.rightsStatus)}, ${sqlValue(call.completedAt)}, ${runId(run.publicId)}, ${sqlValue(call.provider)}) ON CONFLICT(study_id, field_name, extraction_run_id, extraction_provider) WHERE extraction_run_id IS NOT NULL AND extraction_provider IS NOT NULL DO UPDATE SET section = excluded.section, page_number = excluded.page_number, locator = excluded.locator, evidence_snippet = excluded.evidence_snippet, source_license = excluded.source_license, rights_status = excluded.rights_status;`);
      const provenance = provenanceId(run.publicId, call.publicId, call.provider, field.fieldName);
      lines.push(`INSERT INTO extractions (study_id, provider, model, model_version, prompt_version, extraction_schema_version, field_name, extracted_value, normalized_value, confidence, provenance_id, extracted_at, extraction_run_id) VALUES (${studyId(call.publicId)}, ${sqlValue(call.provider)}, ${sqlValue(call.model)}, ${sqlValue(call.modelVersion)}, ${sqlValue(run.promptVersion)}, ${sqlValue(run.extractionSchemaVersion)}, ${sqlValue(field.fieldName)}, ${sqlValue(field.extractedValue)}, ${jsonValue(field.normalizedValue ?? field.extractedValue)}, ${sqlValue(field.confidence)}, ${provenance}, ${sqlValue(call.completedAt)}, ${runId(run.publicId)}) ON CONFLICT(study_id, provider, model, prompt_version, extraction_schema_version, field_name) DO UPDATE SET model_version = excluded.model_version, extracted_value = excluded.extracted_value, normalized_value = excluded.normalized_value, confidence = excluded.confidence, provenance_id = excluded.provenance_id, extracted_at = excluded.extracted_at, extraction_run_id = excluded.extraction_run_id;`);
      lines.push(`INSERT INTO evidence_checks (extraction_run_id, study_id, field_name, provider, provenance_id, snippet_found_in_source, locator_present, status, details_json, checked_at) VALUES (${runId(run.publicId)}, ${studyId(call.publicId)}, ${sqlValue(field.fieldName)}, ${sqlValue(call.provider)}, ${provenance}, ${field.evidenceCheck.snippetFoundInSource ? 1 : 0}, ${field.evidenceCheck.locatorPresent ? 1 : 0}, ${sqlValue(field.evidenceCheck.status)}, ${jsonValue(field.evidenceCheck.details)}, ${sqlValue(call.completedAt)});`);
    }
  }

  for (const consensus of result.consensus) {
    const details = {
      groups: consensus.groups,
      allEvidenceSourceAligned: consensus.allEvidenceSourceAligned,
      note: consensus.note,
    };
    lines.push(`INSERT INTO extraction_consensus (study_id, field_name, normalized_value, agreement_count, total_count, status, details_json, calculated_at) VALUES (${studyId(consensus.publicId)}, ${sqlValue(consensus.fieldName)}, ${jsonValue(consensus.normalizedValue)}, ${consensus.agreementCount}, ${consensus.totalCount}, ${sqlValue(consensus.status)}, ${jsonValue(details)}, ${sqlValue(run.completedAt)}) ON CONFLICT(study_id, field_name) DO UPDATE SET normalized_value = excluded.normalized_value, agreement_count = excluded.agreement_count, total_count = excluded.total_count, status = excluded.status, details_json = excluded.details_json, calculated_at = excluded.calculated_at;`);
    lines.push(`INSERT INTO consensus_history (extraction_run_id, study_id, field_name, normalized_value, agreement_count, total_count, status, details_json, calculated_at) VALUES (${runId(run.publicId)}, ${studyId(consensus.publicId)}, ${sqlValue(consensus.fieldName)}, ${jsonValue(consensus.normalizedValue)}, ${consensus.agreementCount}, ${consensus.totalCount}, ${sqlValue(consensus.status)}, ${jsonValue(details)}, ${sqlValue(run.completedAt)});`);
    const verificationStatus = fieldVerificationStatus(consensus);
    lines.push(`INSERT INTO field_verifications (study_id, field_name, status, provenance_id, reviewer, note, verified_at) VALUES (${studyId(consensus.publicId)}, ${sqlValue(consensus.fieldName)}, ${sqlValue(verificationStatus)}, (SELECT provenance_id FROM extractions WHERE study_id = ${studyId(consensus.publicId)} AND field_name = ${sqlValue(consensus.fieldName)} AND extraction_run_id = ${runId(run.publicId)} ORDER BY id LIMIT 1), NULL, 'Machine status only; model agreement and source alignment are not human verification.', ${sqlValue(run.completedAt)}) ON CONFLICT(study_id, field_name) DO UPDATE SET status = CASE WHEN field_verifications.status IN ('human_verified', 'disputed') THEN field_verifications.status ELSE excluded.status END, provenance_id = CASE WHEN field_verifications.status IN ('human_verified', 'disputed') THEN field_verifications.provenance_id ELSE excluded.provenance_id END, note = CASE WHEN field_verifications.status IN ('human_verified', 'disputed') THEN field_verifications.note ELSE excluded.note END, verified_at = CASE WHEN field_verifications.status IN ('human_verified', 'disputed') THEN field_verifications.verified_at ELSE excluded.verified_at END;`);
  }

  const publicIds = [...new Set(result.documents.map((document) => document.publicId))];
  for (const publicId of publicIds) {
    lines.push(`UPDATE studies SET verification_status = CASE WHEN verification_status IN ('human_verified', 'disputed') THEN verification_status WHEN EXISTS (SELECT 1 FROM field_verifications WHERE study_id = studies.id AND status = 'needs_human_review') THEN 'needs_human_review' WHEN EXISTS (SELECT 1 FROM field_verifications WHERE study_id = studies.id AND status = 'machine_checked') THEN 'machine_checked' WHEN EXISTS (SELECT 1 FROM field_verifications WHERE study_id = studies.id AND status = 'machine_extracted') THEN 'machine_extracted' ELSE verification_status END, updated_at = ${sqlValue(run.completedAt)} WHERE public_id = ${sqlValue(publicId)};`);
  }
  lines.push("");
  return lines.join("\n");
}
