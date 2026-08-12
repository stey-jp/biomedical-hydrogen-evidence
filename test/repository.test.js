import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchStatement,
  createStudiesRepository,
  decodeCursor,
} from "../src/repositories/studies.js";

test("search SQL uses bound parameters, FTS, filters, and a bounded limit", () => {
  const statement = buildSearchStatement({
    ftsQuery: '"inhalation"',
    speciesType: "human",
    administrationRoute: "inhalation",
    authorId: "BHE-AUTHOR-000001",
    yearFrom: 2020,
    yearTo: 2026,
    humanVerifiedOnly: true,
    limit: 10,
  });
  assert.match(statement.sql, /study_search MATCH \?/u);
  assert.match(statement.sql, /route_filter\.administration_route = \?/u);
  assert.match(statement.sql, /filter_author\.public_id = \?/u);
  assert.ok(!statement.sql.includes("inhalation"));
  assert.deepEqual(statement.bindings, ['"inhalation"', "human", "inhalation", "BHE-AUTHOR-000001", 2020, 2026, 11]);
});

test("repository binds search values and returns cursor pagination", async () => {
  let captured;
  const db = {
    prepare(sql) {
      return {
        bind(...bindings) {
          captured = { sql, bindings };
          return {
            async all() {
              return {
                results: [
                  { internal_id: 2, publication_year: 2024 },
                  { internal_id: 1, publication_year: 2023 },
                ],
              };
            },
          };
        },
      };
    },
  };
  const repository = createStudiesRepository(db);
  const result = await repository.search({ ftsQuery: "", limit: 1 });
  assert.equal(result.rows.length, 1);
  assert.deepEqual(decodeCursor(result.nextCursor), { publicationYear: 2024, internalId: 2 });
  assert.equal(captured.bindings.at(-1), 2);
});
