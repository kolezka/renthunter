import { getAiModels } from "../lib/api";

/** Shared, module-scoped model-list state for the AI settings tab.
 *
 *  AiTab lives inside Config.svelte's `{#key active}` block, so it unmounts and
 *  remounts on every settings-tab switch. Keeping the list here (rather than in
 *  the component) means a remount reuses the already-loaded list instead of
 *  re-hitting the proxy each visit. `loadedFor` keys the list to the endpoint it
 *  was loaded for, so a changed endpoint still reloads; the Refresh button forces
 *  a reload regardless. State persists for the SPA session, which is fine — the
 *  Refresh button is the explicit "test this endpoint now" action. */
export const modelState = $state<{
  models: string[];
  error: string;
  loading: boolean;
  loadedFor: string | null;
}>({ models: [], error: "", loading: false, loadedFor: null });

// Dedupes concurrent loads for the same endpoint (e.g. a fast remount while the
// first fetch is still in flight) without marking a still-failing load as done.
let inFlightFor: string | null = null;

async function load(baseUrl: string, fresh: boolean) {
  inFlightFor = baseUrl;
  modelState.loading = true;
  try {
    const r = await getAiModels(fresh, baseUrl);
    modelState.models = r.models;
    modelState.error = r.error ?? "";
    // Mark loaded on any resolved result (incl. a degraded { models: [], error }),
    // so a reachable-but-unhappy proxy isn't re-polled on every tab switch. A THROWN
    // error skips this line, leaving the endpoint eligible for a retry on next mount.
    modelState.loadedFor = baseUrl;
  } catch (err) {
    modelState.models = [];
    modelState.error = err instanceof Error ? err.message : "Failed to load models";
  } finally {
    modelState.loading = false;
    inFlightFor = null;
  }
}

/** Load the list for `baseUrl` once. Skips the fetch when the list is already
 *  loaded (or loading) for this exact endpoint, so switching settings tabs is free. */
export function ensureModels(baseUrl: string) {
  if (modelState.loadedFor === baseUrl || inFlightFor === baseUrl) return;
  void load(baseUrl, false);
}

/** Refresh button: always re-fetch, bypassing both this guard and the server's cache. */
export function refreshModels(baseUrl: string) {
  void load(baseUrl, true);
}
