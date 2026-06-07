import type { SourceParser, ListItem } from "./types";
import { parseListUrls, parseDetail, listPageUrls } from "../parse";

export const trojmiasto: SourceParser = {
  id: "trojmiasto",
  listPageUrls,
  parseList(html: string): ListItem[] {
    return parseListUrls(html).map((it) => ({
      externalId: `trojmiasto:${it.externalId}`,
      url: it.url,
      source: "trojmiasto",
    }));
  },
  parseDetail,
};
