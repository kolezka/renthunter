export interface ScoreInput { description: string; criteria: string; }
export interface ScoreResult { score: number; reasons: string; }
export interface ScoreOptions {
  apiKey: string;
  baseUrl: string;
  /** Language the model is asked to write `reasons` in. Defaults to "Polish"
   *  because listings are Polish; configurable via the `outputLanguage` setting. */
  language?: string;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export async function scoreOffer(input: ScoreInput, opts: ScoreOptions): Promise<ScoreResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const language = opts.language || "Polish";
  const system =
    "You rate apartment rental listings against the user's criteria. " +
    `Return ONLY JSON: {"score": <0-100>, "reasons": "<short justification in ${language}>"}. ` +
    "score = how well the listing matches the criteria (100 = perfect match).";
  const user =
    `User criteria:\n${input.criteria}\n\n` +
    `Listing description:\n${input.description}`;

  const res = await doFetch(`${opts.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
  const data: any = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";

  try {
    const parsed = JSON.parse(content);
    const raw = Number(parsed.score);
    const score = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 0;
    return { score, reasons: String(parsed.reasons ?? "") };
  } catch {
    return { score: 0, reasons: "Failed to parse AI response (parse error)" };
  }
}
