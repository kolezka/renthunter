import { listOffers, getConfig, updateConfig } from "../db/queries";
import type { Config } from "../db/schema";

const DIST = `${import.meta.dir}/../../web/dist`;

const EDITABLE: (keyof Config)[] = [
  "searchUrl", "minPrice", "maxPrice", "minArea", "minRooms",
  "aiCriteria", "scoreThreshold", "pollIntervalMin", "appriseUrls", "deepseekEnabled",
];

function pickEditable(body: Record<string, unknown>): Partial<Config> {
  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in body) patch[k] = body[k];
  return patch as Partial<Config>;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export function createServer(port: number) {
  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === "/api/offers" && req.method === "GET") {
        return json(await listOffers());
      }
      if (path === "/api/config" && req.method === "GET") {
        return json(await getConfig());
      }
      if (path === "/api/config" && req.method === "PUT") {
        const body = (await req.json()) as Record<string, unknown>;
        return json(await updateConfig(pickEditable(body)));
      }

      // static SPA build
      const rel = path === "/" ? "/index.html" : path;
      const file = Bun.file(`${DIST}${rel}`);
      if (await file.exists()) return new Response(file);
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
