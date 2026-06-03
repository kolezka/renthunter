---
name: deploy
description: Release renthunter to production safely — back up the DB, apply pending Drizzle migrations, redeploy the app (Coolify), then verify. Use when the user asks to deploy, ship, or release the current main.
disable-model-invocation: true
---

# Deploy to production

A side-effecting release sequence. Run it deliberately and confirm each gate
before moving on. The app runs as a docker-compose stack (`docker-compose.prod.yml`)
managed by Coolify; the production entrypoint already runs `drizzle-kit migrate`
on boot (`start:prod`), but we migrate explicitly and back up first so a bad
migration never lands on an unbacked-up DB.

## Preconditions

- On `main`, working tree clean, and `main` is pushed to `origin`
  (`git@github.com:kolezka/renthunter.git`).
- `make check` is green (tsc + tests).
- `.env.production` exists on the deploy host (it is NOT in the repo).

## Steps

1. **Confirm the release.** Show the user `git log --oneline origin/main..HEAD`
   (or what's about to ship) and get an explicit go-ahead. Deploying is
   outward-facing — do not proceed on assumption.

2. **Back up the production database.** This is the only backup that exists:
   ```sh
   make db-backup    # writes backups/renthunter-<timestamp>.sql.gz (in the DB container)
   ```
   Verify the dump file was created and is non-empty.

3. **Review pending migrations.** List unapplied migrations in `drizzle/` vs what
   prod has. If any are hand-authored, sanity-check them (see /create-migration
   and the migration-reviewer subagent) before they hit prod.

4. **Deploy.** Prefer Coolify (its MCP is connected). Use the Coolify tools to:
   - identify the renthunter application/service,
   - trigger a redeploy of the latest `main`,
   - watch the deployment + application logs until healthy.

   The compose fallback (run on the host) is:
   ```sh
   make prod         # build + start the prod stack (needs .env.production)
   make prod-logs    # tail logs
   ```

5. **Verify.** After the app reports healthy:
   - migrations applied cleanly (check logs for drizzle-kit migrate output),
   - the API responds and the dashboard loads,
   - optionally drive a smoke check with the Playwright MCP (open the dashboard,
     confirm offers render).

6. **Report.** Summarize what shipped (commit range), migration result, and the
   verification outcome. If anything failed, surface it plainly and point at the
   backup from step 2 for rollback.

## Guardrails

- Never `up-fresh` or `docker compose down -v` against prod — both destroy data
  (the PreToolUse guard blocks them).
- If a migration fails mid-deploy, STOP and report; do not improvise schema
  fixes against prod.
