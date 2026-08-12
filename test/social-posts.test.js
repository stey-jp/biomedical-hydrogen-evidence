import test from "node:test";
import assert from "node:assert/strict";
import {
  createReviewSocialPostService,
  ReviewSocialPostError,
} from "../src/services/review-social-posts.js";

const candidate = {
  candidate_key: "pmid:12345",
  title: "Molecular hydrogen reduced a synthetic outcome",
  publication_year: 2025,
  journal: "Test Journal",
  authors_json: "[\"A. Author\"]",
  doi: "10.1000/social",
  pmid: "12345",
  pmcid: null,
  source_url: "https://example.test/article",
};

test("review social post service sends the source abstract directly to OpenAI structured output", async () => {
  let openAIRequest;
  const service = createReviewSocialPostService({
    repository: {
      async getBookmarkedCandidate(reviewer, candidateKey) {
        assert.equal(reviewer, "reviewer-1");
        assert.equal(candidateKey, candidate.candidate_key);
        return candidate;
      },
    },
    openAIApiKey: "test-review-key",
    openAIModel: "test-openai-model",
    now: () => Date.parse("2026-08-12T01:00:00.000Z"),
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      if (parsed.hostname === "api.openai.com") {
        openAIRequest = { url: parsed, headers: options.headers, body: JSON.parse(options.body) };
        return Response.json({
          id: "resp_social",
          status: "completed",
          model: "test-openai-model-2026-08-12",
          output: [{
            type: "message",
            content: [{
              type: "output_text",
              text: JSON.stringify({
                titleJa: "分子状水素が合成アウトカムを低下させた研究",
                summaryJa: "合成試験で分子状水素を検討した抄録ベースの要約です。",
                postBody: "分子状水素を検討した研究を紹介します。抄録に基づく単一研究の情報で、医療助言ではありません。",
                hashtags: ["#分子状水素", "医学研究"],
              }),
            }],
          }],
          usage: { input_tokens: 321, output_tokens: 123 },
        }, { headers: { "request-id": "req_social" } });
      }
      assert.equal(parsed.hostname, "www.ebi.ac.uk");
      return Response.json({
        resultList: {
          result: [{
            pmid: "12345",
            abstractText: "This synthetic abstract reports the study design and its main result.",
          }],
        },
      });
    },
  });

  const result = await service.generate({
    candidateKey: candidate.candidate_key,
    reviewer: "reviewer-1",
    format: "x",
    customInstruction: "限界を明確にする。",
  });

  assert.equal(openAIRequest.url.href, "https://api.openai.com/v1/responses");
  assert.equal(openAIRequest.headers.authorization, "Bearer test-review-key");
  assert.equal(openAIRequest.body.model, "test-openai-model");
  assert.equal(openAIRequest.body.store, false);
  assert.equal(openAIRequest.body.reasoning.effort, "max");
  assert.equal(openAIRequest.body.max_output_tokens, 12_000);
  assert.equal(openAIRequest.body.text.format.type, "json_schema");
  assert.equal(openAIRequest.body.text.format.strict, true);
  assert.match(openAIRequest.body.input[1].content, /This synthetic abstract/u);
  assert.match(openAIRequest.body.input[1].content, /限界を明確にする/u);
  assert.equal(result.titleJa, "分子状水素が合成アウトカムを低下させた研究");
  assert.match(result.socialPost, /#分子状水素 #医学研究/u);
  assert.match(result.socialPost, /https:\/\/europepmc\.org\/article\/MED\/12345/u);
  assert.equal(result.externalRequestId, "resp_social");
  assert.deepEqual(result.usage, { inputTokens: 321, outputTokens: 123 });
});

test("review social post service requires its dedicated key before fetching an abstract", async () => {
  let fetched = false;
  const service = createReviewSocialPostService({
    repository: {},
    openAIApiKey: "",
    fetchImpl: async () => {
      fetched = true;
      throw new Error("must not fetch");
    },
  });

  await assert.rejects(
    service.generate({ candidateKey: "candidate", reviewer: "reviewer", format: "x" }),
    (error) => error instanceof ReviewSocialPostError
      && error.status === 503
      && error.code === "generation_disabled",
  );
  assert.equal(fetched, false);
});

test("review social post service only accepts a bookmarked candidate for the reviewer", async () => {
  const service = createReviewSocialPostService({
    repository: { async getBookmarkedCandidate() { return null; } },
    openAIApiKey: "test-review-key",
  });

  await assert.rejects(
    service.generate({ candidateKey: "candidate", reviewer: "reviewer", format: "standard" }),
    (error) => error instanceof ReviewSocialPostError
      && error.status === 404
      && error.code === "bookmark_not_found",
  );
});
