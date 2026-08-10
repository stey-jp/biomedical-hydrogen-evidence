import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runExtractionPlan } from "./orchestrator.mjs";
import { generateExtractionSql } from "./sql.mjs";
import { buildPlan, loadExtractionInputs, projectRoot } from "./shared.mjs";

function responseFor(url, outputText) {
  if (url.includes("openai.com")) {
    return { id: "fixture-openai", status: "completed", model: "fixture-openai", output: [{ type: "message", content: [{ type: "output_text", text: outputText }] }], usage: { input_tokens: 100, output_tokens: 40 } };
  }
  if (url.includes("anthropic.com")) {
    return { id: "fixture-anthropic", model: "fixture-anthropic", stop_reason: "end_turn", content: [{ type: "text", text: outputText }], usage: { input_tokens: 110, output_tokens: 45 } };
  }
  return { id: "fixture-gemini", status: "completed", model: "fixture-gemini", output_text: outputText, usage: { total_input_tokens: 105, total_output_tokens: 42 } };
}

async function main() {
  const configPath = "config/extraction.v1.json";
  const inputPath = "fixtures/extraction-source-bundle.synthetic.json";
  const { config, bundle } = await loadExtractionInputs({ configPath, inputPath });
  if (bundle.documents.some((document) => !document.publicId.startsWith("BHE-FIXTURE-"))) {
    throw new Error("Dry run accepts synthetic fixture documents only");
  }
  const plan = buildPlan({
    config,
    bundle,
    configPath,
    inputPath,
    providers: ["openai", "anthropic", "gemini"],
  });
  const outputText = JSON.stringify({
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
  const previous = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };
  process.env.OPENAI_API_KEY = "synthetic-dry-run";
  process.env.ANTHROPIC_API_KEY = "synthetic-dry-run";
  process.env.GEMINI_API_KEY = "synthetic-dry-run";
  try {
    const result = await runExtractionPlan({
      plan,
      config,
      bundle,
      fetchImpl: async (url) => new Response(JSON.stringify(responseFor(url, outputText)), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    });
    const outputDir = path.resolve(projectRoot, ".generated/extraction");
    await mkdir(outputDir, { recursive: true });
    const resultPath = path.join(outputDir, "synthetic-dry-run.result.json");
    const sqlPath = path.join(outputDir, "synthetic-dry-run.sql");
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await writeFile(sqlPath, generateExtractionSql(result), "utf8");
    process.stdout.write(`${JSON.stringify({
      runId: result.run.publicId,
      status: result.run.status,
      requests: result.run.requestCount,
      consensus: result.consensus.length,
      result: path.relative(projectRoot, resultPath),
      sql: path.relative(projectRoot, sqlPath),
      notice: "Synthetic dry run used injected responses and made zero provider network requests.",
    }, null, 2)}\n`);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error) => {
  process.stderr.write(`Synthetic extraction dry run failed: ${error.message}\n`);
  process.exitCode = 1;
});
