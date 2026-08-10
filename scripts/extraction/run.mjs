import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runExtractionPlan } from "./orchestrator.mjs";
import { generateExtractionSql } from "./sql.mjs";
import { loadExtractionInputs, loadJson, projectRoot, verifyPlan } from "./shared.mjs";

function parseArguments(argv) {
  const options = { outputDir: ".generated/extraction" };
  for (const argument of argv) {
    if (argument === "--help") return { help: true };
    const [name, value] = argument.split(/=(.*)/su, 2);
    if (!value) throw new Error(`Option requires a value: ${argument}`);
    if (name === "--plan") options.planPath = value;
    else if (name === "--approve-plan") options.approval = value;
    else if (name === "--output-dir") options.outputDir = value;
    else throw new Error(`Unknown option: ${name}`);
  }
  if (!options.planPath || !options.approval) throw new Error("--plan and --approve-plan are required");
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: npm run extraction:run -- --plan=<plan.json> --approve-plan=<exact-plan-sha256>\n");
    return;
  }
  const { value: plan } = await loadJson(options.planPath);
  if (options.approval !== plan.planSha256) throw new Error("Approval hash does not match the extraction plan");
  const { config, bundle } = await loadExtractionInputs({
    configPath: plan.configPath,
    inputPath: plan.inputPath,
  });
  verifyPlan(plan, config, bundle);
  const result = await runExtractionPlan({ plan, config, bundle });
  const outputDir = path.resolve(projectRoot, options.outputDir);
  await mkdir(outputDir, { recursive: true });
  const resultPath = path.join(outputDir, `${plan.publicId}.result.json`);
  const sqlPath = path.join(outputDir, `${plan.publicId}.sql`);
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeFile(sqlPath, generateExtractionSql(result), "utf8");
  process.stdout.write(`${JSON.stringify({
    runId: plan.publicId,
    status: result.run.status,
    requests: result.run.requestCount,
    completed: result.calls.filter((call) => call.status === "completed").length,
    inputTokens: result.run.inputTokenCount,
    outputTokens: result.run.outputTokenCount,
    result: path.relative(projectRoot, resultPath),
    sql: path.relative(projectRoot, sqlPath),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Extraction run failed: ${error.message}\n`);
  process.exitCode = 1;
});
