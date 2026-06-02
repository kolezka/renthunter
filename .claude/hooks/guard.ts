#!/usr/bin/env bun
/**
 * PreToolUse guard. Blocks the destructive operations this project has been
 * burned by (see CLAUDE.md + the test-db-isolation memory): editing prod
 * secrets / DB dumps, wiping the DB volume, and schema pushes that can drop
 * columns. Exit 2 = block (stderr is shown to Claude); exit 0 = allow.
 *
 * Excluded from tsconfig, so it is not part of the `make check` typecheck gate.
 */
const input = await Bun.stdin.json();
const tool: string = input?.tool_name ?? "";
const ti = input?.tool_input ?? {};

function block(msg: string): never {
  console.error(`⛔ .claude guard: ${msg}`);
  process.exit(2);
}

if (tool === "Edit" || tool === "Write" || tool === "MultiEdit") {
  const path = String(ti.file_path ?? "");
  // .env, .env.production, .env.local, … — secrets with no backup.
  if (/(^|\/)\.env(\.[^/]+)?$/.test(path)) {
    block(`refusing to modify env file "${path}" — it holds secrets with no backup. Edit it yourself.`);
  }
  if (/(^|\/)backups\//.test(path)) {
    block(`refusing to touch DB dump "${path}".`);
  }
}

if (tool === "Bash") {
  const cmd = String(ti.command ?? "");
  if (/\bup-fresh\b/.test(cmd)) {
    block("`up-fresh` DESTROYS the DB volume (no other backup exists). Run it yourself if you truly mean to. Use `make up` to (re)start safely.");
  }
  if (/drizzle-kit\s+push|\bdb:push\b|\bdb-push\b/.test(cmd)) {
    block("`drizzle-kit push` can drop columns. Hand-author a migration instead (see CLAUDE.md / drizzle/0003_multisource, or run /create-migration).");
  }
  if (/docker\s+compose[\s\S]*\bdown\b[\s\S]*(-v\b|--volumes\b)/.test(cmd)) {
    block("`docker compose down -v` removes volumes (the database). Run it yourself if intended.");
  }
  if (/\bdb-restore\b/.test(cmd)) {
    block("`make db-restore` OVERWRITES the current database. Run it yourself.");
  }
}

process.exit(0);
