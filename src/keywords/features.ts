export interface ExtractFeaturesInput { title: string; description: string; }
export interface ExtractFeaturesOptions {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export async function extractFeatures(
  input: ExtractFeaturesInput,
  opts: ExtractFeaturesOptions,
): Promise<string[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const system =
    "Wyodrębniasz cechy mieszkania z ogłoszenia najmu. " +
    'Zwróć WYŁĄCZNIE JSON: {"features": ["<cecha>", ...]}. ' +
    "Każda cecha to krótkie hasło po polsku, małymi literami (np. balkon, garaż, " +
    "umeblowane, blisko morza, winda, parking). Maksymalnie 12 cech.";
  const user = `Tytuł:\n${input.title}\n\nOpis:\n${input.description}`;

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
