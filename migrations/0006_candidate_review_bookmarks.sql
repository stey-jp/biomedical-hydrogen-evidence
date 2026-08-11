PRAGMA foreign_keys = ON;

CREATE TABLE candidate_review_bookmarks (
  reviewer TEXT NOT NULL CHECK (length(reviewer) BETWEEN 1 AND 200),
  candidate_id INTEGER NOT NULL REFERENCES study_candidates(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (reviewer, candidate_id)
);

CREATE INDEX idx_candidate_review_bookmarks_reviewer_created
  ON candidate_review_bookmarks(reviewer, created_at DESC, candidate_id DESC);
