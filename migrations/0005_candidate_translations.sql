PRAGMA foreign_keys = ON;

CREATE TABLE candidate_translations (
  candidate_id INTEGER NOT NULL REFERENCES study_candidates(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL CHECK (field_name IN ('title')),
  target_language TEXT NOT NULL CHECK (target_language IN ('ja')),
  source_sha256 TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('deepl', 'source')),
  provider_model TEXT NOT NULL,
  glossary_version TEXT,
  translated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, field_name, target_language)
);

CREATE INDEX idx_candidate_translations_source
  ON candidate_translations(source_sha256, target_language, candidate_id);

CREATE TABLE translation_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
