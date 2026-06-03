export interface ExtractFeaturesInput { title: string; description: string; }
export interface ExtractFeaturesOptions {
  apiKey: string;
  baseUrl: string;
  /** Language the extracted feature tags are written in. Defaults to "Polish"
   *  because listings are Polish; configurable via the `outputLanguage` setting. */
  language?: string;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export async function extractFeatures(
  input: ExtractFeaturesInput,
  opts: ExtractFeaturesOptions,
): Promise<string[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const language = opts.language || "Polish";
  const system =
    "You extract apartment features from a rental listing. " +
    'Return ONLY JSON: {"features": ["<feature>", ...]}. ' +
    `Each feature is a short lowercase tag in ${language} (e.g. balcony, garage, ` +
    "furnished, near the sea, elevator, parking). At most 12 features.";
  const user = `Title:\n${input.title}\n\nDescription:\n${input.description}`;

  const res = await doFetch(`${opts.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
  const data: any = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed.features) ? parsed.features : [];
    return arr.map((f: unknown) => String(f).trim().toLowerCase()).filter(Boolean).slice(0, 12);
  } catch {
    return [];
  }
}
