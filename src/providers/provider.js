export class ExtractionProvider {
  constructor({ provider, model, modelVersion = null }) {
    if (new.target === ExtractionProvider) {
      throw new TypeError("ExtractionProvider is an interface and cannot be instantiated directly");
    }
    this.provider = provider;
    this.model = model;
    this.modelVersion = modelVersion;
  }

  async extract() {
    throw new Error("Provider implementations must define extract()");
  }
}

export class StubExtractionProvider extends ExtractionProvider {
  constructor(name = "stub") {
    super({ provider: name, model: "disabled-phase-1", modelVersion: "test-only" });
  }

  async extract() {
    return {
      status: "disabled",
      fields: [],
      message: "Phase 1 does not call external AI providers. Extraction requires a future explicit managed batch command.",
    };
  }
}

