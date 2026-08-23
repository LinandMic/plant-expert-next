import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "../src/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_ENV_PATH = path.join(__dirname, "..", ".env.benchmark.example");

test("config: PERENUAL_ACCESS_TIER is read from process.env and lowercased", () => {
  const original = process.env.PERENUAL_ACCESS_TIER;
  try {
    process.env.PERENUAL_ACCESS_TIER = "Personal";
    assert.equal(getConfig().perenualAccessTier, "personal");
  } finally {
    if (original === undefined) delete process.env.PERENUAL_ACCESS_TIER;
    else process.env.PERENUAL_ACCESS_TIER = original;
  }
});

test("config: unset PERENUAL_ACCESS_TIER -> null, never fabricated to a default tier", () => {
  const original = process.env.PERENUAL_ACCESS_TIER;
  try {
    delete process.env.PERENUAL_ACCESS_TIER;
    assert.equal(getConfig().perenualAccessTier, null);
  } finally {
    if (original !== undefined) process.env.PERENUAL_ACCESS_TIER = original;
  }
});

test("config #7: .env.benchmark.example documents PERENUAL_ACCESS_TIER with no assigned value and no secret", () => {
  const content = readFileSync(EXAMPLE_ENV_PATH, "utf8");
  const line = content.split("\n").find((l) => l.startsWith("PERENUAL_ACCESS_TIER="));
  assert.ok(line, "PERENUAL_ACCESS_TIER must be documented in the example env file");
  assert.equal(line.trim(), "PERENUAL_ACCESS_TIER=", "the example file must never carry an assigned value");
  // Guard against any credential-looking assignment anywhere in the file
  // (long opaque token/key-shaped value on any KEY=VALUE line).
  assert.doesNotMatch(content, /^[A-Z_]+=[A-Za-z0-9_-]{16,}\s*$/m);
});
