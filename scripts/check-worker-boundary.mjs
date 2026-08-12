import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleDirectory = path.join(projectRoot, ".generated", "worker-bundle");
const forbidden = [
  /api\.anthropic\.com/iu,
  /generativelanguage\.googleapis\.com/iu,
  /OPENAI_API_KEY/u,
  /ANTHROPIC_API_KEY/u,
  /GEMINI_API_KEY/u,
  /runExtractionPlan/u,
];

const requiredReviewAiBoundaries = [
  /OPENAI_REVIEW_API_KEY/u,
  /\/api\/review\/v1\/colloquial-translations/u,
  /store:\s*(?:false|!1)/u,
];

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(fullPath));
    else files.push(fullPath);
  }
  return files;
}

const bundleFiles = (await filesBelow(bundleDirectory)).filter((file) => /\.(?:js|mjs)$/u.test(file));
if (!bundleFiles.length) throw new Error("Worker dry-run produced no JavaScript bundle");
for (const file of bundleFiles) {
  const content = await readFile(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(content)) throw new Error(`Worker bundle crossed managed-AI boundary: ${pattern} in ${file}`);
  }
}
const bundle = (await Promise.all(bundleFiles.map((file) => readFile(file, "utf8")))).join("\n");
for (const pattern of requiredReviewAiBoundaries) {
  if (!pattern.test(bundle)) throw new Error(`Worker bundle is missing the authenticated review AI boundary: ${pattern}`);
}
process.stdout.write(`Worker boundary check passed for ${bundleFiles.length} bundle file(s).\n`);
