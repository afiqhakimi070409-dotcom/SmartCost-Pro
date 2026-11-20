/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SmartCost API Origin Resolver
 * - Defaults to same-origin relative URLs ("") when hosted on Express/Cloud Run or custom domain Worker routes.
 * - Uses VITE_API_URL or VITE_API_BASE_URL (e.g. https://your-express-backend.example.com) when frontend
 *   is deployed separately on Cloudflare Workers / Cloudflare Pages.
 */

export function getApiBaseUrl(): string {
  const env = typeof import.meta !== "undefined" ? (import.meta as any).env : undefined;
  const raw = env?.VITE_API_URL || env?.VITE_API_BASE_URL || "";
  return String(raw).trim().replace(/\/+$/, "");
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

export function isEdgeStandaloneResponse(status: number, data: any): boolean {
  if (data && (data.edgeFallback === true || data.code === "EDGE_STANDALONE_MODE")) {
    return true;
  }
  if (status === 503 && data?.code === "ORIGIN_API_URL_NOT_CONFIGURED") {
    return true;
  }
  return false;
}

