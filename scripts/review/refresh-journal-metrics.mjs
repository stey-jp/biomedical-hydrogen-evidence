import { spawnSync } from "node:child_process";
import { createOpenAlexClient } from "../../src/journal-metrics/openalex.js";
import { refreshJournalMetrics } from "../../src/services/journal-metrics.js";

const databaseName = "biomedical-hydrogen-evidence";

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("A journal metric contains a non-finite number.");
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function executeRemote(sql) {
  const result = spawnSync(process.execPath, [
    "node_modules/wrangler/bin/wrangler.js",
    "d1", "execute", databaseName, "--remote", "--json", "--command", sql,
  ], { encoding: "utf8", shell: false });
  if (result.status !== 0) {
    throw new Error(result.error?.message || result.stderr?.trim() || "Remote D1 command failed.");
  }
  return JSON.parse(result.stdout);
}

const repository = {
  async getJournalMetricRefreshQueue({ metricYear, staleBefore, limit }) {
    const sql = `SELECT
        MIN(TRIM(c.journal)) AS journal,
        LOWER(TRIM(c.journal)) AS lookup_title_key
      FROM study_candidates c
      LEFT JOIN journal_metrics jm
        ON jm.lookup_title_key = LOWER(TRIM(c.journal))
        AND jm.metric_type = 'openalex_2yr_mean_citedness'
        AND jm.metric_year = ${sqlValue(metricYear)}
      WHERE c.journal IS NOT NULL
        AND TRIM(c.journal) <> ''
        AND (jm.refreshed_at IS NULL OR jm.refreshed_at < ${sqlValue(staleBefore)})
      GROUP BY LOWER(TRIM(c.journal))
      ORDER BY COALESCE(jm.refreshed_at, ''),
        MIN(CASE c.screening_hint
          WHEN 'likely_biomedical' THEN 0
          WHEN 'needs_review' THEN 1
          ELSE 2
        END),
        MIN(CASE WHEN c.review_status = 'pending' THEN c.id ELSE 2147483647 END),
        MIN(c.id)
      LIMIT ${sqlValue(limit)}`;
    return executeRemote(sql)[0]?.results ?? [];
  },

  async saveJournalMetrics(records) {
    if (!records.length) return [];
    const sql = records.map((record) => `INSERT INTO journal_metrics (
        lookup_title_key, lookup_title, matched_journal_title, metric_type, metric_value,
        metric_year, source, source_journal_id, source_url, source_updated_at, match_status, refreshed_at
      ) VALUES (
        ${sqlValue(record.lookupTitleKey)}, ${sqlValue(record.lookupTitle)}, ${sqlValue(record.matchedJournalTitle)},
        ${sqlValue(record.metricType)}, ${sqlValue(record.metricValue)}, ${sqlValue(record.metricYear)},
        ${sqlValue(record.source)}, ${sqlValue(record.sourceJournalId)}, ${sqlValue(record.sourceUrl)},
        ${sqlValue(record.sourceUpdatedAt)}, ${sqlValue(record.matchStatus)}, ${sqlValue(record.refreshedAt)}
      ) ON CONFLICT(lookup_title_key, metric_type, metric_year) DO UPDATE SET
        lookup_title = excluded.lookup_title,
        matched_journal_title = excluded.matched_journal_title,
        metric_value = excluded.metric_value,
        source = excluded.source,
        source_journal_id = excluded.source_journal_id,
        source_url = excluded.source_url,
        source_updated_at = excluded.source_updated_at,
        match_status = excluded.match_status,
        refreshed_at = excluded.refreshed_at;`).join("\n");
    return executeRemote(sql);
  },
};

const apiKey = process.env.OPENALEX_API_KEY?.trim();
if (!apiKey) throw new Error("OPENALEX_API_KEY is required.");

const result = await refreshJournalMetrics({
  repository,
  client: createOpenAlexClient({ apiKey }),
});
console.log(JSON.stringify(result));
