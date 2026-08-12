import { NotFoundError, ValidationError } from "../utils/validation.js";
import { errorResponse, jsonResponse } from "../utils/responses.js";

const API_NOTICE = {
  purpose: "First-party, read-only access for the official Web and future official clients.",
  medicalDisclaimer: "A study report is not proof that a medical effect is established. This service does not provide medical advice.",
};

function searchInput(searchParams) {
  return {
    query: searchParams.get("query") ?? searchParams.get("q"),
    speciesType: searchParams.get("speciesType"),
    studyDesign: searchParams.get("studyDesign"),
    administrationRoute: searchParams.get("administrationRoute"),
    condition: searchParams.get("condition"),
    authorId: searchParams.get("authorId"),
    yearFrom: searchParams.get("yearFrom"),
    yearTo: searchParams.get("yearTo"),
    humanVerifiedOnly: searchParams.get("humanVerifiedOnly"),
    limit: searchParams.get("limit"),
    cursor: searchParams.get("cursor"),
  };
}

function authorListInput(searchParams) {
  return {
    query: searchParams.get("query") ?? searchParams.get("q"),
    limit: searchParams.get("limit"),
  };
}

function decodedPathId(value, field = "publicId") {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ValidationError(`${field} has invalid URL encoding`, field);
  }
}

function withApiHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("x-api-purpose", "first-party-read-only");
  return new Response(response.body, { status: response.status, headers });
}

export async function handleApi(request, service) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse(request, 405, "method_not_allowed", "The first-party API is read-only.");
  }

  const url = new URL(request.url);
  try {
    let response;
    if (url.pathname === "/api/v1/search" || url.pathname === "/api/v1/studies") {
      const result = await service.searchStudies(searchInput(url.searchParams));
      response = jsonResponse(request, { ...result, notice: API_NOTICE });
    } else if (url.pathname === "/api/v1/authors") {
      const result = await service.listAuthors(authorListInput(url.searchParams));
      response = jsonResponse(request, { ...result, notice: API_NOTICE });
    } else if (url.pathname === "/api/v1/meta/filters") {
      response = jsonResponse(request, { data: await service.getFilters(), notice: API_NOTICE });
    } else {
      const authorMatch = /^\/api\/v1\/authors\/([^/]+?)$/u.exec(url.pathname);
      if (authorMatch) {
        const data = await service.getAuthor(decodedPathId(authorMatch[1], "authorId"));
        response = jsonResponse(request, { data, notice: API_NOTICE });
        return withApiHeaders(response);
      }
      const match = /^\/api\/v1\/studies\/([^/]+?)(\/evidence)?$/u.exec(url.pathname);
      if (!match) return errorResponse(request, 404, "not_found", "API route not found.");
      const publicId = decodedPathId(match[1]);
      const data = match[2]
        ? await service.getEvidence(publicId)
        : await service.getStudy(publicId);
      response = jsonResponse(request, { data, notice: API_NOTICE });
    }
    return withApiHeaders(response);
  } catch (error) {
    if (error instanceof ValidationError) {
      return errorResponse(request, 400, "invalid_request", error.message, { field: error.field });
    }
    if (error instanceof NotFoundError) {
      return errorResponse(request, 404, error.code, error.message);
    }
    throw error;
  }
}
