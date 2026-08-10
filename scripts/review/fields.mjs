import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { projectRoot, sha256 } from "../extraction/shared.mjs";
import { encodeCsv, parseCsv } from "./csv.mjs";
import { generateFieldReviewSql } from "./field-sql.mjs";

const columns = [
  "run_id", "public_id", "field_name", "machine_status", "agreement_count",
  "total_count", "source_aligned", "providers", "evidence_summary", "decision",
  "provenance_provider", "reviewer", "note", "study_decision",
];
const fieldDecisions = new Set(["needs_human_review", "human_verified", "disputed"]);
const studyStatuses = new Set(["needs_human_review", "human_verified", "disputed"]);

function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!command || !["export", "import"].includes(command)) throw new Error("First argument must be export or import");
  const options = { command, outputDir: ".generated/review" };
  for (const argument of rest) {
    const [name, value] = argument.split(/=(.*)/su, 2);
    if (!value) throw new Error(`Option requires a value: ${argument}`);
    if (name === "--result") options.resultPath = value;
    else if (name === "--csv") options.csvPath = value;
    else if (name === "--output-dir") options.outputDir = value;
    else throw new Error(`Unknown option: ${name}`);
  }
  if (!options.resultPath) throw new Error("--result is required");
  if (command === "import" && !options.csvPath) throw new Error("--csv is required for import");
  return options;
}

function reviewBatchPublicId(date) {
  const timestamp = date.toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14);
  return `VERIFY-${timestamp}-${randomUUID().slice(0, 8)}`;
}

function callsFor(result, publicId, fieldName) {
  return result.calls.filter((call) => (
    call.publicId === publicId
    && call.status === "completed"
    && call.result.fields.some((field) => field.fieldName === fieldName)
  ));
}

async function exportFields(options, result) {
  const rows = result.consensus.map((consensus) => {
    const calls = callsFor(result, consensus.publicId, consensus.fieldName);
    const summaries = calls.map((call) => {
      const field = call.result.fields.find((item) => item.fieldName === consensus.fieldName);
      return `${call.provider}: ${field.evidenceSnippet}`;
    });
    return {
      run_id: result.run.publicId,
      public_id: consensus.publicId,
      field_name: consensus.fieldName,
      machine_status: consensus.status,
      agreement_count: consensus.agreementCount,
      total_count: consensus.totalCount,
      source_aligned: consensus.allEvidenceSourceAligned ? "yes" : "no",
      providers: calls.map((call) => call.provider).join("|"),
      evidence_summary: summaries.join(" || "),
      decision: "",
      provenance_provider: "",
      reviewer: "",
      note: "",
      study_decision: "",
    };
  });
  if (!rows.length) throw new Error("Extraction result has no fields to review");
  const outputDir = path.resolve(projectRoot, options.outputDir);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${result.run.publicId}.field-review.csv`);
  await writeFile(outputPath, encodeCsv(rows, columns), "utf8");
  process.stdout.write(`${JSON.stringify({ fields: rows.length, csv: path.relative(projectRoot, outputPath) }, null, 2)}\n`);
}

function validateRows(rows, result) {
  const consensusKeys = new Set(result.consensus.map((item) => `${item.publicId}\n${item.fieldName}`));
  const seen = new Set();
  const decisions = [];
  const studyDecisions = {};
  for (const row of rows) {
    if (!row.decision.trim()) continue;
    const key = `${row.public_id}\n${row.field_name}`;
    if (!consensusKeys.has(key)) throw new Error(`Unknown result field: ${row.public_id} ${row.field_name}`);
    if (seen.has(key)) throw new Error(`Duplicate field decision: ${row.public_id} ${row.field_name}`);
    if (!fieldDecisions.has(row.decision)) throw new Error(`Invalid field decision: ${row.decision}`);
    if (!row.reviewer.trim() || !row.note.trim()) throw new Error(`Reviewer and note are required for ${row.field_name}`);
    const providers = new Set(callsFor(result, row.public_id, row.field_name).map((call) => call.provider));
    if (row.decision !== "needs_human_review" && !providers.has(row.provenance_provider)) {
      throw new Error(`A valid provenance_provider is required for ${row.field_name}`);
    }
    if (row.study_decision) {
      if (!studyStatuses.has(row.study_decision)) throw new Error(`Invalid study decision: ${row.study_decision}`);
      if (studyDecisions[row.public_id] && studyDecisions[row.public_id] !== row.study_decision) {
        throw new Error(`Conflicting study decisions for ${row.public_id}`);
      }
      studyDecisions[row.public_id] = row.study_decision;
    }
    seen.add(key);
    decisions.push({
      publicId: row.public_id,
      fieldName: row.field_name,
      decision: row.decision,
      provenanceProvider: row.provenance_provider || null,
      reviewer: row.reviewer.trim(),
      note: row.note.trim(),
    });
  }
  if (!decisions.length) throw new Error("CSV contains no completed field decisions");
  if (new Set(decisions.map((decision) => decision.reviewer)).size !== 1) {
    throw new Error("One import batch must have exactly one reviewer");
  }
  for (const [publicId, status] of Object.entries(studyDecisions)) {
    if (status !== "human_verified") continue;
    const expectedFields = result.consensus.filter((item) => item.publicId === publicId);
    const reviewed = decisions.filter((item) => item.publicId === publicId && item.decision === "human_verified");
    if (reviewed.length !== expectedFields.length) {
      throw new Error(`Study-level human_verified requires every extracted field to be human_verified: ${publicId}`);
    }
  }
  return { decisions, studyDecisions };
}

async function importFields(options, result) {
  const csvText = await readFile(path.resolve(projectRoot, options.csvPath), "utf8");
  const validated = validateRows(parseCsv(csvText), result);
  const reviewedAt = new Date();
  const batch = {
    publicId: reviewBatchPublicId(reviewedAt),
    sourceArtifactSha256: sha256(csvText),
    reviewer: validated.decisions[0].reviewer,
    reviewedAt: reviewedAt.toISOString(),
  };
  const sql = generateFieldReviewSql({
    batch,
    extractionRunPublicId: result.run.publicId,
    ...validated,
  });
  const outputDir = path.resolve(projectRoot, options.outputDir);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${batch.publicId}.field-review.sql`);
  await writeFile(outputPath, sql, "utf8");
  process.stdout.write(`${JSON.stringify({
    reviewBatchId: batch.publicId,
    decisions: validated.decisions.length,
    studyDecisions: validated.studyDecisions,
    sql: path.relative(projectRoot, outputPath),
  }, null, 2)}\n`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = JSON.parse(await readFile(path.resolve(projectRoot, options.resultPath), "utf8"));
  if (!result.run?.publicId || !Array.isArray(result.consensus) || !Array.isArray(result.calls)) {
    throw new Error("Extraction result is invalid");
  }
  if (options.command === "export") await exportFields(options, result);
  else await importFields(options, result);
}

main().catch((error) => {
  process.stderr.write(`Field review failed: ${error.message}\n`);
  process.exitCode = 1;
});
