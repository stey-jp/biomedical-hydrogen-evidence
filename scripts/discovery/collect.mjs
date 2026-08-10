import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { mergeCandidates } from "./model.mjs";
import { profileDiscovery } from "./quality.mjs";
import { collectors } from "./sources.mjs";
import { generateDiscoverySql } from "./sql.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function usage() {
  return [
    "Usage: npm run discovery:collect -- [options]",
    "",
    "Options:",
    "  --sources=pubmed,europepmc,crossref  Sources to collect (default: all)",
    "  --max-results=25                    Per-query result cap (1-10000)",
    "  --output-dir=.generated/discovery   Output directory",
    "  --protocol=config/discovery.v1.json Protocol configuration",
    "  --help                              Show this help",
    "",
    "Environment:",
    "  DISCOVERY_CONTACT_EMAIL  Required source-contact email",
    "  NCBI_API_KEY             Optional NCBI API key",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {
    sources: null,
    maxResultsPerQuery: 25,
    outputDir: ".generated/discovery",
    protocolPath: "config/discovery.v1.json",
  };
  for (const argument of argv) {
    if (argument === "--help") return { help: true };
    const [name, value] = argument.split(/=(.*)/su, 2);
    if (!value) throw new Error(`Option requires a value: ${argument}`);
    if (name === "--sources") options.sources = value.split(",").map((item) => item.trim()).filter(Boolean);
    else if (name === "--max-results") options.maxResultsPerQuery = Number(value);
    else if (name === "--output-dir") options.outputDir = value;
    else if (name === "--protocol") options.protocolPath = value;
    else throw new Error(`Unknown option: ${name}`);
  }
  if (!Number.isInteger(options.maxResultsPerQuery) || options.maxResultsPerQuery < 1 || options.maxResultsPerQuery > 10_000) {
    throw new Error("--max-results must be an integer between 1 and 10000");
  }
  return options;
}

function validateContactEmail(value) {
  if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) {
    throw new Error("DISCOVERY_CONTACT_EMAIL must contain a valid contact email");
  }
  return value;
}

function runPublicId(date) {
  const timestamp = date.toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14);
  return `DISC-${timestamp}-${randomUUID().slice(0, 8)}`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const contactEmail = validateContactEmail(process.env.DISCOVERY_CONTACT_EMAIL);
  const protocolPath = path.resolve(projectRoot, options.protocolPath);
  const protocol = JSON.parse(await readFile(protocolPath, "utf8"));
  const selectedSources = options.sources ?? Object.keys(protocol.sources ?? {});
  if (!protocol.protocolVersion || !selectedSources.length) throw new Error("Discovery protocol has no usable sources");
  for (const source of selectedSources) {
    if (!collectors[source] || !protocol.sources[source]) throw new Error(`Unsupported source: ${source}`);
    if (!String(protocol.sources[source].endpoint).startsWith("https://")) {
      throw new Error(`Source endpoint must use HTTPS: ${source}`);
    }
  }

  const startedAt = new Date();
  const records = [];
  const queries = [];
  for (const source of selectedSources) {
    const result = await collectors[source](protocol.sources[source], {
      contactEmail,
      fetchImpl: fetch,
      maxResultsPerQuery: options.maxResultsPerQuery,
      ncbiApiKey: process.env.NCBI_API_KEY,
    });
    records.push(...result.records);
    queries.push(...result.queries);
  }

  const candidates = mergeCandidates(records)
    .map((candidate) => ({
      ...candidate,
      sources: [...candidate.sources].sort((left, right) => (
        left.source.localeCompare(right.source) || left.rank - right.rank
      )),
    }))
    .sort((left, right) => left.candidateKey.localeCompare(right.candidateKey));
  const completedAt = new Date();
  const quality = profileDiscovery(records, candidates, queries, completedAt);
  const publicId = runPublicId(startedAt);
  const run = {
    publicId,
    protocolVersion: protocol.protocolVersion,
    sources: selectedSources,
    maxResultsPerQuery: options.maxResultsPerQuery,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    notes: "Candidate bibliographic metadata only; no abstract or full text stored. Human screening is required before publication.",
  };
  const manifest = {
    schemaVersion: "1.0.0",
    run,
    quality,
    queries,
    candidates,
  };

  const outputDir = path.resolve(projectRoot, options.outputDir);
  await mkdir(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, `${publicId}.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (!quality.passedBlockingChecks) {
    throw new Error(`Blocking data-quality checks failed; inspect ${path.relative(projectRoot, manifestPath)}`);
  }
  const sqlPath = path.join(outputDir, `${publicId}.sql`);
  await writeFile(sqlPath, generateDiscoverySql({ run, candidates, queries }), "utf8");

  process.stdout.write(`${JSON.stringify({
    runId: publicId,
    sources: selectedSources,
    rawRecords: records.length,
    candidates: candidates.length,
    passedBlockingChecks: quality.passedBlockingChecks,
    manifest: path.relative(projectRoot, manifestPath),
    sql: path.relative(projectRoot, sqlPath),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Discovery failed: ${error.message}\n`);
  process.exitCode = 1;
});
