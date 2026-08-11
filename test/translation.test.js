import test from "node:test";
import assert from "node:assert/strict";
import {
  biomedicalGlossaryEntries,
  createDeepLClient,
  TranslationProviderError,
} from "../src/translation/deepl.js";
import {
  europePmcQuery,
  fetchEuropePmcAbstract,
} from "../src/translation/europe-pmc.js";
import {
  createReviewTranslationService,
  ReviewTranslationError,
  splitEnglishSentences,
} from "../src/services/review-translations.js";

async function sourceHash(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("DeepL Free client creates and waits for the EN-JA glossary, then translates a batch", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (url.endsWith("/v2/glossaries") && init.method === "POST") {
      return Response.json({ glossary_id: "glossary-1", ready: false }, { status: 201 });
    }
    if (url.endsWith("/v2/glossaries/glossary-1")) {
      return Response.json({ glossary_id: "glossary-1", ready: true });
    }
    return Response.json({
      translations: [
        { text: "分子状水素の研究", model_type_used: "latency_optimized" },
        { text: "水素富化水の研究" },
      ],
    });
  };
  const client = createDeepLClient({
    apiKey: "test-deepl-api-key-that-is-long-enough",
    fetchImpl,
    waitImpl: async () => {},
  });

  const glossaryId = await client.createGlossary();
  const translated = await client.translateEnglishToJapanese([
    "Molecular hydrogen study",
    "Hydrogen-rich water study",
  ], { glossaryId });

  assert.equal(client.configured, true);
  assert.equal(glossaryId, "glossary-1");
  assert.deepEqual(translated.map((item) => item.text), ["分子状水素の研究", "水素富化水の研究"]);
  assert.ok(calls.every((call) => call.url.startsWith("https://api-free.deepl.com/")));
  assert.equal(calls[0].init.headers.authorization, "DeepL-Auth-Key test-deepl-api-key-that-is-long-enough");
  const glossaryBody = JSON.parse(calls[0].init.body);
  assert.equal(glossaryBody.source_lang, "EN");
  assert.equal(glossaryBody.target_lang, "JA");
  assert.match(glossaryBody.entries, /molecular hydrogen\t分子状水素/u);
  assert.equal(glossaryBody.entries.split("\n").length, biomedicalGlossaryEntries.length);
  const translationBody = JSON.parse(calls.at(-1).init.body);
  assert.equal(translationBody.glossary_id, "glossary-1");
});

test("DeepL errors do not expose provider bodies or source text", async () => {
  const source = "private source text that must not be echoed";
  const client = createDeepLClient({
    apiKey: "test-deepl-api-key-that-is-long-enough",
    fetchImpl: async () => new Response(JSON.stringify({ message: source }), { status: 400 }),
  });
  await assert.rejects(
    client.translateEnglishToJapanese([source]),
    (error) => error instanceof TranslationProviderError
      && error.status === 502
      && !error.message.includes(source),
  );

  const disabled = createDeepLClient({ apiKey: "" });
  assert.equal(disabled.configured, false);
  await assert.rejects(
    disabled.translateEnglishToJapanese(["Molecular hydrogen"]),
    (error) => error.status === 503,
  );
});

test("Europe PMC lookup prefers stable identifiers and returns plain abstract text", async () => {
  assert.equal(europePmcQuery({ pmid: "123", pmcid: "PMC456", doi: "10.1/x" }), "EXT_ID:123 AND SRC:MED");
  assert.equal(europePmcQuery({ pmcid: "PMC456", doi: "10.1/x" }), "PMCID:PMC456");
  assert.equal(europePmcQuery({ doi: "10.1/x" }), "DOI:\"10.1/x\"");

  let requestedUrl;
  const result = await fetchEuropePmcAbstract({ pmid: "123" }, async (url) => {
    requestedUrl = new URL(url);
    return Response.json({
      resultList: {
        result: [{
          pmid: "123",
          abstractText: "<h4>BACKGROUND</h4> Molecular hydrogen &amp; saline were compared.",
          isOpenAccess: "Y",
        }],
      },
    });
  });
  assert.equal(requestedUrl.searchParams.get("resultType"), "core");
  assert.equal(result.text, "BACKGROUND Molecular hydrogen & saline were compared.");
  assert.equal(result.sourceUrl, "https://europepmc.org/article/MED/123");
  assert.equal(result.rightsStatus, "open_access_check_license");
});

test("review translation service reuses title cache and writes only missing title translations", async () => {
  const cachedTitle = "Cached title";
  const saved = [];
  const repository = {
    async getTitleTranslationRows() {
      return [
        {
          internal_id: 2,
          candidate_key: "new",
          title: "Molecular hydrogen treatment",
          translation_source_sha256: null,
          translated_text: null,
        },
        {
          internal_id: 1,
          candidate_key: "cached",
          title: cachedTitle,
          translation_source_sha256: await sourceHash(cachedTitle),
          translated_text: "キャッシュ済みタイトル",
          translation_provider: "deepl",
        },
        {
          internal_id: 3,
          candidate_key: "ja",
          title: "日本語タイトル",
          translation_source_sha256: null,
          translated_text: null,
        },
      ];
    },
    async getTranslationSetting() { return "glossary-existing"; },
    async saveTitleTranslations(records) { saved.push(...records); },
  };
  let translatedInput;
  const service = createReviewTranslationService({
    repository,
    deepLClient: {
      async createGlossary() { throw new Error("cached glossary must be reused"); },
      async translateEnglishToJapanese(texts, options) {
        translatedInput = { texts, options };
        return [{ text: "分子状水素治療", model: "deepl-default" }];
      },
    },
    now: () => Date.parse("2026-08-11T04:00:00.000Z"),
  });

  const result = await service.translateTitles(["cached", "new", "ja"]);
  assert.deepEqual(result.map((item) => item.candidateKey), ["cached", "new", "ja"]);
  assert.deepEqual(translatedInput.texts, ["Molecular hydrogen treatment"]);
  assert.equal(translatedInput.options.glossaryId, "glossary-existing");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].candidateId, 2);
  assert.equal(saved[0].sourceSha256.length, 64);
  assert.equal(result[0].cached, true);
  assert.equal(result[1].cached, false);
  assert.equal(result[2].provider, "source");
});

test("abstract translation is sentence-aligned and never written to the translation cache", async () => {
  let translatedSentences;
  let titleCacheWrites = 0;
  const repository = {
    async getCandidate() {
      return { candidate_key: "pmid:123", pmid: "123" };
    },
    async getTranslationSetting() { return "glossary-existing"; },
    async saveTitleTranslations() { titleCacheWrites += 1; },
  };
  const service = createReviewTranslationService({
    repository,
    deepLClient: {
      async translateEnglishToJapanese(texts) {
        translatedSentences = texts;
        return texts.map((_, index) => ({ text: `訳${index + 1}`, model: "deepl-default" }));
      },
    },
    fetchImpl: async () => Response.json({
      resultList: { result: [{ pmid: "123", abstractText: "First sentence. Second sentence?" }] },
    }),
  });

  const result = await service.translateAbstract("pmid:123");
  assert.deepEqual(translatedSentences, ["First sentence.", "Second sentence?"]);
  assert.deepEqual(result.sentences, [
    { source: "First sentence.", translation: "訳1" },
    { source: "Second sentence?", translation: "訳2" },
  ]);
  assert.equal(titleCacheWrites, 0);
  assert.equal(splitEnglishSentences("One. Two! Three? ").length, 3);
});

test("review translation service reports missing candidate keys", async () => {
  const service = createReviewTranslationService({
    repository: { async getTitleTranslationRows() { return []; } },
    deepLClient: {},
  });
  await assert.rejects(
    service.translateTitles(["missing"]),
    (error) => error instanceof ReviewTranslationError
      && error.status === 404
      && error.code === "candidate_not_found",
  );
});

test("title translation returns cached rows when DeepL is not configured", async () => {
  const cachedTitle = "Cached title";
  const service = createReviewTranslationService({
    repository: {
      async getTitleTranslationRows() {
        return [
          {
            internal_id: 1,
            candidate_key: "cached",
            title: cachedTitle,
            translation_source_sha256: await sourceHash(cachedTitle),
            translated_text: "キャッシュ済みタイトル",
            translation_provider: "deepl",
          },
          {
            internal_id: 2,
            candidate_key: "missing",
            title: "Missing title",
            translation_source_sha256: null,
            translated_text: null,
          },
        ];
      },
      async getTranslationSetting() { return null; },
    },
    deepLClient: {
      async createGlossary() {
        throw new TranslationProviderError("DeepL API key is not configured.", 503);
      },
    },
  });
  const result = await service.translateTitles(["cached", "missing"]);
  assert.equal(result[0].translatedText, "キャッシュ済みタイトル");
  assert.equal(result[1].translatedText, null);
  assert.equal(result[1].errorCode, "translation_disabled");
});
