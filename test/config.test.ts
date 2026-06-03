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

test("loadConfig reads embedding env with defaults", () => {
  const c = loadConfig({ DATABASE_URL: "x", EMBED_MODEL: "m", EMBED_API_KEY: "k", EMBED_BASE_URL: "https://e" });
  expect(c.embedBaseUrl).toBe("https://e");
  expect(c.embedApiKey).toBe("k");
  expect(c.embedModel).toBe("m");
});

test("loadConfig embedBaseUrl defaults to OpenAI", () => {
  const c = loadConfig({ DATABASE_URL: "x" });
  expect(c.embedBaseUrl).toBe("https://api.openai.com/v1");
});
