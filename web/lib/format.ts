const pln = new Intl.NumberFormat("pl-PL");
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

/** Polish relative date, e.g. "dziś", "wczoraj", "3 dni temu", "2 tyg. temu". */
export function relativeDate(iso: string): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "dziś";
  if (days === 1) return "wczoraj";
  if (days < 7) return `${days} dni temu`;
  if (days < 30) return `${Math.floor(days / 7)} tyg. temu`;
  return d.toLocaleDateString("pl-PL");
}
