import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { buildPlan, loadExtractionInputs, projectRoot } from "./shared.mjs";

function parseArguments(argv) {
  const options = {
    configPath: "config/extraction.v1.json",
    providers: ["openai", "anthropic", "gemini"],
    outputDir: ".generated/extraction",
  };
  for (const argument of argv) {
    if (argument === "--help") return { help: true };
    const [name, value] = argument.split(/=(.*)/su, 2);
    if (!value) throw new Error(`Option requires a value: ${argument}`);
    if (name === "--input") options.inputPath = value;
    else if (name === "--config") options.configPath = value;
    else if (name === "--providers") options.providers = value.split(",").map((item) => item.trim()).filter(Boolean);
    else if (name === "--output-dir") options.outputDir = value;
    else throw new Error(`Unknown option: ${name}`);
  }
  if (!options.inputPath) throw new Error("--input is required");
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: npm run extraction:plan -- --input=<source-bundle.json> [--providers=openai,anthropic,gemini]\n");
    return;
  }
  const { config, bundle } = await loadExtractionInputs(options);
  const plan = buildPlan({
    config,
    bundle,
    configPath: options.configPath,
    inputPath: options.inputPath,
    providers: options.providers,
  });
  const outputDir = path.resolve(projectRoot, options.outputDir);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${plan.publicId}.plan.json`);
  await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    runId: plan.publicId,
    documents: plan.documents.length,
    providers: plan.providers.map((provider) => provider.name),
    plannedRequests: plan.budget.plannedRequests,
    plan: path.relative(projectRoot, outputPath),
    approval: `--approve-plan=${plan.planSha256}`,
    notice: "No provider request was made. Review the plan before approval.",
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Extraction planning failed: ${error.message}\n`);
  process.exitCode = 1;
});
