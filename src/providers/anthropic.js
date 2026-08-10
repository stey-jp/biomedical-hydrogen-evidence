import {
  ExtractionProvider,
  ProviderRequestError,
  requestProviderJson,
  requireProviderConfiguration,
} from "./provider.js";

export class AnthropicExtractionProvider extends ExtractionProvider {
  constructor(options) {
    super({ provider: "anthropic", ...options });
  }

  async extract({ systemPrompt, userPrompt, jsonSchema, maxOutputTokens }) {
    requireProviderConfiguration(this);
    const { payload, requestId } = await requestProviderJson(this.provider, {
      url: this.endpoint,
      fetchImpl: this.fetchImpl,
      headers: {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: {
        model: this.model,
        max_tokens: maxOutputTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        output_config: {
          format: { type: "json_schema", schema: jsonSchema },
        },
      },
    });
    if (payload.stop_reason === "refusal") {
      throw new ProviderRequestError(this.provider, { requestId: payload.id ?? requestId, code: "provider_refusal" });
    }
    if (payload.stop_reason === "max_tokens") {
      throw new ProviderRequestError(this.provider, { requestId: payload.id ?? requestId, code: "provider_incomplete" });
    }
    const text = payload.content?.find((item) => item.type === "text")?.text;
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
