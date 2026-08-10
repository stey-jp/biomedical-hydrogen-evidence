import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runExtractionPlan } from "../scripts/extraction/orchestrator.mjs";
import { generateExtractionSql } from "../scripts/extraction/sql.mjs";
import { buildPlan, loadExtractionInputs, verifyPlan } from "../scripts/extraction/shared.mjs";

const configPath = "config/extraction.v1.json";
const inputPath = "fixtures/extraction-source-bundle.synthetic.json";

function providerPayload(url, text) {
  if (url.includes("openai")) {
    return { id: "openai-1", status: "completed", model: "openai-test", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 10, output_tokens: 5 } };
  }
  if (url.includes("anthropic")) {
    return { id: "anthropic-1", model: "anthropic-test", stop_reason: "end_turn", content: [{ type: "text", text }], usage: { input_tokens: 11, output_tokens: 6 } };
  }
  return { id: "gemini-1", status: "completed", model: "gemini-test", output_text: text, usage: { total_input_tokens: 12, total_output_tokens: 7 } };
}

test("planning hashes source inputs and makes no provider request", async () => {
  const { config, bundle } = await loadExtractionInputs({ configPath, inputPath });
  const plan = buildPlan({
    config,
    bundle,
    configPath,
    inputPath,
    providers: ["openai", "anthropic", "gemini"],
    createdAt: new Date("2026-08-11T00:00:00Z"),
  });
  assert.equal(plan.budget.plannedRequests, 3);
  assert.equal(plan.documents[0].contentCharacterCount, bundle.documents[0].content.length);
  assert.equal("content" in plan.documents[0], false);
  assert.doesNotThrow(() => verifyPlan(plan, config, bundle));
  const changed = structuredClone(bundle);
  changed.documents[0].content += " changed";
  assert.throws(() => verifyPlan(plan, config, changed), /changed after planning/u);
});

test("approved providers run independently and consensus requires source-aligned snippets", async () => {
  const previous = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };
  process.env.OPENAI_API_KEY = "test";
  process.env.ANTHROPIC_API_KEY = "test";
  process.env.GEMINI_API_KEY = "test";
  try {
    const { config, bundle } = await loadExtractionInputs({ configPath, inputPath });
    const plan = buildPlan({
      config,
      bundle,
      configPath,
      inputPath,
      providers: ["openai", "anthropic", "gemini"],
      createdAt: new Date("2026-08-11T00:00:00Z"),
    });
    const extracted = JSON.stringify({
      biomedicalRelevance: "yes",
      speciesType: "human",
      fields: [{
        fieldName: "population.participant_count",
        extractedValue: "72",
        normalizedValue: "72",
        confidence: 0.9,
        evidenceSnippet: "72 fictional adult participants",
        section: "methods",
        pageNumber: null,
        locator: "Methods sentence 1",
      }],
    });
    const submittedBodies = [];
    const result = await runExtractionPlan({
      plan,
      config,
      bundle,
      now: () => new Date("2026-08-11T00:00:01Z"),
      fetchImpl: async (url, options) => {
        submittedBodies.push(options.body);
        return new Response(JSON.stringify(providerPayload(url, extracted)), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    assert.equal(result.run.status, "completed");
    assert.equal(result.calls.length, 3);
    assert.equal(result.consensus[0].agreementCount, 3);
    assert.equal(result.consensus[0].status, "agreement");
    assert.equal(result.consensus[0].allEvidenceSourceAligned, true);
    for (const body of submittedBodies) assert.doesNotMatch(body, /openai-1|anthropic-1|gemini-1/u);

    const sql = generateExtractionSql(result);
    assert.match(sql, /consensus_history/u);
    assert.match(sql, /evidence_checks/u);
    assert.match(sql, /machine_checked/u);
    const sourceBundle = await readFile(inputPath, "utf8");
    const sourceText = JSON.parse(sourceBundle).documents[0].content;
    assert.doesNotMatch(sql, new RegExp(sourceText.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("missing provider credentials prevents all paid requests before execution", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const { config, bundle } = await loadExtractionInputs({ configPath, inputPath });
    const plan = buildPlan({ config, bundle, configPath, inputPath, providers: ["openai"] });
    let requests = 0;
    await assert.rejects(
      runExtractionPlan({ plan, config, bundle, fetchImpl: async () => { requests += 1; } }),
      /OPENAI_API_KEY is required/u,
    );
    assert.equal(requests, 0);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
