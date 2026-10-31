import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import fr from "./i18n/locales/fr.js";
import en from "./i18n/locales/en.js";
import { createTranslator } from "./i18n/core.js";
import { CHAT_SESSION_LIMITS, chatCostNoticeVars } from "./chatConfig.js";

const NEW_KEYS = [
  ["assistant", "costNotice"],
  ["assistant", "conversationInProgress"],
  ["identifier", "analyzeCost"],
];

for (const [locale, dictionary] of [["fr", fr], ["en", en]]) {
  for (const [section, key] of NEW_KEYS) {
    test(`${locale}: ${section}.${key} exists and is a non-empty string`, () => {
      const value = dictionary[section] && dictionary[section][key];
      assert.equal(typeof value, "string");
      assert.ok(value.trim().length > 0);
    });
  }
}

test("chatCostNoticeVars: {max} is CHAT_SESSION_LIMITS.MAX_USER_MESSAGES", () => {
  assert.deepEqual(chatCostNoticeVars(), { max: CHAT_SESSION_LIMITS.MAX_USER_MESSAGES });
});

test("costNotice renders the enforced question limit in FR and EN", () => {
  const max = CHAT_SESSION_LIMITS.MAX_USER_MESSAGES;
  assert.equal(
    createTranslator("fr")("assistant.costNotice", chatCostNoticeVars()),
    `Une conversation avec EDEN utilise 1 crédit IA (jusqu'à ${max} questions).`
  );
  assert.equal(
    createTranslator("en")("assistant.costNotice", chatCostNoticeVars()),
    `A conversation with EDEN uses 1 AI credit (up to ${max} questions).`
  );
});

test("ChatModal interpolates costNotice with chatCostNoticeVars(), never a hardcoded limit", () => {
  const source = readFileSync(new URL("../components/ChatModal.js", import.meta.url), "utf8");
  assert.ok(source.includes('t("assistant.costNotice", chatCostNoticeVars())'));
  assert.ok(!/max:\s*\d/.test(source));
});
