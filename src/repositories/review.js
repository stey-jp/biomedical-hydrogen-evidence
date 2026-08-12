const queueColumns = `
  c.id AS internal_id,
  c.candidate_key,
  c.title,
  c.title_normalized,
  c.doi,
  c.pmid,
  c.pmcid,
  c.publication_year,
  c.publication_date,
  c.journal,
  c.publisher,
  c.authors_json,
  c.language,
  c.source_url,
  c.screening_hint,
  c.screening_reasons_json,
  c.review_status,
  c.review_reason,
  c.reviewed_by,
  c.reviewed_at,
  jm.metric_type AS journal_metric_type,
  jm.metric_value AS journal_metric_value,
  jm.metric_year AS journal_metric_year,
  jm.source AS journal_metric_source,
  jm.source_url AS journal_metric_source_url,
  jm.refreshed_at AS journal_metric_refreshed_at`;

const journalMetricJoin = `LEFT JOIN journal_metrics jm
  ON jm.lookup_title_key = LOWER(TRIM(c.journal))
  AND jm.metric_type = 'openalex_2yr_mean_citedness'
  AND jm.match_status = 'matched'
  AND jm.metric_year = (
    SELECT MAX(latest_jm.metric_year)
    FROM journal_metrics latest_jm
    WHERE latest_jm.lookup_title_key = LOWER(TRIM(c.journal))
      AND latest_jm.metric_type = 'openalex_2yr_mean_citedness'
      AND latest_jm.match_status = 'matched'
      AND latest_jm.metric_value IS NOT NULL
  )`;

const bookmarkTitleTranslationJoin = `LEFT JOIN candidate_translations bt
  ON bt.candidate_id = c.id
  AND bt.field_name = 'title'
  AND bt.target_language = 'ja'`;

const bookmarkedCandidateColumns = `
  c.id AS internal_id,
  c.candidate_key,
  c.title,
  c.title_normalized,
  c.doi,
  c.pmid,
  c.pmcid,
  c.publication_year,
  c.publication_date,
  c.journal,
  c.publisher,
  c.authors_json,
  c.language,
  c.source_url,
  c.screening_hint,
  c.screening_reasons_json,
  c.review_status,
  c.review_reason,
  c.reviewed_by,
  c.reviewed_at,
  jm.metric_type AS journal_metric_type,
  jm.metric_value AS journal_metric_value,
  jm.metric_year AS journal_metric_year,
  jm.source AS journal_metric_source,
  jm.source_url AS journal_metric_source_url,
  jm.refreshed_at AS journal_metric_refreshed_at,
  bt.translated_text AS translated_title,
  b.created_at AS bookmarked_at`;

export const reviewHints = ["likely_biomedical", "needs_review", "likely_non_biomedical"];

export function buildReviewQueueStatement({ screeningHint, reviewStatus, limit }) {
  return {
    sql: `SELECT ${queueColumns}
      FROM study_candidates c
      ${journalMetricJoin}
      WHERE c.screening_hint = ? AND c.review_status = ?
      ORDER BY c.id
      LIMIT ?`,
    bindings: [screeningHint, reviewStatus, limit],
  };
}

export function buildReviewProgressStatement(screeningHint) {
  return {
    sql: `SELECT review_status, COUNT(*) AS count
      FROM study_candidates
      WHERE screening_hint = ?
      GROUP BY review_status`,
    bindings: [screeningHint],
  };
}

function prepared(db, statement) {
  return db.prepare(statement.sql).bind(...statement.bindings);
}

function duplicateIdentifiers(identifier) {
  const value = identifier.trim();
  const withoutDoiUrl = value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, "");
  return {
    candidateKey: value.toLocaleLowerCase("en-US"),
    doi: withoutDoiUrl.replace(/^doi:\s*/iu, "").toLocaleLowerCase("en-US"),
    pmid: value.replace(/^pmid:\s*/iu, ""),
    pmcid: value.replace(/^pmcid:\s*/iu, "").toLocaleUpperCase("en-US"),
  };
}

export function createReviewRepository(db) {
  return {
    async getQueue({ screeningHint, reviewStatus, limit }) {
      const result = await prepared(db, buildReviewQueueStatement({ screeningHint, reviewStatus, limit })).all();
      return result.results ?? [];
    },

    async getProgress(screeningHint) {
      const result = await prepared(db, buildReviewProgressStatement(screeningHint)).all();
      return result.results ?? [];
    },

    async getReviewers(limit = 200) {
      const result = await db.prepare(`SELECT
          reviewer,
          COUNT(*) AS review_count,
          MAX(reviewed_at) AS last_reviewed_at
        FROM candidate_review_events
        GROUP BY reviewer
        ORDER BY last_reviewed_at DESC, reviewer
        LIMIT ?`).bind(limit).all();
      return result.results ?? [];
    },

    async getCompletedReviews(screeningHint) {
      const result = await db.prepare(`SELECT
          candidate_key, review_status AS decision, review_reason AS reason,
          reviewed_by AS reviewer, reviewed_at, screening_hint,
          title, doi, pmid, pmcid
        FROM study_candidates
        WHERE screening_hint = ? AND review_status <> 'pending'
        ORDER BY id`).bind(screeningHint).all();
      return result.results ?? [];
    },

    async getCandidate(candidateKey) {
      return db.prepare(`SELECT ${queueColumns}
        FROM study_candidates c
        ${journalMetricJoin}
        WHERE c.candidate_key = ?`).bind(candidateKey).first();
    },

    async getBookmarks(reviewer, limit = 500) {
      const result = await db.prepare(`SELECT ${bookmarkedCandidateColumns}
        FROM candidate_review_bookmarks b
        JOIN study_candidates c ON c.id = b.candidate_id
        ${journalMetricJoin}
        ${bookmarkTitleTranslationJoin}
        WHERE b.reviewer = ?
        ORDER BY b.created_at DESC, b.candidate_id DESC
        LIMIT ?`).bind(reviewer, limit).all();
      return result.results ?? [];
    },

    async getBookmarkedCandidate(reviewer, candidateKey) {
      return db.prepare(`SELECT ${bookmarkedCandidateColumns}
        FROM candidate_review_bookmarks b
        JOIN study_candidates c ON c.id = b.candidate_id
        ${journalMetricJoin}
        ${bookmarkTitleTranslationJoin}
        WHERE b.reviewer = ? AND c.candidate_key = ?
        LIMIT 1`).bind(reviewer, candidateKey).first();
    },

    async getBookmarksForExport(reviewer) {
      const result = await db.prepare(`SELECT
          b.created_at AS bookmarked_at,
          b.reviewer,
          c.candidate_key,
          c.review_status,
          c.screening_hint,
          c.title,
          bt.translated_text AS translated_title,
          c.publication_year,
          c.journal,
          c.doi,
          c.pmid,
          c.pmcid,
          c.source_url
        FROM candidate_review_bookmarks b
        JOIN study_candidates c ON c.id = b.candidate_id
        ${bookmarkTitleTranslationJoin}
        WHERE b.reviewer = ?
        ORDER BY b.created_at DESC, b.candidate_id DESC`).bind(reviewer).all();
      return result.results ?? [];
    },

    async setBookmark({ candidateKey, reviewer, bookmarked, createdAt }) {
      if (bookmarked) {
        return db.prepare(`INSERT INTO candidate_review_bookmarks (reviewer, candidate_id, created_at)
          SELECT ?, id, ? FROM study_candidates WHERE candidate_key = ?
          ON CONFLICT(reviewer, candidate_id) DO UPDATE SET created_at = excluded.created_at`)
          .bind(reviewer, createdAt, candidateKey).run();
      }
      return db.prepare(`DELETE FROM candidate_review_bookmarks
        WHERE reviewer = ?
          AND candidate_id = (SELECT id FROM study_candidates WHERE candidate_key = ?)`)
        .bind(reviewer, candidateKey).run();
    },

    async getTitleTranslationRows(candidateKeys) {
      if (!candidateKeys.length) return [];
      const placeholders = candidateKeys.map(() => "?").join(", ");
      const result = await db.prepare(`SELECT
          c.id AS internal_id, c.candidate_key, c.title,
          t.source_sha256 AS translation_source_sha256,
          t.translated_text,
          t.provider AS translation_provider,
          t.provider_model AS translation_provider_model
        FROM study_candidates c
        LEFT JOIN candidate_translations t
          ON t.candidate_id = c.id
          AND t.field_name = 'title'
          AND t.target_language = 'ja'
        WHERE c.candidate_key IN (${placeholders})
        ORDER BY c.id`).bind(...candidateKeys).all();
      return result.results ?? [];
    },

    async saveTitleTranslations(records) {
      if (!records.length) return [];
      return db.batch(records.map((record) => db.prepare(`INSERT INTO candidate_translations (
          candidate_id, field_name, target_language, source_sha256,
          translated_text, provider, provider_model, glossary_version, translated_at
        ) VALUES (?, 'title', 'ja', ?, ?, 'deepl', ?, ?, ?)
        ON CONFLICT(candidate_id, field_name, target_language) DO UPDATE SET
          source_sha256 = excluded.source_sha256,
          translated_text = excluded.translated_text,
          provider = excluded.provider,
          provider_model = excluded.provider_model,
          glossary_version = excluded.glossary_version,
          translated_at = excluded.translated_at`)
        .bind(
          record.candidateId,
          record.sourceSha256,
          record.translatedText,
          record.providerModel,
          record.glossaryVersion,
          record.translatedAt,
        )));
    },

    async getTranslationSetting(settingKey) {
      const row = await db.prepare(`SELECT setting_value
        FROM translation_settings
        WHERE setting_key = ?`).bind(settingKey).first();
      return row?.setting_value ?? null;
    },

    async putTranslationSetting(settingKey, settingValue, updatedAt) {
      return db.prepare(`INSERT INTO translation_settings (setting_key, setting_value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(setting_key) DO UPDATE SET
          setting_value = excluded.setting_value,
          updated_at = excluded.updated_at`)
        .bind(settingKey, settingValue, updatedAt).run();
    },

    async getDuplicateSuggestions(candidateKey) {
      const result = await db.prepare(`SELECT ${queueColumns}
        FROM study_candidates c
        ${journalMetricJoin}
        WHERE c.title_normalized = (
          SELECT title_normalized FROM study_candidates WHERE candidate_key = ?
        )
          AND c.candidate_key <> ?
          AND c.review_status <> 'duplicate'
        ORDER BY CASE WHEN c.publication_year = (
          SELECT publication_year FROM study_candidates WHERE candidate_key = ?
        ) THEN 0 ELSE 1 END, c.id
        LIMIT 10`).bind(candidateKey, candidateKey, candidateKey).all();
      return result.results ?? [];
    },

    async findDuplicateTarget(identifier, excludeCandidateKey) {
      const values = duplicateIdentifiers(identifier);
      return db.prepare(`SELECT ${queueColumns}
        FROM study_candidates c
        ${journalMetricJoin}
        WHERE c.candidate_key <> ?
          AND c.review_status <> 'duplicate'
          AND (c.candidate_key = ? OR c.doi = ? OR c.pmid = ? OR c.pmcid = ?)
        ORDER BY c.id
        LIMIT 1`).bind(
        excludeCandidateKey,
        values.candidateKey,
        values.doi,
        values.pmid,
        values.pmcid,
      ).first();
    },

    async getJournalMetricRefreshQueue({ metricYear, staleBefore, limit }) {
      const result = await db.prepare(`SELECT
          MIN(TRIM(c.journal)) AS journal,
          LOWER(TRIM(c.journal)) AS lookup_title_key
        FROM study_candidates c
        LEFT JOIN journal_metrics jm
          ON jm.lookup_title_key = LOWER(TRIM(c.journal))
          AND jm.metric_type = 'openalex_2yr_mean_citedness'
          AND jm.metric_year = ?
        WHERE c.journal IS NOT NULL
          AND TRIM(c.journal) <> ''
          AND (jm.refreshed_at IS NULL OR jm.refreshed_at < ?)
        GROUP BY LOWER(TRIM(c.journal))
        ORDER BY COALESCE(jm.refreshed_at, ''),
          MIN(CASE c.screening_hint
            WHEN 'likely_biomedical' THEN 0
            WHEN 'needs_review' THEN 1
            ELSE 2
          END),
          MIN(CASE WHEN c.review_status = 'pending' THEN c.id ELSE 2147483647 END),
          MIN(c.id)
        LIMIT ?`).bind(metricYear, staleBefore, limit).all();
      return result.results ?? [];
    },

    async saveJournalMetrics(records) {
      if (!records.length) return [];
      return db.batch(records.map((record) => db.prepare(`INSERT INTO journal_metrics (
          lookup_title_key, lookup_title, matched_journal_title, metric_type, metric_value,
          metric_year, source, source_journal_id, source_url, source_updated_at, match_status, refreshed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(lookup_title_key, metric_type, metric_year) DO UPDATE SET
          lookup_title = excluded.lookup_title,
          matched_journal_title = excluded.matched_journal_title,
          metric_value = excluded.metric_value,
          source = excluded.source,
          source_journal_id = excluded.source_journal_id,
          source_url = excluded.source_url,
          source_updated_at = excluded.source_updated_at,
          match_status = excluded.match_status,
          refreshed_at = excluded.refreshed_at`)
        .bind(
          record.lookupTitleKey,
          record.lookupTitle,
          record.matchedJournalTitle,
          record.metricType,
          record.metricValue,
          record.metricYear,
          record.source,
          record.sourceJournalId,
          record.sourceUrl,
          record.sourceUpdatedAt,
          record.matchStatus,
          record.refreshedAt,
        )));
    },

    async recordDecision({
      candidateKey,
      decision,
      reason,
      reviewer,
      reviewedAt,
      batchPublicId,
      sourceArtifactSha256,
    }) {
      const statements = [
        db.prepare(`INSERT INTO human_review_batches (
          public_id, review_type, source_artifact_sha256, reviewer,
          decision_count, created_at, notes
        ) VALUES (?, 'candidate_screening', ?, ?, 1, ?, ?)`)
          .bind(
            batchPublicId,
            sourceArtifactSha256,
            reviewer,
            reviewedAt,
            "Authenticated mobile review; source hash covers the candidate snapshot. Screening only; no public promotion.",
          ),
        db.prepare(`INSERT INTO candidate_review_events (
          review_batch_id, candidate_id, previous_status, decision,
          reason, reviewer, reviewed_at
        ) VALUES (
          (SELECT id FROM human_review_batches WHERE public_id = ?),
          (SELECT id FROM study_candidates WHERE candidate_key = ?),
          (SELECT review_status FROM study_candidates WHERE candidate_key = ?),
          ?, ?, ?, ?
        )`).bind(
          batchPublicId,
          candidateKey,
          candidateKey,
          decision,
          reason,
          reviewer,
          reviewedAt,
        ),
        db.prepare(`UPDATE study_candidates
          SET review_status = ?, review_reason = ?, reviewed_by = ?, reviewed_at = ?
          WHERE candidate_key = ?`).bind(decision, reason, reviewer, reviewedAt, candidateKey),
      ];
      return db.batch(statements);
    },
  };
}
