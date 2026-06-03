import { createHash } from "node:crypto";

export interface EmbedTextFields {
  title: string;
  districtCanonical: string | null;
  kind: string | null;
  features: string[];
  description: string | null;
}

const MAX_DESC = 2000;

export function buildEmbedText(o: EmbedTextFields): string {
  const desc = (o.description ?? "").slice(0, MAX_DESC);
  return [o.title, o.districtCanonical ?? "", o.kind ?? "", (o.features ?? []).join(" "), desc]
    .filter(Boolean)
    .join(" · ");
}

export function embedTextHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
