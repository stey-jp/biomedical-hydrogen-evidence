import test from "node:test";
import assert from "node:assert/strict";
import {
  biomedicalGlossaryEntries,
  createDeepLClient,
  TranslationProviderError,
} from "../src/translation/deepl.js";
import {
  europePmcQuery,
  fetchArticleAbstract,
  fetchCrossrefAbstract,
  fetchElsevierAbstract,
  fetchEuropePmcAbstract,
  fetchOpenAireAbstract,
  fetchOpenAlexAbstract,
  fetchPubMedAbstract,
  fetchSpringerNatureAbstract,
  isElsevierCandidate,
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

test("Europe PMC lookup falls back to the free full-text XML abstract", async () => {
  const requestedUrls = [];
  const result = await fetchEuropePmcAbstract({ pmid: "456" }, async (url, init) => {
    requestedUrls.push({ url: String(url), accept: init.headers.accept });
    if (String(url).endsWith("/PMC789/fullTextXML")) {
      return new Response(`
        <article>
          <front>
            <article-meta>
              <abstract>
                <title>Abstract</title>
                <sec><title>Background</title><p>Molecular hydrogen &amp; saline were compared.</p></sec>
              </abstract>
            </article-meta>
          </front>
          <body><sec><title>Summary</title><p>Full text must not be returned.</p></sec></body>
        </article>
      `, { headers: { "content-type": "application/xml" } });
    }
    return Response.json({
      resultList: {
        result: [{ pmid: "456", pmcid: "PMC789", isOpenAccess: "Y" }],
      },
    });
  });

  assert.deepEqual(requestedUrls.map((request) => request.accept), ["application/json", "application/xml"]);
  assert.equal(requestedUrls[1].url, "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC789/fullTextXML");
  assert.equal(result.text, "Abstract Background Molecular hydrogen & saline were compared.");
  assert.doesNotMatch(result.text, /Full text must not be returned/u);
  assert.equal(result.sourceUrl, "https://europepmc.org/article/PMC/PMC789");
});

test("PubMed E-Fetch returns an exact PMID abstract and identifies records without abstracts", async () => {
  let requestedUrl;
  const result = await fetchPubMedAbstract({ pmid: "123" }, async (url, init) => {
    requestedUrl = new URL(url);
    assert.equal(init.headers.accept, "application/xml");
    return new Response(`
      <PubmedArticleSet>
        <PubmedArticle>
          <MedlineCitation><PMID Version="1">123</PMID><Article><Abstract>
            <AbstractText Label="BACKGROUND">Molecular hydrogen &amp; saline were compared.</AbstractText>
            <AbstractText Label="RESULTS">Treatment was tolerated.</AbstractText>
          </Abstract></Article></MedlineCitation>
        </PubmedArticle>
      </PubmedArticleSet>
    `);
  });
  assert.equal(requestedUrl.searchParams.get("db"), "pubmed");
  assert.equal(requestedUrl.searchParams.get("id"), "123");
  assert.equal(requestedUrl.searchParams.get("retmode"), "xml");
  assert.equal(requestedUrl.searchParams.get("tool"), "biomedical_hydrogen_evidence");
  assert.equal(result.text, "Molecular hydrogen & saline were compared. Treatment was tolerated.");
  assert.equal(result.source, "PubMed");

  await assert.rejects(
    fetchPubMedAbstract({ pmid: "25468479" }, async () => new Response(`
      <PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>25468479</PMID><Article>
        <ArticleTitle>Can an innocent toy become dangerous?</ArticleTitle>
      </Article></MedlineCitation></PubmedArticle></PubmedArticleSet>
    `)),
    (error) => error?.name === "AbstractSourceError"
      && error.status === 404
      && error.code === "pubmed_abstract_missing",
  );
});

test("article abstract lookup prefers PubMed E-Fetch for PMID candidates", async () => {
  const requestedHosts = [];
  const result = await fetchArticleAbstract({ pmid: "123" }, async (url) => {
    const requestedUrl = new URL(url);
    requestedHosts.push(requestedUrl.hostname);
    if (requestedUrl.hostname === "eutils.ncbi.nlm.nih.gov") {
      return new Response(`
        <PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>123</PMID><Article><Abstract>
          <AbstractText>PubMed fallback abstract.</AbstractText>
        </Abstract></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>
      `);
    }
    return Response.json({ resultList: { result: [{ pmid: "123", abstractText: "Europe PMC abstract." }] } });
  });
  assert.deepEqual(requestedHosts, ["eutils.ncbi.nlm.nih.gov"]);
  assert.equal(result.text, "PubMed fallback abstract.");
  assert.equal(result.source, "PubMed");
});

test("article abstract lookup falls back from PubMed to Europe PMC", async () => {
  const requestedHosts = [];
  const result = await fetchArticleAbstract({ pmid: "123" }, async (url) => {
    const requestedUrl = new URL(url);
    requestedHosts.push(requestedUrl.hostname);
    if (requestedUrl.hostname === "eutils.ncbi.nlm.nih.gov") {
      return new Response(`
        <PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>123</PMID><Article>
          <ArticleTitle>Record without an abstract</ArticleTitle>
        </Article></MedlineCitation></PubmedArticle></PubmedArticleSet>
      `);
    }
    return Response.json({
      resultList: { result: [{ pmid: "123", abstractText: "Europe PMC fallback abstract." }] },
    });
  });
  assert.deepEqual(requestedHosts, ["eutils.ncbi.nlm.nih.gov", "www.ebi.ac.uk"]);
  assert.equal(result.text, "Europe PMC fallback abstract.");
  assert.equal(result.source, "Europe PMC");
});

test("article abstract lookup prefers Europe PMC for PMCID candidates", async () => {
  const requestedHosts = [];
  const result = await fetchArticleAbstract({ pmcid: "PMC789", pmid: "123" }, async (url) => {
    const requestedUrl = new URL(url);
    requestedHosts.push(requestedUrl.hostname);
    return Response.json({
      resultList: {
        result: [{ pmcid: "PMC789", pmid: "123", abstractText: "Europe PMC primary abstract." }],
      },
    });
  });
  assert.deepEqual(requestedHosts, ["www.ebi.ac.uk"]);
  assert.equal(result.text, "Europe PMC primary abstract.");
  assert.equal(result.source, "Europe PMC");
});

test("article abstract lookup prefers Crossref for an unrecognized DOI publisher", async () => {
  const requestedUrls = [];
  const result = await fetchArticleAbstract({ doi: "10.1002/example.123" }, async (url, init) => {
    requestedUrls.push({ url: String(url), accept: init.headers.accept, userAgent: init.headers["user-agent"] });
    if (String(url).startsWith("https://api.crossref.org/")) {
      return Response.json({
        message: {
          abstract: "<jats:title>ABSTRACT</jats:title><jats:p>Hydrogen-rich water was compared with placebo &amp; usual care.</jats:p>",
        },
      });
    }
    return Response.json({ resultList: { result: [] } });
  });

  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0].url, "https://api.crossref.org/v1/works/10.1002%2Fexample.123");
  assert.match(requestedUrls[0].userAgent, /biomedical-hydrogen-evidence/u);
  assert.equal(result.text, "Hydrogen-rich water was compared with placebo & usual care.");
  assert.equal(result.source, "Crossref（出版社提供要旨）");
  assert.equal(result.sourceUrl, "https://doi.org/10.1002/example.123");
  assert.equal(result.rightsStatus, "copyright_status_unknown");
});

test("Crossref abstract lookup reports missing abstracts without returning other metadata", async () => {
  await assert.rejects(
    fetchCrossrefAbstract({ doi: "10.1002/example.456" }, async () => Response.json({
      message: { title: ["Metadata-only record"] },
    })),
    (error) => error instanceof Error
      && error.name === "AbstractSourceError"
      && error.status === 404,
  );
});

test("article abstract lookup routes Springer Nature candidates to the publisher API first", async () => {
  const requestedUrls = [];
  const candidate = { doi: "10.1007/s00344-022-10696-0" };
  const result = await fetchArticleAbstract(candidate, async (url) => {
    const requestedUrl = new URL(url);
    requestedUrls.push(requestedUrl);
    if (requestedUrl.hostname === "api.springernature.com") {
      return Response.json({
        records: [{
          doi: candidate.doi,
          abstract: "<p>Hydrogen-rich water improved fragrant rice seedling growth under nitrogen deficiency.</p>",
        }],
      });
    }
    if (requestedUrl.hostname === "api.crossref.org") return Response.json({ message: {} });
    return Response.json({ resultList: { result: [] } });
  }, { springerNatureApiKey: "springer-test-key" });

  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0].origin + requestedUrls[0].pathname, "https://api.springernature.com/meta/v2/json");
  assert.equal(requestedUrls[0].searchParams.get("q"), `doi:${candidate.doi}`);
  assert.equal(requestedUrls[0].searchParams.get("p"), "1");
  assert.equal(requestedUrls[0].searchParams.get("api_key"), "springer-test-key");
  assert.equal(result.text, "Hydrogen-rich water improved fragrant rice seedling growth under nitrogen deficiency.");
  assert.equal(result.source, "Springer Nature Metadata API");
  assert.equal(result.sourceUrl, "https://doi.org/10.1007/s00344-022-10696-0");
});

test("Springer Nature lookup requires an exact DOI match", async () => {
  await assert.rejects(
    fetchSpringerNatureAbstract(
      { doi: "10.1007/expected" },
      "springer-test-key",
      async () => Response.json({ records: [{ doi: "10.1007/other", abstract: "Wrong abstract." }] }),
    ),
    (error) => error?.name === "AbstractSourceError" && error.status === 404,
  );
});

test("article abstract lookup routes ScienceDirect candidates to the Elsevier Article Retrieval API", async () => {
  const requested = [];
  const candidate = {
    doi: "10.1016/j.example.2026.123456",
    publisher: "Elsevier BV",
  };
  const result = await fetchArticleAbstract(candidate, async (url, init) => {
    const requestedUrl = new URL(url);
    requested.push({ url: requestedUrl, headers: new Headers(init.headers) });
    if (requestedUrl.hostname === "api.elsevier.com") {
      return Response.json({
        "full-text-retrieval-response": {
          coredata: {
            "prism:doi": candidate.doi,
            "dc:description": "<p>Abstract: Molecular hydrogen reduced oxidative stress.</p>",
            link: [{
              "@rel": "scidir",
              "@href": "http://www.sciencedirect.com/science/article/pii/S1234567890",
            }],
          },
        },
      });
    }
    if (requestedUrl.hostname === "api.crossref.org") return Response.json({ message: {} });
    return Response.json({ resultList: { result: [] } });
  }, { elsevierApiKey: "elsevier-test-key" });

  assert.equal(isElsevierCandidate(candidate), true);
  assert.equal(requested.length, 1);
  assert.equal(
    requested[0].url.origin + requested[0].url.pathname,
    "https://api.elsevier.com/content/article/doi/10.1016/j.example.2026.123456",
  );
  assert.equal(requested[0].url.searchParams.get("view"), "META_ABS");
  assert.equal(requested[0].url.searchParams.has("apiKey"), false);
  assert.equal(requested[0].headers.get("x-els-apikey"), "elsevier-test-key");
  assert.equal(result.text, "Molecular hydrogen reduced oxidative stress.");
  assert.equal(result.source, "ScienceDirect（Elsevier Article Retrieval API）");
  assert.equal(result.sourceUrl, "https://www.sciencedirect.com/science/article/pii/S1234567890");
});

test("Elsevier lookup supports a ScienceDirect PII URL when DOI metadata is missing", async () => {
  let requestedUrl;
  const result = await fetchElsevierAbstract({
    source_url: "https://www.sciencedirect.com/science/article/pii/S0014579301033130",
  }, "elsevier-test-key", async (url) => {
    requestedUrl = new URL(url);
    return Response.json({
      "full-text-retrieval-response": {
        coredata: {
          pii: "S0014579301033130",
          "dc:description": "A ScienceDirect abstract.",
        },
      },
    });
  });

  assert.equal(requestedUrl.pathname, "/content/article/pii/S0014579301033130");
  assert.equal(result.text, "A ScienceDirect abstract.");
  assert.equal(result.sourceUrl, "https://www.sciencedirect.com/science/article/pii/S0014579301033130");
});

test("Elsevier lookup falls back to the Scopus abstract for a conference abstract", async () => {
  const requestedUrls = [];
  const doi = "10.1016/j.clnesp.2022.09.747";
  const result = await fetchElsevierAbstract({ doi }, "elsevier-test-key", async (url) => {
    const requestedUrl = new URL(url);
    requestedUrls.push(requestedUrl);
    if (requestedUrl.pathname.startsWith("/content/article/")) {
      return Response.json({
        "full-text-retrieval-response": {
          coredata: { "prism:doi": doi },
        },
      });
    }
    return Response.json({
      "abstracts-retrieval-response": {
        coredata: {
          "prism:doi": doi,
          "dc:description": "Abstract: Hydrogen-rich water improved neuropsychological performance.",
        },
      },
    });
  });

  assert.deepEqual(
    requestedUrls.map((url) => url.pathname),
    [
      "/content/article/doi/10.1016/j.clnesp.2022.09.747",
      "/content/abstract/doi/10.1016/j.clnesp.2022.09.747",
    ],
  );
  assert.equal(result.text, "Hydrogen-rich water improved neuropsychological performance.");
  assert.equal(result.source, "Scopus（Elsevier Abstract Retrieval API）");
  assert.equal(result.sourceUrl, `https://doi.org/${doi}`);
});

test("ScienceDirect lookup falls back to an exact DOI abstract from OpenAlex", async () => {
  const requestedUrls = [];
  const doi = "10.1006/mthe.2001.0297";
  const result = await fetchArticleAbstract({ doi, publisher: "Elsevier BV" }, async (url) => {
    const requestedUrl = new URL(url);
    requestedUrls.push(requestedUrl);
    if (requestedUrl.hostname === "api.crossref.org") return Response.json({ message: {} });
    if (requestedUrl.hostname === "api.elsevier.com") return new Response(null, { status: 403 });
    if (requestedUrl.hostname === "api.openalex.org") {
      return Response.json({
        id: "https://openalex.org/W123",
        doi: `https://doi.org/${doi}`,
        abstract_inverted_index: {
          "stress.": [5],
          Hydrogen: [0],
          reduced: [1],
          oxidative: [4],
          treatment: [2],
          plant: [3],
        },
      });
    }
    return Response.json({ resultList: { result: [] } });
  }, {
    elsevierApiKey: "elsevier-test-key",
    openAlexApiKey: "openalex-test-key",
  });

  assert.equal(requestedUrls.length, 5);
  assert.equal(requestedUrls[1].pathname, "/content/abstract/doi/10.1006/mthe.2001.0297");
  assert.match(requestedUrls[4].pathname, /\/works\/https%3A%2F%2Fdoi\.org%2F10\.1006%2Fmthe\.2001\.0297$/u);
  assert.equal(requestedUrls[4].searchParams.get("select"), "id,doi,abstract_inverted_index");
  assert.equal(requestedUrls[4].searchParams.get("api_key"), "openalex-test-key");
  assert.equal(result.text, "Hydrogen reduced treatment plant oxidative stress.");
  assert.equal(result.source, "OpenAlex（要旨インデックス）");
  assert.equal(result.sourceUrl, "https://openalex.org/W123");
});

test("OpenAIRE lookup returns an abstract only for an exact DOI record", async () => {
  const doi = "10.1016/0022-2852(83)90039-5";
  let requestedUrl;
  const result = await fetchOpenAireAbstract({ doi }, async (url) => {
    requestedUrl = new URL(url);
    return Response.json({
      response: {
        results: {
          result: [{
            metadata: {
              "oaf:entity": {
                "oaf:result": {
                  pid: { "@classid": "doi", $: doi },
                  description: { $: "Abstract: Molecular hydrogen reduced oxidative stress." },
                },
              },
            },
          }],
        },
      },
    });
  });

  assert.equal(requestedUrl.origin + requestedUrl.pathname, "https://api.openaire.eu/search/publications");
  assert.equal(requestedUrl.searchParams.get("doi"), doi);
  assert.equal(requestedUrl.searchParams.get("format"), "json");
  assert.equal(result.text, "Molecular hydrogen reduced oxidative stress.");
  assert.equal(result.source, "OpenAIRE Research Graph");

  await assert.rejects(
    fetchOpenAireAbstract({ doi }, async () => Response.json({
      response: {
        results: {
          result: {
            metadata: {
              "oaf:entity": {
                "oaf:result": {
                  pid: { "@classid": "doi", $: "10.1016/wrong" },
                  description: { $: "Wrong abstract." },
                },
              },
            },
          },
        },
      },
    })),
    (error) => error?.name === "AbstractSourceError" && error.status === 404,
  );
});

test("OpenAlex lookup rejects malformed indexes and DOI mismatches", async () => {
  await assert.rejects(
    fetchOpenAlexAbstract({ doi: "10.1016/expected" }, "", async () => Response.json({
      doi: "https://doi.org/10.1016/other",
      abstract_inverted_index: { Wrong: [0] },
    })),
    (error) => error?.name === "AbstractSourceError" && error.status === 404,
  );
  await assert.rejects(
    fetchOpenAlexAbstract({ doi: "10.1016/expected" }, "", async () => Response.json({
      doi: "https://doi.org/10.1016/expected",
      abstract_inverted_index: { Missing: [0], position: [2] },
    })),
    (error) => error?.name === "AbstractSourceError" && error.status === 404,
  );
  const oversizedIndex = Object.fromEntries(
    Array.from({ length: 1_001 }, (_, index) => [`word${index}`, [index]]),
  );
  await assert.rejects(
    fetchOpenAlexAbstract({ doi: "10.1016/expected" }, "", async () => Response.json({
      doi: "https://doi.org/10.1016/expected",
      abstract_inverted_index: oversizedIndex,
    })),
    (error) => error?.name === "AbstractSourceError" && error.status === 404,
  );
});

test("abstract lookup uses a provider-neutral terminal error message", async () => {
  await assert.rejects(
    fetchArticleAbstract({ doi: "10.1234/no-abstract" }, async (url) => {
      if (String(url).includes("crossref.org")) return Response.json({ message: {} });
      return Response.json({ resultList: { result: [] } });
    }),
    (error) => error?.name === "AbstractSourceError"
      && error.status === 404
      && error.code === "abstract_missing"
      && error.message === "Abstract is unavailable from configured sources."
      && !/Europe PMC|Crossref|Springer|Elsevier/u.test(error.message),
  );
});

test("review translation errors do not expose failed provider names", async () => {
  const service = createReviewTranslationService({
    repository: {
      async getCandidate() {
        return { doi: "10.1016/j.example.2026.999", publisher: "Elsevier BV" };
      },
    },
    deepLClient: {},
    elsevierApiKey: "elsevier-test-key",
    fetchImpl: async (url) => {
      if (String(url).includes("crossref.org")) return Response.json({ message: {} });
      if (String(url).includes("elsevier.com")) return new Response(null, { status: 401 });
      return Response.json({ resultList: { result: [] } });
    },
  });

  await assert.rejects(
    service.translateAbstract("candidate"),
    (error) => error instanceof ReviewTranslationError
      && error.code === "abstract_fetch_failed"
      && error.message === "Abstract could not be retrieved."
      && !/Europe PMC|Crossref|Springer|Elsevier/u.test(error.message),
  );
});

test("review translation distinguishes PubMed records without abstracts", async () => {
  const service = createReviewTranslationService({
    repository: {
      async getCandidate() {
        return { pmid: "25468479" };
      },
    },
    deepLClient: {},
    fetchImpl: async (url) => {
      if (new URL(url).hostname === "eutils.ncbi.nlm.nih.gov") {
        return new Response(`
          <PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>25468479</PMID><Article>
            <ArticleTitle>Can an innocent toy become dangerous?</ArticleTitle>
          </Article></MedlineCitation></PubmedArticle></PubmedArticleSet>
        `);
      }
      return Response.json({ resultList: { result: [{ pmid: "25468479" }] } });
    },
  });

  await assert.rejects(
    service.translateAbstract("candidate"),
    (error) => error instanceof ReviewTranslationError
      && error.status === 404
      && error.code === "pubmed_abstract_missing"
      && error.message === "Abstract is not available.",
  );
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
      return {
        candidate_key: "pmid:123",
        pmid: "123",
        journal: "Test Journal",
        publisher: "Test Publisher",
        journal_metric_type: "openalex_2yr_mean_citedness",
        journal_metric_value: 3.75,
        journal_metric_year: 2025,
        journal_metric_source: "openalex",
        journal_metric_source_url: "https://openalex.org/S123",
        journal_metric_refreshed_at: "2026-08-11T00:00:00Z",
      };
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
  assert.equal(result.journal, "Test Journal");
  assert.deepEqual(result.journalMetric, {
    type: "openalex_2yr_mean_citedness",
    value: 3.75,
    year: 2025,
    source: "openalex",
    sourceUrl: "https://openalex.org/S123",
    refreshedAt: "2026-08-11T00:00:00Z",
  });
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
