import test from "node:test";
import assert from "node:assert/strict";
import { calculateFieldConsensus } from "../src/extraction/consensus.js";
import { normalizeNumericMeasurement } from "../src/extraction/normalize.js";
import { StubExtractionProvider } from "../src/providers/provider.js";

test("numeric normalization preserves the source representation", () => {
  assert.deepEqual(normalizeNumericMeasurement({ value: "2", unit: "%" }), {
    originalValue: "2",
    originalUnit: "%",
    normalizedValue: 0.02,
    normalizedUnit: "fraction",
    status: "normalized",
  });
});

test("consensus is field-level agreement, not a correctness claim", () => {
  const consensus = calculateFieldConsensus([
    { provider: "openai", normalizedValue: { value: 0.02, unit: "fraction" } },
    { provider: "anthropic", normalizedValue: { unit: "fraction", value: 0.02 } },
    { provider: "gemini", normalizedValue: { value: 0.04, unit: "fraction" } },
  ]);
  assert.equal(consensus.agreementCount, 2);
  assert.equal(consensus.totalCount, 3);
  assert.equal(consensus.status, "needs_human_review");
  assert.match(consensus.note, /not correctness/u);
});

test("Phase 1 provider stub performs no external call", async () => {
  const result = await new StubExtractionProvider().extract({ text: "ignored" });
  assert.equal(result.status, "disabled");
  assert.deepEqual(result.fields, []);
});

