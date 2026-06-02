const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "pl-PL,pl;q=0.9" },
  });
  if (!res.ok) throw new Error(`fetchPage ${url} -> HTTP ${res.status}`);
  return res.text();
}
