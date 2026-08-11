const apiBaseUrl = "https://www.ebi.ac.uk/europepmc/webservices/rest";
const searchEndpoint = `${apiBaseUrl}/search`;
const pubMedFetchEndpoint = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
const crossrefWorksEndpoint = "https://api.crossref.org/v1/works";
const springerNatureMetaEndpoint = "https://api.springernature.com/meta/v2/json";
const elsevierArticleEndpoint = "https://api.elsevier.com/content/article";
const elsevierAbstractEndpoint = "https://api.elsevier.com/content/abstract";
const openAlexWorksEndpoint = "https://api.openalex.org/works";
const openAirePublicationsEndpoint = "https://api.openaire.eu/search/publications";
const crossrefUserAgent = "biomedical-hydrogen-evidence/0.1 (https://github.com/stey-jp/biomedical-hydrogen-evidence)";

export class AbstractSourceError extends Error {
  constructor(message, status = 502, code = "abstract_fetch_failed") {
    super(message);
    this.name = "AbstractSourceError";
    this.status = status;
    this.code = code;
  }
}

export function europePmcQuery(candidate) {
  if (candidate.pmid) return `EXT_ID:${candidate.pmid} AND SRC:MED`;
  if (candidate.pmcid) return `PMCID:${candidate.pmcid}`;
  if (candidate.doi) return `DOI:"${candidate.doi.replaceAll('"', "")}"`;
  return null;
}

function plainText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#(\d+);/gu, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([\da-f]+);/giu, (_, hexadecimal) => String.fromCodePoint(Number.parseInt(hexadecimal, 16)))
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/giu, (entity) => ({
      "&nbsp;": " ",
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": "\"",
      "&apos;": "'",
    })[entity.toLocaleLowerCase("en-US")])
    .replace(/\s+/gu, " ")
    .trim();
}

function abstractFromFullTextXml(xml) {
  const front = String(xml ?? "").match(/<front\b[^>]*>[\s\S]*?<\/front>/iu)?.[0] ?? "";
  const abstract = front.match(/<abstract\b[^>]*>[\s\S]*?<\/abstract>/iu)?.[0];
  return plainText(abstract);
}

function pubMedAbstractFromXml(xml, expectedPmid) {
  const source = String(xml ?? "");
  const article = source.match(/<(PubmedArticle|PubmedBookArticle)\b[^>]*>[\s\S]*?<\/\1>/iu)?.[0];
  if (!article) return null;
  const returnedPmid = article.match(/<PMID\b[^>]*>\s*(\d+)\s*<\/PMID>/iu)?.[1];
  if (returnedPmid !== expectedPmid) return null;
  const abstract = [...article.matchAll(/<AbstractText\b[^>]*>[\s\S]*?<\/AbstractText>/giu)]
    .map((match) => plainText(match[0]))
    .filter(Boolean)
    .join(" ");
  return { abstract, returnedPmid };
}

function normalizedDoi(candidate) {
  return String(candidate?.doi ?? "").trim().toLocaleLowerCase("en-US");
}

function sourceHostname(candidate) {
  try {
    return new URL(candidate?.source_url ?? candidate?.sourceUrl ?? "").hostname.toLocaleLowerCase("en-US");
  } catch {
    return "";
  }
}

export function isSpringerNatureCandidate(candidate) {
  const doi = normalizedDoi(candidate);
  const publisher = String(candidate?.publisher ?? "").toLocaleLowerCase("en-US");
  return /^(?:10\.1007|10\.1038|10\.1057|10\.1186)\//u.test(doi)
    || /springer|nature portfolio|biomed central/u.test(publisher)
    || sourceHostname(candidate).endsWith("springer.com");
}

export function isElsevierCandidate(candidate) {
  const doi = normalizedDoi(candidate);
  const publisher = String(candidate?.publisher ?? "").toLocaleLowerCase("en-US");
  const hostname = sourceHostname(candidate);
  return /^(?:10\.1006|10\.1016|10\.1053|10\.1054|10\.1067)\//u.test(doi)
    || /elsevier|cell press/u.test(publisher)
    || hostname === "sciencedirect.com"
    || hostname.endsWith(".sciencedirect.com");
}

function elsevierIdentifier(candidate) {
  const doi = String(candidate?.doi ?? "").trim();
  if (doi) return { type: "doi", value: doi };
  try {
    const pathname = new URL(candidate?.source_url ?? candidate?.sourceUrl ?? "").pathname;
    const pii = pathname.match(/\/science\/article\/pii\/([^/]+)/iu)?.[1];
    return pii ? { type: "pii", value: decodeURIComponent(pii) } : null;
  } catch {
    return null;
  }
}

function abstractFromInvertedIndex(index) {
  if (!index || typeof index !== "object" || Array.isArray(index)) return "";
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!word || !Array.isArray(positions)) return "";
    for (const position of positions) {
      if (!Number.isInteger(position) || position < 0 || position > 12_000 || words[position] !== undefined) {
        return "";
      }
      words[position] = word;
    }
  }
  if (!words.length || words.includes(undefined)) return "";
  return plainText(words.join(" "));
}

async function fetchFullTextAbstract(pmcid, fetchImpl) {
  const normalizedPmcid = String(pmcid ?? "").trim();
  if (!/^PMC\d+$/iu.test(normalizedPmcid)) return "";
  let response;
  try {
    response = await fetchImpl(`${apiBaseUrl}/${encodeURIComponent(normalizedPmcid)}/fullTextXML`, {
      headers: { accept: "application/xml" },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new AbstractSourceError("Europe PMC full text request failed.");
  }
  if (response.status === 404) return "";
  if (!response.ok) {
    throw new AbstractSourceError(`Europe PMC full text request failed with status ${response.status}.`);
  }
  return abstractFromFullTextXml(await response.text());
}

export async function fetchEuropePmcAbstract(candidate, fetchImpl = fetch) {
  const query = europePmcQuery(candidate);
  if (!query) throw new AbstractSourceError("No supported abstract identifier is available.", 404);
  const url = new URL(searchEndpoint);
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("resultType", "core");
  url.searchParams.set("pageSize", "1");
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new AbstractSourceError("Europe PMC request failed.");
  }
  if (!response.ok) throw new AbstractSourceError(`Europe PMC request failed with status ${response.status}.`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new AbstractSourceError("Europe PMC returned an invalid response.");
  }
  const record = body?.resultList?.result?.[0];
  const abstract = plainText(record?.abstractText)
    || await fetchFullTextAbstract(record?.pmcid ?? candidate.pmcid, fetchImpl);
  if (!abstract) throw new AbstractSourceError("Abstract is not available from Europe PMC.", 404);
  if (abstract.length > 12_000) throw new AbstractSourceError("Abstract is too long for on-demand translation.", 413);
  const sourceUrl = record?.pmcid
    ? `https://europepmc.org/article/PMC/${encodeURIComponent(record.pmcid)}`
    : record?.pmid
      ? `https://europepmc.org/article/MED/${encodeURIComponent(record.pmid)}`
      : candidate.source_url;
  return {
    text: abstract,
    source: "Europe PMC",
    sourceUrl,
    rightsStatus: record?.isOpenAccess === "Y" ? "open_access_check_license" : "copyright_status_unknown",
  };
}

export async function fetchPubMedAbstract(candidate, fetchImpl = fetch) {
  const pmid = String(candidate?.pmid ?? "").trim();
  if (!/^\d{1,12}$/u.test(pmid)) {
    throw new AbstractSourceError("No valid PMID is available for PubMed lookup.", 404, "abstract_missing");
  }
  const url = new URL(pubMedFetchEndpoint);
  url.searchParams.set("db", "pubmed");
  url.searchParams.set("id", pmid);
  url.searchParams.set("retmode", "xml");
  url.searchParams.set("tool", "biomedical_hydrogen_evidence");
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/xml" },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new AbstractSourceError("PubMed request failed.");
  }
  if (response.status === 404) {
    throw new AbstractSourceError("PubMed record is not available.", 404, "abstract_missing");
  }
  if (!response.ok) throw new AbstractSourceError(`PubMed request failed with status ${response.status}.`);
  const xml = await response.text();
  if (xml.length > 2_000_000) throw new AbstractSourceError("PubMed returned an oversized response.");
  const record = pubMedAbstractFromXml(xml, pmid);
  if (!record) throw new AbstractSourceError("PubMed returned an invalid record.");
  if (!record.abstract) {
    throw new AbstractSourceError("PubMed record does not contain an abstract.", 404, "pubmed_abstract_missing");
  }
  if (record.abstract.length > 12_000) {
    throw new AbstractSourceError("Abstract is too long for on-demand translation.", 413);
  }
  return {
    text: record.abstract,
    source: "PubMed",
    sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/`,
    rightsStatus: "copyright_status_unknown",
  };
}

export async function fetchCrossrefAbstract(candidate, fetchImpl = fetch) {
  const doi = String(candidate.doi ?? "").trim();
  if (!doi) throw new AbstractSourceError("No DOI is available for Crossref lookup.", 404);
  let response;
  try {
    response = await fetchImpl(`${crossrefWorksEndpoint}/${encodeURIComponent(doi)}`, {
      headers: {
        accept: "application/json",
        "user-agent": crossrefUserAgent,
      },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new AbstractSourceError("Crossref request failed.");
  }
  if (response.status === 404) throw new AbstractSourceError("Abstract is not available from Crossref.", 404);
  if (!response.ok) throw new AbstractSourceError(`Crossref request failed with status ${response.status}.`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new AbstractSourceError("Crossref returned an invalid response.");
  }
  const abstract = plainText(body?.message?.abstract).replace(/^abstract\b[\s:.-]*/iu, "");
  if (!abstract) throw new AbstractSourceError("Abstract is not available from Crossref.", 404);
  if (abstract.length > 12_000) throw new AbstractSourceError("Abstract is too long for on-demand translation.", 413);
  return {
    text: abstract,
    source: "Crossref（出版社提供要旨）",
    sourceUrl: `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`,
    rightsStatus: "copyright_status_unknown",
  };
}

export async function fetchSpringerNatureAbstract(candidate, apiKey, fetchImpl = fetch) {
  const doi = String(candidate.doi ?? "").trim();
  const normalizedApiKey = String(apiKey ?? "").trim();
  if (!doi) throw new AbstractSourceError("No DOI is available for Springer Nature lookup.", 404);
  if (!normalizedApiKey) throw new AbstractSourceError("Springer Nature API key is not configured.", 503);
  const url = new URL(springerNatureMetaEndpoint);
  url.searchParams.set("q", `doi:${doi}`);
  url.searchParams.set("p", "1");
  url.searchParams.set("api_key", normalizedApiKey);
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new AbstractSourceError("Springer Nature request failed.");
  }
  if (response.status === 404) throw new AbstractSourceError("Abstract is not available from Springer Nature.", 404);
  if (!response.ok) throw new AbstractSourceError(`Springer Nature request failed with status ${response.status}.`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new AbstractSourceError("Springer Nature returned an invalid response.");
  }
  const normalizedDoi = doi.toLocaleLowerCase("en-US");
  const record = body?.records?.find((item) => {
    const recordDoi = String(item?.doi ?? item?.identifier ?? "")
      .replace(/^doi:/iu, "")
      .trim()
      .toLocaleLowerCase("en-US");
    return recordDoi === normalizedDoi;
  });
  const abstract = plainText(record?.abstract).replace(/^abstract\b[\s:.-]*/iu, "");
  if (!abstract) throw new AbstractSourceError("Abstract is not available from Springer Nature.", 404);
  if (abstract.length > 12_000) throw new AbstractSourceError("Abstract is too long for on-demand translation.", 413);
  return {
    text: abstract,
    source: "Springer Nature Metadata API",
    sourceUrl: `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`,
    rightsStatus: "copyright_status_unknown",
  };
}

export async function fetchElsevierAbstract(candidate, apiKey, fetchImpl = fetch) {
  const identifier = elsevierIdentifier(candidate);
  const normalizedApiKey = String(apiKey ?? "").trim();
  if (!identifier) throw new AbstractSourceError("No supported identifier is available for Elsevier lookup.", 404);
  if (!normalizedApiKey) throw new AbstractSourceError("Elsevier API key is not configured.", 503);
  const encodedIdentifier = identifier.value.split("/").map(encodeURIComponent).join("/");
  const requests = [
    {
      endpoint: elsevierArticleEndpoint,
      responseKey: "full-text-retrieval-response",
      source: "ScienceDirect（Elsevier Article Retrieval API）",
    },
    {
      endpoint: elsevierAbstractEndpoint,
      responseKey: "abstracts-retrieval-response",
      source: "Scopus（Elsevier Abstract Retrieval API）",
    },
  ];
  let providerFailure = null;

  for (const request of requests) {
    const url = new URL(`${request.endpoint}/${identifier.type}/${encodedIdentifier}`);
    url.searchParams.set("view", "META_ABS");
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          accept: "application/json",
          "x-els-apikey": normalizedApiKey,
        },
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      providerFailure ??= new AbstractSourceError("Elsevier request failed.");
      continue;
    }
    if (!response.ok) {
      if (response.status !== 404) {
        providerFailure ??= new AbstractSourceError(`Elsevier request failed with status ${response.status}.`);
      }
      continue;
    }
    let body;
    try {
      body = await response.json();
    } catch {
      providerFailure ??= new AbstractSourceError("Elsevier returned an invalid response.");
      continue;
    }
    const coredata = body?.[request.responseKey]?.coredata;
    const returnedIdentifier = identifier.type === "doi"
      ? String(coredata?.["prism:doi"] ?? "")
      : String(coredata?.pii ?? "");
    if (returnedIdentifier
      && returnedIdentifier.trim().toLocaleLowerCase("en-US") !== identifier.value.toLocaleLowerCase("en-US")) {
      continue;
    }
    const abstract = plainText(coredata?.["dc:description"]).replace(/^abstract\b[\s:.-]*/iu, "");
    if (!abstract) continue;
    if (abstract.length > 12_000) {
      throw new AbstractSourceError("Abstract is too long for on-demand translation.", 413);
    }
    const sourceLink = Array.isArray(coredata?.link)
      ? coredata.link.find((link) => link?.["@rel"] === "scidir")?.["@href"]
      : null;
    const sourceUrl = sourceLink?.replace(/^http:/u, "https:")
      ?? (identifier.type === "pii"
        ? `https://www.sciencedirect.com/science/article/pii/${encodeURIComponent(identifier.value)}`
        : `https://doi.org/${identifier.value.split("/").map(encodeURIComponent).join("/")}`);
    return {
      text: abstract,
      source: request.source,
      sourceUrl,
      rightsStatus: coredata?.openaccessFlag === true ? "open_access_check_license" : "copyright_status_unknown",
    };
  }

  if (providerFailure) throw providerFailure;
  throw new AbstractSourceError("Abstract is not available from Elsevier.", 404);
}

export async function fetchOpenAlexAbstract(candidate, apiKey = "", fetchImpl = fetch) {
  const doi = String(candidate?.doi ?? "").trim();
  if (!doi) throw new AbstractSourceError("No DOI is available for OpenAlex lookup.", 404);
  const workIdentifier = encodeURIComponent(`https://doi.org/${doi}`);
  const url = new URL(`${openAlexWorksEndpoint}/${workIdentifier}`);
  url.searchParams.set("select", "id,doi,abstract_inverted_index");
  const normalizedApiKey = String(apiKey ?? "").trim();
  if (normalizedApiKey) url.searchParams.set("api_key", normalizedApiKey);
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new AbstractSourceError("OpenAlex request failed.");
  }
  if (response.status === 404) throw new AbstractSourceError("Abstract is not available from OpenAlex.", 404);
  if (!response.ok) throw new AbstractSourceError(`OpenAlex request failed with status ${response.status}.`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new AbstractSourceError("OpenAlex returned an invalid response.");
  }
  const returnedDoi = String(body?.doi ?? "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, "")
    .trim()
    .toLocaleLowerCase("en-US");
  if (returnedDoi !== doi.toLocaleLowerCase("en-US")) {
    throw new AbstractSourceError("Abstract is not available from OpenAlex.", 404);
  }
  const abstract = abstractFromInvertedIndex(body?.abstract_inverted_index);
  if (!abstract) throw new AbstractSourceError("Abstract is not available from OpenAlex.", 404);
  const wordCount = abstract.split(/\s+/u).length;
  if (abstract.length > 8_000 || wordCount > 1_000) {
    throw new AbstractSourceError("OpenAlex record does not contain an abstract-sized text.", 404);
  }
  return {
    text: abstract,
    source: "OpenAlex（要旨インデックス）",
    sourceUrl: String(body?.id ?? "").replace("https://api.openalex.org/", "https://openalex.org/")
      || `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`,
    rightsStatus: "copyright_status_unknown",
  };
}

export async function fetchOpenAireAbstract(candidate, fetchImpl = fetch) {
  const doi = String(candidate?.doi ?? "").trim();
  if (!doi) throw new AbstractSourceError("No DOI is available for OpenAIRE lookup.", 404);
  const url = new URL(openAirePublicationsEndpoint);
  url.searchParams.set("doi", doi);
  url.searchParams.set("format", "json");
  url.searchParams.set("size", "5");
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "user-agent": crossrefUserAgent,
      },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new AbstractSourceError("OpenAIRE request failed.");
  }
  if (response.status === 404) throw new AbstractSourceError("Abstract is not available from OpenAIRE.", 404);
  if (!response.ok) throw new AbstractSourceError(`OpenAIRE request failed with status ${response.status}.`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new AbstractSourceError("OpenAIRE returned an invalid response.");
  }
  const records = Array.isArray(body?.response?.results?.result)
    ? body.response.results.result
    : body?.response?.results?.result ? [body.response.results.result] : [];
  const expectedDoi = doi.toLocaleLowerCase("en-US");
  const record = records
    .map((item) => item?.metadata?.["oaf:entity"]?.["oaf:result"])
    .find((item) => {
      const identifiers = Array.isArray(item?.pid) ? item.pid : item?.pid ? [item.pid] : [];
      return identifiers.some((identifier) => String(identifier?.["@classid"] ?? "").toLocaleLowerCase("en-US") === "doi"
        && String(identifier?.$ ?? "").trim().toLocaleLowerCase("en-US") === expectedDoi);
    });
  const descriptions = Array.isArray(record?.description)
    ? record.description
    : record?.description ? [record.description] : [];
  const abstract = descriptions
    .map((description) => plainText(typeof description === "string" ? description : description?.$)
      .replace(/^abstract\b[\s:.-]*/iu, ""))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)[0] ?? "";
  if (!abstract) throw new AbstractSourceError("Abstract is not available from OpenAIRE.", 404);
  const wordCount = abstract.split(/\s+/u).length;
  if (abstract.length > 8_000 || wordCount > 1_000) {
    throw new AbstractSourceError("OpenAIRE record does not contain an abstract-sized text.", 404);
  }
  return {
    text: abstract,
    source: "OpenAIRE Research Graph",
    sourceUrl: `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`,
    rightsStatus: "copyright_status_unknown",
  };
}

export async function fetchArticleAbstract(candidate, fetchImpl = fetch, options = {}) {
  const lookups = [];

  // Prefer the original publisher when it can be identified, then retain the
  // identifier-specific sources as fallbacks for incomplete publisher records.
  if (options.elsevierApiKey && isElsevierCandidate(candidate)) {
    lookups.push(() => fetchElsevierAbstract(candidate, options.elsevierApiKey, fetchImpl));
  }
  if (candidate.doi && options.springerNatureApiKey && isSpringerNatureCandidate(candidate)) {
    lookups.push(() => fetchSpringerNatureAbstract(candidate, options.springerNatureApiKey, fetchImpl));
  }

  if (candidate.pmcid) {
    lookups.push(() => fetchEuropePmcAbstract(candidate, fetchImpl));
    if (candidate.pmid) lookups.push(() => fetchPubMedAbstract(candidate, fetchImpl));
    if (candidate.doi) lookups.push(() => fetchCrossrefAbstract(candidate, fetchImpl));
  } else if (candidate.pmid) {
    lookups.push(() => fetchPubMedAbstract(candidate, fetchImpl));
    lookups.push(() => fetchEuropePmcAbstract(candidate, fetchImpl));
    if (candidate.doi) lookups.push(() => fetchCrossrefAbstract(candidate, fetchImpl));
  } else if (candidate.doi) {
    lookups.push(() => fetchCrossrefAbstract(candidate, fetchImpl));
    lookups.push(() => fetchEuropePmcAbstract(candidate, fetchImpl));
  }

  if (candidate.doi) {
    lookups.push(() => fetchOpenAlexAbstract(candidate, options.openAlexApiKey, fetchImpl));
    lookups.push(() => fetchOpenAireAbstract(candidate, fetchImpl));
  }
  let providerFailure = null;
  let pubMedAbstractMissing = false;
  for (const lookup of lookups) {
    try {
      return await lookup();
    } catch (error) {
      if (!(error instanceof AbstractSourceError) || error.status === 413) throw error;
      if (error.code === "pubmed_abstract_missing") pubMedAbstractMissing = true;
      if (error.status !== 404 && !providerFailure) providerFailure = error;
    }
  }
  if (pubMedAbstractMissing) {
    throw new AbstractSourceError("Abstract is not available.", 404, "pubmed_abstract_missing");
  }
  if (providerFailure) {
    throw new AbstractSourceError("Abstract lookup failed.", providerFailure.status, "abstract_fetch_failed");
  }
  throw new AbstractSourceError("Abstract is unavailable from configured sources.", 404, "abstract_missing");
}
