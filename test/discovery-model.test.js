import test from "node:test";
import assert from "node:assert/strict";
import {
  fromCrossref,
  fromEuropePmc,
  fromPubmedSummary,
  mergeCandidates,
  normalizeDoi,
  normalizePmcid,
  normalizePmid,
  normalizeTitle,
} from "../scripts/discovery/model.mjs";

const context = { queryKey: "q1", rank: 1, retrievedAt: "2026-08-11T00:00:00.000Z" };

function record(overrides) {
  return {
    source: "pubmed",
    queryKey: "q1",
    rank: 1,
    sourceIdentifier: "1",
    sourceRecordUrl: "https://example.test/1",
    title: "Molecular hydrogen therapy in patients",
    doi: null,
    pmid: null,
    pmcid: null,
    publicationYear: 2024,
    publicationDate: null,
    journal: null,
    publisher: null,
    authors: [],
    language: "eng",
    sourceLicense: null,
    rightsStatus: "unknown",
    retrievedAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

test("identifier and title normalization is conservative", () => {
  assert.equal(normalizeDoi("https://doi.org/10.1000/ABC.1"), "10.1000/abc.1");
  assert.equal(normalizeDoi("not-a-doi"), null);
  assert.equal(normalizePmid("123456"), "123456");
  assert.equal(normalizePmid("PMID:123"), null);
  assert.equal(normalizePmcid("pmc 12345"), "PMC12345");
  assert.equal(normalizeTitle(" H₂—Therapy! "), "h2 therapy");
});

test("source mappings retain bibliographic metadata but not abstracts", () => {
  const pubmed = fromPubmedSummary({
    uid: "123",
    title: "A <b>study</b>",
    articleids: [{ idtype: "doi", value: "10.1000/Test" }],
    abstract: "must not be retained",
  }, context);
  const europePmc = fromEuropePmc({
    source: "MED",
    id: "123",
    title: "A study",
    pmid: "123",
    abstractText: "must not be retained",
  }, context);
  const crossref = fromCrossref({
    DOI: "10.1000/Test",
    title: ["A study"],
    abstract: "must not be retained",
    published: { "date-parts": [[2024, 2, 3]] },
  }, context);

  assert.equal(pubmed.title, "A study");
  assert.equal(pubmed.doi, "10.1000/test");
  assert.equal(europePmc.sourceIdentifier, "MED:123");
  assert.equal(crossref.publicationDate, "2024-02-03");
  for (const mapped of [pubmed, europePmc, crossref]) assert.equal("abstract" in mapped, false);
  assert.equal(fromEuropePmc({ title: "Missing id" }, context).sourceIdentifier, null);
});

test("deduplication links bridge records across DOI, PMID, and PMCID", () => {
  const candidates = mergeCandidates([
    record({ sourceIdentifier: "doi", doi: "10.1000/example" }),
    record({ source: "europepmc", sourceIdentifier: "MED:22", sourceRecordUrl: "https://example.test/2", doi: "10.1000/example", pmid: "22" }),
    record({ source: "crossref", sourceIdentifier: "22", sourceRecordUrl: "https://example.test/3", pmid: "22", pmcid: "PMC22" }),
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].candidateKey, "doi:10.1000/example");
  assert.equal(candidates[0].sources.length, 3);
});

test("title-year fallback deduplicates records without strong identifiers", () => {
  const candidates = mergeCandidates([
    record({ sourceIdentifier: "a" }),
    record({ source: "europepmc", sourceIdentifier: "b", sourceRecordUrl: "https://example.test/2", title: "Molecular hydrogen therapy in patients." }),
    record({ sourceIdentifier: null }),
  ]);

  assert.equal(candidates.length, 1);
  assert.match(candidates[0].candidateKey, /^title-year-sha256:/u);
  assert.equal(candidates[0].sources.length, 2);
});

test("industrial title signals override broad biomedical terms", () => {
  const [candidate] = mergeCandidates([
    record({ title: "Hydrogen production in microbial cells for a fuel cell" }),
  ]);
  assert.equal(candidate.screeningHint, "likely_non_biomedical");
  assert.ok(candidate.screeningReasons.includes("negative-title:fuel cell"));
});

test("generic biomedical titles without a hydrogen intervention need review", () => {
  const [candidate] = mergeCandidates([
    record({ title: "Molecular pathogenesis and therapeutic strategies of osteosarcoma" }),
  ]);
  assert.equal(candidate.screeningHint, "needs_review");
});
