import type { LogEntry } from "./api";

export const BUFFER_CAP = 2000;

/** Append-merge stream/backlog batches into the buffer: dedup by id, keep the
 *  whole buffer ascending by id (oldest-at-top), drop the oldest past `cap`.
 *  Order-independent so the SSE stream and the backlog fetch can land in any
 *  order. Returns the same array instance when nothing new arrived. */
export function mergeEntries(buffer: LogEntry[], incoming: LogEntry[], cap = BUFFER_CAP): LogEntry[] {
  if (incoming.length === 0) return buffer;
  const seen = new Set(buffer.map((e) => e.id));
  const fresh = incoming.filter((e) => !seen.has(e.id));
  if (fresh.length === 0) return buffer;
  const merged = [...buffer, ...fresh].sort((a, b) => a.id - b.id);
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}

export interface LogFilterState {
  level: string; // "all" | "info" | "warn" | "error"
  event: string; // "all" | exact event name
  runId: string; // "all" | exact runId
  search: string;
}

export function filterEntries(entries: LogEntry[], f: LogFilterState): LogEntry[] {
  const q = f.search.trim().toLowerCase();
  return entries.filter(
    (e) =>
      (f.level === "all" || e.level === f.level) &&
      (f.event === "all" || e.event === f.event) &&
      (f.runId === "all" || e.runId === f.runId) &&
      (q === "" ||
        e.message.toLowerCase().includes(q) ||
        e.event.toLowerCase().includes(q) ||
        (e.context != null && JSON.stringify(e.context).toLowerCase().includes(q))),
  );
}

/** Keys most likely to describe what went wrong, in display order. */
const PREFERRED_KEYS = ["error", "message", "status", "url", "durationMs", "duration"];

/** One-line `k=v · k=v` digest of a context payload for inline error display. */
export function summarizeContext(context: unknown, max = 140): string {
  if (context == null) return "";
  if (typeof context !== "object") {
    const s = String(context);
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }
  const obj = context as Record<string, unknown>;
  const keys = [
    ...PREFERRED_KEYS.filter((k) => k in obj),
    ...Object.keys(obj).filter((k) => !PREFERRED_KEYS.includes(k)),
  ];
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (s === undefined) continue;
    parts.push(`${k}=${s}`);
    if (parts.join(" · ").length >= max) break;
  }
  const line = parts.join(" · ");
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

export function distinctEvents(entries: LogEntry[]): string[] {
  return [...new Set(entries.map((e) => e.event))].sort();
}

export interface RunOption {
  id: string;
  label: string;
}

/** Unique runIds, newest first (buffer is oldest-at-top), labeled with a short
 *  id and the run's first-seen time. */
export function distinctRuns(entries: LogEntry[]): RunOption[] {
  const firstSeen = new Map<string, string>();
  for (const e of entries) {
    if (e.runId && !firstSeen.has(e.runId)) firstSeen.set(e.runId, e.ts);
  }
  return [...firstSeen.entries()]
    .map(([id, ts]) => ({
      id,
      label: `${id.slice(0, 8)} · ${new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
    }))
    .reverse();
}
