import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { createStudyService } from "../services/studies.js";
import {
  getBiomedicalHydrogenStudy,
  mcpResult,
  searchBiomedicalHydrogenEvidence,
} from "./mcp-tools.js";

const SEARCH_DESCRIPTION = `Search structured biomedical evidence about molecular hydrogen (H₂), including molecular hydrogen, H2/H₂, hydrogen inhalation, hydrogen-rich water, hydrogen gas interventions, and clinical, animal, or in-vitro research. This tool is not for hydrogen energy, green hydrogen, fuel cells, hydrogen production, hydrogen storage, or industrial hydrogen. It reads stored D1 evidence and never invokes an LLM.`;

export function createBiomedicalHydrogenMcpServer(service) {
  const server = new McpServer({
    name: "biomedical-hydrogen-evidence",
    version: "0.1.0",
  });

  server.registerTool(
    "search_biomedical_hydrogen_evidence",
    {
      description: SEARCH_DESCRIPTION,
      inputSchema: {
        query: z.string().max(200).optional().describe("Biomedical molecular-hydrogen keywords in English or Japanese."),
        speciesType: z.enum(["human", "animal", "in_vitro", "review", "other"]).optional(),
        studyDesign: z.string().max(80).optional(),
        administrationRoute: z.enum([
          "inhalation", "hydrogen_rich_water", "bath", "saline", "injection",
          "topical", "dialysis", "other",
        ]).optional(),
        condition: z.string().max(120).optional(),
        yearFrom: z.number().int().min(1800).max(2200).optional(),
        yearTo: z.number().int().min(1800).max(2200).optional(),
        humanVerifiedOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(10).default(5),
      },
    },
    async (input) => mcpResult(await searchBiomedicalHydrogenEvidence(service, input)),
  );

  server.registerTool(
    "get_biomedical_hydrogen_study",
    {
      description: "Get one molecular-hydrogen biomedical study by stable public ID, including bibliography, design, population, interventions, outcomes, safety, provenance, and verification. Reads stored D1 data only and never invokes an LLM.",
      inputSchema: {
        publicId: z.string().min(1).max(80).describe("Stable study public ID returned by the search tool."),
      },
    },
    async (input) => mcpResult(await getBiomedicalHydrogenStudy(service, input)),
  );

  return server;
}

export function handleMcp(request, env, ctx) {
  const handler = createMcpHandler(
    () => createBiomedicalHydrogenMcpServer(createStudyService(env.DB)),
    {
      route: "/mcp",
      corsOptions: false,
      legacy: "reject",
      responseMode: "auto",
    },
  );
  return handler(request, env, ctx);
}

