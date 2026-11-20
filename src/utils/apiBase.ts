/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SmartCost API Origin Resolver
 * - Defaults to same-origin relative URLs ("") when hosted on Express/Cloud Run or custom domain Worker routes.
 * - Uses VITE_API_BASE_URL (e.g. https://smartcost-zero-cost-gateway.<account>.workers.dev) when frontend
 *   is deployed separately on Cloudflare Pages Free (*.pages.dev).
 */

export function getApiBaseUrl(): string {
  const raw =
    typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_API_BASE_URL
      ? String((import.meta as any).env.VITE_API_BASE_URL)
      : "";
  return raw.trim().replace(/\/+$/, "");
}

export function apiUrl(path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${cleanPath}` : cleanPath;
}
