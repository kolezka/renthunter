FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run web/build.ts

EXPOSE 3000
# Apply versioned migrations (idempotent; creates tables on a fresh volume,
# applies only new ones afterwards — never recreates, so data persists) before
# starting the API — without this, a cold start crashes on the first config insert.
CMD ["sh", "-c", "bunx drizzle-kit migrate && exec bun run src/api/server.ts"]
