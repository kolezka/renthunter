# trojmiasto-wynajem — common tasks. Run `make` or `make help` to list targets.
# Thin wrappers over the package.json scripts (Bun) and docker compose.
.DEFAULT_GOAL := help
.PHONY: help install build typecheck test check dev start \
        db-push db-generate db-migrate db-studio \
        up up-fresh down lan-ip prod prod-down prod-logs trigger-dev

# Best-effort LAN IP of this host (macOS en0/en1, then Linux fallback).
LAN_IP := $(shell ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $$1}')

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

trigger-dev: ## Run the trigger.dev worker locally
	bun run trigger:dev
