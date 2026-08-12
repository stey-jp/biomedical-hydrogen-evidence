import { ProviderRequestError, requestProviderJson } from "../providers/provider.js";
import { fetchArticleAbstract } from "../translation/europe-pmc.js";

const openAIResponsesEndpoint = "https://api.openai.com/v1/responses";

export const colloquialLevels = new Map([
  ["elementary", "小学生に分かる文章。要点だけをさらに絞って。"],
  ["junior_high", "中学生に分かる文章。要点だけをさらに絞って。"],
  ["high_school", "高校生に分かる文章。要点だけをさらに絞って。"],
]);

const colloquialSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          candidateKey: { type: "string" },
          colloquialText: { type: "string" },
        },
        required: ["candidateKey", "colloquialText"],
      },
    },
  },
  required: ["items"],
};

const systemPrompt = `あなたは生物医学論文を正確で親しみやすい日本語に言い換える科学コミュニケーション編集者です。
入力されたタイトル、抄録、書誌情報だけを根拠に、指定された読解レベルの口語的な説明文を論文ごとに作成してください。

必須ルール:
- 入力にない数値、対象、結果、機序、因果関係を補わない。
- 研究デザインを正確に保ち、動物・細胞研究をヒトでの有効性として表現しない。
- 相関を因果として表現せず、著者の結論を確定した医学的事実へ強めない。
- 製品の宣伝、治療の推奨、医療助言をしない。
- 専門用語は読解レベルに応じて短く説明する。
- 目的、対象・方法、主要結果、重要な限界を省かない。
- URL、ハッシュタグ、見出し、箇条書きは含めず、単独で読める自然な本文にする。
- candidateKeyは入力値を一字も変えず、その論文と対応する本文を返す。`;

export class ReviewColloquialError extends Error {
  constructor(message, status = 500, code = "generation_failed") {
    super(message);
    this.name = "ReviewColloquialError";
    this.status = status;
    this.code = code;
  }
}

function sourceUrl(candidate, abstract) {
  if (abstract.sourceUrl) return abstract.sourceUrl;
  if (candidate.source_url) return candidate.source_url;
  if (candidate.doi) return `https://doi.org/${encodeURIComponent(candidate.doi)}`;
  if (candidate.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(candidate.pmid)}/`;
  if (candidate.pmcid) return `https://pmc.ncbi.nlm.nih.gov/articles/${encodeURIComponent(candidate.pmcid)}/`;
  return null;
}

function outputText(payload) {
  for (const item of payload.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "refusal") {
        throw new ReviewColloquialError("Colloquial translation was refused.", 422, "generation_refused");
      }
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return payload.output_text ?? null;
}

function cleanText(value) {
  if (typeof value !== "string") throw new TypeError("colloquialText must be a string");
  const cleaned = value.trim();
  if (!cleaned || [...cleaned].length > 1_500) {
    throw new RangeError("colloquialText is outside the allowed length");
  }
  return cleaned;
}

function parseGenerated(payload, candidateKeys) {
  let value;
  try {
    value = JSON.parse(outputText(payload));
  } catch (error) {
    if (error instanceof ReviewColloquialError) throw error;
    throw new ReviewColloquialError("OpenAI returned invalid colloquial translations.", 502, "generation_invalid_output");
  }
  try {
    if (!Array.isArray(value.items) || value.items.length !== candidateKeys.length) throw new TypeError();
    const byKey = new Map(value.items.map((item) => [item.candidateKey, cleanText(item.colloquialText)]));
    if (byKey.size !== candidateKeys.length || candidateKeys.some((key) => !byKey.has(key))) throw new TypeError();
    return candidateKeys.map((candidateKey) => ({
      candidateKey,
      colloquialText: byKey.get(candidateKey),
    }));
  } catch {
    throw new ReviewColloquialError("OpenAI returned invalid colloquial translations.", 502, "generation_invalid_output");
  }
}

function generationFailure(error) {
  if (error instanceof ReviewColloquialError) return error;
  if (error instanceof ProviderRequestError) {
    if (error.status === 429) {
      return new ReviewColloquialError("OpenAI rate limit was reached.", 429, "generation_rate_limited");
    }
    if (error.code === "provider_timeout") {
      return new ReviewColloquialError("OpenAI request timed out.", 504, "generation_timeout");
    }
    return new ReviewColloquialError("OpenAI request failed.", 502, "generation_provider_failed");
  }
  if (error?.name === "AbstractSourceError") {
    const missing = new Set(["pubmed_abstract_missing", "abstract_missing"]);
    const code = missing.has(error.code) ? error.code : "abstract_fetch_failed";
    return new ReviewColloquialError(
      missing.has(error.code) ? "Abstract is not available." : "Abstract could not be retrieved.",
      error.status,
      code,
    );
  }
  return new ReviewColloquialError("Colloquial translation failed.", 502);
}

function authors(candidate) {
  try {
    const values = JSON.parse(candidate.authors_json ?? "[]");
    return Array.isArray(values) ? values : [];
  } catch {
    return [];
  }
}

function userPrompt(level, articles) {
  return [
    `口語訳レベル: ${colloquialLevels.get(level)}`,
    "論文情報:",
    JSON.stringify(articles.map(({ candidate, abstract }) => ({
      candidateKey: candidate.candidate_key,
      title: candidate.title,
      titleJa: candidate.translated_title ?? null,
      publicationYear: candidate.publication_year,
      journal: candidate.journal,
      authors: authors(candidate),
      doi: candidate.doi,
      pmid: candidate.pmid,
      abstract: abstract.text,
    }))),
  ].join("\n\n");
}

export function createReviewColloquialService({
  repository,
  openAIApiKey,
  openAIModel = "gpt-5.6-luna",
  fetchImpl = fetch,
  springerNatureApiKey = "",
  elsevierApiKey = "",
  openAlexApiKey = "",
  now = Date.now,
}) {
  return {
    async generate({ candidateKeys, reviewer, level }) {
      try {
        if (!openAIApiKey) {
          throw new ReviewColloquialError(
            "OpenAI API key is not configured.",
            503,
            "generation_disabled",
          );
        }
        if (!Array.isArray(candidateKeys) || !candidateKeys.length || candidateKeys.length > 10) {
          throw new ReviewColloquialError("Candidate selection is invalid.", 400, "invalid_selection");
        }
        if (!colloquialLevels.has(level)) {
          throw new ReviewColloquialError("Colloquial level is invalid.", 400, "invalid_level");
        }
        const candidates = await Promise.all(candidateKeys.map((key) => repository.getBookmarkedCandidate(reviewer, key)));
        if (candidates.some((candidate) => !candidate)) {
          throw new ReviewColloquialError("Bookmarked candidate not found.", 404, "bookmark_not_found");
        }
        const abstracts = await Promise.all(candidates.map((candidate) => fetchArticleAbstract(candidate, fetchImpl, {
          springerNatureApiKey,
          elsevierApiKey,
          openAlexApiKey,
        })));
        const articles = candidates.map((candidate, index) => ({ candidate, abstract: abstracts[index] }));
        const { payload, requestId } = await requestProviderJson("openai", {
          url: openAIResponsesEndpoint,
          fetchImpl,
          headers: {
            authorization: `Bearer ${openAIApiKey}`,
            "content-type": "application/json",
          },
          body: {
            model: openAIModel,
            store: false,
            input: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt(level, articles) },
            ],
            reasoning: { effort: "max" },
            text: {
              verbosity: "low",
              format: {
                type: "json_schema",
                name: "biomedical_colloquial_translations",
                strict: true,
                schema: colloquialSchema,
              },
            },
            max_output_tokens: 16_000,
          },
        });
        if (payload.status && payload.status !== "completed") {
          throw new ReviewColloquialError(
            "OpenAI did not complete colloquial translation.",
            502,
            payload.status === "incomplete" ? "generation_incomplete" : "generation_provider_failed",
          );
        }
        const generated = parseGenerated(payload, candidateKeys);
        return {
          level,
          items: generated.map((item, index) => ({
            ...item,
            originalTitle: candidates[index].title,
            titleJa: candidates[index].translated_title ?? null,
            source: abstracts[index].source,
            sourceUrl: sourceUrl(candidates[index], abstracts[index]),
          })),
          provider: "OpenAI",
          model: payload.model ?? openAIModel,
          externalRequestId: payload.id ?? requestId ?? null,
          generatedAt: new Date(now()).toISOString(),
          usage: {
            inputTokens: payload.usage?.input_tokens ?? null,
            outputTokens: payload.usage?.output_tokens ?? null,
          },
        };
      } catch (error) {
        throw generationFailure(error);
      }
    },
  };
}
