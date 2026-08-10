PRAGMA foreign_keys = ON;

CREATE TABLE discovery_runs (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  protocol_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('generated', 'imported', 'failed')),
  sources_json TEXT NOT NULL,
  max_results_per_query INTEGER NOT NULL CHECK (max_results_per_query BETWEEN 1 AND 10000),
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  notes TEXT
);

CREATE INDEX idx_discovery_runs_started ON discovery_runs(started_at DESC, id DESC);

CREATE TABLE discovery_queries (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('pubmed', 'europepmc', 'crossref')),
  query_key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  query_text TEXT NOT NULL,
  request_url TEXT NOT NULL,
  reported_result_count INTEGER CHECK (reported_result_count >= 0),
  retrieved_count INTEGER NOT NULL CHECK (retrieved_count >= 0),
  executed_at TEXT NOT NULL,
  UNIQUE (run_id, source, query_key)
);

CREATE INDEX idx_discovery_queries_run_source ON discovery_queries(run_id, source);

CREATE TABLE study_candidates (
  id INTEGER PRIMARY KEY,
  candidate_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  title_normalized TEXT NOT NULL,
  doi TEXT UNIQUE,
  pmid TEXT UNIQUE,
  pmcid TEXT UNIQUE,
  publication_year INTEGER CHECK (publication_year IS NULL OR publication_year BETWEEN 1800 AND 2200),
  publication_date TEXT,
  journal TEXT,
  publisher TEXT,
  authors_json TEXT,
  language TEXT,
  source_url TEXT,
  screening_hint TEXT NOT NULL DEFAULT 'needs_review' CHECK (screening_hint IN ('likely_biomedical', 'likely_non_biomedical', 'needs_review')),
  screening_reasons_json TEXT NOT NULL DEFAULT '[]',
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'include', 'exclude', 'duplicate', 'needs_review')),
  review_reason TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  first_seen_run_id INTEGER NOT NULL REFERENCES discovery_runs(id) ON DELETE RESTRICT,
  last_seen_run_id INTEGER NOT NULL REFERENCES discovery_runs(id) ON DELETE RESTRICT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX idx_candidates_review_year ON study_candidates(review_status, publication_year DESC, id DESC);
CREATE INDEX idx_candidates_screening_review ON study_candidates(screening_hint, review_status, id);
CREATE INDEX idx_candidates_title_year ON study_candidates(title_normalized, publication_year);

CREATE TABLE candidate_sources (
  id INTEGER PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES study_candidates(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('pubmed', 'europepmc', 'crossref')),
  source_identifier TEXT NOT NULL,
  source_record_url TEXT NOT NULL,
  doi TEXT,
  pmid TEXT,
  pmcid TEXT,
  source_license TEXT,
  rights_status TEXT NOT NULL DEFAULT 'unknown' CHECK (rights_status IN ('cc_by', 'cc_by_nc', 'cc0', 'public_domain', 'restricted', 'unknown')),
  first_seen_run_id INTEGER NOT NULL REFERENCES discovery_runs(id) ON DELETE RESTRICT,
  last_seen_run_id INTEGER NOT NULL REFERENCES discovery_runs(id) ON DELETE RESTRICT,
  first_retrieved_at TEXT NOT NULL,
  last_retrieved_at TEXT NOT NULL,
  UNIQUE (source, source_identifier)
);

CREATE INDEX idx_candidate_sources_candidate ON candidate_sources(candidate_id, source);
CREATE INDEX idx_candidate_sources_doi ON candidate_sources(doi) WHERE doi IS NOT NULL;
CREATE INDEX idx_candidate_sources_pmid ON candidate_sources(pmid) WHERE pmid IS NOT NULL;

CREATE TABLE discovery_run_candidates (
  run_id INTEGER NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL REFERENCES study_candidates(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('pubmed', 'europepmc', 'crossref')),
  query_key TEXT NOT NULL,
  source_rank INTEGER NOT NULL CHECK (source_rank > 0),
  PRIMARY KEY (run_id, candidate_id, source, query_key)
);

CREATE INDEX idx_run_candidates_candidate ON discovery_run_candidates(candidate_id, run_id);
