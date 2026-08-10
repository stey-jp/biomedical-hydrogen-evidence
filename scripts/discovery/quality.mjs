import { normalizeDoi, normalizePmcid, normalizePmid, normalizeTitle } from "./model.mjs";

function rate(count, total) {
  return total ? Number((count / total).toFixed(4)) : 0;
}

function countsBy(values) {
  return values.reduce((counts, value) => {
    const key = value ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function duplicateValueCount(values) {
  const counts = countsBy(values.filter(Boolean));
  return Object.values(counts).filter((count) => count > 1).length;
}

export function profileDiscovery(records, candidates, queries, now = new Date()) {
  const rawRecordCount = records.length;
  const candidateCount = candidates.length;
  const sourceCounts = countsBy(records.map((record) => record.source));
  const hintCounts = countsBy(candidates.map((candidate) => candidate.screeningHint));
  const currentYear = now.getUTCFullYear();
  const invalidRecords = records.filter((record) => (
    !record.sourceIdentifier
    || !record.sourceRecordUrl
    || !normalizeTitle(record.title)
  )).length;
  const candidateKeyDuplicates = duplicateValueCount(candidates.map((candidate) => candidate.candidateKey));
  const crossSourceCandidates = candidates.filter((candidate) => (
    new Set(candidate.sources.map((source) => source.source)).size > 1
  )).length;
  const queryRetrieval = queries.map((query) => ({
    source: query.source,
    queryKey: query.queryKey,
    reportedResultCount: query.reportedResultCount,
    retrievedCount: query.retrievedCount,
    retrievalRate: rate(query.retrievedCount, query.reportedResultCount),
  }));

  const identifierCompleteness = {
    doi: {
      count: candidates.filter((candidate) => normalizeDoi(candidate.doi)).length,
      rate: rate(candidates.filter((candidate) => normalizeDoi(candidate.doi)).length, candidateCount),
    },
    pmid: {
      count: candidates.filter((candidate) => normalizePmid(candidate.pmid)).length,
      rate: rate(candidates.filter((candidate) => normalizePmid(candidate.pmid)).length, candidateCount),
    },
    pmcid: {
      count: candidates.filter((candidate) => normalizePmcid(candidate.pmcid)).length,
      rate: rate(candidates.filter((candidate) => normalizePmcid(candidate.pmcid)).length, candidateCount),
    },
    publicationYear: {
      count: candidates.filter((candidate) => candidate.publicationYear).length,
      rate: rate(candidates.filter((candidate) => candidate.publicationYear).length, candidateCount),
    },
  };

  const checks = {
    invalidRawRecords: invalidRecords,
    duplicateCandidateKeys: candidateKeyDuplicates,
    duplicateStrongIdentifiersAfterMerge: {
      doi: duplicateValueCount(candidates.map((candidate) => candidate.doi)),
      pmid: duplicateValueCount(candidates.map((candidate) => candidate.pmid)),
      pmcid: duplicateValueCount(candidates.map((candidate) => candidate.pmcid)),
    },
    futurePublicationYears: candidates.filter((candidate) => candidate.publicationYear > currentYear + 1).length,
    placeholderTitles: candidates.filter((candidate) => candidate.title === "[Title unavailable]").length,
  };

  const risks = [];
  if (invalidRecords) risks.push({ severity: "high", code: "invalid_source_records", count: invalidRecords });
  if (candidateKeyDuplicates || Object.values(checks.duplicateStrongIdentifiersAfterMerge).some(Boolean)) {
    risks.push({ severity: "high", code: "duplicate_candidate_identity" });
  }
  if (checks.futurePublicationYears) {
    risks.push({ severity: "high", code: "future_publication_year", count: checks.futurePublicationYears });
  }
  if (checks.placeholderTitles) {
    risks.push({ severity: "medium", code: "missing_titles", count: checks.placeholderTitles });
  }
  const screeningRequired = (hintCounts.likely_non_biomedical ?? 0) + (hintCounts.needs_review ?? 0);
  if (screeningRequired > 0) {
    risks.push({
      severity: "medium",
      code: "scope_screening_required",
      count: screeningRequired,
    });
  }

  return {
    grain: "one candidate per linked DOI, PMID, PMCID, or normalized title-year identity",
    rawRecordCount,
    candidateCount,
    deduplicatedRecordCount: rawRecordCount - candidateCount,
    deduplicationRate: rate(rawRecordCount - candidateCount, rawRecordCount),
    sourceCounts,
    screeningHintCounts: hintCounts,
    crossSourceCandidates: {
      count: crossSourceCandidates,
      rate: rate(crossSourceCandidates, candidateCount),
    },
    identifierCompleteness,
    queryRetrieval,
    checks,
    risks,
    passedBlockingChecks: !risks.some((risk) => risk.severity === "high"),
  };
}
