/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client-side helper to persist and transmit the server-signed SmartCost session token
 * and Firebase ID token across iframe environments where third-party cookies may be blocked.
 */

import { auth } from "../firebase";

const SERVER_SESSION_TOKEN_KEY = "smartcost_server_session_token";
const SERVER_CSRF_TOKEN_KEY = "smartcost_server_csrf_token";
const LEGACY_CURRENT_SESSION_KEY = "pengekosan_current_session";

// Module-scoped in-memory tokens backed by tab-scoped sessionStorage
// (never persisted to localStorage, survives reloads & blocked iframe cookies)
let memorySessionToken: string | null = null;
let memoryCsrfToken: string | null = null;

function readSessionStorageItem(key: string): string | null {
  try {
    const val = sessionStorage.getItem(key);
    return val && val.trim() ? val.trim() : null;
  } catch {
    return null;
  }
}

function purgeLocalStorageLegacyTokens(): void {
  try {
    localStorage.removeItem(SERVER_SESSION_TOKEN_KEY);
    localStorage.removeItem(SERVER_CSRF_TOKEN_KEY);
  } catch {}
}

purgeLocalStorageLegacyTokens();
memorySessionToken = readSessionStorageItem(SERVER_SESSION_TOKEN_KEY);
memoryCsrfToken = readSessionStorageItem(SERVER_CSRF_TOKEN_KEY);

export function saveServerSessionToken(token?: string | null, csrfToken?: string | null): void {
  purgeLocalStorageLegacyTokens();
  if (typeof token === "string" && token.trim()) {
    const clean = token.trim();
    memorySessionToken = clean;
    try {
      sessionStorage.setItem(SERVER_SESSION_TOKEN_KEY, clean);
    } catch {}
  }
  if (typeof csrfToken === "string" && csrfToken.trim()) {
    const cleanCsrf = csrfToken.trim();
    memoryCsrfToken = cleanCsrf;
    try {
      sessionStorage.setItem(SERVER_CSRF_TOKEN_KEY, cleanCsrf);
    } catch {}
  }
}

export function getServerSessionToken(): string | null {
  if (memorySessionToken) return memorySessionToken;
  const fromStorage = readSessionStorageItem(SERVER_SESSION_TOKEN_KEY);
  if (fromStorage) memorySessionToken = fromStorage;
  return memorySessionToken;
}

export function getCsrfToken(): string | null {
  if (memoryCsrfToken) return memoryCsrfToken;
  const fromStorage = readSessionStorageItem(SERVER_CSRF_TOKEN_KEY);
  if (fromStorage) memoryCsrfToken = fromStorage;
  return memoryCsrfToken;
}

export function clearServerSessionToken(): void {
  memorySessionToken = null;
  memoryCsrfToken = null;
  purgeLocalStorageLegacyTokens();
  try {
    sessionStorage.removeItem(SERVER_SESSION_TOKEN_KEY);
    sessionStorage.removeItem(SERVER_CSRF_TOKEN_KEY);
    localStorage.removeItem(LEGACY_CURRENT_SESSION_KEY);
  } catch {}
}

export async function getAuthFetchHeaders(
  extraHeaders: Record<string, string> = {}
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...extraHeaders };
  const scsToken = getServerSessionToken();
  if (scsToken) {
    headers["X-SmartCost-Session"] = scsToken;
  }
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  if (scsToken) {
    headers["Authorization"] = `Bearer scs.${scsToken}`;
    return headers;
  }

  try {
    if (typeof auth.authStateReady === "function") {
      await auth.authStateReady();
    }
    if (auth.currentUser) {
      const idToken = await auth.currentUser.getIdToken();
      if (idToken) {
        headers["Authorization"] = `Bearer ${idToken}`;
      }
    }
  } catch {}

  return headers;
}

