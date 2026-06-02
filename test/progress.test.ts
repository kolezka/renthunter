import { test, expect } from "bun:test";
import { progressBus, type RescoreEvent } from "../src/pipeline/progress";

test("subscribe receives emitted events; unsubscribe stops delivery", () => {
  const seen: RescoreEvent[] = [];
  const unsub = progressBus.subscribe((e) => seen.push(e));

  progressBus.emit({ type: "rescore:start", runId: "r1", total: 3 });
  progressBus.emit({ type: "rescore:scored", externalId: "100", score: 80, reasons: "ok" });
  expect(seen.length).toBe(2);
  expect(seen[0]).toEqual({ type: "rescore:start", runId: "r1", total: 3 });

  unsub();
  progressBus.emit({ type: "rescore:done", runId: "r1", summary: { scored: 1, errors: 0 } });
  expect(seen.length).toBe(2); // no delivery after unsubscribe
});

test("multiple subscribers each receive the event", () => {
  const a: RescoreEvent[] = [];
  const b: RescoreEvent[] = [];
  const ua = progressBus.subscribe((e) => a.push(e));
  const ub = progressBus.subscribe((e) => b.push(e));
  progressBus.emit({ type: "rescore:start", runId: "r2", total: 0 });
  expect(a.length).toBe(1);
  expect(b.length).toBe(1);
  ua(); ub();
});
