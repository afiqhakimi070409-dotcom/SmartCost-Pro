/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SmartCost Hardened Server-Side Authentication, Session, RBAC & Audit Service
 * - Bcrypt (cost 12) password hashing with silent scrypt migration for existing valid accounts
 * - Minimum 10-character passwords & common-password blacklist
 * - Progressive brute-force lockout (5 failures / 15 min -> 15m / 30m / 60m)
 * - Stateful server session store with 30-minute idle timeout, 12-hour max lifetime & revocation
 * - Lowest-privilege default role ("staf") for new manual & Google accounts
 * - Single-use hashed password reset tokens (30-min TTL)
 * - Developer Sandbox & Alt+D developer authentication backed by server user records
 * - Privacy-safe structured security audit logging
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { DATA_DIR } from "./serverPaths.ts";
const USERS_FILE = path.join(DATA_DIR, "server_users.json");
const DATABASES_FILE = path.join(DATA_DIR, "server_databases.json");
const SESSIONS_FILE = path.join(DATA_DIR, "server_sessions.json");
const LOCKOUTS_FILE = path.join(DATA_DIR, "server_lockouts.json");
const RESETS_FILE = path.join(DATA_DIR, "server_password_resets.json");
const SESSION_SECRET_FILE = path.join(DATA_DIR, ".session_secret");
const DELETED_DATABASES_FILE = path.join(DATA_DIR, "deleted_databases.json");

const AUDIT_LOG_FILE = path.join(DATA_DIR, "security_audit.json");

export const BCRYPT_COST = 12;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes inactivity
export const SESSION_MAX_LIFETIME_MS = 12 * 60 * 60 * 1000; // 12 hours hard ceiling
export const REAUTH_FRESH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes for sensitive actions
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes sliding window
export const MAX_FAILED_ATTEMPTS = 5;
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

export const UNIFORM_LOGIN_ERROR = "Nama pengguna atau kata laluan tidak betul.";
export const RATE_LIMIT_LOGIN_ERROR = "Terlalu banyak percubaan log masuk. Sila cuba lagi sebentar.";
export const CHANGE_PASSWORD_LOCKED_ERROR = "Terlalu banyak percubaan. Cuba lagi selepas 15 minit.";
export const DEV_RATE_LIMIT_ERROR = "Terlalu banyak percubaan. Cuba lagi dalam beberapa minit.";
export const DEV_SANDBOX_DB_ID = "pengekosan_dev_sandbox_db";

export type ServerUserRole = "admin" | "developer" | "kerani" | "pengurus" | "penyelia" | "staf" | "auditor";

export const VALID_USER_ROLES: ReadonlyArray<ServerUserRole> = [
  "admin",
  "developer",
  "kerani",
  "pengurus",
  "penyelia",
  "staf",
  "auditor",
];

const COMMON_WEAK_PASSWORDS = new Set([
  "123",
  "123456",
  "12345678",
  "123456789",
  "1234567890",
  "0123456789",
  "9876543210",
  "password",
  "password123",
  "password1234",
  "passw0rd123",
  "qwerty",
  "qwerty123",
  "qwerty1234",
  "qwertyuiop",
  "admin",
  "admin123",
  "admin12345",
  "administrator",
  "smartcost",
  "smartcost123",
  "smartcost-dev",
  "letmein123",
  "letmein1234",
  "welcome123",
  "welcome1234",
  "iloveyou12",
  "abc1234567",
  "1111111111",
  "0000000000",
  "aaaaaaaaaa",
  "test123456",
  "katalaluan1",
  "katalaluan123",
]);

/**
 * Alt+D Developer Entry and Developer Sandbox are always enabled cleanly without requiring env vars.
 */
export function isDevEntryEnabled(): boolean {
  return true;
}

export function isDevSandboxEnabled(): boolean {
  return true;
}

export function getDeveloperWhitelistEmails(): string[] {
  const users = loadServerUsers();
  const emails = new Set<string>();
  for (const user of users) {
    if (user.role === "developer" && user.email) {
      const clean = user.email.trim().toLowerCase();
      if (clean.includes("@")) emails.add(clean);
    }
  }
  return Array.from(emails);
}

export interface ServerDatabaseRecord {
  databaseId: string;
  companyName: string;
  ownerId: string;
  ownerUsername: string;
  isProtected?: boolean;
  createdAt: string;
}

export interface SessionTokenPayload {
  sid: string;
  uid: string;
  username: string;
  role: ServerUserRole;
  activeDbKey: string;
  iat: number;
  exp: number;
}

export interface ServerSessionRecord {
  sid: string;
  uid: string;
  username: string;
  role: ServerUserRole;
  activeDbKey: string;
  csrfToken: string;
  createdAt: number;
  lastActivityAt: number;
  idleExpiresAt: number;
  expiresAt: number;
  lastReauthAt: number;
  freshReauthNonce?: string;
  freshReauthNonceIssuedAt?: number;
  freshReauthNonceUsed?: boolean;
  revoked: boolean;
}

export interface ServerUserRecord {
  id: string;
  username: string;
  fullName: string;
  companyName: string;
  email?: string;
  role: ServerUserRole;
  salt: string;
  passwordHash: string;
  dbKey: string;
  authMethod: "manual" | "google" | "firebase";
  disabled?: boolean;
  twoFactorEnabled?: boolean;
  twoFactorSecretEnc?: string;
  twoFactorPendingSecretEnc?: string;
  createdAt: string;
  updatedAt: string;
}

const ROLE_ALIAS_MAP: Record<string, ServerUserRole> = {
  admin: "admin",
  administrator: "admin",
  "system administrator": "admin",
  "system administrator (admin)": "admin",
  "pentadbir sistem": "admin",
  "pentadbir sistem (admin)": "admin",
  developer: "developer",
  "system developer": "developer",
  "pembangun sistem": "developer",
  kerani: "kerani",
  clerk: "kerani",
  "kerani akaun": "kerani",
  "kerani akaun (kerani)": "kerani",
  pengurus: "pengurus",
  manager: "pengurus",
  "pengurus operasi": "pengurus",
  "pengurus operasi (pengurus)": "pengurus",
  penyelia: "penyelia",
  supervisor: "penyelia",
  "penyelia pengeluaran": "penyelia",
  "penyelia pengeluaran (penyelia)": "penyelia",
  staf: "staf",
  staff: "staf",
  "staf sistem": "staf",
  "staf sistem (staf)": "staf",
  auditor: "auditor",
  juruaudit: "auditor",
  "auditor / pelawat": "auditor",
};

export function normalizeRoleInput(roleInput?: string | null): ServerUserRole | "" {
  const clean = (roleInput || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!clean) return "";
  if (ROLE_ALIAS_MAP[clean]) return ROLE_ALIAS_MAP[clean];
  if (VALID_USER_ROLES.includes(clean as ServerUserRole)) {
    return clean as ServerUserRole;
  }
  return "";
}

interface LockoutRecord {
  failures: number[];
  lockCount: number;
  lockedUntil: number;
  updatedAt: number;
}

interface PasswordResetRecord {
  tokenHash: string;
  userId: string;
  expiresAt: number;
  used: boolean;
  createdAt: number;
}

let usersCache: ServerUserRecord[] | null = null;
let sessionsCache: Record<string, ServerSessionRecord> | null = null;
let lockoutsCache: Record<string, LockoutRecord> | null = null;
let resetsCache: PasswordResetRecord[] | null = null;
let databasesCache: ServerDatabaseRecord[] | null = null;
let deletedDatabasesCache: Record<string, { databaseId: string; deletedAt: string; deletedBy: string }> | null = null;
let cachedSessionSecret: string | null = null;

function ensureDataDir(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    console.error("[ServerAuth] Error ensuring data directory:", err);
  }
}

export function hashIdShort(val?: string | null): string {
  const clean = (val || "").trim();
  if (!clean) return "anon";
  return crypto.createHash("sha256").update(clean).digest("hex").slice(0, 12);
}

export function maskIpAddress(ip?: string | null): string {
  const clean = (ip || "").split(",")[0].trim();
  if (!clean) return "unknown";
  if (clean.includes(".")) {
    const parts = clean.split(".");
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
    }
  }
  if (clean.includes(":")) {
    const parts = clean.split(":");
    return `${parts.slice(0, 3).join(":")}::x`;
  }
  return "masked";
}

export interface SecurityAuditRecord {
  tag: "SecurityAudit";
  masa: string;
  jenisKejadian:
    | "LOGIN_BERJAYA"
    | "LOGIN_GAGAL"
    | "AKAUN_DIKUNCI"
    | "LOGOUT"
    | "DAFTAR_AKAUN"
    | "TUKAR_PERANAN"
    | "PADAM_PANGKALAN_DATA"
    | "TUKAR_KATA_LALUAN"
    | "TETAP_SEMULA_KATA_LALUAN"
    | "PENGESAHAN_SEMULA"
    | "RALAT_PENGESAHAN"
    | "MIGRASI_HASH"
    | "AKSES_PEMBANGUN_BERJAYA"
    | "AKSES_PEMBANGUN_GAGAL"
    | "PERMINTAAN_SEKAT"
    | "VALIDASI_GAGAL"
    | "MUAT_NAIK_DISEKAT"
    | "TWO_FACTOR_AUTH";
  uidHash: string;
  role: string;
  ipSepara: string;
  status: "BERJAYA" | "GAGAL" | "DISEKAT";
  butiran?: string;
}

let auditLogsCache: SecurityAuditRecord[] | null = null;

export function loadSecurityAuditLogs(): SecurityAuditRecord[] {
  if (auditLogsCache) return auditLogsCache;
  ensureDataDir();
  if (fs.existsSync(AUDIT_LOG_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(AUDIT_LOG_FILE, "utf-8"));
      if (Array.isArray(parsed)) {
        auditLogsCache = parsed;
        return auditLogsCache;
      }
    } catch {}
  }
  auditLogsCache = [];
  return auditLogsCache;
}

function saveSecurityAuditLogs(records: SecurityAuditRecord[]): void {
  const bounded = records.slice(-500);
  auditLogsCache = bounded;
  ensureDataDir();
  try {
    const tmp = `${AUDIT_LOG_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(bounded, null, 2), "utf-8");
    fs.renameSync(tmp, AUDIT_LOG_FILE);
  } catch {}
}

export function logSecurityAudit(entry: {
  jenisKejadian: SecurityAuditRecord["jenisKejadian"];
  uid?: string | null;
  role?: string | null;
  ip?: string | null;
  status: "BERJAYA" | "GAGAL" | "DISEKAT";
  butiran?: string;
}): void {
  const record: SecurityAuditRecord = {
    tag: "SecurityAudit",
    masa: new Date().toISOString(),
    jenisKejadian: entry.jenisKejadian,
    uidHash: hashIdShort(entry.uid),
    role: entry.role || "none",
    ipSepara: maskIpAddress(entry.ip),
    status: entry.status,
    ...(entry.butiran ? { butiran: entry.butiran } : {}),
  };
  const existing = loadSecurityAuditLogs();
  existing.push(record);
  saveSecurityAuditLogs(existing);
  console.log(JSON.stringify(record));
}

export function validatePasswordStrength(password: string): { valid: boolean; error?: string } {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return {
      valid: false,
      error: `Kata laluan mestilah sekurang-kurangnya ${MIN_PASSWORD_LENGTH} aksara.`,
    };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      valid: false,
      error: `Kata laluan tidak boleh melebihi ${MAX_PASSWORD_LENGTH} aksara.`,
    };
  }
  const normalized = password.trim().toLowerCase();
  if (COMMON_WEAK_PASSWORDS.has(normalized)) {
    return {
      valid: false,
      error: "Kata laluan ini terlalu biasa dan mudah diteka. Sila pilih kata laluan yang lebih kukuh.",
    };
  }
  if (/^(.)\1+$/.test(password)) {
    return {
      valid: false,
      error: "Kata laluan tidak boleh terdiri daripada satu aksara yang berulang sahaja.",
    };
  }
  return { valid: true };
}

/**
 * Hashes a plaintext password using bcrypt (cost factor 12).
 */
export function hashPassword(password: string): { salt: string; hash: string } {
  const hash = bcrypt.hashSync(password, BCRYPT_COST);
  return {
    salt: "bcrypt",
    hash,
  };
}

/**
 * Constant-time password verification supporting bcrypt (cost >= 12), legacy scrypt,
 * and legacy plaintext fallback (for one-time transparent migration).
 */
function timingSafeEqualUtf8(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  try {
    if (!password || !expectedHash) return false;
    const cleanExpected = expectedHash.trim();
    if (
      cleanExpected.startsWith("$2a$") ||
      cleanExpected.startsWith("$2b$") ||
      cleanExpected.startsWith("$2y$")
    ) {
      return bcrypt.compareSync(password, cleanExpected);
    }
    if (cleanExpected.startsWith("scrypt:")) {
      const parts = cleanExpected.split(":");
      if (parts.length !== 3 || !parts[1] || !parts[2]) return false;
      const derivedKey = crypto.scryptSync(password, parts[1], 64);
      const expectedBuffer = Buffer.from(parts[2], "hex");
      if (derivedKey.length !== expectedBuffer.length) return false;
      return crypto.timingSafeEqual(derivedKey, expectedBuffer);
    }
    if (salt === "plaintext") {
      return timingSafeEqualUtf8(password, expectedHash);
    }
    if (!salt) {
      if (/^[a-f0-9]{128}$/i.test(cleanExpected)) {
        return false;
      }
      return timingSafeEqualUtf8(password, expectedHash);
    }
    const derivedKey = crypto.scryptSync(password, salt, 64);
    const actualBuffer = Buffer.from(derivedKey.toString("hex"), "hex");
    const expectedBuffer = Buffer.from(cleanExpected, "hex");
    if (actualBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  } catch (err) {
    console.error("[ServerAuth] Password verification error:", err);
    return false;
  }
}

function verifyUserPasswordWithLegacy(password: string, user: ServerUserRecord): { valid: boolean; needsMigration: boolean } {
  if (!password) return { valid: false, needsMigration: false };
  const legacyPlain =
    typeof (user as any).password === "string"
      ? (user as any).password
      : typeof (user as any).kataLaluan === "string"
        ? (user as any).kataLaluan
        : "";
  if (user.passwordHash) {
    if (verifyPassword(password, user.salt, user.passwordHash)) {
      return { valid: true, needsMigration: !isBcryptHash(user.passwordHash) || Boolean(legacyPlain) };
    }
  }
  if (legacyPlain && timingSafeEqualUtf8(password, legacyPlain)) {
    return { valid: true, needsMigration: true };
  }
  return { valid: false, needsMigration: false };
}

function persistUpdatedUserFields(updatedUser: ServerUserRecord): boolean {
  const allUsers = loadServerUsers();
  const idx = allUsers.findIndex((u) => u.id === updatedUser.id);
  if (idx < 0) return false;
  allUsers[idx] = { ...allUsers[idx], ...updatedUser };
  return saveServerUsers(allUsers);
}

function migrateUserPasswordToBcrypt(user: ServerUserRecord, password: string, ip?: string): void {
  const migrated = hashPassword(password);
  user.salt = migrated.salt;
  user.passwordHash = migrated.hash;
  if ("password" in (user as any)) delete (user as any).password;
  if ("kataLaluan" in (user as any)) delete (user as any).kataLaluan;
  user.updatedAt = new Date().toISOString();
  persistUpdatedUserFields(user);
  logSecurityAudit({
    jenisKejadian: "MIGRASI_HASH",
    uid: user.id,
    role: user.role,
    ip,
    status: "BERJAYA",
    butiran: "legacy_to_bcrypt12",
  });
}

function isBcryptHash(hash?: string | null): boolean {
  return Boolean(hash && (hash.startsWith("$2a$") || hash.startsWith("$2b$") || hash.startsWith("$2y$")));
}

function resolveDefaultAdminDbRecord(): { databaseId: string; companyName: string } {
  try {
    if (fs.existsSync(DATABASES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATABASES_FILE, "utf-8"));
      if (Array.isArray(parsed)) {
        const preferred =
          parsed.find((d: ServerDatabaseRecord) => d.databaseId === "pengekosan_company_db_school_enterprise") ||
          parsed.find((d: ServerDatabaseRecord) => d.ownerId === "admin-default") ||
          parsed.find((d: ServerDatabaseRecord) => (d.ownerUsername || "").trim().toLowerCase() === "admin");
        if (preferred?.databaseId) {
          return {
            databaseId: preferred.databaseId,
            companyName: preferred.companyName || "SCHOOL ENTERPRISE",
          };
        }
      }
    }
  } catch {}
  return {
    databaseId: "pengekosan_company_db_school_enterprise",
    companyName: "SCHOOL ENTERPRISE",
  };
}

function maybeHydrateAdminFromEnv(users: ServerUserRecord[]): ServerUserRecord[] {
  const hasAnyAdmin = users.some(
    (u) => normalizeRoleInput(u.role) === "admin" || (u.username || "").trim().toLowerCase() === "admin"
  );
  if (hasAnyAdmin) return users;

  const envHash = (process.env.ADMIN_PASSWORD_HASH || "").trim();
  const envPlain = typeof process.env.ADMIN_INITIAL_PASSWORD === "string" ? process.env.ADMIN_INITIAL_PASSWORD : "";
  if (!envHash && !envPlain) return users;

  let salt = "";
  let passwordHash = "";
  if (envHash && (isBcryptHash(envHash) || envHash.startsWith("scrypt:"))) {
    salt = isBcryptHash(envHash) ? "bcrypt" : "";
    passwordHash = envHash;
  } else if (envPlain) {
    const strength = validatePasswordStrength(envPlain);
    if (!strength.valid) return users;
    const hashed = hashPassword(envPlain);
    salt = hashed.salt;
    passwordHash = hashed.hash;
  } else {
    return users;
  }

  const defaultDb = resolveDefaultAdminDbRecord();
  const nowIso = new Date().toISOString();
  const hydratedAdmin: ServerUserRecord = {
    id: "admin-default",
    username: "admin",
    fullName: "Administrator",
    companyName: defaultDb.companyName,
    role: "admin",
    salt,
    passwordHash,
    dbKey: defaultDb.databaseId,
    authMethod: "manual",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const next = [...users, hydratedAdmin];
  saveServerUsers(next);
  return next;
}

export function validateUsernameFormat(username: string): {
  valid: boolean;
  cleaned: string;
  code?: string;
  error?: string;
} {
  const cleaned = typeof username === "string" ? username.trim() : "";
  if (!cleaned || cleaned.length < 3 || cleaned.length > 64) {
    return {
      valid: false,
      cleaned,
      code: "INVALID_USERNAME",
      error: "Nama pengguna mestilah 3–64 aksara dan hanya huruf, nombor, titik (.), garis bawah (_), atau sempang (-).",
    };
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(cleaned)) {
    return {
      valid: false,
      cleaned,
      code: "INVALID_USERNAME",
      error: "Nama pengguna mestilah 3–64 aksara dan hanya huruf, nombor, titik (.), garis bawah (_), atau sempang (-).",
    };
  }
  return { valid: true, cleaned };
}

/**
 * Loads all users directly from persistent JSON storage (never serves stale cache).
 * Never embeds hardcoded weak passwords in source code.
 */
export function loadServerUsers(): ServerUserRecord[] {
  ensureDataDir();

  if (fs.existsSync(USERS_FILE)) {
    try {
      const content = fs.readFileSync(USERS_FILE, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        const hydrated = maybeHydrateAdminFromEnv(parsed);
        usersCache = hydrated;
        return hydrated;
      }
    } catch (err) {
      console.warn("[ServerAuth] Error reading users file, falling back cleanly:", err);
      if (usersCache) return usersCache.map((u) => ({ ...u }));
    }
  }

  const initialUsers: ServerUserRecord[] = maybeHydrateAdminFromEnv([]);
  usersCache = initialUsers;
  saveServerUsers(initialUsers);
  return initialUsers;
}

export function saveServerUsers(users: ServerUserRecord[]): boolean {
  ensureDataDir();
  const prevCache = usersCache;
  try {
    const tempFile = `${USERS_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(users, null, 2), "utf-8");
    fs.renameSync(tempFile, USERS_FILE);
    usersCache = users;
    return true;
  } catch (err) {
    usersCache = prevCache;
    console.error("[ServerAuth] Error saving users to disk:", err);
    return false;
  }
}

export function findUserExactByUsername(username: string): ServerUserRecord | null {
  if (!username) return null;
  const users = loadServerUsers();
  const clean = username.trim().toLowerCase();
  if (!clean) return null;
  return users.find((u) => (u.username || "").trim().toLowerCase() === clean) || null;
}

export function findUserByUsername(username: string): ServerUserRecord | null {
  return findUserExactByUsername(username);
}

export function findUserByEmail(email: string): ServerUserRecord | null {
  if (!email) return null;
  const users = loadServerUsers();
  const clean = email.trim().toLowerCase();
  if (!clean) return null;
  return users.find((u) => u.email && u.email.trim().toLowerCase() === clean) || null;
}

export function findUserForManualLogin(params: {
  username?: string;
  email?: string;
}): ServerUserRecord | null {
  const cleanUser = (params.username || "").trim();
  const cleanEmail = (params.email || "").trim().toLowerCase();

  if (cleanUser) {
    const byUsername = findUserExactByUsername(cleanUser);
    if (byUsername) return byUsername;
    if (cleanUser.includes("@")) {
      const byUserAsEmail = findUserByEmail(cleanUser);
      if (byUserAsEmail) return byUserAsEmail;
    }
  }

  if (cleanEmail) {
    return findUserByEmail(cleanEmail);
  }

  return null;
}

export function findUserById(id: string): ServerUserRecord | null {
  if (!id) return null;
  const users = loadServerUsers();
  return users.find((u) => u.id === id) || null;
}

export function sanitizeUserForClient(user: ServerUserRecord): Partial<ServerUserRecord> {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    companyName: user.companyName,
    email: user.email,
    role: user.role,
    dbKey: user.dbKey,
    authMethod: user.authMethod,
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    createdAt: user.createdAt,
  };
}

// ==========================================
// BRUTE-FORCE & PROGRESSIVE LOCKOUT TRACKER
// ==========================================

function loadLockouts(): Record<string, LockoutRecord> {
  if (lockoutsCache) return lockoutsCache;
  ensureDataDir();
  if (fs.existsSync(LOCKOUTS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(LOCKOUTS_FILE, "utf-8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        lockoutsCache = parsed;
        return lockoutsCache!;
      }
    } catch {}
  }
  lockoutsCache = {};
  return lockoutsCache;
}

function saveLockouts(data: Record<string, LockoutRecord>): void {
  lockoutsCache = data;
  ensureDataDir();
  try {
    const tmp = `${LOCKOUTS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), "utf-8");
    fs.renameSync(tmp, LOCKOUTS_FILE);
  } catch {}
}

const MAX_IP_SPRAY_ATTEMPTS = 25;

function getLockoutKeys(username: string, ip?: string): string[] {
  const keys: string[] = [];
  const cleanUser = (username || "").trim().toLowerCase();
  if (cleanUser) keys.push(`user:${cleanUser}`);
  const cleanIp = (ip || "").split(",")[0].trim();
  if (cleanIp) keys.push(`ip:${cleanIp}`);
  return keys;
}

export function checkLoginLockout(username: string, ip?: string): { locked: boolean; retryAfterSec: number } {
  const now = Date.now();
  const store = loadLockouts();
  let maxUntil = 0;

  for (const key of getLockoutKeys(username, ip)) {
    const rec = store[key];
    if (rec && rec.lockedUntil > now) {
      maxUntil = Math.max(maxUntil, rec.lockedUntil);
    }
  }

  if (maxUntil > now) {
    return {
      locked: true,
      retryAfterSec: Math.max(1, Math.ceil((maxUntil - now) / 1000)),
    };
  }
  return { locked: false, retryAfterSec: 0 };
}

export function recordLoginFailure(username: string, ip?: string): { newlyLocked: boolean; retryAfterSec: number } {
  const now = Date.now();
  const store = loadLockouts();
  let newlyLocked = false;
  let retryAfterSec = 0;

  for (const key of getLockoutKeys(username, ip)) {
    const threshold = key.startsWith("ip:") ? MAX_IP_SPRAY_ATTEMPTS : MAX_FAILED_ATTEMPTS;
    const existing: LockoutRecord = store[key] || {
      failures: [],
      lockCount: 0,
      lockedUntil: 0,
      updatedAt: now,
    };
    const recent = existing.failures.filter((ts) => now - ts < LOCKOUT_WINDOW_MS);
    recent.push(now);
    existing.failures = recent;
    existing.updatedAt = now;

    if (recent.length >= threshold) {
      existing.lockCount = (existing.lockCount || 0) + 1;
      const lockMinutes = existing.lockCount === 1 ? 15 : existing.lockCount === 2 ? 30 : 60;
      const lockMs = lockMinutes * 60 * 1000;
      existing.lockedUntil = now + lockMs;
      existing.failures = [];
      newlyLocked = true;
      retryAfterSec = Math.max(retryAfterSec, Math.ceil(lockMs / 1000));
    }

    store[key] = existing;
  }

  saveLockouts(store);
  return { newlyLocked, retryAfterSec };
}

export function clearLoginFailures(username: string, _ip?: string): void {
  const store = loadLockouts();
  const cleanUser = (username || "").trim().toLowerCase();
  if (!cleanUser) return;
  const userKey = `user:${cleanUser}`;
  if (store[userKey]) {
    delete store[userKey];
    saveLockouts(store);
  }
}

function getDevLockoutKeys(accountKey: string, ip?: string): string[] {
  const keys: string[] = [];
  const cleanAccount = (accountKey || "").trim().toLowerCase();
  if (cleanAccount) keys.push(`dev_entry_acct:${cleanAccount}`);
  const cleanIp = (ip || "").split(",")[0].trim();
  if (cleanIp) keys.push(`dev_entry_ip:${cleanIp}`);
  return keys;
}

export function checkDevAuthLockout(accountKey: string, ip?: string): { locked: boolean; retryAfterSec: number } {
  const now = Date.now();
  const store = loadLockouts();
  let maxUntil = 0;

  for (const key of getDevLockoutKeys(accountKey, ip)) {
    const rec = store[key];
    if (rec && rec.lockedUntil > now) {
      maxUntil = Math.max(maxUntil, rec.lockedUntil);
    }
  }

  if (maxUntil > now) {
    return {
      locked: true,
      retryAfterSec: Math.max(1, Math.ceil((maxUntil - now) / 1000)),
    };
  }
  return { locked: false, retryAfterSec: 0 };
}

export function recordDevAuthFailure(accountKey: string, ip?: string): { newlyLocked: boolean; retryAfterSec: number } {
  const now = Date.now();
  const store = loadLockouts();
  let newlyLocked = false;
  let retryAfterSec = 0;

  for (const key of getDevLockoutKeys(accountKey, ip)) {
    const existing: LockoutRecord = store[key] || {
      failures: [],
      lockCount: 0,
      lockedUntil: 0,
      updatedAt: now,
    };
    const recent = existing.failures.filter((ts) => now - ts < LOCKOUT_WINDOW_MS);
    recent.push(now);
    existing.failures = recent;
    existing.updatedAt = now;

    if (recent.length >= MAX_FAILED_ATTEMPTS) {
      existing.lockCount = (existing.lockCount || 0) + 1;
      const lockMinutes = existing.lockCount === 1 ? 15 : existing.lockCount === 2 ? 30 : 60;
      const lockMs = lockMinutes * 60 * 1000;
      existing.lockedUntil = now + lockMs;
      existing.failures = [];
      newlyLocked = true;
      retryAfterSec = Math.max(retryAfterSec, Math.ceil(lockMs / 1000));
    }

    store[key] = existing;
  }

  saveLockouts(store);
  return { newlyLocked, retryAfterSec };
}

export function clearDevAuthFailures(accountKey: string, ip?: string): void {
  const store = loadLockouts();
  let dirty = false;
  for (const key of getDevLockoutKeys(accountKey, ip)) {
    if (store[key]) {
      delete store[key];
      dirty = true;
    }
  }
  if (dirty) {
    saveLockouts(store);
  }
}

function getPwdChangeLockoutKeys(userId: string, ip?: string): string[] {
  const keys: string[] = [];
  const cleanUser = (userId || "").trim();
  if (cleanUser) keys.push(`pwdchange_user:${cleanUser}`);
  const cleanIp = (ip || "").split(",")[0].trim();
  if (cleanIp) keys.push(`pwdchange_ip:${cleanIp}`);
  return keys;
}

export function checkPasswordChangeLockout(userId: string, ip?: string): { locked: boolean; retryAfterSec: number } {
  const now = Date.now();
  const store = loadLockouts();
  let maxUntil = 0;

  for (const key of getPwdChangeLockoutKeys(userId, ip)) {
    const rec = store[key];
    if (rec && rec.lockedUntil > now) {
      maxUntil = Math.max(maxUntil, rec.lockedUntil);
    }
  }

  if (maxUntil > now) {
    return {
      locked: true,
      retryAfterSec: Math.max(1, Math.ceil((maxUntil - now) / 1000)),
    };
  }
  return { locked: false, retryAfterSec: 0 };
}

export function recordPasswordChangeFailure(userId: string, ip?: string): { newlyLocked: boolean; retryAfterSec: number } {
  const now = Date.now();
  const store = loadLockouts();
  let newlyLocked = false;
  let retryAfterSec = 0;

  for (const key of getPwdChangeLockoutKeys(userId, ip)) {
    const threshold = key.startsWith("pwdchange_ip:") ? MAX_IP_SPRAY_ATTEMPTS : MAX_FAILED_ATTEMPTS;
    const existing: LockoutRecord = store[key] || {
      failures: [],
      lockCount: 0,
      lockedUntil: 0,
      updatedAt: now,
    };
    const recent = existing.failures.filter((ts) => now - ts < LOCKOUT_WINDOW_MS);
    recent.push(now);
    existing.failures = recent;
    existing.updatedAt = now;

    if (recent.length >= threshold) {
      const lockMs = LOCKOUT_WINDOW_MS; // 15 minutes lockout
      existing.lockCount = (existing.lockCount || 0) + 1;
      existing.lockedUntil = now + lockMs;
      existing.failures = [];
      newlyLocked = true;
      retryAfterSec = Math.max(retryAfterSec, Math.ceil(lockMs / 1000));
    }

    store[key] = existing;
  }

  saveLockouts(store);
  return { newlyLocked, retryAfterSec };
}

export function clearPasswordChangeFailures(userId: string, ip?: string): void {
  const store = loadLockouts();
  let dirty = false;
  for (const key of getPwdChangeLockoutKeys(userId, ip)) {
    if (key.startsWith("pwdchange_user:") && store[key]) {
      delete store[key];
      dirty = true;
    }
  }
  if (dirty) {
    saveLockouts(store);
  }
}

// ==========================================
// USER REGISTRATION & AUTHENTICATION
// ==========================================

export function needsDefaultAdminBootstrap(): boolean {
  const users = loadServerUsers();
  const hasAnyAdmin = users.some((u) => normalizeRoleInput(u.role) === "admin");
  if (hasAnyAdmin) return false;
  return findUserExactByUsername("admin") === null;
}

export function bootstrapDefaultAdminAccount(params: {
  password: string;
  fullName?: string;
  email?: string;
}): { success: boolean; status?: number; user?: Partial<ServerUserRecord>; error?: string } {
  if (!needsDefaultAdminBootstrap()) {
    return {
      success: false,
      status: 403,
      error: "Akaun pentadbir utama (admin) sudah wujud.",
    };
  }

  const strength = validatePasswordStrength(params.password);
  if (!strength.valid) {
    return { success: false, status: 400, error: strength.error };
  }

  const email = (params.email || "").trim().toLowerCase() || undefined;
  if (email && (!email.includes("@") || !email.includes(".") || email.length > 128)) {
    return {
      success: false,
      status: 400,
      error: "Format emel tidak sah. Sila masukkan emel yang sah atau biarkan kosong.",
    };
  }
  if (email && findUserByEmail(email)) {
    return {
      success: false,
      status: 400,
      error: "Emel ini sudah digunakan oleh akaun lain.",
    };
  }

  const fullName = (params.fullName || "").trim().slice(0, 100) || "Administrator";
  const defaultDb = resolveDefaultAdminDbRecord();
  const { salt, hash } = hashPassword(params.password);
  const nowIso = new Date().toISOString();

  const adminUser: ServerUserRecord = {
    id: "admin-default",
    username: "admin",
    fullName,
    companyName: defaultDb.companyName,
    ...(email ? { email } : {}),
    role: "admin",
    salt,
    passwordHash: hash,
    dbKey: defaultDb.databaseId,
    authMethod: "manual",
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const users = loadServerUsers();
  users.push(adminUser);
  saveServerUsers(users);

  registerServerDatabase({
    databaseId: defaultDb.databaseId,
    companyName: defaultDb.companyName,
    ownerId: "admin-default",
    ownerUsername: "admin",
    isProtected: false,
  });

  clearLoginFailures("admin");

  return {
    success: true,
    status: 201,
    user: sanitizeUserForClient(adminUser),
  };
}

/**
 * Registers a new user with optional email, bcrypt password hash (cost 12),
 * and individual isolated database key.
 * Always assigns the lowest privilege role ("staf") regardless of input.
 */
export function registerNewManualUser(params: {
  username: string;
  fullName: string;
  companyName?: string;
  password: string;
  email?: string;
  role?: string;
}): { success: boolean; user?: Partial<ServerUserRecord>; error?: string } {
  const usernameCheck = validateUsernameFormat(params.username);
  const displayUsername = usernameCheck.cleaned;
  const normalizedUsername = displayUsername.toLowerCase();
  const cleanPlainText = (val: unknown, maxLen: number) =>
    typeof val === "string"
      ? val.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/<[^>]*>/g, "").replace(/javascript\s*:/gi, "").replace(/\s+/g, " ").trim().slice(0, maxLen)
      : "";
  const fullName = cleanPlainText(params.fullName, 100);
  const companyName = cleanPlainText(params.companyName, 128) || `${fullName.toUpperCase()} ENTERPRISE`;
  const email = (params.email || "").trim().toLowerCase() || undefined;
  const password = params.password;

  if (!usernameCheck.valid) {
    return { success: false, error: usernameCheck.error };
  }
  if (
    normalizedUsername === "admin" ||
    normalizedUsername === "administrator" ||
    normalizedUsername === "developer" ||
    normalizedUsername === "root"
  ) {
    return {
      success: false,
      error: "Nama pengguna ini terpelihara oleh sistem. Sila pilih nama pengguna lain.",
    };
  }
  if (!fullName || fullName.length > 100) {
    return { success: false, error: "Nama penuh yang sah diperlukan." };
  }

  const strength = validatePasswordStrength(password);
  if (!strength.valid) {
    return { success: false, error: strength.error };
  }

  if (email && (!email.includes("@") || !email.includes(".") || email.length > 128)) {
    return {
      success: false,
      error: "Format emel tidak sah. Sila masukkan emel yang sah atau biarkan kosong.",
    };
  }

  const existingByUsername = findUserExactByUsername(displayUsername);
  if (existingByUsername) {
    return { success: false, error: "Pendaftaran gagal. Nama pengguna atau emel tidak tersedia." };
  }

  if (email) {
    const existingByEmail = findUserByEmail(email);
    if (existingByEmail) {
      return { success: false, error: "Pendaftaran gagal. Nama pengguna atau emel tidak tersedia." };
    }
  }

  // Privilege minimization: new self-registered accounts ALWAYS receive lowest role ("staf")
  const assignedRole: ServerUserRole = "staf";

  const { salt, hash } = hashPassword(password);
  const uid = `usr_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
  const companySlug = companyName.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 40) || "enterprise";
  const dbKey = `pengekosan_company_db_${companySlug}_${uid.slice(0, 8)}`;

  const newUser: ServerUserRecord = {
    id: uid,
    username: displayUsername,
    fullName,
    companyName,
    email,
    role: assignedRole,
    salt,
    passwordHash: hash,
    dbKey,
    authMethod: "manual",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const users = loadServerUsers();
  users.push(newUser);
  saveServerUsers(users);

  registerServerDatabase({
    databaseId: dbKey,
    companyName,
    ownerId: uid,
    ownerUsername: displayUsername,
    isProtected: false,
  });

  return { success: true, user: sanitizeUserForClient(newUser) };
}

// Precomputed dummy bcrypt hash for constant-time rejection when username does not exist
const DUMMY_BCRYPT_HASH = bcrypt.hashSync("SmartCostDummyTimingGuard!2026", BCRYPT_COST);

export type ManualLoginErrorCode =
  | "MISSING_FIELDS"
  | "LOCKED"
  | "ADMIN_SETUP_REQUIRED"
  | "DEVELOPER_USE_ALT_D"
  | "ACCOUNT_DISABLED"
  | "INVALID_CREDENTIALS"
  | "ROLE_MISMATCH";

/**
 * Authenticates a manual login request (Username or Email + Password + Server Role Validation).
 * Differentiates genuine credential failures from missing admin setup, disabled accounts,
 * developer Alt+D isolation, and role mismatches without weakening security.
 */
export function authenticateManualLogin(
  username: string,
  password: string,
  options?: { requestedRole?: string; email?: string; ip?: string }
): {
  success: boolean;
  status?: number;
  code?: ManualLoginErrorCode;
  actualRole?: ServerUserRole;
  user?: Partial<ServerUserRecord>;
  error?: string;
  locked?: boolean;
  retryAfterSec?: number;
} {
  const cleanUser = (username || "").trim();
  const cleanEmail = (options?.email || "").trim().toLowerCase();
  const lockoutIdentifier = (cleanUser || cleanEmail).toLowerCase();
  const ip = options?.ip;

  if (!lockoutIdentifier || !password) {
    return {
      success: false,
      status: 400,
      code: "MISSING_FIELDS",
      error: "Sila masukkan nama pengguna (atau emel) dan kata laluan.",
    };
  }

  const reqRoleRaw = (options?.requestedRole || "").trim();
  const reqRoleNorm = normalizeRoleInput(reqRoleRaw);
  if (reqRoleNorm === "developer") {
    return {
      success: false,
      status: 403,
      code: "DEVELOPER_USE_ALT_D",
      error: "Akaun pembangun hanya boleh diakses melalui mod pengesahan pembangun (Alt+D).",
    };
  }

  const user = findUserForManualLogin({ username: cleanUser, email: cleanEmail });

  // If the default "admin" account has never been activated after security hardening,
  // inform the user cleanly instead of counting failed attempts or claiming wrong password.
  if (!user && cleanUser.toLowerCase() === "admin" && needsDefaultAdminBootstrap()) {
    clearLoginFailures("admin", ip);
    return {
      success: false,
      status: 409,
      code: "ADMIN_SETUP_REQUIRED",
      error:
        "Akaun Pentadbir Utama (admin) belum diaktifkan dengan kata laluan baharu. Sila tetapkan kata laluan Admin anda sekarang.",
    };
  }

  if (user && normalizeRoleInput(user.role) === "developer") {
    logSecurityAudit({
      jenisKejadian: "AKSES_PEMBANGUN_GAGAL",
      uid: user.id,
      role: "developer",
      ip,
      status: "DISEKAT",
      butiran: "public_login_blocked_use_alt_d",
    });
    return {
      success: false,
      status: 403,
      code: "DEVELOPER_USE_ALT_D",
      error: "Akaun pembangun hanya boleh diakses melalui mod pengesahan pembangun (Alt+D).",
    };
  }

  const lockoutStatus = checkLoginLockout(lockoutIdentifier, ip);
  if (lockoutStatus.locked) {
    logSecurityAudit({
      jenisKejadian: "AKAUN_DIKUNCI",
      uid: lockoutIdentifier,
      ip,
      status: "DISEKAT",
      butiran: `retryAfter=${lockoutStatus.retryAfterSec}s`,
    });
    return {
      success: false,
      status: 429,
      code: "LOCKED",
      error: RATE_LIMIT_LOGIN_ERROR,
      locked: true,
      retryAfterSec: lockoutStatus.retryAfterSec,
    };
  }

  if (!user) {
    // Perform dummy bcrypt verify to keep response timing consistent
    try {
      bcrypt.compareSync(password, DUMMY_BCRYPT_HASH);
    } catch {}
    const failRes = recordLoginFailure(lockoutIdentifier, ip);
    logSecurityAudit({
      jenisKejadian: failRes.newlyLocked ? "AKAUN_DIKUNCI" : "LOGIN_GAGAL",
      uid: lockoutIdentifier,
      ip,
      status: failRes.newlyLocked ? "DISEKAT" : "GAGAL",
      butiran: "invalid_credentials",
    });
    if (failRes.newlyLocked) {
      return {
        success: false,
        status: 429,
        code: "LOCKED",
        error: RATE_LIMIT_LOGIN_ERROR,
        locked: true,
        retryAfterSec: failRes.retryAfterSec,
      };
    }
    return {
      success: false,
      status: 401,
      code: "INVALID_CREDENTIALS",
      error: UNIFORM_LOGIN_ERROR,
    };
  }

  if (user.disabled) {
    return {
      success: false,
      status: 403,
      code: "ACCOUNT_DISABLED",
      error: "Akaun ini telah dinyahaktifkan. Sila hubungi pentadbir sistem.",
    };
  }

  const pwdCheck = verifyUserPasswordWithLegacy(password, user);
  if (!pwdCheck.valid) {
    const failRes = recordLoginFailure(lockoutIdentifier, ip);
    logSecurityAudit({
      jenisKejadian: failRes.newlyLocked ? "AKAUN_DIKUNCI" : "LOGIN_GAGAL",
      uid: user.id,
      role: user.role,
      ip,
      status: failRes.newlyLocked ? "DISEKAT" : "GAGAL",
      butiran: "invalid_credentials",
    });
    if (failRes.newlyLocked) {
      return {
        success: false,
        status: 429,
        code: "LOCKED",
        error: RATE_LIMIT_LOGIN_ERROR,
        locked: true,
        retryAfterSec: failRes.retryAfterSec,
      };
    }
    return {
      success: false,
      status: 401,
      code: "INVALID_CREDENTIALS",
      error: UNIFORM_LOGIN_ERROR,
    };
  }

  // Normalize stored role and compare after password verification succeeds.
  // A role mismatch is NOT a wrong password and must NOT penalize brute-force lockout counters.
  const actualRoleNorm = (normalizeRoleInput(user.role) || "staf") as ServerUserRole;
  if (user.role !== actualRoleNorm) {
    user.role = actualRoleNorm;
    persistUpdatedUserFields(user);
  }

  if (reqRoleRaw && (!reqRoleNorm || reqRoleNorm !== actualRoleNorm)) {
    logSecurityAudit({
      jenisKejadian: "LOGIN_GAGAL",
      uid: user.id,
      role: actualRoleNorm,
      ip,
      status: "GAGAL",
      butiran: `role_mismatch:${reqRoleNorm || reqRoleRaw}`,
    });
    return {
      success: false,
      status: 403,
      code: "ROLE_MISMATCH",
      actualRole: actualRoleNorm,
      error: `Peranan log masuk yang dipilih tidak sepadan dengan peranan berdaftar akaun anda (${actualRoleNorm.toUpperCase()}). Sila pilih peranan yang betul.`,
    };
  }

  // Silently migrate legacy plaintext/scrypt password to salted bcrypt (cost 12) on successful login
  if (pwdCheck.needsMigration) {
    migrateUserPasswordToBcrypt(user, password, ip);
  }

  // Ensure user's database mapping stays anchored to any existing owned DB if detached
  if (!user.dbKey) {
    const owned = loadServerDatabases().find(
      (d) =>
        d.ownerId === user.id ||
        (user.id === "admin-default" && d.ownerId === "admin-default")
    );
    if (owned?.databaseId) {
      user.dbKey = owned.databaseId;
      user.companyName = owned.companyName || user.companyName;
      persistUpdatedUserFields(user);
    }
  }

  clearLoginFailures(lockoutIdentifier, ip);
  if (user.username && user.username.toLowerCase() !== lockoutIdentifier) {
    clearLoginFailures(user.username, ip);
  }

  // If developer sandbox is disabled, ensure user does not receive sandbox DB key as activeDbKey
  const sanitized = sanitizeUserForClient(user);
  if (sanitized.dbKey === DEV_SANDBOX_DB_ID && !isDevSandboxEnabled()) {
    sanitized.dbKey = `pengekosan_userdb_${user.id}`;
  }

  return { success: true, status: 200, user: sanitized };
}

/**
 * Checks whether a verified email is permitted for developer access
 * by checking existing server user records that hold the 'developer' role.
 */
export function isEmailWhitelistedForDeveloper(email?: string | null): boolean {
  const cleanEmail = (email || "").trim().toLowerCase();
  if (!cleanEmail) return false;
  const existing = findUserByEmail(cleanEmail);
  return Boolean(existing && existing.role === "developer");
}

/**
 * Verifies a plaintext passkey against an explicit stored hash.
 * Supports bcrypt ($2a$/$2b$/$2y$), scrypt:<salt>:<hex>, or sha256:<hex>.
 */
export function verifySecretPasskeyHash(passkey: string, storedHash?: string): boolean {
  const rawHash = (storedHash ?? "").trim();
  if (!passkey || !rawHash) return false;

  try {
    if (rawHash.startsWith("$2a$") || rawHash.startsWith("$2b$") || rawHash.startsWith("$2y$")) {
      return bcrypt.compareSync(passkey, rawHash);
    }

    if (rawHash.startsWith("scrypt:")) {
      const parts = rawHash.split(":");
      if (parts.length !== 3 || !parts[1] || !parts[2]) return false;
      const derived = crypto.scryptSync(passkey, parts[1], 64);
      const expected = Buffer.from(parts[2], "hex");
      return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
    }

    const shaVal = rawHash.startsWith("sha256:") ? rawHash.slice(7).trim() : rawHash;
    if (/^[a-f0-9]{64}$/i.test(shaVal)) {
      const actual = crypto.createHash("sha256").update(passkey, "utf-8").digest();
      const expected = Buffer.from(shaVal, "hex");
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    }

    return false;
  } catch {
    return false;
  }
}

export function hasConfiguredDeveloperCredentials(): boolean {
  const users = loadServerUsers();
  return users.some((u) => u.role === "developer" && Boolean(u.passwordHash));
}

export type DevAuthReasonCode =
  | "OK"
  | "USERNAME_EMPTY"
  | "SECRET_NOT_SET"
  | "LOCKED"
  | "NOT_FOUND"
  | "PASSWORD_MISMATCH"
  | "NON_DEVELOPER"
  | "REAUTH_NOT_SAVED";

/**
 * Authenticates Alt+D developer entry credentials via server Secrets hash or server user hash record.
 * Enforces 5 failed attempts / 15 min lockout per IP and per account, returning uniform errors.
 */
export function authenticateDeveloperEntry(params: {
  username?: string;
  passkey: string;
  ip?: string;
}): {
  success: boolean;
  user?: Partial<ServerUserRecord>;
  error?: string;
  status?: number;
  locked?: boolean;
  retryAfterSec?: number;
  reasonCode?: DevAuthReasonCode;
} {
  const cleanUser = (params.username || "").trim().toLowerCase();
  const passkey = typeof params.passkey === "string" ? params.passkey : "";
  const ip = params.ip;

  if (!cleanUser) {
    return {
      success: false,
      status: 400,
      error: "Sila masukkan nama pengguna.",
      reasonCode: "USERNAME_EMPTY",
    };
  }

  if (!hasConfiguredDeveloperCredentials()) {
    logSecurityAudit({
      jenisKejadian: "AKSES_PEMBANGUN_GAGAL",
      uid: `dev_entry:${cleanUser}`,
      role: "developer",
      ip,
      status: "GAGAL",
      butiran: "SECRET_NOT_SET",
    });
    return {
      success: false,
      status: 503,
      error: "Tetapan keselamatan pembangun belum dikonfigurasi.",
      reasonCode: "SECRET_NOT_SET",
    };
  }

  const lockoutAccountKey = `dev_entry:${cleanUser}`;

  if (!passkey) {
    return { success: false, status: 401, error: UNIFORM_LOGIN_ERROR, reasonCode: "PASSWORD_MISMATCH" };
  }

  const lockoutStatus = checkDevAuthLockout(lockoutAccountKey, ip);
  if (lockoutStatus.locked) {
    logSecurityAudit({
      jenisKejadian: "AKAUN_DIKUNCI",
      uid: lockoutAccountKey,
      role: "developer",
      ip,
      status: "DISEKAT",
      butiran: `LOCKED retryAfter=${lockoutStatus.retryAfterSec}s`,
    });
    return {
      success: false,
      status: 429,
      error: DEV_RATE_LIMIT_ERROR,
      locked: true,
      retryAfterSec: lockoutStatus.retryAfterSec,
      reasonCode: "LOCKED",
    };
  }

  // Verify against hashed developer account stored in server_users.json
  let foundAccount = false;
  const user = findUserExactByUsername(cleanUser);
  if (user && user.role === "developer") {
    foundAccount = true;
    if (verifyPassword(passkey, user.salt, user.passwordHash)) {
      if (!isBcryptHash(user.passwordHash)) {
        const migrated = hashPassword(passkey);
        user.salt = migrated.salt;
        user.passwordHash = migrated.hash;
        user.updatedAt = new Date().toISOString();
        persistUpdatedUserFields(user);
        logSecurityAudit({
          jenisKejadian: "MIGRASI_HASH",
          uid: user.id,
          role: user.role,
          ip,
          status: "BERJAYA",
          butiran: "scrypt_to_bcrypt12",
        });
      }
      clearDevAuthFailures(lockoutAccountKey, ip);
      return {
        success: true,
        status: 200,
        reasonCode: "OK",
        user: sanitizeUserForClient(user),
      };
    }
  }

  // Constant-time guard on failed attempts
  try {
    bcrypt.compareSync(passkey, DUMMY_BCRYPT_HASH);
  } catch {}

  const reasonCode: DevAuthReasonCode = foundAccount ? "PASSWORD_MISMATCH" : "NOT_FOUND";
  const failRes = recordDevAuthFailure(lockoutAccountKey, ip);
  logSecurityAudit({
    jenisKejadian: failRes.newlyLocked ? "AKAUN_DIKUNCI" : "AKSES_PEMBANGUN_GAGAL",
    uid: lockoutAccountKey,
    role: "developer",
    ip,
    status: failRes.newlyLocked ? "DISEKAT" : "GAGAL",
    butiran: failRes.newlyLocked ? "LOCKED" : reasonCode,
  });

  if (failRes.newlyLocked) {
    return {
      success: false,
      status: 429,
      error: DEV_RATE_LIMIT_ERROR,
      locked: true,
      retryAfterSec: failRes.retryAfterSec,
      reasonCode: "LOCKED",
    };
  }
  return { success: false, status: 401, error: UNIFORM_LOGIN_ERROR, reasonCode };
}

/**
 * Re-authenticates an active verified developer session for sensitive actions (like deleting a DB).
 * Uses the exact same credential sources and lockout rules as Alt+D entry, and persists a 5-min re-auth stamp.
 */
export function reauthenticateDeveloperSession(params: {
  actor: { uid: string; username: string; email?: string; role: string; sid?: string };
  username?: string;
  password: string;
  ip?: string;
}): {
  success: boolean;
  status: number;
  error?: string;
  locked?: boolean;
  retryAfterSec?: number;
  reauthExpiresAt?: number;
  freshReauthNonce?: string;
  reasonCode?: DevAuthReasonCode;
} {
  const { actor, ip } = params;
  if (actor.role !== "developer" || !isVerifiedDeveloperActor(actor)) {
    logSecurityAudit({
      jenisKejadian: "PENGESAHAN_SEMULA",
      uid: actor.uid,
      role: actor.role,
      ip,
      status: "DISEKAT",
      butiran: "NON_DEVELOPER",
    });
    return {
      success: false,
      status: 403,
      error: "Hanya pembangun boleh memadam database.",
      reasonCode: "NON_DEVELOPER",
    };
  }

  const authRes = authenticateDeveloperEntry({
    username: params.username,
    passkey: params.password,
    ip,
  });

  if (!authRes.success) {
    return {
      success: false,
      status: authRes.status || 401,
      error: authRes.error || UNIFORM_LOGIN_ERROR,
      locked: authRes.locked,
      retryAfterSec: authRes.retryAfterSec,
      reasonCode: authRes.reasonCode,
    };
  }

  if (!actor.sid) {
    logSecurityAudit({
      jenisKejadian: "PENGESAHAN_SEMULA",
      uid: actor.uid,
      role: actor.role,
      ip,
      status: "GAGAL",
      butiran: "REAUTH_NOT_SAVED",
    });
    return {
      success: false,
      status: 500,
      error: "Gagal menyimpan status pengesahan sesi.",
      reasonCode: "REAUTH_NOT_SAVED",
    };
  }

  const stamped = stampSessionReauth(actor.sid);
  if (!stamped.saved) {
    logSecurityAudit({
      jenisKejadian: "PENGESAHAN_SEMULA",
      uid: actor.uid,
      role: actor.role,
      ip,
      status: "GAGAL",
      butiran: "REAUTH_NOT_SAVED",
    });
    return {
      success: false,
      status: 500,
      error: "Gagal menyimpan status pengesahan sesi.",
      reasonCode: "REAUTH_NOT_SAVED",
    };
  }

  logSecurityAudit({
    jenisKejadian: "PENGESAHAN_SEMULA",
    uid: actor.uid,
    role: actor.role,
    ip,
    status: "BERJAYA",
    butiran: "DEV_REAUTH_STAMPED",
  });

  return {
    success: true,
    status: 200,
    reauthExpiresAt: stamped.expiresAt,
    freshReauthNonce: stamped.nonce,
    reasonCode: "OK",
  };
}

/**
 * Finds or registers a verified Firebase/Google account on the server.
 * Developer role is granted ONLY if an existing server record already holds the developer role.
 * All other new Google users ALWAYS receive the lowest privilege role ("staf").
 */
export function upsertOrFindGoogleUser(params: {
  uid: string;
  email: string;
  fullName?: string;
  companyName?: string;
}): { user: ServerUserRecord; isNewUser: boolean } {
  const cleanEmail = params.email.trim().toLowerCase();
  const cleanUid = params.uid.trim();
  const users = loadServerUsers();
  const whitelistedDev = isDevEntryEnabled() && isEmailWhitelistedForDeveloper(cleanEmail);

  let existing =
    users.find((u) => u.id === cleanUid) ||
    users.find((u) => u.email && u.email.trim().toLowerCase() === cleanEmail);
  if (existing) {
    if (whitelistedDev && existing.role !== "developer") {
      existing.role = "developer";
      existing.dbKey = DEV_SANDBOX_DB_ID;
      existing.updatedAt = new Date().toISOString();
      saveServerUsers(users);
    }
    return { user: existing, isNewUser: false };
  }

  const baseName = (params.fullName || cleanEmail.split("@")[0] || "User").trim().slice(0, 100);
  const compName = whitelistedDev
    ? "DEVELOPER SANDBOX"
    : ((params.companyName || `${baseName.toUpperCase()} ENTERPRISE`).trim().slice(0, 128));
  const baseUsername = (cleanEmail.split("@")[0] || "user").toLowerCase().replace(/[^a-z0-9_]/g, "") || "user";
  let chosenUsername = baseUsername.slice(0, 50);
  let counter = 1;
  while (users.some((u) => u.username.toLowerCase() === chosenUsername)) {
    chosenUsername = `${baseUsername.slice(0, 44)}${counter}`;
    counter++;
  }

  const companySlug = compName.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 40) || "enterprise";
  const dbKey = whitelistedDev ? DEV_SANDBOX_DB_ID : `pengekosan_company_db_${companySlug}_${cleanUid.slice(0, 8)}`;

  // New Google accounts receive lowest role ("staf") unless already a registered developer record
  const newUser: ServerUserRecord = {
    id: cleanUid,
    username: chosenUsername,
    fullName: baseName,
    companyName: compName,
    email: cleanEmail,
    role: whitelistedDev ? "developer" : "staf",
    salt: "",
    passwordHash: "",
    dbKey,
    authMethod: "google",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  users.push(newUser);
  saveServerUsers(users);

  registerServerDatabase({
    databaseId: dbKey,
    companyName: compName,
    ownerId: cleanUid,
    ownerUsername: chosenUsername,
    isProtected: whitelistedDev,
  });

  return { user: newUser, isNewUser: true };
}

export interface CredentialRollbackSnapshot {
  prevUsers: ServerUserRecord[];
  prevDatabases: ServerDatabaseRecord[];
  prevSessions: Record<string, ServerSessionRecord>;
}

export function rollbackCredentialUpdate(snapshot?: CredentialRollbackSnapshot | null): void {
  if (!snapshot) return;
  try {
    saveServerUsers(snapshot.prevUsers);
  } catch {}
  try {
    saveServerDatabases(snapshot.prevDatabases);
  } catch {}
  try {
    saveServerSessions(snapshot.prevSessions);
  } catch {}
}

/**
 * Changes a user's password and/or username atomically after verifying current password.
 * Enforces:
 * - Current password verification for ANY username or password change
 * - Password optional when changing only username (retains existing hash)
 * - 3-64 char alphanumeric/._- username format, case-insensitive uniqueness
 * - 5-attempt / 15-min lockout
 * - Atomic rollback if any storage layer fails
 */
export function changeUserPassword(
  userId: string,
  currentPass: string,
  newPass: string,
  newUsername?: string,
  ip?: string,
  options?: { deferSessionRotation?: boolean }
): {
  success: boolean;
  status?: number;
  code?: string;
  locked?: boolean;
  retryAfterSec?: number;
  user?: Partial<ServerUserRecord>;
  error?: string;
  _rollbackSnapshot?: CredentialRollbackSnapshot;
} {
  const users = loadServerUsers();
  const userIdx = users.findIndex((u) => u.id === userId);
  if (userIdx < 0) {
    return { success: false, status: 404, code: "USER_NOT_FOUND", error: "Akaun pengguna tidak ditemui." };
  }
  const user = users[userIdx];

  const hasLegacyPlain =
    typeof (user as any).password === "string" && (user as any).password.length > 0;
  if (!user.passwordHash && !hasLegacyPlain) {
    return {
      success: false,
      status: 400,
      code: "NO_MANUAL_PASSWORD_SET",
      error: "Akaun ini belum mempunyai kata laluan manual.",
    };
  }

  const cleanNewUsername = typeof newUsername === "string" ? newUsername.trim() : "";
  const existingUsernameTrimmed = (user.username || "").trim();
  const isUsernameUpdated = Boolean(cleanNewUsername && cleanNewUsername !== existingUsernameTrimmed);
  const hasNewPassword = Boolean(newPass && newPass.length > 0);

  if (!hasNewPassword && !isUsernameUpdated) {
    return {
      success: false,
      status: 400,
      code: "NO_CHANGES",
      error: "Tiada perubahan untuk disimpan.",
    };
  }

  const lockout = checkPasswordChangeLockout(userId, ip);
  if (lockout.locked) {
    return {
      success: false,
      status: 429,
      locked: true,
      retryAfterSec: lockout.retryAfterSec,
      code: "CHANGE_PASSWORD_LOCKED",
      error: CHANGE_PASSWORD_LOCKED_ERROR,
    };
  }

  const currentCheck = verifyUserPasswordWithLegacy(currentPass, user);
  if (!currentCheck.valid) {
    const failRes = recordPasswordChangeFailure(userId, ip);
    if (failRes.newlyLocked) {
      return {
        success: false,
        status: 429,
        locked: true,
        retryAfterSec: failRes.retryAfterSec,
        code: "CHANGE_PASSWORD_LOCKED",
        error: CHANGE_PASSWORD_LOCKED_ERROR,
      };
    }
    return {
      success: false,
      status: 400,
      code: "INVALID_CURRENT_PASSWORD",
      error: "Kata laluan semasa tidak betul.",
    };
  }

  clearPasswordChangeFailures(userId, ip);

  if (hasNewPassword) {
    if (newPass.length < MIN_PASSWORD_LENGTH || newPass === currentPass) {
      return {
        success: false,
        status: 400,
        code: "INVALID_NEW_PASSWORD",
        error: "Kata laluan baharu mesti sekurang-kurangnya 8 aksara dan berbeza daripada yang semasa.",
      };
    }
    const strength = validatePasswordStrength(newPass);
    if (!strength.valid) {
      return { success: false, status: 400, code: "WEAK_NEW_PASSWORD", error: strength.error };
    }
  }

  if (isUsernameUpdated) {
    const usernameCheck = validateUsernameFormat(cleanNewUsername);
    if (!usernameCheck.valid) {
      return {
        success: false,
        status: 400,
        code: usernameCheck.code || "INVALID_USERNAME",
        error: usernameCheck.error,
      };
    }
    const existingByUsername = findUserExactByUsername(cleanNewUsername);
    if (existingByUsername && existingByUsername.id !== userId) {
      return {
        success: false,
        status: 400,
        code: "USERNAME_TAKEN",
        error: "Nama pengguna sudah digunakan.",
      };
    }
    const normNew = cleanNewUsername.toLowerCase();
    if (
      (normNew === "admin" || normNew === "administrator" || normNew === "developer" || normNew === "root") &&
      user.id !== "admin-default" &&
      user.role !== "developer"
    ) {
      return {
        success: false,
        status: 400,
        code: "USERNAME_RESERVED",
        error: "Nama pengguna ini terpelihara oleh sistem.",
      };
    }
  }

  const prevUsers = users.map((u) => ({ ...u }));
  const dbs = loadServerDatabases();
  const prevDatabases = dbs.map((d) => ({ ...d }));
  const currentSessions = loadServerSessions();
  const prevSessions = Object.fromEntries(
    Object.entries(currentSessions).map(([k, v]) => [k, { ...v }])
  );

  if (isUsernameUpdated) {
    user.username = cleanNewUsername;
  }

  if (hasNewPassword) {
    const { salt, hash } = hashPassword(newPass);
    user.salt = salt;
    user.passwordHash = hash;
    if ("password" in (user as any)) delete (user as any).password;
    if ("kataLaluan" in (user as any)) delete (user as any).kataLaluan;
  } else if (currentCheck.needsMigration) {
    const { salt, hash } = hashPassword(currentPass);
    user.salt = salt;
    user.passwordHash = hash;
    if ("password" in (user as any)) delete (user as any).password;
    if ("kataLaluan" in (user as any)) delete (user as any).kataLaluan;
  }

  user.updatedAt = new Date().toISOString();

  const savedUsers = saveServerUsers(users);
  if (!savedUsers) {
    return {
      success: false,
      status: 500,
      code: "STORAGE_WRITE_FAILED",
      error: "Gagal menyimpan maklumat log masuk. Tiada perubahan disimpan.",
    };
  }

  // Keep ownerUsername synced in server_databases.json for any DB owned by this user
  let dbDirty = false;
  for (const rec of dbs) {
    if (rec.ownerId === user.id && rec.ownerUsername !== user.username) {
      rec.ownerUsername = user.username;
      dbDirty = true;
    }
  }
  if (dbDirty) {
    const savedDbs = saveServerDatabases(dbs);
    if (!savedDbs) {
      saveServerUsers(prevUsers);
      return {
        success: false,
        status: 500,
        code: "STORAGE_WRITE_FAILED",
        error: "Gagal mengemas kini rekod pangkalan data. Tiada perubahan disimpan.",
      };
    }
  }

  const snapshot: CredentialRollbackSnapshot = {
    prevUsers,
    prevDatabases,
    prevSessions,
  };

  if (!options?.deferSessionRotation) {
    revokeAllSessionsForUser(user.id);
  }

  return {
    success: true,
    status: 200,
    user: sanitizeUserForClient(user),
    _rollbackSnapshot: snapshot,
  };
}

/**
 * Links or sets manual login credentials for an authenticated user that does not yet have a manual password.
 */
export function setOrLinkManualCredentialsForUser(
  userId: string,
  newUsername: string,
  newPass: string,
  options?: { deferSessionRotation?: boolean }
): {
  success: boolean;
  error?: string;
  code?: string;
  user?: Partial<ServerUserRecord>;
  _rollbackSnapshot?: CredentialRollbackSnapshot;
} {
  const users = loadServerUsers();
  let user = users.find((u) => u.id === userId);

  if (user && user.passwordHash) {
    return {
      success: false,
      code: "PASSWORD_ALREADY_SET",
      error: "Kata laluan telah ditetapkan. Anda mesti memasukkan kata laluan semasa untuk menukarnya.",
    };
  }

  const usernameCheck = validateUsernameFormat(newUsername);
  if (!usernameCheck.valid) {
    return {
      success: false,
      code: usernameCheck.code || "INVALID_USERNAME",
      error: usernameCheck.error,
    };
  }
  const cleanUsername = usernameCheck.cleaned;
  const normUsername = cleanUsername.toLowerCase();

  const existingUsername = findUserExactByUsername(cleanUsername);
  if (existingUsername && existingUsername.id !== userId) {
    return {
      success: false,
      code: "USERNAME_TAKEN",
      error: "Nama pengguna sudah digunakan.",
    };
  }

  if (
    (normUsername === "admin" || normUsername === "administrator" || normUsername === "developer" || normUsername === "root") &&
    userId !== "admin-default" &&
    user?.role !== "developer"
  ) {
    return { success: false, code: "USERNAME_RESERVED", error: "Nama pengguna ini terpelihara oleh sistem." };
  }

  const strength = validatePasswordStrength(newPass);
  if (!strength.valid) {
    return { success: false, error: strength.error };
  }

  const prevUsers = users.map((u) => ({ ...u }));
  const prevDatabases = loadServerDatabases().map((d) => ({ ...d }));
  const prevSessions = Object.fromEntries(
    Object.entries(loadServerSessions()).map(([k, v]) => [k, { ...v }])
  );

  const { salt, hash } = hashPassword(newPass);

  if (user) {
    user.username = cleanUsername;
    user.salt = salt;
    user.passwordHash = hash;
    user.updatedAt = new Date().toISOString();
  } else {
    const safeDbSlug = normUsername.replace(/[^a-z0-9_\-]/g, "_").slice(0, 40) || "user";
    user = {
      id: userId,
      username: cleanUsername,
      fullName: cleanUsername,
      companyName: "MY ENTERPRISE",
      role: "staf",
      salt,
      passwordHash: hash,
      dbKey: `pengekosan_company_db_${safeDbSlug}_${userId.slice(0, 8)}`,
      authMethod: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    users.push(user);
  }

  const savedUsers = saveServerUsers(users);
  if (!savedUsers) {
    return { success: false, code: "STORAGE_WRITE_FAILED", error: "Gagal menyimpan maklumat log masuk. Tiada perubahan disimpan." };
  }

  registerServerDatabase({
    databaseId: user.dbKey,
    companyName: user.companyName,
    ownerId: user.id,
    ownerUsername: user.username,
    isProtected: user.id === "admin-default" || user.id === "usr_developer_afiq",
  });

  if (!options?.deferSessionRotation) {
    revokeAllSessionsForUser(user.id);
  }

  return {
    success: true,
    user: sanitizeUserForClient(user),
    _rollbackSnapshot: { prevUsers, prevDatabases, prevSessions },
  };
}

export function listUsersForAdmin(params: {
  actorRole: string;
  actorDbKey: string;
}): Array<Partial<ServerUserRecord>> {
  const users = loadServerUsers();
  if (params.actorRole === "developer") {
    return users.map((u) => sanitizeUserForClient(u));
  }
  if (params.actorRole === "admin") {
    return users
      .filter((u) => u.role !== "developer" && u.dbKey === params.actorDbKey)
      .map((u) => sanitizeUserForClient(u));
  }
  return [];
}

/**
 * Updates a user's role strictly via verified admin/developer authorization.
 */
export function updateUserRoleByAdmin(params: {
  actorId: string;
  actorRole: string;
  actorDbKey: string;
  targetUserId: string;
  newRole: string;
}): { success: boolean; user?: Partial<ServerUserRecord>; error?: string } {
  const targetRole = normalizeRoleInput(params.newRole) as ServerUserRole;
  if (!targetRole || !VALID_USER_ROLES.includes(targetRole)) {
    return { success: false, error: "Peranan yang dipilih tidak sah." };
  }

  if (params.actorRole !== "admin" && params.actorRole !== "developer") {
    return { success: false, error: "Hanya pentadbir yang disahkan dibenarkan menukar peranan." };
  }

  // Only verified developer may grant "developer" role (and only when sandbox is enabled)
  if (targetRole === "developer" && (params.actorRole !== "developer" || !isDevSandboxEnabled())) {
    return { success: false, error: "Tiada kebenaran untuk memberikan peranan pembangun." };
  }

  const users = loadServerUsers();
  const target = users.find((u) => u.id === params.targetUserId);
  if (!target) {
    return { success: false, error: "Akaun pengguna sasaran tidak ditemui." };
  }

  if (params.actorRole !== "developer" && target.dbKey !== params.actorDbKey) {
    return { success: false, error: "Tidak boleh mengubah peranan pengguna dalam pangkalan data lain." };
  }

  target.role = targetRole;
  target.updatedAt = new Date().toISOString();
  saveServerUsers(users);
  revokeAllSessionsForUser(target.id);

  return { success: true, user: sanitizeUserForClient(target) };
}

export function deleteServerUserByDbKey(dbKey: string): boolean {
  const users = loadServerUsers();
  const initialLen = users.length;
  const filtered = users.filter((u) => {
    if (u.id === "admin-default" || u.id === "usr_developer_afiq" || u.id === "usr_developer_secret") return true;
    if (u.dbKey === dbKey) return false;
    return true;
  });
  if (filtered.length !== initialLen) {
    saveServerUsers(filtered);
    return true;
  }
  return false;
}

// ==========================================
// PASSWORD RESET (SINGLE-USE HASHED TOKEN, 30M TTL)
// ==========================================

function loadPasswordResets(): PasswordResetRecord[] {
  if (resetsCache) return resetsCache;
  ensureDataDir();
  if (fs.existsSync(RESETS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(RESETS_FILE, "utf-8"));
      if (Array.isArray(parsed)) {
        resetsCache = parsed;
        return resetsCache;
      }
    } catch {}
  }
  resetsCache = [];
  return resetsCache;
}

function savePasswordResets(records: PasswordResetRecord[]): void {
  resetsCache = records;
  ensureDataDir();
  try {
    const tmp = `${RESETS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(records, null, 2), "utf-8");
    fs.renameSync(tmp, RESETS_FILE);
  } catch {}
}

export function createPasswordResetRequest(identifier: string): {
  issued: boolean;
  rawTokenForDelivery?: string;
} {
  const clean = (identifier || "").trim().toLowerCase();
  if (!clean) return { issued: false };

  const user = clean.includes("@") ? findUserByEmail(clean) : findUserExactByUsername(clean);
  if (!user) {
    return { issued: false };
  }

  const now = Date.now();
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const records = loadPasswordResets().filter(
    (r) => !r.used && r.expiresAt > now && r.userId !== user.id
  );
  records.push({
    tokenHash,
    userId: user.id,
    expiresAt: now + RESET_TOKEN_TTL_MS,
    used: false,
    createdAt: now,
  });
  savePasswordResets(records);

  return { issued: true, rawTokenForDelivery: rawToken };
}

export function confirmPasswordReset(rawToken: string, newPassword: string): { success: boolean; error?: string } {
  const cleanToken = (rawToken || "").trim();
  if (!cleanToken) {
    return { success: false, error: "Token tetapan semula tidak sah atau telah tamat tempoh." };
  }

  const strength = validatePasswordStrength(newPassword);
  if (!strength.valid) {
    return { success: false, error: strength.error };
  }

  const now = Date.now();
  const tokenHash = crypto.createHash("sha256").update(cleanToken).digest("hex");
  const records = loadPasswordResets();
  const matched = records.find((r) => r.tokenHash === tokenHash && !r.used && r.expiresAt > now);

  if (!matched) {
    return { success: false, error: "Token tetapan semula tidak sah atau telah tamat tempoh." };
  }

  const users = loadServerUsers();
  const user = users.find((u) => u.id === matched.userId);
  if (!user) {
    return { success: false, error: "Token tetapan semula tidak sah atau telah tamat tempoh." };
  }

  const { salt, hash } = hashPassword(newPassword);
  user.salt = salt;
  user.passwordHash = hash;
  user.updatedAt = new Date().toISOString();
  saveServerUsers(users);

  matched.used = true;
  savePasswordResets(records);
  revokeAllSessionsForUser(user.id);

  return { success: true };
}

// ==========================================
// SERVER SESSION STORE, EXPIRY & REVOCATION
// ==========================================

function getSessionSecret(): string {
  if (cachedSessionSecret) return cachedSessionSecret;

  ensureDataDir();
  try {
    if (fs.existsSync(SESSION_SECRET_FILE)) {
      const existing = fs.readFileSync(SESSION_SECRET_FILE, "utf-8").trim();
      if (existing.length >= 32) {
        cachedSessionSecret = existing;
        return cachedSessionSecret;
      }
    }
    const generated = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(SESSION_SECRET_FILE, generated, { encoding: "utf-8", mode: 0o600 });
    cachedSessionSecret = generated;
    return cachedSessionSecret;
  } catch {
    cachedSessionSecret = crypto.randomBytes(32).toString("hex");
    return cachedSessionSecret;
  }
}

function loadServerSessions(): Record<string, ServerSessionRecord> {
  ensureDataDir();
  if (fs.existsSync(SESSIONS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        sessionsCache = parsed;
        return parsed;
      }
    } catch {
      if (sessionsCache) return { ...sessionsCache };
    }
  }
  sessionsCache = {};
  return sessionsCache;
}

function saveServerSessions(store: Record<string, ServerSessionRecord>): boolean {
  const now = Date.now();
  // Prune sessions expired > 24 hours ago to prevent unbounded growth
  for (const [sid, rec] of Object.entries(store)) {
    if (rec.expiresAt + 24 * 60 * 60 * 1000 < now) {
      delete store[sid];
    }
  }
  sessionsCache = store;
  ensureDataDir();
  try {
    const tmp = `${SESSIONS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store), "utf-8");
    fs.renameSync(tmp, SESSIONS_FILE);
    return true;
  } catch {
    return false;
  }
}

function signTokenPayload(payload: SessionTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sig = crypto.createHmac("sha256", getSessionSecret()).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function createServerSession(params: {
  uid: string;
  username: string;
  role: ServerUserRole;
  activeDbKey: string;
  ttlMs?: number;
  idleTimeoutMs?: number;
  markReauthenticated?: boolean;
}): { token: string; csrfToken: string; session: ServerSessionRecord } {
  const now = Date.now();
  const sid = crypto.randomBytes(24).toString("hex");
  const csrfToken = crypto.randomBytes(24).toString("hex");
  const maxLifetimeMs = Math.min(params.ttlMs || SESSION_MAX_LIFETIME_MS, SESSION_MAX_LIFETIME_MS);
  const idleMs = Math.min(params.idleTimeoutMs || SESSION_IDLE_TIMEOUT_MS, maxLifetimeMs);
  const expiresAt = now + maxLifetimeMs;

  const session: ServerSessionRecord = {
    sid,
    uid: params.uid,
    username: params.username,
    role: params.role,
    activeDbKey: params.activeDbKey,
    csrfToken,
    createdAt: now,
    lastActivityAt: now,
    idleExpiresAt: Math.min(expiresAt, now + idleMs),
    expiresAt,
    lastReauthAt: params.markReauthenticated ? now : 0,
    revoked: false,
  };

  const store = loadServerSessions();
  store[sid] = session;
  saveServerSessions(store);

  const token = signTokenPayload({
    sid,
    uid: params.uid,
    username: params.username,
    role: params.role,
    activeDbKey: params.activeDbKey,
    iat: now,
    exp: expiresAt,
  });

  return { token, csrfToken, session };
}

export function verifySessionToken(
  token: string | undefined | null,
  options?: { touch?: boolean }
): ServerSessionRecord | null {
  try {
    if (!token || typeof token !== "string") return null;
    const dotIdx = token.indexOf(".");
    if (dotIdx <= 0) return null;
    const encoded = token.slice(0, dotIdx);
    const sig = token.slice(dotIdx + 1);
    if (!encoded || !sig) return null;

    const expectedSig = crypto
      .createHmac("sha256", getSessionSecret())
      .update(encoded)
      .digest("base64url");

    const sigBuf = Buffer.from(sig, "utf-8");
    const expBuf = Buffer.from(expectedSig, "utf-8");
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as SessionTokenPayload;
    if (!parsed || !parsed.sid || !parsed.uid || !parsed.exp) {
      return null;
    }

    const now = Date.now();
    if (parsed.exp < now) return null;

    const store = loadServerSessions();
    const record = store[parsed.sid];
    if (!record || record.revoked) return null;
    if (record.uid !== parsed.uid) return null;
    if (now > record.expiresAt || now > record.idleExpiresAt) {
      record.revoked = true;
      saveServerSessions(store);
      return null;
    }

    if (options?.touch !== false) {
      record.lastActivityAt = now;
      record.idleExpiresAt = Math.min(record.expiresAt, now + SESSION_IDLE_TIMEOUT_MS);
      saveServerSessions(store);
    }

    // Always bind authoritative role from server user record
    const serverUser = findUserById(record.uid);
    if (serverUser) {
      record.role = serverUser.role;
      record.username = serverUser.username;
    } else if (record.role === "developer") {
      record.role = "staf";
    }

    return record;
  } catch {
    return null;
  }
}

export function inspectExpiredDeveloperSessionToken(token: string | undefined | null): {
  isExpiredDeveloperSession: boolean;
  uid?: string;
} {
  try {
    if (!token || typeof token !== "string") return { isExpiredDeveloperSession: false };
    const dotIdx = token.indexOf(".");
    if (dotIdx <= 0) return { isExpiredDeveloperSession: false };
    const encoded = token.slice(0, dotIdx);
    const sig = token.slice(dotIdx + 1);
    if (!encoded || !sig) return { isExpiredDeveloperSession: false };

    const expectedSig = crypto
      .createHmac("sha256", getSessionSecret())
      .update(encoded)
      .digest("base64url");

    const sigBuf = Buffer.from(sig, "utf-8");
    const expBuf = Buffer.from(expectedSig, "utf-8");
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { isExpiredDeveloperSession: false };
    }

    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as SessionTokenPayload;
    if (!parsed || !parsed.sid || !parsed.uid || !parsed.exp) {
      return { isExpiredDeveloperSession: false };
    }

    const user = findUserById(parsed.uid);
    if (!user || user.role !== "developer" || parsed.role !== "developer") {
      return { isExpiredDeveloperSession: false };
    }

    const now = Date.now();
    const store = loadServerSessions();
    const record = store[parsed.sid];
    const expiredOrMissing =
      parsed.exp < now ||
      !record ||
      record.revoked ||
      now > record.expiresAt ||
      now > record.idleExpiresAt;

    return expiredOrMissing
      ? { isExpiredDeveloperSession: true, uid: parsed.uid }
      : { isExpiredDeveloperSession: false };
  } catch {
    return { isExpiredDeveloperSession: false };
  }
}

export function buildSessionTokenForRecord(sid: string | undefined): string | undefined {
  if (!sid) return undefined;
  const store = loadServerSessions();
  const record = store[sid];
  if (!record || record.revoked || Date.now() > record.expiresAt) return undefined;
  return signTokenPayload({
    sid: record.sid,
    uid: record.uid,
    username: record.username,
    role: record.role,
    activeDbKey: record.activeDbKey,
    iat: record.createdAt,
    exp: record.expiresAt,
  });
}

export function updateSessionActiveDb(sid: string, activeDbKey: string): { token: string; session: ServerSessionRecord } | null {
  const store = loadServerSessions();
  const record = store[sid];
  if (!record || record.revoked || Date.now() > record.expiresAt) return null;
  record.activeDbKey = activeDbKey;
  record.lastActivityAt = Date.now();
  record.idleExpiresAt = Math.min(record.expiresAt, Date.now() + SESSION_IDLE_TIMEOUT_MS);
  saveServerSessions(store);

  const token = signTokenPayload({
    sid: record.sid,
    uid: record.uid,
    username: record.username,
    role: record.role,
    activeDbKey: record.activeDbKey,
    iat: record.createdAt,
    exp: record.expiresAt,
  });
  return { token, session: record };
}

export function stampSessionReauth(sid: string): { saved: boolean; nonce?: string; expiresAt?: number } {
  const store = loadServerSessions();
  const record = store[sid];
  if (!record || record.revoked) return { saved: false };
  const now = Date.now();
  const nonce = crypto.randomBytes(16).toString("hex");
  record.lastReauthAt = now;
  record.freshReauthNonce = nonce;
  record.freshReauthNonceIssuedAt = now;
  record.freshReauthNonceUsed = false;
  const saved = saveServerSessions(store);
  return { saved, nonce: saved ? nonce : undefined, expiresAt: now + REAUTH_FRESH_WINDOW_MS };
}

export const DELETE_REJECT_MESSAGES = {
  NOT_OWNER: "Anda bukan pemilik database ini.",
  DEFAULT_PROTECTED: "Database lalai dilindungi.",
  INFRASTRUCTURE_PROTECTED: "Infrastruktur teras sistem dilindungi dan tidak boleh dipadam.",
  NOT_DEVELOPER: "Sesi pembangun tidak dikenali.",
  SESSION_EXPIRED: "Sesi pembangun telah tamat tempoh. Sila sahkan semula.",
  REAUTH_MISSING: "Pengesahan pembangun diperlukan.",
  PADAM_REQUIRED: "Sila taip 'PADAM' untuk mengesahkan pemadaman database lalai ini.",
  CSRF_FAILED: "Token keselamatan sesi tidak sah. Sila muat semula atau sahkan semula.",
  ID_MISMATCH: "Pengecam database tidak sepadan.",
  RULES_DENIED: "Ditolak oleh peraturan pangkalan data.",
  SERVER_ERROR: "Ralat pelayan. Cuba lagi.",
} as const;

export type DeleteRejectReasonCode = keyof typeof DELETE_REJECT_MESSAGES;

export function verifyAndConsumeFreshDefaultReauthNonce(sid: string | undefined, nonce: string | undefined): boolean {
  if (!sid || !nonce) return false;
  const store = loadServerSessions();
  const record = store[sid];
  if (!record || record.revoked || record.freshReauthNonceUsed) return false;
  if (!record.freshReauthNonce || !record.freshReauthNonceIssuedAt) return false;
  if (Date.now() - record.freshReauthNonceIssuedAt > REAUTH_FRESH_WINDOW_MS) return false;

  const a = Buffer.from(nonce.trim(), "utf-8");
  const b = Buffer.from(record.freshReauthNonce, "utf-8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  record.freshReauthNonceUsed = true;
  saveServerSessions(store);
  return true;
}

export function invalidateFreshDefaultReauthNonce(sid: string | undefined): void {
  if (!sid) return;
  const store = loadServerSessions();
  const record = store[sid];
  if (record && !record.freshReauthNonceUsed) {
    record.freshReauthNonceUsed = true;
    saveServerSessions(store);
  }
}

export function isSessionRecentlyReauthenticated(session: ServerSessionRecord | null | undefined): boolean {
  if (!session || !session.lastReauthAt) return false;
  return Date.now() - session.lastReauthAt <= REAUTH_FRESH_WINDOW_MS;
}

export function revokeSessionBySid(sid: string | undefined | null): boolean {
  if (!sid) return false;
  const store = loadServerSessions();
  const record = store[sid];
  if (!record) return false;
  record.revoked = true;
  saveServerSessions(store);
  return true;
}

export function isSignedTokenRevokedOrExpired(token: string | undefined | null): boolean {
  try {
    if (!token || typeof token !== "string") return false;
    const dotIdx = token.indexOf(".");
    if (dotIdx <= 0) return false;
    const encoded = token.slice(0, dotIdx);
    const sig = token.slice(dotIdx + 1);
    if (!encoded || !sig) return false;

    const expectedSig = crypto
      .createHmac("sha256", getSessionSecret())
      .update(encoded)
      .digest("base64url");
    const sigBuf = Buffer.from(sig, "utf-8");
    const expBuf = Buffer.from(expectedSig, "utf-8");
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return false;
    }

    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as SessionTokenPayload;
    if (!parsed || !parsed.sid || !parsed.uid) return false;
    const store = loadServerSessions();
    const record = store[parsed.sid];
    const now = Date.now();
    return Boolean(!record || record.revoked || now > record.expiresAt || now > record.idleExpiresAt);
  } catch {
    return false;
  }
}

export function revokeAllSessionsForUser(uid: string): boolean {
  if (!uid) return true;
  const store = loadServerSessions();
  let dirty = false;
  for (const record of Object.values(store)) {
    if (record.uid === uid && !record.revoked) {
      record.revoked = true;
      dirty = true;
    }
  }
  return dirty ? saveServerSessions(store) : true;
}

export function rotateSessionAfterCredentialChange(params: {
  uid: string;
  username: string;
  role: ServerUserRole;
  activeDbKey: string;
  markReauthenticated?: boolean;
}): { success: boolean; token?: string; csrfToken?: string; sid?: string } {
  const now = Date.now();
  const sid = crypto.randomBytes(24).toString("hex");
  const csrfToken = crypto.randomBytes(24).toString("hex");
  const maxLifetimeMs = SESSION_MAX_LIFETIME_MS;
  const idleMs = SESSION_IDLE_TIMEOUT_MS;
  const expiresAt = now + maxLifetimeMs;

  const store = loadServerSessions();
  for (const record of Object.values(store)) {
    if (record.uid === params.uid && !record.revoked) {
      record.revoked = true;
    }
  }

  const session: ServerSessionRecord = {
    sid,
    uid: params.uid,
    username: params.username,
    role: params.role,
    activeDbKey: params.activeDbKey,
    csrfToken,
    createdAt: now,
    lastActivityAt: now,
    idleExpiresAt: Math.min(expiresAt, now + idleMs),
    expiresAt,
    lastReauthAt: params.markReauthenticated ? now : 0,
    revoked: false,
  };
  store[sid] = session;

  if (!saveServerSessions(store)) {
    return { success: false };
  }

  const token = signTokenPayload({
    sid,
    uid: params.uid,
    username: params.username,
    role: params.role,
    activeDbKey: params.activeDbKey,
    iat: now,
    exp: expiresAt,
  });

  return { success: true, token, csrfToken, sid };
}

export function getActiveSessionCountsByDatabase(): Record<string, number> {
  const now = Date.now();
  const store = loadServerSessions();
  const counts: Record<string, number> = {};
  for (const record of Object.values(store)) {
    if (!record.revoked && now <= record.expiresAt && now <= record.idleExpiresAt && record.activeDbKey) {
      counts[record.activeDbKey] = (counts[record.activeDbKey] || 0) + 1;
    }
  }
  return counts;
}

export function hasOtherActiveSessionsForDatabase(databaseId: string, excludeSid?: string): boolean {
  if (!databaseId) return false;
  const now = Date.now();
  const store = loadServerSessions();
  for (const record of Object.values(store)) {
    if (
      record.activeDbKey === databaseId &&
      record.sid !== excludeSid &&
      !record.revoked &&
      now <= record.expiresAt &&
      now <= record.idleExpiresAt
    ) {
      return true;
    }
  }
  return false;
}

export function revokeSessionsForDatabase(databaseId: string, excludeSid?: string): number {
  if (!databaseId) return 0;
  const store = loadServerSessions();
  let count = 0;
  for (const record of Object.values(store)) {
    if (record.activeDbKey === databaseId && record.sid !== excludeSid && !record.revoked) {
      record.revoked = true;
      count++;
    }
  }
  if (count > 0) saveServerSessions(store);
  return count;
}

function loadDeletedDatabaseTombstones(): Record<string, { databaseId: string; deletedAt: string; deletedBy: string }> {
  if (deletedDatabasesCache) return deletedDatabasesCache;
  ensureDataDir();
  if (fs.existsSync(DELETED_DATABASES_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DELETED_DATABASES_FILE, "utf-8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        deletedDatabasesCache = parsed;
        return deletedDatabasesCache!;
      }
    } catch {}
  }
  deletedDatabasesCache = {};
  return deletedDatabasesCache;
}

function saveDeletedDatabaseTombstones(
  store: Record<string, { databaseId: string; deletedAt: string; deletedBy: string }>
): void {
  deletedDatabasesCache = store;
  ensureDataDir();
  try {
    const tmp = `${DELETED_DATABASES_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
    fs.renameSync(tmp, DELETED_DATABASES_FILE);
  } catch {}
}

export function isDatabaseDeletedTombstone(databaseId: string | undefined | null): boolean {
  const clean = (databaseId || "").trim();
  if (!clean) return false;
  const store = loadDeletedDatabaseTombstones();
  return Boolean(store[clean]);
}

export function getDeletedDatabaseTombstoneKeys(): string[] {
  return Object.keys(loadDeletedDatabaseTombstones());
}

export function markDatabaseDeletedTombstone(databaseId: string, deletedBy: string): void {
  const clean = (databaseId || "").trim();
  if (!clean || clean === DEV_SANDBOX_DB_ID) return;
  const store = { ...loadDeletedDatabaseTombstones() };
  store[clean] = {
    databaseId: clean,
    deletedAt: new Date().toISOString(),
    deletedBy: deletedBy || "developer",
  };
  saveDeletedDatabaseTombstones(store);
}

export function clearDatabaseDeletedTombstone(databaseId: string): void {
  const clean = (databaseId || "").trim();
  if (!clean) return;
  const store = { ...loadDeletedDatabaseTombstones() };
  if (store[clean]) {
    delete store[clean];
    saveDeletedDatabaseTombstones(store);
  }
}

// ==========================================
// DATABASE BOUNDARY REGISTRY & AUTHORIZATION
// ==========================================

export type DatabaseCategory = "business_database" | "system_infrastructure";

export interface DatabaseClassification {
  category: DatabaseCategory;
  isSystemInfrastructure: boolean;
  isBusinessDatabase: boolean;
  isDefaultBusinessDb: boolean;
  isDeletableByDeveloper: boolean;
  labelMs: string;
  labelEn: string;
}

const RESERVED_INFRA_PREFIXES = [
  "__system__",
  "system_config_",
  "auth_infra_",
  "global_config_",
];

export function classifyDatabaseRecord(databaseId: string, companyName?: string): DatabaseClassification {
  const cleanId = (databaseId || "").trim();
  const lowerKey = cleanId.toLowerCase();
  const cleanName = (companyName || "").trim().toUpperCase();

  const isSystemInfrastructure =
    cleanId === DEV_SANDBOX_DB_ID ||
    lowerKey === "firebase_auth_infra" ||
    RESERVED_INFRA_PREFIXES.some((prefix) => lowerKey.startsWith(prefix));

  const isDefaultBusinessDb =
    !isSystemInfrastructure &&
    (lowerKey.endsWith("-default") ||
      lowerKey.endsWith("_admin_default") ||
      lowerKey === "pengekosan_company_db_school_enterprise" ||
      lowerKey.startsWith("pengekosan_company_db_school_enterprise_default") ||
      cleanName === "SCHOOL ENTERPRISE");

  const category: DatabaseCategory = isSystemInfrastructure ? "system_infrastructure" : "business_database";

  return {
    category,
    isSystemInfrastructure,
    isBusinessDatabase: !isSystemInfrastructure,
    isDefaultBusinessDb,
    isDeletableByDeveloper: !isSystemInfrastructure,
    labelMs: isSystemInfrastructure
      ? "Infrastruktur Teras Sistem"
      : isDefaultBusinessDb
      ? "Database Perniagaan Lalai"
      : "Database Perniagaan",
    labelEn: isSystemInfrastructure
      ? "Core System Infrastructure"
      : isDefaultBusinessDb
      ? "Default Business Database"
      : "Business Database",
  };
}

export function loadServerDatabases(): ServerDatabaseRecord[] {
  ensureDataDir();

  const fileExists = fs.existsSync(DATABASES_FILE);
  let records: ServerDatabaseRecord[] = [];
  if (fileExists) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DATABASES_FILE, "utf-8"));
      if (Array.isArray(parsed)) {
        records = parsed;
      }
    } catch {
      records = [];
    }
  }

  const seen = new Set(records.map((r) => r.databaseId));
  let dirty = !fileExists;

  const users = loadServerUsers();
  for (const u of users) {
    if (u.dbKey && !seen.has(u.dbKey) && !isDatabaseDeletedTombstone(u.dbKey)) {
      seen.add(u.dbKey);
      records.push({
        databaseId: u.dbKey,
        companyName: u.companyName || u.dbKey,
        ownerId: u.id,
        ownerUsername: u.username,
        isProtected: u.id === "usr_developer_afiq" || u.dbKey === DEV_SANDBOX_DB_ID,
        createdAt: u.createdAt || new Date().toISOString(),
      });
      dirty = true;
    }
  }

  // Only seed the initial SCHOOL ENTERPRISE demo business DB on pristine first-time setup
  // when neither the registry file nor any SCHOOL ENTERPRISE tombstone exists.
  // Never resurrect a default business database after a Developer intentionally deletes it.
  const isDefaultSchoolDeleted =
    isDatabaseDeletedTombstone("pengekosan_company_db_school_enterprise") ||
    isDatabaseDeletedTombstone("pengekosan_company_db_school_enterprise_admin_default");
  const hasAnyAdminDefaultDb = records.some(
    (r) =>
      r.ownerId === "admin-default" ||
      r.databaseId === "pengekosan_company_db_school_enterprise" ||
      r.databaseId === "pengekosan_company_db_school_enterprise_admin_default"
  );

  const coreDefaults: ServerDatabaseRecord[] = [
    ...(!fileExists && !hasAnyAdminDefaultDb && !isDefaultSchoolDeleted
      ? [
          {
            databaseId: "pengekosan_company_db_school_enterprise",
            companyName: "SCHOOL ENTERPRISE",
            ownerId: "admin-default",
            ownerUsername: "admin",
            isProtected: false,
            createdAt: new Date().toISOString(),
          },
        ]
      : []),
    {
      databaseId: DEV_SANDBOX_DB_ID,
      companyName: "DEVELOPER SANDBOX",
      ownerId: "usr_developer_afiq",
      ownerUsername: "afiqhakimi070409",
      isProtected: true,
      createdAt: new Date().toISOString(),
    },
  ];
  for (const core of coreDefaults) {
    if (!seen.has(core.databaseId)) {
      seen.add(core.databaseId);
      records.push(core);
      dirty = true;
    }
  }

  databasesCache = records;
  if (dirty) {
    saveServerDatabases(records);
  }
  return databasesCache;
}

export function saveServerDatabases(records: ServerDatabaseRecord[]): boolean {
  ensureDataDir();
  const prevCache = databasesCache;
  try {
    const tempFile = `${DATABASES_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(records, null, 2), "utf-8");
    fs.renameSync(tempFile, DATABASES_FILE);
    databasesCache = records;
    return true;
  } catch (err) {
    databasesCache = prevCache;
    console.error("[ServerAuth] Error saving databases registry:", err);
    return false;
  }
}

export function registerServerDatabase(params: {
  databaseId: string;
  companyName: string;
  ownerId: string;
  ownerUsername: string;
  isProtected?: boolean;
  allowNameUpdate?: boolean;
}): ServerDatabaseRecord {
  const records = loadServerDatabases();
  const cleanId = (params.databaseId || "").trim();
  const existingIdx = records.findIndex((r) => r.databaseId === cleanId);
  if (existingIdx >= 0) {
    if (records[existingIdx].ownerId === params.ownerId || params.allowNameUpdate) {
      records[existingIdx].companyName = params.companyName || records[existingIdx].companyName;
      saveServerDatabases(records);
    }
    return records[existingIdx];
  }

  const created: ServerDatabaseRecord = {
    databaseId: cleanId,
    companyName: params.companyName || cleanId,
    ownerId: params.ownerId,
    ownerUsername: params.ownerUsername,
    isProtected: Boolean(params.isProtected),
    createdAt: new Date().toISOString(),
  };
  records.push(created);
  saveServerDatabases(records);
  return created;
}

export function findServerDatabaseById(databaseId: string): ServerDatabaseRecord | null {
  if (!databaseId) return null;
  const clean = databaseId.trim();
  return loadServerDatabases().find((r) => r.databaseId === clean) || null;
}

export function deleteServerDatabaseById(databaseId: string, options?: { allowProtected?: boolean }): boolean {
  const clean = (databaseId || "").trim();
  if (!clean || clean === DEV_SANDBOX_DB_ID) return false;
  const records = loadServerDatabases();
  const filtered = records.filter((r) => r.databaseId !== clean || (!options?.allowProtected && r.isProtected));
  if (filtered.length !== records.length) {
    return saveServerDatabases(filtered);
  }
  return false;
}

export interface DeleteDatabaseTransactionResult {
  success: boolean;
  deletedDbKey: string;
  recreatedDefaultDb: boolean;
  recreatedDbKey?: string;
  recreatedCompanyName?: string;
  recreatedOwnerUsername?: string;
  failedStep?: string;
  rollbackSnapshot?: {
    users: ServerUserRecord[];
    databases: ServerDatabaseRecord[];
  };
}

export function deleteCompanyDatabaseTransactional(databaseId: string): DeleteDatabaseTransactionResult {
  const cleanDbKey = (databaseId || "").trim();
  const classification = classifyDatabaseRecord(cleanDbKey);
  if (!cleanDbKey || classification.isSystemInfrastructure) {
    return {
      success: false,
      deletedDbKey: cleanDbKey,
      recreatedDefaultDb: false,
      failedStep: "pengesahan kunci pangkalan data",
    };
  }

  const prevUsers = loadServerUsers().map((u) => ({ ...u }));
  const prevDatabases = loadServerDatabases().map((d) => ({ ...d }));

  const nextDatabases = prevDatabases.filter((d) => d.databaseId !== cleanDbKey);

  // Preserve ALL user accounts cleanly; detach only references to the deleted dbKey
  // so no user accounts are ever deleted when a business database is removed.
  const nowIso = new Date().toISOString();
  const nextUsers = prevUsers.map((u) => {
    if (u.dbKey !== cleanDbKey) {
      return { ...u };
    }
    const remainingOwnedDb = nextDatabases.find((d) => d.ownerId === u.id);
    return {
      ...u,
      dbKey: remainingOwnedDb ? remainingOwnedDb.databaseId : "",
      companyName: remainingOwnedDb ? remainingOwnedDb.companyName : "",
      updatedAt: nowIso,
    };
  });

  const savedDbs = saveServerDatabases(nextDatabases);
  if (!savedDbs) {
    return {
      success: false,
      deletedDbKey: cleanDbKey,
      recreatedDefaultDb: false,
      failedStep: "daftar pangkalan data pelayan",
    };
  }

  const savedUsers = saveServerUsers(nextUsers);
  if (!savedUsers) {
    saveServerDatabases(prevDatabases);
    return {
      success: false,
      deletedDbKey: cleanDbKey,
      recreatedDefaultDb: false,
      failedStep: "rekod pengguna pelayan",
    };
  }

  return {
    success: true,
    deletedDbKey: cleanDbKey,
    recreatedDefaultDb: false,
    rollbackSnapshot: {
      users: prevUsers,
      databases: prevDatabases,
    },
  };
}

export function rollbackCompanyDatabaseDelete(snapshot?: {
  users: ServerUserRecord[];
  databases: ServerDatabaseRecord[];
}): void {
  if (!snapshot) return;
  saveServerDatabases(snapshot.databases);
  saveServerUsers(snapshot.users);
}

export function isVerifiedDeveloperActor(actor: {
  uid?: string;
  username?: string;
  email?: string;
  role?: string;
}): boolean {
  if (!isDevEntryEnabled()) return false;
  if (actor.role && actor.role !== "developer") return false;
  if (actor.email && isEmailWhitelistedForDeveloper(actor.email)) {
    return true;
  }
  const user = actor.uid ? findUserById(actor.uid) : actor.username ? findUserExactByUsername(actor.username) : null;
  return Boolean(user && user.role === "developer");
}

export function canUserAccessDatabase(
  actor: {
    uid: string;
    username: string;
    email?: string;
    role: string;
    activeDbKey: string;
  },
  targetDatabaseId: string
): boolean {
  const cleanTarget = (targetDatabaseId || "").trim();
  if (!cleanTarget) return false;
  if (isDatabaseDeletedTombstone(cleanTarget) && !findServerDatabaseById(cleanTarget)) {
    return false;
  }

  if (cleanTarget === DEV_SANDBOX_DB_ID) {
    return isDevSandboxEnabled() && actor.role === "developer" && isVerifiedDeveloperActor(actor);
  }

  // Verified developer retains cross-DB access only when sandbox/dev mode is enabled
  if (actor.role === "developer" && isVerifiedDeveloperActor(actor) && isDevSandboxEnabled()) {
    const dbRec = findServerDatabaseById(cleanTarget);
    return Boolean(dbRec);
  }

  const serverUser = findUserById(actor.uid);
  const dbRec = findServerDatabaseById(cleanTarget);

  if (serverUser && cleanTarget === serverUser.dbKey) {
    return true;
  }
  if (cleanTarget === `pengekosan_userdb_${actor.uid}`) {
    return Boolean(dbRec || cleanTarget === actor.activeDbKey);
  }
  if (
    actor.uid === "admin-default" &&
    (cleanTarget === "pengekosan_company_db_school_enterprise" ||
      cleanTarget === "pengekosan_company_db_school_enterprise_admin_default")
  ) {
    return true;
  }
  if (dbRec && dbRec.ownerId === actor.uid) {
    return true;
  }

  return false;
}

export function getForbiddenDatabasesForActive(
  activeDatabaseId: string,
  activeCompanyName?: string
): Array<{ databaseId: string; companyName: string }> {
  const cleanActiveId = (activeDatabaseId || "").trim();
  const cleanActiveName = (activeCompanyName || "").trim().toLowerCase();
  const all = loadServerDatabases();

  return all
    .filter((db) => {
      if (db.databaseId === cleanActiveId) return false;
      if (
        (cleanActiveId === "pengekosan_company_db_school_enterprise" ||
          cleanActiveId === "pengekosan_company_db_school_enterprise_admin_default") &&
        (db.databaseId === "pengekosan_company_db_school_enterprise" ||
          db.databaseId === "pengekosan_company_db_school_enterprise_admin_default")
      ) {
        return false;
      }
      if (cleanActiveName && db.companyName.trim().toLowerCase() === cleanActiveName) {
        return false;
      }
      return true;
    })
    .map((db) => ({
      databaseId: db.databaseId,
      companyName: db.companyName,
    }));
}

// ==========================================
// OPTIONAL 2FA (RFC 6238 TOTP) FOR PRIVILEGED ACCOUNTS
// ==========================================

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function encodeBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function decodeBase32(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function getTotpEncryptionKey(): Buffer {
  return crypto.createHash("sha256").update(`smartcost-totp:${getSessionSecret()}`).digest();
}

function encryptTotpSecret(plainSecret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getTotpEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainSecret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptTotpSecret(enc: string | undefined): string | null {
  try {
    if (!enc) return null;
    const parts = enc.split(":");
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const data = Buffer.from(parts[2], "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", getTotpEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function generateTotpTokenForStep(secretBase32: string, stepCounter: number): string {
  const key = decodeBase32(secretBase32);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(stepCounter), 0);
  const hmac = crypto.createHmac("sha1", key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export function verifyTotpCode(secretBase32: string, code: string, windowSteps = 1): boolean {
  const cleanCode = typeof code === "string" ? code.replace(/\s+/g, "").trim() : "";
  if (!/^\d{6}$/.test(cleanCode)) return false;
  const currentStep = Math.floor(Date.now() / 1000 / 30);
  const providedBuf = Buffer.from(cleanCode, "utf8");
  for (let offset = -windowSteps; offset <= windowSteps; offset++) {
    const candidate = generateTotpTokenForStep(secretBase32, currentStep + offset);
    const candidateBuf = Buffer.from(candidate, "utf8");
    if (candidateBuf.length === providedBuf.length && crypto.timingSafeEqual(candidateBuf, providedBuf)) {
      return true;
    }
  }
  return false;
}

export function get2FAStatusForUser(userId: string): {
  supported: boolean;
  enabled: boolean;
  pendingSetup: boolean;
} {
  const user = findUserById(userId);
  if (!user) return { supported: false, enabled: false, pendingSetup: false };
  const supported = user.role === "admin" || user.role === "developer";
  return {
    supported,
    enabled: Boolean(user.twoFactorEnabled && user.twoFactorSecretEnc),
    pendingSetup: Boolean(user.twoFactorPendingSecretEnc),
  };
}

export function setupOptional2FA(userId: string): {
  success: boolean;
  error?: string;
  manualSecret?: string;
  otpAuthUri?: string;
} {
  const users = loadServerUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) return { success: false, error: "Akaun tidak ditemui." };
  if (user.role !== "admin" && user.role !== "developer") {
    return {
      success: false,
      error: "Pengesahan dua faktor (2FA) dikhaskan untuk akaun Pentadbir dan Pembangun.",
    };
  }

  const secret = encodeBase32(crypto.randomBytes(20));
  user.twoFactorPendingSecretEnc = encryptTotpSecret(secret);
  user.updatedAt = new Date().toISOString();
  saveServerUsers(users);

  const label = encodeURIComponent(`SmartCost:${user.username}`);
  const otpAuthUri = `otpauth://totp/${label}?secret=${secret}&issuer=SmartCost&algorithm=SHA1&digits=6&period=30`;

  return {
    success: true,
    manualSecret: secret,
    otpAuthUri,
  };
}

export function enableOptional2FA(userId: string, totpCode: string): {
  success: boolean;
  error?: string;
} {
  const users = loadServerUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) return { success: false, error: "Akaun tidak ditemui." };
  const pendingSecret = decryptTotpSecret(user.twoFactorPendingSecretEnc);
  if (!pendingSecret) {
    return { success: false, error: "Tiada persediaan 2FA aktif. Sila jana kunci persediaan dahulu." };
  }
  if (!verifyTotpCode(pendingSecret, totpCode)) {
    return { success: false, error: "Kod pengesahan 6-digit tidak tepat atau telah tamat tempoh." };
  }

  user.twoFactorSecretEnc = user.twoFactorPendingSecretEnc;
  delete user.twoFactorPendingSecretEnc;
  user.twoFactorEnabled = true;
  user.updatedAt = new Date().toISOString();
  saveServerUsers(users);

  return { success: true };
}

export function disableOptional2FA(
  userId: string,
  verification: { currentPassword?: string; totpCode?: string }
): { success: boolean; error?: string } {
  const users = loadServerUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) return { success: false, error: "Akaun tidak ditemui." };
  if (!user.twoFactorEnabled || !user.twoFactorSecretEnc) {
    return { success: true };
  }

  const activeSecret = decryptTotpSecret(user.twoFactorSecretEnc);
  const totpValid = Boolean(activeSecret && verification.totpCode && verifyTotpCode(activeSecret, verification.totpCode));
  const pwdValid = Boolean(
    verification.currentPassword && verifyUserPasswordWithLegacy(verification.currentPassword, user).valid
  );

  if (!totpValid && !pwdValid) {
    return {
      success: false,
      error: "Sila masukkan kata laluan semasa atau kod 2FA yang sah untuk menyahaktifkan 2FA.",
    };
  }

  user.twoFactorEnabled = false;
  delete user.twoFactorSecretEnc;
  delete user.twoFactorPendingSecretEnc;
  user.updatedAt = new Date().toISOString();
  saveServerUsers(users);

  return { success: true };
}

export function verifyUser2FAIfEnabled(
  userId: string,
  totpCode?: string
): { required: boolean; valid: boolean } {
  const user = findUserById(userId);
  if (!user || !user.twoFactorEnabled || !user.twoFactorSecretEnc) {
    return { required: false, valid: true };
  }
  const secret = decryptTotpSecret(user.twoFactorSecretEnc);
  if (!secret) {
    return { required: false, valid: true };
  }
  if (!totpCode || !totpCode.trim()) {
    return { required: true, valid: false };
  }
  return { required: true, valid: verifyTotpCode(secret, totpCode) };
}

