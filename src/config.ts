export interface AppConfig {
  databaseUrl: string;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  scorerModel: string;
  appriseUrl: string;
  port: number;
  embedBaseUrl: string;
  embedApiKey: string;
  embedModel: string;
  browserless: { url: string; token?: string };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const require = (key: string): string => {
    const v = env[key];
    if (!v) throw new Error(`Missing required env var: ${key}`);
    return v;
  };
  // LITELLM_* is the single OpenAI-compatible AI credential pair: chat (scoring +
  // feature extraction) always uses it, and embeddings default to it. Setting the
  // EMBED_* vars routes embeddings to a dedicated provider (e.g. local Ollama)
  // WITHOUT touching chat — explicit EMBED_* wins over the shared proxy.
  return {
    databaseUrl: require("DATABASE_URL"),
    deepseekApiKey: env.LITELLM_API_KEY || "",
    deepseekBaseUrl: env.LITELLM_BASE_URL || "https://api.deepseek.com",
    scorerModel: env.SCORER_MODEL ?? "deepseek/deepseek-chat",
    appriseUrl: env.APPRISE_URL ?? "http://localhost:8000",
    port: Number(env.PORT ?? "3000"),
    embedBaseUrl: env.EMBED_BASE_URL || env.LITELLM_BASE_URL || "https://api.openai.com/v1",
    embedApiKey: env.EMBED_API_KEY || env.LITELLM_API_KEY || "",
    embedModel: env.EMBED_MODEL ?? "text-embedding-3-small",
    browserless: {
      url: env.BROWSERLESS_URL ?? "",
      token: env.BROWSERLESS_TOKEN || undefined,
    },
  };
}

/** Effective chat AI base URL when the operator hasn't overridden it in the DB:
 *  LITELLM_BASE_URL (the OpenAI-compatible proxy), else DeepSeek's public endpoint. */
export function aiBaseUrlDefault(env: Record<string, string | undefined> = process.env): string {
  return env.LITELLM_BASE_URL || "https://api.deepseek.com";
}

/** True when any AI key is set in env (the LiteLLM proxy key or an embeddings key).
 *  Used to show a read-only "key configured" status in the UI without ever
 *  serializing the secret itself. */
export function aiKeyConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.LITELLM_API_KEY || env.EMBED_API_KEY);
}

/** Resolve the effective AI endpoint: the operator's DB override if non-empty,
 *  else the env default. Trailing slashes are trimmed so callers can safely
 *  append "/chat/completions" or "/embeddings". */
export function resolveBaseUrl(dbUrl: string | null | undefined, envUrl: string): string {
  const chosen = (dbUrl ?? "").trim() || envUrl;
  return chosen.replace(/\/+$/, "");
}
