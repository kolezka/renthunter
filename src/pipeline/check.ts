import type { Config, NewOffer } from "../db/schema";
import { passesFilters } from "./filter";
import type { ListItem, OfferDetail } from "../scraper/parse";

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
}

export interface CheckSummary {
  listedCount: number;
  newCount: number;
  notifiedCount: number;
}

export async function runCheck(deps: CheckDeps): Promise<CheckSummary> {
  const config = await deps.getConfig();

  const listHtml = await deps.fetchPage(config.searchUrl);
  const items = deps.parseListUrls(listHtml);
  const activeIds = items.map((i) => i.externalId);

  const known = await deps.getKnownExternalIds();
  const fresh = items.filter((i) => !known.has(i.externalId));

  let notifiedCount = 0;

  for (const item of fresh) {
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
    };

    if (!passesFilters(d, config)) {
      await deps.upsertOffer(base);
      continue;
    }

    let score: number | null = null;
    let reasons: string | null = null;
    if (config.deepseekEnabled) {
      const r = await deps.scoreOffer(
        { description: d.description, criteria: config.aiCriteria },
        { apiKey: deps.deepseekApiKey, baseUrl: deps.deepseekBaseUrl },
      );
      score = r.score;
      reasons = r.reasons;
    }

    await deps.upsertOffer({ ...base, score, scoreReasons: reasons });

    const meetsThreshold = config.deepseekEnabled ? (score ?? 0) >= config.scoreThreshold : true;
    if (meetsThreshold) {
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
      notifiedCount++;
    }
  }

  await deps.markInactive(activeIds);

  return { listedCount: items.length, newCount: fresh.length, notifiedCount };
}
