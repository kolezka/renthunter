import { resolve } from "node:path";
import { listOffers, getConfig, updateConfig, listLogs } from "../db/queries";
import { validateConfigPatch, safeStaticPath } from "./validate";
import type { Offer } from "../db/schema";
import { loadConfig } from "../config";
import { runCheck } from "../pipeline/check";
import { refreshOffer } from "../pipeline/refresh";
import { buildCheckDeps, buildRefreshDeps } from "../pipeline/deps";
import { dbLogger, createRunLogger } from "../log/logger";

export interface ServerOptions {
  runCrawler?: () => Promise<string>;
  refreshOfferById?: (externalId: string) => Promise<Offer | null>;
}

// Default in-process crawl: build logged deps and run the pipeline, returning a runId.
function defaultRunCrawler(): Promise<string> {
  const env = loadConfig();
  const runId = crypto.randomUUID();
  const logger = createRunLogger(dbLogger, runId);
  // Fire-and-forget: the caller gets the runId immediately; progress lands in logs.
  void runCheck(buildCheckDeps(env, logger)).catch((err) =>
    console.error("manual runCheck failed:", err),
  );
  return Promise.resolve(runId);
}

function defaultRefresh(externalId: string): Promise<Offer | null> {
  const env = loadConfig();
  const logger = createRunLogger(dbLogger, crypto.randomUUID());
  return refreshOffer(externalId, buildRefreshDeps(env, logger)).catch((err) => {
    if (String(err).includes("offer not found")) return null;
    throw err;
  });
}

const DIST = resolve(import.meta.dir, "../../web/dist");

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export function createServer(port: number, opts: ServerOptions = {}) {
  const runCrawler = opts.runCrawler ?? defaultRunCrawler;
  const refreshOfferById = opts.refreshOfferById ?? defaultRefresh;
  let runInFlight = false;

  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === "/api/run" && req.method === "POST") {
        if (runInFlight) return json({ error: "a run is already in progress" }, 409);
        runInFlight = true;
        try {
          const runId = await runCrawler();
          return json({ runId }, 202);
        } finally {
          // For the default fire-and-forget runner the pipeline keeps going in the
          // background; the flag only debounces rapid double-clicks at trigger time.
          runInFlight = false;
        }
      }

      const refreshMatch = path.match(/^\/api\/offers\/([^/]+)\/refresh$/);
      if (refreshMatch && req.method === "POST") {
        const externalId = decodeURIComponent(refreshMatch[1]!);
        if (!/^\d+$/.test(externalId)) return json({ error: "invalid offer id" }, 400);
        const updated = await refreshOfferById(externalId);
        if (!updated) return json({ error: "offer not found" }, 404);
        return json(updated);
      }

      if (path === "/api/offers" && req.method === "GET") {
        return json(await listOffers());
      }
      if (path === "/api/logs" && req.method === "GET") {
        const limitParam = url.searchParams.get("limit");
        const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 300, 1), 1000) : 300;
        return json(await listLogs({ limit }));
      }
      if (path === "/api/config" && req.method === "GET") {
        return json(await getConfig());
      }
      if (path === "/api/config" && req.method === "PUT") {
        let body: Record<string, unknown>;
        try {
          body = (await req.json()) as Record<string, unknown>;
        } catch {
          return json({ error: "invalid JSON body" }, 400);
        }
        const result = validateConfigPatch(body);
        if (!result.ok) return json({ error: result.error }, 400);
        return json(await updateConfig(result.patch));
      }

      // static SPA build (path-traversal safe; SPA fallback to index.html)
      const rel = path === "/" ? "/index.html" : path;
      const candidate = safeStaticPath(DIST, rel);
      if (candidate) {
        const file = Bun.file(candidate);
        if (await file.exists()) return new Response(file);
      }
      const index = Bun.file(`${DIST}/index.html`);
      if (await index.exists()) return new Response(index);

      return new Response("Not found", { status: 404 });
    },
  });
}

if (import.meta.main) {
  const { loadConfig } = await import("../config");
  const { ensureConfig } = await import("../db/queries");
  const env = loadConfig();
  const DEFAULT_SEARCH =
    "https://ogloszenia.trojmiasto.pl/nieruchomosci-mam-do-wynajecia/ai,_4000,e1i,81_33_58_46_91_34_32_1_143_87_76_86_142_2_7_31_29_60_26_93,qi,40_.html";
  await ensureConfig(DEFAULT_SEARCH);
  const server = createServer(env.port);
  console.log(`API listening on http://localhost:${server.port}`);
}
