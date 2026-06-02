export interface AppConfig {
  databaseUrl: string;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  appriseUrl: string;
  port: number;
}

export function loadConfig(env: Record<string, string | undefined> = Bun.env): AppConfig {
  const require = (key: string): string => {
    const v = env[key];
    if (!v) throw new Error(`Missing required env var: ${key}`);
    return v;
  };
  return {
    databaseUrl: require("DATABASE_URL"),
    deepseekApiKey: env.DEEPSEEK_API_KEY ?? "",
    deepseekBaseUrl: env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    appriseUrl: env.APPRISE_URL ?? "http://localhost:8000",
    port: Number(env.PORT ?? "3000"),
  };
}
