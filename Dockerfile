FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run web/build.ts

EXPOSE 3000
# Apply schema (idempotent; creates tables on a fresh volume) before starting the
# API — without this, a cold start crashes on the first config insert.
CMD ["sh", "-c", "bunx drizzle-kit push && exec bun run src/api/server.ts"]
