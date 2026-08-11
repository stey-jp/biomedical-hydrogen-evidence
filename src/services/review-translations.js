import { glossaryVersion, TranslationProviderError } from "../translation/deepl.js";
import { fetchEuropePmcAbstract } from "../translation/europe-pmc.js";

const textEncoder = new TextEncoder();
const glossarySettingKey = `deepl-glossary:${glossaryVersion}`;

export class ReviewTranslationError extends Error {
  constructor(message, status = 500, code = "translation_failed") {
    super(message);
    this.name = "ReviewTranslationError";
    this.status = status;
    this.code = code;
  }
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isJapanese(value) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(value);
}

export function splitEnglishSentences(value) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (!text) return [];
  const sentences = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)]
    .map((segment) => segment.segment.trim())
    .filter(Boolean);
  if (sentences.length <= 50) return sentences;
  const compact = sentences.slice(0, 49);
  compact.push(sentences.slice(49).join(" "));
  return compact;
}

function translationFailure(error) {
  if (error instanceof ReviewTranslationError) return error;
  if (error instanceof TranslationProviderError) {
    const code = error.status === 503 ? "translation_disabled" : "translation_provider_failed";
    return new ReviewTranslationError(error.message, error.status, code);
  }
  if (error?.name === "AbstractSourceError") {
    return new ReviewTranslationError(error.message, error.status, "abstract_unavailable");
  }
  return new ReviewTranslationError("Translation failed.", 502);
}

export function createReviewTranslationService({
  repository,
  deepLClient,
  fetchImpl = fetch,
  now = Date.now,
}) {
  async function glossaryId() {
    const cached = await repository.getTranslationSetting(glossarySettingKey);
    if (cached) return cached;
    const created = await deepLClient.createGlossary();
    await repository.putTranslationSetting(glossarySettingKey, created, new Date(now()).toISOString());
    return created;
  }

  return {
    async translateTitles(candidateKeys) {
      try {
        const rows = await repository.getTitleTranslationRows(candidateKeys);
        if (rows.length !== candidateKeys.length) {
          throw new ReviewTranslationError("Candidate not found.", 404, "candidate_not_found");
        }
        const result = [];
        const missing = [];
        for (const row of rows) {
          const sourceSha256 = await sha256(row.title);
          if (isJapanese(row.title)) {
            result.push({ candidateKey: row.candidate_key, translatedText: row.title, cached: true, provider: "source" });
          } else if (row.translation_source_sha256 === sourceSha256 && row.translated_text) {
            result.push({
              candidateKey: row.candidate_key,
              translatedText: row.translated_text,
              cached: true,
              provider: row.translation_provider,
            });
          } else {
            missing.push({ row, sourceSha256 });
          }
        }
        if (missing.length) {
          try {
            const id = await glossaryId();
            const translations = await deepLClient.translateEnglishToJapanese(
              missing.map((item) => item.row.title),
              { glossaryId: id },
            );
            const translatedAt = new Date(now()).toISOString();
            const records = missing.map((item, index) => ({
              candidateId: item.row.internal_id,
              sourceSha256: item.sourceSha256,
              translatedText: translations[index].text,
              providerModel: translations[index].model,
              glossaryVersion,
              translatedAt,
            }));
            await repository.saveTitleTranslations(records);
            records.forEach((record, index) => result.push({
              candidateKey: missing[index].row.candidate_key,
              translatedText: record.translatedText,
              cached: false,
              provider: "deepl",
            }));
          } catch (error) {
            const failure = translationFailure(error);
            if (!["translation_disabled", "translation_provider_failed"].includes(failure.code)) throw failure;
            missing.forEach((item) => result.push({
              candidateKey: item.row.candidate_key,
              translatedText: null,
              cached: false,
              provider: "deepl",
              errorCode: failure.code,
            }));
          }
        }
        const byKey = new Map(result.map((item) => [item.candidateKey, item]));
        return candidateKeys.map((key) => byKey.get(key)).filter(Boolean);
      } catch (error) {
        throw translationFailure(error);
      }
    },

    async translateAbstract(candidateKey) {
      try {
        const candidate = await repository.getCandidate(candidateKey);
        if (!candidate) throw new ReviewTranslationError("Candidate not found.", 404, "candidate_not_found");
        const abstract = await fetchEuropePmcAbstract(candidate, fetchImpl);
        const sentences = splitEnglishSentences(abstract.text);
        if (!sentences.length) throw new ReviewTranslationError("Abstract is empty.", 404, "abstract_unavailable");
        const translations = await deepLClient.translateEnglishToJapanese(sentences, {
          glossaryId: await glossaryId(),
        });
        return {
          source: abstract.source,
          sourceUrl: abstract.sourceUrl,
          rightsStatus: abstract.rightsStatus,
          journal: candidate.journal,
          publisher: candidate.publisher,
          journalMetric: candidate.journal_metric_value == null ? null : {
            type: candidate.journal_metric_type,
            value: Number(candidate.journal_metric_value),
            year: Number(candidate.journal_metric_year),
            source: candidate.journal_metric_source,
            sourceUrl: candidate.journal_metric_source_url,
            refreshedAt: candidate.journal_metric_refreshed_at,
          },
          provider: "DeepL API Free",
          sentences: sentences.map((source, index) => ({ source, translation: translations[index].text })),
        };
      } catch (error) {
        throw translationFailure(error);
      }
    },
  };
}
