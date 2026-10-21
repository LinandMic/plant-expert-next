import { test } from "node:test";
import assert from "node:assert/strict";

import { collectFetchedDocuments, extractFinalJson, groundEvidence } from "../../src/completion/grounding.js";
import { PAGES, EVIDENCE_JSON, OFF_LIST_PAGE, evidenceContent } from "./fixtures.js";

test("collectFetchedDocuments: fetched text pages, fetch errors and search hits are logged per site", () => {
  const content = evidenceContent({ blocked: [{ url: "https://www.gardenersworld.com/plants/testus-exemplaris/", error_code: "url_not_allowed" }] });
  const { docs, fetchLog, searchLog } = collectFetchedDocuments(content);
  assert.equal(docs.size, 3);
  assert.deepEqual(fetchLog.filter((f) => !f.ok), [{ url: "https://www.gardenersworld.com/plants/testus-exemplaris/", domain: "gardenersworld.com", ok: false, error_code: "url_not_allowed" }]);
  assert.equal(fetchLog.filter((f) => f.ok).length, 3);
  assert.equal(searchLog.length, 4);
});

test("extractFinalJson reads the final ```json block", () => {
  assert.deepEqual(extractFinalJson(evidenceContent()), EVIDENCE_JSON);
  assert.equal(extractFinalJson([{ type: "text", text: "no json here" }]), null);
});

test("groundEvidence: values are parsed from passages found in the fetched pages", () => {
  const { docs } = collectFetchedDocuments(evidenceContent());
  const { observations, rejected } = groundEvidence(EVIDENCE_JSON, docs);
  assert.deepEqual(rejected, []);
  const rhsHeight = observations.find((o) => o.domain === "rhs.org.uk" && o.trait === "height");
  assert.deepEqual(rhsHeight.value, { min_cm: 200, max_cm: 400, open_ended: false });
  assert.equal(rhsHeight.publisher, "Royal Horticultural Society (RHS)", "publisher comes from the site table, not the model");
  assert.equal(rhsHeight.institutional, true);
  const names = observations.filter((o) => o.trait === "common_name_fr");
  assert.deepEqual(names.map((n) => n.domain), ["inpn.mnhn.fr"]);
  assert.ok(observations.every((o) => !("quote" in o)), "passages are never kept");
});

test("groundEvidence rejects: URL never fetched, site outside the list, passage not on the page, unparseable passage, name site misuse", () => {
  const { docs } = collectFetchedDocuments(evidenceContent());
  const evidence = {
    sources: [
      { url: "https://www.rhs.org.uk/plants/11111/other/details", traits: { height: "Ultimate height 2–4 metres" } },
      { url: "https://example-nursery.com/testus", traits: { height: "Height 3 m" } },
      { url: PAGES.rhs.url, traits: { height: "Ultimate height 10–20 metres", sun: "Sunlight: Full sun, Partial shade", water_need: "Ultimate height 2–4 metres" }, common_name_fr: "Testier", },
      { url: PAGES.mbg.url, traits: { common_name_fr: "Testus exemplaris." }, common_name_fr: "Testus exemplaris" },
    ],
  };
  const { observations, rejected } = groundEvidence(evidence, docs);
  const reasons = rejected.map((r) => `${r.domain}:${r.trait}:${r.reason}`);
  assert.ok(reasons.includes("rhs.org.uk:*:url_not_fetched_in_this_call"));
  assert.ok(reasons.includes("example-nursery.com:*:site_not_allowed"));
  assert.ok(reasons.includes("rhs.org.uk:height:passage_not_found_in_page"), "a passage the page does not contain never counts");
  assert.ok(reasons.includes("rhs.org.uk:water_need:passage_not_parseable"));
  assert.ok(reasons.includes("missouribotanicalgarden.org:common_name_fr:site_not_used_for_names"));
  assert.deepEqual(observations.map((o) => `${o.domain}:${o.trait}`), ["rhs.org.uk:sun"]);
});

test("a site removed from the list (tela-botanica.org) never counts, even when fetched", () => {
  const { docs } = collectFetchedDocuments(evidenceContent({ pages: [...Object.values(PAGES), OFF_LIST_PAGE] }));
  const { observations, rejected } = groundEvidence({ sources: [{ url: OFF_LIST_PAGE.url, traits: { flowering_months: "Floraison : mars à mai." }, common_name_fr: "Testier commun" }] }, docs);
  assert.equal(observations.length, 0);
  assert.deepEqual(rejected.map((r) => r.reason), ["site_not_allowed"]);
});

test("groundEvidence: a name must literally appear in the grounded passage", () => {
  const { docs } = collectFetchedDocuments(evidenceContent());
  const evidence = { sources: [{ url: PAGES.inpn.url, traits: { common_name_fr: "Nom vernaculaire : Testier commun, Testier d'exemple." }, common_name_fr: "Testier géant" }] };
  const { observations, rejected } = groundEvidence(evidence, docs);
  assert.equal(observations.length, 0);
  assert.equal(rejected[0].reason, "name_not_in_passage");
});
