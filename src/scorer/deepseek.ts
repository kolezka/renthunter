import { chatJson } from "./chat";

export interface ScoreInput { description: string; criteria: string; }
export interface ScoreResult { score: number; reasons: string; }
export interface ScoreOptions {
  apiKey: string;
  baseUrl: string;
  /** Language the model is asked to write `reasons` in. Defaults to "Polish"
   *  because listings are Polish; configurable via the `outputLanguage` setting. */
  language?: string;
  model?: string;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export async function scoreOffer(input: ScoreInput, opts: ScoreOptions): Promise<ScoreResult> {
  const language = opts.language || "Polish";
  const system =
    "You rate apartment rental listings against the user's criteria. " +
    `Return ONLY JSON: {"score": <0-100>, "reasons": "<short justification in ${language}>"}. ` +
    "score = how well the listing matches the criteria (100 = perfect match).";
  const user =
    `User criteria:\n${input.criteria}\n\n` +
    `Listing description:\n${input.description}`;

  const content = await chatJson(opts, { system, user, temperature: 0.2 });

  let parsed: { score?: unknown; reasons?: unknown };
  try { parsed = JSON.parse(content); }
  catch { throw new Error("DeepSeek: failed to parse AI response"); }
  const raw = Number(parsed.score);
  if (!Number.isFinite(raw)) throw new Error("DeepSeek: response had no numeric score");
  return { score: Math.max(0, Math.min(100, Math.round(raw))), reasons: String(parsed.reasons ?? "") };
}
