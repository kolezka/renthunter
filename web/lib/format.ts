const pln = new Intl.NumberFormat("en-GB");
export const fmtPln = (n: number | null) => (n == null ? "–" : pln.format(n));

export type Tier = "good" | "mid" | "bad" | "none";
export function tier(score: number | null): Tier {
  if (score == null) return "none";
  if (score >= 75) return "good";
  if (score >= 50) return "mid";
  return "bad";
}
export const tierClass: Record<Tier, string> = {
  good: "text-good bg-good/10 border-good/30",
  mid: "text-mid bg-mid/10 border-mid/30",
  bad: "text-bad bg-bad/10 border-bad/30",
  none: "text-ink-3 bg-[var(--glass-fill)] border-[var(--glass-border)]",
};

/** Relative date. For today/yesterday it appends the time so you can see
 *  *when* a listing was crawled, e.g. "today 14:32", "yesterday 09:10",
 *  "3 days ago", "2 wk ago". */
export function relativeDate(iso: string): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  const hm = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (days <= 0) return `today ${hm}`;
  if (days === 1) return `yesterday ${hm}`;
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} wk ago`;
  return d.toLocaleDateString("en-GB");
}

/** Absolute date-time for tooltips, e.g. "3 Jun 2026, 14:32". */
export function fmtDateTime(iso: string): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

/** Elapsed runtime as m:ss (or h:mm:ss past an hour). */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0"), ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}
