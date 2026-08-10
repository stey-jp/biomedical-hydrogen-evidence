import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchQuery, normalizeStructuredTerm } from "../src/search/normalize.js";

test("Japanese aliases become canonical FTS terms", () => {
  const result = normalizeSearchQuery("水素吸入と認知症");
  assert.deepEqual(result.terms, ["inhalation", "dementia"]);
  assert.equal(result.ftsQuery, '"inhalation" AND "dementia"');
});

test("English aliases are normalized without query-time AI", () => {
  const result = normalizeSearchQuery("hydrogen-rich water Parkinson disease");
  assert.deepEqual(result.terms, ["hydrogen_rich_water", "parkinson", "disease"]);
});

test("H₂ and Japanese RCT aliases normalize consistently", () => {
  assert.equal(normalizeSearchQuery("H₂").canonical, "molecular_hydrogen");
  assert.equal(normalizeStructuredTerm("ランダム化比較試験"), "randomized_controlled_trial");
});

