import type { Config, NewOffer } from "../db/schema";
import { passesFilters } from "./filter";
import type { ListItem, OfferDetail } from "../scraper/parse";
import { listPageUrls } from "../scraper/parse";
import { runPool } from "./pool";
import type { Logger } from "../log/logger";

export interface CheckDeps {
  getConfig: () => Promise<Config>;
  getKnownExternalIds: () => Promise<Set<string>>;
  upsertOffer: (o: NewOffer) => Promise<void>;
  markNotified: (externalId: string) => Promise<void>;
  markInactive: (activeExternalIds: string[]) => Promise<void>;
  fetchPage: (url: string) => Promise<string>;
  parseListUrls: (html: string) => ListItem[];
  parseDetail: (html: string) => OfferDetail;
  scoreOffer: (
    input: { description: string; criteria: string },
    opts: { apiKey: string; baseUrl: string },
  ) => Promise<{ score: number; reasons: string }>;
  sendNotification: (input: {
    appriseUrl: string; targets: string[]; title: string; body: string;
  }) => Promise<void>;
  appriseUrl: string;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  log: Logger;
}

export interface CheckSummary {
  listedCount: number;
  newCount: number;
  notifiedCount: number;
  errorCount: number;
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Score a detail page if DeepSeek is enabled, else return nulls. */
export async function maybeScore(
  detail: OfferDetail,
  config: Config,
  deps: Pick<CheckDeps, "scoreOffer" | "deepseekApiKey" | "deepseekBaseUrl">,
): Promise<{ score: number | null; reasons: string | null }> {
  if (!config.deepseekEnabled) return { score: null, reasons: null };
  const r = await deps.scoreOffer(
    { description: detail.description, criteria: config.aiCriteria },
    { apiKey: deps.deepseekApiKey, baseUrl: deps.deepseekBaseUrl },
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
    await sleep(config.requestDelayMs);
    const detailHtml = await deps.fetchPage(item.url);
    const d = deps.parseDetail(detailHtml);

    const base: NewOffer = {
      externalId: item.externalId,
      url: item.url,
      title: d.title,
      price: d.price,
      area: d.area,
      rooms: d.rooms,
      district: d.district,
      description: d.description,
      images: d.images,
    };

    if (!passesFilters(d, config)) {
      await deps.upsertOffer(base);
      return { notified: false, error: false };
    }

    const { score, reasons } = await maybeScore(d, config, deps);
    await deps.upsertOffer({ ...base, score, scoreReasons: reasons });

    const meetsThreshold = config.deepseekEnabled ? (score ?? 0) >= config.scoreThreshold : true;
    if (!meetsThreshold) return { notified: false, error: false };

    const title = `Nowa oferta: ${d.title}`.slice(0, 120);
    const body =
      `${d.price ?? "?"} zł · ${d.area ?? "?"} m² · ${d.rooms ?? "?"} pok · ${d.district ?? ""}\n` +
      (reasons ? `AI: ${reasons}\n` : "") +
      item.url;
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

    // Fetch + merge every configured list page; parseListUrls dedups per page,
    // the Map below dedups across pages by externalId.
    const merged = new Map<string, ListItem>();
    for (const pageUrl of listPageUrls(config.searchUrl, config.listPages)) {
      await sleep(config.requestDelayMs);
      const html = await deps.fetchPage(pageUrl);
      for (const it of deps.parseListUrls(html)) {
        if (!merged.has(it.externalId)) merged.set(it.externalId, it);
      }
    }
    const items = [...merged.values()];
    const activeIds = items.map((i) => i.externalId);

    const known = await deps.getKnownExternalIds();
    const fresh = items.filter((i) => !known.has(i.externalId)).slice(0, config.maxDetailFetchesPerRun);

    let notifiedCount = 0;
    let errorCount = 0;
    await runPool(fresh, config.concurrencyLimit, async (item) => {
      const r = await processOffer(item, config, deps);
      if (r.notified) notifiedCount++;
      if (r.error) errorCount++;
    });

    await deps.markInactive(activeIds);

    const summary = { listedCount: items.length, newCount: fresh.length, notifiedCount, errorCount };
    await deps.log.log({
      level: "info",
      event: "run.finish",
      message: `check finished: ${summary.listedCount} listed, ${summary.newCount} new, ${summary.notifiedCount} notified, ${summary.errorCount} errors`,
      context: summary,
    });
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
