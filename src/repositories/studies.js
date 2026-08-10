const SUMMARY_COLUMNS = `
  s.id AS internal_id,
  s.public_id,
  s.title,
  s.publication_year,
  s.record_kind,
  s.fixture_notice,
  s.verification_status,
  s.updated_at,
  c.species_type,
  c.study_design,
  p.participant_count,
  GROUP_CONCAT(DISTINCT i.administration_route) AS administration_routes
`;

function rows(result) {
  return result?.results ?? [];
}

function encodeCursor(row) {
  if (!row) return null;
  return btoa(`${row.publication_year}:${row.internal_id}`)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const base64 = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const match = /^(\d{4}):(\d+)$/u.exec(decoded);
    if (!match) return null;
    return { publicationYear: Number(match[1]), internalId: Number(match[2]) };
  } catch {
    return null;
  }
}

export function buildSearchStatement(input) {
  const joins = [
    "JOIN classifications c ON c.study_id = s.id",
    "LEFT JOIN populations p ON p.study_id = s.id",
    "LEFT JOIN interventions i ON i.study_id = s.id",
  ];
  const conditions = ["c.biomedical_relevance = 1"];
  const bindings = [];

  if (input.ftsQuery) {
    joins.push("JOIN study_search ON study_search.rowid = s.id");
    conditions.push("study_search MATCH ?");
    bindings.push(input.ftsQuery);
  }
  if (input.speciesType) {
    conditions.push("c.species_type = ?");
    bindings.push(input.speciesType);
  }
  if (input.studyDesign) {
    conditions.push("c.study_design = ?");
    bindings.push(input.studyDesign);
  }
  if (input.administrationRoute) {
    conditions.push("EXISTS (SELECT 1 FROM interventions route_filter WHERE route_filter.study_id = s.id AND route_filter.administration_route = ?)");
    bindings.push(input.administrationRoute);
  }
  if (input.condition) {
    conditions.push("p.condition_canonical = ?");
    bindings.push(input.condition);
  }
  if (input.yearFrom) {
    conditions.push("s.publication_year >= ?");
    bindings.push(input.yearFrom);
  }
  if (input.yearTo) {
    conditions.push("s.publication_year <= ?");
    bindings.push(input.yearTo);
  }
  if (input.humanVerifiedOnly) {
    conditions.push("s.verification_status = 'human_verified'");
  }
  if (input.cursor) {
    conditions.push("(s.publication_year < ? OR (s.publication_year = ? AND s.id < ?))");
    bindings.push(input.cursor.publicationYear, input.cursor.publicationYear, input.cursor.internalId);
  }

  bindings.push(input.limit + 1);
  return {
    sql: `SELECT ${SUMMARY_COLUMNS}
      FROM studies s
      ${joins.join("\n")}
      WHERE ${conditions.join(" AND ")}
      GROUP BY s.id
      ORDER BY s.publication_year DESC, s.id DESC
      LIMIT ?`,
    bindings,
  };
}

async function runBatch(db, statements) {
  if (typeof db.batch === "function") return db.batch(statements);
  return Promise.all(statements.map((statement) => statement.all()));
}

export function createStudiesRepository(db) {
  if (!db?.prepare) throw new TypeError("A D1 DB binding is required");

  return {
    async search(input) {
      const { sql, bindings } = buildSearchStatement(input);
      const found = rows(await db.prepare(sql).bind(...bindings).all());
      const hasMore = found.length > input.limit;
      const page = hasMore ? found.slice(0, input.limit) : found;
      return {
        rows: page,
        nextCursor: hasMore ? encodeCursor(page.at(-1)) : null,
      };
    },

    async getByPublicId(publicId) {
      const study = await db.prepare(`
        SELECT
          s.id AS internal_id, s.public_id, s.title, s.doi, s.pmid, s.pmcid,
          s.journal, s.publication_year, s.publication_date, s.language,
          s.publisher, s.source_url, s.doi_url, s.pubmed_url, s.pmc_url,
          s.record_kind, s.fixture_notice, s.verification_status, s.created_at, s.updated_at,
          c.biomedical_relevance, c.species_type, c.study_design, c.randomized,
          c.blinded, c.prospective, c.peer_reviewed,
          p.participant_count, p.analyzed_participant_count, p.age_description,
          p.sex_description, p.disease_or_condition, p.condition_canonical,
          p.inclusion_criteria, p.exclusion_criteria
        FROM studies s
        JOIN classifications c ON c.study_id = s.id
        LEFT JOIN populations p ON p.study_id = s.id
        WHERE s.public_id = ?
      `).bind(publicId).first();
      if (!study) return null;

      const id = study.internal_id;
      const statements = [
        db.prepare(`SELECT a.display_name, a.orcid, sa.author_order
          FROM study_authors sa JOIN authors a ON a.id = sa.author_id
          WHERE sa.study_id = ? ORDER BY sa.author_order`).bind(id),
        db.prepare(`SELECT id, molecular_hydrogen, administration_route,
          hydrogen_concentration, concentration_unit, flow_rate, flow_unit,
          dissolved_hydrogen_concentration, dissolved_hydrogen_unit, dose,
          duration_per_session, frequency, total_intervention_period,
          preparation_method, device_information, comparator
          FROM interventions WHERE study_id = ? ORDER BY id`).bind(id),
        db.prepare(`SELECT id, name, classification, measurement_method,
          intervention_value, control_value, effect_estimate, p_value,
          confidence_interval, statistically_significant, direction, time_point
          FROM outcomes WHERE study_id = ? ORDER BY id`).bind(id),
        db.prepare(`SELECT entity_type, entity_id, field_name, original_value,
          original_unit, normalized_value, normalized_unit
          FROM normalized_numeric_values WHERE study_id = ? ORDER BY id`).bind(id),
        db.prepare(`SELECT adverse_events, serious_adverse_events, withdrawals, safety_conclusion
          FROM safety WHERE study_id = ?`).bind(id),
        db.prepare(`SELECT funding, conflict_of_interest, trial_registration,
          registration_number, ethics_approval
          FROM research_transparency WHERE study_id = ?`).bind(id),
        db.prepare(`SELECT field_name, status, reviewer, note, verified_at
          FROM field_verifications WHERE study_id = ? ORDER BY field_name`).bind(id),
      ];
      const results = await runBatch(db, statements);
      return {
        study,
        authors: rows(results[0]),
        interventions: rows(results[1]),
        outcomes: rows(results[2]),
        numericValues: rows(results[3]),
        safety: rows(results[4])[0] ?? null,
        transparency: rows(results[5])[0] ?? null,
        verifications: rows(results[6]),
      };
    },

    async getEvidence(publicId) {
      const result = await db.prepare(`
        SELECT
          s.public_id,
          ep.id AS evidence_id,
          ep.field_name, ep.source_document, ep.source_type, ep.section,
          ep.page_number, ep.locator, ep.evidence_snippet, ep.source_license,
          ep.rights_status, ep.created_at,
          fv.status AS verification_status, fv.reviewer, fv.note, fv.verified_at
        FROM studies s
        LEFT JOIN evidence_provenance ep ON ep.study_id = s.id
        LEFT JOIN field_verifications fv
          ON fv.study_id = s.id AND fv.field_name = ep.field_name
        WHERE s.public_id = ?
        ORDER BY ep.field_name, ep.id
      `).bind(publicId).all();
      const found = rows(result);
      if (!found.length) return null;
      return found.filter((row) => row.evidence_id !== null);
    },

    async getFilters() {
      const statements = [
        db.prepare("SELECT DISTINCT species_type AS value FROM classifications WHERE biomedical_relevance = 1 ORDER BY value"),
        db.prepare("SELECT DISTINCT study_design AS value FROM classifications WHERE biomedical_relevance = 1 ORDER BY value"),
        db.prepare("SELECT DISTINCT administration_route AS value FROM interventions ORDER BY value"),
        db.prepare("SELECT DISTINCT condition_canonical AS value, disease_or_condition AS label FROM populations WHERE condition_canonical IS NOT NULL ORDER BY value"),
        db.prepare("SELECT MIN(publication_year) AS year_min, MAX(publication_year) AS year_max FROM studies"),
      ];
      const result = await runBatch(db, statements);
      return {
        speciesTypes: rows(result[0]),
        studyDesigns: rows(result[1]),
        administrationRoutes: rows(result[2]),
        conditions: rows(result[3]),
        years: rows(result[4])[0] ?? { year_min: null, year_max: null },
      };
    },
  };
}
