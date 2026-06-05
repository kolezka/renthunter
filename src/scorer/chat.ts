import { withRetry } from "../scraper/retry";
import { TIMEOUTS } from "../scraper/timeout";

const MODEL = "deepseek-chat";

export interface ChatOptions {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

/** POST to {baseUrl}/chat/completions with JSON response_format; retries 429/5xx
 *  with backoff and a hard timeout. Returns the raw assistant message content; caller parses. */
export async function chatJson(
  opts: ChatOptions,
  msg: { system: string; user: string; temperature?: number },
): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await withRetry(() =>
    doFetch(`${opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
      signal: AbortSignal.timeout(TIMEOUTS.ai),
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: msg.system },
          { role: "user", content: msg.user },
        ],
        response_format: { type: "json_object" },
        temperature: msg.temperature ?? 0.2,
      }),
    }),
  );
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
  const data: any = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}
