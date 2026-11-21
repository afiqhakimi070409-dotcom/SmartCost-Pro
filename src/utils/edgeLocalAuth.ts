/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cloudflare Standalone Edge Authentication Helper
 * - Activated ONLY when Cloudflare Workers/Pages runs without a separate Express origin (`edgeFallback: true`).
 * - Uses Web Crypto API PBKDF2-SHA256 (100,000 iterations + 16-byte random salt) for password hashing.
 * - Never embeds hardcoded/default passwords, never stores plaintext passwords, and never self-elevates to developer.
 */

import { ROLE_DEFINITIONS, UserRole } from "../types";
import type { Language } from "./i18n";

export interface EdgeAuthUserRecord {
  id: string;
  username: string;
  fullName: string;
  companyName: string;
  role: UserRole;
  email?: string;
  dbKey: string;
  passwordSalt: string;
  passwordHash: string;
  failedAttempts: number;
  lockedUntil: number;
  createdAt: string;
  updatedAt: string;
}

const EDGE_USERS_STORAGE_KEY = "smartcost_edge_auth_users_v1";
const PBKDF2_ITERATIONS = 100_000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function derivePbkdf2Hash(password: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derivedBits = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: hexToBytes(saltHex) as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(derivedBits));
}

async function hashEdgePassword(password: string): Promise<{ salt: string; hash: string }> {
  const saltBytes = new Uint8Array(16);
  window.crypto.getRandomValues(saltBytes);
  const salt = bytesToHex(saltBytes);
  const hash = await derivePbkdf2Hash(password, salt);
  return { salt, hash };
}

async function verifyEdgePassword(password: string, salt: string, expectedHash: string): Promise<boolean> {
  if (!password || !salt || !expectedHash) return false;
  try {
    const actual = await derivePbkdf2Hash(password, salt);
    return constantTimeHexEqual(actual, expectedHash);
  } catch {
    return false;
  }
}

function loadEdgeUsers(): EdgeAuthUserRecord[] {
  try {
    const raw = localStorage.getItem(EDGE_USERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveEdgeUsers(users: EdgeAuthUserRecord[]): void {
  try {
    localStorage.setItem(EDGE_USERS_STORAGE_KEY, JSON.stringify(users));
  } catch {}
}

function sanitizeDbSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "enterprise"
  );
}

function toPublicUser(u: EdgeAuthUserRecord) {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    companyName: u.companyName,
    role: u.role,
    email: u.email,
    dbKey: u.dbKey,
    createdAt: u.createdAt,
  };
}

export async function edgeBootstrapAdmin(params: {
  password: string;
  email?: string;
  lang?: Language;
}): Promise<{ success: boolean; status: number; user?: ReturnType<typeof toPublicUser>; error?: string }> {
  const isEn = params.lang !== "ms";
  const users = loadEdgeUsers();
  const hasAdmin = users.some((u) => u.role === "admin" || u.username.toLowerCase() === "admin");
  if (hasAdmin) {
    return {
      success: false,
      status: 409,
      error: isEn
        ? "Admin account has already been activated. Please sign in using your password."
        : "Akaun Admin telah pun diaktifkan. Sila log masuk menggunakan kata laluan anda.",
    };
  }
  if (!params.password || params.password.length < 10) {
    return {
      success: false,
      status: 400,
      error: isEn
        ? "Admin password must be at least 10 characters long."
        : "Kata laluan Admin mestilah sekurang-kurangnya 10 aksara.",
    };
  }

  const { salt, hash } = await hashEdgePassword(params.password);
  const now = new Date().toISOString();
  const adminRecord: EdgeAuthUserRecord = {
    id: `edge_admin_${Date.now().toString(36)}`,
    username: "admin",
    fullName: "System Administrator",
    companyName: "SCHOOL ENTERPRISE",
    role: "admin",
    email: params.email?.trim().toLowerCase() || undefined,
    dbKey: "pengekosan_company_db_school_enterprise",
    passwordSalt: salt,
    passwordHash: hash,
    failedAttempts: 0,
    lockedUntil: 0,
    createdAt: now,
    updatedAt: now,
  };

  users.push(adminRecord);
  saveEdgeUsers(users);
  return { success: true, status: 201, user: toPublicUser(adminRecord) };
}

export async function edgeRegisterManual(params: {
  username: string;
  fullName: string;
  companyName: string;
  password: string;
  email?: string;
  lang?: Language;
}): Promise<{ success: boolean; status: number; user?: ReturnType<typeof toPublicUser>; error?: string }> {
  const isEn = params.lang !== "ms";
  const cleanUser = params.username.trim();
  const cleanLower = cleanUser.toLowerCase();
  const cleanEmail = params.email?.trim().toLowerCase() || undefined;

  if (!cleanUser || !/^[a-zA-Z0-9._-]{3,64}$/.test(cleanUser)) {
    return {
      success: false,
      status: 400,
      error: isEn
        ? "Username must be 3–64 characters and contain only letters, numbers, dots (.), underscores (_), or hyphens (-)."
        : "Nama pengguna mestilah 3–64 aksara dan hanya huruf, nombor, titik (.), garis bawah (_), atau sempang (-).",
    };
  }
  if (cleanLower === "admin" || cleanLower === "afiqhakimi070409" || cleanLower === "developer") {
    return {
      success: false,
      status: 400,
      error: isEn ? "This username is reserved by the system." : "Nama pengguna ini terpelihara oleh sistem.",
    };
  }
  if (!params.password || params.password.length < 10) {
    return {
      success: false,
      status: 400,
      error: isEn
        ? "Password must be at least 10 characters long for security."
        : "Kata laluan mestilah sekurang-kurangnya 10 aksara demi keselamatan.",
    };
  }

  const users = loadEdgeUsers();
  if (users.some((u) => u.username.toLowerCase() === cleanLower)) {
    return {
      success: false,
      status: 409,
      error: isEn
        ? "Username is already registered. Please choose another username."
        : "Nama pengguna sudah didaftarkan. Sila pilih nama pengguna lain.",
    };
  }

  const { salt, hash } = await hashEdgePassword(params.password);
  const uid = `edge_usr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const company = params.companyName.trim() || `${params.fullName.trim().toUpperCase()} ENTERPRISE`;
  const dbKey = `pengekosan_company_db_${sanitizeDbSlug(company)}_${uid.slice(-6)}`;
  const now = new Date().toISOString();

  const record: EdgeAuthUserRecord = {
    id: uid,
    username: cleanUser,
    fullName: params.fullName.trim() || cleanUser,
    companyName: company,
    role: "staf",
    email: cleanEmail,
    dbKey,
    passwordSalt: salt,
    passwordHash: hash,
    failedAttempts: 0,
    lockedUntil: 0,
    createdAt: now,
    updatedAt: now,
  };

  users.push(record);
  saveEdgeUsers(users);
  return { success: true, status: 201, user: toPublicUser(record) };
}

export async function edgeLoginManual(params: {
  username?: string;
  email?: string;
  password: string;
  requestedRole?: string;
  lang?: Language;
}): Promise<{
  success: boolean;
  status: number;
  code?: string;
  user?: ReturnType<typeof toPublicUser>;
  error?: string;
}> {
  const isEn = params.lang !== "ms";
  const cleanUser = (params.username || "").trim().toLowerCase();
  const cleanEmail = (params.email || "").trim().toLowerCase();
  const reqRole = (params.requestedRole || "").trim().toLowerCase();

  const users = loadEdgeUsers();

  // First-time Admin setup when no Admin exists yet on standalone Cloudflare deployment
  const hasAdmin = users.some((u) => u.role === "admin");
  if (!hasAdmin && (cleanUser === "admin" || reqRole === "admin")) {
    return {
      success: false,
      status: 409,
      code: "ADMIN_SETUP_REQUIRED",
      error: isEn
        ? "Primary Administrator account (admin) has not been activated yet. Please set a new Admin password below."
        : "Akaun Pentadbir Utama (admin) belum diaktifkan lagi. Sila tetapkan kata laluan Admin baharu di bawah.",
    };
  }

  const idx = users.findIndex((u) => {
    if (cleanUser && u.username.toLowerCase() === cleanUser) return true;
    if (cleanEmail && u.email && u.email.toLowerCase() === cleanEmail) return true;
    return false;
  });

  if (idx === -1) {
    return {
      success: false,
      status: 401,
      code: "INVALID_CREDENTIALS",
      error: isEn ? "Incorrect username or password." : "Nama pengguna atau kata laluan tidak betul.",
    };
  }

  const record = users[idx];
  const nowMs = Date.now();
  if (record.lockedUntil && record.lockedUntil > nowMs) {
    return {
      success: false,
      status: 429,
      code: "LOCKED",
      error: isEn
        ? "Too many login attempts. Please try again shortly."
        : "Terlalu banyak percubaan log masuk. Sila cuba lagi sebentar.",
    };
  }

  const valid = await verifyEdgePassword(params.password, record.passwordSalt, record.passwordHash);
  if (!valid) {
    record.failedAttempts = (record.failedAttempts || 0) + 1;
    if (record.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      record.lockedUntil = nowMs + LOCKOUT_DURATION_MS;
    }
    users[idx] = record;
    saveEdgeUsers(users);
    return {
      success: false,
      status: record.lockedUntil > nowMs ? 429 : 401,
      code: record.lockedUntil > nowMs ? "LOCKED" : "INVALID_CREDENTIALS",
      error:
        record.lockedUntil > nowMs
          ? (isEn
              ? "Too many login attempts. Please try again shortly."
              : "Terlalu banyak percubaan log masuk. Sila cuba lagi sebentar.")
          : (isEn ? "Incorrect username or password." : "Nama pengguna atau kata laluan tidak betul."),
    };
  }

  if (record.role === "developer") {
    return {
      success: false,
      status: 403,
      code: "DEVELOPER_USE_ALT_D",
      error: isEn
        ? "Developer accounts can only be accessed via Developer Authentication mode (Alt+D)."
        : "Akaun pembangun hanya boleh diakses melalui mod pengesahan pembangun (Alt+D).",
    };
  }

  const validRoles = Object.keys(ROLE_DEFINITIONS);
  if (reqRole && validRoles.includes(reqRole) && record.role !== reqRole) {
    return {
      success: false,
      status: 403,
      code: "ROLE_MISMATCH",
      error: isEn
        ? `Your account role is "${record.role}". Please select the matching role to sign in.`
        : `Peranan akaun anda ialah "${record.role}". Sila pilih peranan yang sepadan untuk log masuk.`,
    };
  }

  record.failedAttempts = 0;
  record.lockedUntil = 0;
  users[idx] = record;
  saveEdgeUsers(users);

  return { success: true, status: 200, user: toPublicUser(record) };
}

export async function edgeChangePassword(params: {
  userId?: string;
  username?: string;
  currentPassword: string;
  newPassword?: string;
  newUsername?: string;
  lang?: Language;
}): Promise<{
  success: boolean;
  status: number;
  code?: string;
  user?: ReturnType<typeof toPublicUser>;
  error?: string;
}> {
  const isEn = params.lang !== "ms";
  const users = loadEdgeUsers();
  const idx = users.findIndex(
    (u) =>
      (params.userId && u.id === params.userId) ||
      (params.username && u.username.toLowerCase() === params.username.trim().toLowerCase())
  );

  if (idx === -1) {
    return {
      success: false,
      status: 404,
      code: "NO_MANUAL_PASSWORD_SET",
      error: isEn ? "Credential record not found." : "Rekod kelayakan tidak ditemui.",
    };
  }

  const record = users[idx];
  const valid = await verifyEdgePassword(params.currentPassword, record.passwordSalt, record.passwordHash);
  if (!valid) {
    return {
      success: false,
      status: 401,
      code: "INVALID_CURRENT_PASSWORD",
      error: isEn ? "Current password is incorrect." : "Kata laluan semasa tidak betul.",
    };
  }

  const cleanNewUser = params.newUsername?.trim();
  const cleanNewPass = params.newPassword || "";

  if (!cleanNewPass && (!cleanNewUser || cleanNewUser.toLowerCase() === record.username.toLowerCase())) {
    return {
      success: false,
      status: 400,
      code: "NO_CHANGES",
      error: isEn ? "No changes to save." : "Tiada perubahan untuk disimpan.",
    };
  }

  if (cleanNewUser && cleanNewUser.toLowerCase() !== record.username.toLowerCase()) {
    if (!/^[a-zA-Z0-9._-]{3,64}$/.test(cleanNewUser)) {
      return {
        success: false,
        status: 400,
        code: "INVALID_USERNAME",
        error: isEn ? "Invalid username format." : "Format nama pengguna tidak sah.",
      };
    }
    if (users.some((u, i) => i !== idx && u.username.toLowerCase() === cleanNewUser.toLowerCase())) {
      return {
        success: false,
        status: 409,
        code: "USERNAME_TAKEN",
        error: isEn ? "Username is already taken." : "Nama pengguna sudah digunakan.",
      };
    }
    record.username = cleanNewUser;
  }

  if (cleanNewPass) {
    if (cleanNewPass.length < 8 || cleanNewPass === params.currentPassword) {
      return {
        success: false,
        status: 400,
        code: "INVALID_NEW_PASSWORD",
        error: isEn
          ? "New password must be at least 8 characters and different from the current password."
          : "Kata laluan baharu mesti sekurang-kurangnya 8 aksara dan berbeza daripada yang semasa.",
      };
    }
    const { salt, hash } = await hashEdgePassword(cleanNewPass);
    record.passwordSalt = salt;
    record.passwordHash = hash;
  }

  record.updatedAt = new Date().toISOString();
  users[idx] = record;
  saveEdgeUsers(users);
  return { success: true, status: 200, user: toPublicUser(record) };
}

export async function edgeLinkManual(params: {
  userId?: string;
  username: string;
  password: string;
  fullName?: string;
  companyName?: string;
  email?: string;
  role?: UserRole;
  dbKey?: string;
  lang?: Language;
}): Promise<{
  success: boolean;
  status: number;
  code?: string;
  user?: ReturnType<typeof toPublicUser>;
  error?: string;
}> {
  const isEn = params.lang !== "ms";
  const cleanUser = params.username.trim();
  const cleanLower = cleanUser.toLowerCase();
  if (!cleanUser || !/^[a-zA-Z0-9._-]{3,64}$/.test(cleanUser)) {
    return {
      success: false,
      status: 400,
      code: "INVALID_USERNAME",
      error: isEn ? "Invalid username format." : "Format nama pengguna tidak sah.",
    };
  }
  if (cleanLower === "admin" || cleanLower === "afiqhakimi070409" || cleanLower === "developer") {
    return {
      success: false,
      status: 400,
      code: "USERNAME_RESERVED",
      error: isEn ? "This username is reserved by the system." : "Nama pengguna ini terpelihara oleh sistem.",
    };
  }
  if (!params.password || params.password.length < 8) {
    return {
      success: false,
      status: 400,
      code: "INVALID_NEW_PASSWORD",
      error: isEn
        ? "New password must be at least 8 characters."
        : "Kata laluan baharu mesti sekurang-kurangnya 8 aksara.",
    };
  }

  const users = loadEdgeUsers();
  if (users.some((u) => u.id !== params.userId && u.username.toLowerCase() === cleanLower)) {
    return {
      success: false,
      status: 409,
      code: "USERNAME_TAKEN",
      error: isEn ? "Username is already taken." : "Nama pengguna sudah digunakan.",
    };
  }

  const { salt, hash } = await hashEdgePassword(params.password);
  const now = new Date().toISOString();
  const uid = params.userId || `edge_usr_${Date.now().toString(36)}`;
  const existingIdx = users.findIndex((u) => u.id === uid);
  const safeRole: UserRole = params.role && params.role !== "developer" ? params.role : "staf";
  const record: EdgeAuthUserRecord = {
    id: uid,
    username: cleanUser,
    fullName: params.fullName || cleanUser,
    companyName: params.companyName || "SCHOOL ENTERPRISE",
    role: safeRole,
    email: params.email?.trim().toLowerCase() || undefined,
    dbKey: params.dbKey || `pengekosan_userdb_${uid}`,
    passwordSalt: salt,
    passwordHash: hash,
    failedAttempts: 0,
    lockedUntil: 0,
    createdAt: existingIdx >= 0 ? users[existingIdx].createdAt : now,
    updatedAt: now,
  };

  if (existingIdx >= 0) {
    users[existingIdx] = record;
  } else {
    users.push(record);
  }
  saveEdgeUsers(users);
  return { success: true, status: 200, user: toPublicUser(record) };
}

