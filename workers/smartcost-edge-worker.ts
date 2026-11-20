/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SmartCost Zero-Cost Edge Worker (Cloudflare Workers Free Tier — RM0.00/month)
 * - Runs on 1 serverless V8 Worker platform (100,000 free requests/day, 10 ms CPU/request).
 * - Handles stateless edge endpoints (/healthz, /api/health, /api/config/features, /api/edge/capabilities),
 *   safe CORS preflight for Cloudflare Pages (*.pages.dev), security headers, logical routing tags,
 *   and transparent origin forwarding (ORIGIN_API_URL) for stateful Express APIs & Gemini AI proxy.
 * - Never returns an unexplained bare 501: every unrouted stateful endpoint reports its category
 *   and operational setup alternative cleanly.
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
}

const LOGICAL_POOLS = ["server-a", "server-b", "server-c"] as const;
let logicalCursor = 0;

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

interface EndpointClassification {
  category:
    | "user_session_required"
    | "gemini_ai_proxy_required"
    | "stateful_database_required"
    | "express_origin_required";
  reason: string;
  alternative: string;
}

function classifyApiRoute(pathname: string): EndpointClassification {
  if (pathname.startsWith("/api/mrcost/chat")) {
    return {
      category: "gemini_ai_proxy_required",
      reason:
        "Mr Cost AI memerlukan pengesahan sesi, tapisan privasi data syarikat, sejarah perbualan, dan kunci rahsia GEMINI_API_KEY di sebelah pelayan.",
      alternative:
        "Tetapkan ORIGIN_API_URL (melalui `wrangler secret put ORIGIN_API_URL`) menghala ke Express origin yang memegang GEMINI_API_KEY. Semua ciri SmartCost lain (Firebase Auth, Firestore & pengiraan kos) kekal berjalan di Cloudflare Pages.",
    };
  }
  if (pathname.startsWith("/api/auth/")) {
    return {
      category: "user_session_required",
      reason:
        "Log masuk manual & penukaran kata laluan menggunakan bcryptjs (cost-12, >100 ms CPU melebihi bajet 10 ms Workers Free) dan sesi bertandatangan HMAC (server_sessions.json).",
      alternative:
        "1) Sambungkan ORIGIN_API_URL ke Express origin untuk menyokong log masuk manual + sesi HMAC penuh, ATAU 2) Gunakan Google Sign-In (Firebase Authentication) secara terus dari Cloudflare Pages tanpa memerlukan ORIGIN_API_URL.",
    };
  }
  if (
    pathname.startsWith("/api/databases/") ||
    pathname.startsWith("/api/admin/") ||
    pathname.startsWith("/api/mrcost/history")
  ) {
    return {
      category: "stateful_database_required",
      reason:
        "Laluan ini mengurus pendaftaran syarikat, matriks akses pengguna, sandaran JSON, dan sejarah Mr Cost pada storan stateful Express (data/*.json) untuk mengekalkan pengasingan RBAC.",
      alternative:
        "Sambungkan ORIGIN_API_URL ke pelayan Express asal supaya semua rekod syarikat dan sandaran kekal selamat. Data Firestore Enterprise (reflecting-booth-740ks) kekal boleh diakses terus oleh klien sah melalui Firebase SDK.",
    };
  }
  return {
    category: "express_origin_required",
    reason:
      "Endpoint telemetri/infrastruktur/sandaran pelayan memerlukan akses sistem fail Node.js dan runtime loopback Express.",
    alternative:
      "Tetapkan ORIGIN_API_URL melalui `wrangler secret put ORIGIN_API_URL` untuk menyambungkan Gateway Worker ini ke pelayan Express asal anda.",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pool = pickLogicalPool();

    // 0. CORS Preflight for split Cloudflare Pages (*.pages.dev) -> Workers (*.workers.dev)
    if (request.method === "OPTIONS") {
      const headers = new Headers();
      applySecurityAndCorsHeaders(headers, request, env);
      return new Response(null, { status: 204, headers });
    }

    // 1. Edge Health Probes (<1 ms CPU time, zero origin cost)
    if (url.pathname === "/healthz" || url.pathname === "/api/health") {
      return jsonResponse(
        {
          status: url.pathname === "/healthz" ? "OK" : "ok",
          runtime: "cloudflare-workers-free",
          monthlyBudget: "RM0.00",
          logicalPool: pool,
          originConfigured: Boolean(env.ORIGIN_API_URL),
          note: "Single auto-scaling serverless Worker (logical pool routing only).",
          firestoreProjectId: env.FIRESTORE_PROJECT_ID || "reflecting-booth-740ks",
          timestamp: new Date().toISOString(),
        },
        request,
        env,
        200,
        { "X-SmartCost-Node": pool }
      );
    }

    // 2. Non-secret Feature Flags at Edge
    if (url.pathname === "/api/config/features" && !env.ORIGIN_API_URL) {
      return jsonResponse(
        {
          devEntryEnabled: true,
          devSandboxEnabled: true,
          zeroCostEdgeMode: true,
          originConfigured: false,
        },
        request,
        env,
        200,
        { "X-SmartCost-Node": pool }
      );
    }

    // 3. Edge Compatibility Matrix Diagnostic (Zero secrets exposed)
    if (url.pathname === "/api/edge/capabilities") {
      return jsonResponse(
        {
          status: "OK",
          monthlyCost: "RM0.00",
          originConfigured: Boolean(env.ORIGIN_API_URL),
          firestoreProjectId: env.FIRESTORE_PROJECT_ID || "reflecting-booth-740ks",
          edgeDirectEndpoints: [
            "GET /healthz",
            "GET /api/health",
            "GET /api/config/features",
            "GET /api/edge/capabilities",
          ],
          proxiedWhenOriginConfigured: [
            "/api/auth/*",
            "/api/databases/*",
            "/api/admin/*",
            "/api/mrcost/*",
            "/api/infra/*",
            "/api/telemetry/*",
          ],
          clientDirectFirebaseServices: [
            "Firebase Authentication (Google Sign-In)",
            "Firebase Firestore Enterprise (Company DB & Products)",
          ],
        },
        request,
        env,
        200,
        { "X-SmartCost-Node": pool }
      );
    }

    // 4. Forward Stateful API Routes (Auth, RBAC, Backup, Infra, Gemini AI) to Express Origin
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
              error: "Origin API tidak dapat dicapai buat sementara waktu.",
              code: "ORIGIN_UNREACHABLE",
              logicalPool: pool,
              operationalAlternative:
                "Semak status pelayan Express asal (ORIGIN_API_URL). Pengiraan kos & sesi Firestore sedia ada di klien tidak terjejas.",
            },
            request,
            env,
            502,
            { "X-SmartCost-Node": pool }
          );
        }
      }

      // Structured explanation & operational alternatives when Express origin isn't bound
      const info = classifyApiRoute(url.pathname);
      return jsonResponse(
        {
          error: "Perkhidmatan origin Express diperlukan untuk laluan API ini.",
          code: "ORIGIN_API_URL_NOT_CONFIGURED",
          endpoint: url.pathname,
          endpointCategory: info.category,
          reason: info.reason,
          operationalAlternative: info.alternative,
          logicalPool: pool,
          zeroCostTier: "RM0.00-Free-Tier",
        },
        request,
        env,
        503,
        { "X-SmartCost-Node": pool }
      );
    }

    // 5. Serve SmartCost Frontend SPA & Static Assets from dist/ via Cloudflare Workers Assets binding
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

    // Fallback when Worker is deployed standalone without [assets] binding
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
