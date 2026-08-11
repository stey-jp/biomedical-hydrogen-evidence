PRAGMA foreign_keys = ON;

CREATE TABLE journal_metrics (
  lookup_title_key TEXT NOT NULL,
  lookup_title TEXT NOT NULL,
  matched_journal_title TEXT,
  metric_type TEXT NOT NULL CHECK (metric_type IN ('openalex_2yr_mean_citedness')),
  metric_value REAL CHECK (metric_value IS NULL OR metric_value >= 0),
  metric_year INTEGER NOT NULL CHECK (metric_year BETWEEN 1800 AND 2200),
  source TEXT NOT NULL CHECK (source IN ('openalex')),
  source_journal_id TEXT,
  source_url TEXT,
  source_updated_at TEXT,
  match_status TEXT NOT NULL CHECK (match_status IN ('matched', 'not_found', 'ambiguous', 'not_available')),
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (lookup_title_key, metric_type, metric_year)
);

CREATE INDEX idx_journal_metrics_latest
  ON journal_metrics(lookup_title_key, metric_type, metric_year DESC, match_status);
