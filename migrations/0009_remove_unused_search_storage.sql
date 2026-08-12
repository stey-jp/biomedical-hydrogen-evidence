PRAGMA foreign_keys = ON;

-- Query normalization is performed by src/search/normalize.js. Keeping a second
-- alias registry in D1 duplicates the same data and the runtime never reads it.
DROP TABLE IF EXISTS search_aliases;

-- The translation cache is always addressed by its primary key
-- (candidate_id, field_name, target_language); source_sha256 is validated after
-- that lookup and is never used as a search predicate.
DROP INDEX IF EXISTS idx_candidate_translations_source;

-- UNIQUE (run_id, source, query_key) already creates a covering index for
-- lookups by the (run_id, source) prefix.
DROP INDEX IF EXISTS idx_discovery_queries_run_source;
