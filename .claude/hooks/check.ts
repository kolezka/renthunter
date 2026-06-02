#!/usr/bin/env bun
/**
 * Stop-hook gate: typecheck + tests must be green before Claude stops.
 *
 * Quirk: this project's tests run on an in-memory PGlite (test/setup.ts) whose
 * WASM handle keeps the event loop alive, so a CLEAN PASS makes `bun test`
 * force-exit with code 99 (a real test failure still exits 1). We therefore
 * treat 0 and 99 as success and anything else as failure.
 *
 * Exit 2 => block the stop and show stderr to Claude (so it keeps fixing).
 * Excluded from tsconfig, so it isn't part of the gate it runs.
 */
const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

function run(cmd: string[]): number {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  return p.exitCode ?? 1;
}

const tc = run(["make", "typecheck"]);
if (tc !== 0) {
  console.error("⛔ typecheck failed — fix the TypeScript errors above before finishing.");
  process.exit(2);
}

const t = run(["bun", "test"]);
// 99 == clean pass with PGlite's handle still open; 1 == real failures.
if (t === 0 || t === 99) process.exit(0);

console.error(`⛔ tests failed (bun test exit ${t}) — fix them before finishing.`);
process.exit(2);
