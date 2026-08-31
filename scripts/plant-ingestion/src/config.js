// Deliberately reuses the benchmark's own config loader rather than
// duplicating it: same env file (scripts/plant-benchmark/.env.benchmark),
// same variable names (PERENUAL_API_KEY, TREFLE_API_KEY,
// PERENUAL_ACCESS_TIER), same "never log a key" contract.
export { getConfig } from "../../plant-benchmark/src/config.js";
