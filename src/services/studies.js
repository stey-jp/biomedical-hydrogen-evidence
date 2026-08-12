import { createStudiesRepository, decodeCursor } from "../repositories/studies.js";
import { normalizeSearchQuery, normalizeStructuredTerm } from "../search/normalize.js";
import {
  NotFoundError,
  ValidationError,
  optionalBoolean,
  optionalEnum,
  optionalInteger,
  optionalText,
  validatePublicId,
} from "../utils/validation.js";

const SPECIES_TYPES = ["human", "animal", "in_vitro", "review", "other"];
const ADMINISTRATION_ROUTES = [
  "inhalation", "hydrogen_rich_water", "bath", "saline", "injection",
  "topical", "dialysis", "other",
];

function booleanOrNull(value) {
  return value === null || value === undefined ? null : Boolean(value);
}

function mapSummary(row) {
  return {
    publicId: row.public_id,
    title: row.title,
    publicationYear: row.publication_year,
    speciesType: row.species_type,
    studyDesign: row.study_design,
    participantCount: row.participant_count,
    administrationRoutes: row.administration_routes?.split(",") ?? [],
    authors: row.author_names?.split("\u001f") ?? [],
    verificationStatus: row.verification_status,
    recordKind: row.record_kind,
    fixtureNotice: row.fixture_notice,
    updatedAt: row.updated_at,
  };
}

function mapStudy(record) {
  const { study } = record;
  return {
    publicId: study.public_id,
    bibliography: {
      title: study.title,
      authors: record.authors.map((author) => ({
        publicId: author.public_id,
        name: author.display_name,
        orcid: author.orcid,
        order: author.author_order,
      })),
      doi: study.doi,
      pmid: study.pmid,
      pmcid: study.pmcid,
      journal: study.journal,
      publicationYear: study.publication_year,
      publicationDate: study.publication_date,
      language: study.language,
      publisher: study.publisher,
      links: {
        source: study.source_url,
        doi: study.doi_url,
        pubmed: study.pubmed_url,
        pmc: study.pmc_url,
      },
    },
    classification: {
      biomedicalRelevance: Boolean(study.biomedical_relevance),
      speciesType: study.species_type,
      studyDesign: study.study_design,
      randomized: booleanOrNull(study.randomized),
      blinded: booleanOrNull(study.blinded),
      prospective: booleanOrNull(study.prospective),
      peerReviewed: booleanOrNull(study.peer_reviewed),
    },
    population: {
      participantCount: study.participant_count,
      analyzedParticipantCount: study.analyzed_participant_count,
      ageDescription: study.age_description,
      sexDescription: study.sex_description,
      diseaseOrCondition: study.disease_or_condition,
      conditionCanonical: study.condition_canonical,
      inclusionCriteria: study.inclusion_criteria,
      exclusionCriteria: study.exclusion_criteria,
    },
    interventions: record.interventions.map((item) => ({
      molecularHydrogen: Boolean(item.molecular_hydrogen),
      administrationRoute: item.administration_route,
      hydrogenConcentration: item.hydrogen_concentration,
      concentrationUnit: item.concentration_unit,
      flowRate: item.flow_rate,
      flowUnit: item.flow_unit,
      dissolvedHydrogenConcentration: item.dissolved_hydrogen_concentration,
      dissolvedHydrogenUnit: item.dissolved_hydrogen_unit,
      dose: item.dose,
      durationPerSession: item.duration_per_session,
      frequency: item.frequency,
      totalInterventionPeriod: item.total_intervention_period,
      preparationMethod: item.preparation_method,
      deviceInformation: item.device_information,
      comparator: item.comparator,
    })),
    normalizedNumericValues: record.numericValues.map((item) => ({
      entityType: item.entity_type,
      fieldName: item.field_name,
      originalValue: item.original_value,
      originalUnit: item.original_unit,
      normalizedValue: item.normalized_value,
      normalizedUnit: item.normalized_unit,
    })),
    outcomes: record.outcomes.map((item) => ({
      name: item.name,
      classification: item.classification,
      measurementMethod: item.measurement_method,
      interventionValue: item.intervention_value,
      controlValue: item.control_value,
      effectEstimate: item.effect_estimate,
      pValue: item.p_value,
      confidenceInterval: item.confidence_interval,
      statisticallySignificant: booleanOrNull(item.statistically_significant),
      direction: item.direction,
      timePoint: item.time_point,
    })),
    safety: record.safety ? {
      adverseEvents: record.safety.adverse_events,
      seriousAdverseEvents: record.safety.serious_adverse_events,
      withdrawals: record.safety.withdrawals,
      conclusion: record.safety.safety_conclusion,
    } : null,
    researchTransparency: record.transparency ? {
      funding: record.transparency.funding,
      conflictOfInterest: record.transparency.conflict_of_interest,
      trialRegistration: record.transparency.trial_registration,
      registrationNumber: record.transparency.registration_number,
      ethicsApproval: record.transparency.ethics_approval,
    } : null,
    verification: {
      status: study.verification_status,
      fields: record.verifications.map((item) => ({
        fieldName: item.field_name,
        status: item.status,
        note: item.note,
        verifiedAt: item.verified_at,
      })),
      note: "Model agreement is not proof of correctness; source evidence and human review take priority.",
    },
    recordKind: study.record_kind,
    fixtureNotice: study.fixture_notice,
    createdAt: study.created_at,
    updatedAt: study.updated_at,
  };
}

function mapEvidence(item) {
  return {
    fieldName: item.field_name,
    sourceDocument: item.source_document,
    sourceType: item.source_type,
    section: item.section,
    pageNumber: item.page_number,
    locator: item.locator,
    evidenceSnippet: item.evidence_snippet,
    sourceLicense: item.source_license,
    rightsStatus: item.rights_status,
    verification: {
      status: item.verification_status ?? "unverified",
      note: item.note,
      verifiedAt: item.verified_at,
    },
    createdAt: item.created_at,
  };
}

function validateSearchInput(input = {}) {
  const query = optionalText(input.query, "query", 200) ?? "";
  const speciesType = optionalEnum(input.speciesType, "speciesType", SPECIES_TYPES);
  const administrationRoute = optionalEnum(
    input.administrationRoute,
    "administrationRoute",
    ADMINISTRATION_ROUTES,
  );
  const studyDesignRaw = optionalText(input.studyDesign, "studyDesign", 80);
  const studyDesign = studyDesignRaw ? normalizeStructuredTerm(studyDesignRaw) : undefined;
  const conditionRaw = optionalText(input.condition, "condition", 120);
  const condition = conditionRaw ? normalizeStructuredTerm(conditionRaw) : undefined;
  const authorId = input.authorId
    ? validatePublicId(optionalText(input.authorId, "authorId", 80))
    : undefined;
  const yearFrom = optionalInteger(input.yearFrom, "yearFrom", { min: 1800, max: 2200 });
  const yearTo = optionalInteger(input.yearTo, "yearTo", { min: 1800, max: 2200 });
  if (yearFrom && yearTo && yearFrom > yearTo) {
    throw new ValidationError("yearFrom must not be greater than yearTo", "yearFrom");
  }
  const humanVerifiedOnly = optionalBoolean(input.humanVerifiedOnly, "humanVerifiedOnly") ?? false;
  const limit = optionalInteger(input.limit, "limit", { min: 1, max: 20 }) ?? 10;
  const cursorText = optionalText(input.cursor, "cursor", 200);
  const cursor = cursorText ? decodeCursor(cursorText) : null;
  if (cursorText && !cursor) throw new ValidationError("cursor is invalid", "cursor");
  const normalizedQuery = normalizeSearchQuery(query);
  return {
    query,
    normalizedQuery,
    speciesType,
    studyDesign,
    administrationRoute,
    condition,
    authorId,
    yearFrom,
    yearTo,
    humanVerifiedOnly,
    limit,
    cursor,
  };
}

export function createStudyService(db) {
  return createStudyServiceFromRepository(createStudiesRepository(db));
}

export function createStudyServiceFromRepository(repository) {
  return {
    async searchStudies(input = {}) {
      const validated = validateSearchInput(input);
      const result = await repository.search({
        ...validated,
        ftsQuery: validated.normalizedQuery.ftsQuery,
      });
      return {
        data: result.rows.map(mapSummary),
        pagination: {
          limit: validated.limit,
          nextCursor: result.nextCursor,
        },
        query: {
          original: validated.query,
          normalized: validated.normalizedQuery.canonical,
        },
      };
    },

    async getStudy(publicIdInput) {
      const publicId = validatePublicId(publicIdInput);
      const record = await repository.getByPublicId(publicId);
      if (!record) throw new NotFoundError();
      return mapStudy(record);
    },

    async getEvidence(publicIdInput) {
      const publicId = validatePublicId(publicIdInput);
      const evidence = await repository.getEvidence(publicId);
      if (evidence === null) throw new NotFoundError();
      return {
        publicId,
        evidence: evidence.map(mapEvidence),
        notice: "Snippets are short verification excerpts, not redistributed full text.",
      };
    },

    async getFilters() {
      const filters = await repository.getFilters();
      return {
        speciesTypes: filters.speciesTypes.map((item) => item.value),
        studyDesigns: filters.studyDesigns.map((item) => item.value),
        administrationRoutes: filters.administrationRoutes.map((item) => item.value),
        conditions: filters.conditions.map((item) => ({ value: item.value, label: item.label })),
        authors: (filters.authors ?? []).map((item) => ({
          value: item.value,
          label: item.label,
          studyCount: item.study_count,
        })),
        publicationYear: {
          min: filters.years.year_min,
          max: filters.years.year_max,
        },
      };
    },

    async listAuthors(input = {}) {
      const query = optionalText(input.query, "query", 120) ?? "";
      const limit = optionalInteger(input.limit, "limit", { min: 1, max: 100 }) ?? 50;
      const authors = await repository.listAuthors({ query, limit });
      return {
        data: authors.map((author) => ({
          publicId: author.public_id,
          name: author.display_name,
          nativeName: author.native_name,
          orcid: author.orcid,
          primaryAffiliation: author.primary_affiliation,
          studyCount: author.study_count,
        })),
        query,
        limit,
      };
    },

    async getAuthor(publicIdInput) {
      const publicId = validatePublicId(publicIdInput);
      const record = await repository.getAuthorByPublicId(publicId);
      if (!record) throw new NotFoundError("Author not found", "author_not_found");
      const { author } = record;
      return {
        publicId: author.public_id,
        name: author.display_name,
        givenName: author.given_name,
        familyName: author.family_name,
        nativeName: author.native_name,
        orcid: author.orcid,
        profileUrl: author.profile_url,
        affiliations: record.affiliations.map((item) => ({
          name: item.name,
          department: item.department,
          roleTitle: item.role_title,
          rorId: item.ror_id,
          city: item.city,
          region: item.region,
          countryCode: item.country_code,
          websiteUrl: item.website_url,
          startYear: item.start_year,
          endYear: item.end_year,
          isCurrent: Boolean(item.is_current),
          study: item.study_public_id ? {
            publicId: item.study_public_id,
            title: item.study_title,
            publicationYear: item.publication_year,
          } : null,
          sourceUrl: item.source_url,
          verificationStatus: item.verification_status,
          verifiedAt: item.verified_at,
        })),
        contacts: record.contacts.map((item) => ({
          type: item.contact_type,
          label: item.label,
          value: item.contact_value,
          isPrimary: Boolean(item.is_primary),
          sourceUrl: item.source_url,
          verificationStatus: item.verification_status,
          verifiedAt: item.verified_at,
        })),
        studies: record.studies.map((item) => ({
          publicId: item.public_id,
          title: item.title,
          journal: item.journal,
          publicationYear: item.publication_year,
          verificationStatus: item.verification_status,
          authorOrder: item.author_order,
        })),
        contactNotice: "公開された職務上の連絡先のみを、出典と確認状態付きで掲載します。",
        updatedAt: author.updated_at,
      };
    },
  };
}

export const searchConstants = Object.freeze({ SPECIES_TYPES, ADMINISTRATION_ROUTES });
