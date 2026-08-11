const apiBaseUrl = "https://www.ebi.ac.uk/europepmc/webservices/rest";
const searchEndpoint = `${apiBaseUrl}/search`;

export class AbstractSourceError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "AbstractSourceError";
    this.status = status;
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
