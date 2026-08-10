PRAGMA foreign_keys = ON;

ALTER TABLE studies ADD COLUMN source_candidate_id INTEGER REFERENCES study_candidates(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX idx_studies_source_candidate
  ON studies(source_candidate_id)
  WHERE source_candidate_id IS NOT NULL;

CREATE TABLE human_review_batches (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  review_type TEXT NOT NULL CHECK (review_type IN ('candidate_screening', 'field_verification', 'study_verification', 'correction')),
  source_artifact_sha256 TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  decision_count INTEGER NOT NULL CHECK (decision_count > 0),
  created_at TEXT NOT NULL,
  notes TEXT
);

CREATE INDEX idx_human_review_batches_created ON human_review_batches(created_at DESC, id DESC);

CREATE TABLE candidate_review_events (
  id INTEGER PRIMARY KEY,
  review_batch_id INTEGER NOT NULL REFERENCES human_review_batches(id) ON DELETE RESTRICT,
  candidate_id INTEGER NOT NULL REFERENCES study_candidates(id) ON DELETE RESTRICT,
  previous_status TEXT NOT NULL CHECK (previous_status IN ('pending', 'include', 'exclude', 'duplicate', 'needs_review')),
  decision TEXT NOT NULL CHECK (decision IN ('include', 'exclude', 'duplicate', 'needs_review')),
  reason TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  UNIQUE (review_batch_id, candidate_id)
);

CREATE INDEX idx_candidate_review_events_candidate ON candidate_review_events(candidate_id, reviewed_at DESC, id DESC);

CREATE TABLE field_verification_events (
  id INTEGER PRIMARY KEY,
  review_batch_id INTEGER NOT NULL REFERENCES human_review_batches(id) ON DELETE RESTRICT,
  study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE RESTRICT,
  field_name TEXT NOT NULL,
  previous_status TEXT NOT NULL CHECK (previous_status IN ('unverified', 'machine_extracted', 'machine_checked', 'needs_human_review', 'human_verified', 'disputed')),
  decision TEXT NOT NULL CHECK (decision IN ('needs_human_review', 'human_verified', 'disputed')),
  provenance_id INTEGER REFERENCES evidence_provenance(id) ON DELETE SET NULL,
  reviewer TEXT NOT NULL,
  note TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  UNIQUE (review_batch_id, study_id, field_name)
);

CREATE INDEX idx_field_verification_events_study ON field_verification_events(study_id, reviewed_at DESC, id DESC);

CREATE TABLE study_change_events (
  id INTEGER PRIMARY KEY,
  review_batch_id INTEGER REFERENCES human_review_batches(id) ON DELETE SET NULL,
  study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE RESTRICT,
  change_type TEXT NOT NULL CHECK (change_type IN ('candidate_promotion', 'human_verification', 'correction')),
  changed_fields_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  changed_at TEXT NOT NULL
);

CREATE INDEX idx_study_change_events_study ON study_change_events(study_id, changed_at DESC, id DESC);
