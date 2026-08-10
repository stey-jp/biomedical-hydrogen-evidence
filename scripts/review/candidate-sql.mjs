import { createHash } from "node:crypto";
import { sqlValue } from "../discovery/sql.mjs";

function jsonValue(value) {
  return sqlValue(JSON.stringify(value));
}

function candidateId(candidateKey) {
  return `(SELECT id FROM study_candidates WHERE candidate_key = ${sqlValue(candidateKey)})`;
}

function reviewBatchId(publicId) {
  return `(SELECT id FROM human_review_batches WHERE public_id = ${sqlValue(publicId)})`;
}

function studyPublicId(candidate) {
  const identity = candidate.doi ? `doi:${candidate.doi}` : candidate.pmid ? `pmid:${candidate.pmid}` : candidate.candidateKey;
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 20).toUpperCase();
  return `BHE-${digest}`;
}

function sourceFor(candidate) {
  return candidate.sources.find((source) => source.source === "pubmed") ?? candidate.sources[0];
}

function promotionSql(candidate, decision, batchPublicId, reviewedAt) {
  const publicId = studyPublicId(candidate);
  const source = sourceFor(candidate);
  const candidateLookup = candidateId(candidate.candidateKey);
  const lines = [
    `INSERT OR IGNORE INTO studies (public_id, title, doi, pmid, pmcid, journal, publication_year, publication_date, language, publisher, source_url, doi_url, pubmed_url, pmc_url, record_kind, verification_status, created_at, updated_at, source_candidate_id) VALUES (${sqlValue(publicId)}, ${sqlValue(candidate.title)}, ${sqlValue(candidate.doi)}, ${sqlValue(candidate.pmid)}, ${sqlValue(candidate.pmcid)}, ${sqlValue(candidate.journal)}, ${candidate.publicationYear}, ${sqlValue(candidate.publicationDate)}, ${sqlValue(candidate.language ?? "en")}, ${sqlValue(candidate.publisher)}, ${sqlValue(candidate.sourceRecordUrl)}, ${sqlValue(candidate.doi ? `https://doi.org/${candidate.doi}` : null)}, ${sqlValue(candidate.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${candidate.pmid}/` : null)}, ${sqlValue(candidate.pmcid ? `https://pmc.ncbi.nlm.nih.gov/articles/${candidate.pmcid}/` : null)}, 'published', 'unverified', ${sqlValue(reviewedAt)}, ${sqlValue(reviewedAt)}, ${candidateLookup});`,
    `INSERT OR IGNORE INTO classifications (study_id, biomedical_relevance, species_type, study_design, randomized, blinded, prospective, peer_reviewed) VALUES ((SELECT id FROM studies WHERE public_id = ${sqlValue(publicId)}), 1, 'other', 'unclassified', NULL, NULL, NULL, NULL);`,
  ];
  candidate.authors.forEach((author, index) => {
    lines.push(`INSERT INTO authors (display_name) SELECT ${sqlValue(author)} WHERE NOT EXISTS (SELECT 1 FROM authors WHERE display_name = ${sqlValue(author)});`);
    lines.push(`INSERT OR IGNORE INTO study_authors (study_id, author_id, author_order) VALUES ((SELECT id FROM studies WHERE public_id = ${sqlValue(publicId)}), (SELECT id FROM authors WHERE display_name = ${sqlValue(author)} ORDER BY id LIMIT 1), ${index + 1});`);
  });
  lines.push(`INSERT INTO evidence_provenance (study_id, field_name, source_document, source_type, section, locator, evidence_snippet, source_license, rights_status, created_at) SELECT (SELECT id FROM studies WHERE public_id = ${sqlValue(publicId)}), 'bibliography.title', ${sqlValue(source.sourceRecordUrl)}, 'metadata', 'title', 'source bibliographic title', ${sqlValue(candidate.title)}, ${sqlValue(source.sourceLicense)}, ${sqlValue(source.rightsStatus)}, ${sqlValue(reviewedAt)} WHERE NOT EXISTS (SELECT 1 FROM evidence_provenance WHERE study_id = (SELECT id FROM studies WHERE public_id = ${sqlValue(publicId)}) AND field_name = 'bibliography.title');`);
  lines.push(`INSERT OR REPLACE INTO study_search (rowid, title, condition_terms, outcome_terms, intervention_terms) VALUES ((SELECT id FROM studies WHERE public_id = ${sqlValue(publicId)}), ${sqlValue(candidate.title)}, '', '', 'molecular_hydrogen');`);
  lines.push(`INSERT INTO study_change_events (review_batch_id, study_id, change_type, changed_fields_json, reason, actor, changed_at) VALUES (${reviewBatchId(batchPublicId)}, (SELECT id FROM studies WHERE public_id = ${sqlValue(publicId)}), 'candidate_promotion', ${jsonValue(["bibliography", "classification", "search_document"])}, ${sqlValue(decision.reason)}, ${sqlValue(decision.reviewer)}, ${sqlValue(reviewedAt)});`);
  return lines;
}

export function generateCandidateReviewSql({ batch, decisions, candidates, promoteIncludes }) {
  const lines = [
    "PRAGMA foreign_keys = ON;",
    `INSERT INTO human_review_batches (public_id, review_type, source_artifact_sha256, reviewer, decision_count, created_at, notes) VALUES (${sqlValue(batch.publicId)}, 'candidate_screening', ${sqlValue(batch.sourceArtifactSha256)}, ${sqlValue(batch.reviewer)}, ${decisions.length}, ${sqlValue(batch.reviewedAt)}, ${sqlValue(promoteIncludes ? "Included candidates explicitly promoted to public unverified studies." : "Screening decisions only; no public promotion.")});`,
  ];
  for (const decision of decisions) {
    lines.push(`INSERT INTO candidate_review_events (review_batch_id, candidate_id, previous_status, decision, reason, reviewer, reviewed_at) VALUES (${reviewBatchId(batch.publicId)}, ${candidateId(decision.candidateKey)}, (SELECT review_status FROM study_candidates WHERE candidate_key = ${sqlValue(decision.candidateKey)}), ${sqlValue(decision.decision)}, ${sqlValue(decision.reason)}, ${sqlValue(decision.reviewer)}, ${sqlValue(batch.reviewedAt)});`);
    lines.push(`UPDATE study_candidates SET review_status = ${sqlValue(decision.decision)}, review_reason = ${sqlValue(decision.reason)}, reviewed_by = ${sqlValue(decision.reviewer)}, reviewed_at = ${sqlValue(batch.reviewedAt)} WHERE candidate_key = ${sqlValue(decision.candidateKey)};`);
    if (promoteIncludes && decision.decision === "include") {
      const candidate = candidates.find((item) => item.candidateKey === decision.candidateKey);
      lines.push(...promotionSql(candidate, decision, batch.publicId, batch.reviewedAt));
    }
  }
  lines.push("");
  return lines.join("\n");
}
