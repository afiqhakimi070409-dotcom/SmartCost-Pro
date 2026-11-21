/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SmartCost API Origin Resolver
 * - Defaults to same-origin relative URLs ("") when hosted on Express/Cloud Run or custom domain Worker routes.
 * - Uses VITE_API_URL or VITE_API_BASE_URL (e.g. https://your-express-backend.example.com) when frontend
 *   is deployed separately on Cloudflare Workers / Cloudflare Pages.
 */

function isLocalHostName(hostname: string): boolean {
  const lower = hostname.trim().toLowerCase();
  return (
    lower === "localhost" ||
    lower === "127.0.0.1" ||
    lower === "0.0.0.0" ||
    lower === "::1" ||
    lower === "[::1]" ||
    lower.endsWith(".local")
  );
}

export function getApiBaseUrl(): string {
  const env = typeof import.meta !== "undefined" ? (import.meta as any).env : undefined;
  let raw = String(env?.VITE_API_URL || env?.VITE_API_BASE_URL || "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim()
    .replace(/\/+$/, "");
  if (!raw || raw === "/" || raw.startsWith("/api")) return "";

  const lowerRaw = raw.toLowerCase();
  if (lowerRaw === "null" || lowerRaw === "undefined" || lowerRaw === "none") {
    return "";
  }

  if (!raw.includes("://") && /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:\/.*)?$/i.test(raw)) {
    raw = `https://${raw}`;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    const lowerHost = parsed.hostname.toLowerCase();
    if (
      lowerHost.includes("example.com") ||
      lowerHost.includes("your-express-backend") ||
      lowerHost.includes("placeholder")
    ) {
      return "";
    }
    if (typeof window !== "undefined" && window.location) {
      if (
        parsed.origin === window.location.origin ||
        lowerHost === window.location.hostname.toLowerCase()
      ) {
        return "";
      }
      if (isLocalHostName(lowerHost) && !isLocalHostName(window.location.hostname)) {
        return "";
      }
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export function hasExternalApiBaseUrl(): boolean {
  return Boolean(getApiBaseUrl());
}

export function getFetchCredentialsMode(): RequestCredentials {
  return hasExternalApiBaseUrl() ? "include" : "same-origin";
}

export function apiUrl(path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${cleanPath}` : cleanPath;
}

export function sameOriginApiUrl(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export function isEdgeStandaloneResponse(status: number, data: any): boolean {
  if (
    data &&
    (data.edgeFallback === true ||
      data.code === "EDGE_STANDALONE_MODE" ||
      data.code === "ORIGIN_API_URL_NOT_CONFIGURED" ||
      data.code === "ORIGIN_UNREACHABLE")
  ) {
    return true;
  }
  if (status === 502 || status === 503 || status === 504) {
    return true;
  }
  // Static hosts (e.g. Cloudflare Pages without Functions) return 404 HTML for /api/* routes
  if (status === 404 && (!data || typeof data !== "object" || Object.keys(data).length === 0)) {
    return true;
  }
  return false;
}

export function isOriginUnavailableError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof TypeError) return true;
  const name = typeof (err as any)?.name === "string" ? (err as any).name : "";
  if (name === "AbortError" || name === "TimeoutError") return true;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network error") ||
    msg.includes("load failed") ||
    msg.includes("err_network") ||
    msg.includes("econnrefused") ||
    msg.includes("timeout") ||
    msg.includes("aborted")
  );
}

