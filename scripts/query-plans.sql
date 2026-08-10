-- Run after migrations and fixtures. Review for SEARCH/SCAN using the named indexes.
EXPLAIN QUERY PLAN SELECT id FROM studies WHERE public_id = 'BHE-FIXTURE-0001';
EXPLAIN QUERY PLAN SELECT id FROM studies WHERE pmid = 'example';
EXPLAIN QUERY PLAN SELECT id FROM studies WHERE doi = 'example';
EXPLAIN QUERY PLAN SELECT study_id FROM classifications WHERE species_type = 'human' AND study_design = 'randomized_controlled_trial';
EXPLAIN QUERY PLAN SELECT study_id FROM interventions WHERE administration_route = 'inhalation';
EXPLAIN QUERY PLAN SELECT id FROM studies WHERE publication_year BETWEEN 2020 AND 2026 ORDER BY publication_year DESC, id DESC LIMIT 11;
EXPLAIN QUERY PLAN SELECT id FROM studies WHERE verification_status = 'human_verified' ORDER BY publication_year DESC, id DESC LIMIT 11;
EXPLAIN QUERY PLAN SELECT study_id FROM populations WHERE condition_canonical = 'dementia';
EXPLAIN QUERY PLAN SELECT s.id
  FROM study_search
  JOIN studies s ON s.id = study_search.rowid
  WHERE study_search MATCH '"molecular_hydrogen"'
  ORDER BY s.publication_year DESC, s.id DESC
  LIMIT 11;
EXPLAIN QUERY PLAN SELECT id FROM study_candidates WHERE candidate_key = 'doi:10.1000/example';
EXPLAIN QUERY PLAN SELECT id FROM study_candidates WHERE doi = '10.1000/example';
EXPLAIN QUERY PLAN SELECT id FROM study_candidates WHERE review_status = 'pending' ORDER BY publication_year DESC, id DESC LIMIT 50;
EXPLAIN QUERY PLAN SELECT candidate_id FROM discovery_run_candidates WHERE run_id = 1;
