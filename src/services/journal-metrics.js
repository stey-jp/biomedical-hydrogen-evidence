const refreshIntervalMs = 30 * 24 * 60 * 60 * 1000;
const requestBatchSize = 1;

export function currentMetricYear(now = Date.now()) {
  return new Date(now).getUTCFullYear() - 1;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function refreshJournalMetrics({
  repository,
  client,
  now = Date.now,
  waitImpl = wait,
  limit = 12,
}) {
  if (!client.configured) return { configured: false, refreshed: 0 };
  const timestamp = now();
  const metricYear = currentMetricYear(timestamp);
  const refreshedAt = new Date(timestamp).toISOString();
  const staleBefore = new Date(timestamp - refreshIntervalMs).toISOString();
  const queue = await repository.getJournalMetricRefreshQueue({ metricYear, staleBefore, limit });
  let refreshed = 0;
  let failed = 0;
  for (let offset = 0; offset < queue.length; offset += requestBatchSize) {
    const batch = queue.slice(offset, offset + requestBatchSize);
    const lookups = await Promise.all(batch.map(async (row) => {
      try {
        return { row, result: await client.lookup(row.journal) };
      } catch {
        return { row, result: null };
      }
    }));
    const successful = lookups.filter(({ result }) => result !== null);
    failed += lookups.length - successful.length;
    await repository.saveJournalMetrics(successful.map(({ row, result }) => ({
      lookupTitleKey: row.lookup_title_key,
      lookupTitle: row.journal,
      matchedJournalTitle: result.journalTitle,
      metricType: "openalex_2yr_mean_citedness",
      metricValue: result.metricValue,
      metricYear,
      source: "openalex",
      sourceJournalId: result.sourceJournalId,
      sourceUrl: result.sourceUrl,
      sourceUpdatedAt: result.sourceUpdatedAt,
      matchStatus: result.matchStatus,
      refreshedAt,
    })));
    refreshed += successful.length;
    if (offset + requestBatchSize < queue.length) await waitImpl(1_100);
  }
  return { configured: true, metricYear, queued: queue.length, refreshed, failed };
}
