import test from "node:test";
import assert from "node:assert/strict";
import {
  createReviewColloquialService,
  ReviewColloquialError,
} from "../src/services/review-colloquial.js";

const candidates = [
  {
    candidate_key: "pmid:12345",
    title: "Molecular hydrogen reduced a synthetic outcome",
    translated_title: "分子状水素が合成アウトカムを低下させた研究",
    publication_year: 2025,
    journal: "Test Journal",
    authors_json: "[\"A. Author\"]",
    doi: "10.1000/colloquial-1",
    pmid: "12345",
    pmcid: null,
    source_url: "https://example.test/article-1",
  },
  {
    candidate_key: "pmid:67890",
    title: "A second synthetic hydrogen study",
    translated_title: "2件目の合成水素研究",
    publication_year: 2024,
    journal: "Test Journal",
    authors_json: "[\"B. Author\"]",
    doi: "10.1000/colloquial-2",
    pmid: "67890",
    pmcid: null,
    source_url: "https://example.test/article-2",
  },
];

test("review colloquial service batches selected bookmarks in one structured OpenAI request", async () => {
  let openAIRequest;
  const service = createReviewColloquialService({
    repository: {
      async getBookmarkedCandidate(reviewer, candidateKey) {
        assert.equal(reviewer, "reviewer-1");
        return candidates.find((candidate) => candidate.candidate_key === candidateKey) ?? null;
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
          id: "resp_colloquial",
          status: "completed",
          model: "test-openai-model-2026-08-12",
          output: [{
            type: "message",
            content: [{
              type: "output_text",
              text: JSON.stringify({
                items: [
                  {
                    candidateKey: "pmid:12345",
                    colloquialText: "水素について調べた一つ目の研究です。研究だけでは効果を断定できません。",
                  },
                  {
                    candidateKey: "pmid:67890",
                    colloquialText: "水素について調べた二つ目の研究です。研究だけでは効果を断定できません。",
                  },
                ],
              }),
            }],
          }],
          usage: { input_tokens: 521, output_tokens: 223 },
        }, { headers: { "request-id": "req_colloquial" } });
      }
      if (parsed.hostname === "www.ebi.ac.uk") {
        const pmid = parsed.searchParams.get("query")?.includes("67890") ? "67890" : "12345";
        return Response.json({
          resultList: {
            result: [{
              pmid,
              abstractText: `This is the synthetic abstract for ${pmid}.`,
            }],
          },
        });
      }
      return Response.json({});
    },
  });

  const result = await service.generate({
    candidateKeys: candidates.map((candidate) => candidate.candidate_key),
    reviewer: "reviewer-1",
    level: "elementary",
  });

  assert.equal(openAIRequest.url.href, "https://api.openai.com/v1/responses");
  assert.equal(openAIRequest.headers.authorization, "Bearer test-review-key");
  assert.equal(openAIRequest.body.model, "test-openai-model");
  assert.equal(openAIRequest.body.store, false);
  assert.equal(openAIRequest.body.reasoning.effort, "max");
  assert.equal(openAIRequest.body.max_output_tokens, 16_000);
  assert.equal(openAIRequest.body.text.format.type, "json_schema");
  assert.equal(openAIRequest.body.text.format.strict, true);
  assert.match(openAIRequest.body.input[1].content, /小学生に分かる文章/u);
  assert.match(openAIRequest.body.input[1].content, /This is the synthetic abstract for 12345/u);
  assert.match(openAIRequest.body.input[1].content, /This is the synthetic abstract for 67890/u);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].titleJa, candidates[0].translated_title);
  assert.match(result.items[0].colloquialText, /一つ目/u);
  assert.equal(result.externalRequestId, "resp_colloquial");
  assert.deepEqual(result.usage, { inputTokens: 521, outputTokens: 223 });
});

test("review colloquial service requires its dedicated key before fetching abstracts", async () => {
  let fetched = false;
  const service = createReviewColloquialService({
    repository: {},
    openAIApiKey: "",
    fetchImpl: async () => {
      fetched = true;
      throw new Error("must not fetch");
    },
  });

  await assert.rejects(
    service.generate({ candidateKeys: ["candidate"], reviewer: "reviewer", level: "elementary" }),
    (error) => error instanceof ReviewColloquialError
      && error.status === 503
      && error.code === "generation_disabled",
  );
  assert.equal(fetched, false);
});

test("review colloquial service only accepts candidates bookmarked by the reviewer", async () => {
  const service = createReviewColloquialService({
    repository: { async getBookmarkedCandidate() { return null; } },
    openAIApiKey: "test-review-key",
  });

  await assert.rejects(
    service.generate({ candidateKeys: ["candidate"], reviewer: "reviewer", level: "high_school" }),
    (error) => error instanceof ReviewColloquialError
      && error.status === 404
      && error.code === "bookmark_not_found",
  );
});
