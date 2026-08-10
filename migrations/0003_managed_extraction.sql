PRAGMA foreign_keys = ON;

CREATE TABLE extraction_runs (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('planned', 'approved', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  extraction_schema_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  source_bundle_sha256 TEXT NOT NULL,
  plan_sha256 TEXT NOT NULL UNIQUE,
  providers_json TEXT NOT NULL,
  max_documents INTEGER NOT NULL CHECK (max_documents BETWEEN 1 AND 10000),
  max_requests INTEGER NOT NULL CHECK (max_requests BETWEEN 1 AND 30000),
  max_input_characters_per_document INTEGER NOT NULL CHECK (max_input_characters_per_document BETWEEN 1 AND 1000000),
  max_output_tokens_per_request INTEGER NOT NULL CHECK (max_output_tokens_per_request BETWEEN 1 AND 100000),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  input_token_count INTEGER NOT NULL DEFAULT 0 CHECK (input_token_count >= 0),
  output_token_count INTEGER NOT NULL DEFAULT 0 CHECK (output_token_count >= 0),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  notes TEXT
);

CREATE INDEX idx_extraction_runs_started ON extraction_runs(started_at DESC, id DESC);

CREATE TABLE extraction_sources (
  id INTEGER PRIMARY KEY,
  extraction_run_id INTEGER NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
  study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  source_document TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('metadata', 'abstract', 'full_text', 'supplement', 'table', 'figure', 'other')),
  section TEXT NOT NULL DEFAULT 'unknown' CHECK (section IN ('title', 'abstract', 'methods', 'results', 'discussion', 'table', 'figure', 'supplement', 'unknown')),
  content_sha256 TEXT NOT NULL,
  content_character_count INTEGER NOT NULL CHECK (content_character_count > 0),
  source_license TEXT,
  rights_status TEXT NOT NULL DEFAULT 'unknown' CHECK (rights_status IN ('cc_by', 'cc_by_nc', 'cc0', 'public_domain', 'restricted', 'unknown')),
  content_stored INTEGER NOT NULL DEFAULT 0 CHECK (content_stored = 0),
  UNIQUE (extraction_run_id, study_id, source_document, content_sha256)
);

CREATE INDEX idx_extraction_sources_study_run ON extraction_sources(study_id, extraction_run_id);

CREATE TABLE extraction_provider_calls (
  id INTEGER PRIMARY KEY,
  extraction_run_id INTEGER NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
  study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'gemini', 'fixture')),
  model TEXT NOT NULL,
  model_version TEXT,
  request_sequence INTEGER NOT NULL CHECK (request_sequence > 0),
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'refused', 'incomplete')),
  external_request_id TEXT,
  input_character_count INTEGER NOT NULL CHECK (input_character_count >= 0),
  input_token_count INTEGER CHECK (input_token_count IS NULL OR input_token_count >= 0),
  output_token_count INTEGER CHECK (output_token_count IS NULL OR output_token_count >= 0),
  error_code TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  UNIQUE (extraction_run_id, study_id, provider)
);

CREATE INDEX idx_provider_calls_run_status ON extraction_provider_calls(extraction_run_id, status, id);
CREATE INDEX idx_provider_calls_study ON extraction_provider_calls(study_id, extraction_run_id);

ALTER TABLE evidence_provenance ADD COLUMN extraction_run_id INTEGER REFERENCES extraction_runs(id) ON DELETE SET NULL;
ALTER TABLE evidence_provenance ADD COLUMN extraction_provider TEXT;

CREATE UNIQUE INDEX idx_provenance_extraction_identity
  ON evidence_provenance(study_id, field_name, extraction_run_id, extraction_provider)
  WHERE extraction_run_id IS NOT NULL AND extraction_provider IS NOT NULL;

ALTER TABLE extractions ADD COLUMN extraction_run_id INTEGER REFERENCES extraction_runs(id) ON DELETE SET NULL;

CREATE INDEX idx_extractions_run_study ON extractions(extraction_run_id, study_id, field_name);

CREATE TABLE consensus_history (
  id INTEGER PRIMARY KEY,
  extraction_run_id INTEGER NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
  study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  normalized_value TEXT,
  agreement_count INTEGER NOT NULL CHECK (agreement_count >= 0),
  total_count INTEGER NOT NULL CHECK (total_count > 0 AND agreement_count <= total_count),
  status TEXT NOT NULL CHECK (status IN ('insufficient_data', 'agreement', 'needs_human_review')),
  details_json TEXT NOT NULL,
  calculated_at TEXT NOT NULL,
  UNIQUE (extraction_run_id, study_id, field_name)
);

CREATE INDEX idx_consensus_history_study_status ON consensus_history(study_id, status, extraction_run_id);

CREATE TABLE evidence_checks (
  id INTEGER PRIMARY KEY,
  extraction_run_id INTEGER NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
  study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  provenance_id INTEGER REFERENCES evidence_provenance(id) ON DELETE SET NULL,
  snippet_found_in_source INTEGER NOT NULL CHECK (snippet_found_in_source IN (0, 1)),
  locator_present INTEGER NOT NULL CHECK (locator_present IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('source_aligned', 'needs_human_review')),
  details_json TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  UNIQUE (extraction_run_id, study_id, field_name, provider)
);

CREATE INDEX idx_evidence_checks_study_status ON evidence_checks(study_id, status, extraction_run_id);
