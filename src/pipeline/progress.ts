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

type Listener = (e: RescoreEvent) => void;

/** Minimal in-process pub/sub. Decouples the pipeline from the transport
 *  (Bun.serve WebSockets) so `rescore.ts` stays transport-agnostic and testable. */
function createBus() {
  const listeners = new Set<Listener>();
  return {
    emit(e: RescoreEvent): void {
      for (const fn of listeners) fn(e);
    },
    subscribe(fn: Listener): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const progressBus = createBus();
