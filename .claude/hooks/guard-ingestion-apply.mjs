#!/usr/bin/env node
// PreToolUse guard: Claude Code must never cross the plant-ingestion
// pipeline's real write boundary.
//
// The pipeline (scripts/plant-ingestion/) writes to production Supabase
// with a service-role key that bypasses RLS ONLY when a CLI is invoked with
// the literal --apply flag. Three CLIs accept it:
//   - scripts/plant-ingestion/src/applyCli.js        (npm run plant:ingestion:apply)
//   - scripts/plant-ingestion/src/editorialCli.js
//   - scripts/plant-ingestion/src/commonNamesCli.js
// Every other invocation of these files (no flag, or --verify) is a dry-run
// or a read-only check and must NOT be blocked. Nothing else in the
// ingestion pipeline (index.js collection, planCli.js, verifyCli.js,
// filterPlanCli.js, the read-only audit scripts at the repo root) can write
// to Supabase at all, so this guard does not need to touch them.
//
// Scope: this guards the three documented CLI entry points only. It does
// not attempt to detect arbitrary ad hoc Node/Supabase code that bypasses
// them entirely.
//
// Fails open: any error parsing the hook payload allows the tool call
// through unchanged rather than blocking on a guard bug.

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

let payload = {};
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0);
}

if (payload.tool_name !== "Bash") {
  process.exit(0);
}

const command = (payload.tool_input && payload.tool_input.command) || "";

const invokesGuardedCli =
  /\bnpm\s+run\s+plant:ingestion:apply\b/.test(command) ||
  /\bnode\s+.*\b(applyCli|editorialCli|commonNamesCli)\.js\b/.test(command);

const hasApplyFlag = /(^|\s)--apply(\s|$)/.test(command);

if (invokesGuardedCli && hasApplyFlag) {
  const reason =
    "Blocked by guard-ingestion-apply: this command would trigger a REAL " +
    "write to production Supabase via the plant-ingestion pipeline's --apply " +
    "flag (applyCli.js / editorialCli.js / commonNamesCli.js / " +
    "`npm run plant:ingestion:apply -- --apply`). Claude Code must never run " +
    "this. Dry-runs (no --apply), --verify, plan compilation, and index.js " +
    "collection are unaffected by this guard. Review the plan first (see the " +
    "ingestion-plan-reviewer subagent) and run --apply yourself, directly in " +
    "your own terminal, outside Claude Code.";
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }) + "\n"
  );
}

process.exit(0);
