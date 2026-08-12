PRAGMA foreign_keys = ON;

-- Every record in this file is synthetic, test-only data. None describes a real study.
INSERT INTO studies (
  id, public_id, title, journal, publication_year, publication_date, language,
  record_kind, fixture_notice, verification_status
) VALUES
  (1, 'BHE-FIXTURE-0001', '[Synthetic fixture] Molecular hydrogen inhalation in adults with a fictional cognitive condition', 'Synthetic Fixture Journal', 2024, '2024-01-15', 'en', 'fixture', 'Synthetic fixture — test only; not a real biomedical study.', 'human_verified'),
  (2, 'BHE-FIXTURE-0002', '[Synthetic fixture] Hydrogen-rich water in a fictional animal model', 'Synthetic Fixture Journal', 2023, '2023-06-20', 'en', 'fixture', 'Synthetic fixture — test only; not a real biomedical study.', 'machine_checked'),
  (3, 'BHE-FIXTURE-0003', '[Synthetic fixture] Molecular hydrogen exposure in cultured cells', 'Synthetic Fixture Journal', 2022, '2022-11-01', 'en', 'fixture', 'Synthetic fixture — test only; not a real biomedical study.', 'needs_human_review');

INSERT INTO authors (
  id, public_id, display_name, given_name, family_name, native_name, orcid,
  profile_url, created_at, updated_at
) VALUES
  (1, 'BHE-AUTHOR-FIXTURE-0001', 'Synthetic Author A', 'Synthetic', 'Author A', NULL, '0000-0001-0000-0001', 'https://example.test/authors/1', '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z'),
  (2, 'BHE-AUTHOR-FIXTURE-0002', 'Synthetic Author B', 'Synthetic', 'Author B', NULL, '0000-0001-0000-0002', 'https://example.test/authors/2', '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z');

INSERT INTO study_authors (study_id, author_id, author_order) VALUES
  (1, 1, 1), (1, 2, 2), (2, 2, 1), (3, 1, 1);

INSERT INTO affiliations (
  id, name, ror_id, city, region, country_code, website_url
) VALUES
  (1, 'Synthetic Biomedical Institute', 'https://ror.org/000000001', 'Fixture City', NULL, 'JP', 'https://example.test/institutes/biomedical'),
  (2, 'Synthetic Molecular Research Center', 'https://ror.org/000000002', 'Example City', NULL, 'US', 'https://example.test/institutes/molecular');

INSERT INTO author_affiliations (
  author_id, affiliation_id, study_id, department, role_title, is_current,
  source_url, verification_status, verified_at
) VALUES
  (1, 1, NULL, 'Department of Synthetic Medicine', 'Fixture researcher', 1, 'https://example.test/authors/1', 'human_verified', '2026-08-12T00:00:00.000Z'),
  (1, 1, 1, 'Department of Synthetic Medicine', NULL, 0, 'https://example.test/studies/1', 'source_recorded', NULL),
  (2, 2, NULL, 'Hydrogen Fixture Unit', 'Fixture researcher', 1, 'https://example.test/authors/2', 'human_verified', '2026-08-12T00:00:00.000Z'),
  (2, 2, 1, 'Hydrogen Fixture Unit', NULL, 0, 'https://example.test/studies/1', 'source_recorded', NULL),
  (2, 2, 2, 'Hydrogen Fixture Unit', NULL, 0, 'https://example.test/studies/2', 'source_recorded', NULL);

INSERT INTO author_contacts (
  author_id, contact_type, label, contact_value, is_primary, is_public,
  source_url, verification_status, verified_at
) VALUES
  (1, 'email', '勤務先メール', 'synthetic.author.a@example.test', 1, 1, 'https://example.test/authors/1', 'human_verified', '2026-08-12T00:00:00.000Z'),
  (2, 'institutional_profile', '研究者プロフィール', 'https://example.test/authors/2', 1, 1, 'https://example.test/authors/2', 'human_verified', '2026-08-12T00:00:00.000Z');

INSERT INTO classifications (
  study_id, species_type, study_design, randomized, blinded, prospective, peer_reviewed
) VALUES
  (1, 'human', 'randomized_controlled_trial', 1, 1, 1, 1),
  (2, 'animal', 'controlled_animal_study', 0, 0, 1, 1),
  (3, 'in_vitro', 'controlled_cell_study', 0, 0, 1, 1);

INSERT INTO populations (
  study_id, participant_count, analyzed_participant_count, age_description,
  sex_description, disease_or_condition, condition_canonical, inclusion_criteria, exclusion_criteria
) VALUES
  (1, 72, 70, 'Synthetic adults aged 50–75 years', 'Synthetic mixed-sex cohort', 'Fictional cognitive impairment', 'dementia', 'Synthetic criteria for fixture testing only', 'Synthetic criteria for fixture testing only'),
  (2, 24, 24, 'Synthetic adult laboratory animals', 'Not specified in fixture', 'Fictional Parkinson-like model', 'parkinson_disease', NULL, NULL),
  (3, NULL, NULL, 'Not applicable', 'Not applicable', 'Fictional oxidative stress cell model', 'oxidative_stress', NULL, NULL);

INSERT INTO interventions (
  id, study_id, administration_route, hydrogen_concentration, concentration_unit,
  dissolved_hydrogen_concentration, dissolved_hydrogen_unit, duration_per_session,
  frequency, total_intervention_period, preparation_method, comparator
) VALUES
  (1, 1, 'inhalation', '2', '%', NULL, NULL, '60 minutes', 'once daily', '8 weeks', 'Synthetic gas mixture', 'Synthetic room-air control'),
  (2, 2, 'hydrogen_rich_water', NULL, NULL, '0.8', 'mg/L', NULL, 'ad libitum', '4 weeks', 'Synthetic preparation', 'Synthetic control water'),
  (3, 3, 'other', '0.5', 'mg/L', NULL, NULL, '24 hours', 'single exposure', '24 hours', 'Synthetic culture-medium preparation', 'Synthetic untreated cells');

INSERT INTO normalized_numeric_values (
  study_id, entity_type, entity_id, field_name, original_value, original_unit, normalized_value, normalized_unit
) VALUES
  (1, 'intervention', 1, 'hydrogen_concentration', '2', '%', 0.02, 'fraction'),
  (2, 'intervention', 2, 'dissolved_hydrogen_concentration', '0.8', 'mg/L', 0.8, 'mg/L');

INSERT INTO outcomes (
  id, study_id, name, classification, measurement_method, intervention_value,
  control_value, effect_estimate, p_value, confidence_interval,
  statistically_significant, direction, time_point
) VALUES
  (1, 1, 'Synthetic cognitive score', 'primary', 'Synthetic validated scale', '12.0', '11.5', 'Mean difference 0.5', '0.42', '95% CI -0.7 to 1.7', 0, 'no_clear_difference', '8 weeks'),
  (2, 1, 'Synthetic sleep score', 'secondary', 'Synthetic questionnaire', '7.1', '6.2', 'Mean difference 0.9', '0.03', '95% CI 0.1 to 1.7', 1, 'favors_intervention', '8 weeks'),
  (3, 2, 'Synthetic motor behavior score', 'primary', 'Synthetic animal assay', '18', '14', 'Mean difference 4', '0.04', NULL, 1, 'favors_intervention', '4 weeks'),
  (4, 3, 'Synthetic reactive oxygen signal', 'primary', 'Synthetic fluorescence assay', '0.75', '1.00', 'Ratio 0.75', NULL, NULL, NULL, 'unclear', '24 hours');

INSERT INTO safety (study_id, adverse_events, serious_adverse_events, withdrawals, safety_conclusion) VALUES
  (1, 'No synthetic difference recorded.', 'None in synthetic fixture.', 'Two synthetic withdrawals.', 'Fixture-only safety statement; no clinical inference is possible.'),
  (2, 'Not applicable to human safety.', NULL, NULL, 'Fixture-only animal observation.'),
  (3, 'Not applicable.', 'Not applicable.', 'Not applicable.', 'In-vitro fixture; no safety inference.');

INSERT INTO research_transparency (
  study_id, funding, conflict_of_interest, trial_registration, registration_number, ethics_approval
) VALUES
  (1, 'Synthetic project funds', 'Synthetic authors report none', 'Not registered; fixture only', NULL, 'Synthetic ethics statement'),
  (2, 'Synthetic project funds', 'Not specified in fixture', NULL, NULL, 'Synthetic animal ethics statement'),
  (3, 'Synthetic project funds', 'Not specified in fixture', NULL, NULL, 'Not applicable');

INSERT INTO evidence_provenance (
  id, study_id, field_name, source_document, source_type, section,
  locator, evidence_snippet, source_license, rights_status
) VALUES
  (1, 1, 'population.participant_count', 'fixtures/synthetic.sql', 'metadata', 'methods', 'synthetic fixture row', 'Synthetic test value: 72 participants.', 'Project-created synthetic fixture', 'cc0'),
  (2, 1, 'interventions.hydrogen_concentration', 'fixtures/synthetic.sql', 'metadata', 'methods', 'synthetic fixture row', 'Synthetic test value: molecular hydrogen at 2%.', 'Project-created synthetic fixture', 'cc0'),
  (3, 1, 'outcomes.synthetic_cognitive_score', 'fixtures/synthetic.sql', 'metadata', 'results', 'synthetic fixture row', 'Synthetic test result: no clear difference for the primary outcome.', 'Project-created synthetic fixture', 'cc0'),
  (4, 2, 'interventions.dissolved_hydrogen_concentration', 'fixtures/synthetic.sql', 'metadata', 'methods', 'synthetic fixture row', 'Synthetic test value: dissolved hydrogen at 0.8 mg/L.', 'Project-created synthetic fixture', 'cc0');

INSERT INTO field_verifications (
  study_id, field_name, status, provenance_id, reviewer, note, verified_at
) VALUES
  (1, 'population.participant_count', 'human_verified', 1, 'fixture-reviewer', 'Verified only as internally consistent synthetic data.', '2026-08-11T00:00:00.000Z'),
  (1, 'interventions.hydrogen_concentration', 'human_verified', 2, 'fixture-reviewer', 'Verified only as internally consistent synthetic data.', '2026-08-11T00:00:00.000Z'),
  (2, 'interventions.dissolved_hydrogen_concentration', 'machine_checked', 4, NULL, 'Machine agreement does not establish correctness.', '2026-08-11T00:00:00.000Z');

INSERT INTO extractions (
  study_id, provider, model, model_version, prompt_version, extraction_schema_version,
  field_name, extracted_value, normalized_value, confidence, provenance_id
) VALUES
  (2, 'stub-openai', 'fixture-model-a', 'test-only', 'fixture-v1', '1', 'interventions.dissolved_hydrogen_concentration', '0.8 mg/L', '{"value":0.8,"unit":"mg/L"}', 0.9, 4),
  (2, 'stub-anthropic', 'fixture-model-b', 'test-only', 'fixture-v1', '1', 'interventions.dissolved_hydrogen_concentration', '0.8 mg/L', '{"value":0.8,"unit":"mg/L"}', 0.9, 4),
  (2, 'stub-gemini', 'fixture-model-c', 'test-only', 'fixture-v1', '1', 'interventions.dissolved_hydrogen_concentration', '1.0 mg/L', '{"value":1,"unit":"mg/L"}', 0.8, 4);

INSERT INTO extraction_consensus (
  study_id, field_name, normalized_value, agreement_count, total_count, status, details_json
) VALUES
  (2, 'interventions.dissolved_hydrogen_concentration', '{"value":0.8,"unit":"mg/L"}', 2, 3, 'needs_human_review', '{"note":"Majority agreement is not proof of correctness."}');

INSERT INTO study_search (rowid, title, condition_terms, outcome_terms, intervention_terms) VALUES
  (1, 'synthetic fixture molecular hydrogen human randomized controlled trial', 'fictional cognitive impairment dementia', 'cognitive score sleep', 'molecular_hydrogen inhalation hydrogen gas'),
  (2, 'synthetic fixture hydrogen rich water animal controlled study', 'fictional parkinson disease model parkinson_disease', 'motor behavior', 'molecular_hydrogen hydrogen_rich_water hrw'),
  (3, 'synthetic fixture molecular hydrogen cultured cells in vitro', 'oxidative stress oxidative_stress', 'reactive oxygen signal', 'molecular_hydrogen other');
