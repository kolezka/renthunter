import type { Source, ListItem } from "./types";
import { parseListUrls, parseDetail, listPageUrls } from "../parse";

export const trojmiasto: Source = {
  id: "trojmiasto",
  hosts: ["ogloszenia.trojmiasto.pl"],
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
