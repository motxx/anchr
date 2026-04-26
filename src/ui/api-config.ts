/**
 * API configuration for the web UIs.
 * When served from the same origin as the API, baseUrl is empty (relative paths).
 * When deployed separately, set window.__ANCHR_API_URL__ or use the data attribute.
 */

declare global {
  // eslint-disable-next-line no-var
  var __ANCHR_API_URL__: string | undefined;
}

function getApiBaseUrl(): string {
  // 1. Explicit global override (e.g. set by CDN deployment)
  if (typeof globalThis !== "undefined" && globalThis.__ANCHR_API_URL__) {
    return globalThis.__ANCHR_API_URL__.replace(/\/+$/, "");
  }

  // 2. Data attribute on root element
  if (typeof document !== "undefined") {
    const root = document.getElementById("root");
    const url = root?.dataset.apiUrl;
    if (url) return url.replace(/\/+$/, "");
  }

  // 3. Same-origin (default — works when API and UI are co-hosted)
  return "";
}

export const API_BASE = getApiBaseUrl();

/** Fetch wrapper that prepends the API base URL */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, init);
}
