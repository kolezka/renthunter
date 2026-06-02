import { test, expect } from "bun:test";
import { loadConfig } from "../src/config";

test("loadConfig reads required env vars", () => {
  const cfg = loadConfig({
    DATABASE_URL: "postgres://x",
    DEEPSEEK_API_KEY: "k",
    DEEPSEEK_BASE_URL: "https://api.deepseek.com",
    APPRISE_URL: "http://apprise:8000",
    PORT: "3000",
  });
  expect(cfg.databaseUrl).toBe("postgres://x");
  expect(cfg.port).toBe(3000);
  expect(cfg.deepseekBaseUrl).toBe("https://api.deepseek.com");
});

test("loadConfig throws on missing DATABASE_URL", () => {
  expect(() => loadConfig({})).toThrow("DATABASE_URL");
});
