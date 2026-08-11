const queueColumns = `
  id AS internal_id,
  candidate_key,
  title,
  title_normalized,
  doi,
  pmid,
  pmcid,
  publication_year,
  publication_date,
  journal,
  publisher,
  authors_json,
  language,
  source_url,
  screening_hint,
  screening_reasons_json,
  review_status,
  review_reason,
  reviewed_by,
  reviewed_at`;

export const reviewHints = ["likely_biomedical", "needs_review", "likely_non_biomedical"];

export function buildReviewQueueStatement({ screeningHint, limit }) {
  return {
    sql: `SELECT ${queueColumns}
      FROM study_candidates
      WHERE screening_hint = ? AND review_status = 'pending'
      ORDER BY id
      LIMIT ?`,
    bindings: [screeningHint, limit],
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
    async getQueue({ screeningHint, limit }) {
      const result = await prepared(db, buildReviewQueueStatement({ screeningHint, limit })).all();
      return result.results ?? [];
    },

    async getProgress(screeningHint) {
      const result = await prepared(db, buildReviewProgressStatement(screeningHint)).all();
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
        FROM study_candidates
        WHERE candidate_key = ?`).bind(candidateKey).first();
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
        FROM study_candidates
        WHERE title_normalized = (
          SELECT title_normalized FROM study_candidates WHERE candidate_key = ?
        )
          AND candidate_key <> ?
          AND review_status <> 'duplicate'
        ORDER BY CASE WHEN publication_year = (
          SELECT publication_year FROM study_candidates WHERE candidate_key = ?
        ) THEN 0 ELSE 1 END, id
        LIMIT 10`).bind(candidateKey, candidateKey, candidateKey).all();
      return result.results ?? [];
    },

    async findDuplicateTarget(identifier, excludeCandidateKey) {
      const values = duplicateIdentifiers(identifier);
      return db.prepare(`SELECT ${queueColumns}
        FROM study_candidates
        WHERE candidate_key <> ?
          AND review_status <> 'duplicate'
          AND (candidate_key = ? OR doi = ? OR pmid = ? OR pmcid = ?)
        ORDER BY id
        LIMIT 1`).bind(
        excludeCandidateKey,
        values.candidateKey,
        values.doi,
        values.pmid,
        values.pmcid,
      ).first();
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
