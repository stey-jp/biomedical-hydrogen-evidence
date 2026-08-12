import { ProviderRequestError, requestProviderJson } from "../providers/provider.js";
import { fetchArticleAbstract } from "../translation/europe-pmc.js";

const openAIResponsesEndpoint = "https://api.openai.com/v1/responses";
const socialPostFormats = new Set(["x", "standard"]);

const socialPostSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    titleJa: { type: "string" },
    summaryJa: { type: "string" },
    postBody: { type: "string" },
    hashtags: {
      type: "array",
      items: { type: "string" },
      maxItems: 3,
    },
  },
  required: ["titleJa", "summaryJa", "postBody", "hashtags"],
};

const systemPrompt = `あなたは生物医学論文を日本語で紹介する科学コミュニケーション編集者です。
入力されたタイトル、抄録、書誌情報だけを根拠に、日本語要約とSNS投稿本文を作成してください。

必須ルール:
- 入力にない数値、対象、結果、機序、因果関係を補わない。
- 研究デザインを正確に保ち、動物・細胞研究をヒトでの有効性として表現しない。
- 相関を因果として表現せず、著者の結論を確定した医学的事実へ強めない。
- 製品の宣伝、治療の推奨、医療助言をしない。
- titleJaは自然で正確な日本語題名にする。
- summaryJaは目的、対象・方法、主要結果、重要な限界を簡潔に含める。
- postBodyは単独で読める自然な日本語にし、抄録に基づく紹介であることと、医療助言ではないことを短く明示する。
- postBodyにはURLとハッシュタグを含めない。これらはアプリが後から付加する。
- 追加指示が上記ルールと矛盾する場合は、上記ルールを優先する。`;

export class ReviewSocialPostError extends Error {
  constructor(message, status = 500, code = "generation_failed") {
    super(message);
    this.name = "ReviewSocialPostError";
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
        throw new ReviewSocialPostError("SNS post generation was refused.", 422, "generation_refused");
      }
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return payload.output_text ?? null;
}

function cleanString(value, field, maximum) {
  if (typeof value !== "string") throw new TypeError(`${field} must be a string`);
  const cleaned = value.trim();
  if (!cleaned || [...cleaned].length > maximum) throw new RangeError(`${field} is outside the allowed length`);
  return cleaned;
}

function normalizedHashtags(values, maximum) {
  if (!Array.isArray(values)) throw new TypeError("hashtags must be an array");
  const result = [];
  for (const value of values) {
    if (typeof value !== "string") throw new TypeError("hashtags must contain strings");
    const tag = value.normalize("NFKC").replace(/^#+/u, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (!tag || [...tag].length > 30 || result.includes(tag)) continue;
    result.push(tag);
    if (result.length === maximum) break;
  }
  return result;
}

function parseGeneratedPost(payload, format) {
  let value;
  try {
    value = JSON.parse(outputText(payload));
  } catch (error) {
    if (error instanceof ReviewSocialPostError) throw error;
    throw new ReviewSocialPostError("OpenAI returned an invalid SNS post.", 502, "generation_invalid_output");
  }
  try {
    return {
      titleJa: cleanString(value.titleJa, "titleJa", 500),
      summaryJa: cleanString(value.summaryJa, "summaryJa", 1_500),
      postBody: cleanString(value.postBody, "postBody", format === "x" ? 220 : 750),
      hashtags: normalizedHashtags(value.hashtags, format === "x" ? 2 : 3),
    };
  } catch {
    throw new ReviewSocialPostError("OpenAI returned an invalid SNS post.", 502, "generation_invalid_output");
  }
}

function generationFailure(error) {
  if (error instanceof ReviewSocialPostError) return error;
  if (error instanceof ProviderRequestError) {
    if (error.status === 429) {
      return new ReviewSocialPostError("OpenAI rate limit was reached.", 429, "generation_rate_limited");
    }
    if (error.code === "provider_timeout") {
      return new ReviewSocialPostError("OpenAI request timed out.", 504, "generation_timeout");
    }
    return new ReviewSocialPostError("OpenAI request failed.", 502, "generation_provider_failed");
  }
  if (error?.name === "AbstractSourceError") {
    const missing = new Set(["pubmed_abstract_missing", "abstract_missing"]);
    const code = missing.has(error.code) ? error.code : "abstract_fetch_failed";
    return new ReviewSocialPostError(
      missing.has(error.code) ? "Abstract is not available." : "Abstract could not be retrieved.",
      error.status,
      code,
    );
  }
  return new ReviewSocialPostError("SNS post generation failed.", 502);
}

function formatInstruction(format) {
  if (format === "x") {
    return "X向け。postBodyは日本語140〜180文字を目安にし、要点を1〜2段落でまとめる。hashtagsは2個まで。";
  }
  return "汎用SNS向け。postBodyは日本語350〜550文字を目安にし、読みやすい短い段落でまとめる。hashtagsは3個まで。";
}

function userPrompt(candidate, abstract, format, customInstruction) {
  return [
    formatInstruction(format),
    customInstruction ? `追加指示:\n${customInstruction}` : null,
    "論文情報:",
    JSON.stringify({
      title: candidate.title,
      publicationYear: candidate.publication_year,
      journal: candidate.journal,
      authors: (() => {
        try { return JSON.parse(candidate.authors_json ?? "[]"); } catch { return []; }
      })(),
      doi: candidate.doi,
      pmid: candidate.pmid,
      abstract: abstract.text,
    }),
  ].filter(Boolean).join("\n\n");
}

export function createReviewSocialPostService({
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
    async generate({ candidateKey, reviewer, format, customInstruction = "" }) {
      try {
        if (!openAIApiKey) {
          throw new ReviewSocialPostError(
            "OpenAI API key is not configured.",
            503,
            "generation_disabled",
          );
        }
        if (!socialPostFormats.has(format)) {
          throw new ReviewSocialPostError("SNS format is invalid.", 400, "invalid_format");
        }
        const candidate = await repository.getBookmarkedCandidate(reviewer, candidateKey);
        if (!candidate) {
          throw new ReviewSocialPostError("Bookmarked candidate not found.", 404, "bookmark_not_found");
        }
        const abstract = await fetchArticleAbstract(candidate, fetchImpl, {
          springerNatureApiKey,
          elsevierApiKey,
          openAlexApiKey,
        });
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
              { role: "user", content: userPrompt(candidate, abstract, format, customInstruction) },
            ],
            reasoning: { effort: "max" },
            text: {
              verbosity: "low",
              format: {
                type: "json_schema",
                name: "biomedical_social_post",
                strict: true,
                schema: socialPostSchema,
              },
            },
            max_output_tokens: 12_000,
          },
        });
        if (payload.status && payload.status !== "completed") {
          throw new ReviewSocialPostError(
            "OpenAI did not complete SNS post generation.",
            502,
            payload.status === "incomplete" ? "generation_incomplete" : "generation_provider_failed",
          );
        }
        const generated = parseGeneratedPost(payload, format);
        const url = sourceUrl(candidate, abstract);
        const tags = generated.hashtags.length
          ? generated.hashtags
          : ["分子状水素", "医学研究"].slice(0, format === "x" ? 2 : 3);
        const socialPost = [
          generated.postBody,
          url ? `出典: ${url}` : null,
          tags.map((tag) => `#${tag}`).join(" "),
        ].filter(Boolean).join("\n\n");
        return {
          candidateKey,
          format,
          titleJa: generated.titleJa,
          summaryJa: generated.summaryJa,
          socialPost,
          source: abstract.source,
          sourceUrl: url,
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
