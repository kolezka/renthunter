import type { Config, NewOffer } from "../db/schema";
import { resolveBaseUrl } from "../config";
import { passesFilters } from "./filter";
import type { ListItem, OfferDetail, Source } from "../scraper/sources/types";
import { runPool } from "./pool";
import type { Logger } from "../log/logger";
import { enrichOffer, type EnrichDeps } from "./enrich";
import { buildOfferRow } from "./offer-row";
import { buildOfferNotification } from "../notify/message";
import type { CrawlEvent } from "./progress";

export interface CheckDeps extends EnrichDeps {
  getConfig: () => Promise<Config>;
  getKnownExternalIds: () => Promise<Set<string>>;
  upsertOffer: (o: NewOffer) => Promise<void>;
  markNotified: (externalId: string) => Promise<void>;
  markInactive: (activeExternalIds: string[], opts?: { excludeSources?: string[] }) => Promise<void>;
  fetchPage: (url: string) => Promise<string>;
  resolveSource: (url: string) => Source | null;
  scoreOffer: (
    input: { description: string; criteria: string },
    opts: { apiKey: string; baseUrl: string; model?: string; language?: string },
  ) => Promise<{ score: number; reasons: string }>;
  sendNotification: (input: {
    appriseUrl: string; targets: string[]; title: string; body: string;
  }) => Promise<void>;
  appriseUrl: string;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  /** Present on real runs (set by the guard); used to tag progress events. */
  runId?: string;
  /** Cooperative cancellation: checked at loop boundaries, forwarded to fetches. */
  signal?: AbortSignal;
  /** Progress sink (in-process bus in production; no-op when absent). */
  emitProgress?: (e: CrawlEvent) => void;
}

export interface CheckSummary {
  listedCount: number;
  newCount: number;
  notifiedCount: number;
  errorCount: number;
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Round-robin items by source so a single per-run fetch cap is shared fairly
 *  across sources. Without this, sources are concatenated in config order, so
 *  the last source is starved whenever earlier sources already fill the cap with
 *  unknown listings (e.g. listPages high). Preserves per-source order; source
 *  groups follow first-appearance order. */
function interleaveBySource(items: ListItem[]): ListItem[] {
  const groups = new Map<string, ListItem[]>();
  for (const it of items) {
    const g = groups.get(it.source);
    if (g) g.push(it); else groups.set(it.source, [it]);
  }
  const queues = [...groups.values()];
  const maxLen = Math.max(0, ...queues.map((q) => q.length));
  const out: ListItem[] = [];
  for (let i = 0; i < maxLen; i++) {
    for (const q of queues) if (i < q.length) out.push(q[i]!);
  }
  return out;
}

/** Score a detail page if DeepSeek is enabled, else return nulls. */
export async function maybeScore(
  detail: OfferDetail,
  config: Config,
  deps: Pick<CheckDeps, "scoreOffer" | "deepseekApiKey" | "deepseekBaseUrl" | "deepseekModel">,
): Promise<{ score: number | null; reasons: string | null }> {
  if (!config.deepseekEnabled) return { score: null, reasons: null };
  const r = await deps.scoreOffer(
    { description: detail.description, criteria: config.aiCriteria },
    { apiKey: deps.deepseekApiKey, baseUrl: resolveBaseUrl(config.aiBaseUrl, deps.deepseekBaseUrl), model: config.scorerModel || deps.deepseekModel, language: config.outputLanguage },
  );
  return { score: r.score, reasons: r.reasons };
}

/** Process one fresh offer: fetch detail, filter, score, upsert, notify.
 *  Returns whether it notified / errored. Never throws (errors are logged). */
export async function processOffer(
  item: ListItem,
  config: Config,
  deps: CheckDeps,
): Promise<{ notified: boolean; error: boolean }> {
  try {
    const src = deps.resolveSource(item.url);
    if (!src) throw new Error(`no parser for ${item.url}`);
    await sleep(config.requestDelayMs);
    const detailHtml = await deps.fetchPage(item.url);
    const d = src.parseDetail(detailHtml);
    const enriched = await enrichOffer(d, config, deps);
    const base = buildOfferRow(item, d, enriched);

    if (!passesFilters(d, config)) {
      await deps.upsertOffer(base);
      return { notified: false, error: false };
    }

    const { score, reasons } = await maybeScore(d, config, deps);
    await deps.upsertOffer({ ...base, score, scoreReasons: reasons });

    const meetsThreshold = config.deepseekEnabled ? (score ?? 0) >= config.scoreThreshold : true;
    if (!meetsThreshold) return { notified: false, error: false };

    const { title, body } = buildOfferNotification({
      title: d.title, price: d.price, area: d.area, rooms: d.rooms,
      district: d.district, url: item.url, reasons,
    });
    await deps.sendNotification({
      appriseUrl: deps.appriseUrl,
      targets: config.appriseUrls,
      title,
      body,
    });
    await deps.markNotified(item.externalId);
    return { notified: true, error: false };
  } catch (err) {
    await deps.log.log({
      level: "error",
      event: "offer.error",
      message: `failed processing offer ${item.externalId}`,
      context: { externalId: item.externalId, url: item.url, error: String(err) },
    });
    return { notified: false, error: true };
  }
}

export async function runCheck(deps: CheckDeps): Promise<CheckSummary> {
  try {
    await deps.log.log({ level: "info", event: "run.start", message: "check started" });
    const config = await deps.getConfig();
    const runId = deps.runId ?? "unknown";
    const cancelled = () => deps.signal?.aborted === true;
    deps.emitProgress?.({ type: "crawl:start", runId });

    // Fetch + merge every page of every configured source. parseList dedups
    // per page; the Map dedups across pages AND across sources by externalId.
    // Sources are independent: one source failing must not abort the others,
    // but a failed source's offers must be shielded from markInactive below
    // (its missing list is "no signal", not "everything disappeared").
    const merged = new Map<string, ListItem>();
    const failedSources = new Set<string>();
    for (const searchUrl of config.searchUrls) {
      if (cancelled()) break;
      const src = deps.resolveSource(searchUrl);
      if (!src) {
        await deps.log.log({ level: "warn", event: "source.unknown", message: `no parser for ${searchUrl}`, context: { searchUrl } });
        continue;
      }
      for (const pageUrl of src.listPageUrls(searchUrl, config.listPages)) {
        if (cancelled()) break;
        await sleep(config.requestDelayMs);
        let html: string;
        try {
          html = await deps.fetchPage(pageUrl);
        } catch (err) {
          await deps.log.log({ level: "error", event: "list.error", message: `failed fetching list ${pageUrl}`, context: { url: pageUrl, source: src.id, error: String(err) } });
          failedSources.add(src.id);
          break; // remaining pages of this search URL would just repeat the failure
        }
        let listed: ListItem[];
        try {
          listed = src.parseList(html);
        } catch (err) {
          await deps.log.log({ level: "warn", event: "list.error", message: `failed parsing list ${pageUrl}`, context: { url: pageUrl, error: String(err) } });
          continue;
        }
        for (const it of listed) {
          if (!merged.has(it.externalId)) merged.set(it.externalId, it);
        }
      }
    }
    const items = [...merged.values()];
    const activeIds = items.map((i) => i.externalId);

    const known = await deps.getKnownExternalIds();
    const fresh = interleaveBySource(items.filter((i) => !known.has(i.externalId)))
      .slice(0, config.maxDetailFetchesPerRun);
    deps.emitProgress?.({ type: "crawl:listed", runId, listed: items.length, toProcess: fresh.length });

    let notifiedCount = 0;
    let errorCount = 0;
    let processedCount = 0;
    if (!cancelled()) {
      await runPool(fresh, config.concurrencyLimit, async (item) => {
        if (cancelled()) return; // drain remaining queued items without work
        const r = await processOffer(item, config, deps);
        if (r.notified) notifiedCount++;
        if (r.error) errorCount++;
        processedCount++;
        deps.emitProgress?.({ type: "crawl:offer", runId, processed: processedCount, total: fresh.length });
      });
    }

    const summary = { listedCount: items.length, newCount: cancelled() ? processedCount : fresh.length, notifiedCount, errorCount };
    if (cancelled()) {
      // Partial lists are "no signal": never reconcile (markInactive) a cancelled run.
      await deps.log.log({
        level: "info",
        event: "run.cancelled",
        message: `check cancelled: ${processedCount} processed, ${notifiedCount} notified`,
        context: summary,
      });
      deps.emitProgress?.({ type: "crawl:done", runId, summary });
      return summary;
    }

    await deps.markInactive(activeIds, { excludeSources: [...failedSources] });

    await deps.log.log({
      level: "info",
      event: "run.finish",
      message: `check finished: ${summary.listedCount} listed, ${summary.newCount} new, ${summary.notifiedCount} notified, ${summary.errorCount} errors`,
      context: summary,
    });
    deps.emitProgress?.({ type: "crawl:done", runId, summary });
    return summary;
  } catch (err) {
    await deps.log.log({
      level: "error",
      event: "run.error",
      message: `check aborted: ${String(err)}`,
      context: { error: String(err) },
    });
    throw err;
  }
}
