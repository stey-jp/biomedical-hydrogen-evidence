import test from "node:test";
import assert from "node:assert/strict";
import { extractionJsonSchema } from "../src/extraction/schema.js";
import { AnthropicExtractionProvider } from "../src/providers/anthropic.js";
import { GeminiExtractionProvider } from "../src/providers/gemini.js";
import { OpenAIExtractionProvider } from "../src/providers/openai.js";

const request = {
  systemPrompt: "Extract evidence.",
  userPrompt: "Synthetic source.",
  jsonSchema: extractionJsonSchema,
  maxOutputTokens: 500,
};

function jsonResponse(payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("OpenAI adapter uses Responses structured output without response storage", async () => {
  let submitted;
  const provider = new OpenAIExtractionProvider({
    endpoint: "https://api.openai.test/v1/responses",
    model: "test-openai",
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      submitted = { headers: options.headers, body: JSON.parse(options.body) };
      return jsonResponse({
        id: "resp_test",
        status: "completed",
        model: "test-openai-2026",
        output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }],
        usage: { input_tokens: 10, output_tokens: 2 },
      });
    },
  });

  const result = await provider.extract(request);
  assert.equal(submitted.body.store, false);
  assert.equal(submitted.body.text.format.type, "json_schema");
  assert.equal(submitted.body.text.format.strict, true);
  assert.equal(submitted.headers.authorization, "Bearer test-key");
  assert.equal(result.externalRequestId, "resp_test");
});

test("Anthropic adapter uses current output_config.format shape", async () => {
  let submitted;
  const provider = new AnthropicExtractionProvider({
    endpoint: "https://api.anthropic.test/v1/messages",
    model: "test-anthropic",
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      submitted = { headers: options.headers, body: JSON.parse(options.body) };
      return jsonResponse({
        id: "msg_test",
        model: "test-anthropic-2026",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "{}" }],
        usage: { input_tokens: 11, output_tokens: 3 },
      });
    },
  });

  const result = await provider.extract(request);
  assert.equal(submitted.body.output_config.format.type, "json_schema");
  assert.equal(submitted.headers["anthropic-version"], "2023-06-01");
  assert.equal(result.usage.inputTokens, 11);
});

test("Gemini adapter uses current Interactions API response_format and disables storage", async () => {
  let submitted;
  const provider = new GeminiExtractionProvider({
    endpoint: "https://generativelanguage.test/v1beta/interactions",
    model: "test-gemini",
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      submitted = { headers: options.headers, body: JSON.parse(options.body) };
      return jsonResponse({
        id: "interaction_test",
        status: "completed",
        model: "test-gemini-2026",
        output_text: "{}",
        usage: { total_input_tokens: 12, total_output_tokens: 4 },
      });
    },
  });

  const result = await provider.extract(request);
  assert.equal(submitted.body.store, false);
  assert.equal(submitted.body.response_format.mime_type, "application/json");
  assert.equal(submitted.body.generation_config.max_output_tokens, 500);
  assert.equal(result.usage.outputTokens, 4);
});

test("provider errors do not expose a response body that may echo source text", async () => {
  const provider = new OpenAIExtractionProvider({
    endpoint: "https://api.openai.test/v1/responses",
    model: "test-openai",
    apiKey: "test-key",
    fetchImpl: async () => new Response("SECRET SOURCE TEXT", { status: 500 }),
  });
  await assert.rejects(provider.extract(request), (error) => {
    assert.doesNotMatch(error.message, /SECRET SOURCE TEXT/u);
    assert.equal(error.status, 500);
    return true;
  });
});
