import { TIMEOUTS } from "../scraper/timeout";

export interface NotifyInput {
  appriseUrl: string;
  targets: string[];
  title: string;
  body: string;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export async function sendNotification(input: NotifyInput): Promise<void> {
  if (input.targets.length === 0) return;
  const doFetch = input.fetchImpl ?? fetch;
  const res = await doFetch(`${input.appriseUrl}/notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(TIMEOUTS.notify),
    body: JSON.stringify({
      urls: input.targets.join(","),
      title: input.title,
      body: input.body,
    }),
  });
  if (!res.ok) throw new Error(`Apprise HTTP ${res.status}`);
}
