import {
  ExtractionProvider,
  ProviderRequestError,
  requestProviderJson,
  requireProviderConfiguration,
} from "./provider.js";

function findOutputText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const step of [...(payload.steps ?? [])].reverse()) {
    if (typeof step.output_text === "string") return step.output_text;
    for (const item of [...(step.content ?? step.outputs ?? [])].reverse()) {
      if (item.type === "text" && typeof item.text === "string") return item.text;
      if (typeof item.output_text === "string") return item.output_text;
    }
  }
  return null;
}

export class GeminiExtractionProvider extends ExtractionProvider {
  constructor(options) {
    super({ provider: "gemini", ...options });
  }

  async extract({ systemPrompt, userPrompt, jsonSchema, maxOutputTokens }) {
    requireProviderConfiguration(this);
    const { payload, requestId } = await requestProviderJson(this.provider, {
      url: this.endpoint,
      fetchImpl: this.fetchImpl,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: {
        model: this.model,
        store: false,
        system_instruction: systemPrompt,
        input: userPrompt,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: jsonSchema,
        },
        generation_config: {
          max_output_tokens: maxOutputTokens,
          thinking_summaries: "none",
        },
      },
    });
    if (payload.status && payload.status !== "completed") {
      throw new ProviderRequestError(this.provider, {
        requestId: payload.id ?? requestId,
        code: payload.status === "incomplete" || payload.status === "budget_exceeded"
          ? "provider_incomplete"
          : "provider_failed",
      });
    }
    const text = findOutputText(payload);
    if (!text) throw new ProviderRequestError(this.provider, { requestId, code: "provider_empty_output" });
    return {
      provider: this.provider,
      model: payload.model ?? this.model,
      modelVersion: payload.model ?? this.modelVersion,
      externalRequestId: payload.id ?? requestId,
      outputText: text,
      usage: {
        inputTokens: payload.usage?.total_input_tokens ?? null,
        outputTokens: payload.usage?.total_output_tokens ?? null,
      },
    };
  }
}
