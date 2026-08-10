import {
  ExtractionProvider,
  ProviderRequestError,
  requestProviderJson,
  requireProviderConfiguration,
} from "./provider.js";

function outputText(payload) {
  for (const item of payload.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "refusal") throw new ProviderRequestError("openai", { code: "provider_refusal" });
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return payload.output_text ?? null;
}

export class OpenAIExtractionProvider extends ExtractionProvider {
  constructor(options) {
    super({ provider: "openai", ...options });
  }

  async extract({ systemPrompt, userPrompt, jsonSchema, maxOutputTokens }) {
    requireProviderConfiguration(this);
    const { payload, requestId } = await requestProviderJson(this.provider, {
      url: this.endpoint,
      fetchImpl: this.fetchImpl,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: {
        model: this.model,
        store: false,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "biomedical_hydrogen_extraction",
            strict: true,
            schema: jsonSchema,
          },
        },
        max_output_tokens: maxOutputTokens,
      },
    });
    if (payload.status && payload.status !== "completed") {
      throw new ProviderRequestError(this.provider, {
        requestId: payload.id ?? requestId,
        code: payload.status === "incomplete" ? "provider_incomplete" : "provider_failed",
      });
    }
    const text = outputText(payload);
    if (!text) throw new ProviderRequestError(this.provider, { requestId, code: "provider_empty_output" });
    return {
      provider: this.provider,
      model: payload.model ?? this.model,
      modelVersion: payload.model ?? this.modelVersion,
      externalRequestId: payload.id ?? requestId,
      outputText: text,
      usage: {
        inputTokens: payload.usage?.input_tokens ?? null,
        outputTokens: payload.usage?.output_tokens ?? null,
      },
    };
  }
}
