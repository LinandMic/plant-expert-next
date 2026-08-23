import { test } from "node:test";
import assert from "node:assert/strict";

import { compileSourceRecords } from "../../src/plan/compileSourceRecords.js";

function sr(overrides = {}) {
  return { catalog_ref: "acer_palmatum_species", provider: "perenual", provider_record_id: "27", provider_name: "Japanese Maple", provider_status: "ok", selection_reason: "exact_scientific_match", taxonomy_match_type: "exact_accepted_match", candidate_count: 1, retrieved_at: "2026-08-24T00:00:00.000Z", source_url: "https://perenual.com/x", metadata: {}, ...overrides };
}

test("compiles source records with a symbolic source_record_ref, no raw payload", () => {
  const { sourceRecords, errors } = compileSourceRecords([{ source_records: [sr()] }]);
  assert.deepEqual(errors, []);
  assert.equal(sourceRecords[0].source_record_ref, "acer_palmatum_species:perenual:current");
  assert.equal("raw_payload" in sourceRecords[0], false);
});

// Item 7: duplicate source_record_ref -> rejected.
test("7: a duplicate source_record_ref (same catalog_ref+provider) is rejected", () => {
  const { errors } = compileSourceRecords([{ source_records: [sr(), sr()] }]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "DUPLICATE_SOURCE_RECORD_REF");
});
