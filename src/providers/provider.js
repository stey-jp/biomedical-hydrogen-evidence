export class ExtractionProvider {
  constructor({ provider, model, modelVersion = null, endpoint = null, apiKey = null, fetchImpl = fetch }) {
    if (new.target === ExtractionProvider) {
      throw new TypeError("ExtractionProvider is an interface and cannot be instantiated directly");
    }
    this.provider = provider;
    this.model = model;
    this.modelVersion = modelVersion;
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  async extract() {
    throw new Error("Provider implementations must define extract()");
  }
}

export class ProviderRequestError extends Error {
  constructor(provider, { status = null, requestId = null, code = "provider_request_failed" } = {}) {
    super(`${provider} request failed${status ? ` with HTTP ${status}` : ""}`);
    this.name = "ProviderRequestError";
    this.provider = provider;
    this.status = status;
    this.requestId = requestId;
    this.code = code;
  }
}

export async function requestProviderJson(provider, { url, headers, body, fetchImpl, timeoutMs = 60_000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const requestId = response.headers.get("request-id") ?? response.headers.get("x-request-id");
    if (!response.ok) {
      let code = "provider_request_failed";
      try {
        const error = await response.json();
        code = error?.error?.type ?? error?.error?.code ?? code;
      } catch {
        // Do not include response bodies because they may echo submitted source text.
      }
      throw new ProviderRequestError(provider, { status: response.status, requestId, code });
    }
    return { payload: await response.json(), requestId };
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error;
    throw new ProviderRequestError(provider, {
      code: error.name === "AbortError" ? "provider_timeout" : "provider_network_error",
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function requireProviderConfiguration(provider) {
  if (!provider.endpoint?.startsWith("https://")) throw new Error(`${provider.provider} endpoint must use HTTPS`);
  if (!provider.apiKey) throw new Error(`${provider.provider} API key is required`);
}

export class StubExtractionProvider extends ExtractionProvider {
  constructor(name = "stub") {
    super({ provider: name, model: "disabled-phase-1", modelVersion: "test-only" });
  }

  async extract() {
    return {
      status: "disabled",
      fields: [],
      message: "Stub provider performs no external call. Use the explicit managed extraction command for configured providers.",
    };
  }
}
