import { resolve } from "node:path";
import { listOffers, getConfig, updateConfig, listLogs, searchOffers, getFacets, getOfferHistory, toListOffer } from "../db/queries";
import { validateConfigPatch, safeStaticPath } from "./validate";
import { embed } from "../embeddings/client";
import { getAiModels as getAiModelsCached, type AiModelsResult } from "./models";
import type { Offer } from "../db/schema";
import { loadConfig, resolveBaseUrl, aiKeyConfigured, aiBaseUrlDefault } from "../config";
import { refreshOffer } from "../pipeline/refresh";
import { buildRefreshDeps, runCrawlGuarded, runRescoreGuarded } from "../pipeline/deps";
import { progressBus } from "../pipeline/progress";
import { appLogger, createRunLogger } from "../log/logger";
import { runRegistry, type RunSnapshot } from "../pipeline/runs";

export interface ServerOptions {
  runCrawler?: () => Promise<{ runId: string; done: Promise<void> } | { busy: true }>;
  refreshOfferById?: (externalId: string) => Promise<Offer | null>;
  runRescore?: () => Promise<{ runId: string; done: Promise<void> } | { busy: true } | { disabled: true }>;
  getAiModels?: (fresh: boolean, baseUrlOverride?: string) => Promise<AiModelsResult>;
  /** SSE tail poll interval for /api/logs/stream; tests inject a fast one. */
  logStreamIntervalMs?: number;
  getCurrentRun?: () => RunSnapshot | null;
  cancelRun?: () => { runId: string } | null;
}

// Default in-process crawl, triggered by POST /api/run (source "manual").
function defaultRunCrawler(): Promise<{ runId: string; done: Promise<void> } | { busy: true }> {
  return runCrawlGuarded(loadConfig(), "manual");
}

function defaultRunRescore() {
  return runRescoreGuarded(loadConfig());
}

function defaultRefresh(externalId: string): Promise<Offer | null> {
  const env = loadConfig();
  const logger = createRunLogger(appLogger, crypto.randomUUID());
  return refreshOffer(externalId, buildRefreshDeps(env, logger)).catch((err) => {
    if (String(err).includes("offer not found")) return null;
    throw err;
  });
}

// Model list for the settings UI. baseUrlOverride lets the operator test an endpoint
// typed into the form before saving it; this sends the server key to that URL, which
// is the same exposure as saving aiBaseUrl via PUT /api/config (scoring calls it with
// the key on the next run) — single trusted operator. baseUrlOverride is only accepted
// via POST (JSON body), which is preflight-protected cross-origin, restoring parity
// with PUT /api/config; a GET+query-param equivalent would be drive-by triggerable.
async function defaultGetAiModels(fresh: boolean, baseUrlOverride?: string): Promise<AiModelsResult> {
  const env = loadConfig();
  const cfg = await getConfig();
  return getAiModelsCached({
    baseUrl: resolveBaseUrl(baseUrlOverride || cfg.aiBaseUrl, env.deepseekBaseUrl),
    apiKey: env.deepseekApiKey,
    fresh,
  });
}

const DIST = resolve(import.meta.dir, "../../web/dist");

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// limit: [1,500] (default 50); the 500 ceiling covers the dashboard's rescore-reconcile
// which re-fetches the whole loaded window in one call. offset coerced to >= 0.
function parsePage(sp: URLSearchParams): { limit: number; offset: number } {
  const limit = Math.min(Math.max(parseInt(sp.get("limit") ?? "50", 10) || 50, 1), 500);
  const offset = Math.max(parseInt(sp.get("offset") ?? "0", 10) || 0, 0);
  return { limit, offset };
}

export function createServer(port: number, opts: ServerOptions = {}) {
  const runCrawler = opts.runCrawler ?? defaultRunCrawler;
  const refreshOfferById = opts.refreshOfferById ?? defaultRefresh;
  const runRescore = opts.runRescore ?? defaultRunRescore;
  const getAiModelsFn = opts.getAiModels ?? defaultGetAiModels;
  const logStreamIntervalMs = opts.logStreamIntervalMs ?? 1000;
  const getCurrentRun = opts.getCurrentRun ?? (() => runRegistry.current());
  const cancelRun = opts.cancelRun ?? (() => runRegistry.cancel());

  return Bun.serve<{ unsub?: () => void }>({
    port,
    async fetch(req, server) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === "/ws") {
        if (server.upgrade(req, { data: {} })) return undefined;
        return new Response("expected a websocket upgrade", { status: 426 });
      }

      if (path === "/api/rescore" && req.method === "POST") {
        const r = await runRescore();
        if ("disabled" in r) return json({ error: "AI scoring is disabled" }, 400);
        if ("busy" in r) return json({ error: "a run is already in progress" }, 409);
        return json({ runId: r.runId }, 202);
      }

      if (path === "/api/run" && req.method === "POST") {
        const r = await runCrawler();
        if ("busy" in r) return json({ error: "a run is already in progress" }, 409);
        return json({ runId: r.runId }, 202);
      }

      if (path === "/api/runs/current" && req.method === "GET") {
        return json({ run: getCurrentRun() });
      }
      if (path === "/api/runs/current/cancel" && req.method === "POST") {
        const r = cancelRun();
        if (!r) return json({ error: "no active run" });
        return json({ cancelled: true, runId: r.runId });
      }

      const refreshMatch = path.match(/^\/api\/offers\/([^/]+)\/refresh$/);
      if (refreshMatch && req.method === "POST") {
        const externalId = decodeURIComponent(refreshMatch[1]!);
        if (!/^\d+$/.test(externalId)) return json({ error: "invalid offer id" }, 400);
        const updated = await refreshOfferById(externalId);
        if (!updated) return json({ error: "offer not found" }, 404);
        // Project to the embedding-free ListOffer shape so the refresh response
        // matches the list/search payloads (no embedding/embedTextHash leak).
        return json(toListOffer(updated));
      }

      if (path === "/api/offers/facets" && req.method === "GET") {
        return json(await getFacets());
      }

      const historyMatch = path.match(/^\/api\/offers\/([^/]+)\/history$/);
      if (historyMatch && req.method === "GET") {
        const externalId = decodeURIComponent(historyMatch[1]!);
        return json(await getOfferHistory(externalId));
      }

      if (path === "/api/offers/search" && req.method === "GET") {
        const sp = url.searchParams;
        const list = (k: string) => sp.get(k)?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
        const q = sp.get("q")?.trim() || "";
        const cfg = await getConfig();
        let queryEmbedding: number[] | null = null;
        if (q && cfg.embedEnabled) {
          const env = loadConfig();
          try {
            queryEmbedding = await embed(q, {
              baseUrl: resolveBaseUrl(cfg.aiBaseUrl, env.embedBaseUrl),
              apiKey: env.embedApiKey,
              model: cfg.embedModel || env.embedModel,
            });
          } catch (err) {
            // Degrade to filter+sort, but log so a misconfigured embed provider isn't silently invisible.
            queryEmbedding = null;
            await appLogger.log({ level: "warn", event: "search.embed.error", message: `query embedding failed: ${String(err)}` });
          }
        }
        const sortParam = sp.get("sort");
        const sort = (["score", "newest", "price", "area"] as const).find((s) => s === sortParam);
        const page = await searchOffers({
          q, queryEmbedding,
          districts: list("districts"), kinds: list("kinds"),
          features: list("features"), sources: list("sources"),
          sort,
        }, parsePage(sp));
        return json(page);
      }

      if (path === "/api/offers" && req.method === "GET") {
        return json(await listOffers(parsePage(url.searchParams)));
      }
      if (path === "/api/logs" && req.method === "GET") {
        const limitParam = url.searchParams.get("limit");
        const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 300, 1), 1000) : 300;
        return json(await listLogs({ limit }));
      }
      if (path === "/api/logs/stream" && req.method === "GET") {
        // SSE tail of the logs table. Each connection runs its own light poller;
        // the DB row is the event, so clients get stable ids for dedup, and the
        // browser's automatic Last-Event-ID header resumes the cursor after a
        // reconnect with no gap.
        const lastEventId = parseInt(req.headers.get("last-event-id") ?? "", 10);
        const enc = new TextEncoder();
        let timer: ReturnType<typeof setInterval> | undefined;
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        const stop = () => {
          clearInterval(timer);
          clearInterval(heartbeat);
        };
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (text: string) => controller.enqueue(enc.encode(text));
            let cursor: number;
            if (Number.isFinite(lastEventId)) {
              cursor = lastEventId;
            } else {
              const newest = await listLogs({ limit: 1 });
              cursor = newest[0]?.id ?? 0;
            }
            send(`event: ready\ndata: ${JSON.stringify({ lastId: cursor })}\n\n`);
            let ticking = false;
            timer = setInterval(async () => {
              if (ticking) return; // don't overlap a slow query with the next tick
              ticking = true;
              try {
                let rows;
                try {
                  rows = await listLogs({ sinceId: cursor, limit: 500 });
                } catch (err) {
                  console.error("logs stream: tail query failed, retrying next tick:", err);
                  return;
                }
                if (rows.length === 0) return;
                cursor = rows[rows.length - 1]!.id;
                try {
                  send(`id: ${cursor}\nevent: logs\ndata: ${JSON.stringify(rows)}\n\n`);
                } catch {
                  stop(); // socket force-closed without cancel() firing
                }
              } finally {
                ticking = false;
              }
            }, logStreamIntervalMs);
            heartbeat = setInterval(() => {
              try {
                send(": ping\n\n");
              } catch {
                stop();
              }
            }, 15_000);
          },
          cancel() {
            stop();
          },
        });
        return new Response(stream, {
          headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        });
      }
      if (path === "/api/ai/models" && req.method === "GET") {
        // baseUrl is deliberately NOT accepted here: a GET with a user-controlled query
        // param is a simple cross-origin request (no CORS preflight), so a malicious page
        // could drive-by trigger this from the operator's browser and exfiltrate the
        // response of a server-chosen key to an attacker-chosen URL. Use POST instead.
        if (url.searchParams.has("baseUrl")) {
          return json({ error: "use POST /api/ai/models to test an unsaved endpoint" }, 400);
        }
        const fresh = url.searchParams.get("fresh") === "1";
        return json(await getAiModelsFn(fresh, undefined));
      }
      if (path === "/api/ai/models" && req.method === "POST") {
        // POST is a CORS-safelisted method, so without this check a cross-origin
        // <form enctype="text/plain"> POST would be a "simple" request (no preflight)
        // whose body JSON.parse still accepts — the classic JSON-CSRF-via-text/plain
        // bypass. Requiring Content-Type: application/json is what actually forces
        // the browser to preflight: a safelisted content-type (text/plain,
        // application/x-www-form-urlencoded, multipart/form-data) is rejected here,
        // so only same-origin (or explicitly CORS-allowed) callers can reach this code.
        const ct = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
        if (ct !== "application/json") return json({ error: "content-type must be application/json" }, 415);
        let body: Record<string, unknown>;
        try {
          body = (await req.json()) as Record<string, unknown>;
        } catch {
          return json({ error: "invalid JSON body" }, 400);
        }
        let baseUrl: string | undefined;
        if (body.baseUrl !== undefined) {
          if (typeof body.baseUrl !== "string") return json({ error: "baseUrl must be a string" }, 400);
          if (body.baseUrl) {
            // Same rules as the aiBaseUrl config field: http(s) URL, ≤300 chars.
            if (body.baseUrl.length > 300) return json({ error: "baseUrl must be at most 300 chars" }, 400);
            let u: URL;
            try { u = new URL(body.baseUrl); } catch { return json({ error: "baseUrl must be a valid URL" }, 400); }
            if (u.protocol !== "https:" && u.protocol !== "http:") return json({ error: "baseUrl must be http(s)" }, 400);
            baseUrl = body.baseUrl;
          }
        }
        return json(await getAiModelsFn(body.fresh === true, baseUrl || undefined));
      }

      if (path === "/api/config" && req.method === "GET") {
        const cfg = await getConfig();
        return json({
          ...cfg,
          aiKeyConfigured: aiKeyConfigured(),
          aiBaseUrlEffective: aiBaseUrlDefault(),
        });
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
    websocket: {
      open(ws) {
        ws.data.unsub = progressBus.subscribe((e) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e));
        });
      },
      message() {},
      close(ws) {
        ws.data.unsub?.();
      },
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

  const { startScheduler, buildSchedulerDeps } = await import("../pipeline/scheduler");
  // Guard against bun --hot re-evaluating this module and stacking timers.
  const g = globalThis as { __crawlScheduler?: () => void };
  g.__crawlScheduler?.();
  g.__crawlScheduler = startScheduler(buildSchedulerDeps(env, createRunLogger(appLogger, "scheduler")));

  console.log(`API listening on http://localhost:${server.port}`);
}
