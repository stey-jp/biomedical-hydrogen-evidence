PRAGMA foreign_keys = ON;

ALTER TABLE authors ADD COLUMN public_id TEXT;
ALTER TABLE authors ADD COLUMN given_name TEXT;
ALTER TABLE authors ADD COLUMN family_name TEXT;
ALTER TABLE authors ADD COLUMN native_name TEXT;
ALTER TABLE authors ADD COLUMN profile_url TEXT;
ALTER TABLE authors ADD COLUMN created_at TEXT;
ALTER TABLE authors ADD COLUMN updated_at TEXT;

UPDATE authors
SET
  public_id = 'BHE-AUTHOR-' || printf('%06d', id),
  created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE public_id IS NULL;

CREATE UNIQUE INDEX idx_authors_public_id ON authors(public_id);
CREATE INDEX idx_authors_display_name ON authors(display_name COLLATE NOCASE, id);
CREATE INDEX idx_study_authors_author ON study_authors(author_id, study_id);

CREATE TRIGGER authors_require_public_id_insert
BEFORE INSERT ON authors
WHEN NEW.public_id IS NULL OR trim(NEW.public_id) = ''
BEGIN
  SELECT RAISE(ABORT, 'authors.public_id is required');
END;

CREATE TRIGGER authors_require_public_id_update
BEFORE UPDATE OF public_id ON authors
WHEN NEW.public_id IS NULL OR trim(NEW.public_id) = ''
BEGIN
  SELECT RAISE(ABORT, 'authors.public_id is required');
END;

CREATE TABLE affiliations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  ror_id TEXT UNIQUE,
  city TEXT,
  region TEXT,
  country_code TEXT CHECK (country_code IS NULL OR length(country_code) = 2),
  website_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_affiliations_name ON affiliations(name COLLATE NOCASE, id);

-- Affiliations are time-dependent. A row may describe an affiliation reported
-- by one study, or a current affiliation when study_id is NULL.
CREATE TABLE author_affiliations (
  id INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  affiliation_id INTEGER NOT NULL REFERENCES affiliations(id) ON DELETE RESTRICT,
  study_id INTEGER REFERENCES studies(id) ON DELETE CASCADE,
  department TEXT,
  role_title TEXT,
  start_year INTEGER CHECK (start_year IS NULL OR start_year BETWEEN 1800 AND 2200),
  end_year INTEGER CHECK (end_year IS NULL OR end_year BETWEEN 1800 AND 2200),
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  source_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (
    verification_status IN ('unverified', 'source_recorded', 'human_verified')
  ),
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (end_year IS NULL OR start_year IS NULL OR end_year >= start_year)
);

CREATE INDEX idx_author_affiliations_author ON author_affiliations(author_id, is_current DESC, id);
CREATE INDEX idx_author_affiliations_study ON author_affiliations(study_id, author_id);
CREATE INDEX idx_author_affiliations_affiliation ON author_affiliations(affiliation_id, author_id);

-- Only public, professional contact points with an explicit source belong here.
-- Public API queries additionally enforce is_public = 1.
CREATE TABLE author_contacts (
  id INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  contact_type TEXT NOT NULL CHECK (
    contact_type IN ('email', 'institutional_profile', 'website', 'other')
  ),
  label TEXT,
  contact_value TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  source_url TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (
    verification_status IN ('unverified', 'source_recorded', 'human_verified')
  ),
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (author_id, contact_type, contact_value)
);

CREATE INDEX idx_author_contacts_public ON author_contacts(author_id, is_public, is_primary DESC, id);
