import { test, expect } from "bun:test";
import { formatElapsed } from "../web/lib/format";

test("formatElapsed renders m:ss and h:mm:ss", () => {
  expect(formatElapsed(9_000)).toBe("0:09");
  expect(formatElapsed(65_000)).toBe("1:05");
  expect(formatElapsed(3_723_000)).toBe("1:02:03");
});
