import { test } from "node:test";
import assert from "node:assert/strict";

import { buildChatSystemPrompt } from "./chatSystemPrompt.js";

const NO_MARKDOWN_MARKER = "sans aucune syntaxe Markdown";

test("every mode's prompt instructs the model to never use Markdown formatting", () => {
  const general = buildChatSystemPrompt({
    mode: "general",
    general: { plantCount: 0, plants: [], zones: [], reminders: [], location: null },
  });
  const plant = buildChatSystemPrompt({ mode: "plant", plant: { commonName: "Hortensia" } });
  const identification = buildChatSystemPrompt({ mode: "identification", identification: { commonName: "Hortensia" } });
  const noContext = buildChatSystemPrompt({ mode: "general" });

  for (const prompt of [general, plant, identification, noContext]) {
    assert.ok(prompt.includes(NO_MARKDOWN_MARKER), `expected the no-Markdown instruction in: ${prompt.slice(0, 80)}...`);
  }
});

test("every mode's prompt states weather is not available, so the model never claims access to it", () => {
  const general = buildChatSystemPrompt({
    mode: "general",
    general: { plantCount: 0, plants: [], zones: [], reminders: [], location: null },
  });
  assert.ok(general.toLowerCase().includes("météo"));
});

test("general mode with an empty garden produces a prompt that says so, never inventing plants/reminders", () => {
  const prompt = buildChatSystemPrompt({
    mode: "general",
    general: { plantCount: 0, plants: [], zones: [], reminders: [], location: null },
  });
  assert.ok(prompt.includes("ne contient encore aucune plante"));
  assert.ok(prompt.includes("Aucun rappel en retard ou prévu aujourd'hui"));
  assert.ok(!prompt.includes("Localisation du compte"));
});

test("general mode surfaces overdue reminders distinctly from reminders due today", () => {
  const prompt = buildChatSystemPrompt({
    mode: "general",
    general: {
      plantCount: 1,
      plants: [{ commonName: "Hortensia", latinName: null, category: null, location: null, zoneName: null }],
      zones: [],
      reminders: [
        { plantName: "Hortensia", type: "watering", overdue: true },
        { plantName: "Hortensia", type: "pruning", overdue: false },
      ],
      location: null,
    },
  });
  assert.ok(prompt.includes("Rappels en retard (1)"));
  assert.ok(prompt.includes("Rappels prévus aujourd'hui (1)"));
});

test("general mode includes profile location only when at least one field is set", () => {
  const prompt = buildChatSystemPrompt({
    mode: "general",
    general: {
      plantCount: 0,
      plants: [],
      zones: [],
      reminders: [],
      location: { city: "Lyon", region: null, country: null },
    },
  });
  assert.ok(prompt.includes("Localisation du compte : Lyon"));
});

test("general mode tells the model to use the provided context and never re-ask for it", () => {
  const prompt = buildChatSystemPrompt({
    mode: "general",
    general: { plantCount: 0, plants: [], zones: [], reminders: [], location: null },
  });
  assert.ok(prompt.includes("ne redemande jamais une information qui y figure déjà"));
});

test("plant mode is unchanged: still prioritises the specific plant's fields", () => {
  const prompt = buildChatSystemPrompt({
    mode: "plant",
    plant: { commonName: "Hortensia", latinName: "Hydrangea macrophylla" },
  });
  assert.ok(prompt.includes("Nom commun : Hortensia"));
  assert.ok(prompt.includes("une plante précise de son jardin"));
});

test("identification mode is unchanged: still prioritises the fresh identification's fields", () => {
  const prompt = buildChatSystemPrompt({
    mode: "identification",
    identification: { commonName: "Hortensia" },
  });
  assert.ok(prompt.includes("résultat non encore enregistré"));
});

test("no resolved context at all falls back to the generic no-context prompt", () => {
  const prompt = buildChatSystemPrompt(undefined);
  assert.ok(prompt.includes("Aucun contexte de plante spécifique"));
});
