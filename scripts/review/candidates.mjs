import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { encodeCsv, parseCsv } from "./csv.mjs";
import { generateCandidateReviewSql } from "./candidate-sql.mjs";
import { hashObject, projectRoot, sha256 } from "../extraction/shared.mjs";

const columns = [
  "candidate_key", "title", "doi", "pmid", "pmcid", "publication_year",
  "screening_hint", "sources", "decision", "reason", "reviewer",
];
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
    else throw new Error(`Unknown option: ${name}`);
  }
  if (!options.manifestPath) throw new Error("--manifest is required");
  if (command === "import" && !options.csvPath) throw new Error("--csv is required for import");
  return options;
}

function batchPublicId(date) {
  const timestamp = date.toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14);
  return `REVIEW-${timestamp}-${randomUUID().slice(0, 8)}`;
}

async function exportCandidates(options, manifest) {
  const rows = manifest.candidates.map((candidate) => ({
    candidate_key: candidate.candidateKey,
    title: candidate.title,
    doi: candidate.doi,
    pmid: candidate.pmid,
    pmcid: candidate.pmcid,
    publication_year: candidate.publicationYear,
    screening_hint: candidate.screeningHint,
    sources: [...new Set(candidate.sources.map((source) => source.source))].join("|"),
    decision: "",
    reason: "",
    reviewer: "",
  }));
  const outputDir = path.resolve(projectRoot, options.outputDir);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${manifest.run.publicId}.candidate-review.csv`);
  await writeFile(outputPath, encodeCsv(rows, columns), "utf8");
  process.stdout.write(`${JSON.stringify({ candidates: rows.length, csv: path.relative(projectRoot, outputPath) }, null, 2)}\n`);
}

function validateDecisions(rows, manifest) {
  const candidates = new Map(manifest.candidates.map((candidate) => [candidate.candidateKey, candidate]));
  const seen = new Set();
  const selected = [];
  for (const row of rows) {
    if (!row.decision.trim()) continue;
    if (!candidates.has(row.candidate_key)) throw new Error(`Unknown candidate_key: ${row.candidate_key}`);
    if (seen.has(row.candidate_key)) throw new Error(`Duplicate candidate decision: ${row.candidate_key}`);
    if (!decisions.has(row.decision)) throw new Error(`Invalid decision for ${row.candidate_key}`);
    if (!row.reason.trim() || !row.reviewer.trim()) throw new Error(`Reason and reviewer are required for ${row.candidate_key}`);
    if (row.reason.length > 2000 || row.reviewer.length > 200) throw new Error(`Review text is too long for ${row.candidate_key}`);
    seen.add(row.candidate_key);
    selected.push({
      candidateKey: row.candidate_key,
      decision: row.decision,
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
