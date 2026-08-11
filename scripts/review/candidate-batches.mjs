export const candidateReviewColumns = [
  "candidate_key", "title", "journal", "authors", "doi", "pmid", "pmcid",
  "publication_year", "publication_date", "identifier_count", "source_count",
  "screening_hint", "sources", "source_urls", "decision", "reason", "reviewer",
];

export const screeningHints = new Set([
  "all", "likely_biomedical", "needs_review", "likely_non_biomedical",
]);

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function lexicalCompare(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function identifierCount(candidate) {
  return [candidate.doi, candidate.pmid, candidate.pmcid].filter(Boolean).length;
}

function sourceNames(candidate) {
  return uniqueSorted((candidate.sources ?? []).map((source) => source.source));
}

function sourceUrls(candidate) {
  return uniqueSorted([
    candidate.sourceRecordUrl,
    ...(candidate.sources ?? []).map((source) => source.sourceRecordUrl),
  ]);
}

export function compareCandidatesForReview(left, right) {
  const sourceDifference = sourceNames(right).length - sourceNames(left).length;
  if (sourceDifference) return sourceDifference;
  const identifierDifference = identifierCount(right) - identifierCount(left);
  if (identifierDifference) return identifierDifference;
  const yearDifference = (right.publicationYear ?? -1) - (left.publicationYear ?? -1);
  if (yearDifference) return yearDifference;
  return lexicalCompare(left.candidateKey, right.candidateKey);
}

export function candidateToReviewRow(candidate) {
  const sources = sourceNames(candidate);
  return {
    candidate_key: candidate.candidateKey,
    title: candidate.title,
    journal: candidate.journal,
    authors: (candidate.authors ?? []).join(" | "),
    doi: candidate.doi,
    pmid: candidate.pmid,
    pmcid: candidate.pmcid,
    publication_year: candidate.publicationYear,
    publication_date: candidate.publicationDate,
    identifier_count: identifierCount(candidate),
    source_count: sources.length,
    screening_hint: candidate.screeningHint,
    sources: sources.join("|"),
    source_urls: sourceUrls(candidate).join("|"),
    decision: "",
    reason: "",
    reviewer: "",
  };
}

export function buildCandidateReviewRows(candidates, {
  screeningHint = "all",
  prioritized = true,
} = {}) {
  if (!screeningHints.has(screeningHint)) throw new Error(`Invalid screening hint: ${screeningHint}`);
  const selected = screeningHint === "all"
    ? [...candidates]
    : candidates.filter((candidate) => candidate.screeningHint === screeningHint);
  if (prioritized) selected.sort(compareCandidatesForReview);
  return selected.map(candidateToReviewRow);
}

export function chunkReviewRows(rows, batchSize) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error("Batch size must be an integer between 1 and 1000");
  }
  const batches = [];
  for (let index = 0; index < rows.length; index += batchSize) {
    batches.push(rows.slice(index, index + batchSize));
  }
  return batches;
}

function rate(count, total) {
  return total ? Number((count / total).toFixed(4)) : 0;
}

function hasHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function summarizeReviewRows(rows) {
  const candidateKeys = rows.map((row) => row.candidate_key);
  const uniqueCandidateKeys = new Set(candidateKeys);
  const urlValues = rows.flatMap((row) => row.source_urls ? row.source_urls.split("|") : []);
  const countPresent = (field) => rows.filter((row) => Boolean(row[field])).length;
  const multiSourceCount = rows.filter((row) => Number(row.source_count) > 1).length;
  const sourceUrlCount = rows.filter((row) => Boolean(row.source_urls)).length;
  return {
    grain: "one candidate_key per row",
    candidateCount: rows.length,
    uniqueCandidateKeyCount: uniqueCandidateKeys.size,
    duplicateCandidateKeyCount: rows.length - uniqueCandidateKeys.size,
    missingTitleCount: rows.filter((row) => !String(row.title ?? "").trim()).length,
    identifierCompleteness: {
      doi: { count: countPresent("doi"), rate: rate(countPresent("doi"), rows.length) },
      pmid: { count: countPresent("pmid"), rate: rate(countPresent("pmid"), rows.length) },
      pmcid: { count: countPresent("pmcid"), rate: rate(countPresent("pmcid"), rows.length) },
    },
    sourceCoverage: {
      multipleSources: { count: multiSourceCount, rate: rate(multiSourceCount, rows.length) },
      sourceRecordUrl: { count: sourceUrlCount, rate: rate(sourceUrlCount, rows.length) },
      invalidSourceRecordUrlCount: urlValues.filter((value) => !hasHttpUrl(value)).length,
    },
    blankDecisionCount: rows.filter((row) => !row.decision && !row.reason && !row.reviewer).length,
  };
}

export function assertReviewRowsReady(rows) {
  if (!rows.length) throw new Error("No candidates match the requested review selection");
  const quality = summarizeReviewRows(rows);
  if (quality.duplicateCandidateKeyCount) throw new Error("Review selection contains duplicate candidate keys");
  if (quality.missingTitleCount) throw new Error("Review selection contains candidates without a title");
  if (quality.sourceCoverage.invalidSourceRecordUrlCount) {
    throw new Error("Review selection contains invalid source record URLs");
  }
  if (quality.blankDecisionCount !== quality.candidateCount) {
    throw new Error("Generated review rows must not contain prefilled human decisions");
  }
  return quality;
}
