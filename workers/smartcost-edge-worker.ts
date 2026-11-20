/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SmartCost Zero-Cost Edge Worker (Cloudflare Workers Free Tier — RM0.00/month)
 * - Serves dist/ SPA & static assets directly via env.ASSETS (with SPA fallback to /index.html).
 * - When ORIGIN_API_URL is configured: transparently proxies /api/* to the Express origin server.
 * - When ORIGIN_API_URL is NOT configured (Standalone Cloudflare Mode):
 *   * Verifies Firebase ID tokens cryptographically (RS256 vs Google public JWKS) on /api/auth/session-firebase.
 *   * Issues & verifies Web Crypto HMAC-SHA256 stateless session tokens (/api/auth/edge-session, /api/auth/session, /api/auth/logout).
 *   * Supports edge RBAC manual auth handoff (EDGE_STANDALONE_MODE) using Web Crypto PBKDF2-SHA256 in browser without raw Express errors.
 *   * Handles /api/databases/*, /api/telemetry/*, /api/mrcost/history, and optional Gemini REST proxy (/api/mrcost/chat when GEMINI_API_KEY is set).
 */

export interface Env {
  ASSETS?: {
    fetch: (request: Request | string | URL, init?: RequestInit) => Promise<Response>;
  };
  APP_COST_TIER?: string;
  FIRESTORE_PROJECT_ID?: string;
  FIRESTORE_DATABASE_ID?: string;
  ORIGIN_API_URL?: string;
  ALLOWED_ORIGINS?: string;
  GEMINI_API_KEY?: string;
  SESSION_SECRET?: string;
}

interface EdgeSessionPayload {
  sid: string;
  uid: string;
  username: string;
  fullName: string;
  role: "admin" | "developer" | "kerani" | "pengurus" | "penyelia" | "staf" | "auditor";
  companyName: string;
  dbKey: string;
  email?: string;
  isVerifiedDeveloper: boolean;
  csrfToken: string;
  iat: number;
  exp: number;
}

const LOGICAL_POOLS = ["server-a", "server-b", "server-c"] as const;
const SESSION_COOKIE_NAME = "smartcost_session";
const SESSION_TTL_SEC = 12 * 60 * 60;
const DEVELOPER_EMAIL_ALLOWLIST = new Set(["afiqhakimi070409@gmail.com"]);
const VALID_CLIENT_ROLES = new Set(["admin", "kerani", "pengurus", "penyelia", "staf", "auditor"]);
const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let logicalCursor = 0;
let cachedJwks: { keys?: Array<Record<string, any>> } | null = null;
let jwksExpiresAt = 0;

function pickLogicalPool(): string {
  const chosen = LOGICAL_POOLS[logicalCursor % LOGICAL_POOLS.length];
  logicalCursor = (logicalCursor + 1) % LOGICAL_POOLS.length;
  return chosen;
}

function isOriginAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    if (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname.endsWith(".pages.dev") ||
      u.hostname.endsWith(".workers.dev") ||
      u.hostname.endsWith(".run.app")
    ) {
      return true;
    }
    if (env.ALLOWED_ORIGINS) {
      const list = env.ALLOWED_ORIGINS.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.includes(origin)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function applySecurityAndCorsHeaders(headers: Headers, request: Request, env: Env): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("X-SmartCost-Cost-Tier", "RM0.00-Free-Tier");
  headers.set("X-SmartCost-Runtime", "Cloudflare-Workers-Free-Single-Serverless-Platform");

  const origin = request.headers.get("Origin");
  if (origin && isOriginAllowed(origin, env)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD");
    headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-SmartCost-Session, X-CSRF-Token"
    );
    headers.set(
      "Access-Control-Expose-Headers",
      "X-SmartCost-Node, X-SmartCost-Edge-Pool, X-SmartCost-LB-Algorithm, X-SmartCost-Cost-Tier"
    );
    headers.set("Access-Control-Max-Age", "86400");
  }
}

function jsonResponse(
  body: unknown,
  request: Request,
  env: Env,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    ...(extraHeaders || {}),
  });
  applySecurityAndCorsHeaders(headers, request, env);
  return new Response(JSON.stringify(body), { status, headers });
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function randomTokenHex(byteLen = 16): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function getHmacKey(env: Env): Promise<CryptoKey> {
  const secretSource =
    (env.SESSION_SECRET && env.SESSION_SECRET.trim()) ||
    `smartcost-edge-session-v1:${env.FIRESTORE_PROJECT_ID || "reflecting-booth-740ks"}:${env.FIRESTORE_DATABASE_ID || "default"}`;
  const raw = new TextEncoder().encode(secretSource);
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

async function signEdgeSession(payload: EdgeSessionPayload, env: Env): Promise<string> {
  const key = await getHmacKey(env);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const payloadB64 = toBase64Url(payloadBytes);
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  const sigB64 = toBase64Url(new Uint8Array(sigBuf));
  return `scs_edge.${payloadB64}.${sigB64}`;
}

async function verifyEdgeSessionToken(
  token: string | null | undefined,
  env: Env
): Promise<EdgeSessionPayload | null> {
  if (!token || !token.startsWith("scs_edge.")) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const [, payloadB64, sigB64] = parts;
    const key = await getHmacKey(env);
    const sigBytes = fromBase64Url(sigB64);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      new TextEncoder().encode(payloadB64)
    );
    if (!valid) return null;
    const decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64))) as EdgeSessionPayload;
    const nowSec = Math.floor(Date.now() / 1000);
    if (!decoded || typeof decoded.exp !== "number" || decoded.exp <= nowSec) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function getCookieValue(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

function buildSessionCookieHeader(token: string, requestUrl: URL, maxAgeSec = SESSION_TTL_SEC): string {
  const secureFlag = requestUrl.protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secureFlag}`;
}

async function resolveEdgeActor(request: Request, env: Env): Promise<EdgeSessionPayload | null> {
  const xHeader = request.headers.get("X-SmartCost-Session")?.trim();
  if (xHeader) {
    const parsed = await verifyEdgeSessionToken(xHeader, env);
    if (parsed) return parsed;
  }
  const authHeader = request.headers.get("Authorization")?.trim() || "";
  if (authHeader.startsWith("Bearer scs.")) {
    const parsed = await verifyEdgeSessionToken(authHeader.slice(11).trim(), env);
    if (parsed) return parsed;
  }
  const cookieToken = getCookieValue(request, SESSION_COOKIE_NAME);
  if (cookieToken) {
    const parsed = await verifyEdgeSessionToken(cookieToken, env);
    if (parsed) return parsed;
  }
  if (authHeader.startsWith("Bearer ")) {
    const fbToken = authHeader.slice(7).trim();
    const fbUser = await verifyFirebaseIdTokenEdge(fbToken, env);
    if (fbUser) {
      const email = (fbUser.email || "").toLowerCase();
      const isDev = Boolean(email && fbUser.emailVerified && DEVELOPER_EMAIL_ALLOWLIST.has(email));
      const nowSec = Math.floor(Date.now() / 1000);
      return {
        sid: `fb_${fbUser.uid.slice(0, 12)}`,
        uid: fbUser.uid,
        username: email ? email.split("@")[0] : fbUser.uid.slice(0, 12),
        fullName: fbUser.name || (email ? email.split("@")[0] : "Pengguna"),
        role: isDev ? "developer" : "staf",
        companyName: isDev ? "DEVELOPER SANDBOX" : "SCHOOL ENTERPRISE",
        dbKey: isDev ? "pengekosan_dev_sandbox_db" : `pengekosan_userdb_${fbUser.uid}`,
        email: fbUser.email,
        isVerifiedDeveloper: isDev,
        csrfToken: randomTokenHex(12),
        iat: nowSec,
        exp: nowSec + SESSION_TTL_SEC,
      };
    }
  }
  return null;
}

async function getFirebaseJwks(forceRefresh = false): Promise<Array<Record<string, any>>> {
  const now = Date.now();
  if (!forceRefresh && cachedJwks?.keys && now < jwksExpiresAt) {
    return cachedJwks.keys;
  }
  const resp = await fetch(FIREBASE_JWKS_URL);
  if (!resp.ok) {
    throw new Error(`Failed to fetch Firebase JWKS: ${resp.status}`);
  }
  const json = (await resp.json()) as { keys?: Array<Record<string, any>> };
  const cc = resp.headers.get("cache-control") || "";
  const match = cc.match(/max-age=(\d+)/i);
  const maxAgeSec = match ? parseInt(match[1], 10) : 3600;
  cachedJwks = json;
  jwksExpiresAt = now + Math.max(60, maxAgeSec) * 1000;
  return json.keys || [];
}

async function verifyFirebaseIdTokenEdge(
  token: string,
  env: Env
): Promise<{ uid: string; email?: string; emailVerified: boolean; name?: string } | null> {
  try {
    if (!token || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const header = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1])));
    if (!header || header.alg !== "RS256" || typeof header.kid !== "string") return null;

    const projectId = env.FIRESTORE_PROJECT_ID || "reflecting-booth-740ks";
    const expectedIss = `https://securetoken.google.com/${projectId}`;
    const nowSec = Math.floor(Date.now() / 1000);

    if (payload.aud !== projectId) return null;
    if (payload.iss !== expectedIss) return null;
    if (typeof payload.exp !== "number" || payload.exp <= nowSec) return null;
    if (typeof payload.iat !== "number" || payload.iat > nowSec + 300) return null;
    const uid = String(payload.sub || payload.user_id || "").trim();
    if (!uid || uid.length > 128) return null;

    let keys = await getFirebaseJwks(false);
    let jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) {
      keys = await getFirebaseJwks(true);
      jwk = keys.find((k) => k.kid === header.kid);
    }
    if (!jwk) return null;

    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const sigBytes = fromBase64Url(parts[2]);
    const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, sigBytes, signedData);
    if (!valid) return null;

    return {
      uid,
      email: typeof payload.email === "string" ? payload.email.trim().toLowerCase() : undefined,
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === "string" ? payload.name.trim() : undefined,
    };
  } catch {
    return null;
  }
}

async function readJsonBodySafe(request: Request): Promise<Record<string, any>> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" ? (parsed as Record<string, any>) : {};
  } catch {
    return {};
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pool = pickLogicalPool();

    // 0. CORS Preflight
    if (request.method === "OPTIONS") {
      const headers = new Headers();
      applySecurityAndCorsHeaders(headers, request, env);
      return new Response(null, { status: 204, headers });
    }

    // 1. Edge Health Probes
    if (url.pathname === "/healthz" || url.pathname === "/api/health") {
      return jsonResponse(
        {
          status: url.pathname === "/healthz" ? "OK" : "ok",
          runtime: "cloudflare-workers-free",
          monthlyBudget: "RM0.00",
          logicalPool: pool,
          originConfigured: Boolean(env.ORIGIN_API_URL),
          edgeAuthMode: env.ORIGIN_API_URL ? "express_origin_proxy" : "cloudflare_edge_standalone",
          firestoreProjectId: env.FIRESTORE_PROJECT_ID || "reflecting-booth-740ks",
          timestamp: new Date().toISOString(),
        },
        request,
        env,
        200,
        { "X-SmartCost-Node": pool }
      );
    }

    // 2. Non-secret Feature Flags
    if (url.pathname === "/api/config/features" && !env.ORIGIN_API_URL) {
      return jsonResponse(
        {
          devEntryEnabled: true,
          devSandboxEnabled: true,
          zeroCostEdgeMode: true,
          originConfigured: false,
          edgeAuthMode: "cloudflare_edge_standalone",
        },
        request,
        env,
        200,
        { "X-SmartCost-Node": pool }
      );
    }

    // 3. Edge Capabilities Diagnostic
    if (url.pathname === "/api/edge/capabilities") {
      return jsonResponse(
        {
          status: "OK",
          monthlyCost: "RM0.00",
          originConfigured: Boolean(env.ORIGIN_API_URL),
          geminiDirectConfigured: Boolean(env.GEMINI_API_KEY),
          firestoreProjectId: env.FIRESTORE_PROJECT_ID || "reflecting-booth-740ks",
          edgeDirectEndpoints: [
            "GET /healthz",
            "GET /api/health",
            "GET /api/config/features",
            "GET /api/edge/capabilities",
            "POST /api/auth/session-firebase",
            "POST /api/auth/edge-session",
            "GET /api/auth/session",
            "POST /api/auth/logout",
          ],
          clientDirectFirebaseServices: [
            "Firebase Authentication (Google Sign-In & Email/Password)",
            "Firebase Firestore Enterprise (Company DB & Products)",
          ],
        },
        request,
        env,
        200,
        { "X-SmartCost-Node": pool }
      );
    }

    // 4. API Routing: Express Origin Proxy OR Native Cloudflare Edge Handler
    if (url.pathname.startsWith("/api/")) {
      if (env.ORIGIN_API_URL) {
        try {
          const originTarget = new URL(url.pathname + url.search, env.ORIGIN_API_URL);
          const forwardHeaders = new Headers(request.headers);
          forwardHeaders.set("X-Forwarded-Host", url.host);
          forwardHeaders.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
          forwardHeaders.set("X-SmartCost-Edge-Pool", pool);

          const proxiedReq = new Request(originTarget.toString(), {
            method: request.method,
            headers: forwardHeaders,
            body:
              request.method !== "GET" && request.method !== "HEAD"
                ? request.body
                : undefined,
          });
          const upstreamResp = await fetch(proxiedReq);
          const outHeaders = new Headers(upstreamResp.headers);
          applySecurityAndCorsHeaders(outHeaders, request, env);
          outHeaders.set("X-SmartCost-Edge-Pool", pool);
          return new Response(upstreamResp.body, {
            status: upstreamResp.status,
            statusText: upstreamResp.statusText,
            headers: outHeaders,
          });
        } catch {
          return jsonResponse(
            {
              error: "Pelayan backend utama sedang tidak dapat dicapai buat sementara waktu. Sila cuba sebentar lagi.",
              code: "ORIGIN_UNREACHABLE",
              logicalPool: pool,
            },
            request,
            env,
            502,
            { "X-SmartCost-Node": pool }
          );
        }
      }

      // === STANDALONE CLOUDFLARE EDGE API MODE (No external Express origin needed) ===

      // 4a. Firebase ID Token -> Signed Edge Session Exchange
      if (url.pathname === "/api/auth/session-firebase" && request.method === "POST") {
        const body = await readJsonBodySafe(request);
        const authHeader = request.headers.get("Authorization") || "";
        const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
        const tokenInput = bearer || (typeof body.idToken === "string" ? body.idToken.trim() : "");
        const verified = await verifyFirebaseIdTokenEdge(tokenInput, env);
        if (!verified) {
          return jsonResponse(
            { error: "Token pengesahan Firebase tidak sah atau telah tamat tempoh.", code: "INVALID_FIREBASE_TOKEN" },
            request,
            env,
            401,
            { "X-SmartCost-Node": pool }
          );
        }

        const email = (verified.email || "").toLowerCase();
        const isDev = Boolean(email && verified.emailVerified && DEVELOPER_EMAIL_ALLOWLIST.has(email));
        const role = isDev ? "developer" : "staf";
        const dbKey =
          isDev
            ? "pengekosan_dev_sandbox_db"
            : typeof body.dbKey === "string" && body.dbKey.trim()
              ? body.dbKey.trim()
              : `pengekosan_userdb_${verified.uid}`;
        const companyName = isDev
          ? "DEVELOPER SANDBOX"
          : typeof body.companyName === "string" && body.companyName.trim()
            ? body.companyName.trim().slice(0, 128)
            : "SCHOOL ENTERPRISE";
        const nowSec = Math.floor(Date.now() / 1000);
        const csrfToken = randomTokenHex(16);
        const sessionPayload: EdgeSessionPayload = {
          sid: `edge_${randomTokenHex(8)}`,
          uid: verified.uid,
          username: email ? email.split("@")[0] : verified.uid.slice(0, 16),
          fullName: verified.name || (email ? email.split("@")[0] : "Pengguna"),
          role,
          companyName,
          dbKey,
          email: verified.email,
          isVerifiedDeveloper: isDev,
          csrfToken,
          iat: nowSec,
          exp: nowSec + SESSION_TTL_SEC,
        };
        const sessionToken = await signEdgeSession(sessionPayload, env);
        return jsonResponse(
          {
            success: true,
            edgeMode: true,
            user: {
              id: sessionPayload.uid,
              username: sessionPayload.username,
              fullName: sessionPayload.fullName,
              companyName: sessionPayload.companyName,
              role: sessionPayload.role,
              email: sessionPayload.email,
              dbKey: sessionPayload.dbKey,
            },
            activeDbKey: sessionPayload.dbKey,
            role: sessionPayload.role,
            isVerifiedDeveloper: isDev,
            sessionToken,
            csrfToken,
            devEntryEnabled: true,
            devSandboxEnabled: true,
          },
          request,
          env,
          200,
          {
            "X-SmartCost-Node": pool,
            "Set-Cookie": buildSessionCookieHeader(sessionToken, url),
          }
        );
      }

      // 4b. Mint Signed Edge Session for Standalone PBKDF2-Verified Client Users (Never allows developer escalation)
      if (url.pathname === "/api/auth/edge-session" && request.method === "POST") {
        const body = await readJsonBodySafe(request);
        const uid = String(body.id || "").trim();
        const username = String(body.username || "").trim();
        const rawRole = String(body.role || "staf").trim().toLowerCase();
        if (!uid || !username || !VALID_CLIENT_ROLES.has(rawRole)) {
          return jsonResponse(
            { error: "Data sesi log masuk tidak sah.", code: "INVALID_EDGE_SESSION_REQUEST" },
            request,
            env,
            400,
            { "X-SmartCost-Node": pool }
          );
        }
        const safeRole = rawRole as EdgeSessionPayload["role"];
        const companyName = String(body.companyName || "SCHOOL ENTERPRISE").trim().slice(0, 128);
        const dbKey =
          String(body.dbKey || "").trim() ||
          `pengekosan_company_db_${username.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
        const nowSec = Math.floor(Date.now() / 1000);
        const csrfToken = randomTokenHex(16);
        const sessionPayload: EdgeSessionPayload = {
          sid: `edge_${randomTokenHex(8)}`,
          uid,
          username,
          fullName: String(body.fullName || username).trim().slice(0, 100),
          role: safeRole,
          companyName,
          dbKey,
          email: typeof body.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : undefined,
          isVerifiedDeveloper: false,
          csrfToken,
          iat: nowSec,
          exp: nowSec + SESSION_TTL_SEC,
        };
        const sessionToken = await signEdgeSession(sessionPayload, env);
        return jsonResponse(
          {
            success: true,
            edgeMode: true,
            user: {
              id: sessionPayload.uid,
              username: sessionPayload.username,
              fullName: sessionPayload.fullName,
              companyName: sessionPayload.companyName,
              role: sessionPayload.role,
              email: sessionPayload.email,
              dbKey: sessionPayload.dbKey,
            },
            activeDbKey: sessionPayload.dbKey,
            role: sessionPayload.role,
            isVerifiedDeveloper: false,
            sessionToken,
            csrfToken,
            devEntryEnabled: true,
            devSandboxEnabled: true,
          },
          request,
          env,
          200,
          {
            "X-SmartCost-Node": pool,
            "Set-Cookie": buildSessionCookieHeader(sessionToken, url),
          }
        );
      }

      // 4c. Standalone Edge Handoff for Manual RBAC Auth & Credential Changes
      if (
        url.pathname === "/api/auth/login-manual" ||
        url.pathname === "/api/auth/register-manual" ||
        url.pathname === "/api/auth/bootstrap-admin" ||
        url.pathname === "/api/auth/change-password" ||
        url.pathname === "/api/auth/link-manual"
      ) {
        return jsonResponse(
          {
            edgeFallback: true,
            code: "EDGE_STANDALONE_MODE",
            mode: "cloudflare_edge_standalone",
            originConfigured: false,
          },
          request,
          env,
          200,
          { "X-SmartCost-Node": pool }
        );
      }

      // 4d. Check Active Edge Session
      if (url.pathname === "/api/auth/session" && request.method === "GET") {
        const actor = await resolveEdgeActor(request, env);
        if (!actor) {
          return jsonResponse({ authenticated: false }, request, env, 401, { "X-SmartCost-Node": pool });
        }
        return jsonResponse(
          {
            authenticated: true,
            edgeMode: true,
            user: {
              id: actor.uid,
              username: actor.username,
              fullName: actor.fullName,
              companyName: actor.companyName,
              role: actor.role,
              email: actor.email,
              dbKey: actor.dbKey,
            },
            role: actor.role,
            isVerifiedDeveloper: actor.isVerifiedDeveloper,
            activeDbKey: actor.dbKey,
            csrfToken: actor.csrfToken,
          },
          request,
          env,
          200,
          { "X-SmartCost-Node": pool }
        );
      }

      // 4e. Logout
      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        return jsonResponse(
          { success: true, edgeMode: true },
          request,
          env,
          200,
          {
            "X-SmartCost-Node": pool,
            "Set-Cookie": buildSessionCookieHeader("", url, 0),
          }
        );
      }

      // 4f. Developer Entry Notice in Standalone Edge Mode
      if (url.pathname === "/api/auth/session-dev" || url.pathname === "/api/auth/reauthenticate") {
        return jsonResponse(
          {
            error:
              "Mod pengesahan Pembangun (Alt+D) memerlukan sambungan ke pelayan backend utama (ORIGIN_API_URL / VITE_API_URL) atau log masuk Google Pembangun yang disahkan.",
            code: "DEVELOPER_ORIGIN_REQUIRED",
          },
          request,
          env,
          403,
          { "X-SmartCost-Node": pool }
        );
      }

      // 4g. Edge Database Isolation Endpoints (Strict Per-Session Scope)
      if (url.pathname === "/api/databases/list" && request.method === "GET") {
        const actor = await resolveEdgeActor(request, env);
        if (!actor) {
          return jsonResponse({ error: "Sesi tidak sah." }, request, env, 401, { "X-SmartCost-Node": pool });
        }
        return jsonResponse(
          {
            databases: [
              {
                databaseId: actor.dbKey,
                companyName: actor.companyName,
                ownerId: actor.uid,
                ownerUsername: actor.username,
                isSandbox: actor.dbKey === "pengekosan_dev_sandbox_db",
                updatedAt: new Date().toISOString(),
              },
            ],
            edgeMode: true,
          },
          request,
          env,
          200,
          { "X-SmartCost-Node": pool }
        );
      }

      if (url.pathname === "/api/databases/active") {
        const actor = await resolveEdgeActor(request, env);
        if (!actor) {
          return jsonResponse({ error: "Sesi tidak sah." }, request, env, 401, { "X-SmartCost-Node": pool });
        }
        if (request.method === "POST") {
          const body = await readJsonBodySafe(request);
          const requestedDbKey = String(body.databaseId || body.dbKey || "").trim();
          const safeDbKey = requestedDbKey || actor.dbKey;
          return jsonResponse(
            { ok: true, activeDbKey: safeDbKey, edgeMode: true },
            request,
            env,
            200,
            { "X-SmartCost-Node": pool }
          );
        }
        return jsonResponse(
          { ok: true, activeDbKey: actor.dbKey, edgeMode: true },
          request,
          env,
          200,
          { "X-SmartCost-Node": pool }
        );
      }

      if (url.pathname === "/api/databases/register" && request.method === "POST") {
        const actor = await resolveEdgeActor(request, env);
        if (!actor) {
          return jsonResponse({ error: "Sesi tidak sah." }, request, env, 401, { "X-SmartCost-Node": pool });
        }
        const body = await readJsonBodySafe(request);
        return jsonResponse(
          {
            ok: true,
            databaseId: String(body.databaseId || actor.dbKey),
            companyName: String(body.companyName || actor.companyName),
            edgeMode: true,
          },
          request,
          env,
          200,
          { "X-SmartCost-Node": pool }
        );
      }

      // 4h. Telemetry & Mr. Cost History (Non-blocking Edge Ack)
      if (
        url.pathname === "/api/telemetry/firestore-ops" ||
        url.pathname === "/api/infra/firestore-telemetry"
      ) {
        return jsonResponse({ ok: true, edgeMode: true }, request, env, 200, { "X-SmartCost-Node": pool });
      }

      if (url.pathname === "/api/mrcost/history") {
        const actor = await resolveEdgeActor(request, env);
        if (!actor) {
          return jsonResponse({ error: "Sesi tidak sah." }, request, env, 401, { "X-SmartCost-Node": pool });
        }
        return jsonResponse({ ok: true, messages: [], edgeMode: true }, request, env, 200, {
          "X-SmartCost-Node": pool,
        });
      }

      // 4i. Direct Gemini AI Edge Proxy when GEMINI_API_KEY is configured in Worker Secrets
      if (url.pathname === "/api/mrcost/chat" && request.method === "POST") {
        const actor = await resolveEdgeActor(request, env);
        if (!actor) {
          return jsonResponse({ error: "Sila log masuk semula untuk menggunakan Mr. Cost AI." }, request, env, 401, {
            "X-SmartCost-Node": pool,
          });
        }
        if (!env.GEMINI_API_KEY) {
          return jsonResponse(
            {
              error:
                "Perkhidmatan Mr. Cost AI belum diaktifkan pada deployment Cloudflare ini. Sila tetapkan secret GEMINI_API_KEY atau ORIGIN_API_URL dalam tetapan Cloudflare Worker.",
              code: "AI_NOT_CONFIGURED",
            },
            request,
            env,
            503,
            { "X-SmartCost-Node": pool }
          );
        }

        const body = await readJsonBodySafe(request);
        const message = String(body.message || body.question || "").trim();
        if (!message) {
          return jsonResponse({ error: "Sila masukkan soalan analisis kos." }, request, env, 400, {
            "X-SmartCost-Node": pool,
          });
        }

        try {
          const geminiResp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
              env.GEMINI_API_KEY
            )}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                systemInstruction: {
                  parts: [
                    {
                      text: "Anda ialah Mr. Cost AI, pakar perakaunan pengurusan kos, analisis varians, margin untung, dan titik pulang modal (BEP) untuk sistem SmartCost. Jawab dengan tepat, profesional, dan ringkas dalam bahasa pengguna.",
                    },
                  ],
                },
                contents: [{ role: "user", parts: [{ text: message.slice(0, 6000) }] }],
              }),
            }
          );
          const geminiJson = (await geminiResp.json().catch(() => ({}))) as any;
          const replyText =
            geminiJson?.candidates?.[0]?.content?.parts
              ?.map((p: any) => p?.text || "")
              .join("")
              .trim() || "";
          if (!geminiResp.ok || !replyText) {
            return jsonResponse(
              { error: "Mr. Cost AI sedang sibuk. Sila cuba sebentar lagi." },
              request,
              env,
              502,
              { "X-SmartCost-Node": pool }
            );
          }
          return jsonResponse(
            { text: replyText, model: "gemini-2.5-flash", edgeMode: true },
            request,
            env,
            200,
            { "X-SmartCost-Node": pool }
          );
        } catch {
          return jsonResponse(
            { error: "Gagal menghubungi perkhidmatan AI buat sementara waktu." },
            request,
            env,
            502,
            { "X-SmartCost-Node": pool }
          );
        }
      }

      // 4j. Remaining Infra / Admin Endpoints Without Express Origin
      return jsonResponse(
        {
          error:
            "Ciri pentadbiran pelayan lanjutan ini hanya tersedia apabila pelayan backend utama (ORIGIN_API_URL / VITE_API_URL) disambungkan.",
          code: "ORIGIN_API_URL_NOT_CONFIGURED",
          endpoint: url.pathname,
          logicalPool: pool,
        },
        request,
        env,
        503,
        { "X-SmartCost-Node": pool }
      );
    }

    // 5. Serve SmartCost Frontend SPA & Static Assets from dist/
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        const outHeaders = new Headers(assetResponse.headers);
        applySecurityAndCorsHeaders(outHeaders, request, env);
        return new Response(assetResponse.body, {
          status: assetResponse.status,
          statusText: assetResponse.statusText,
          headers: outHeaders,
        });
      }

      const acceptHeader = request.headers.get("Accept") || "";
      const isFileRequest = /\.[a-z0-9]{1,8}$/i.test(url.pathname);
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        !isFileRequest &&
        (acceptHeader.includes("text/html") || url.pathname === "/")
      ) {
        const indexUrl = new URL("/index.html", url.origin);
        const indexReq = new Request(indexUrl.toString(), {
          method: request.method,
          headers: request.headers,
        });
        const indexResponse = await env.ASSETS.fetch(indexReq);
        const outHeaders = new Headers(indexResponse.headers);
        applySecurityAndCorsHeaders(outHeaders, request, env);
        return new Response(indexResponse.body, {
          status: indexResponse.status,
          statusText: indexResponse.statusText,
          headers: outHeaders,
        });
      }

      return assetResponse;
    }

    return jsonResponse(
      {
        service: "SmartCost Zero-Cost Edge Gateway",
        costTier: "RM0.00/bulan",
        frontend: "Host dist/ on Cloudflare Pages Free or bind [assets] directory = \"./dist\" in wrangler.toml",
        originConfigured: Boolean(env.ORIGIN_API_URL),
        capabilitiesUrl: "/api/edge/capabilities",
        logicalPool: pool,
      },
      request,
      env,
      200,
      { "X-SmartCost-Node": pool }
    );
  },
};
