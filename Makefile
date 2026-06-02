# trojmiasto-wynajem — common tasks. Run `make` or `make help` to list targets.
# Thin wrappers over the package.json scripts (Bun) and docker compose.
.DEFAULT_GOAL := help
.PHONY: help install build typecheck test check dev start \
        db-push db-generate db-migrate db-studio \
        up down prod prod-down prod-logs trigger-dev

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

up: ## Start the dev stack (docker compose, hot reload)
	bun run compose:dev

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
