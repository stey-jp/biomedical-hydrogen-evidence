export async function searchBiomedicalHydrogenEvidence(service, input) {
  const result = await service.searchStudies({ ...input, limit: input.limit ?? 5 });
  return {
    ...result,
    scopeNotice: "Biomedical molecular hydrogen evidence only; excludes energy, fuel-cell, production, storage, and industrial hydrogen topics.",
    evidenceNotice: "Study existence and model agreement do not establish medical efficacy. Inspect provenance and verification status.",
  };
}

export async function getBiomedicalHydrogenStudy(service, input) {
  const [study, provenance] = await Promise.all([
    service.getStudy(input.publicId),
    service.getEvidence(input.publicId),
  ]);
  return {
    study,
    provenance: provenance.evidence,
    evidenceNotice: "AI-generated wording is not evidence. Source provenance takes priority over extraction consensus.",
  };
}

export function mcpResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

