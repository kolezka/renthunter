/** Summary returned by a re-score run and carried in the `rescore:done` event. */
export interface RescoreSummary {
  scored: number;
  errors: number;
}

/** Progress events emitted during a re-score run. */
export type RescoreEvent =
  | { type: "rescore:start"; runId: string; total: number }
  | { type: "rescore:scored"; externalId: string; score: number | null; reasons: string | null }
  | { type: "rescore:done"; runId: string; summary: RescoreSummary };

/** Progress events emitted during a crawl run. */
export type CrawlEvent =
  | { type: "crawl:start"; runId: string }
  | { type: "crawl:listed"; runId: string; listed: number; toProcess: number }
  | { type: "crawl:offer"; runId: string; processed: number; total: number }
  | { type: "crawl:done"; runId: string; summary: { listedCount: number; newCount: number; notifiedCount: number; errorCount: number } };

export type ProgressEvent = RescoreEvent | CrawlEvent;

type Listener = (e: ProgressEvent) => void;

/** Minimal in-process pub/sub. Decouples the pipeline from the transport
 *  (Bun.serve WebSockets) so `rescore.ts` stays transport-agnostic and testable. */
function createBus() {
  const listeners = new Set<Listener>();
  return {
    emit(e: ProgressEvent): void {
      for (const fn of listeners) fn(e);
    },
    subscribe(fn: Listener): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const progressBus = createBus();
