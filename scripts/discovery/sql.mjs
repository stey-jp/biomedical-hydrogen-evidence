function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite numbers cannot be written to SQL");
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function jsonValue(value) {
  return sqlValue(JSON.stringify(value));
}

function candidateLookup(candidate) {
  const predicates = [`candidate_key = ${sqlValue(candidate.candidateKey)}`];
  if (candidate.doi) predicates.push(`doi = ${sqlValue(candidate.doi)}`);
  if (candidate.pmid) predicates.push(`pmid = ${sqlValue(candidate.pmid)}`);
  if (candidate.pmcid) predicates.push(`pmcid = ${sqlValue(candidate.pmcid)}`);
  return `(SELECT id FROM study_candidates WHERE ${predicates.join(" OR ")} ORDER BY CASE WHEN candidate_key = ${sqlValue(candidate.candidateKey)} THEN 0 ELSE 1 END, id LIMIT 1)`;
}

export function generateDiscoverySql({ run, candidates, queries }) {
  const lines = [
    "PRAGMA foreign_keys = ON;",
    `INSERT INTO discovery_runs (public_id, protocol_version, status, sources_json, max_results_per_query, candidate_count, started_at, completed_at, notes) VALUES (${sqlValue(run.publicId)}, ${sqlValue(run.protocolVersion)}, 'imported', ${jsonValue(run.sources)}, ${sqlValue(run.maxResultsPerQuery)}, ${candidates.length}, ${sqlValue(run.startedAt)}, ${sqlValue(run.completedAt)}, ${sqlValue(run.notes)});`,
  ];

  for (const query of queries) {
    lines.push(`INSERT INTO discovery_queries (run_id, source, query_key, endpoint, query_text, request_url, reported_result_count, retrieved_count, executed_at) VALUES ((SELECT id FROM discovery_runs WHERE public_id = ${sqlValue(run.publicId)}), ${sqlValue(query.source)}, ${sqlValue(query.queryKey)}, ${sqlValue(query.endpoint)}, ${sqlValue(query.queryText)}, ${sqlValue(query.requestUrl)}, ${sqlValue(query.reportedResultCount)}, ${sqlValue(query.retrievedCount)}, ${sqlValue(query.executedAt)});`);
  }

  for (const candidate of candidates) {
    lines.push(`INSERT INTO study_candidates (candidate_key, title, title_normalized, doi, pmid, pmcid, publication_year, publication_date, journal, publisher, authors_json, language, source_url, screening_hint, screening_reasons_json, first_seen_run_id, last_seen_run_id, first_seen_at, last_seen_at) VALUES (${sqlValue(candidate.candidateKey)}, ${sqlValue(candidate.title)}, ${sqlValue(candidate.titleNormalized)}, ${sqlValue(candidate.doi)}, ${sqlValue(candidate.pmid)}, ${sqlValue(candidate.pmcid)}, ${sqlValue(candidate.publicationYear)}, ${sqlValue(candidate.publicationDate)}, ${sqlValue(candidate.journal)}, ${sqlValue(candidate.publisher)}, ${jsonValue(candidate.authors)}, ${sqlValue(candidate.language)}, ${sqlValue(candidate.sourceRecordUrl)}, ${sqlValue(candidate.screeningHint)}, ${jsonValue(candidate.screeningReasons)}, (SELECT id FROM discovery_runs WHERE public_id = ${sqlValue(run.publicId)}), (SELECT id FROM discovery_runs WHERE public_id = ${sqlValue(run.publicId)}), ${sqlValue(run.completedAt)}, ${sqlValue(run.completedAt)}) ON CONFLICT DO UPDATE SET title = excluded.title, title_normalized = excluded.title_normalized, doi = COALESCE(study_candidates.doi, excluded.doi), pmid = COALESCE(study_candidates.pmid, excluded.pmid), pmcid = COALESCE(study_candidates.pmcid, excluded.pmcid), publication_year = COALESCE(study_candidates.publication_year, excluded.publication_year), publication_date = COALESCE(study_candidates.publication_date, excluded.publication_date), journal = COALESCE(study_candidates.journal, excluded.journal), publisher = COALESCE(study_candidates.publisher, excluded.publisher), authors_json = excluded.authors_json, language = COALESCE(study_candidates.language, excluded.language), source_url = COALESCE(study_candidates.source_url, excluded.source_url), screening_hint = excluded.screening_hint, screening_reasons_json = excluded.screening_reasons_json, last_seen_run_id = excluded.last_seen_run_id, last_seen_at = excluded.last_seen_at;`);

    const lookup = candidateLookup(candidate);
    for (const source of candidate.sources) {
      lines.push(`INSERT INTO candidate_sources (candidate_id, source, source_identifier, source_record_url, doi, pmid, pmcid, source_license, rights_status, first_seen_run_id, last_seen_run_id, first_retrieved_at, last_retrieved_at) VALUES (${lookup}, ${sqlValue(source.source)}, ${sqlValue(source.sourceIdentifier)}, ${sqlValue(source.sourceRecordUrl)}, ${sqlValue(source.doi)}, ${sqlValue(source.pmid)}, ${sqlValue(source.pmcid)}, ${sqlValue(source.sourceLicense)}, ${sqlValue(source.rightsStatus)}, (SELECT id FROM discovery_runs WHERE public_id = ${sqlValue(run.publicId)}), (SELECT id FROM discovery_runs WHERE public_id = ${sqlValue(run.publicId)}), ${sqlValue(source.retrievedAt)}, ${sqlValue(source.retrievedAt)}) ON CONFLICT(source, source_identifier) DO UPDATE SET candidate_id = excluded.candidate_id, doi = COALESCE(candidate_sources.doi, excluded.doi), pmid = COALESCE(candidate_sources.pmid, excluded.pmid), pmcid = COALESCE(candidate_sources.pmcid, excluded.pmcid), source_license = COALESCE(candidate_sources.source_license, excluded.source_license), rights_status = CASE WHEN candidate_sources.rights_status = 'unknown' THEN excluded.rights_status ELSE candidate_sources.rights_status END, last_seen_run_id = excluded.last_seen_run_id, last_retrieved_at = excluded.last_retrieved_at;`);
      lines.push(`INSERT INTO discovery_run_candidates (run_id, candidate_id, source, query_key, source_rank) VALUES ((SELECT id FROM discovery_runs WHERE public_id = ${sqlValue(run.publicId)}), ${lookup}, ${sqlValue(source.source)}, ${sqlValue(source.queryKey)}, ${sqlValue(source.rank)}) ON CONFLICT(run_id, candidate_id, source, query_key) DO UPDATE SET source_rank = MIN(discovery_run_candidates.source_rank, excluded.source_rank);`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export { sqlValue };
