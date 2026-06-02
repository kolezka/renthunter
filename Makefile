# trojmiasto-wynajem — common tasks. Run `make` or `make help` to list targets.
# Thin wrappers over the package.json scripts (Bun) and docker compose.
.DEFAULT_GOAL := help
.PHONY: help install build typecheck test check dev start \
        db-push db-generate db-migrate db-studio db-backup db-restore \
        up up-fresh down lan-ip prod prod-down prod-logs

# Best-effort LAN IP of this host (macOS en0/en1, then Linux fallback).
LAN_IP := $(shell ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $$1}')

# Where DB dumps land (gitignored). Override with `make db-backup BACKUP_DIR=...`.
BACKUP_DIR ?= backups
# Which compose stack to dump/restore. Defaults to dev; `make db-backup COMPOSE=docker-compose.prod.yml` for prod.
COMPOSE ?= docker-compose.dev.yml

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies (bun install)
	bun install

build: ## Build the Svelte SPA into web/dist
	bun run build

typecheck: ## Type-check the project (no emit)
	bunx tsc --noEmit

test: ## Run the test suite (bun test)
	bun test

check: typecheck test ## Type-check + run tests (CI gate)

dev: ## Run the API with hot reload (builds the SPA first)
	bun run dev

start: ## Run the API (production entry, no hot reload)
	bun run start

db-push: ## Apply the schema to the database
	bun run db:push

db-generate: ## Generate a Drizzle migration from the schema
	bun run db:generate

db-migrate: ## Apply pending Drizzle migrations
	bun run db:migrate

db-studio: ## Open Drizzle Studio
	bun run db:studio

db-backup: ## Dump the DB (in its container) to backups/wynajem-<timestamp>.sql.gz
	@mkdir -p "$(BACKUP_DIR)"
	@ts=$$(date +%Y%m%d-%H%M%S); out="$(BACKUP_DIR)/wynajem-$$ts.sql.gz"; tmp="$$out.tmp"; \
	  if docker compose -f $(COMPOSE) exec -T db pg_dump --clean --if-exists -U wynajem -d wynajem > "$$tmp" 2>/dev/null && test -s "$$tmp"; then \
	    gzip -c "$$tmp" > "$$out"; rm -f "$$tmp"; \
	    echo "backup -> $$out ($$(du -h "$$out" | cut -f1))"; \
	  else \
	    rm -f "$$tmp" "$$out"; \
	    echo "backup FAILED (is the '$(COMPOSE)' db service running? try 'make up')"; exit 1; \
	  fi

db-restore: ## Restore the DB from a dump: make db-restore FILE=backups/wynajem-....sql.gz (OVERWRITES current data)
	@test -n "$(FILE)" || { echo "usage: make db-restore FILE=backups/wynajem-<timestamp>.sql.gz"; exit 1; }
	@test -f "$(FILE)" || { echo "no such file: $(FILE)"; exit 1; }
	@echo "Restoring $(FILE) into the $(COMPOSE) db (existing objects are dropped & recreated)…"
	@gunzip -c "$(FILE)" | docker compose -f $(COMPOSE) exec -T db psql -v ON_ERROR_STOP=1 -U wynajem -d wynajem \
	  && echo "restore done" || { echo "restore FAILED"; exit 1; }

up: ## Start the dev stack, reachable on the LAN (docker compose, hot reload)
	@echo "Dev app → http://localhost:3000  and  http://$(LAN_IP):3000 (other devices on your network)"
	bun run compose:dev

up-fresh: ## Reset the DB volume, then start the dev stack (run once after the push→migrate switch)
	docker compose -f docker-compose.dev.yml down -v
	@$(MAKE) up

lan-ip: ## Print this host's LAN IP (where other devices reach the app)
	@echo "$(LAN_IP)"

down: ## Stop the dev stack
	bun run compose:dev:down

prod: ## Build + start the prod stack (needs .env.production)
	bun run compose:prod

prod-down: ## Stop the prod stack
	bun run compose:prod:down

prod-logs: ## Tail prod stack logs
	bun run compose:prod:logs
