import { calculateFieldConsensus } from "../../src/extraction/consensus.js";
import {
  checkEvidenceAgainstSource,
  extractionJsonSchema,
  parseExtractionResult,
} from "../../src/extraction/schema.js";
import { ProviderRequestError } from "../../src/providers/provider.js";
import { buildPrompts, createProvider, hashObject } from "./shared.mjs";

function comparableValue(field) {
  return String(field.normalizedValue ?? field.extractedValue)
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function callStatus(error) {
  if (!(error instanceof ProviderRequestError)) return "failed";
  if (error.code === "provider_refusal") return "refused";
  if (error.code === "provider_incomplete") return "incomplete";
  return "failed";
}

export function calculateRunConsensus(calls) {
  const grouped = new Map();
  for (const call of calls.filter((item) => item.status === "completed")) {
    for (const field of call.result.fields) {
      const key = `${call.publicId}\n${field.fieldName}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({
        provider: call.provider,
        normalizedValue: comparableValue(field),
        evidenceStatus: field.evidenceCheck.status,
      });
    }
  }
  return [...grouped.entries()].map(([key, values]) => {
    const [publicId, fieldName] = key.split("\n");
    const consensus = calculateFieldConsensus(values);
    return {
      publicId,
      fieldName,
      ...consensus,
      allEvidenceSourceAligned: values.every((value) => value.evidenceStatus === "source_aligned"),
    };
  });
}

export async function runExtractionPlan({ plan, config, bundle, fetchImpl = fetch, now = () => new Date() }) {
  for (const provider of plan.providers) {
    if (!process.env[provider.apiKeyEnvironmentVariable]) {
      throw new Error(`${provider.apiKeyEnvironmentVariable} is required for the approved plan`);
    }
  }
  const calls = [];
  let sequence = 0;
  for (const document of bundle.documents) {
    const plannedDocument = plan.documents.find((item) => item.publicId === document.publicId);
    if (!plannedDocument) throw new Error(`Document is not present in the approved plan: ${document.publicId}`);
    const prompts = buildPrompts(document, plan.targetFields);
    for (const plannedProvider of plan.providers) {
      sequence += 1;
      if (sequence > plan.budget.maxRequests) throw new Error("Approved request limit would be exceeded");
      const startedAt = now().toISOString();
      const base = {
        sequence,
        publicId: document.publicId,
        provider: plannedProvider.name,
        model: plannedProvider.model,
        requestFingerprint: hashObject({
          provider: plannedProvider.name,
          model: plannedProvider.model,
          promptVersion: plan.promptVersion,
          extractionSchemaVersion: plan.extractionSchemaVersion,
          contentSha256: plannedDocument.contentSha256,
          targetFields: plan.targetFields,
        }),
        inputCharacterCount: document.content.length,
        startedAt,
      };
      try {
        const provider = createProvider(plannedProvider, fetchImpl);
        const response = await provider.extract({
          ...prompts,
          jsonSchema: extractionJsonSchema,
          maxOutputTokens: plan.budget.maxOutputTokensPerRequest,
        });
        const parsed = parseExtractionResult(response.outputText, plan.targetFields);
        const fields = parsed.fields.map((field) => ({
          ...field,
          evidenceCheck: checkEvidenceAgainstSource(field, document.content),
        }));
        calls.push({
          ...base,
          status: "completed",
          model: response.model,
          modelVersion: response.modelVersion,
          externalRequestId: response.externalRequestId,
          inputTokenCount: response.usage.inputTokens,
          outputTokenCount: response.usage.outputTokens,
          completedAt: now().toISOString(),
          result: {
            biomedicalRelevance: parsed.biomedicalRelevance,
            speciesType: parsed.speciesType,
            fields,
          },
        });
      } catch (error) {
        calls.push({
          ...base,
          status: callStatus(error),
          modelVersion: null,
          externalRequestId: error instanceof ProviderRequestError ? error.requestId : null,
          inputTokenCount: null,
          outputTokenCount: null,
          errorCode: error instanceof ProviderRequestError ? error.code : "invalid_structured_output",
          completedAt: now().toISOString(),
        });
      }
    }
  }
  const completedCalls = calls.filter((call) => call.status === "completed").length;
  return {
    schemaVersion: "1.0.0",
    run: {
      publicId: plan.publicId,
      planSha256: plan.planSha256,
      sourceBundleSha256: plan.sourceBundleSha256,
      extractionSchemaVersion: plan.extractionSchemaVersion,
      promptVersion: plan.promptVersion,
      providers: plan.providers.map(({ name, model }) => ({ name, model })),
      budget: plan.budget,
      status: completedCalls === calls.length ? "completed" : completedCalls ? "partial" : "failed",
      startedAt: calls[0]?.startedAt ?? now().toISOString(),
      completedAt: now().toISOString(),
      requestCount: calls.length,
      inputTokenCount: calls.reduce((sum, call) => sum + (call.inputTokenCount ?? 0), 0),
      outputTokenCount: calls.reduce((sum, call) => sum + (call.outputTokenCount ?? 0), 0),
    },
    documents: plan.documents,
    calls,
    consensus: calculateRunConsensus(calls),
    notice: "Structured extraction and model agreement are not proof of scientific correctness. Human verification remains authoritative.",
  };
}
