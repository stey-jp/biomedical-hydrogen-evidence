const freeApiBase = "https://api-free.deepl.com";

export const glossaryVersion = "biomedical-hydrogen-en-ja-v1";

export const biomedicalGlossaryEntries = [
  ["molecular hydrogen", "分子状水素"],
  ["hydrogen-rich water", "水素富化水"],
  ["hydrogen rich water", "水素富化水"],
  ["hydrogen-rich saline", "水素含有生理食塩水"],
  ["hydrogen inhalation", "水素吸入"],
  ["randomized controlled trial", "無作為化比較試験"],
  ["randomized clinical trial", "無作為化臨床試験"],
  ["in vitro", "in vitro（試験管内）"],
  ["in vivo", "in vivo（生体内）"],
];

export class TranslationProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "TranslationProviderError";
    this.status = status;
  }
}

function validApiKey(value) {
  return typeof value === "string" && value.trim().length >= 20 && value.trim().length <= 256;
}

function checkedTexts(texts, maxItems = 50) {
  if (!Array.isArray(texts) || !texts.length || texts.length > maxItems) {
    throw new RangeError(`texts must contain 1–${maxItems} items`);
  }
  const normalized = texts.map((value) => String(value ?? "").trim());
  if (normalized.some((value) => !value || value.length > 12_000)) {
    throw new RangeError("each translation text must contain 1–12000 characters");
  }
  if (normalized.reduce((sum, value) => sum + value.length, 0) > 60_000) {
    throw new RangeError("translation request is too large");
  }
  return normalized;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createDeepLClient({ apiKey, fetchImpl = fetch, waitImpl = delay } = {}) {
  const configured = validApiKey(apiKey);

  async function request(path, { method = "GET", body } = {}) {
    if (!configured) throw new TranslationProviderError("DeepL API key is not configured.", 503);
    let response;
    try {
      const headers = {
        authorization: `DeepL-Auth-Key ${apiKey.trim()}`,
        accept: "application/json",
      };
      if (body) headers["content-type"] = "application/json";
      response = await fetchImpl(`${freeApiBase}${path}`, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new TranslationProviderError("DeepL request failed.", 502);
    }
    if (!response.ok) {
      throw new TranslationProviderError(`DeepL request failed with status ${response.status}.`, 502);
    }
    try {
      return await response.json();
    } catch {
      throw new TranslationProviderError("DeepL returned an invalid response.", 502);
    }
  }

  return {
    configured,

    async createGlossary() {
      const result = await request("/v2/glossaries", {
        method: "POST",
        body: {
          name: glossaryVersion,
          source_lang: "EN",
          target_lang: "JA",
          entries: biomedicalGlossaryEntries.map((entry) => entry.join("\t")).join("\n"),
          entries_format: "tsv",
        },
      });
      if (!result?.glossary_id) throw new TranslationProviderError("DeepL glossary creation failed.", 502);
      if (result.ready !== false) return result.glossary_id;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await waitImpl(100 * (2 ** attempt));
        const details = await request(`/v2/glossaries/${encodeURIComponent(result.glossary_id)}`);
        if (details?.ready === true) return result.glossary_id;
      }
      throw new TranslationProviderError("DeepL glossary is not ready.", 503);
    },

    async translateEnglishToJapanese(texts, { glossaryId } = {}) {
      const input = checkedTexts(texts);
      const result = await request("/v2/translate", {
        method: "POST",
        body: {
          text: input,
          source_lang: "EN",
          target_lang: "JA",
          ...(glossaryId ? { glossary_id: glossaryId } : {}),
        },
      });
      if (!Array.isArray(result?.translations) || result.translations.length !== input.length) {
        throw new TranslationProviderError("DeepL returned an unexpected translation count.", 502);
      }
      return result.translations.map((translation) => {
        const text = String(translation?.text ?? "").trim();
        if (!text) throw new TranslationProviderError("DeepL returned an empty translation.", 502);
        return { text, model: translation.model_type_used ?? "deepl-default" };
      });
    },
  };
}
