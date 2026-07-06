import { progressBus, type ProgressEvent } from "./progress";

export interface RunProgress {
  phase: "listing" | "processing" | "scoring";
  processed: number;
  total: number | null;
}

export interface RunSnapshot {
  runId: string;
  kind: "crawl" | "rescore";
  source: string;
  startedAt: string; // ISO
  cancelling: boolean;
  progress: RunProgress;
}

export interface RunRegistry {
  register(input: { runId: string; kind: "crawl" | "rescore"; source: string; controller: AbortController }): void;
  finish(runId: string): void;
  current(): RunSnapshot | null;
  cancel(): { runId: string } | null;
}

/** Tracks the single in-process run (the run_lock enforces single-flight).
 *  Snapshots are plain data — the AbortController never leaves this module. */
export function createRunRegistry(bus: { subscribe(fn: (e: ProgressEvent) => void): () => void }): RunRegistry {
  let active: {
    runId: string; kind: "crawl" | "rescore"; source: string;
    startedAt: Date; controller: AbortController; cancelling: boolean; progress: RunProgress;
  } | null = null;

  bus.subscribe((e) => {
    if (!active) return;
    switch (e.type) {
      case "crawl:listed":
        if (e.runId === active.runId) active.progress = { phase: "processing", processed: 0, total: e.toProcess };
        break;
      case "crawl:offer":
        if (e.runId === active.runId) { active.progress.processed = e.processed; active.progress.total = e.total; }
        break;
      case "rescore:start":
        if (e.runId === active.runId) active.progress.total = e.total;
        break;
      case "rescore:scored":
        // rescore:scored carries no runId; single-flight + kind guard suffices.
        if (active.kind === "rescore") active.progress.processed++;
        break;
    }
  });

  return {
    register(input) {
      active = {
        ...input,
        startedAt: new Date(),
        cancelling: false,
        progress: { phase: input.kind === "rescore" ? "scoring" : "listing", processed: 0, total: null },
      };
    },
    finish(runId) {
      if (active?.runId === runId) active = null;
    },
    current() {
      if (!active) return null;
      return {
        runId: active.runId, kind: active.kind, source: active.source,
        startedAt: active.startedAt.toISOString(), cancelling: active.cancelling,
        progress: { ...active.progress },
      };
    },
    cancel() {
      if (!active) return null;
      active.cancelling = true;
      active.controller.abort();
      return { runId: active.runId };
    },
  };
}

/** Composition-root instance fed by the real progress bus. */
export const runRegistry: RunRegistry = createRunRegistry(progressBus);
