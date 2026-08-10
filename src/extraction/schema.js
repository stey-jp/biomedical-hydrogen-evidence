import { z } from "zod";

export const evidenceSections = Object.freeze([
  "title", "abstract", "methods", "results", "discussion", "table", "figure", "supplement", "unknown",
]);

const extractedFieldSchema = z.object({
  fieldName: z.string().min(1).max(200),
  extractedValue: z.string().min(1).max(2000),
  normalizedValue: z.string().min(1).max(2000).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  evidenceSnippet: z.string().min(1).max(500),
  section: z.enum(evidenceSections),
  pageNumber: z.string().max(40).nullable(),
  locator: z.string().min(1).max(300),
}).strict();

export const extractionResultSchema = z.object({
  biomedicalRelevance: z.enum(["yes", "no", "unclear"]),
  speciesType: z.enum(["human", "animal", "in_vitro", "review", "other", "unclear"]),
  fields: z.array(extractedFieldSchema).max(100),
}).strict();

export const extractionJsonSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    biomedicalRelevance: { type: "string", enum: ["yes", "no", "unclear"] },
    speciesType: { type: "string", enum: ["human", "animal", "in_vitro", "review", "other", "unclear"] },
    fields: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          fieldName: { type: "string" },
          extractedValue: { type: "string" },
          normalizedValue: { type: ["string", "null"] },
          confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
          evidenceSnippet: { type: "string" },
          section: { type: "string", enum: evidenceSections },
          pageNumber: { type: ["string", "null"] },
          locator: { type: "string" },
        },
        required: [
          "fieldName", "extractedValue", "normalizedValue", "confidence",
          "evidenceSnippet", "section", "pageNumber", "locator",
        ],
      },
    },
  },
  required: ["biomedicalRelevance", "speciesType", "fields"],
});

export function parseExtractionResult(text, allowedFields) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Provider returned invalid JSON");
  }
  const result = extractionResultSchema.parse(parsed);
  const allowed = new Set(allowedFields);
  const seen = new Set();
  for (const field of result.fields) {
    if (!allowed.has(field.fieldName)) throw new Error(`Provider returned an unrequested field: ${field.fieldName}`);
    if (seen.has(field.fieldName)) throw new Error(`Provider returned a duplicate field: ${field.fieldName}`);
    seen.add(field.fieldName);
  }
  return result;
}

export function checkEvidenceAgainstSource(field, sourceText) {
  const snippetFound = sourceText.includes(field.evidenceSnippet);
  const locatorPresent = Boolean(field.locator.trim());
  return {
    snippetFoundInSource: snippetFound,
    locatorPresent,
    status: snippetFound && locatorPresent ? "source_aligned" : "needs_human_review",
    details: {
      checkType: "exact-snippet-membership",
      note: "Source alignment verifies locator mechanics only; it does not establish scientific correctness.",
    },
  };
}
