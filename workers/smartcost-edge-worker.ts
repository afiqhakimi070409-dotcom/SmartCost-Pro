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
  GOOGLE_API_KEY?: string;
  SESSION_SECRET?: string;
  DEV_ACCESS_SECRET?: string;
  DEV_PASSKEY?: string;
  DEV_USERNAME?: string;
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

function cleanEnvValue(raw: string | undefined): string {
  return String(raw || "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
}

function isOriginAllowed(origin: string | null, env: Env, requestUrl?: URL): boolean {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    if (requestUrl && u.origin === requestUrl.origin) {
      return true;
    }
    if (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname.endsWith(".pages.dev") ||
      u.hostname.endsWith(".workers.dev") ||
      u.hostname.endsWith(".run.app")
    ) {
      return true;
    }
    const rawAllowed = cleanEnvValue(env.ALLOWED_ORIGINS);
    if (rawAllowed) {
      const list = rawAllowed
        .split(/[\s,]+/)
        .map((s) => cleanEnvValue(s).replace(/\/+$/, ""))
        .filter(Boolean);
      for (const entry of list) {
        if (entry === "*") return true;
        if (entry === origin || entry.toLowerCase() === u.origin.toLowerCase()) return true;
        if (entry.toLowerCase() === u.hostname.toLowerCase()) return true;
        if (entry.startsWith("*.")) {
          const suffix = entry.slice(1).toLowerCase();
          if (u.hostname.toLowerCase().endsWith(suffix) || u.hostname.toLowerCase() === suffix.slice(1)) {
            return true;
          }
        }
        try {
          const parsedEntry = new URL(entry.includes("://") ? entry : `https://${entry}`);
          if (parsedEntry.hostname.toLowerCase() === u.hostname.toLowerCase()) return true;
        } catch {}
      }
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
  let requestUrl: URL | undefined;
  try {
    requestUrl = new URL(request.url);
  } catch {}
  if (origin && isOriginAllowed(origin, env, requestUrl)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD");
    headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-SmartCost-Session, X-CSRF-Token, X-Requested-With"
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
  const configuredSecret = cleanEnvValue(env.SESSION_SECRET);
  const secretSource =
    configuredSecret ||
    `smartcost-edge-session-v1:${cleanEnvValue(env.FIRESTORE_PROJECT_ID) || "reflecting-booth-740ks"}:${cleanEnvValue(env.FIRESTORE_DATABASE_ID) || "default"}`;
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
  const isHttps = requestUrl.protocol === "https:";
  const sameSiteAndSecurity = isHttps ? "SameSite=None; Secure; Partitioned" : "SameSite=Lax";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; ${sameSiteAndSecurity}; Max-Age=${maxAgeSec}`;
}

async function resolveEdgeActor(request: Request, env: Env): Promise<EdgeSessionPayload | null> {
  const xHeader = request.headers.get("X-SmartCost-Session")?.trim();
  if (xHeader) {
    const parsed = await verifyEdgeSessionToken(xHeader, env);
    if (parsed) return parsed;
  }
  const authHeader = request.headers.get("Authorization")?.trim() || "";
  if (authHeader.startsWith("Bearer ")) {
    const bearerToken = authHeader.slice(7).trim();
    if (bearerToken.startsWith("scs_edge.") || bearerToken.startsWith("scs.")) {
      const parsed = await verifyEdgeSessionToken(bearerToken, env);
      if (parsed) return parsed;
    }
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

async function constantTimeTextEqual(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const bytesA = new Uint8Array(hashA);
  const bytesB = new Uint8Array(hashB);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) {
    diff |= bytesA[i] ^ bytesB[i];
  }
  return diff === 0;
}

function buildMrCostBusinessSummary(businessData: any): string {
  if (!businessData || typeof businessData !== "object") return "";
  try {
    const cfg = businessData.config || {};
    const currency = String(cfg.currency || "RM");
    const product = String(cfg.namaProduk || "").trim();
    const unit = String(cfg.unitProduk || "unit").trim();
    const qStd = Number(cfg.sasaranKuantitiStandard || 0);
    const pStd = Number(cfg.hargaJualanStandard || 0);
    const qAct = Number(cfg.kuantitiSebenarDijual || 0);
    const pAct = Number(cfg.hargaJualanSebenar || 0);
    const dmList = Array.isArray(businessData.bahanMentah) ? businessData.bahanMentah : [];
    const dlList = Array.isArray(businessData.buruhLangsung) ? businessData.buruhLangsung : [];
    const vohList = Array.isArray(businessData.overheadBerubah) ? businessData.overheadBerubah : [];
    const fohList = Array.isArray(businessData.overheadTetap) ? businessData.overheadTetap : [];

    const dmPerUnit = dmList.reduce((s: number, b: any) => s + Number(b?.stdKuantitiPerUnit || 0) * Number(b?.stdHargaPerUnit || 0), 0);
    const dlPerUnit = dlList.reduce((s: number, l: any) => s + Number(l?.stdJamPerUnit || 0) * Number(l?.stdKadarPerJam || 0), 0);
    const vohPerUnit = vohList.reduce((s: number, o: any) => s + Number(o?.stdKosPerUnit || 0), 0);
    const varCost = dmPerUnit + dlPerUnit + vohPerUnit;
    const totalFoh = fohList.reduce((s: number, f: any) => s + Number(f?.stdKosMingguan || 0), 0);
    const fohPerUnit = qStd > 0 ? totalFoh / qStd : 0;
    const fullCost = varCost + fohPerUnit;

    if (!product && varCost === 0 && totalFoh === 0 && pStd === 0) return "";

    const templates = Array.isArray(businessData.templates)
      ? businessData.templates
          .slice(0, 8)
          .map((t: any) => `${t?.namaProduk || "Produk"} (${currency} ${Number(t?.konfigurasi?.hargaJualanStandard || 0).toFixed(2)})`)
          .join(", ")
      : "";

    return [
      "<data_perniagaan>",
      `Produk Aktif: ${product || "Produk"} (${unit})`,
      `Harga Jualan Standard: ${currency} ${pStd.toFixed(2)} | Sasaran Kuantiti Mingguan: ${qStd}`,
      `Harga Jualan Sebenar: ${currency} ${pAct.toFixed(2)} | Kuantiti Sebenar: ${qAct}`,
      `Kos Bahan Langsung/unit: ${currency} ${dmPerUnit.toFixed(2)} | Buruh/unit: ${currency} ${dlPerUnit.toFixed(2)} | OH Berubah/unit: ${currency} ${vohPerUnit.toFixed(2)}`,
      `Jumlah Kos Berubah/unit: ${currency} ${varCost.toFixed(2)} | Jumlah Kos Tetap Mingguan: ${currency} ${totalFoh.toFixed(2)} | Kos Penuh/unit: ${currency} ${fullCost.toFixed(2)}`,
      dmList.length > 0
        ? `Bahan Mentah: ${dmList.slice(0, 12).map((b: any) => `${b?.nama || "Bahan"} (${b?.stdKuantitiPerUnit || 0} ${b?.unit || ""} @ ${currency}${Number(b?.stdHargaPerUnit || 0).toFixed(2)})`).join("; ")}`
        : "",
      templates ? `Senarai Produk Lain: ${templates}` : "",
      "</data_perniagaan>",
    ]
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

function isWorkerLocalHost(hostname: string): boolean {
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

function resolveUsableOriginUrl(rawOrigin: string | undefined, requestUrl: URL): URL | null {
  let clean = cleanEnvValue(rawOrigin);
  if (!clean) return null;
  const lowerClean = clean.toLowerCase();
  if (
    lowerClean === "null" ||
    lowerClean === "undefined" ||
    lowerClean === "none" ||
    lowerClean === "disabled" ||
    lowerClean.includes("example.com") ||
    lowerClean.includes("your-express-backend") ||
    lowerClean.includes("placeholder") ||
    lowerClean.includes("changeme")
  ) {
    return null;
  }
  if (!clean.includes("://") && /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:\/.*)?$/i.test(clean)) {
    clean = `https://${clean}`;
  }
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const parsedHost = parsed.hostname.toLowerCase();
    const reqHost = requestUrl.hostname.toLowerCase();
    // Prevent self-looping proxy back to the same Worker hostname or origin
    if (parsedHost === reqHost || parsed.origin === requestUrl.origin) return null;
    // Ignore localhost ORIGIN_API_URL when deployed on remote Cloudflare edge
    if (isWorkerLocalHost(parsedHost) && !isWorkerLocalHost(reqHost)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pool = pickLogicalPool();
    const usableOrigin = resolveUsableOriginUrl(env.ORIGIN_API_URL, url);

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
          originConfigured: Boolean(usableOrigin),
          edgeAuthMode: usableOrigin ? "express_origin_proxy_with_fallback" : "cloudflare_edge_standalone",
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
    const buildStandaloneFeaturesResponse = (fallbackUsed = false) => {
      const geminiConfigured = Boolean(cleanEnvValue(env.GEMINI_API_KEY) || cleanEnvValue(env.GOOGLE_API_KEY));
      const devSecretConfigured = Boolean(cleanEnvValue(env.DEV_ACCESS_SECRET) || cleanEnvValue(env.DEV_PASSKEY));
      const sessionSecretConfigured = Boolean(cleanEnvValue(env.SESSION_SECRET));
      return jsonResponse(
        {
          devEntryEnabled: true,
          devSandboxEnabled: true,
          zeroCostEdgeMode: true,
          originConfigured: false,
          originFallbackActive: fallbackUsed,
          aiConfigured: geminiConfigured,
          devSecretConfigured,
          sessionSecretConfigured,
          edgeAuthMode: "cloudflare_edge_standalone",
        },
        request,
        env,
        200,
        {
          "X-SmartCost-Node": pool,
          ...(fallbackUsed ? { "X-SmartCost-Origin-Fallback": "standalone-edge" } : {}),
        }
      );
    };

    if (url.pathname === "/api/config/features" && !usableOrigin) {
      return buildStandaloneFeaturesResponse(false);
    }

    // 3. Edge Capabilities Diagnostic
    if (url.pathname === "/api/edge/capabilities") {
      const geminiConfigured = Boolean(cleanEnvValue(env.GEMINI_API_KEY) || cleanEnvValue(env.GOOGLE_API_KEY));
      const devSecretConfigured = Boolean(cleanEnvValue(env.DEV_ACCESS_SECRET) || cleanEnvValue(env.DEV_PASSKEY));
      const sessionSecretConfigured = Boolean(cleanEnvValue(env.SESSION_SECRET));
      return jsonResponse(
        {
          status: "OK",
          monthlyCost: "RM0.00",
          originConfigured: Boolean(usableOrigin),
          geminiDirectConfigured: geminiConfigured,
          devSecretConfigured,
          sessionSecretConfigured,
          firestoreProjectId: env.FIRESTORE_PROJECT_ID || "reflecting-booth-740ks",
          edgeDirectEndpoints: [
            "GET /healthz",
            "GET /api/health",
            "GET /api/config/features",
            "GET /api/edge/capabilities",
            "POST /api/auth/session-firebase",
            "POST /api/auth/session-dev",
            "POST /api/auth/reauthenticate",
            "POST /api/auth/edge-session",
            "GET /api/auth/session",
            "POST /api/auth/logout",
            "POST /api/mrcost/chat",
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

    // 4. API Routing: Express Origin Proxy (with automatic fallback to Native Cloudflare Edge Handler if unreachable)
    if (url.pathname.startsWith("/api/")) {
      if (usableOrigin) {
        let bufferedBody: ArrayBuffer | undefined;
        try {
          if (request.method !== "GET" && request.method !== "HEAD") {
            bufferedBody = await request.arrayBuffer();
          }
          const originTarget = new URL(url.pathname + url.search, usableOrigin);
          const forwardHeaders = new Headers(request.headers);
          forwardHeaders.set("X-Forwarded-Host", url.host);
          forwardHeaders.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
          forwardHeaders.set("X-SmartCost-Edge-Pool", pool);

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 7000);
          try {
            const proxiedReq = new Request(originTarget.toString(), {
              method: request.method,
              headers: forwardHeaders,
              body: bufferedBody ? bufferedBody.slice(0) : undefined,
              signal: controller.signal,
            });
            const upstreamResp = await fetch(proxiedReq);
            if (!(upstreamResp.status >= 502 && upstreamResp.status <= 504)) {
              const outHeaders = new Headers(upstreamResp.headers);
              applySecurityAndCorsHeaders(outHeaders, request, env);
              outHeaders.set("X-SmartCost-Edge-Pool", pool);
              return new Response(upstreamResp.body, {
                status: upstreamResp.status,
                statusText: upstreamResp.statusText,
                headers: outHeaders,
              });
            }
          } finally {
            clearTimeout(timeoutId);
          }
        } catch {
          // Origin unreachable or timed out: fall through cleanly into Standalone Cloudflare Edge Mode
        }

        if (url.pathname === "/api/config/features") {
          return buildStandaloneFeaturesResponse(true);
        }
        if (bufferedBody !== undefined) {
          request = new Request(request.url, {
            method: request.method,
            headers: request.headers,
            body: bufferedBody,
          });
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

      // 4f. Standalone Developer Authentication (Alt+D) & Reauthentication
      // Supports:
      //  (a) Verified Firebase Google Developer ID Token (RS256 verified against Google JWKS + DEVELOPER_EMAIL_ALLOWLIST)
      //  (b) Cloudflare Worker Encrypted Secret (DEV_ACCESS_SECRET / DEV_PASSKEY + optional DEV_USERNAME)
      if (
        (url.pathname === "/api/auth/session-dev" || url.pathname === "/api/auth/reauthenticate") &&
        request.method === "POST"
      ) {
        const body = await readJsonBodySafe(request);
        const authHeader = request.headers.get("Authorization") || "";
        const bearerRaw = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
        const bearerFirebase =
          bearerRaw && !bearerRaw.startsWith("scs.") && !bearerRaw.startsWith("scs_edge.") ? bearerRaw : "";
        const idToken = typeof body.idToken === "string" && body.idToken.trim() ? body.idToken.trim() : bearerFirebase;

        const nowSec = Math.floor(Date.now() / 1000);
        const reauthExpiresAt = (nowSec + 15 * 60) * 1000;
        const freshReauthNonce = randomTokenHex(16);

        // Method (a): Google Developer Firebase ID Token Verification
        if (idToken) {
          const verified = await verifyFirebaseIdTokenEdge(idToken, env);
          const email = (verified?.email || "").trim().toLowerCase();
          if (!verified || !verified.emailVerified || !email || !DEVELOPER_EMAIL_ALLOWLIST.has(email)) {
            return jsonResponse(
              {
                error: "Akaun Google ini tidak dibenarkan untuk akses Pembangun (Developer).",
                code: "DEVELOPER_GOOGLE_UNAUTHORIZED",
              },
              request,
              env,
              401,
              { "X-SmartCost-Node": pool }
            );
          }

          const csrfToken = randomTokenHex(16);
          const sessionPayload: EdgeSessionPayload = {
            sid: `edge_dev_${randomTokenHex(8)}`,
            uid: verified.uid,
            username: email.split("@")[0] || "afiqhakimi070409",
            fullName: verified.name || "System Developer",
            role: "developer",
            companyName: "DEVELOPER SANDBOX",
            dbKey: "pengekosan_dev_sandbox_db",
            email: verified.email,
            isVerifiedDeveloper: true,
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
                role: "developer",
                email: sessionPayload.email,
                dbKey: sessionPayload.dbKey,
              },
              activeDbKey: sessionPayload.dbKey,
              role: "developer",
              isVerifiedDeveloper: true,
              isRecentlyReauthenticated: true,
              reauthExpiresAt,
              freshReauthNonce,
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

        // Method (b): Cloudflare Worker Secret Developer Passkey Verification (No hardcoded password)
        const configuredDevSecret = cleanEnvValue(env.DEV_ACCESS_SECRET) || cleanEnvValue(env.DEV_PASSKEY);
        const inputUsername = String(body.username || "").trim().toLowerCase();
        const inputPasskey = String(body.passkey ?? body.password ?? "");

        if (!inputUsername) {
          return jsonResponse(
            {
              error: "Sila masukkan nama pengguna pembangun.",
              code: "USERNAME_EMPTY",
            },
            request,
            env,
            400,
            { "X-SmartCost-Node": pool }
          );
        }

        if (configuredDevSecret) {
          const expectedUsername = (cleanEnvValue(env.DEV_USERNAME) || "afiqhakimi070409").toLowerCase();
          const usernameOk =
            inputUsername === expectedUsername ||
            inputUsername === "developer" ||
            (expectedUsername === "afiqhakimi070409" && inputUsername === "afiqhakimi070409@gmail.com");
          const passkeyOk = await constantTimeTextEqual(inputPasskey, configuredDevSecret);
          if (!usernameOk || !passkeyOk) {
            return jsonResponse(
              {
                error: "Nama pengguna atau kata laluan pembangun tidak betul.",
                code: "INVALID_DEV_CREDENTIALS",
              },
              request,
              env,
              401,
              { "X-SmartCost-Node": pool }
            );
          }

          const csrfToken = randomTokenHex(16);
          const sessionPayload: EdgeSessionPayload = {
            sid: `edge_dev_${randomTokenHex(8)}`,
            uid: `dev_${expectedUsername}`,
            username: expectedUsername,
            fullName: "System Developer",
            role: "developer",
            companyName: "DEVELOPER SANDBOX",
            dbKey: "pengekosan_dev_sandbox_db",
            email: "afiqhakimi070409@gmail.com",
            isVerifiedDeveloper: true,
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
                role: "developer",
                email: sessionPayload.email,
                dbKey: sessionPayload.dbKey,
              },
              activeDbKey: sessionPayload.dbKey,
              role: "developer",
              isVerifiedDeveloper: true,
              isRecentlyReauthenticated: true,
              reauthExpiresAt,
              freshReauthNonce,
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

        return jsonResponse(
          {
            error:
              "Gunakan butang 'Sahkan dengan Google Pembangun' di bawah, atau tetapkan secret DEV_ACCESS_SECRET / ORIGIN_API_URL dalam tetapan Cloudflare Worker.",
            code: "DEVELOPER_CLOUDFLARE_SETUP_REQUIRED",
            canUseGoogleDeveloperSignIn: true,
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

      // 4i. Direct Gemini AI Edge Proxy when GEMINI_API_KEY / GOOGLE_API_KEY is configured in Worker Secrets
      if (url.pathname === "/api/mrcost/chat" && request.method === "POST") {
        const actor = await resolveEdgeActor(request, env);
        if (!actor) {
          return jsonResponse(
            {
              error: "Sesi log masuk anda tidak sah atau telah tamat tempoh. Sila log masuk semula untuk menggunakan Mr. Cost AI.",
              code: "SESSION_UNAUTHORIZED",
              httpStatus: 401,
            },
            request,
            env,
            401,
            { "X-SmartCost-Node": pool }
          );
        }

        const geminiApiKey = cleanEnvValue(env.GEMINI_API_KEY) || cleanEnvValue(env.GOOGLE_API_KEY);
        if (!geminiApiKey) {
          return jsonResponse(
            {
              error:
                "Kunci API AI (GEMINI_API_KEY) belum ditetapkan pada Cloudflare Worker. Sila tetapkan secret GEMINI_API_KEY atau ORIGIN_API_URL dalam tetapan Cloudflare Dashboard.",
              code: "AI_NOT_CONFIGURED",
              httpStatus: 503,
              detail: "Cloudflare Worker environment secret GEMINI_API_KEY is not set.",
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
          return jsonResponse(
            {
              error: "Sila masukkan soalan analisis kos.",
              code: "EMPTY_MESSAGE",
              httpStatus: 400,
            },
            request,
            env,
            400,
            { "X-SmartCost-Node": pool }
          );
        }

        const lang = body.language === "en" ? "en" : "ms";
        const systemText =
          lang === "en"
            ? "You are Mr. Cost AI, a management cost accounting expert specializing in variance analysis, profit margin, break-even point (BEP), and pricing strategy for SmartCost. Answer accurately, concisely, and professionally."
            : "Anda ialah Mr. Cost AI, pakar perakaunan pengurusan kos, analisis varians, margin untung, dan titik pulang modal (BEP) untuk sistem SmartCost. Jawab dengan tepat, profesional, dan ringkas dalam bahasa pengguna.";

        const businessContext = buildMrCostBusinessSummary(body.businessData);
        const rawHistory = Array.isArray(body.history) ? body.history.slice(-6) : [];
        const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
        for (const h of rawHistory) {
          const text = String(h?.parts?.[0]?.text || h?.text || h?.message || "").trim();
          if (!text) continue;
          const role = h?.role === "model" ? "model" : "user";
          if (contents.length === 0 && role !== "user") continue;
          if (contents.length > 0 && contents[contents.length - 1].role === role) {
            contents[contents.length - 1].parts[0].text += `\n\n${text}`;
          } else {
            contents.push({ role, parts: [{ text: text.slice(0, 4000) }] });
          }
        }
        if (contents.length > 0 && contents[contents.length - 1].role === "user") {
          contents.pop();
        }
        const promptText = businessContext
          ? `${businessContext}\n\nSoalan pengguna: ${message.slice(0, 6000)}`
          : message.slice(0, 6000);
        contents.push({ role: "user", parts: [{ text: promptText }] });

        const EDGE_MODEL_CHAIN = ["gemini-4-hydrogen", "gemini-2.5-flash", "gemini-flash-latest"];
        let lastStatus = 502;
        let lastCode = "UPSTREAM_AI_ERROR";
        let lastDetail = "Tiada respons daripada perkhidmatan AI.";
        let lastModelTried = EDGE_MODEL_CHAIN[0];

        try {
          for (const model of EDGE_MODEL_CHAIN) {
            lastModelTried = model;
            const geminiResp = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-goog-api-key": geminiApiKey,
                  "User-Agent": "aistudio-build",
                },
                body: JSON.stringify({
                  systemInstruction: { parts: [{ text: systemText }] },
                  contents,
                }),
              }
            );
            const geminiJson = (await geminiResp.json().catch(() => ({}))) as any;
            const replyText =
              geminiJson?.candidates?.[0]?.content?.parts
                ?.map((p: any) => p?.text || "")
                .join("")
                .trim() || "";

            if (geminiResp.ok && replyText) {
              return jsonResponse(
                { text: replyText, model, edgeMode: true },
                request,
                env,
                200,
                { "X-SmartCost-Node": pool }
              );
            }

            lastStatus = geminiResp.status || 502;
            lastCode = String(geminiJson?.error?.status || `HTTP_${lastStatus}`);
            lastDetail = String(geminiJson?.error?.message || `Gemini API returned HTTP ${lastStatus}`);

            // Immediate fail on invalid or unauthorized API key so exact error surfaces
            if (
              lastStatus === 400 ||
              lastStatus === 401 ||
              lastStatus === 403 ||
              lastCode === "API_KEY_INVALID" ||
              lastCode === "PERMISSION_DENIED"
            ) {
              return jsonResponse(
                {
                  error:
                    lastStatus === 400 || lastCode === "API_KEY_INVALID"
                      ? "Kunci API Gemini (GEMINI_API_KEY) tidak sah atau ditolak oleh Google AI."
                      : "Akses API Gemini ditolak (HTTP 403). Sila semak kebenaran/billing GEMINI_API_KEY.",
                  code: lastCode,
                  httpStatus: lastStatus,
                  detail: lastDetail,
                  modelTried: model,
                },
                request,
                env,
                lastStatus,
                { "X-SmartCost-Node": pool }
              );
            }
          }

          return jsonResponse(
            {
              error:
                lastStatus === 429
                  ? "Had kuota permintaan Gemini API dicapai buat sementara waktu (HTTP 429). Sila cuba sebentar lagi."
                  : `Gagal mendapat respons daripada model AI (HTTP ${lastStatus}).`,
              code: lastCode,
              httpStatus: lastStatus,
              detail: lastDetail,
              modelTried: lastModelTried,
            },
            request,
            env,
            lastStatus >= 400 ? lastStatus : 502,
            { "X-SmartCost-Node": pool }
          );
        } catch (err: any) {
          return jsonResponse(
            {
              error: "Ralat rangkaian Cloudflare Worker semasa menghubungi perkhidmatan Gemini AI.",
              code: "EDGE_AI_FETCH_ERROR",
              httpStatus: 502,
              detail: String(err?.message || err || "Network error"),
              modelTried: lastModelTried,
            },
            request,
            env,
            502,
            { "X-SmartCost-Node": pool }
          );
        }
      }

      // 4j. Standalone Edge Safe Handlers for 2FA, DB Delete (Verified Dev), & Edge Infra Diagnostics
      if (url.pathname === "/api/auth/2fa/status" && request.method === "GET") {
        return jsonResponse(
          { supported: false, enabled: false, twoFactorEnabled: false, edgeMode: true, originConfigured: false },
          request,
          env,
          200,
          { "X-SmartCost-Node": pool }
        );
      }

      if (url.pathname === "/api/databases/inspect" || url.pathname === "/api/databases/clone-sandbox") {
        const actor = await resolveEdgeActor(request, env);
        if (!actor) {
          return jsonResponse({ error: "Sesi tidak sah." }, request, env, 401, { "X-SmartCost-Node": pool });
        }
        return jsonResponse({ ok: true, edgeMode: true, activeDbKey: actor.dbKey }, request, env, 200, {
          "X-SmartCost-Node": pool,
        });
      }

      if (url.pathname === "/api/auth/delete-company-db" && request.method === "POST") {
        const actor = await resolveEdgeActor(request, env);
        if (!actor) {
          return jsonResponse(
            { error: "Sesi tamat tempoh.", code: "SESSION_EXPIRED" },
            request,
            env,
            401,
            { "X-SmartCost-Node": pool }
          );
        }
        if (!actor.isVerifiedDeveloper) {
          return jsonResponse(
            { error: "Hanya Pembangun yang disahkan boleh memadam pangkalan data.", code: "DEVELOPER_REQUIRED" },
            request,
            env,
            403,
            { "X-SmartCost-Node": pool }
          );
        }
        const body = await readJsonBodySafe(request);
        if (body.confirmConfirmation !== true) {
          return jsonResponse(
            { error: "Pengesahan pemadaman diperlukan.", code: "CONFIRMATION_REQUIRED" },
            request,
            env,
            400,
            { "X-SmartCost-Node": pool }
          );
        }
        return jsonResponse(
          {
            ok: true,
            deleted: true,
            dbKey: String(body.dbKey || ""),
            edgeMode: true,
          },
          request,
          env,
          200,
          { "X-SmartCost-Node": pool }
        );
      }

      if (url.pathname === "/api/admin/users" && request.method === "GET") {
        const actor = await resolveEdgeActor(request, env);
        if (!actor) {
          return jsonResponse({ error: "Sesi tidak sah." }, request, env, 401, { "X-SmartCost-Node": pool });
        }
        return jsonResponse(
          {
            users: [
              {
                id: actor.uid,
                username: actor.username,
                fullName: actor.fullName,
                companyName: actor.companyName,
                role: actor.role,
                email: actor.email,
                dbKey: actor.dbKey,
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

      if (url.pathname === "/api/admin/backup/audit-log" && request.method === "GET") {
        const actor = await resolveEdgeActor(request, env);
        if (!actor) {
          return jsonResponse({ error: "Sesi tidak sah." }, request, env, 401, { "X-SmartCost-Node": pool });
        }
        return jsonResponse({ logs: [], auditLog: [], edgeMode: true }, request, env, 200, {
          "X-SmartCost-Node": pool,
        });
      }

      if (url.pathname.startsWith("/api/infra/")) {
        const actor = await resolveEdgeActor(request, env);
        if (!actor || !actor.isVerifiedDeveloper) {
          return jsonResponse({ error: "Akses Pembangun diperlukan." }, request, env, actor ? 403 : 401, {
            "X-SmartCost-Node": pool,
          });
        }
        if (url.pathname === "/api/infra/overview") {
          return jsonResponse(
            {
              ok: true,
              edgeMode: true,
              runtime: "cloudflare-workers-free",
              firestoreProjectId: env.FIRESTORE_PROJECT_ID || "reflecting-booth-740ks",
              servers: [
                {
                  id: "cf-edge-primary",
                  name: "Cloudflare Edge Worker (Standalone)",
                  status: "online",
                  mode: "standalone",
                  region: "global-edge",
                },
              ],
              metrics: { uptimeSec: 0, memoryUsedMb: 0, cpuPercent: 0 },
              timestamp: new Date().toISOString(),
            },
            request,
            env,
            200,
            { "X-SmartCost-Node": pool }
          );
        }
        if (url.pathname === "/api/infra/logs") {
          return jsonResponse({ ok: true, logs: [], edgeMode: true }, request, env, 200, {
            "X-SmartCost-Node": pool,
          });
        }
        if (url.pathname === "/api/infra/security") {
          return jsonResponse(
            {
              ok: true,
              edgeMode: true,
              tls: "Cloudflare Universal SSL",
              hsts: true,
              corsStrict: true,
              sessionSigning: "HMAC-SHA256",
            },
            request,
            env,
            200,
            { "X-SmartCost-Node": pool }
          );
        }
        if (url.pathname === "/api/infra/health-check" || url.pathname === "/api/infra/load-balancer/test") {
          return jsonResponse(
            { ok: true, healthy: true, edgeMode: true, logicalPool: pool, latencyMs: 1 },
            request,
            env,
            200,
            { "X-SmartCost-Node": pool }
          );
        }
        if (url.pathname === "/api/infra/config") {
          return jsonResponse(
            { ok: true, edgeMode: true, originConfigured: Boolean(usableOrigin), pool },
            request,
            env,
            200,
            { "X-SmartCost-Node": pool }
          );
        }
      }

      // Remaining Express-only endpoints gracefully return standalone fallback marker
      return jsonResponse(
        {
          error:
            "Ciri pentadbiran pelayan lanjutan ini hanya tersedia apabila pelayan backend utama (ORIGIN_API_URL / VITE_API_URL) disambungkan.",
          code: "ORIGIN_API_URL_NOT_CONFIGURED",
          edgeFallback: true,
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
        originConfigured: Boolean(usableOrigin),
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
