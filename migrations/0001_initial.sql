PRAGMA foreign_keys = ON;

CREATE TABLE studies (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  doi TEXT,
  pmid TEXT,
  pmcid TEXT,
  journal TEXT,
  publication_year INTEGER NOT NULL CHECK (publication_year BETWEEN 1800 AND 2200),
  publication_date TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  publisher TEXT,
  source_url TEXT,
  doi_url TEXT,
  pubmed_url TEXT,
  pmc_url TEXT,
  record_kind TEXT NOT NULL DEFAULT 'published' CHECK (record_kind IN ('published', 'fixture')),
  fixture_notice TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (
    verification_status IN ('unverified', 'machine_extracted', 'machine_checked', 'needs_human_review', 'human_verified', 'disputed')
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX idx_studies_doi ON studies(doi) WHERE doi IS NOT NULL;
CREATE UNIQUE INDEX idx_studies_pmid ON studies(pmid) WHERE pmid IS NOT NULL;
CREATE UNIQUE INDEX idx_studies_pmcid ON studies(pmcid) WHERE pmcid IS NOT NULL;
CREATE INDEX idx_studies_year_id ON studies(publication_year DESC, id DESC);
CREATE INDEX idx_studies_verified_year ON studies(verification_status, publication_year DESC, id DESC);

CREATE TABLE authors (
  id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  orcid TEXT UNIQUE
);

CREATE TABLE study_authors (
  study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE RESTRICT,
  author_order INTEGER NOT NULL CHECK (author_order > 0),
  PRIMARY KEY (study_id, author_order),
  UNIQUE (study_id, author_id)
);

CREATE TABLE classifications (
  study_id INTEGER PRIMARY KEY REFERENCES studies(id) ON DELETE CASCADE,
  biomedical_relevance INTEGER NOT NULL DEFAULT 1 CHECK (biomedical_relevance IN (0, 1)),
  species_type TEXT NOT NULL CHECK (species_type IN ('human', 'animal', 'in_vitro', 'review', 'other')),
  study_design TEXT NOT NULL,
  randomized INTEGER CHECK (randomized IN (0, 1)),
  blinded INTEGER CHECK (blinded IN (0, 1)),
  prospective INTEGER CHECK (prospective IN (0, 1)),
  peer_reviewed INTEGER CHECK (peer_reviewed IN (0, 1))
);

CREATE INDEX idx_classifications_species_design ON classifications(species_type, study_design, study_id);
CREATE INDEX idx_classifications_design_species ON classifications(study_design, species_type, study_id);
CREATE INDEX idx_classifications_relevance_study ON classifications(biomedical_relevance, study_id);

CREATE TABLE populations (
  study_id INTEGER PRIMARY KEY REFERENCES studies(id) ON DELETE CASCADE,
  participant_count INTEGER CHECK (participant_count >= 0),
  analyzed_participant_count INTEGER CHECK (analyzed_participant_count >= 0),
  age_description TEXT,
  sex_description TEXT,
  disease_or_condition TEXT,
  condition_canonical TEXT,
  inclusion_criteria TEXT,
  exclusion_criteria TEXT
);

CREATE INDEX idx_populations_condition ON populations(condition_canonical, study_id);

CREATE TABLE interventions (
  id INTEGER PRIMARY KEY,
  study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  molecular_hydrogen INTEGER NOT NULL DEFAULT 1 CHECK (molecular_hydrogen IN (0, 1)),
  administration_route TEXT NOT NULL CHECK (
    administration_route IN ('inhalation', 'hydrogen_rich_water', 'bath', 'saline', 'injection', 'topical', 'dialysis', 'other')
  ),
  hydrogen_concentration TEXT,
  concentration_unit TEXT,
  flow_rate TEXT,
  flow_unit TEXT,
  dissolved_hydrogen_concentration TEXT,
  dissolved_hydrogen_unit TEXT,
  dose TEXT,
  duration_per_session TEXT,
  frequency TEXT,
  total_intervention_period TEXT,
  preparation_method TEXT,
  device_information TEXT,
  comparator TEXT
);

CREATE INDEX idx_interventions_route_study ON interventions(administration_route, study_id);
CREATE INDEX idx_interventions_study ON interventions(study_id);

CREATE TABLE normalized_numeric_values (
  id INTEGER PRIMARY KEY,
  study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('population', 'intervention', 'outcome', 'safety')),
  entity_id INTEGER,
  field_name TEXT NOT NULL,
  original_value TEXT NOT NULL,
  original_unit TEXT,
  normalized_value REAL,
  normalized_unit TEXT,
  UNIQUE (study_id, entity_type, entity_id, field_name)
);

CREATE INDEX idx_numeric_values_study_field ON normalized_numeric_values(study_id, field_name);

CREATE TABLE outcomes (
  id INTEGER PRIMARY KEY,
  study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'unspecified' CHECK (classification IN ('primary', 'secondary', 'unspecified')),
  measurement_method TEXT,
  intervention_value TEXT,
  control_value TEXT,
  effect_estimate TEXT,
  p_value TEXT,
  confidence_interval TEXT,
  statistically_significant INTEGER CHECK (statistically_significant IN (0, 1)),
  direction TEXT CHECK (direction IN ('favors_intervention', 'favors_control', 'no_clear_difference', 'not_applicable', 'unclear')),
  time_point TEXT
);

CREATE INDEX idx_outcomes_study ON outcomes(study_id);

CREATE TABLE safety (
  study_id INTEGER PRIMARY KEY REFERENCES studies(id) ON DELETE CASCADE,
  adverse_events TEXT,
  serious_adverse_events TEXT,
  withdrawals TEXT,
  safety_conclusion TEXT
);

CREATE TABLE research_transparency (
  study_id INTEGER PRIMARY KEY REFERENCES studies(id) ON DELETE CASCADE,
  funding TEXT,
  conflict_of_interest TEXT,
  trial_registration TEXT,
  registration_number TEXT,
  ethics_approval TEXT
);

CREATE TABLE evidence_provenance (
  id INTEGER PRIMARY KEY,
  study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  source_document TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('metadata', 'abstract', 'full_text', 'supplement', 'table', 'figure', 'other')),
  section TEXT NOT NULL DEFAULT 'unknown' CHECK (section IN ('title', 'abstract', 'methods', 'results', 'discussion', 'table', 'figure', 'supplement', 'unknown')),
  page_number TEXT,
  locator TEXT,
  evidence_snippet TEXT,
  source_license TEXT,
  rights_status TEXT NOT NULL DEFAULT 'unknown' CHECK (rights_status IN ('cc_by', 'cc_by_nc', 'cc0', 'public_domain', 'restricted', 'unknown')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_provenance_study_field ON evidence_provenance(study_id, field_name);

CREATE TABLE extractions (
  id INTEGER PRIMARY KEY,
  study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  model_version TEXT,
  prompt_version TEXT NOT NULL,
  extraction_schema_version TEXT NOT NULL,
  field_name TEXT NOT NULL,
  extracted_value TEXT,
  normalized_value TEXT,
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  provenance_id INTEGER REFERENCES evidence_provenance(id) ON DELETE SET NULL,
  extracted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (study_id, provider, model, prompt_version, extraction_schema_version, field_name)
);

CREATE INDEX idx_extractions_study_field ON extractions(study_id, field_name);

CREATE TABLE extraction_consensus (
  id INTEGER PRIMARY KEY,
  study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  normalized_value TEXT,
  agreement_count INTEGER NOT NULL CHECK (agreement_count >= 0),
  total_count INTEGER NOT NULL CHECK (total_count > 0 AND agreement_count <= total_count),
  status TEXT NOT NULL CHECK (status IN ('insufficient_data', 'agreement', 'needs_human_review')),
  details_json TEXT,
  calculated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (study_id, field_name)
);

CREATE TABLE field_verifications (
  id INTEGER PRIMARY KEY,
  study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('unverified', 'machine_extracted', 'machine_checked', 'needs_human_review', 'human_verified', 'disputed')),
  provenance_id INTEGER REFERENCES evidence_provenance(id) ON DELETE SET NULL,
  reviewer TEXT,
  note TEXT,
  verified_at TEXT,
  UNIQUE (study_id, field_name)
);

CREATE INDEX idx_verifications_study_status ON field_verifications(study_id, status);

CREATE TABLE search_aliases (
  alias TEXT PRIMARY KEY COLLATE NOCASE,
  canonical_term TEXT NOT NULL,
  concept_type TEXT NOT NULL CHECK (concept_type IN ('intervention', 'condition', 'species', 'study_design', 'general')),
  language TEXT NOT NULL DEFAULT 'en'
);

CREATE INDEX idx_search_aliases_canonical ON search_aliases(canonical_term, concept_type);

-- Content is deliberately materialized during controlled ingestion. This avoids
-- query-time joins and keeps Japanese alias expansion explicit and testable.
CREATE VIRTUAL TABLE study_search USING fts5(
  title,
  condition_terms,
  outcome_terms,
  intervention_terms,
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO search_aliases (alias, canonical_term, concept_type, language) VALUES
  ('molecular hydrogen', 'molecular_hydrogen', 'intervention', 'en'),
  ('H2', 'molecular_hydrogen', 'intervention', 'en'),
  ('H₂', 'molecular_hydrogen', 'intervention', 'en'),
  ('分子状水素', 'molecular_hydrogen', 'intervention', 'ja'),
  ('hydrogen inhalation', 'inhalation', 'intervention', 'en'),
  ('H2 inhalation', 'inhalation', 'intervention', 'en'),
  ('H₂ inhalation', 'inhalation', 'intervention', 'en'),
  ('hydrogen gas inhalation', 'inhalation', 'intervention', 'en'),
  ('水素吸入', 'inhalation', 'intervention', 'ja'),
  ('hydrogen-rich water', 'hydrogen_rich_water', 'intervention', 'en'),
  ('hydrogen rich water', 'hydrogen_rich_water', 'intervention', 'en'),
  ('hydrogen water', 'hydrogen_rich_water', 'intervention', 'en'),
  ('HRW', 'hydrogen_rich_water', 'intervention', 'en'),
  ('水素水', 'hydrogen_rich_water', 'intervention', 'ja'),
  ('水素', 'molecular_hydrogen', 'intervention', 'ja'),
  ('ヒト', 'human', 'species', 'ja'),
  ('認知症', 'dementia', 'condition', 'ja'),
  ('dementia', 'dementia', 'condition', 'en'),
  ('パーキンソン病', 'parkinson_disease', 'condition', 'ja'),
  ('Parkinson disease', 'parkinson_disease', 'condition', 'en'),
  ('睡眠', 'sleep', 'condition', 'ja'),
  ('RCT', 'randomized_controlled_trial', 'study_design', 'en'),
  ('ランダム化比較試験', 'randomized_controlled_trial', 'study_design', 'ja');
