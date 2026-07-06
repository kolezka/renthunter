import { test, expect } from "bun:test";
import { createRunRegistry } from "../src/pipeline/runs";
import type { ProgressEvent } from "../src/pipeline/progress";

function makeBus() {
  const listeners = new Set<(e: ProgressEvent) => void>();
  return {
    emit(e: ProgressEvent) { for (const fn of listeners) fn(e); },
    subscribe(fn: (e: ProgressEvent) => void) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

test("register/current/finish lifecycle with a safe snapshot", () => {
  const bus = makeBus();
  const reg = createRunRegistry(bus);
  expect(reg.current()).toBeNull();
  const controller = new AbortController();
  reg.register({ runId: "r1", kind: "crawl", source: "manual", controller });
  const snap = reg.current()!;
  expect(snap.runId).toBe("r1");
  expect(snap.kind).toBe("crawl");
  expect(snap.cancelling).toBe(false);
  expect(snap.progress).toEqual({ phase: "listing", processed: 0, total: null });
  expect(typeof snap.startedAt).toBe("string");
  expect((snap as any).controller).toBeUndefined(); // never leak the controller
  reg.finish("other"); // wrong id is a no-op
  expect(reg.current()).not.toBeNull();
  reg.finish("r1");
  expect(reg.current()).toBeNull();
});

test("cancel aborts the controller and marks cancelling; idle cancel returns null", () => {
  const bus = makeBus();
  const reg = createRunRegistry(bus);
  expect(reg.cancel()).toBeNull();
  const controller = new AbortController();
  reg.register({ runId: "r2", kind: "rescore", source: "rescore", controller });
  expect(reg.cancel()).toEqual({ runId: "r2" });
  expect(controller.signal.aborted).toBe(true);
  expect(reg.current()!.cancelling).toBe(true);
});

test("folds crawl progress events into the snapshot", () => {
  const bus = makeBus();
  const reg = createRunRegistry(bus);
  reg.register({ runId: "r3", kind: "crawl", source: "scheduled", controller: new AbortController() });
  bus.emit({ type: "crawl:listed", runId: "r3", listed: 40, toProcess: 12 });
  expect(reg.current()!.progress).toEqual({ phase: "processing", processed: 0, total: 12 });
  bus.emit({ type: "crawl:offer", runId: "r3", processed: 5, total: 12 });
  expect(reg.current()!.progress.processed).toBe(5);
  bus.emit({ type: "crawl:offer", runId: "other", processed: 99, total: 99 }); // foreign runId ignored
  expect(reg.current()!.progress.processed).toBe(5);
});

test("folds rescore progress events (scored events carry no runId; guarded by kind)", () => {
  const bus = makeBus();
  const reg = createRunRegistry(bus);
  reg.register({ runId: "r4", kind: "rescore", source: "rescore", controller: new AbortController() });
  expect(reg.current()!.progress.phase).toBe("scoring");
  bus.emit({ type: "rescore:start", runId: "r4", total: 3 });
  bus.emit({ type: "rescore:scored", externalId: "a", score: 1, reasons: null });
  bus.emit({ type: "rescore:scored", externalId: "b", score: 2, reasons: null });
  expect(reg.current()!.progress).toEqual({ phase: "scoring", processed: 2, total: 3 });
});
