import { test } from "node:test";
import assert from "node:assert/strict";

import { decidePlant, plausibilityErrors, withinTolerance } from "../../src/completion/decide.js";
import { collectFetchedDocuments, groundEvidence } from "../../src/completion/grounding.js";
import { PAGES, PROPOSAL, EVIDENCE_JSON, evidenceContent, DRAFT_EMPTY_ROW } from "./fixtures.js";

function grounded(evidence = EVIDENCE_JSON, pages) {
  const { docs } = collectFetchedDocuments(evidenceContent({ pages, evidence }));
  return groundEvidence(evidence, docs).observations;
}

test("AI + 2 grounded sites (1 institutional) agreeing -> every column verified, publishable", () => {
  const d = decidePlant({ proposal: PROPOSAL, observations: grounded(), existing: DRAFT_EMPTY_ROW });
  assert.equal(d.publishable, true);
  assert.equal(d.columns.plant_type.value, "shrub");
  assert.deepEqual(d.columns.sun.value, ["full_sun", "partial_sun"]);
  // RHS 200–400 cm ∩ MBG 183–366 cm = 200–366 -> upper bound 366, lower bound 200
  assert.equal(d.columns.height_max_cm.value, 366);
  assert.equal(d.columns.height_min_cm.value, 200);
  // RHS 150–250 ∩ MBG 152–244 -> 244
  assert.equal(d.columns.spread_max_cm.value, 244);
  assert.equal(d.columns.evergreen.value, true);
  assert.equal(d.columns.water_need.value, "moderate");
  assert.deepEqual(d.columns.flowering_months.value, [3, 4, 5]);
  // only one French-name site left (INPN) -> the name cannot be verified
  assert.equal(d.common_name_fr.status, "to_verify");
  assert.match(d.common_name_fr.reasons[0], /insufficient_sources/);
  for (const col of Object.values(d.columns)) assert.equal(col.emit, true);
  assert.deepEqual(d.columns.plant_type.sources.map((s) => s.domain).sort(), ["missouribotanicalgarden.org", "rhs.org.uk"]);
});

test("a single grounded site is never enough", () => {
  const only = { sources: [EVIDENCE_JSON.sources[0]] };
  const d = decidePlant({ proposal: PROPOSAL, observations: grounded(only, [PAGES.rhs]), existing: DRAFT_EMPTY_ROW });
  assert.equal(d.publishable, false);
  assert.equal(d.columns.plant_type.status, "to_verify");
  assert.match(d.columns.plant_type.reasons[0], /insufficient_sources/);
});

test("several pages of the same non-institutional site are still one site", () => {
  const gw1 = { url: "https://www.gardenersworld.com/plants/testus-exemplaris/", title: "GW", text: "Flowering: March to May" };
  const gw2 = { url: "https://www.gardenersworld.com/how-to/testus-exemplaris-care/", title: "GW 2", text: "Flowering: March to May" };
  const evidence = { sources: [{ url: gw1.url, traits: { flowering_months: "Flowering: March to May" } }, { url: gw2.url, traits: { flowering_months: "Flowering: March to May" } }] };
  const d = decidePlant({ proposal: PROPOSAL, observations: grounded(evidence, [gw1, gw2]), existing: DRAFT_EMPTY_ROW });
  assert.equal(d.columns.flowering_months.status, "to_verify");
  assert.match(d.columns.flowering_months.reasons[0], /insufficient_sources \(1 grounded site/);
});

test("interval overlap: a wide band agrees with a precise value; retained = upper bound of the intersection", () => {
  const band = { ...PAGES.rhs, text: "Testus exemplaris. Type: Evergreen shrub. Ultimate height 4–8 metres." };
  const precise = { ...PAGES.mbg, text: "Testus exemplaris. Type: Broadleaf evergreen shrub. Height: 10.00 to 15.00 feet." };
  const evidence = {
    sources: [
      { url: band.url, traits: { height: "Ultimate height 4–8 metres" } },
      { url: precise.url, traits: { height: "Height: 10.00 to 15.00 feet" } },
    ],
  };
  // RHS 400–800 ∩ MBG 305–457 = 400–457
  const ok = decidePlant({ proposal: { ...PROPOSAL, height_max_cm: 450, height_min_cm: 400 }, observations: grounded(evidence, [band, precise]), existing: DRAFT_EMPTY_ROW });
  assert.equal(ok.columns.height_max_cm.status, "verified");
  assert.equal(ok.columns.height_max_cm.value, 457);
  assert.equal(ok.columns.height_min_cm.value, 400);
  // the AI must fall INSIDE the intersection
  const out = decidePlant({ proposal: { ...PROPOSAL, height_max_cm: 700 }, observations: grounded(evidence, [band, precise]), existing: DRAFT_EMPTY_ROW });
  assert.equal(out.columns.height_max_cm.status, "to_verify");
  assert.match(out.columns.height_max_cm.reasons[0], /ai_disagrees \(700 cm outside common range 400–457 cm\)/);
  // 5 cm unit-rounding slack only
  const edge = decidePlant({ proposal: { ...PROPOSAL, height_max_cm: 460 }, observations: grounded(evidence, [band, precise]), existing: DRAFT_EMPTY_ROW });
  assert.equal(edge.columns.height_max_cm.status, "verified");
});

test("interval overlap: open-ended band + closed range; open-ended only gives no maximum", () => {
  const open = { ...PAGES.rhs, text: "Ultimate height Higher than 12 metres" };
  const closed = { ...PAGES.mbg, text: "Height: 50.00 to 80.00 feet" };
  const both = { sources: [{ url: open.url, traits: { height: "Ultimate height Higher than 12 metres" } }, { url: closed.url, traits: { height: "Height: 50.00 to 80.00 feet" } }] };
  const d = decidePlant({ proposal: { ...PROPOSAL, plant_type: "tree", height_max_cm: 2000, height_min_cm: 1500 }, observations: grounded(both, [open, closed]), existing: DRAFT_EMPTY_ROW });
  assert.equal(d.columns.height_max_cm.value, 2438); // 1200–∞ ∩ 1524–2438
  const open2 = { ...PAGES.mbg, text: "Height: higher than 15 metres" };
  const onlyOpen = { sources: [{ url: open.url, traits: { height: "Ultimate height Higher than 12 metres" } }, { url: open2.url, traits: { height: "Height: higher than 15 metres" } }] };
  const d2 = decidePlant({ proposal: { ...PROPOSAL, plant_type: "tree", height_max_cm: 2000, height_min_cm: 1500 }, observations: grounded(onlyOpen, [open, open2]), existing: DRAFT_EMPTY_ROW });
  assert.equal(d2.columns.height_max_cm.status, "to_verify");
  assert.match(d2.columns.height_max_cm.reasons[0], /no site states an upper bound/);
});

test("sources that disagree -> to_verify (no averaging of disagreeing values)", () => {
  const big = { ...PAGES.mbg, text: PAGES.mbg.text.replace("Height: 6.00 to 12.00 feet", "Height: 20.00 to 30.00 feet") };
  const evidence = { sources: [EVIDENCE_JSON.sources[0], { ...EVIDENCE_JSON.sources[1], traits: { ...EVIDENCE_JSON.sources[1].traits, height: "Height: 20.00 to 30.00 feet" } }] };
  const d = decidePlant({ proposal: PROPOSAL, observations: grounded(evidence, [PAGES.rhs, big]), existing: DRAFT_EMPTY_ROW });
  assert.equal(d.columns.height_max_cm.status, "to_verify");
  assert.match(d.columns.height_max_cm.reasons[0], /sources_disagree \(no common range/);
  assert.equal(d.critical.height, false);
  assert.equal(d.publishable, false);
});

test("AI proposal disagreeing with agreeing sources -> to_verify", () => {
  const d = decidePlant({ proposal: { ...PROPOSAL, plant_type: "tree", height_max_cm: 900 }, observations: grounded(), existing: DRAFT_EMPTY_ROW });
  assert.equal(d.columns.plant_type.status, "to_verify");
  assert.equal(d.columns.height_max_cm.status, "to_verify");
  assert.match(d.columns.height_max_cm.reasons[0], /ai_disagrees/);
});

test("optional traits left empty when unverified do not block publication", () => {
  const d = decidePlant({ proposal: { ...PROPOSAL, water_need: null, evergreen: null, flowering_months: [] }, observations: grounded(), existing: DRAFT_EMPTY_ROW });
  assert.equal(d.columns.water_need.status, "to_verify");
  assert.equal(d.columns.water_need.emit, false);
  assert.equal(d.columns.evergreen.emit, false);
  assert.equal(d.columns.flowering_months.emit, false);
  assert.equal(d.publishable, true);
});

test("existing values go through the same rule: confirmed / corrected / unverified", () => {
  const confirmed = decidePlant({ proposal: PROPOSAL, observations: grounded(), existing: { ...DRAFT_EMPTY_ROW, plant_type: "shrub", height_max_cm: 360 } });
  assert.equal(confirmed.columns.plant_type.status, "existing_confirmed");
  assert.equal(confirmed.columns.plant_type.emit, false);
  assert.equal(confirmed.columns.height_max_cm.status, "existing_confirmed", "360 vs 366 is within tolerance");

  const corrected = decidePlant({ proposal: PROPOSAL, observations: grounded(), existing: { ...DRAFT_EMPTY_ROW, water_need: "high" } });
  assert.equal(corrected.columns.water_need.status, "existing_corrected");
  assert.equal(corrected.columns.water_need.emit, true);

  const only = { sources: [EVIDENCE_JSON.sources[0]] };
  const unverified = decidePlant({ proposal: PROPOSAL, observations: grounded(only, [PAGES.rhs]), existing: { ...DRAFT_EMPTY_ROW, plant_type: "shrub", sun: ["full_sun"], height_max_cm: 300, spread_max_cm: 200 } });
  assert.equal(unverified.columns.plant_type.status, "existing_unverified");
  assert.equal(unverified.publishable, false, "an existing critical value that cannot be verified blocks publication");
});

test("an existing preferred French name is never replaced automatically", () => {
  const d = decidePlant({ proposal: PROPOSAL, observations: grounded(), existing: { ...DRAFT_EMPTY_ROW, preferred_common_name_fr: "Autre nom" } });
  assert.equal(d.common_name_fr.status, "existing_unverified");
  assert.equal(d.common_name_fr.emit, false);
});

const FERN_PAGES = [
  { ...PAGES.rhs, text: "Testus exemplaris. Fern. Ultimate height 0.5–1 metres." },
  { ...PAGES.mbg, text: "Testus exemplaris. Type: Fern. Height: 2.00 to 3.00 feet." },
];
const FERN_EVIDENCE = {
  sources: [
    { url: PAGES.rhs.url, traits: { plant_type: "Fern", height: "Ultimate height 0.5–1 metres" } },
    { url: PAGES.mbg.url, traits: { plant_type: "Type: Fern", height: "Height: 2.00 to 3.00 feet" } },
  ],
};

test("ferns and grasses: flowering_months not applicable", () => {
  const d = decidePlant({ proposal: { ...PROPOSAL, plant_type: "fern", height_max_cm: 90, flowering_months: [] }, observations: grounded(FERN_EVIDENCE, FERN_PAGES), existing: DRAFT_EMPTY_ROW });
  assert.equal(d.columns.plant_type.value, "fern");
  assert.equal(d.columns.height_max_cm.value, 91); // 50–100 ∩ 61–91
  assert.equal(d.columns.flowering_months.status, "not_applicable");
  assert.equal(d.columns.flowering_months.emit, false);
});

test("an implausible verified combination is downgraded to to_verify (fern of 3.6 m)", () => {
  const tallPages = [
    { ...PAGES.rhs, text: "Testus exemplaris. Fern. Ultimate height 3–4 metres." },
    { ...PAGES.mbg, text: "Testus exemplaris. Type: Fern. Height: 10.00 to 12.00 feet." },
  ];
  const evidence = {
    sources: [
      { url: PAGES.rhs.url, traits: { plant_type: "Fern", height: "Ultimate height 3–4 metres" } },
      { url: PAGES.mbg.url, traits: { plant_type: "Type: Fern", height: "Height: 10.00 to 12.00 feet" } },
    ],
  };
  const d = decidePlant({ proposal: { ...PROPOSAL, plant_type: "fern", height_max_cm: 360 }, observations: grounded(evidence, tallPages), existing: DRAFT_EMPTY_ROW });
  assert.equal(d.columns.height_max_cm.status, "to_verify");
  assert.match(d.columns.height_max_cm.reasons[0], /implausible/);
  assert.equal(d.columns.plant_type.status, "to_verify");
  assert.equal(d.publishable, false);
});

test("plausibility rules", () => {
  assert.deepEqual(plausibilityErrors({ plant_type: "shrub", sun: ["full_sun"], height_max_cm: 200, spread_max_cm: 150, flowering_months: [4, 5] }), []);
  assert.ok(plausibilityErrors({ plant_type: "tree", height_max_cm: 120 }).some((e) => /implausible for tree/.test(e)));
  assert.ok(plausibilityErrors({ plant_type: "perennial", height_max_cm: 80, spread_max_cm: 400 }).some((e) => /3 × height/.test(e)));
  assert.ok(plausibilityErrors({ height_min_cm: 300, height_max_cm: 100 }).some((e) => /height_min_cm > height_max_cm/.test(e)));
  assert.ok(plausibilityErrors({ flowering_months: [0, 13] }).length > 0);
  assert.ok(plausibilityErrors({ sun: ["moon"] }).length > 0);
});

test("withinTolerance: 25 % relative or 30 cm absolute", () => {
  assert.equal(withinTolerance(400, 366), true);
  assert.equal(withinTolerance(400, 250), false);
  assert.equal(withinTolerance(40, 65), true);
});
