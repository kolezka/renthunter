import { test, expect } from "bun:test";
import { loadConfig, resolveBaseUrl, aiKeyConfigured, aiBaseUrlDefault } from "../src/config";

test("loadConfig reads required env vars", () => {
  const cfg = loadConfig({
    DATABASE_URL: "postgres://x",
    LITELLM_API_KEY: "k",
    LITELLM_BASE_URL: "https://proxy",
    APPRISE_URL: "http://apprise:8000",
    PORT: "3000",
  });
  expect(cfg.databaseUrl).toBe("postgres://x");
  expect(cfg.port).toBe(3000);
  expect(cfg.deepseekBaseUrl).toBe("https://proxy");
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

test("loadConfig reads SCORER_MODEL with a deepseek/deepseek-chat default", () => {
  expect(loadConfig({ DATABASE_URL: "x" }).scorerModel).toBe("deepseek/deepseek-chat");
  expect(loadConfig({ DATABASE_URL: "x", SCORER_MODEL: "qwen3:30b-a3b" }).scorerModel).toBe("qwen3:30b-a3b");
});

test("LITELLM_API_KEY feeds both scoring and embedding keys", () => {
  const c = loadConfig({ DATABASE_URL: "x", LITELLM_API_KEY: "lit" });
  expect(c.deepseekApiKey).toBe("lit");
  expect(c.embedApiKey).toBe("lit");
});

test("LITELLM_BASE_URL is the default base for both scoring and embedding", () => {
  const c = loadConfig({ DATABASE_URL: "x", LITELLM_BASE_URL: "https://proxy" });
  expect(c.deepseekBaseUrl).toBe("https://proxy");
  expect(c.embedBaseUrl).toBe("https://proxy");
});

test("explicit EMBED_* splits embeddings off the proxy without touching chat", () => {
  const c = loadConfig({
    DATABASE_URL: "x",
    LITELLM_API_KEY: "lit",
    LITELLM_BASE_URL: "https://proxy",
    EMBED_BASE_URL: "http://ollama:11434/v1",
    EMBED_API_KEY: "ollama",
  });
  expect(c.deepseekApiKey).toBe("lit");
  expect(c.deepseekBaseUrl).toBe("https://proxy");
  expect(c.embedBaseUrl).toBe("http://ollama:11434/v1");
  expect(c.embedApiKey).toBe("ollama");
});

test("removed legacy DEEPSEEK_* vars are ignored", () => {
  const c = loadConfig({ DATABASE_URL: "x", DEEPSEEK_API_KEY: "d", DEEPSEEK_BASE_URL: "https://d" });
  expect(c.deepseekApiKey).toBe("");
  expect(c.deepseekBaseUrl).toBe("https://api.deepseek.com");
});

test("resolveBaseUrl: DB value wins, trailing slash trimmed, empty falls back to env", () => {
  expect(resolveBaseUrl("https://db/", "https://env")).toBe("https://db");
  expect(resolveBaseUrl("", "https://env")).toBe("https://env");
  expect(resolveBaseUrl(null, "https://env/")).toBe("https://env");
  expect(resolveBaseUrl("  https://db  ", "https://env")).toBe("https://db");
});

test("aiKeyConfigured reflects any configured AI key", () => {
  expect(aiKeyConfigured({})).toBe(false);
  expect(aiKeyConfigured({ LITELLM_API_KEY: "k" })).toBe(true);
  expect(aiKeyConfigured({ DEEPSEEK_API_KEY: "k" })).toBe(false);
  expect(aiKeyConfigured({ EMBED_API_KEY: "k" })).toBe(true);
});

test("aiBaseUrlDefault: LITELLM_BASE_URL else deepseek.com; DEEPSEEK_BASE_URL is gone", () => {
  expect(aiBaseUrlDefault({})).toBe("https://api.deepseek.com");
  expect(aiBaseUrlDefault({ DEEPSEEK_BASE_URL: "https://d" })).toBe("https://api.deepseek.com");
  expect(aiBaseUrlDefault({ LITELLM_BASE_URL: "https://l" })).toBe("https://l");
});
