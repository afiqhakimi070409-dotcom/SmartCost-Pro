/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import http from "http";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { DATA_DIR, DIST_DIR, PROJECT_ROOT } from "./src/serverPaths.ts";
import {
  generateBackupFileName,
  sanitizeConfigForBackup,
  validateBackupContent,
  executeTemplatesImport,
} from "./src/utils/adminBackup.ts";
import { getMrCostSystemInstruction } from "./src/utils/diplomaReferenceNotes.ts";
import {
  auditDataPerniagaan,
  calculateUsageCostFromPurchase,
  kiraKosSeunit,
  kiraHargaDariSasaranMargin,
  kiraKenaikanKos,
  kenalPastiPeluangPenjimatan,
  areUnitsCompatible,
} from "./src/utils/mrcostEngine.ts";
import {
  hashDatabaseIdShort,
  classifyMrCostQuestion,
  buildSafeBusinessContextBlock,
  validateMrCostOutput,
  stripSensitiveBusinessData,
  DATABASE_ACCESS_DENIED_MESSAGE,
  OUTPUT_BOUNDARY_REPLACEMENT_TEXT,
} from "./src/utils/mrCostPrivacy.ts";
import {
  hasPrototypePollutionKey,
  sanitizePlainText,
  containsSuspiciousScriptOrHtml,
  validateLogoDataUrl,
  validateManualRegisterInput,
  sanitizeBackupContentPayload,
  verifyCostingSummaryOnServer,
} from "./src/serverValidation.ts";

/**
 * Helper to determine thinking configuration for a model.
 * - Gemini 3 (Flash, Flash-Lite or Pro): { thinkingLevel: ThinkingLevel.LOW }
 * - Gemini 2.5 Flash atau Flash-Lite: { thinkingBudget: 0 }
 * - Alias seperti "gemini-flash-latest", "gemini-flash-lite-latest": { thinkingLevel: ThinkingLevel.LOW }
 * - Model lain / tidak dikenali / Pro 2.5: tiada thinkingConfig (undefined)
 * JANGAN hantar thinkingLevel dan thinkingBudget serentak dalam satu permintaan.
 */
export function getThinkingConfig(modelName: string): { thinkingLevel: ThinkingLevel } | { thinkingBudget: number } | undefined {
  if (!modelName) {
    return undefined;
  }
  const name = modelName.toLowerCase();

  // Model Gemini 3 (Flash, Flash-Lite atau Pro): thinkingLevel "low"
  if (name.includes("gemini-3") || name.includes("3.8") || name.includes("3.1") || name.includes("gemini-4")) {
    return { thinkingLevel: ThinkingLevel.LOW };
  }

  // Model Gemini 2.5 Flash atau Flash-Lite: thinkingBudget 0 (kecuali 2.5 Pro)
  if (name.includes("2.5") && (name.includes("flash") || name.includes("lite")) && !name.includes("pro")) {
    return { thinkingBudget: 0 };
  }

  // Alias seperti "gemini-flash-latest", "gemini-flash-lite-latest": thinkingLevel "low"
  if (name.endsWith("-latest") || name.includes("flash-latest") || name.includes("lite-latest")) {
    return { thinkingLevel: ThinkingLevel.LOW };
  }

  // Model lain / tidak dikenali / Pro 2.5: tiada thinkingConfig
  return undefined;
}

/**
 * Detects if an API error is a 404 NOT_FOUND error (e.g. deprecated or unavailable model).
 */
export function isNotFoundError(err: any): boolean {
  if (!err) return false;
  const msg = (
    typeof err === "string"
      ? err
      : `${err.message || ""} ${err.status || ""} ${err.code || ""} ${JSON.stringify(err || {})}`
  ).toLowerCase();

  return (
    msg.includes("404") ||
    msg.includes("not_found") ||
    msg.includes("not found") ||
    msg.includes("no longer available")
  );
}

/**
 * Detects if an API error is a 400 INVALID_ARGUMENT error mentioning thinking configuration.
 */
export function isThinkingError(err: any): boolean {
  if (!err) return false;
  const msg = (
    typeof err === "string"
      ? err
      : `${err.message || ""} ${err.status || ""} ${err.code || ""} ${JSON.stringify(err || {})}`
  ).toLowerCase();

  const is400 = msg.includes("400") || msg.includes("invalid_argument") || msg.includes("bad request");
  const mentionsThinking = msg.includes("thinking");
  return is400 && mentionsThinking;
}

/**
 * Detects if an API error is a 503 (Unavailable) or 429 (Resource Exhausted/Rate Limit) error.
 */
export function isRateLimitOrUnavailable(err: any): boolean {
  if (!err) return false;
  const msg = (
    typeof err === "string"
      ? err
      : `${err.message || ""} ${err.status || ""} ${err.code || ""} ${JSON.stringify(err || {})}`
  ).toLowerCase();

  return (
    msg.includes("503") ||
    msg.includes("429") ||
    msg.includes("unavailable") ||
    msg.includes("resource_exhausted") ||
    msg.includes("rate limit") ||
    msg.includes("overloaded") ||
    msg.includes("high demand")
  );
}

export class MissingApiKeyError extends Error {
  constructor() {
    super("kunci API tiada");
    this.name = "MissingApiKeyError";
  }
}

// In-memory cache untuk soalan pertama tanpa sejarah (TTL 24 jam, maks 200 entri)
export const FIRST_QUESTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const FIRST_QUESTION_CACHE_MAX_ENTRIES = 200;

export interface CachedMrCostAnswer {
  text: string;
  model: string;
  createdAt: number;
}

const mrCostFirstQuestionCache = new Map<string, CachedMrCostAnswer>();

export function normalizeMrCostCacheKey(question: string, language: string): string {
  const clean = (question || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const langKey = language === "en" ? "en" : "ms";
  return `${langKey}:${clean}`;
}

export function getCachedFirstAnswer(key: string): CachedMrCostAnswer | null {
  if (!key) return null;
  const entry = mrCostFirstQuestionCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt >= FIRST_QUESTION_CACHE_TTL_MS) {
    mrCostFirstQuestionCache.delete(key);
    return null;
  }
  // Refresh LRU order
  mrCostFirstQuestionCache.delete(key);
  mrCostFirstQuestionCache.set(key, entry);
  return entry;
}

export function setCachedFirstAnswer(key: string, text: string, model: string): void {
  const trimmed = (text || "").trim();
  if (!key || !trimmed) return;

  const now = Date.now();
  // Prune expired entries first
  for (const [k, v] of mrCostFirstQuestionCache.entries()) {
    if (now - v.createdAt >= FIRST_QUESTION_CACHE_TTL_MS) {
      mrCostFirstQuestionCache.delete(k);
    }
  }

  if (mrCostFirstQuestionCache.has(key)) {
    mrCostFirstQuestionCache.delete(key);
  }

  while (mrCostFirstQuestionCache.size >= FIRST_QUESTION_CACHE_MAX_ENTRIES) {
    const oldestKey = mrCostFirstQuestionCache.keys().next().value;
    if (oldestKey !== undefined) {
      mrCostFirstQuestionCache.delete(oldestKey);
    } else {
      break;
    }
  }

  mrCostFirstQuestionCache.set(key, {
    text: trimmed,
    model,
    createdAt: now,
  });
}

export function clearMrCostCacheForTest(): void {
  mrCostFirstQuestionCache.clear();
}

export function purgeMrCostCacheForDatabase(databaseId: string): void {
  const cleanId = (databaseId || "").trim();
  if (!cleanId) return;
  const prefix = `${cleanId}::`;
  for (const key of Array.from(mrCostFirstQuestionCache.keys())) {
    if (key.startsWith(prefix)) {
      mrCostFirstQuestionCache.delete(key);
    }
  }
}

export function getMrCostCacheSizeForTest(): number {
  return mrCostFirstQuestionCache.size;
}

const distPath = DIST_DIR;

// Load environment variables from .env (populate missing or empty keys without overriding non-empty Secrets)
const dotenvPath = path.join(PROJECT_ROOT, ".env");
dotenv.config({ path: dotenvPath });
if (fs.existsSync(dotenvPath)) {
  try {
    const parsedEnv = dotenv.parse(fs.readFileSync(dotenvPath, "utf-8"));
    for (const [k, v] of Object.entries(parsedEnv)) {
      if (!process.env[k] || process.env[k]!.trim() === "") {
        process.env[k] = v;
      }
    }
  } catch {
    // ignore malformed optional .env
  }
}

const app = express();
app.set("trust proxy", 1);
const parsedPort = Number.parseInt(String(process.env.PORT || "").trim(), 10);
const PORT = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 3000;

// Determine production mode reliably for Cloud Run and production builds
const isProduction =
  process.env.NODE_ENV === "production" ||
  Boolean(process.env.K_SERVICE) ||
  Boolean(process.env.K_REVISION) ||
  (fs.existsSync(path.join(distPath, "index.html")) && process.env.NODE_ENV !== "development");

function isAllowedCorsOrigin(origin: string | undefined, reqHostHeader?: string): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const reqHostname = String(reqHostHeader || "").split(":")[0].trim().toLowerCase();
    if (reqHostname && parsed.hostname.toLowerCase() === reqHostname) {
      return true;
    }
    if (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname.endsWith(".pages.dev") ||
      parsed.hostname.endsWith(".workers.dev") ||
      parsed.hostname.endsWith(".run.app")
    ) {
      return true;
    }
    const extra = String(process.env.ALLOWED_ORIGINS || "").trim().replace(/^["']+|["']+$/g, "");
    if (extra) {
      const allowedList = extra
        .split(/[\s,]+/)
        .map((item) => item.trim().replace(/^["']+|["']+$/g, "").replace(/\/+$/, ""))
        .filter(Boolean);
      for (const entry of allowedList) {
        if (entry === "*") return true;
        if (entry === origin || entry.toLowerCase() === parsed.origin.toLowerCase()) return true;
        if (entry.toLowerCase() === parsed.hostname.toLowerCase()) return true;
        if (entry.startsWith("*.")) {
          const suffix = entry.slice(1).toLowerCase();
          if (parsed.hostname.toLowerCase().endsWith(suffix)) return true;
        }
        try {
          const parsedEntry = new URL(entry.includes("://") ? entry : `https://${entry}`);
          if (parsedEntry.hostname.toLowerCase() === parsed.hostname.toLowerCase()) return true;
        } catch {}
      }
    }
  } catch {
    return false;
  }
  return false;
}

// Security Headers, Production HTTPS Enforcement, Exposed-File Blocker & Allowlisted CORS Middleware
app.disable("x-powered-by");

const genericRateLimitBuckets = new Map<string, number[]>();
function checkEndpointRateLimit(bucket: string, ip: string, maxPerMin: number): boolean {
  const now = Date.now();
  const key = `${bucket}:${ip || "unknown"}`;
  const existing = (genericRateLimitBuckets.get(key) || []).filter((ts) => now - ts < 60_000);
  if (existing.length >= maxPerMin) {
    genericRateLimitBuckets.set(key, existing);
    return false;
  }
  existing.push(now);
  genericRateLimitBuckets.set(key, existing);
  if (genericRateLimitBuckets.size > 5000) {
    for (const [k, v] of genericRateLimitBuckets.entries()) {
      const fresh = v.filter((ts) => now - ts < 60_000);
      if (fresh.length === 0) genericRateLimitBuckets.delete(k);
    }
  }
  return true;
}

const SENSITIVE_EXPOSED_PATH_REGEX =
  /^\/(?:\.env(?:\..*)?|\.git(?:\/|$)|data(?:\/|$)|server\.ts$|package(?:-lock)?\.json$|tsconfig\.json$|wrangler\.toml$|firebase-applet-config\.json$|eslint\.config\.|vite\.config\.|(?:src|scripts|deploy|workers)\/)|\.map$/i;

app.use((req, res, next) => {
  const reqHost = String(req.headers.host || "").split(":")[0].toLowerCase();
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  const isLocalHost = reqHost === "localhost" || reqHost === "127.0.0.1" || reqHost === "";
  const isHttps = Boolean(req.secure) || forwardedProto === "https";

  if (
    isProduction &&
    !isLocalHost &&
    forwardedProto === "http" &&
    req.path !== "/healthz" &&
    req.path !== "/api/health" &&
    (req.method === "GET" || req.method === "HEAD")
  ) {
    res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    return;
  }

  const origin = req.headers.origin;
  if (origin && isAllowedCorsOrigin(origin, String(req.headers.host || ""))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-SmartCost-Session, X-CSRF-Token, X-Requested-With"
    );
    res.setHeader(
      "Access-Control-Expose-Headers",
      "X-SmartCost-Node, X-SmartCost-LB-Algorithm, X-SmartCost-Cost-Tier"
    );
    res.setHeader("Access-Control-Max-Age", "86400");
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://apis.google.com https://www.gstatic.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://*.workers.dev https://*.googleapis.com https://*.firebaseio.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com wss:",
      "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
      "frame-ancestors 'self' https://aistudio.google.com https://*.google.com https://*.googleusercontent.com",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; ")
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  if (isHttps || (isProduction && !isLocalHost)) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  if (SENSITIVE_EXPOSED_PATH_REGEX.test(req.path)) {
    logSecurityAudit({
      jenisKejadian: "PERMINTAAN_SEKAT",
      ip: String(req.headers["x-forwarded-for"] || req.ip || ""),
      status: "DISEKAT",
      butiran: `sensitive_path_blocked=${req.path.slice(0, 80)}`,
    });
    res.status(404).json({ error: "Sumber tidak ditemui." });
    return;
  }

  next();
});

// Enable JSON parser with safe maximum payload size limit (10MB for backup files, 1MB typical)
app.use(express.json({ limit: "10mb" }));

import { infraManager, type LoadBalancerAlgorithm, type InfraLogLevel } from "./src/infraManager.ts";
import { backupManager, type SafeRestoreMode } from "./src/backupManager.ts";
import { quotaTracker } from "./src/quotaTracker.ts";

// Real Load Balancer, Free-Tier Quota Telemetry & Logical Pool Dispatch Middleware for /api/*
app.use("/api", (req, res, next) => {
  const target = infraManager.selectNodeForRequest();
  if (!target) {
    infraManager.addLog({
      level: "ERROR",
      source: "LoadBalancer",
      statusCode: 503,
      message: `503 Service Unavailable on ${req.method} ${req.originalUrl}: no healthy logical pools available.`,
    });
    res.status(503).json({
      error: "Semua pelayan sedang diselenggara atau tidak tersedia. Sila cuba sebentar lagi.",
      code: "NO_HEALTHY_NODES",
    });
    return;
  }

  const isQuotaExempt =
    req.path === "/health" ||
    req.path.startsWith("/infra") ||
    req.path === "/auth/session" ||
    req.path === "/auth/logout" ||
    req.path === "/auth/session-dev";

  if (!isQuotaExempt && quotaTracker.isDailyApiQuotaExceeded()) {
    infraManager.addLog({
      level: "WARN",
      source: "FreeTierQuota",
      statusCode: 429,
      message: `FREE QUOTA EXCEEDED (100%): ${req.method} ${req.path} paused gracefully to preserve RM0.00 tier & data safety.`,
    });
    res.setHeader("Retry-After", "3600");
    res.status(429).json({
      error: "Kuota harian percuma (100,000 permintaan) telah dicapai. Tiada data dipadamkan; cuba lagi esok atau semak Konsol Pembangun.",
      code: "FREE_QUOTA_EXCEEDED",
      status: "LIMIT REACHED",
    });
    return;
  }

  const startMs = performance.now();
  let bytesSent = 0;
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  (res as any).write = function (chunk: any, ...args: any[]) {
    if (chunk) {
      bytesSent += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    }
    return origWrite(chunk, ...args);
  };
  (res as any).end = function (chunk?: any, ...args: any[]) {
    if (chunk && typeof chunk !== "function") {
      bytesSent += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    }
    return origEnd(chunk, ...args);
  };

  infraManager.beginRequestOnNode(target.nodeId);
  res.setHeader("X-SmartCost-Node", target.nodeId);
  res.setHeader("X-SmartCost-LB-Algorithm", target.algorithmUsed);
  res.setHeader("X-SmartCost-Cost-Tier", "RM0.00-Free-Tier");

  let settled = false;
  const finalize = () => {
    if (settled) return;
    settled = true;
    const durationMs = performance.now() - startMs;
    const contentLen = Number(res.getHeader("Content-Length") || 0);
    const totalBytes = Math.max(bytesSent, Number.isFinite(contentLen) ? contentLen : 0);
    const statusCode = res.statusCode || 200;
    infraManager.finishRequestOnNode(target.nodeId, durationMs, statusCode, `${req.method} ${req.path}`);
    quotaTracker.recordApiRequest(durationMs, statusCode, totalBytes);
  };

  res.on("finish", finalize);
  res.on("close", finalize);
  next();
});

// Health check endpoints for Cloud Run & Load Balancer container probes
app.get("/healthz", (req, res) => {
  if (!checkEndpointRateLimit("healthz", getClientIp(req), 180)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak permintaan." });
    return;
  }
  const lb = infraManager.getLoadBalancerSummary();
  res.status(200).json({
    status: "OK",
    healthyNodes: lb.healthyNodes,
    totalNodes: lb.totalNodes,
    algorithm: lb.algorithm,
  });
});

app.get("/api/health", (req, res) => {
  if (!checkEndpointRateLimit("api-health", getClientIp(req), 180)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak permintaan." });
    return;
  }
  const lb = infraManager.getLoadBalancerSummary();
  res.status(200).json({
    status: "ok",
    healthyNodes: lb.healthyNodes,
    totalNodes: lb.totalNodes,
    algorithm: lb.algorithm,
  });
});

// ==========================================
// AUTHENTICATION & USER MANAGEMENT ENDPOINTS
// ==========================================
import {
  registerNewManualUser,
  authenticateManualLogin,
  changeUserPassword,
  setOrLinkManualCredentialsForUser,
  rollbackCredentialUpdate,
  rotateSessionAfterCredentialChange,
  isSignedTokenRevokedOrExpired,
  findUserExactByUsername,
  findUserById,
  findUserByEmail,
  deleteServerUserByDbKey,
  createServerSession,
  verifySessionToken,
  inspectExpiredDeveloperSessionToken,
  buildSessionTokenForRecord,
  updateSessionActiveDb,
  stampSessionReauth,
  invalidateFreshDefaultReauthNonce,
  isSessionRecentlyReauthenticated,
  revokeSessionBySid,
  getActiveSessionCountsByDatabase,
  hasOtherActiveSessionsForDatabase,
  revokeSessionsForDatabase,
  isDatabaseDeletedTombstone,
  getDeletedDatabaseTombstoneKeys,
  markDatabaseDeletedTombstone,
  clearDatabaseDeletedTombstone,
  upsertOrFindGoogleUser,
  updateUserRoleByAdmin,
  listUsersForAdmin,
  bootstrapDefaultAdminAccount,
  createPasswordResetRequest,
  confirmPasswordReset,
  verifyPassword,
  recordLoginFailure,
  authenticateDeveloperEntry,
  reauthenticateDeveloperSession,
  isEmailWhitelistedForDeveloper,
  checkDevAuthLockout,
  recordDevAuthFailure,
  clearDevAuthFailures,
  loadSecurityAuditLogs,
  sanitizeUserForClient,
  isDevEntryEnabled,
  isDevSandboxEnabled,
  logSecurityAudit,
  hashIdShort,
  UNIFORM_LOGIN_ERROR,
  RATE_LIMIT_LOGIN_ERROR,
  DEV_RATE_LIMIT_ERROR,
  DEV_SANDBOX_DB_ID,
  REAUTH_FRESH_WINDOW_MS,
  registerServerDatabase,
  loadServerDatabases,
  findServerDatabaseById,
  deleteServerDatabaseById,
  deleteCompanyDatabaseTransactional,
  rollbackCompanyDatabaseDelete,
  classifyDatabaseRecord,
  isVerifiedDeveloperActor,
  canUserAccessDatabase,
  getForbiddenDatabasesForActive,
  get2FAStatusForUser,
  setupOptional2FA,
  enableOptional2FA,
  disableOptional2FA,
  verifyUser2FAIfEnabled,
  DELETE_REJECT_MESSAGES,
  type DeleteRejectReasonCode,
  type ServerUserRole,
} from "./src/serverAuth.ts";

const SESSION_COOKIE_NAME = "smartcost_session";
const HISTORY_DATA_FILE = path.join(DATA_DIR, "mrcost_history.json");

interface ServerChatHistoryItem {
  id: string;
  role: "user" | "model";
  text: string;
  timestamp: string;
  databaseId: string;
  simulationProposal?: unknown;
}

let serverChatHistoriesCache: Record<string, ServerChatHistoryItem[]> | null = null;

function loadServerChatHistories(): Record<string, ServerChatHistoryItem[]> {
  if (serverChatHistoriesCache) return serverChatHistoriesCache;
  try {
    const dir = path.dirname(HISTORY_DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(HISTORY_DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(HISTORY_DATA_FILE, "utf-8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        serverChatHistoriesCache = parsed;
        return serverChatHistoriesCache!;
      }
    }
  } catch {
    // ignore read error
  }
  serverChatHistoriesCache = {};
  return serverChatHistoriesCache;
}

function saveServerChatHistories(data: Record<string, ServerChatHistoryItem[]>): boolean {
  const prevCache = serverChatHistoriesCache;
  try {
    const dir = path.dirname(HISTORY_DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tempFile = `${HISTORY_DATA_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tempFile, HISTORY_DATA_FILE);
    serverChatHistoriesCache = data;
    return true;
  } catch {
    serverChatHistoriesCache = prevCache;
    return false;
  }
}

function purgeServerChatHistoryForDatabase(databaseId: string): { ok: boolean } {
  const cleanId = (databaseId || "").trim();
  if (!cleanId) return { ok: true };
  const all = { ...loadServerChatHistories() };
  if (Object.prototype.hasOwnProperty.call(all, cleanId)) {
    delete all[cleanId];
    const saved = saveServerChatHistories(all);
    return { ok: saved };
  }
  return { ok: true };
}

function parseCookies(req: express.Request): Record<string, string> {
  const header = req.headers.cookie;
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

function setSessionCookie(req: express.Request, res: express.Response, token: string): void {
  const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "Max-Age=43200",
    isHttps ? "SameSite=None" : "SameSite=Lax",
  ];
  if (isHttps) {
    attrs.push("Secure", "Partitioned");
  }
  res.setHeader("Set-Cookie", attrs.join("; "));
}

function clearSessionCookie(req: express.Request, res: express.Response): void {
  const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
  const attrs = [
    `${SESSION_COOKIE_NAME}=`,
    "HttpOnly",
    "Path=/",
    "Max-Age=0",
    isHttps ? "SameSite=None" : "SameSite=Lax",
  ];
  if (isHttps) {
    attrs.push("Secure", "Partitioned");
  }
  res.setHeader("Set-Cookie", attrs.join("; "));
}

function inspectExpiredDeveloperTokenFromReq(req: express.Request): { isExpiredDeveloperSession: boolean; uid?: string } {
  const cookies = parseCookies(req);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  const headerScsToken = typeof req.headers["x-smartcost-session"] === "string"
    ? req.headers["x-smartcost-session"].trim()
    : "";
  const authHeader = req.headers.authorization;
  const bearerRaw = authHeader && authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : "";
  const bearerScsToken = bearerRaw.startsWith("scs.") ? bearerRaw.slice(4).trim() : "";

  for (const candidate of [headerScsToken, bearerScsToken, cookieToken]) {
    if (!candidate) continue;
    const res = inspectExpiredDeveloperSessionToken(candidate);
    if (res.isExpiredDeveloperSession) return res;
  }
  return { isExpiredDeveloperSession: false };
}

function getClientIp(req: express.Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    return fwd.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

interface VerifiedActor {
  uid: string;
  username: string;
  email?: string;
  role: string;
  activeDbKey: string;
  sid?: string;
  csrfToken?: string;
  sessionToken?: string;
  usedCookieAuth: boolean;
  isRecentlyReauthenticated: boolean;
  lastReauthAt?: number;
  firebaseAuthTimeSec?: number;
}

async function resolveVerifiedActor(req: express.Request): Promise<VerifiedActor | null> {
  const cookies = parseCookies(req);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  const headerScsToken = typeof req.headers["x-smartcost-session"] === "string"
    ? req.headers["x-smartcost-session"].trim()
    : "";
  const authHeader = req.headers.authorization;
  const bearerRaw = authHeader && authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : "";
  const bearerScsToken = bearerRaw.startsWith("scs.") ? bearerRaw.slice(4).trim() : "";

  const headerSession = verifySessionToken(headerScsToken) || verifySessionToken(bearerScsToken);
  if (!headerSession && (isSignedTokenRevokedOrExpired(headerScsToken) || isSignedTokenRevokedOrExpired(bearerScsToken))) {
    return null;
  }
  const cookieSession = !headerSession ? verifySessionToken(cookieToken) : null;
  if (!headerSession && !cookieSession && isSignedTokenRevokedOrExpired(cookieToken)) {
    return null;
  }
  const sessionRecord = headerSession || cookieSession;
  const activeSessionToken = headerSession ? (headerScsToken || bearerScsToken) : (cookieSession ? cookieToken : undefined);
  const usedCookieAuth = Boolean(!headerSession && cookieSession && !(bearerRaw && !bearerRaw.startsWith("scs.")));

  // If client explicitly sent a valid SmartCost session token (e.g. Alt+D developer or manual login), honor it cleanly
  if (headerSession) {
    const serverUser = findUserById(headerSession.uid);
    let activeDbKey = headerSession.activeDbKey || serverUser?.dbKey || "";
    if (activeDbKey === DEV_SANDBOX_DB_ID && !isDevSandboxEnabled()) {
      activeDbKey = `pengekosan_userdb_${headerSession.uid}`;
    }
    return {
      uid: headerSession.uid,
      username: serverUser?.username || headerSession.username,
      email: serverUser?.email,
      role: serverUser?.role || headerSession.role,
      activeDbKey,
      sid: headerSession.sid,
      csrfToken: headerSession.csrfToken,
      sessionToken: activeSessionToken,
      usedCookieAuth: false,
      isRecentlyReauthenticated: isSessionRecentlyReauthenticated(headerSession),
      lastReauthAt: headerSession.lastReauthAt,
    };
  }

  if (bearerRaw && !bearerRaw.startsWith("scs.")) {
    const fbPayload = await verifyFirebaseIdToken(bearerRaw);
    if (fbPayload) {
      const uid = fbPayload.uid;
      const email = fbPayload.email;
      const serverUser = findUserById(uid) || (email ? findUserByEmail(email) : null);
      // Do not allow background Firebase auth to overwrite an active Alt+D developer cookie session
      if (cookieSession && cookieSession.uid !== (serverUser?.id || uid) && cookieSession.role === "developer") {
        const cookieUser = findUserById(cookieSession.uid);
        let devDbKey = cookieSession.activeDbKey || cookieUser?.dbKey || DEV_SANDBOX_DB_ID;
        if (devDbKey === DEV_SANDBOX_DB_ID && !isDevSandboxEnabled()) {
          devDbKey = `pengekosan_userdb_${cookieSession.uid}`;
        }
        return {
          uid: cookieSession.uid,
          username: cookieUser?.username || cookieSession.username,
          email: cookieUser?.email,
          role: cookieUser?.role || cookieSession.role,
          activeDbKey: devDbKey,
          sid: cookieSession.sid,
          csrfToken: cookieSession.csrfToken,
          sessionToken: cookieToken,
          usedCookieAuth: true,
          isRecentlyReauthenticated: isSessionRecentlyReauthenticated(cookieSession),
          lastReauthAt: cookieSession.lastReauthAt,
        };
      }
      const isWhitelistedDev = isDevEntryEnabled() && fbPayload.emailVerified && isEmailWhitelistedForDeveloper(email);
      const role = isWhitelistedDev ? "developer" : (serverUser?.role || "staf");
      const defaultDb = role === "developer" && isDevEntryEnabled()
        ? DEV_SANDBOX_DB_ID
        : (serverUser?.dbKey || `pengekosan_userdb_${uid}`);
      const candidateDb =
        sessionRecord && sessionRecord.uid === (serverUser?.id || uid) && sessionRecord.activeDbKey
          ? sessionRecord.activeDbKey
          : defaultDb;
      const activeDbKey = candidateDb === DEV_SANDBOX_DB_ID && !isDevSandboxEnabled()
        ? `pengekosan_userdb_${serverUser?.id || uid}`
        : candidateDb;

      return {
        uid: serverUser?.id || uid,
        username: serverUser?.username || (email ? email.split("@")[0] : uid),
        email: email || serverUser?.email,
        role,
        activeDbKey,
        sid: sessionRecord?.sid,
        csrfToken: sessionRecord?.csrfToken,
        sessionToken: activeSessionToken,
        usedCookieAuth: false,
        isRecentlyReauthenticated: isSessionRecentlyReauthenticated(sessionRecord),
        lastReauthAt: sessionRecord?.lastReauthAt,
        firebaseAuthTimeSec: fbPayload.authTimeSec,
      };
    }
  }

  if (sessionRecord) {
    const serverUser = findUserById(sessionRecord.uid);
    let activeDbKey = sessionRecord.activeDbKey || serverUser?.dbKey || "";
    if (activeDbKey === DEV_SANDBOX_DB_ID && !isDevSandboxEnabled()) {
      activeDbKey = `pengekosan_userdb_${sessionRecord.uid}`;
    }
    return {
      uid: sessionRecord.uid,
      username: serverUser?.username || sessionRecord.username,
      email: serverUser?.email,
      role: serverUser?.role || sessionRecord.role,
      activeDbKey,
      sid: sessionRecord.sid,
      csrfToken: sessionRecord.csrfToken,
      sessionToken: activeSessionToken,
      usedCookieAuth,
      isRecentlyReauthenticated: isSessionRecentlyReauthenticated(sessionRecord),
      lastReauthAt: sessionRecord.lastReauthAt,
    };
  }

  return null;
}

function isTrustedRequestOrigin(req: express.Request): boolean {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin.trim() : "";
  const referer = typeof req.headers.referer === "string" ? req.headers.referer.trim() : "";
  const candidateUrl = origin || referer;
  if (!candidateUrl) return true; // Non-browser clients / same-origin without Origin header still require X-CSRF-Token

  try {
    const parsed = new URL(candidateUrl);
    if (isAllowedCorsOrigin(parsed.origin)) return true;
    const hostHeader = String(req.headers["x-forwarded-host"] || req.headers.host || "")
      .split(",")[0]
      .trim()
      .toLowerCase();
    if (hostHeader && parsed.host.toLowerCase() === hostHeader) return true;
  } catch {
    return false;
  }
  return false;
}

function verifyCsrfForMutation(req: express.Request, actor: VerifiedActor | null): boolean {
  if (!actor) return false;
  if (!actor.usedCookieAuth) return true;
  if (!actor.csrfToken) return false;
  if (!isTrustedRequestOrigin(req)) return false;

  const provided = typeof req.headers["x-csrf-token"] === "string"
    ? req.headers["x-csrf-token"].trim()
    : "";
  if (!provided) return false;

  const a = Buffer.from(provided, "utf-8");
  const b = Buffer.from(actor.csrfToken, "utf-8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function hasRecentReauth(
  _req: express.Request,
  actor: VerifiedActor,
  bodyReauthPassword?: string,
  bodyReauthIdToken?: string
): Promise<boolean> {
  return (async () => {
    if (actor.isRecentlyReauthenticated) return true;

    if (typeof bodyReauthPassword === "string" && bodyReauthPassword.length > 0) {
      const user = findUserById(actor.uid);
      if (user && verifyPassword(bodyReauthPassword, user.salt, user.passwordHash)) {
        if (actor.sid) stampSessionReauth(actor.sid);
        return true;
      }
    }

    if (typeof bodyReauthIdToken === "string" && bodyReauthIdToken.trim()) {
      const fb = await verifyFirebaseIdToken(bodyReauthIdToken.trim());
      if (fb && (fb.uid === actor.uid || (actor.email && fb.email === actor.email.toLowerCase()))) {
        const nowSec = Math.floor(Date.now() / 1000);
        if (!fb.authTimeSec || nowSec - fb.authTimeSec <= 300) {
          if (actor.sid) stampSessionReauth(actor.sid);
          return true;
        }
      }
    }

    return false;
  })();
}

// Public non-secret feature flags endpoint (Alt+D Developer Entry & Sandbox status)
app.get("/api/config/features", (req, res) => {
  if (!checkEndpointRateLimit("config-features", getClientIp(req), 120)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak permintaan. Sila cuba sebentar lagi." });
    return;
  }
  res.json({
    devEntryEnabled: isDevEntryEnabled(),
    devSandboxEnabled: isDevSandboxEnabled(),
  });
});

// Active Server Session Inspection (used to hydrate session cleanly without localStorage tokens)
app.get("/api/auth/session", async (req, res) => {
  if (!checkEndpointRateLimit("auth-session", getClientIp(req), 90)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ authenticated: false, error: "Terlalu banyak permintaan semakan sesi." });
    return;
  }
  const actor = await resolveVerifiedActor(req);
  if (!actor) {
    const expiredCheck = inspectExpiredDeveloperTokenFromReq(req);
    if (expiredCheck.isExpiredDeveloperSession) {
      res.status(401).json({
        authenticated: false,
        sessionExpired: true,
        code: "SESSION_EXPIRED",
      });
      return;
    }
    res.status(401).json({ authenticated: false });
    return;
  }

  let hydratedSessionToken = actor.sessionToken || buildSessionTokenForRecord(actor.sid);
  let hydratedCsrfToken = actor.csrfToken;
  if (!actor.sid) {
    const created = createServerSession({
      uid: actor.uid,
      username: actor.username,
      role: actor.role as ServerUserRole,
      activeDbKey: actor.activeDbKey,
    });
    hydratedSessionToken = created.token;
    hydratedCsrfToken = created.csrfToken;
    setSessionCookie(req, res, created.token);
  }

  const serverUser = findUserById(actor.uid);
  const isVerifiedDeveloper = actor.role === "developer" && isVerifiedDeveloperActor(actor);
  const reauthExpiresAt =
    actor.isRecentlyReauthenticated && actor.lastReauthAt
      ? actor.lastReauthAt + REAUTH_FRESH_WINDOW_MS
      : 0;
  res.json({
    authenticated: true,
    user: serverUser
      ? { ...sanitizeUserForClient(serverUser), dbKey: actor.activeDbKey, role: actor.role }
      : {
          id: actor.uid,
          username: actor.username,
          fullName: actor.username,
          role: actor.role,
          email: actor.email,
          dbKey: actor.activeDbKey,
        },
    activeDbKey: actor.activeDbKey,
    role: actor.role,
    isVerifiedDeveloper,
    isRecentlyReauthenticated: actor.isRecentlyReauthenticated,
    reauthExpiresAt,
    ...(hydratedSessionToken ? { sessionToken: hydratedSessionToken } : {}),
    ...(hydratedCsrfToken ? { csrfToken: hydratedCsrfToken } : {}),
    devEntryEnabled: isDevEntryEnabled(),
    devSandboxEnabled: isDevSandboxEnabled(),
  });
});

// Auth endpoint IP rate limiter (registration & password reset)
const authRateMap = new Map<string, number[]>();
function checkAuthEndpointRateLimit(ip: string, maxPerMin = 15): boolean {
  const now = Date.now();
  const timestamps = (authRateMap.get(ip) || []).filter((t) => now - t < 60 * 1000);
  if (timestamps.length >= maxPerMin) {
    authRateMap.set(ip, timestamps);
    return false;
  }
  timestamps.push(now);
  authRateMap.set(ip, timestamps);
  return true;
}

// 2. Manual Registration (Email Optional, always assigns lowest role 'staf')
app.post("/api/auth/register-manual", (req, res) => {
  const ip = getClientIp(req);
  if (!checkAuthEndpointRateLimit(ip, 10)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak percubaan pendaftaran. Sila tunggu sebentar." });
    return;
  }

  try {
    const validation = validateManualRegisterInput((req.body || {}) as Record<string, unknown>);
    if (!validation.valid || !validation.cleaned) {
      logSecurityAudit({
        jenisKejadian: "VALIDASI_GAGAL",
        ip,
        status: "DISEKAT",
        butiran: "register_manual_schema_rejected",
      });
      res.status(400).json({ error: validation.error || "Data pendaftaran tidak sah." });
      return;
    }

    const { username, fullName, companyName, password, email } = validation.cleaned;
    const result = registerNewManualUser({
      username,
      fullName,
      companyName,
      password,
      email,
    });

    if (!result.success) {
      logSecurityAudit({
        jenisKejadian: "DAFTAR_AKAUN",
        uid: typeof username === "string" ? username : "unknown",
        ip,
        status: "GAGAL",
        butiran: "validation_failed",
      });
      res.status(400).json({ error: result.error });
      return;
    }

    logSecurityAudit({
      jenisKejadian: "DAFTAR_AKAUN",
      uid: result.user?.id,
      role: result.user?.role,
      ip,
      status: "BERJAYA",
    });

    res.status(201).json({
      success: true,
      user: result.user,
    });
  } catch {
    res.status(500).json({ error: "Ralat pelayan semasa pendaftaran." });
  }
});

// 2b. Single-Use Default Admin Account Activation (Allowed ONLY when zero admin accounts exist)
app.post("/api/auth/bootstrap-admin", (req, res) => {
  const ip = getClientIp(req);
  if (!checkAuthEndpointRateLimit(ip, 10)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak percubaan. Sila tunggu sebentar.", code: "LOCKED" });
    return;
  }

  try {
    const { password, fullName, email } = req.body || {};
    const result = bootstrapDefaultAdminAccount({
      password: typeof password === "string" ? password : "",
      fullName: typeof fullName === "string" ? fullName : undefined,
      email: typeof email === "string" ? email : undefined,
    });

    if (!result.success || !result.user) {
      logSecurityAudit({
        jenisKejadian: "DAFTAR_AKAUN",
        uid: "admin-default",
        role: "admin",
        ip,
        status: "GAGAL",
        butiran: "admin_bootstrap_rejected",
      });
      res.status(result.status || 400).json({ error: result.error });
      return;
    }

    const activeDbKey = result.user.dbKey || "pengekosan_company_db_school_enterprise";
    const createdSession = createServerSession({
      uid: result.user.id!,
      username: result.user.username!,
      role: "admin",
      activeDbKey,
      markReauthenticated: true,
    });
    setSessionCookie(req, res, createdSession.token);

    logSecurityAudit({
      jenisKejadian: "DAFTAR_AKAUN",
      uid: result.user.id,
      role: "admin",
      ip,
      status: "BERJAYA",
      butiran: "admin_bootstrap",
    });

    res.status(201).json({
      success: true,
      user: result.user,
      activeDbKey,
      role: "admin",
      isVerifiedDeveloper: false,
      sessionToken: createdSession.token,
      csrfToken: createdSession.csrfToken,
      devEntryEnabled: isDevEntryEnabled(),
      devSandboxEnabled: isDevSandboxEnabled(),
    });
  } catch {
    res.status(500).json({ error: "Ralat pelayan semasa mengaktifkan akaun admin.", code: "SERVER_ERROR" });
  }
});

// 3. Manual Login (Username/Email + Password + Server Role Verification + Brute-Force Protection)
app.post("/api/auth/login-manual", (req, res) => {
  const ip = getClientIp(req);
  try {
    const { username, email, password, requestedRole, totpCode } = req.body || {};
    const result = authenticateManualLogin(username, password, {
      requestedRole: typeof requestedRole === "string" ? requestedRole : undefined,
      email: typeof email === "string" ? email : undefined,
      ip,
    });

    if (!result.success || !result.user) {
      if (result.locked) {
        if (result.retryAfterSec) {
          res.setHeader("Retry-After", String(result.retryAfterSec));
        }
        res.status(429).json({
          error: result.error || RATE_LIMIT_LOGIN_ERROR,
          code: result.code || "LOCKED",
          retryAfterSec: result.retryAfterSec,
        });
        return;
      }
      res.status(result.status || 401).json({
        error: result.error || UNIFORM_LOGIN_ERROR,
        code: result.code || "INVALID_CREDENTIALS",
        ...(result.actualRole ? { actualRole: result.actualRole } : {}),
      });
      return;
    }

    // Enforce strict separation: developer accounts must authenticate through Alt+D /api/auth/session-dev
    if (result.user.role === "developer") {
      res.status(403).json({
        error: "Akaun pembangun hanya boleh diakses melalui mod pengesahan pembangun (Alt+D).",
        code: "DEVELOPER_USE_ALT_D",
      });
      return;
    }

    // Optional Two-Factor Authentication verification for accounts with 2FA enabled
    const tfaCheck = verifyUser2FAIfEnabled(
      result.user.id!,
      typeof totpCode === "string" ? totpCode : undefined
    );
    if (tfaCheck.required) {
      if (typeof totpCode !== "string" || !totpCode.trim()) {
        res.status(401).json({
          error: "Pengesahan dua faktor (2FA) diperlukan. Sila masukkan kod 6-digit Authenticator anda.",
          code: "TWO_FACTOR_REQUIRED",
          requires2FA: true,
        });
        return;
      }
      if (!tfaCheck.valid) {
        const failRes = recordLoginFailure(
          String(result.user.username || username || email || "").trim().toLowerCase(),
          ip
        );
        logSecurityAudit({
          jenisKejadian: failRes.newlyLocked ? "AKAUN_DIKUNCI" : "TWO_FACTOR_AUTH",
          uid: result.user.id,
          role: result.user.role,
          ip,
          status: failRes.newlyLocked ? "DISEKAT" : "GAGAL",
          butiran: "invalid_2fa_code",
        });
        if (failRes.newlyLocked) {
          res.setHeader("Retry-After", String(failRes.retryAfterSec));
          res.status(429).json({
            error: RATE_LIMIT_LOGIN_ERROR,
            code: "LOCKED",
            retryAfterSec: failRes.retryAfterSec,
          });
          return;
        }
        res.status(401).json({
          error: "Kod pengesahan 2FA tidak sah atau telah tamat tempoh.",
          code: "INVALID_TWO_FACTOR_CODE",
          requires2FA: true,
        });
        return;
      }
      logSecurityAudit({
        jenisKejadian: "TWO_FACTOR_AUTH",
        uid: result.user.id,
        role: result.user.role,
        ip,
        status: "BERJAYA",
        butiran: "manual_login_2fa_verified",
      });
    }

    const activeDbKey = result.user.dbKey || (isDatabaseDeletedTombstone(`pengekosan_userdb_${result.user.id}`) ? "" : `pengekosan_userdb_${result.user.id}`);
    if (activeDbKey && !isDatabaseDeletedTombstone(activeDbKey)) {
      registerServerDatabase({
        databaseId: activeDbKey,
        companyName: result.user.companyName || "MY ENTERPRISE",
        ownerId: result.user.id!,
        ownerUsername: result.user.username!,
        isProtected: false,
      });
    }

    const createdSession = createServerSession({
      uid: result.user.id!,
      username: result.user.username!,
      role: (result.user.role || "staf") as ServerUserRole,
      activeDbKey,
      markReauthenticated: true,
    });
    setSessionCookie(req, res, createdSession.token);

    logSecurityAudit({
      jenisKejadian: "LOGIN_BERJAYA",
      uid: result.user.id,
      role: result.user.role,
      ip,
      status: "BERJAYA",
      butiran: "manual",
    });

    res.json({
      success: true,
      user: result.user,
      activeDbKey,
      role: result.user.role,
      isVerifiedDeveloper: false,
      sessionToken: createdSession.token,
      csrfToken: createdSession.csrfToken,
      devEntryEnabled: isDevEntryEnabled(),
      devSandboxEnabled: isDevSandboxEnabled(),
    });
  } catch {
    res.status(500).json({ error: "Ralat pelayan semasa log masuk.", code: "SERVER_ERROR" });
  }
});

// 3b. Sync cryptographically verified Firebase session to server HttpOnly session cookie
app.post("/api/auth/session-firebase", async (req, res) => {
  const ip = getClientIp(req);
  try {
    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const tokenInput = bearer || (typeof req.body?.idToken === "string" ? req.body.idToken.trim() : "");
    const payload = await verifyFirebaseIdToken(tokenInput);
    if (!payload) {
      logSecurityAudit({
        jenisKejadian: "RALAT_PENGESAHAN",
        ip,
        status: "GAGAL",
        butiran: "invalid_or_unverified_firebase_token",
      });
      res.status(401).json({
        error: "Token pengesahan Google/Firebase tidak sah atau telah tamat tempoh. Sila log masuk semula.",
        code: "TOKEN_INVALID",
      });
      return;
    }

    if (!payload.emailVerified || !payload.email) {
      logSecurityAudit({
        jenisKejadian: "RALAT_PENGESAHAN",
        uid: payload.uid,
        ip,
        status: "DISEKAT",
        butiran: "email_not_verified",
      });
      res.status(403).json({
        error: "E-mel akaun Google/Firebase belum disahkan.",
        code: "EMAIL_NOT_VERIFIED",
      });
      return;
    }

    const { user: serverUser, isNewUser } = upsertOrFindGoogleUser({
      uid: payload.uid,
      email: payload.email,
      fullName: payload.name,
      companyName: typeof req.body?.companyName === "string" ? req.body.companyName : undefined,
    });

    const role = serverUser.role;
    const requestedDbKey = typeof req.body?.dbKey === "string" ? req.body.dbKey.trim() : "";
    const companyName = typeof req.body?.companyName === "string" && req.body.companyName.trim()
      ? req.body.companyName.trim()
      : serverUser.companyName;

    let activeDbKey = serverUser.dbKey;
    if (activeDbKey === DEV_SANDBOX_DB_ID && !isDevSandboxEnabled()) {
      activeDbKey = `pengekosan_userdb_${serverUser.id}`;
    }

    if (requestedDbKey && requestedDbKey !== DEV_SANDBOX_DB_ID) {
      const actorCandidate: VerifiedActor = {
        uid: serverUser.id,
        username: serverUser.username,
        email: serverUser.email,
        role,
        activeDbKey,
        usedCookieAuth: false,
        isRecentlyReauthenticated: false,
      };
      const existingDb = findServerDatabaseById(requestedDbKey);
      if (!existingDb && (requestedDbKey === serverUser.dbKey || requestedDbKey === `pengekosan_userdb_${serverUser.id}`)) {
        registerServerDatabase({
          databaseId: requestedDbKey,
          companyName,
          ownerId: actorCandidate.uid,
          ownerUsername: actorCandidate.username,
          isProtected: false,
        });
        activeDbKey = requestedDbKey;
      } else if (existingDb && canUserAccessDatabase(actorCandidate, requestedDbKey)) {
        activeDbKey = requestedDbKey;
      } else if (existingDb) {
        res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE, code: "DB_ACCESS_DENIED" });
        return;
      }
    }

    const isFreshFirebaseAuth = Boolean(
      payload.authTimeSec && Math.floor(Date.now() / 1000) - payload.authTimeSec <= 300
    );
    const createdSession = createServerSession({
      uid: serverUser.id,
      username: serverUser.username,
      role,
      activeDbKey,
      markReauthenticated: isFreshFirebaseAuth,
    });
    setSessionCookie(req, res, createdSession.token);

    logSecurityAudit({
      jenisKejadian: isNewUser ? "DAFTAR_AKAUN" : "LOGIN_BERJAYA",
      uid: serverUser.id,
      role,
      ip,
      status: "BERJAYA",
      butiran: "google_firebase",
    });

    const isVerifiedDeveloper =
      role === "developer" &&
      isVerifiedDeveloperActor({
        uid: serverUser.id,
        username: serverUser.username,
        email: serverUser.email,
        role,
      });

    res.json({
      success: true,
      activeDbKey,
      role,
      isVerifiedDeveloper,
      user: { ...sanitizeUserForClient(serverUser), dbKey: activeDbKey, role },
      sessionToken: createdSession.token,
      csrfToken: createdSession.csrfToken,
      devEntryEnabled: isDevEntryEnabled(),
      devSandboxEnabled: isDevSandboxEnabled(),
    });
  } catch {
    res.status(500).json({ error: "Ralat pelayan semasa pengesahan Google.", code: "SERVER_ERROR" });
  }
});

// 3c. Alt+D Developer entry authentication endpoint
// Supports BOTH:
//   (a) Verified Firebase Google ID token whose verified email matches a developer server record
//   (b) Hashed developer account record in server_users.json
// Enforces 5 failed attempts / 15 min lockout per IP & per account, 30-min idle timeout, uniform errors, and credential-free audit logging.
app.post("/api/auth/session-dev", async (req, res) => {
  const ip = getClientIp(req);
  if (!isDevEntryEnabled()) {
    logSecurityAudit({
      jenisKejadian: "AKSES_PEMBANGUN_GAGAL",
      role: "developer",
      ip,
      status: "DISEKAT",
      butiran: "dev_entry_disabled",
    });
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }

  try {
    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const idToken = typeof req.body?.idToken === "string" ? req.body.idToken.trim() : bearer;

    // Method (a): Firebase Google ID token verified against developer server records
    if (idToken) {
      const preLock = checkDevAuthLockout("dev_entry:google", ip);
      if (preLock.locked) {
        logSecurityAudit({
          jenisKejadian: "AKAUN_DIKUNCI",
          uid: "dev_entry:google",
          role: "developer",
          ip,
          status: "DISEKAT",
          butiran: `dev_google_locked retryAfter=${preLock.retryAfterSec}s`,
        });
        res.setHeader("Retry-After", String(preLock.retryAfterSec));
        res.status(429).json({ error: RATE_LIMIT_LOGIN_ERROR });
        return;
      }

      const payload = await verifyFirebaseIdToken(idToken);
      const emailKey = `dev_entry:${(payload?.email || "google").trim().toLowerCase()}`;
      const accountLock = checkDevAuthLockout(emailKey, ip);
      if (accountLock.locked) {
        logSecurityAudit({
          jenisKejadian: "AKAUN_DIKUNCI",
          uid: emailKey,
          role: "developer",
          ip,
          status: "DISEKAT",
          butiran: `dev_google_locked retryAfter=${accountLock.retryAfterSec}s`,
        });
        res.setHeader("Retry-After", String(accountLock.retryAfterSec));
        res.status(429).json({ error: RATE_LIMIT_LOGIN_ERROR });
        return;
      }

      if (!payload || !payload.emailVerified || !payload.email || !isEmailWhitelistedForDeveloper(payload.email)) {
        const failRes = recordDevAuthFailure(emailKey, ip);
        logSecurityAudit({
          jenisKejadian: failRes.newlyLocked ? "AKAUN_DIKUNCI" : "AKSES_PEMBANGUN_GAGAL",
          uid: payload?.uid || emailKey,
          role: "developer",
          ip,
          status: failRes.newlyLocked ? "DISEKAT" : "GAGAL",
          butiran: "dev_entry_google_rejected",
        });
        if (failRes.newlyLocked) {
          res.setHeader("Retry-After", String(failRes.retryAfterSec));
          res.status(429).json({ error: RATE_LIMIT_LOGIN_ERROR });
          return;
        }
        res.status(401).json({ error: UNIFORM_LOGIN_ERROR });
        return;
      }

      clearDevAuthFailures(emailKey, ip);
      clearDevAuthFailures("dev_entry:google", ip);

      const { user: serverUser } = upsertOrFindGoogleUser({
        uid: payload.uid,
        email: payload.email,
        fullName: payload.name,
        companyName: "DEVELOPER SANDBOX",
      });

      const effectiveDbKey = isDevSandboxEnabled()
        ? DEV_SANDBOX_DB_ID
        : (serverUser.dbKey && serverUser.dbKey !== DEV_SANDBOX_DB_ID
            ? serverUser.dbKey
            : `pengekosan_userdb_${serverUser.id}`);

      if (isDevSandboxEnabled()) {
        registerServerDatabase({
          databaseId: DEV_SANDBOX_DB_ID,
          companyName: "DEVELOPER SANDBOX",
          ownerId: serverUser.id,
          ownerUsername: serverUser.username,
          isProtected: true,
        });
      }

      const createdSession = createServerSession({
        uid: serverUser.id,
        username: serverUser.username,
        role: "developer",
        activeDbKey: effectiveDbKey,
        markReauthenticated: true,
      });
      setSessionCookie(req, res, createdSession.token);
      const stampResult = req.body?.stampReauth ? stampSessionReauth(createdSession.session.sid) : null;

      logSecurityAudit({
        jenisKejadian: "AKSES_PEMBANGUN_BERJAYA",
        uid: serverUser.id,
        role: "developer",
        ip,
        status: "BERJAYA",
        butiran: "dev_entry_google",
      });

      res.json({
        success: true,
        sessionToken: createdSession.token,
        csrfToken: createdSession.csrfToken,
        user: { ...sanitizeUserForClient(serverUser), role: "developer", dbKey: effectiveDbKey },
        isVerifiedDeveloper: true,
        isRecentlyReauthenticated: true,
        reauthExpiresAt: stampResult?.expiresAt || createdSession.session.lastReauthAt + REAUTH_FRESH_WINDOW_MS,
        devEntryEnabled: true,
        devSandboxEnabled: isDevSandboxEnabled(),
        ...(stampResult?.saved
          ? {
              freshReauthNonce: stampResult.nonce,
            }
          : {}),
      });
      return;
    }

    // Method (b): Hashed developer account record in server_users.json
    const passkey = typeof req.body?.passkey === "string" ? req.body.passkey : "";
    const username = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
    const totpCode = typeof req.body?.totpCode === "string" ? req.body.totpCode.trim() : "";

    const authRes = authenticateDeveloperEntry({ username, passkey, ip });

    if (!authRes.success || !authRes.user || authRes.user.role !== "developer") {
      if (authRes.locked) {
        if (authRes.retryAfterSec) res.setHeader("Retry-After", String(authRes.retryAfterSec));
        res.status(429).json({ error: authRes.error || DEV_RATE_LIMIT_ERROR });
        return;
      }
      const status = authRes.status || 401;
      res.status(status).json({ error: authRes.error || UNIFORM_LOGIN_ERROR });
      return;
    }

    // Optional Two-Factor Authentication check if enabled on developer account
    const tfaCheck = verifyUser2FAIfEnabled(authRes.user.id!, totpCode || undefined);
    if (tfaCheck.required) {
      if (!totpCode) {
        res.status(401).json({
          error: "Pengesahan dua faktor (2FA) diperlukan. Masukkan kod 6-digit Authenticator anda.",
          code: "TWO_FACTOR_REQUIRED",
          requires2FA: true,
        });
        return;
      }
      if (!tfaCheck.valid) {
        const failRes = recordDevAuthFailure(`dev_entry:${username}`, ip);
        logSecurityAudit({
          jenisKejadian: failRes.newlyLocked ? "AKAUN_DIKUNCI" : "TWO_FACTOR_AUTH",
          uid: authRes.user.id,
          role: "developer",
          ip,
          status: failRes.newlyLocked ? "DISEKAT" : "GAGAL",
          butiran: "dev_2fa_invalid",
        });
        if (failRes.newlyLocked) {
          res.setHeader("Retry-After", String(failRes.retryAfterSec));
          res.status(429).json({ error: DEV_RATE_LIMIT_ERROR, code: "LOCKED" });
          return;
        }
        res.status(401).json({
          error: "Kod pengesahan 2FA tidak sah atau telah tamat tempoh.",
          code: "INVALID_TWO_FACTOR_CODE",
          requires2FA: true,
        });
        return;
      }
      logSecurityAudit({
        jenisKejadian: "TWO_FACTOR_AUTH",
        uid: authRes.user.id,
        role: "developer",
        ip,
        status: "BERJAYA",
        butiran: "dev_2fa_verified",
      });
    }

    const effectivePasskeyDb = isDevSandboxEnabled()
      ? DEV_SANDBOX_DB_ID
      : (authRes.user.dbKey && authRes.user.dbKey !== DEV_SANDBOX_DB_ID
          ? authRes.user.dbKey
          : `pengekosan_userdb_${authRes.user.id}`);

    if (isDevSandboxEnabled()) {
      registerServerDatabase({
        databaseId: DEV_SANDBOX_DB_ID,
        companyName: "DEVELOPER SANDBOX",
        ownerId: authRes.user.id!,
        ownerUsername: authRes.user.username!,
        isProtected: true,
      });
    }

    const createdSession = createServerSession({
      uid: authRes.user.id!,
      username: authRes.user.username!,
      role: "developer",
      activeDbKey: effectivePasskeyDb,
      markReauthenticated: true,
    });
    setSessionCookie(req, res, createdSession.token);
    const stampResult = req.body?.stampReauth ? stampSessionReauth(createdSession.session.sid) : null;

    logSecurityAudit({
      jenisKejadian: "AKSES_PEMBANGUN_BERJAYA",
      uid: authRes.user.id,
      role: "developer",
      ip,
      status: "BERJAYA",
      butiran: "dev_entry_passkey",
    });

    res.json({
      success: true,
      sessionToken: createdSession.token,
      csrfToken: createdSession.csrfToken,
      user: { ...authRes.user, role: "developer", dbKey: effectivePasskeyDb },
      isVerifiedDeveloper: true,
      isRecentlyReauthenticated: true,
      reauthExpiresAt: stampResult?.expiresAt || createdSession.session.lastReauthAt + REAUTH_FRESH_WINDOW_MS,
      devEntryEnabled: true,
      devSandboxEnabled: isDevSandboxEnabled(),
      ...(stampResult?.saved
        ? {
            freshReauthNonce: stampResult.nonce,
          }
        : {}),
    });
  } catch {
    res.status(500).json({ error: "Ralat pelayan." });
  }
});

// 3c-audit. Developer security audit log endpoint (verified developer only, no credentials/tokens)
app.get("/api/auth/dev-audit", async (req, res) => {
  const actor = await resolveVerifiedActor(req);
  if (!actor || actor.role !== "developer" || !isVerifiedDeveloperActor(actor)) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }
  res.json({ logs: loadSecurityAuditLogs().slice(-100) });
});

// 3d. Logout endpoint revokes server session immediately & clears HttpOnly cookie (CSRF-protected for authenticated cookies)
app.post("/api/auth/logout", async (req, res) => {
  const actor = await resolveVerifiedActor(req);
  if (actor && !verifyCsrfForMutation(req, actor)) {
    logSecurityAudit({
      jenisKejadian: "PERMINTAAN_SEKAT",
      uid: actor.uid,
      role: actor.role,
      ip: getClientIp(req),
      status: "DISEKAT",
      butiran: "logout_csrf_or_origin_denied",
    });
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }
  if (actor?.sid) {
    revokeSessionBySid(actor.sid);
  }
  clearSessionCookie(req, res);
  if (actor) {
    logSecurityAudit({
      jenisKejadian: "LOGOUT",
      uid: actor.uid,
      role: actor.role,
      ip: getClientIp(req),
      status: "BERJAYA",
    });
  }
  res.json({ success: true });
});

// 3e. Explicit Re-Authentication endpoint before sensitive actions
app.post("/api/auth/reauthenticate", async (req, res) => {
  const ip = getClientIp(req);
  const actor = await resolveVerifiedActor(req);
  if (!actor) {
    const expiredCheck = inspectExpiredDeveloperTokenFromReq(req);
    if (expiredCheck.isExpiredDeveloperSession) {
      res.status(401).json({
        error: "Sesi pembangun telah tamat tempoh. Sila sahkan semula.",
        code: "SESSION_EXPIRED",
      });
      return;
    }
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }
  if (!verifyCsrfForMutation(req, actor)) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }

  const { username, password, passkey, idToken } = req.body || {};
  const suppliedPassword = typeof password === "string" ? password : (typeof passkey === "string" ? passkey : "");
  const suppliedUsername = typeof username === "string" ? username.trim() : "";

  if (actor.role === "developer" && (!idToken || suppliedUsername || suppliedPassword)) {
    let effectiveActor = actor;
    let mintedSessionToken: string | undefined;
    let mintedCsrfToken: string | undefined;

    if (!effectiveActor.sid) {
      const created = createServerSession({
        uid: actor.uid,
        username: actor.username,
        role: "developer",
        activeDbKey: actor.activeDbKey || DEV_SANDBOX_DB_ID,
      });
      setSessionCookie(req, res, created.token);
      mintedSessionToken = created.token;
      mintedCsrfToken = created.csrfToken;
      effectiveActor = {
        ...actor,
        sid: created.session.sid,
        csrfToken: created.csrfToken,
        sessionToken: created.token,
      };
    }

    const devReauth = reauthenticateDeveloperSession({
      actor: effectiveActor,
      username: suppliedUsername,
      password: suppliedPassword,
      ip,
    });
    if (!devReauth.success) {
      console.warn(`[DevReauth] Failed reason=${devReauth.reasonCode || "UNKNOWN"} status=${devReauth.status}`);
      if (devReauth.locked && devReauth.retryAfterSec) {
        res.setHeader("Retry-After", String(devReauth.retryAfterSec));
      }
      res.status(devReauth.status).json({
        error: devReauth.error || UNIFORM_LOGIN_ERROR,
        ...(devReauth.reasonCode === "USERNAME_EMPTY" ? { code: "USERNAME_EMPTY" } : {}),
        ...(devReauth.locked ? { code: "LOCKED" } : {}),
      });
      return;
    }
    res.json({
      success: true,
      isRecentlyReauthenticated: true,
      reauthExpiresAt: devReauth.reauthExpiresAt,
      freshReauthNonce: devReauth.freshReauthNonce,
      ...(mintedSessionToken ? { sessionToken: mintedSessionToken, csrfToken: mintedCsrfToken } : {}),
    });
    return;
  }

  const ok = await hasRecentReauth(req, { ...actor, isRecentlyReauthenticated: false }, suppliedPassword, idToken);
  if (!ok) {
    logSecurityAudit({
      jenisKejadian: "PENGESAHAN_SEMULA",
      uid: actor.uid,
      role: actor.role,
      ip,
      status: "GAGAL",
    });
    res.status(401).json({ error: UNIFORM_LOGIN_ERROR });
    return;
  }

  const stamped = actor.sid ? stampSessionReauth(actor.sid) : { saved: false };
  if (actor.sid && !stamped.saved) {
    res.status(500).json({ error: "Gagal menyimpan status pengesahan sesi." });
    return;
  }
  logSecurityAudit({
    jenisKejadian: "PENGESAHAN_SEMULA",
    uid: actor.uid,
    role: actor.role,
    ip,
    status: "BERJAYA",
  });
  res.json({
    success: true,
    isRecentlyReauthenticated: true,
    reauthExpiresAt: stamped.expiresAt,
    freshReauthNonce: stamped.nonce,
  });
});

// 3e-2FA. Optional TOTP Two-Factor Authentication Endpoints (Admin & Developer opt-in)
app.get("/api/auth/2fa/status", async (req, res) => {
  if (!checkEndpointRateLimit("2fa-status", getClientIp(req), 60)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak permintaan." });
    return;
  }
  const actor = await resolveVerifiedActor(req);
  if (!actor) {
    res.status(401).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }
  res.json(get2FAStatusForUser(actor.uid));
});

app.post("/api/auth/2fa/setup", async (req, res) => {
  const ip = getClientIp(req);
  if (!checkEndpointRateLimit("2fa-setup", ip, 15)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak permintaan persediaan 2FA." });
    return;
  }
  const actor = await resolveVerifiedActor(req);
  if (!actor || !verifyCsrfForMutation(req, actor)) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }
  if (actor.role !== "admin" && actor.role !== "developer") {
    res.status(403).json({ error: "Pengesahan dua faktor (2FA) hanya disokong untuk akaun Pentadbir dan Pembangun." });
    return;
  }
  const setupRes = setupOptional2FA(actor.uid);
  if (!setupRes.success) {
    res.status(400).json({ error: setupRes.error });
    return;
  }
  logSecurityAudit({
    jenisKejadian: "TWO_FACTOR_AUTH",
    uid: actor.uid,
    role: actor.role,
    ip,
    status: "BERJAYA",
    butiran: "2fa_setup_generated",
  });
  res.json({
    success: true,
    manualSecret: setupRes.manualSecret,
    otpAuthUri: setupRes.otpAuthUri,
  });
});

app.post("/api/auth/2fa/enable", async (req, res) => {
  const ip = getClientIp(req);
  if (!checkEndpointRateLimit("2fa-enable", ip, 20)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak percubaan pengesahan 2FA." });
    return;
  }
  const actor = await resolveVerifiedActor(req);
  if (!actor || !verifyCsrfForMutation(req, actor)) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }
  const code = typeof req.body?.totpCode === "string" ? req.body.totpCode : "";
  const enableRes = enableOptional2FA(actor.uid, code);
  if (!enableRes.success) {
    logSecurityAudit({
      jenisKejadian: "TWO_FACTOR_AUTH",
      uid: actor.uid,
      role: actor.role,
      ip,
      status: "GAGAL",
      butiran: "2fa_enable_failed",
    });
    res.status(400).json({ error: enableRes.error });
    return;
  }
  logSecurityAudit({
    jenisKejadian: "TWO_FACTOR_AUTH",
    uid: actor.uid,
    role: actor.role,
    ip,
    status: "BERJAYA",
    butiran: "2fa_enabled",
  });
  res.json({ success: true, enabled: true });
});

app.post("/api/auth/2fa/disable", async (req, res) => {
  const ip = getClientIp(req);
  if (!checkEndpointRateLimit("2fa-disable", ip, 15)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak permintaan." });
    return;
  }
  const actor = await resolveVerifiedActor(req);
  if (!actor || !verifyCsrfForMutation(req, actor)) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }
  const disableRes = disableOptional2FA(actor.uid, {
    currentPassword: typeof req.body?.currentPassword === "string" ? req.body.currentPassword : undefined,
    totpCode: typeof req.body?.totpCode === "string" ? req.body.totpCode : undefined,
  });
  if (!disableRes.success) {
    logSecurityAudit({
      jenisKejadian: "TWO_FACTOR_AUTH",
      uid: actor.uid,
      role: actor.role,
      ip,
      status: "GAGAL",
      butiran: "2fa_disable_failed",
    });
    res.status(400).json({ error: disableRes.error });
    return;
  }
  logSecurityAudit({
    jenisKejadian: "TWO_FACTOR_AUTH",
    uid: actor.uid,
    role: actor.role,
    ip,
    status: "BERJAYA",
    butiran: "2fa_disabled",
  });
  res.json({ success: true, enabled: false });
});

// 3f. Password Reset Request & Confirm (Non-enumerating, single-use hashed token, 30-min TTL)
app.post("/api/auth/password-reset/request", (req, res) => {
  const ip = getClientIp(req);
  if (!checkAuthEndpointRateLimit(ip, 5)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak permintaan tetapan semula. Sila cuba sebentar lagi." });
    return;
  }

  const identifier = typeof req.body?.emailOrUsername === "string"
    ? req.body.emailOrUsername
    : (typeof req.body?.email === "string" ? req.body.email : "");
  createPasswordResetRequest(identifier);

  logSecurityAudit({
    jenisKejadian: "TETAP_SEMULA_KATA_LALUAN",
    ip,
    status: "BERJAYA",
    butiran: "request_processed",
  });

  // Always return identical non-enumerating response
  res.json({
    success: true,
    message: "Jika akaun yang sepadan ditemui, arahan tetapan semula kata laluan telah dijana (sah selama 30 minit).",
  });
});

app.post("/api/auth/password-reset/confirm", (req, res) => {
  const ip = getClientIp(req);
  if (!checkAuthEndpointRateLimit(ip, 10)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak percubaan. Sila tunggu sebentar." });
    return;
  }

  const { token, newPassword } = req.body || {};
  const result = confirmPasswordReset(String(token || ""), String(newPassword || ""));
  if (!result.success) {
    logSecurityAudit({
      jenisKejadian: "TETAP_SEMULA_KATA_LALUAN",
      ip,
      status: "GAGAL",
    });
    res.status(400).json({ error: result.error });
    return;
  }

  logSecurityAudit({
    jenisKejadian: "TETAP_SEMULA_KATA_LALUAN",
    ip,
    status: "BERJAYA",
    butiran: "password_updated_sessions_revoked",
  });
  res.json({ success: true, message: "Kata laluan berjaya ditetapkan semula." });
});

// 4. Change Password (and optional username) — preserves current actor's session after revoking other sessions
app.post("/api/auth/change-password", async (req, res) => {
  const ip = getClientIp(req);
  try {
    const actor = await resolveVerifiedActor(req);
    if (!actor || !verifyCsrfForMutation(req, actor)) {
      res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
      return;
    }

    const { userId, currentPassword, newPassword, newUsername } = req.body || {};
    const targetId = typeof userId === "string" && userId.trim() ? userId.trim() : actor.uid;
    // Strict self-only guard: nobody (including Developer) can alter or bypass another account's password
    if (actor.uid !== targetId) {
      res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
      return;
    }

    const result = changeUserPassword(
      targetId,
      String(currentPassword || ""),
      String(newPassword || ""),
      typeof newUsername === "string" ? newUsername : undefined,
      ip,
      { deferSessionRotation: true }
    );
    if (!result.success || !result.user) {
      logSecurityAudit({
        jenisKejadian: result.locked ? "AKAUN_DIKUNCI" : "TUKAR_KATA_LALUAN",
        uid: actor.uid,
        role: actor.role,
        ip,
        status: result.locked ? "DISEKAT" : "GAGAL",
        ...(result.code ? { butiran: result.code } : {}),
      });
      if (result.locked && result.retryAfterSec) {
        res.setHeader("Retry-After", String(result.retryAfterSec));
      }
      res.status(result.status || 400).json({
        error: result.error,
        ...(result.code ? { code: result.code } : {}),
        ...(result.locked ? { locked: true, retryAfterSec: result.retryAfterSec } : {}),
      });
      return;
    }

    const rotated = rotateSessionAfterCredentialChange({
      uid: actor.uid,
      username: result.user.username || actor.username,
      role: (result.user.role || actor.role) as ServerUserRole,
      activeDbKey: actor.activeDbKey || result.user.dbKey || "",
      markReauthenticated: true,
    });
    if (!rotated.success || !rotated.token) {
      rollbackCredentialUpdate(result._rollbackSnapshot);
      res.status(500).json({
        error: "Gagal mengemas kini sesi log masuk. Tiada perubahan disimpan.",
        code: "SESSION_ROTATION_FAILED",
      });
      return;
    }

    setSessionCookie(req, res, rotated.token);

    logSecurityAudit({
      jenisKejadian: "TUKAR_KATA_LALUAN",
      uid: actor.uid,
      role: actor.role,
      ip,
      status: "BERJAYA",
    });
    res.json({
      success: true,
      message: "Maklumat log masuk dikemas kini. Gunakan nama pengguna dan kata laluan baharu pada log masuk seterusnya.",
      user: {
        ...result.user,
        dbKey: actor.activeDbKey || result.user.dbKey || "",
      },
      sessionToken: rotated.token,
      csrfToken: rotated.csrfToken,
    });
  } catch {
    res.status(500).json({ error: "Ralat pelayan semasa mengemas kini kata laluan." });
  }
});

// 5. Link / Set Manual Credentials for Authenticated Account (only when manual password is not yet set)
app.post("/api/auth/link-manual", async (req, res) => {
  try {
    const actor = await resolveVerifiedActor(req);
    if (!actor || !verifyCsrfForMutation(req, actor)) {
      res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
      return;
    }

    const { userId, username, password } = req.body || {};
    const targetId = typeof userId === "string" && userId.trim() ? userId.trim() : actor.uid;
    if (actor.uid !== targetId) {
      res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
      return;
    }

    const result = setOrLinkManualCredentialsForUser(
      targetId,
      String(username || ""),
      String(password || ""),
      { deferSessionRotation: true }
    );
    if (!result.success || !result.user) {
      res.status(400).json({ error: result.error, ...(result.code ? { code: result.code } : {}) });
      return;
    }

    const rotated = rotateSessionAfterCredentialChange({
      uid: actor.uid,
      username: result.user.username || actor.username,
      role: (result.user.role || actor.role) as ServerUserRole,
      activeDbKey: actor.activeDbKey || result.user.dbKey || "",
      markReauthenticated: true,
    });
    if (!rotated.success || !rotated.token) {
      rollbackCredentialUpdate(result._rollbackSnapshot);
      res.status(500).json({
        error: "Gagal mengemas kini sesi log masuk. Tiada perubahan disimpan.",
        code: "SESSION_ROTATION_FAILED",
      });
      return;
    }
    setSessionCookie(req, res, rotated.token);

    res.json({
      success: true,
      message: "Maklumat log masuk dikemas kini. Gunakan nama pengguna dan kata laluan baharu pada log masuk seterusnya.",
      user: {
        ...result.user,
        dbKey: actor.activeDbKey || result.user.dbKey || "",
      },
      sessionToken: rotated.token,
      csrfToken: rotated.csrfToken,
    });
  } catch {
    res.status(500).json({ error: "Ralat pelayan semasa memautkan akaun." });
  }
});

// 5-pre. List company users for Admin/Developer RBAC matrix (sanitized, zero hashes)
app.get("/api/admin/users", async (req, res) => {
  const actor = await resolveVerifiedActor(req);
  if (!actor || (actor.role !== "admin" && actor.role !== "developer")) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }
  const users = listUsersForAdmin({
    actorRole: actor.role,
    actorDbKey: actor.activeDbKey,
  });
  res.json({ users });
});

// 5a. Admin Role Assignment Endpoint (Server-verified admin + fresh re-auth required)
app.post("/api/admin/users/role", async (req, res) => {
  const actor = await resolveVerifiedActor(req);
  if (!actor || !verifyCsrfForMutation(req, actor)) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }

  if (actor.role !== "admin" && actor.role !== "developer") {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }

  const { targetUserId, newRole, reauthPassword, reauthIdToken } = req.body || {};
  const reauthOk = await hasRecentReauth(req, actor, reauthPassword, reauthIdToken);
  if (!reauthOk) {
    res.status(403).json({
      error: "Pengesahan semula diperlukan sebelum mengubah peranan pengguna.",
      code: "REAUTH_REQUIRED",
    });
    return;
  }

  const result = updateUserRoleByAdmin({
    actorId: actor.uid,
    actorRole: actor.role,
    actorDbKey: actor.activeDbKey,
    targetUserId: String(targetUserId || ""),
    newRole: String(newRole || ""),
  });

  if (!result.success) {
    logSecurityAudit({
      jenisKejadian: "TUKAR_PERANAN",
      uid: actor.uid,
      role: actor.role,
      ip: getClientIp(req),
      status: "GAGAL",
    });
    res.status(403).json({ error: result.error || DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }

  logSecurityAudit({
    jenisKejadian: "TUKAR_PERANAN",
    uid: actor.uid,
    role: actor.role,
    ip: getClientIp(req),
    status: "BERJAYA",
    butiran: `target=${String(targetUserId || "").slice(0, 8)}->${newRole}`,
  });
  res.json({ success: true, user: result.user });
});

// 5b. Active Database Selection, Listing, Inspect, Clone & Registration Endpoints (Server-Authorized)
app.get("/api/databases/list", async (req, res) => {
  if (!checkEndpointRateLimit("db-list", getClientIp(req), 60)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak permintaan." });
    return;
  }
  const actor = await resolveVerifiedActor(req);
  if (!actor) {
    const expiredCheck = inspectExpiredDeveloperTokenFromReq(req);
    if (expiredCheck.isExpiredDeveloperSession) {
      res.status(401).json({
        error: DELETE_REJECT_MESSAGES.SESSION_EXPIRED,
        code: "SESSION_EXPIRED",
        sessionExpired: true,
      });
      return;
    }
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }
  if (actor.role !== "developer" || !isVerifiedDeveloperActor(actor) || !isDevSandboxEnabled()) {
    logSecurityAudit({
      jenisKejadian: "AKSES_PEMBANGUN_GAGAL",
      uid: actor.uid,
      role: actor.role,
      ip: getClientIp(req),
      status: "DISEKAT",
      butiran: "databases_list_denied",
    });
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }
  const activeCounts = getActiveSessionCountsByDatabase();
  const records = loadServerDatabases().map((rec) => {
    const activeCount = activeCounts[rec.databaseId] || 0;
    const isActiveInSession = rec.databaseId === actor.activeDbKey || activeCount > 0;
    const cls = classifyDatabaseRecord(rec.databaseId, rec.companyName);
    return {
      databaseId: rec.databaseId,
      companyName: rec.companyName,
      ownerId: rec.ownerId,
      ownerUsername: rec.ownerUsername,
      category: cls.category,
      isSystemInfrastructure: cls.isSystemInfrastructure,
      isBusinessDatabase: cls.isBusinessDatabase,
      isDefaultBusinessDb: cls.isDefaultBusinessDb,
      isDeletableByDeveloper: cls.isDeletableByDeveloper,
      classificationLabelMs: cls.labelMs,
      classificationLabelEn: cls.labelEn,
      isProtected: cls.isSystemInfrastructure,
      isDefault: cls.isDefaultBusinessDb,
      isSandbox: rec.databaseId === DEV_SANDBOX_DB_ID,
      activeSessionCount: activeCount,
      isActiveInSession,
      createdAt: rec.createdAt,
    };
  });
  res.json({
    databases: records,
    deletedDbKeys: getDeletedDatabaseTombstoneKeys(),
  });
});

app.get("/api/databases/active", async (req, res) => {
  if (!checkEndpointRateLimit("db-active-get", getClientIp(req), 120)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak permintaan." });
    return;
  }
  const actor = await resolveVerifiedActor(req);
  if (!actor) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }
  res.json({ activeDbKey: actor.activeDbKey });
});

app.post("/api/databases/active", async (req, res) => {
  if (!checkEndpointRateLimit("db-active-post", getClientIp(req), 60)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak permintaan." });
    return;
  }
  const actor = await resolveVerifiedActor(req);
  if (!actor || !verifyCsrfForMutation(req, actor)) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }

  const databaseId = typeof req.body?.databaseId === "string" ? req.body.databaseId.trim() : "";
  if (isDatabaseDeletedTombstone(databaseId) && !findServerDatabaseById(databaseId)) {
    res.status(410).json({ error: "Pangkalan data ini telah dipadam dan tidak boleh diakses." });
    return;
  }
  if (!databaseId || !canUserAccessDatabase(actor, databaseId)) {
    logSecurityAudit({
      jenisKejadian: "AKSES_PEMBANGUN_GAGAL",
      uid: actor.uid,
      role: actor.role,
      ip: getClientIp(req),
      status: "DISEKAT",
      butiran: `databases_active_denied=${hashIdShort(databaseId)}`,
    });
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }

  let nextToken = "";
  let nextCsrfToken = actor.csrfToken;
  if (actor.sid) {
    const updated = updateSessionActiveDb(actor.sid, databaseId);
    if (updated) {
      nextToken = updated.token;
      nextCsrfToken = updated.session.csrfToken;
      setSessionCookie(req, res, nextToken);
    }
  }
  if (!nextToken) {
    const created = createServerSession({
      uid: actor.uid,
      username: actor.username,
      role: actor.role as ServerUserRole,
      activeDbKey: databaseId,
    });
    nextToken = created.token;
    nextCsrfToken = created.csrfToken;
    setSessionCookie(req, res, nextToken);
  }

  res.json({
    success: true,
    activeDbKey: databaseId,
    sessionToken: nextToken,
    ...(nextCsrfToken ? { csrfToken: nextCsrfToken } : {}),
  });
});

app.post("/api/databases/inspect", async (req, res) => {
  if (!checkEndpointRateLimit("db-inspect", getClientIp(req), 60)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak permintaan." });
    return;
  }
  const actor = await resolveVerifiedActor(req);
  if (!actor) {
    const expiredCheck = inspectExpiredDeveloperTokenFromReq(req);
    if (expiredCheck.isExpiredDeveloperSession) {
      res.status(401).json({
        error: DELETE_REJECT_MESSAGES.SESSION_EXPIRED,
        code: "SESSION_EXPIRED",
        sessionExpired: true,
      });
      return;
    }
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }
  if (actor.role !== "developer" || !isVerifiedDeveloperActor(actor) || !isDevSandboxEnabled() || !verifyCsrfForMutation(req, actor)) {
    logSecurityAudit({
      jenisKejadian: "AKSES_PEMBANGUN_GAGAL",
      uid: actor.uid,
      role: actor.role,
      ip: getClientIp(req),
      status: "DISEKAT",
      butiran: "databases_inspect_denied",
    });
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }

  const databaseId = typeof req.body?.databaseId === "string" ? req.body.databaseId.trim() : "";
  if (!databaseId || !/^[a-zA-Z0-9_\-:.]{1,128}$/.test(databaseId)) {
    res.status(400).json({ error: "Kunci pangkalan data tidak sah." });
    return;
  }
  const dbRec = findServerDatabaseById(databaseId);
  if (!dbRec) {
    res.status(404).json({ error: "Pangkalan data tidak ditemui." });
    return;
  }
  logSecurityAudit({
    jenisKejadian: "AKSES_PEMBANGUN_BERJAYA",
    uid: actor.uid,
    role: actor.role,
    ip: getClientIp(req),
    status: "BERJAYA",
    butiran: `inspect_db=${hashIdShort(databaseId)}`,
  });
  res.json({ success: true, databaseId: dbRec.databaseId, companyName: dbRec.companyName });
});

app.post("/api/databases/clone-sandbox", async (req, res) => {
  if (!checkEndpointRateLimit("db-clone-sandbox", getClientIp(req), 30)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak permintaan." });
    return;
  }
  const actor = await resolveVerifiedActor(req);
  if (!actor) {
    const expiredCheck = inspectExpiredDeveloperTokenFromReq(req);
    if (expiredCheck.isExpiredDeveloperSession) {
      res.status(401).json({
        error: DELETE_REJECT_MESSAGES.SESSION_EXPIRED,
        code: "SESSION_EXPIRED",
        sessionExpired: true,
      });
      return;
    }
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }
  if (actor.role !== "developer" || !isVerifiedDeveloperActor(actor) || !isDevSandboxEnabled() || !verifyCsrfForMutation(req, actor)) {
    logSecurityAudit({
      jenisKejadian: "AKSES_PEMBANGUN_GAGAL",
      uid: actor.uid,
      role: actor.role,
      ip: getClientIp(req),
      status: "DISEKAT",
      butiran: "databases_clone_sandbox_denied",
    });
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }

  const databaseId = typeof req.body?.databaseId === "string" ? req.body.databaseId.trim() : "";
  if (!databaseId || !/^[a-zA-Z0-9_\-:.]{1,128}$/.test(databaseId)) {
    res.status(400).json({ error: "Kunci pangkalan data sumber tidak sah." });
    return;
  }
  if (actor.sid) {
    const updated = updateSessionActiveDb(actor.sid, DEV_SANDBOX_DB_ID);
    if (updated) {
      setSessionCookie(req, res, updated.token);
    }
  }
  logSecurityAudit({
    jenisKejadian: "AKSES_PEMBANGUN_BERJAYA",
    uid: actor.uid,
    role: actor.role,
    ip: getClientIp(req),
    status: "BERJAYA",
    butiran: `clone_sandbox_src=${hashIdShort(databaseId)}`,
  });
  res.json({ success: true, sandboxDbId: DEV_SANDBOX_DB_ID, sourceDatabaseId: databaseId });
});

app.post("/api/databases/register", async (req, res) => {
  if (!checkEndpointRateLimit("db-register", getClientIp(req), 60)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak permintaan." });
    return;
  }
  const actor = await resolveVerifiedActor(req);
  if (!actor || !verifyCsrfForMutation(req, actor)) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }

  if (hasPrototypePollutionKey(req.body) || containsSuspiciousScriptOrHtml(req.body?.companyName)) {
    logSecurityAudit({
      jenisKejadian: "VALIDASI_GAGAL",
      uid: actor.uid,
      role: actor.role,
      ip: getClientIp(req),
      status: "DISEKAT",
      butiran: "databases_register_unsafe_input",
    });
    res.status(400).json({ error: "Input pendaftaran pangkalan data tidak sah." });
    return;
  }

  const databaseId = typeof req.body?.databaseId === "string" ? req.body.databaseId.trim() : "";
  const companyName = sanitizePlainText(req.body?.companyName, 128);
  const explicitCreate = Boolean(req.body?.explicitCreate);
  const isVerifiedDev = actor.role === "developer" && isVerifiedDeveloperActor(actor) && isDevSandboxEnabled();

  if (!databaseId || !/^[a-zA-Z0-9_\-:.]{1,128}$/.test(databaseId) || classifyDatabaseRecord(databaseId).isSystemInfrastructure) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }

  if (explicitCreate && !isVerifiedDev) {
    logSecurityAudit({
      jenisKejadian: "AKSES_PEMBANGUN_GAGAL",
      uid: actor.uid,
      role: actor.role,
      ip: getClientIp(req),
      status: "DISEKAT",
      butiran: "databases_register_explicit_create_denied",
    });
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }

  if (isDatabaseDeletedTombstone(databaseId)) {
    if (explicitCreate && isVerifiedDev) {
      clearDatabaseDeletedTombstone(databaseId);
    } else {
      res.status(410).json({ error: "Pangkalan data ini telah dipadam dan tidak boleh ditulis semula." });
      return;
    }
  }

  const existing = findServerDatabaseById(databaseId);
  if (existing && existing.ownerId !== actor.uid && !isVerifiedDev) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }

  if (!isVerifiedDev) {
    const isOwnAlias =
      canUserAccessDatabase(actor, databaseId) ||
      databaseId === actor.activeDbKey ||
      databaseId === `pengekosan_userdb_${actor.uid}` ||
      (actor.uid === "admin-default" &&
        (databaseId === "pengekosan_company_db_school_enterprise" ||
          databaseId === "pengekosan_company_db_school_enterprise_admin_default"));
    if (!isOwnAlias) {
      logSecurityAudit({
        jenisKejadian: "AKSES_PEMBANGUN_GAGAL",
        uid: actor.uid,
        role: actor.role,
        ip: getClientIp(req),
        status: "DISEKAT",
        butiran: `databases_register_cross_tenant_denied=${hashIdShort(databaseId)}`,
      });
      res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
      return;
    }
  }

  const record = registerServerDatabase({
    databaseId,
    companyName: companyName || databaseId,
    ownerId: existing ? existing.ownerId : actor.uid,
    ownerUsername: existing ? existing.ownerUsername : actor.username,
    allowNameUpdate: Boolean(existing && (existing.ownerId === actor.uid || isVerifiedDev)),
  });

  res.json({ success: true, databaseId: record.databaseId });
});

// 5c. Per-Database Mr Cost Chat History Isolation Endpoints
app.get("/api/mrcost/history", async (req, res) => {
  const actor = await resolveVerifiedActor(req);
  const requestedDbId = typeof req.query?.databaseId === "string" ? req.query.databaseId.trim() : "";
  const targetDbId = requestedDbId || actor?.activeDbKey || "";

  if (isDatabaseDeletedTombstone(targetDbId) && !findServerDatabaseById(targetDbId)) {
    res.status(410).json({ error: "Pangkalan data ini telah dipadam." });
    return;
  }

  if (!actor || !targetDbId || !canUserAccessDatabase(actor, targetDbId)) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }

  const all = loadServerChatHistories();
  const messages = (all[targetDbId] || []).filter((m) => m.databaseId === targetDbId);
  res.json({ databaseId: targetDbId, messages });
});

app.post("/api/mrcost/history", async (req, res) => {
  const actor = await resolveVerifiedActor(req);
  if (!actor || !verifyCsrfForMutation(req, actor)) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }

  const requestedDbId = typeof req.body?.databaseId === "string" ? req.body.databaseId.trim() : "";
  const targetDbId = requestedDbId || actor.activeDbKey || "";

  if (isDatabaseDeletedTombstone(targetDbId) && !findServerDatabaseById(targetDbId)) {
    res.status(410).json({ error: "Pangkalan data ini telah dipadam." });
    return;
  }

  if (!targetDbId || !canUserAccessDatabase(actor, targetDbId)) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }

  const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const sanitizedMessages: ServerChatHistoryItem[] = rawMessages
    .filter((m: any) => m && typeof m.text === "string" && (!m.databaseId || m.databaseId === targetDbId))
    .slice(-60)
    .map((m: any) => ({
      id: String(m.id || `msg-${Date.now()}`).slice(0, 64),
      role: m.role === "user" ? "user" : "model",
      text: String(m.text).slice(0, 20000),
      timestamp: typeof m.timestamp === "string" ? m.timestamp.slice(0, 64) : new Date().toISOString(),
      databaseId: targetDbId,
      ...(m.simulationProposal ? { simulationProposal: m.simulationProposal } : {}),
    }));

  const all = loadServerChatHistories();
  all[targetDbId] = sanitizedMessages;
  saveServerChatHistories(all);
  res.json({ success: true, databaseId: targetDbId, count: sanitizedMessages.length });
});

app.delete("/api/mrcost/history", async (req, res) => {
  const actor = await resolveVerifiedActor(req);
  if (!actor || !verifyCsrfForMutation(req, actor)) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }

  const requestedDbId = typeof req.query?.databaseId === "string" ? req.query.databaseId.trim() : "";
  const targetDbId = requestedDbId || actor.activeDbKey || "";

  if (isDatabaseDeletedTombstone(targetDbId) && !findServerDatabaseById(targetDbId)) {
    res.status(410).json({ error: "Pangkalan data ini telah dipadam." });
    return;
  }

  if (!targetDbId || !canUserAccessDatabase(actor, targetDbId)) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }

  purgeServerChatHistoryForDatabase(targetDbId);
  res.json({ success: true, databaseId: targetDbId });
});

// 6. Delete Company Database - Strictly Verified Developer Only (uses active verified Developer session; only prompts re-auth if session expired)
app.post("/api/auth/delete-company-db", async (req, res) => {
  const ip = getClientIp(req);
  const bodyDbKey = typeof req.body?.dbKey === "string" ? req.body.dbKey.trim() : "";

  const formatDevReject = (reasonCode: DeleteRejectReasonCode) =>
    `Padam ditolak: ${DELETE_REJECT_MESSAGES[reasonCode]}`;

  try {
    const actor = await resolveVerifiedActor(req);
    if (!actor) {
      const expiredCheck = inspectExpiredDeveloperTokenFromReq(req);
      if (expiredCheck.isExpiredDeveloperSession) {
        logSecurityAudit({
          jenisKejadian: "PADAM_PANGKALAN_DATA",
          uid: expiredCheck.uid || "developer_expired",
          role: "developer",
          ip,
          status: "DISEKAT",
          butiran: `dbKey=${bodyDbKey || "none"} dbHash=${hashDatabaseIdShort(bodyDbKey)} reason=SESSION_EXPIRED`,
        });
        res.status(401).json({
          error: formatDevReject("SESSION_EXPIRED"),
          reasonCode: "SESSION_EXPIRED",
          code: "SESSION_EXPIRED",
          sessionExpired: true,
        });
        return;
      }

      logSecurityAudit({
        jenisKejadian: "PADAM_PANGKALAN_DATA",
        uid: "anonymous",
        role: "none",
        ip,
        status: "DISEKAT",
        butiran: `dbKey=${bodyDbKey || "none"} dbHash=${hashDatabaseIdShort(bodyDbKey)} reason=NOT_DEVELOPER`,
      });
      res.status(403).json({ error: "Padam ditolak oleh pelayan." });
      return;
    }

    const isDevAuthorized = actor.role === "developer" && isVerifiedDeveloperActor(actor) && isDevSandboxEnabled();

    if (!verifyCsrfForMutation(req, actor)) {
      logSecurityAudit({
        jenisKejadian: "PADAM_PANGKALAN_DATA",
        uid: actor.uid,
        role: actor.role,
        ip,
        status: "DISEKAT",
        butiran: `dbKey=${bodyDbKey || "none"} dbHash=${hashDatabaseIdShort(bodyDbKey)} reason=CSRF_FAILED`,
      });
      if (isDevAuthorized) {
        res.status(403).json({
          error: formatDevReject("CSRF_FAILED"),
          reasonCode: "CSRF_FAILED",
          code: "CSRF_FAILED",
        });
      } else {
        res.status(403).json({ error: "Padam ditolak oleh pelayan." });
      }
      return;
    }

    const {
      dbKey,
      companyName,
      confirmConfirmation,
      confirmTypedName,
      confirmPadamWord,
      confirmActiveDatabase,
      dbStatus,
    } = req.body || {};

    // Strict server-side authorization: ONLY verified developer (Alt+D) is permitted to delete databases
    const cleanDbKey = typeof dbKey === "string" ? dbKey.trim() : "";
    const targetDb = findServerDatabaseById(cleanDbKey);

    if (!isDevAuthorized) {
      logSecurityAudit({
        jenisKejadian: "PADAM_PANGKALAN_DATA",
        uid: actor.uid,
        role: actor.role,
        ip,
        status: "DISEKAT",
        butiran: `dbKey=${cleanDbKey || "none"} dbHash=${hashDatabaseIdShort(cleanDbKey)} reason=NOT_DEVELOPER`,
      });
      // Non-developers always see generic message only (never internal reason code)
      res.status(403).json({ error: "Padam ditolak oleh pelayan." });
      return;
    }

    // If actor authenticated purely via Firebase JWT without a server session, verify token age hasn't exceeded max session lifetime
    if (!actor.sid && actor.firebaseAuthTimeSec) {
      const tokenAgeMs = Date.now() - actor.firebaseAuthTimeSec * 1000;
      if (tokenAgeMs > 12 * 60 * 60 * 1000) {
        res.status(401).json({
          error: formatDevReject("SESSION_EXPIRED"),
          reasonCode: "SESSION_EXPIRED",
          code: "SESSION_EXPIRED",
          sessionExpired: true,
        });
        return;
      }
    }

    if (!cleanDbKey || !/^[a-zA-Z0-9_\-:.]{1,128}$/.test(cleanDbKey)) {
      logSecurityAudit({
        jenisKejadian: "PADAM_PANGKALAN_DATA",
        uid: actor.uid,
        role: actor.role,
        ip,
        status: "DISEKAT",
        butiran: `dbKey=${cleanDbKey || "empty"} dbHash=${hashDatabaseIdShort(cleanDbKey)} reason=ID_MISMATCH`,
      });
      res.status(400).json({
        error: formatDevReject("ID_MISMATCH"),
        reasonCode: "ID_MISMATCH",
      });
      return;
    }

    // Classify DB cleanly: block ONLY Core System Infrastructure, allow ANY registered Business Database
    const classification = classifyDatabaseRecord(
      cleanDbKey,
      targetDb?.companyName || (typeof companyName === "string" ? companyName : "")
    );

    if (classification.isSystemInfrastructure) {
      logSecurityAudit({
        jenisKejadian: "PADAM_PANGKALAN_DATA",
        uid: actor.uid,
        role: actor.role,
        ip,
        status: "DISEKAT",
        butiran: `dbKey=${cleanDbKey} dbHash=${hashDatabaseIdShort(cleanDbKey)} reason=INFRASTRUCTURE_PROTECTED`,
      });
      res.status(403).json({
        error: formatDevReject("INFRASTRUCTURE_PROTECTED"),
        reasonCode: "INFRASTRUCTURE_PROTECTED",
        code: "INFRASTRUCTURE_PROTECTED",
      });
      return;
    }

    if (isDatabaseDeletedTombstone(cleanDbKey) && !targetDb) {
      logSecurityAudit({
        jenisKejadian: "PADAM_PANGKALAN_DATA",
        uid: actor.uid,
        role: actor.role,
        ip,
        status: "DISEKAT",
        butiran: `dbKey=${cleanDbKey} dbHash=${hashDatabaseIdShort(cleanDbKey)} reason=ALREADY_DELETED`,
      });
      res.status(404).json({
        error: formatDevReject("ID_MISMATCH"),
        reasonCode: "ID_MISMATCH",
      });
      return;
    }

    const expectedName = (targetDb?.companyName || (typeof companyName === "string" ? companyName : "")).trim();
    const typedName = typeof confirmTypedName === "string" ? confirmTypedName.trim() : "";
    if (!confirmConfirmation || !expectedName || !typedName || typedName.toLowerCase() !== expectedName.toLowerCase()) {
      logSecurityAudit({
        jenisKejadian: "PADAM_PANGKALAN_DATA",
        uid: actor.uid,
        role: actor.role,
        ip,
        status: "DISEKAT",
        butiran: `dbKey=${cleanDbKey} dbHash=${hashDatabaseIdShort(cleanDbKey)} reason=ID_MISMATCH`,
      });
      res.status(400).json({
        error: formatDevReject("ID_MISMATCH"),
        reasonCode: "ID_MISMATCH",
      });
      return;
    }

    // Active database safeguard: require explicit active confirmation when deleting a currently active database
    const isDbCurrentlyActive =
      cleanDbKey === actor.activeDbKey || hasOtherActiveSessionsForDatabase(cleanDbKey, actor.sid);
    if (isDbCurrentlyActive && confirmActiveDatabase !== true) {
      logSecurityAudit({
        jenisKejadian: "PADAM_PANGKALAN_DATA",
        uid: actor.uid,
        role: actor.role,
        ip,
        status: "DISEKAT",
        butiran: `dbKey=${cleanDbKey} dbHash=${hashDatabaseIdShort(cleanDbKey)} reason=ACTIVE_CONFIRM_REQUIRED`,
      });
      res.status(400).json({
        error: "Padam ditolak: Pengesahan tambahan diperlukan kerana pangkalan data sedang aktif.",
        reasonCode: "REAUTH_MISSING",
        code: "ACTIVE_CONFIRM_REQUIRED",
        requireActiveConfirm: true,
      });
      return;
    }

    // Default business databases (e.g., SCHOOL ENTERPRISE / -default / _admin_default) require 'PADAM'
    // in addition to exact name confirmation, WITHOUT requiring a second Developer login when session is valid.
    if (classification.isDefaultBusinessDb) {
      const padamTyped = typeof confirmPadamWord === "string" ? confirmPadamWord.trim().toUpperCase() : "";
      if (padamTyped !== "PADAM") {
        logSecurityAudit({
          jenisKejadian: "PADAM_PANGKALAN_DATA",
          uid: actor.uid,
          role: actor.role,
          ip,
          status: "DISEKAT",
          butiran: `dbKey=${cleanDbKey} dbHash=${hashDatabaseIdShort(cleanDbKey)} reason=PADAM_REQUIRED`,
        });
        res.status(400).json({
          error: formatDevReject("PADAM_REQUIRED"),
          reasonCode: "PADAM_REQUIRED",
          code: "PADAM_REQUIRED",
        });
        return;
      }
    }

    // Clear any stale one-time nonce cleanly and execute atomic DB deletion (without auto-recreating or deleting users)
    invalidateFreshDefaultReauthNonce(actor.sid);
    const tx = deleteCompanyDatabaseTransactional(cleanDbKey);
    if (!tx.success) {
      logSecurityAudit({
        jenisKejadian: "PADAM_PANGKALAN_DATA",
        uid: actor.uid,
        role: actor.role,
        ip,
        status: "GAGAL",
        butiran: `dbKey=${cleanDbKey} dbHash=${hashDatabaseIdShort(cleanDbKey)} reason=SERVER_ERROR`,
      });
      res.status(500).json({
        error: formatDevReject("SERVER_ERROR"),
        reasonCode: "SERVER_ERROR",
        failedStep: tx.failedStep || "daftar pangkalan data",
      });
      return;
    }

    const chatPurge = purgeServerChatHistoryForDatabase(cleanDbKey);
    if (!chatPurge.ok) {
      rollbackCompanyDatabaseDelete(tx.rollbackSnapshot);
      logSecurityAudit({
        jenisKejadian: "PADAM_PANGKALAN_DATA",
        uid: actor.uid,
        role: actor.role,
        ip,
        status: "GAGAL",
        butiran: `dbKey=${cleanDbKey} dbHash=${hashDatabaseIdShort(cleanDbKey)} reason=SERVER_ERROR`,
      });
      res.status(500).json({
        error: formatDevReject("SERVER_ERROR"),
        reasonCode: "SERVER_ERROR",
        failedStep: "sejarah chat Mr Cost",
      });
      return;
    }

    purgeMrCostCacheForDatabase(cleanDbKey);

    // Tombstone deleted DB key to prevent stale writes or silent re-registration,
    // and invalidate all other sessions currently connected to this deleted database.
    markDatabaseDeletedTombstone(cleanDbKey, actor.uid);
    const terminatedSessions = revokeSessionsForDatabase(cleanDbKey, actor.sid);

    // If the currently active DB was deleted, switch developer's server session cleanly to Developer Sandbox
    let nextActiveDbKey: string | undefined;
    let nextSessionToken: string | undefined;
    let nextCsrfToken: string | undefined = actor.csrfToken;
    if (cleanDbKey === actor.activeDbKey) {
      const remaining = loadServerDatabases().filter((d) => d.databaseId !== cleanDbKey);
      const fallbackDb =
        remaining.find((d) => d.databaseId === DEV_SANDBOX_DB_ID)?.databaseId ||
        DEV_SANDBOX_DB_ID;
      nextActiveDbKey = fallbackDb;
      if (actor.sid) {
        const switched = updateSessionActiveDb(actor.sid, fallbackDb);
        if (switched) {
          nextSessionToken = switched.token;
          nextCsrfToken = switched.session.csrfToken;
          setSessionCookie(req, res, switched.token);
        }
      }
    }

    const statusTag = typeof dbStatus === "string" && dbStatus.trim() ? dbStatus.trim().slice(0, 32) : (isDbCurrentlyActive ? "active" : "inactive");
    logSecurityAudit({
      jenisKejadian: "PADAM_PANGKALAN_DATA",
      uid: actor.uid,
      role: actor.role,
      ip,
      status: "BERJAYA",
      butiran: `dbKey=${cleanDbKey} dbHash=${hashDatabaseIdShort(cleanDbKey)} dbStatus=${statusTag} terminatedSessions=${terminatedSessions} reason=${classification.isDefaultBusinessDb ? "DEV_DELETE_DEFAULT_BUSINESS" : "DEV_DELETE_BUSINESS"}`,
    });

    res.json({
      success: true,
      message: "Database dipadam.",
      deletedDbKey: cleanDbKey,
      terminatedSessions,
      recreatedDefaultDb: false,
      ...(nextActiveDbKey ? { nextActiveDbKey } : {}),
      ...(nextSessionToken ? { sessionToken: nextSessionToken } : {}),
      ...(nextCsrfToken ? { csrfToken: nextCsrfToken } : {}),
    });
  } catch {
    logSecurityAudit({
      jenisKejadian: "PADAM_PANGKALAN_DATA",
      uid: "server",
      role: "developer",
      ip,
      status: "GAGAL",
      butiran: `dbKey=${bodyDbKey || "none"} dbHash=${hashDatabaseIdShort(bodyDbKey)} reason=SERVER_ERROR`,
    });
    res.status(500).json({
      error: formatDevReject("SERVER_ERROR"),
      reasonCode: "SERVER_ERROR",
    });
  }
});

// Rate limiter map for Mr Cost AI Chat (sliding window per IP)
const mrcostRateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 30; // max 30 requests per minute per IP

function checkMrCostRateLimit(ip: string): boolean {
  const now = Date.now();
  const timestamps = mrcostRateLimitMap.get(ip) || [];
  const validTimestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (validTimestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    mrcostRateLimitMap.set(ip, validTimestamps);
    return false; // Rate limit exceeded
  }
  validTimestamps.push(now);
  mrcostRateLimitMap.set(ip, validTimestamps);
  return true;
}

// Initialize Gemini SDK lazily to prevent startup crash if API key is missing
let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    console.error("[MrCost AI] Ralat konfigurasi: kunci API tiada.");
    throw new MissingApiKeyError();
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

function logMrCostAudit(meta: {
  databaseIdHash: string;
  jenisSoalan: "teori" | "data";
  bilanganRekod: number;
  model: string;
  status: string;
  masaTokenPertamaMs: number | null;
  masaResponsMs: number;
  dariCache: boolean;
}) {
  console.log(
    JSON.stringify({
      tag: "MrCostAudit",
      masa: new Date().toISOString(),
      ...meta,
    })
  );
}

// Mr Cost AI Chat Endpoint
app.post("/api/mrcost/chat", async (req, res) => {
  const reqStartTime = Date.now();
  const clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";
  const language = req.body?.language || "en";
  const normalizedLang: "en" | "ms" = language === "en" ? "en" : "ms";

  if (!checkMrCostRateLimit(clientIp)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({
      error: normalizedLang === "en"
        ? "Too many requests. Please wait a moment before sending another query to Mr. Cost AI."
        : "Terlalu banyak permintaan berturut-turut. Sila tunggu sebentar sebelum menghantar soalan baharu kepada Mr Cost AI."
    });
    return;
  }

  let activeDbId = "";
  let questionType: "theory" | "data" = "theory";
  let includedRecordCount = 0;

  try {
    const { message, history = [], businessData } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: normalizedLang === "en" ? "Please provide a valid message for Mr. Cost." : "Sila berikan mesej yang sah untuk Mr Cost." });
      return;
    }

    // 1. Server-side Database Boundary Authorization (primary layer)
    const actor = await resolveVerifiedActor(req);
    if (actor && !verifyCsrfForMutation(req, actor)) {
      res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
      return;
    }
    const requestedDbId = typeof req.body?.databaseId === "string" ? req.body.databaseId.trim() : "";

    if (requestedDbId && isDatabaseDeletedTombstone(requestedDbId) && !findServerDatabaseById(requestedDbId)) {
      res.status(410).json({ error: "Pangkalan data ini telah dipadam." });
      return;
    }

    if (requestedDbId) {
      if (!actor || !canUserAccessDatabase(actor, requestedDbId)) {
        res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
        return;
      }
      activeDbId = requestedDbId;
    } else if (actor) {
      activeDbId = actor.activeDbKey;
    }

    // 2. Strip PII / confidential fields from incoming businessData immediately
    const safeBusinessData = stripSensitiveBusinessData(businessData);
    const config = safeBusinessData.config || {};
    const activeDbRecord = activeDbId ? findServerDatabaseById(activeDbId) : null;
    const companyName = activeDbRecord?.companyName || config.namaSyarikat || "";
    const productName = config.namaProduk || (normalizedLang === "en" ? "Crispy Carbonara Rolls" : "Popia Cabonara Crispy");
    const unitLabel = config.unitProduk || (normalizedLang === "en" ? "rolls" : "batang");
    const currency = config.currency || "RM";

    const bahanMentah = safeBusinessData.bahanMentah || [];
    const buruhLangsung = safeBusinessData.buruhLangsung || [];
    const overheadBerubah = safeBusinessData.overheadBerubah || [];
    const overheadTetap = safeBusinessData.overheadTetap || [];
    const allTemplates = safeBusinessData.templates || [];

    const activeProductNames: string[] = [
      productName,
      ...allTemplates.map((t: any) => t?.namaProduk).filter(Boolean),
    ];

    // 3. Classify query: general theory (zero DB records) vs active business data
    questionType = classifyMrCostQuestion(message, activeProductNames);
    if (questionType === "data" && (!actor || !activeDbId)) {
      res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
      return;
    }

    // Run deterministic anomaly & savings computations for client metadata
    const detectedAnomalies = auditDataPerniagaan({
      config,
      bahanMentah,
      buruhLangsung,
      overheadBerubah,
      overheadTetap,
    });

    const kuantitiSebenar = Number(config.kuantitiSebenarDijual || 0);
    const savingsOpportunities = kenalPastiPeluangPenjimatan({
      bahanMentah,
      buruhLangsung,
      overheadBerubah,
      kuantitiSebenar,
    });

    // Deterministic mathematical breakdown for active product
    const Q_std = Number(config.sasaranKuantitiStandard || 0);
    const P_std = Number(config.hargaJualanStandard || 0);
    const Q_act = Number(config.kuantitiSebenarDijual || 0);
    const P_act = Number(config.hargaJualanSebenar || 0);

    const dmPerUnitStd = bahanMentah.reduce((sum: number, b: any) => sum + (Number(b.stdKuantitiPerUnit || 0) * Number(b.stdHargaPerUnit || 0)), 0);
    const dlPerUnitStd = buruhLangsung.reduce((sum: number, l: any) => sum + (Number(l.stdJamPerUnit || 0) * Number(l.stdKadarPerJam || 0)), 0);
    const vohPerUnitStd = overheadBerubah.reduce((sum: number, o: any) => sum + Number(o.stdKosPerUnit || 0), 0);
    const varCostPerUnitStd = dmPerUnitStd + dlPerUnitStd + vohPerUnitStd;

    const totalFohStd = overheadTetap.reduce((sum: number, f: any) => sum + Number(f.stdKosMingguan || 0), 0);
    const fohPerUnitStd = Q_std > 0 ? totalFohStd / Q_std : 0;
    const fullCostPerUnitStd = varCostPerUnitStd + fohPerUnitStd;

    const pricing30Std = kiraHargaDariSasaranMargin(fullCostPerUnitStd > 0 ? fullCostPerUnitStd : varCostPerUnitStd, 30);
    const pricing35Std = kiraHargaDariSasaranMargin(fullCostPerUnitStd > 0 ? fullCostPerUnitStd : varCostPerUnitStd, 35);
    const pricing40Std = kiraHargaDariSasaranMargin(fullCostPerUnitStd > 0 ? fullCostPerUnitStd : varCostPerUnitStd, 40);

    const cmPerUnitStd = P_std - varCostPerUnitStd;
    const cmRatioStd = P_std > 0 ? (cmPerUnitStd / P_std) * 100 : 0;
    const bepUnitsStd = cmPerUnitStd > 0 ? totalFohStd / cmPerUnitStd : null;
    const bepRevenueStd = bepUnitsStd !== null ? bepUnitsStd * P_std : null;

    const otherProductsSummary = allTemplates.map((t: any) => {
      const tBm = (t.bahanMentah || []).reduce((s: number, b: any) => s + (Number(b.stdKuantitiPerUnit || 0) * Number(b.stdHargaPerUnit || 0)), 0);
      const tBl = (t.buruhLangsung || []).reduce((s: number, l: any) => s + (Number(l.stdJamPerUnit || 0) * Number(l.stdKadarPerJam || 0)), 0);
      const tVoh = (t.overheadBerubah || []).reduce((s: number, o: any) => s + Number(o.stdKosPerUnit || 0), 0);
      const tVc = tBm + tBl + tVoh;
      const tFoh = (t.overheadTetap || []).reduce((s: number, f: any) => s + Number(f.stdKosMingguan || 0), 0);
      const tQ = Number(t.konfigurasi?.sasaranKuantitiStandard || 1);
      const tFullCost = tVc + (tQ > 0 ? tFoh / tQ : 0);
      const tPrice = Number(t.konfigurasi?.hargaJualanStandard || 0);
      return {
        id: t.id,
        namaProduk: t.namaProduk,
        hargaJualan: tPrice,
        kosBerubahSeunit: Number(tVc.toFixed(2)),
        kosPenuhSeunit: Number(tFullCost.toFixed(2)),
        marginCarumanSeunit: Number((tPrice - tVc).toFixed(2)),
        marginCarumanPercent: tPrice > 0 ? Number((((tPrice - tVc) / tPrice) * 100).toFixed(1)) : 0,
        sasaranKuantiti: tQ,
      };
    });

    const isStreamRequested = Boolean(
      req.body?.stream ||
      req.query?.stream === "true" ||
      req.headers.accept?.includes("text/event-stream")
    );

    const precomputedPayload = {
      productName,
      currency,
      fullCostPerUnitStd,
      varCostPerUnitStd,
      pricing30Std: pricing30Std.hargaJualan,
      pricing35Std: pricing35Std.hargaJualan,
      pricing40Std: pricing40Std.hargaJualan,
      cmPerUnitStd,
      cmRatioStd,
      bepUnitsStd,
    };

    // 4. Strictly isolate conversation history by active databaseId (max 6 messages, starting with user)
    const rawHistory = Array.isArray(history) ? history : [];
    const scopedHistory = rawHistory.filter((h: any) => {
      if (!h) return false;
      if (h.databaseId && activeDbId && h.databaseId !== activeDbId) return false;
      return true;
    });
    const rawHistoryEmpty = scopedHistory.length === 0;
    const recentHistory = scopedHistory.slice(-6);
    const validHistory: Array<{ role: "user" | "model"; parts: [{ text: string }] }> = [];

    for (const h of recentHistory) {
      const text = (h.parts?.[0]?.text || h.text || h.message || "").trim();
      if (!text) continue;
      const role: "user" | "model" = h.role === "user" ? "user" : "model";

      if (validHistory.length === 0 && role !== "user") {
        continue;
      }

      if (validHistory.length > 0 && validHistory[validHistory.length - 1].role === role) {
        validHistory[validHistory.length - 1].parts[0].text += "\n\n" + text;
      } else {
        validHistory.push({
          role,
          parts: [{ text }],
        });
      }
    }

    if (validHistory.length > 0 && validHistory[validHistory.length - 1].role === "user") {
      validHistory.pop();
    }

    // 5. Cache ONLY general theory questions (never cache business data answers)
    const isTheoryQuestion = questionType === "theory";
    const isFirstQuestion = rawHistoryEmpty && validHistory.length === 0;
    const cacheKey = isTheoryQuestion && isFirstQuestion ? normalizeMrCostCacheKey(message, normalizedLang) : "";

    // Build forbidden DB entries list strictly on the server (never sent to Gemini)
    const forbiddenEntries = getForbiddenDatabasesForActive(activeDbId, companyName);
    const activeAllowedNames = [companyName, ...activeProductNames].filter(Boolean);
    const maxForbiddenLen = forbiddenEntries.reduce((max, entry) => {
      return Math.max(max, (entry.companyName || "").length, (entry.databaseId || "").length);
    }, 0);

    const writeSseEvent = (event: string, data: unknown) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      (res as unknown as { flush?: () => void }).flush?.();
    };

    if (isTheoryQuestion && isFirstQuestion && cacheKey) {
      const cached = getCachedFirstAnswer(cacheKey);
      if (cached) {
        const outputCheck = validateMrCostOutput(cached.text, forbiddenEntries, activeAllowedNames);
        const safeCachedText = outputCheck.safeText;
        const cacheLatencyMs = Date.now() - reqStartTime;

        logMrCostAudit({
          databaseIdHash: hashDatabaseIdShort(activeDbId),
          jenisSoalan: "teori",
          bilanganRekod: 0,
          model: cached.model,
          status: outputCheck.blocked ? "OUTPUT_BOUNDARY_BLOCKED" : "BERJAYA",
          masaTokenPertamaMs: cacheLatencyMs,
          masaResponsMs: cacheLatencyMs,
          dariCache: true,
        });

        if (isStreamRequested) {
          res.socket?.setNoDelay?.(true);
          res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache, no-transform");
          res.setHeader("Connection", "keep-alive");
          res.setHeader("X-Accel-Buffering", "no");
          res.flushHeaders?.();

          writeSseEvent("metadata", {
            anomalies: detectedAnomalies,
            savingsOpportunities,
            precomputed: precomputedPayload,
          });
          writeSseEvent("chunk", { text: safeCachedText });
          writeSseEvent("done", { done: true });
          res.end();
          return;
        }

        res.json({
          text: safeCachedText,
          anomalies: detectedAnomalies,
          savingsOpportunities,
          precomputed: precomputedPayload,
          cached: true,
        });
        return;
      }
    }

    // Sahkan API key sebelum memulakan permintaan Gemini
    const ai = getAiClient();
    const staticSystemInstruction = getMrCostSystemInstruction(normalizedLang);

    const hasMeaningfulBusinessData =
      Q_std > 0 ||
      P_std > 0 ||
      Q_act > 0 ||
      P_act > 0 ||
      bahanMentah.length > 0 ||
      buruhLangsung.length > 0 ||
      overheadBerubah.length > 0 ||
      overheadTetap.length > 0 ||
      otherProductsSummary.length > 1;

    // 6. Context Minimization: send ZERO business records for theory questions;
    // for data/mixed questions, send ONLY minimal active DB data wrapped in <data_perniagaan>...</data_perniagaan>
    let currentUserText = message.trim();
    if (questionType === "data" && hasMeaningfulBusinessData) {
      const built = buildSafeBusinessContextBlock({
        message: message.trim(),
        currency,
        productName,
        unitLabel,
        Q_std,
        P_std,
        Q_act,
        P_act,
        dmPerUnitStd,
        dlPerUnitStd,
        vohPerUnitStd,
        varCostPerUnitStd,
        totalFohStd,
        fullCostPerUnitStd,
        cmPerUnitStd,
        cmRatioStd,
        bepUnitsStd,
        bepRevenueStd,
        pricing30: pricing30Std.hargaJualan,
        pricing35: pricing35Std.hargaJualan,
        pricing40: pricing40Std.hargaJualan,
        bahanMentah,
        detectedAnomalies,
        savingsOpportunities,
        otherProductsSummary,
      });
      includedRecordCount = built.includedRecordCount;
      currentUserText = `${built.contextBlock}\n\nSoalan pengguna: ${message.trim()}`;
    } else {
      includedRecordCount = 0;
    }

    const contents = [
      ...validHistory,
      {
        role: "user" as const,
        parts: [{ text: currentUserText }],
      },
    ];

    const MODEL_CHAIN = [
      "gemini-3.8-flash",
      "gemini-flash-lite-latest",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-flash-latest",
    ];

    function buildModelConfig(model: string, withThinking: boolean) {
      const thinking = withThinking ? getThinkingConfig(model) : undefined;
      return {
        systemInstruction: staticSystemInstruction,
        temperature: 0.3,
        maxOutputTokens: 2048,
        ...(thinking ? { thinkingConfig: thinking } : {}),
      };
    }

    const dbHashForLog = hashDatabaseIdShort(activeDbId);
    const jenisForLog: "teori" | "data" = questionType === "data" ? "data" : "teori";

    if (isStreamRequested) {
      req.setTimeout(0);
      res.setTimeout(0);
      res.socket?.setNoDelay?.(true);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      let clientClosed = false;
      res.on("close", () => {
        if (!res.writableEnded) {
          clientClosed = true;
        }
      });

      writeSseEvent("metadata", {
        anomalies: detectedAnomalies,
        savingsOpportunities,
        precomputed: precomputedPayload,
      });

      let heartbeatCleared = false;
      const heartbeatTimer = setInterval(() => {
        if (heartbeatCleared || clientClosed || res.writableEnded || res.destroyed) {
          clearInterval(heartbeatTimer);
          heartbeatCleared = true;
          return;
        }
        try {
          res.write(": keepalive\n\n");
          (res as unknown as { flush?: () => void }).flush?.();
        } catch {
          clearInterval(heartbeatTimer);
          heartbeatCleared = true;
        }
      }, 2000);

      const stopHeartbeat = () => {
        if (!heartbeatCleared) {
          clearInterval(heartbeatTimer);
          heartbeatCleared = true;
        }
      };

      async function streamWithFirstTokenDeadline(
        model: string,
        withThinking: boolean,
        timeoutMs = 15000
      ): Promise<{ iterator: AsyncIterator<any>; firstText: string }> {
        let timer: NodeJS.Timeout | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`Timeout: ${timeoutMs / 1000}s`));
          }, timeoutMs);
        });

        const connectAndGetFirstToken = async () => {
          const stream = await ai.models.generateContentStream({
            model,
            contents,
            config: buildModelConfig(model, withThinking),
          });
          const iterator = stream[Symbol.asyncIterator]();
          let lastFinishReason: string | undefined;

          while (true) {
            const { value, done } = await iterator.next();
            if (done) {
              const candidate = (value as any)?.candidates?.[0];
              const finishReason = candidate?.finishReason || lastFinishReason;
              throw new Error(`Empty response (${finishReason || "DONE"})`);
            }
            const candidate = (value as any)?.candidates?.[0];
            if (candidate?.finishReason) {
              lastFinishReason = candidate.finishReason;
            }
            const text = value?.text;
            if (text && text.trim().length > 0) {
              return { iterator, firstText: text };
            }
            if (lastFinishReason === "MAX_TOKENS") {
              throw new Error("Empty response (MAX_TOKENS)");
            }
          }
        };

        const connectPromise = connectAndGetFirstToken();
        connectPromise.catch(() => {});

        try {
          return await Promise.race([connectPromise, timeoutPromise]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      }

      async function tryModelStream(
        model: string,
        timeoutMs: number,
        round: number
      ): Promise<{ iterator: AsyncIterator<any>; firstText: string; model: string; latencyMs: number }> {
        const startTime = Date.now();
        try {
          const result = await streamWithFirstTokenDeadline(model, true, timeoutMs);
          const latencyMs = Date.now() - startTime;
          return { ...result, model, latencyMs };
        } catch (err: any) {
          const status = err?.status || err?.code || (err?.message?.includes("Timeout") ? 408 : 500);

          if (isNotFoundError(err)) {
            throw err;
          }

          if (isThinkingError(err)) {
            console.error(JSON.stringify({ tag: "MrCostFailover", masa: new Date().toISOString(), databaseIdHash: dbHashForLog, model, status, pusingan: round, retryWithoutThinking: true }));
            const remainingForRetry = Math.max(1000, timeoutMs - (Date.now() - startTime));
            try {
              const retryResult = await streamWithFirstTokenDeadline(model, false, remainingForRetry);
              const latencyMs = Date.now() - startTime;
              return { ...retryResult, model, latencyMs };
            } catch (retryErr: any) {
              if (isNotFoundError(retryErr)) throw retryErr;
              console.error(JSON.stringify({ tag: "MrCostFailover", masa: new Date().toISOString(), databaseIdHash: dbHashForLog, model, status: retryErr?.status || retryErr?.code || 500, pusingan: round }));
              throw retryErr;
            }
          }

          console.error(JSON.stringify({ tag: "MrCostFailover", masa: new Date().toISOString(), databaseIdHash: dbHashForLog, model, status, pusingan: round }));
          throw err;
        }
      }

      const overallDeadline = Date.now() + 45000;
      let activeStream: { iterator: AsyncIterator<any>; firstText: string; model: string; latencyMs: number } | null = null;
      let streamLastError: any = null;

      try {
        roundLoop: for (let round = 1; round <= 2; round++) {
          if (clientClosed || res.destroyed) break roundLoop;

          if (round === 2) {
            const timeLeft = overallDeadline - Date.now();
            if (timeLeft <= 2000) {
              break roundLoop;
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
            if (clientClosed || res.destroyed) break roundLoop;
          }

          for (let i = 0; i < MODEL_CHAIN.length; i++) {
            if (clientClosed || res.destroyed) break roundLoop;

            const timeLeft = overallDeadline - Date.now();
            if (timeLeft <= 500) {
              break roundLoop;
            }

            const model = MODEL_CHAIN[i];
            const perModelTimeout = Math.min(15000, Math.max(1000, timeLeft));

            try {
              activeStream = await tryModelStream(model, perModelTimeout, round);
              if (activeStream) {
                break roundLoop;
              }
            } catch (chainErr: any) {
              streamLastError = chainErr;
            }
          }
        }

        if (clientClosed || res.destroyed) {
          if (!res.writableEnded) res.end();
          return;
        }

        if (!activeStream) {
          throw (streamLastError || new Error("All Mr Cost AI models in failover chain exhausted"));
        }

        stopHeartbeat();

        const { iterator, firstText, model: winningModel, latencyMs: firstTokenMs } = activeStream;
        // Second-layer boundary holdback buffer ensures no forbidden full DB name/ID leaks mid-stream
        const holdbackLen = maxForbiddenLen > 0 ? Math.min(80, maxForbiddenLen + 2) : 0;
        let fullRawText = "";
        let pendingBuffer = "";
        let boundaryBlocked = false;

        const processStreamPiece = (piece: string) => {
          if (!piece || boundaryBlocked) return;
          fullRawText += piece;
          pendingBuffer += piece;

          const check = validateMrCostOutput(fullRawText, forbiddenEntries, activeAllowedNames);
          if (check.blocked) {
            boundaryBlocked = true;
            pendingBuffer = "";
            writeSseEvent("replace", { text: OUTPUT_BOUNDARY_REPLACEMENT_TEXT });
            return;
          }

          if (pendingBuffer.length > holdbackLen) {
            const flushCount = pendingBuffer.length - holdbackLen;
            const safeSlice = pendingBuffer.slice(0, flushCount);
            pendingBuffer = pendingBuffer.slice(flushCount);
            if (safeSlice) {
              writeSseEvent("chunk", { text: safeSlice });
            }
          }
        };

        if (firstText) {
          processStreamPiece(firstText);
        }

        while (!boundaryBlocked) {
          if (clientClosed || res.writableEnded || res.destroyed) break;
          const { value, done } = await iterator.next();
          if (done) break;
          const chunkText = value?.text;
          if (chunkText) {
            processStreamPiece(chunkText);
          }
        }

        if (!boundaryBlocked && !clientClosed && !res.destroyed) {
          const finalCheck = validateMrCostOutput(fullRawText, forbiddenEntries, activeAllowedNames);
          if (finalCheck.blocked) {
            boundaryBlocked = true;
            writeSseEvent("replace", { text: OUTPUT_BOUNDARY_REPLACEMENT_TEXT });
          } else if (pendingBuffer.length > 0) {
            writeSseEvent("chunk", { text: pendingBuffer });
          }
        }

        const totalMs = Date.now() - reqStartTime;
        logMrCostAudit({
          databaseIdHash: dbHashForLog,
          jenisSoalan: jenisForLog,
          bilanganRekod: includedRecordCount,
          model: winningModel,
          status: boundaryBlocked ? "OUTPUT_BOUNDARY_BLOCKED" : "BERJAYA",
          masaTokenPertamaMs: firstTokenMs,
          masaResponsMs: totalMs,
          dariCache: false,
        });

        // Cache ONLY theory answers that passed output boundary check
        if (
          !boundaryBlocked &&
          isTheoryQuestion &&
          isFirstQuestion &&
          cacheKey &&
          fullRawText.trim().length > 0 &&
          !res.destroyed &&
          !clientClosed
        ) {
          setCachedFirstAnswer(cacheKey, fullRawText, winningModel);
        }

        writeSseEvent("done", { done: true });
        if (!res.writableEnded) {
          res.end();
        }
        return;
      } finally {
        stopHeartbeat();
      }
    }

    // Standard non-streaming fallback
    async function executeNonStreamSingle(model: string, withThinking: boolean, timeoutMs = 15000): Promise<string> {
      let timer: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Timeout: ${timeoutMs / 1000}s`));
        }, timeoutMs);
      });

      const callPromise = async () => {
        const resp = await ai.models.generateContent({
          model,
          contents,
          config: buildModelConfig(model, withThinking),
        });

        const text = resp.text?.trim();
        const finishReason = resp.candidates?.[0]?.finishReason;
        if (!text) {
          throw new Error(`Empty response (${finishReason || "DONE"})`);
        }
        return resp.text || "";
      };

      try {
        return await Promise.race([callPromise(), timeoutPromise]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    async function tryNonStreamModel(
      model: string,
      timeoutMs: number,
      round: number
    ): Promise<{ text: string; model: string; latencyMs: number }> {
      const startTime = Date.now();
      try {
        const text = await executeNonStreamSingle(model, true, timeoutMs);
        const latencyMs = Date.now() - startTime;
        return { text, model, latencyMs };
      } catch (err: any) {
        const status = err?.status || err?.code || (err?.message?.includes("Timeout") ? 408 : 500);

        if (isNotFoundError(err)) {
          throw err;
        }

        if (isThinkingError(err)) {
          console.error(JSON.stringify({ tag: "MrCostFailover", masa: new Date().toISOString(), databaseIdHash: dbHashForLog, model, status, pusingan: round, retryWithoutThinking: true }));
          const remainingForRetry = Math.max(1000, timeoutMs - (Date.now() - startTime));
          try {
            const text = await executeNonStreamSingle(model, false, remainingForRetry);
            const latencyMs = Date.now() - startTime;
            return { text, model, latencyMs };
          } catch (retryErr: any) {
            if (isNotFoundError(retryErr)) throw retryErr;
            console.error(JSON.stringify({ tag: "MrCostFailover", masa: new Date().toISOString(), databaseIdHash: dbHashForLog, model, status: retryErr?.status || retryErr?.code || 500, pusingan: round }));
            throw retryErr;
          }
        }

        console.error(JSON.stringify({ tag: "MrCostFailover", masa: new Date().toISOString(), databaseIdHash: dbHashForLog, model, status, pusingan: round }));
        throw err;
      }
    }

    const nonStreamOverallDeadline = Date.now() + 45000;
    let nonStreamResult: { text: string; model: string; latencyMs: number } | null = null;
    let nonStreamLastError: any = null;

    nonStreamRoundLoop: for (let round = 1; round <= 2; round++) {
      if (round === 2) {
        const timeLeft = nonStreamOverallDeadline - Date.now();
        if (timeLeft <= 2000) {
          break nonStreamRoundLoop;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      for (let i = 0; i < MODEL_CHAIN.length; i++) {
        const timeLeft = nonStreamOverallDeadline - Date.now();
        if (timeLeft <= 500) {
          break nonStreamRoundLoop;
        }

        const model = MODEL_CHAIN[i];
        const perModelTimeout = Math.min(15000, Math.max(1000, timeLeft));

        try {
          nonStreamResult = await tryNonStreamModel(model, perModelTimeout, round);
          if (nonStreamResult) {
            break nonStreamRoundLoop;
          }
        } catch (chainErr: any) {
          nonStreamLastError = chainErr;
        }
      }
    }

    if (!nonStreamResult) {
      throw (nonStreamLastError || new Error("All Mr Cost AI models in non-stream chain exhausted"));
    }

    const outputCheck = validateMrCostOutput(nonStreamResult.text, forbiddenEntries, activeAllowedNames);
    const finalSafeText = outputCheck.safeText;
    const totalMs = Date.now() - reqStartTime;

    logMrCostAudit({
      databaseIdHash: dbHashForLog,
      jenisSoalan: jenisForLog,
      bilanganRekod: includedRecordCount,
      model: nonStreamResult.model,
      status: outputCheck.blocked ? "OUTPUT_BOUNDARY_BLOCKED" : "BERJAYA",
      masaTokenPertamaMs: nonStreamResult.latencyMs,
      masaResponsMs: totalMs,
      dariCache: false,
    });

    // Cache ONLY general theory answers that passed output validation
    if (!outputCheck.blocked && isTheoryQuestion && isFirstQuestion && cacheKey && finalSafeText.trim().length > 0) {
      setCachedFirstAnswer(cacheKey, finalSafeText, nonStreamResult.model);
    }

    res.json({
      text: finalSafeText,
      anomalies: detectedAnomalies,
      savingsOpportunities,
      precomputed: precomputedPayload,
    });
  } catch (error: any) {
    if (!(error instanceof MissingApiKeyError)) {
      logMrCostAudit({
        databaseIdHash: hashDatabaseIdShort(activeDbId),
        jenisSoalan: questionType === "data" ? "data" : "teori",
        bilanganRekod: includedRecordCount,
        model: "none",
        status: "RALAT",
        masaTokenPertamaMs: null,
        masaResponsMs: Date.now() - reqStartTime,
        dariCache: false,
      });
    }

    const isMissingKey = error instanceof MissingApiKeyError;
    const rawStatus = Number(error?.status || (isMissingKey ? 503 : 503));
    const httpStatus = rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 503;
    const errCode = isMissingKey
      ? "AI_NOT_CONFIGURED"
      : (httpStatus === 429 ? "RESOURCE_EXHAUSTED" : "UPSTREAM_AI_ERROR");

    const friendlyMessage = isMissingKey
      ? (normalizedLang === "en"
          ? "AI API key (GEMINI_API_KEY) is not configured on the Express server."
          : "Kunci API AI (GEMINI_API_KEY) belum ditetapkan pada pelayan Express.")
      : (httpStatus === 429
          ? (normalizedLang === "en"
              ? "AI service quota temporarily reached (HTTP 429). Please retry in a moment."
              : "Had kuota perkhidmatan AI dicapai buat sementara waktu (HTTP 429). Sila cuba sebentar lagi.")
          : (normalizedLang === "en"
              ? "Mr. Cost is currently busy, please try again shortly."
              : "Mr Cost sedang sibuk, sila cuba lagi sebentar."));

    const safeDetail = isMissingKey
      ? "Missing GEMINI_API_KEY environment variable on Express origin."
      : `Express AI upstream HTTP ${httpStatus}`;

    if (res.headersSent) {
      if (!res.writableEnded && !res.destroyed) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: friendlyMessage, code: errCode, httpStatus, detail: safeDetail })}\n\n`);
        (res as unknown as { flush?: () => void }).flush?.();
        res.end();
      }
    } else {
      res.status(httpStatus).json({ error: friendlyMessage, code: errCode, httpStatus, detail: safeDetail });
    }
  }
});
// ============================================================================
// ADMIN BACKUP & RESTORE BACKEND API ROUTES
// ============================================================================

interface AdminAuditLogEntry {
  id: string;
  timestamp: string;
  action: "EXPORT" | "IMPORT" | "VALIDATE";
  username: string;
  userRole: string;
  companyName: string;
  mode?: string;
  recordsCount?: number;
  status: "SUCCESS" | "WARNING" | "FAILED";
  details: string;
}

const adminAuditLogs: AdminAuditLogEntry[] = [];

function recordAdminAudit(entry: Omit<AdminAuditLogEntry, "id" | "timestamp">) {
  const newLog: AdminAuditLogEntry = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  adminAuditLogs.unshift(newLog);
  if (adminAuditLogs.length > 50) adminAuditLogs.pop();
  console.log(
    JSON.stringify({
      tag: "AdminAudit",
      masa: newLog.timestamp,
      action: newLog.action,
      role: newLog.userRole,
      databaseIdHash: hashDatabaseIdShort(newLog.companyName),
      recordsCount: newLog.recordsCount ?? 0,
      status: newLog.status,
    })
  );
}

let firebaseProjectIdCached: string | null = null;
function getFirebaseProjectId(): string {
  if (firebaseProjectIdCached) return firebaseProjectIdCached;
  if (process.env.FIREBASE_PROJECT_ID?.trim()) {
    firebaseProjectIdCached = process.env.FIREBASE_PROJECT_ID.trim();
    return firebaseProjectIdCached;
  }
  try {
    const cfgPath = path.join(PROJECT_ROOT, "firebase-applet-config.json");
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      if (cfg && typeof cfg.projectId === "string" && cfg.projectId.trim()) {
        firebaseProjectIdCached = cfg.projectId.trim();
        return firebaseProjectIdCached;
      }
    }
  } catch {}
  firebaseProjectIdCached = "reflecting-booth-740ks";
  return firebaseProjectIdCached;
}

const FIREBASE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let cachedFirebaseCerts: Record<string, string> | null = null;
let firebaseCertsExpiresAt = 0;

async function getFirebasePublicCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && cachedFirebaseCerts && now < firebaseCertsExpiresAt) {
    return cachedFirebaseCerts;
  }
  const resp = await fetch(FIREBASE_CERTS_URL);
  if (!resp.ok) {
    throw new Error(`Failed to fetch Firebase certs: ${resp.status}`);
  }
  const certs = (await resp.json()) as Record<string, string>;
  const cacheControl = resp.headers.get("cache-control") || "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
  cachedFirebaseCerts = certs;
  firebaseCertsExpiresAt = now + Math.max(60, maxAgeSec) * 1000;
  return certs;
}

export interface VerifiedFirebaseTokenPayload {
  uid: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  authTimeSec?: number;
}

/**
 * Cryptographically verifies a Firebase ID Token (RS256 signature against Google's official X.509 certs,
 * plus aud, iss, exp, iat, auth_time, sub, and email_verified claims).
 */
async function verifyFirebaseIdToken(token: string): Promise<VerifiedFirebaseTokenPayload | null> {
  try {
    if (!token || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!header || header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
      return null;
    }
    if (!payload || typeof payload !== "object") return null;

    const projectId = getFirebaseProjectId();
    const expectedIss = `https://securetoken.google.com/${projectId}`;
    const nowSec = Math.floor(Date.now() / 1000);

    if (payload.aud !== projectId) return null;
    if (payload.iss !== expectedIss) return null;
    if (typeof payload.exp !== "number" || payload.exp <= nowSec) return null;
    if (typeof payload.iat !== "number" || payload.iat > nowSec + 300) return null;
    if (typeof payload.auth_time === "number" && payload.auth_time > nowSec + 300) return null;

    const sub = String(payload.sub || payload.user_id || "").trim();
    if (!sub || sub.length > 128) return null;

    let certs = await getFirebasePublicCerts(false);
    let certPem = certs[header.kid];
    if (!certPem) {
      certs = await getFirebasePublicCerts(true);
      certPem = certs[header.kid];
    }
    if (!certPem) return null;

    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();
    const signatureBuf = Buffer.from(parts[2], "base64url");
    const sigValid = verifier.verify(certPem, signatureBuf);
    if (!sigValid) return null;

    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : undefined;
    const emailVerified = payload.email_verified === true;

    return {
      uid: sub,
      email,
      emailVerified,
      name: typeof payload.name === "string" ? payload.name.trim() : undefined,
      authTimeSec: typeof payload.auth_time === "number" ? payload.auth_time : undefined,
    };
  } catch {
    return null;
  }
}

async function verifyAdminAccess(req: express.Request, res: express.Response): Promise<VerifiedActor | null> {
  const actor = await resolveVerifiedActor(req);
  if (!actor || (actor.role !== "admin" && actor.role !== "developer")) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return null;
  }

  if (req.method !== "GET" && req.method !== "HEAD" && !verifyCsrfForMutation(req, actor)) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return null;
  }

  const requestedDbId = typeof req.body?.databaseId === "string"
    ? req.body.databaseId.trim()
    : (typeof req.query?.databaseId === "string" ? req.query.databaseId.trim() : "");

  if (requestedDbId && isDatabaseDeletedTombstone(requestedDbId) && !findServerDatabaseById(requestedDbId)) {
    res.status(410).json({ error: "Pangkalan data ini telah dipadam." });
    return null;
  }

  if (requestedDbId && !canUserAccessDatabase(actor, requestedDbId)) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return null;
  }

  return actor;
}

// 1. Export Backup Route
app.post("/api/admin/backup/export", async (req, res) => {
  if (!checkEndpointRateLimit("admin-backup-export", getClientIp(req), 30)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak permintaan eksport sandaran." });
    return;
  }
  const actor = await verifyAdminAccess(req, res);
  if (!actor) return;

  try {
    if (hasPrototypePollutionKey(req.body)) {
      logSecurityAudit({
        jenisKejadian: "VALIDASI_GAGAL",
        uid: actor.uid,
        role: actor.role,
        ip: getClientIp(req),
        status: "DISEKAT",
        butiran: "backup_export_prototype_pollution",
      });
      res.status(400).json({ error: "Struktur permintaan sandaran tidak sah." });
      return;
    }

    const {
      companyName: rawCompanyName = "SMARTCOST",
      activeProductId = "popia-cabonara",
      currency = "RM",
      config = {},
      templates = [],
      bahanMentah = [],
      buruhLangsung = [],
      overheadBerubah = [],
      overheadTetap = [],
      currentUser = {},
    } = req.body;
    const companyName = sanitizePlainText(rawCompanyName, 128) || "SMARTCOST";

    const safeConfig = sanitizeConfigForBackup(config);
    if (safeConfig?.generalSetup?.logoUrl && !validateLogoDataUrl(safeConfig.generalSetup.logoUrl).valid) {
      safeConfig.generalSetup.logoUrl = "";
    }
    const safeTemplates = Array.isArray(templates)
      ? templates.map((t: any) =>
          t && typeof t === "object" && t.konfigurasi && typeof t.konfigurasi === "object"
            ? { ...t, konfigurasi: sanitizeConfigForBackup(t.konfigurasi) }
            : t
        )
      : [];

    let totalMaterials = bahanMentah.length;
    let totalLabor = buruhLangsung.length;
    let totalOverhead = overheadBerubah.length + overheadTetap.length;

    safeTemplates.forEach((t: any) => {
      if (Array.isArray(t.bahanMentah)) totalMaterials += t.bahanMentah.length;
      if (Array.isArray(t.buruhLangsung)) totalLabor += t.buruhLangsung.length;
      if (Array.isArray(t.overheadBerubah)) totalOverhead += t.overheadBerubah.length;
      if (Array.isArray(t.overheadTetap)) totalOverhead += t.overheadTetap.length;
    });

    const now = new Date();
    const fileName = generateBackupFileName(companyName);

    const backupPayload = {
      metadata: {
        app: "SMARTCOST",
        backupVersion: "2.0.0",
        schemaVersion: "2026.1",
        exportedAt: now.toISOString(),
        exportedBy: currentUser.fullName || actor.username || "Admin",
        companyName,
        currency,
        totalProducts: safeTemplates.length,
        totalRawMaterials: totalMaterials,
        totalLaborItems: totalLabor,
        totalOverheadItems: totalOverhead,
      },
      company: {
        name: companyName,
        activeProductId,
        currency,
        config: safeConfig,
      },
      templates: safeTemplates,
      activeWorksheet: {
        bahanMentah,
        buruhLangsung,
        overheadBerubah,
        overheadTetap,
      },
    };

    recordAdminAudit({
      action: "EXPORT",
      username: actor.username,
      userRole: actor.role,
      companyName,
      recordsCount: templates.length,
      status: "SUCCESS",
      details: `Eksport sandaran berjaya dimuat turun: ${templates.length} produk, ${totalMaterials} bahan mentah (${fileName}).`,
    });

    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", "application/json");
    res.json({
      success: true,
      fileName,
      backup: backupPayload,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Gagal mengeksport sandaran data." });
  }
});

// 2. Validate Backup Route
app.post("/api/admin/backup/validate", async (req, res) => {
  if (!checkEndpointRateLimit("admin-backup-validate", getClientIp(req), 60)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ valid: false, error: "Terlalu banyak permintaan pengesahan." });
    return;
  }
  const actor = await verifyAdminAccess(req, res);
  if (!actor) return;

  try {
    if (hasPrototypePollutionKey(req.body)) {
      logSecurityAudit({
        jenisKejadian: "MUAT_NAIK_DISEKAT",
        uid: actor.uid,
        role: actor.role,
        ip: getClientIp(req),
        status: "DISEKAT",
        butiran: "backup_validate_prototype_pollution",
      });
      res.status(400).json({ valid: false, error: "Kandungan sandaran mengandungi kunci struktur yang disekat." });
      return;
    }

    const { backupContent, existingTemplates = [] } = req.body;
    const sanitized = sanitizeBackupContentPayload(backupContent);
    if (!sanitized.valid || !sanitized.cleaned) {
      res.status(400).json({ valid: false, error: sanitized.error || "Fail sandaran tidak sah." });
      return;
    }

    const validationResult = validateBackupContent(sanitized.cleaned, existingTemplates);

    res.json(validationResult);
  } catch {
    res.status(500).json({ valid: false, error: "Ralat semasa mengesahkan fail sandaran." });
  }
});

// 3. Import Backup Route
app.post("/api/admin/backup/import", async (req, res) => {
  if (!checkEndpointRateLimit("admin-backup-import", getClientIp(req), 30)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak permintaan import sandaran." });
    return;
  }
  const actor = await verifyAdminAccess(req, res);
  if (!actor) return;

  try {
    if (hasPrototypePollutionKey(req.body)) {
      logSecurityAudit({
        jenisKejadian: "MUAT_NAIK_DISEKAT",
        uid: actor.uid,
        role: actor.role,
        ip: getClientIp(req),
        status: "DISEKAT",
        butiran: "backup_import_prototype_pollution",
      });
      res.status(400).json({ error: "Struktur fail sandaran mengandungi kunci berbahaya yang disekat." });
      return;
    }

    const {
      backupContent: rawBackupContent,
      existingTemplates = [],
      mode = "insert_only",
      companyName: rawCompanyName = "SMARTCOST",
    } = req.body;
    const companyName = sanitizePlainText(rawCompanyName, 128) || "SMARTCOST";

    const sanitized = sanitizeBackupContentPayload(rawBackupContent);
    if (!sanitized.valid || !sanitized.cleaned) {
      res.status(400).json({ error: sanitized.error || "Fail sandaran tidak sah." });
      return;
    }
    const backupContent = sanitized.cleaned as any;

    const validation = validateBackupContent(backupContent, existingTemplates);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error || "Fail sandaran tidak sah atau rosak." });
      return;
    }

    let backupTemplates = [];
    if (Array.isArray(backupContent.templates)) {
      backupTemplates = backupContent.templates;
    } else if (backupContent.data?.templates && Array.isArray(backupContent.data.templates)) {
      backupTemplates = backupContent.data.templates;
    } else if (backupContent.pengekosan_templates && Array.isArray(backupContent.pengekosan_templates)) {
      backupTemplates = backupContent.pengekosan_templates;
    }

    const importResult = executeTemplatesImport({
      backupTemplates,
      existingTemplates,
      mode,
    });

    recordAdminAudit({
      action: "IMPORT",
      username: actor.username,
      userRole: actor.role,
      companyName,
      mode,
      recordsCount: importResult.addedCount + importResult.updatedCount,
      status: "SUCCESS",
      details: `Import mod [${mode}]: Ditambah ${importResult.addedCount}, Dikemas kini ${importResult.updatedCount}, Dikecualikan ${importResult.skippedCount}.`,
    });

    res.json({
      success: true,
      mode,
      ...importResult,
      metadata: validation.metadata,
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(500).json({ error: "Ralat semasa mengimport sandaran data." });
  }
});

// 4. Audit Log Route
app.get("/api/admin/backup/audit-log", async (req, res) => {
  if (!checkEndpointRateLimit("admin-backup-audit", getClientIp(req), 60)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak permintaan." });
    return;
  }
  const actor = await verifyAdminAccess(req, res);
  if (!actor) return;

  // Scope audit logs to actor's active database unless verified developer
  const filteredLogs = actor.role === "developer" && isVerifiedDeveloperActor(actor)
    ? adminAuditLogs
    : adminAuditLogs.filter((l) => l.username === actor.username);

  res.json({ logs: filteredLogs });
});

// 5. Server-Side Deterministic Costing & Financial Integrity Verification Endpoint
app.post("/api/costing/verify", async (req, res) => {
  if (!checkEndpointRateLimit("costing-verify", getClientIp(req), 60)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Terlalu banyak permintaan pengesahan kos." });
    return;
  }
  const actor = await resolveVerifiedActor(req);
  if (!actor || !verifyCsrfForMutation(req, actor)) {
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return;
  }

  const verification = verifyCostingSummaryOnServer(req.body || {});
  if (!verification.valid && verification.error) {
    logSecurityAudit({
      jenisKejadian: "VALIDASI_GAGAL",
      uid: actor.uid,
      role: actor.role,
      ip: getClientIp(req),
      status: "DISEKAT",
      butiran: "costing_verify_rejected",
    });
    res.status(400).json(verification);
    return;
  }

  res.json({
    ok: true,
    ...verification,
  });
});

// ============================================================================
// SERVER & DATABASE MANAGEMENT API (STRICTLY VERIFIED DEVELOPER ONLY)
// ============================================================================

async function verifyDeveloperInfraAccess(req: express.Request, res: express.Response): Promise<VerifiedActor | null> {
  const actor = await resolveVerifiedActor(req);
  if (!actor || actor.role !== "developer" || !isVerifiedDeveloperActor(actor)) {
    logSecurityAudit({
      jenisKejadian: "AKSES_PEMBANGUN_GAGAL",
      uid: actor?.uid || "anonymous",
      role: actor?.role || "none",
      ip: getClientIp(req),
      status: "DISEKAT",
      butiran: `infra_api_denied=${req.method} ${req.path}`,
    });
    infraManager.addLog({
      level: "SECURITY",
      source: "InfraRBAC",
      statusCode: 403,
      message: `Blocked unauthorized access to ${req.method} ${req.path} (role=${actor?.role || "anonymous"}).`,
    });
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return null;
  }

  if (req.method !== "GET" && req.method !== "HEAD" && !verifyCsrfForMutation(req, actor)) {
    logSecurityAudit({
      jenisKejadian: "AKSES_PEMBANGUN_GAGAL",
      uid: actor.uid,
      role: actor.role,
      ip: getClientIp(req),
      status: "DISEKAT",
      butiran: `infra_csrf_denied=${req.path}`,
    });
    res.status(403).json({ error: DATABASE_ACCESS_DENIED_MESSAGE });
    return null;
  }

  return actor;
}

app.post("/api/telemetry/firestore-ops", async (req, res) => {
  const actor = await resolveVerifiedActor(req);
  if (!actor || !verifyCsrfForMutation(req, actor)) {
    res.status(401).json({ ok: false });
    return;
  }
  const readsDelta = Number(req.body?.readsDelta || 0);
  const writesDelta = Number(req.body?.writesDelta || 0);
  quotaTracker.recordFirestoreClientOps(readsDelta, writesDelta);
  res.json({ ok: true });
});

app.get("/api/infra/usage-limits", async (req, res) => {
  const actor = await verifyDeveloperInfraAccess(req, res);
  if (!actor) return;
  const config = infraManager.getConfig();
  res.json(
    quotaTracker.getUsageLimitsOverview(
      config.quotaAlerts?.warningThresholdPercent ?? 80,
      config.quotaAlerts?.criticalThresholdPercent ?? 90
    )
  );
});

app.get("/api/infra/overview", async (req, res) => {
  const actor = await verifyDeveloperInfraAccess(req, res);
  if (!actor) return;

  const servers = infraManager.getServerTelemetryList();
  const loadBalancer = infraManager.getLoadBalancerSummary();
  const config = infraManager.getConfig();
  const traffic = infraManager.getTrafficSeries();
  const database = backupManager.getDatabaseMonitoringStats();
  const backups = backupManager.listBackups();
  const usageLimits = quotaTracker.getUsageLimitsOverview(
    config.quotaAlerts?.warningThresholdPercent ?? 80,
    config.quotaAlerts?.criticalThresholdPercent ?? 90
  );

  res.json({
    servers,
    loadBalancer,
    config,
    traffic,
    database,
    backups,
    usageLimits,
    cloudDeployment: {
      runtimeEnvironment: isProduction ? "production" : "development",
      zeroCostMode: true,
      monthlyBudgetTarget: "RM0.00",
      architectureType: "Single Runtime + Logical Pool Simulation (Server A/B/C) + Cloudflare Free Target",
      managedCloudRunActive: Boolean(process.env.K_SERVICE || process.env.K_REVISION),
      serviceName: process.env.K_SERVICE || "local-single-runtime",
      revision: process.env.K_REVISION || "zero-cost-dev",
      region: config.autoscaling.region,
      geminiApiKeyConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0),
    },
  });
});

app.post("/api/infra/health-check", async (req, res) => {
  const actor = await verifyDeveloperInfraAccess(req, res);
  if (!actor) return;

  const servers = await infraManager.runHealthChecks();
  res.json({
    ok: true,
    servers,
    loadBalancer: infraManager.getLoadBalancerSummary(),
  });
});

app.post("/api/infra/servers/:nodeId/mode", async (req, res) => {
  const actor = await verifyDeveloperInfraAccess(req, res);
  if (!actor) return;

  const nodeId = String(req.params.nodeId || "").trim();
  const mode = String(req.body?.mode || "").trim().toUpperCase();
  if (mode !== "ACTIVE" && mode !== "MAINTENANCE" && mode !== "OFFLINE") {
    res.status(400).json({ error: "Mod pelayan tidak sah. Gunakan ACTIVE, MAINTENANCE atau OFFLINE." });
    return;
  }

  const result = await infraManager.setServerMode(nodeId, mode);
  if (!result.ok) {
    res.status(404).json({ error: result.error || "Pelayan tidak ditemui." });
    return;
  }

  logSecurityAudit({
    jenisKejadian: "AKSES_PEMBANGUN_BERJAYA",
    uid: actor.uid,
    role: actor.role,
    ip: getClientIp(req),
    status: "BERJAYA",
    butiran: `server_mode=${nodeId}->${mode}`,
  });

  res.json({
    ok: true,
    node: result.node,
    servers: infraManager.getServerTelemetryList(),
    loadBalancer: infraManager.getLoadBalancerSummary(),
  });
});

app.post("/api/infra/load-balancer/test", async (req, res) => {
  const actor = await verifyDeveloperInfraAccess(req, res);
  if (!actor) return;

  const count = Number(req.body?.requestCount || 6);
  const result = await infraManager.runLoadBalancerDispatchTest(count);
  res.json({
    ok: true,
    ...result,
    servers: infraManager.getServerTelemetryList(),
    loadBalancer: infraManager.getLoadBalancerSummary(),
    traffic: infraManager.getTrafficSeries(),
  });
});

app.post("/api/infra/config", async (req, res) => {
  const actor = await verifyDeveloperInfraAccess(req, res);
  if (!actor) return;

  const body = req.body || {};
  const allowedAlgos: LoadBalancerAlgorithm[] = ["round_robin", "least_connections", "health_based", "failover"];
  if (body.loadBalancer?.algorithm && !allowedAlgos.includes(body.loadBalancer.algorithm)) {
    res.status(400).json({ error: "Algoritma Load Balancer tidak sah." });
    return;
  }

  const updated = infraManager.updateConfig({
    ...(body.loadBalancer ? { loadBalancer: body.loadBalancer } : {}),
    ...(body.autoscaling ? { autoscaling: body.autoscaling } : {}),
    ...(body.backupPolicy ? { backupPolicy: body.backupPolicy } : {}),
    ...(body.quotaAlerts ? { quotaAlerts: body.quotaAlerts } : {}),
  });

  if (updated.backupPolicy.autoBackupEnabled) {
    backupManager.startScheduler();
  } else {
    backupManager.stopScheduler();
  }

  logSecurityAudit({
    jenisKejadian: "AKSES_PEMBANGUN_BERJAYA",
    uid: actor.uid,
    role: actor.role,
    ip: getClientIp(req),
    status: "BERJAYA",
    butiran: `infra_config_updated algo=${updated.loadBalancer.algorithm}`,
  });

  res.json({
    ok: true,
    config: updated,
    loadBalancer: infraManager.getLoadBalancerSummary(),
  });
});

app.get("/api/infra/logs", async (req, res) => {
  const actor = await verifyDeveloperInfraAccess(req, res);
  if (!actor) return;

  const limit = Number(req.query?.limit || 120);
  const level = typeof req.query?.level === "string" ? (req.query.level.toUpperCase() as InfraLogLevel | "ALL") : "ALL";
  res.json({
    logs: infraManager.getLogs(limit, level),
  });
});

app.get("/api/infra/security", async (req, res) => {
  const actor = await verifyDeveloperInfraAccess(req, res);
  if (!actor) return;

  const auditLogs = loadSecurityAuditLogs().slice(-150).reverse();
  const failedLogins = auditLogs.filter((l) => l.jenisKejadian === "LOGIN_GAGAL" || l.jenisKejadian === "AKAUN_DIKUNCI").length;
  const blockedAccess = auditLogs.filter((l) => l.status === "DISEKAT").length;
  const devFailures = auditLogs.filter((l) => l.jenisKejadian === "AKSES_PEMBANGUN_GAGAL").length;

  res.json({
    summary: {
      totalEvents: auditLogs.length,
      failedLoginsAndLockouts: failedLogins,
      blockedUnauthorizedRequests: blockedAccess,
      developerAuthRejections: devFailures,
      bcryptCostFactor: 12,
      csrfProtectionActive: true,
      sessionIdleTimeoutMin: 30,
      zeroSecretsExposed: true,
    },
    auditLogs,
    infraSecurityLogs: infraManager.getLogs(60, "SECURITY"),
  });
});

app.get("/api/infra/backups", async (req, res) => {
  const actor = await verifyDeveloperInfraAccess(req, res);
  if (!actor) return;

  res.json(backupManager.listBackups());
});

app.post("/api/infra/backups/create", async (req, res) => {
  const actor = await verifyDeveloperInfraAccess(req, res);
  if (!actor) return;

  const note = typeof req.body?.note === "string" ? req.body.note : "Manual developer snapshot";
  const result = backupManager.createSystemBackup({
    trigger: "MANUAL",
    actorUsername: actor.username,
    note,
  });

  if (!result.ok) {
    res.status(500).json({ error: result.error || "Gagal mencipta sandaran." });
    return;
  }

  logSecurityAudit({
    jenisKejadian: "AKSES_PEMBANGUN_BERJAYA",
    uid: actor.uid,
    role: actor.role,
    ip: getClientIp(req),
    status: "BERJAYA",
    butiran: `backup_created=${result.backup?.id}`,
  });

  res.json({
    ok: true,
    backup: result.backup,
    ...backupManager.listBackups(),
  });
});

app.post("/api/infra/backups/verify", async (req, res) => {
  const actor = await verifyDeveloperInfraAccess(req, res);
  if (!actor) return;

  const backupId = String(req.body?.backupId || "").trim();
  const result = backupManager.verifyBackupIntegrity(backupId);
  res.status(result.ok ? 200 : 400).json(result);
});

app.get("/api/infra/backups/:backupId/download", async (req, res) => {
  const actor = await verifyDeveloperInfraAccess(req, res);
  if (!actor) return;

  const backupId = String(req.params.backupId || "").trim();
  const result = backupManager.getSanitizedBackupPayload(backupId);
  if (!result.ok || !result.payload || !result.fileName) {
    res.status(404).json({ error: result.error || "Fail sandaran tidak ditemui atau gagal pengesahan integriti." });
    return;
  }

  res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
  res.setHeader("Content-Type", "application/json");
  res.json(result.payload);
});

app.post("/api/infra/backups/restore-preview", async (req, res) => {
  const actor = await verifyDeveloperInfraAccess(req, res);
  if (!actor) return;

  const backupId = String(req.body?.backupId || "").trim();
  const preview = backupManager.previewSafeRestore(backupId);
  res.status(preview.ok ? 200 : 400).json(preview);
});

app.post("/api/infra/backups/restore", async (req, res) => {
  const actor = await verifyDeveloperInfraAccess(req, res);
  if (!actor) return;

  const backupId = String(req.body?.backupId || "").trim();
  const confirmPhrase = String(req.body?.confirmPhrase || "").trim();
  const mode: SafeRestoreMode = req.body?.mode === "replace_registry" ? "replace_registry" : "merge_safe";

  const result = backupManager.executeSafeRestore({
    backupId,
    actorUid: actor.uid,
    actorUsername: actor.username,
    confirmPhrase,
    mode,
  });

  if (!result.ok) {
    res.status(400).json({ error: result.error || "Pemulihan gagal." });
    return;
  }

  res.json({
    ...result,
    ...backupManager.listBackups(),
    database: backupManager.getDatabaseMonitoringStats(),
  });
});

app.post("/api/infra/firestore-telemetry", async (req, res) => {
  const actor = await verifyDeveloperInfraAccess(req, res);
  if (!actor) return;

  infraManager.recordClientFirestoreTelemetry({
    status: String(req.body?.status || "unknown"),
    latencyMs: typeof req.body?.latencyMs === "number" ? req.body.latencyMs : null,
  });
  quotaTracker.recordFirestoreClientOps(1, 0);

  const config = infraManager.getConfig();
  res.json({
    ok: true,
    database: backupManager.getDatabaseMonitoringStats(),
    usageLimits: quotaTracker.getUsageLimitsOverview(
      config.quotaAlerts?.warningThresholdPercent ?? 80,
      config.quotaAlerts?.criticalThresholdPercent ?? 90
    ),
  });
});

// Vite/Static asset serving setup
async function setupServer() {
  try {
    await infraManager.startCluster();
  } catch (clusterErr) {
    console.warn("[Startup Warning] Multi-server loopback pool initialization failed; continuing on primary HTTP listener:", clusterErr);
  }
  try {
    backupManager.startScheduler();
  } catch (schedulerErr) {
    console.warn("[Startup Warning] Backup scheduler initialization failed; continuing startup:", schedulerErr);
  }

  const server = http.createServer(app);
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  const distIndexPath = path.join(distPath, "index.html");

  // If in production or container environment, but dist/index.html is missing, trigger build on the fly
  if (isProduction && !fs.existsSync(distIndexPath)) {
    console.warn(`[Build Notice] Production mode active but ${distIndexPath} was not found. Initiating automated Vite build...`);
    try {
      const { build: viteBuild } = await import("vite");
      await viteBuild();
      console.log(`[Build Notice] Automated Vite build finished successfully!`);
    } catch (buildErr) {
      console.error("[Build Notice] Failed to build client assets on the fly:", buildErr);
    }
  }

  // If dist/index.html exists, serve pre-built static client assets
  if (fs.existsSync(distIndexPath)) {
    console.log(`[Production] Serving static files from: ${distPath}`);
    app.use(express.static(distPath));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/") || req.path === "/healthz") {
        next();
        return;
      }
      if (fs.existsSync(distIndexPath)) {
        res.sendFile(distIndexPath, (err) => {
          if (err) {
            console.error("Error serving index.html:", err);
            next(err);
          }
        });
      } else {
        next();
      }
    });
  } else {
    // Development or fallback mode: Dynamically load Vite middleware
    console.log(`[Development/Fallback] Initializing Vite middleware on port ${PORT}`);
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        port: PORT,
        hmr: {
          server,
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  // Global unhandled error handler (hides raw internal stack/messages in production)
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[Express Error Handler]", err?.code || err?.type || "ERR", isProduction ? "" : err);
    if (!res.headersSent) {
      if (err?.type === "entity.parse.failed") {
        res.status(400).json({ error: "Format JSON permintaan tidak sah." });
      } else if (err?.type === "entity.too.large") {
        res.status(413).json({ error: "Saiz data permintaan melebihi had maksimum 10MB." });
      } else if (err?.code === "ENOENT") {
        res.status(404).send("Application asset not found.");
      } else {
        res.status(500).json({
          error: isProduction
            ? "Ralat dalaman pelayan. Sila cuba lagi."
            : (err?.message || "Internal server error"),
        });
      }
    }
  });

  server.on("error", (err) => {
    console.error("[HTTP Server Fatal Error] Failed to bind listener:", err);
    process.exit(1);
  });

  let shuttingDown = false;
  const gracefulShutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Shutdown] Received ${signal}, closing HTTP server gracefully...`);
    try {
      backupManager.stopScheduler();
    } catch {}
    const forceTimer = setTimeout(() => {
      console.warn("[Shutdown] Forced exit after timeout.");
      process.exit(0);
    }, 5000);
    forceTimer.unref?.();
    Promise.resolve(infraManager.shutdownCluster())
      .catch(() => {})
      .finally(() => {
        server.close(() => {
          clearTimeout(forceTimer);
          process.exit(0);
        });
      });
  };

  process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.once("SIGINT", () => gracefulShutdown("SIGINT"));

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${PORT} (mode: ${isProduction ? "production" : "development"})`);
  });
}

if (process.env.NODE_ENV !== "test") {
  setupServer().catch((err) => {
    console.error("Gagal memulakan server:", err);
    process.exit(1);
  });
}
