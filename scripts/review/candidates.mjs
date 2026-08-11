import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { encodeCsv, parseCsv } from "./csv.mjs";
import { generateCandidateReviewSql } from "./candidate-sql.mjs";
import { hashObject, projectRoot, sha256 } from "../extraction/shared.mjs";
import {
  assertReviewRowsReady,
  buildCandidateReviewRows,
  candidateReviewColumns,
  chunkReviewRows,
  screeningHints,
} from "./candidate-batches.mjs";

const decisions = new Set(["include", "exclude", "duplicate", "needs_review"]);

function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!command || !["export", "import"].includes(command)) throw new Error("First argument must be export or import");
  const options = { command, outputDir: ".generated/review", promoteIncludes: false };
  for (const argument of rest) {
    if (argument === "--promote-includes") {
      options.promoteIncludes = true;
      continue;
    }
    const [name, value] = argument.split(/=(.*)/su, 2);
    if (!value) throw new Error(`Option requires a value: ${argument}`);
    if (name === "--manifest") options.manifestPath = value;
    else if (name === "--csv") options.csvPath = value;
    else if (name === "--output-dir") options.outputDir = value;
    else if (name === "--approve-promotion") options.promotionApproval = value;
    else if (name === "--screening-hint") options.screeningHint = value;
    else if (name === "--batch-size") options.batchSize = Number(value);
    else throw new Error(`Unknown option: ${name}`);
  }
  if (!options.manifestPath) throw new Error("--manifest is required");
  if (command === "import" && !options.csvPath) throw new Error("--csv is required for import");
  if (command === "import" && (options.screeningHint || options.batchSize)) {
    throw new Error("--screening-hint and --batch-size are export-only options");
  }
  if (options.screeningHint && !screeningHints.has(options.screeningHint)) {
    throw new Error(`Invalid screening hint: ${options.screeningHint}`);
  }
  if (options.batchSize !== undefined
    && (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 1000)) {
    throw new Error("--batch-size must be an integer between 1 and 1000");
  }
  return options;
}

function batchPublicId(date) {
  const timestamp = date.toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14);
  return `REVIEW-${timestamp}-${randomUUID().slice(0, 8)}`;
}

async function exportCandidates(options, manifest) {
  const screeningHint = options.screeningHint ?? "all";
  const rows = buildCandidateReviewRows(manifest.candidates, {
    screeningHint,
    prioritized: options.batchSize !== undefined,
  });
  const quality = assertReviewRowsReady(rows);
  const outputDir = path.resolve(projectRoot, options.outputDir);
  await mkdir(outputDir, { recursive: true });
  if (options.batchSize === undefined) {
    const suffix = screeningHint === "all" ? "" : `.${screeningHint}`;
    const outputPath = path.join(outputDir, `${manifest.run.publicId}.candidate-review${suffix}.csv`);
    await writeFile(outputPath, encodeCsv(rows, candidateReviewColumns), "utf8");
    process.stdout.write(`${JSON.stringify({
      candidates: rows.length,
      screeningHint,
      csv: path.relative(projectRoot, outputPath),
    }, null, 2)}\n`);
    return;
  }

  const baseName = `${manifest.run.publicId}.candidate-review.${screeningHint}`;
  const batches = chunkReviewRows(rows, options.batchSize);
  const batchFiles = [];
  for (const [index, batchRows] of batches.entries()) {
    const batchNumber = index + 1;
    const file = `${baseName}.batch-${String(batchNumber).padStart(3, "0")}.csv`;
    const csv = encodeCsv(batchRows, candidateReviewColumns);
    await writeFile(path.join(outputDir, file), csv, "utf8");
    batchFiles.push({
      batchNumber,
      file,
      rowCount: batchRows.length,
      sha256: sha256(csv),
      firstCandidateKey: batchRows[0]?.candidate_key ?? null,
      lastCandidateKey: batchRows.at(-1)?.candidate_key ?? null,
    });
  }
  const index = {
    schemaVersion: "1.0.0",
    discoveryRunPublicId: manifest.run.publicId,
    generatedAt: new Date().toISOString(),
    selection: { screeningHint, candidateCount: rows.length },
    ordering: [
      "source_count descending",
      "identifier_count descending",
      "publication_year descending (missing last)",
      "candidate_key ascending",
    ],
    batchSize: options.batchSize,
    batchCount: batches.length,
    quality,
    batches: batchFiles,
    authority: "Screening hints and ordering are triage aids only; a human reviewer must enter every decision, reason, and reviewer identifier.",
  };
  const indexPath = path.join(outputDir, `${baseName}.index.json`);
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    candidates: rows.length,
    screeningHint,
    batchSize: options.batchSize,
    batches: batches.length,
    index: path.relative(projectRoot, indexPath),
  }, null, 2)}\n`);
}

function validateDecisions(rows, manifest) {
  const candidates = new Map(manifest.candidates.map((candidate) => [candidate.candidateKey, candidate]));
  const seen = new Set();
  const selected = [];
  for (const row of rows) {
    for (const column of ["candidate_key", "decision", "reason", "reviewer"]) {
      if (!(column in row)) throw new Error(`CSV is missing required column: ${column}`);
    }
    const decision = row.decision.trim();
    if (!decision) continue;
    if (!candidates.has(row.candidate_key)) throw new Error(`Unknown candidate_key: ${row.candidate_key}`);
    if (seen.has(row.candidate_key)) throw new Error(`Duplicate candidate decision: ${row.candidate_key}`);
    if (!decisions.has(decision)) throw new Error(`Invalid decision for ${row.candidate_key}`);
    if (!row.reason.trim() || !row.reviewer.trim()) throw new Error(`Reason and reviewer are required for ${row.candidate_key}`);
    if (row.reason.length > 2000 || row.reviewer.length > 200) throw new Error(`Review text is too long for ${row.candidate_key}`);
    seen.add(row.candidate_key);
    selected.push({
      candidateKey: row.candidate_key,
      decision,
      reason: row.reason.trim(),
      reviewer: row.reviewer.trim(),
    });
  }
  if (!selected.length) throw new Error("CSV contains no completed review decisions");
  const reviewers = new Set(selected.map((decision) => decision.reviewer));
  if (reviewers.size !== 1) throw new Error("One import batch must have exactly one reviewer");
  return selected;
}

async function importCandidates(options, manifest) {
  const csvAbsolutePath = path.resolve(projectRoot, options.csvPath);
  const csvText = await readFile(csvAbsolutePath, "utf8");
  const reviewDecisions = validateDecisions(parseCsv(csvText), manifest);
  const promotionHash = hashObject({
    manifestRun: manifest.run.publicId,
    decisions: reviewDecisions.filter((decision) => decision.decision === "include"),
  });
  if (options.promoteIncludes && options.promotionApproval !== promotionHash) {
    throw new Error(`Public promotion requires --approve-promotion=${promotionHash}`);
  }
  if (options.promoteIncludes) {
    for (const decision of reviewDecisions.filter((item) => item.decision === "include")) {
      const candidate = manifest.candidates.find((item) => item.candidateKey === decision.candidateKey);
      if (!candidate.publicationYear) throw new Error(`Promotion requires publication year: ${decision.candidateKey}`);
    }
  }
  const reviewedAt = new Date();
  const batch = {
    publicId: batchPublicId(reviewedAt),
    sourceArtifactSha256: sha256(csvText),
    reviewer: reviewDecisions[0].reviewer,
    reviewedAt: reviewedAt.toISOString(),
  };
  const sql = generateCandidateReviewSql({
    batch,
    decisions: reviewDecisions,
    candidates: manifest.candidates,
    promoteIncludes: options.promoteIncludes,
  });
  const outputDir = path.resolve(projectRoot, options.outputDir);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${batch.publicId}.candidate-review.sql`);
  await writeFile(outputPath, sql, "utf8");
  process.stdout.write(`${JSON.stringify({
    reviewBatchId: batch.publicId,
    decisions: reviewDecisions.length,
    promotedIncludes: options.promoteIncludes
      ? reviewDecisions.filter((decision) => decision.decision === "include").length
      : 0,
    promotionApproval: promotionHash,
    sql: path.relative(projectRoot, outputPath),
  }, null, 2)}\n`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(path.resolve(projectRoot, options.manifestPath), "utf8"));
  if (!manifest.run?.publicId || !Array.isArray(manifest.candidates)) throw new Error("Discovery manifest is invalid");
  if (options.command === "export") await exportCandidates(options, manifest);
  else await importCandidates(options, manifest);
}

main().catch((error) => {
  process.stderr.write(`Candidate review failed: ${error.message}\n`);
  process.exitCode = 1;
});
