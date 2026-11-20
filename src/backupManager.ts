/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SmartCost Automatic Backup, Integrity Verification & Safe Recovery Engine
 * - Stores backups in a separate directory: data/backups/ (isolated from active data/*.json)
 * - Enforces SHA-256 checksum integrity verification on creation and before restore
 * - Automatically creates a Pre-Restore Safety Snapshot before any recovery execution
 * - Never deletes or overwrites user credential records (server_users.json) during restore
 * - Strips all sensitive fields (passwordHash, salt, tokens, API keys) from any client output
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { infraManager } from "./infraManager.ts";
import { logSecurityAudit } from "./serverAuth.ts";
import { quotaTracker } from "./quotaTracker.ts";
import { BACKUP_DIR, DATA_DIR } from "./serverPaths.ts";

const MANIFEST_FILE = path.join(BACKUP_DIR, "manifest.json");
const RECOVERY_LOGS_FILE = path.join(BACKUP_DIR, "recovery_logs.json");

const ACTIVE_DATABASES_FILE = path.join(DATA_DIR, "server_databases.json");
const ACTIVE_HISTORY_FILE = path.join(DATA_DIR, "mrcost_history.json");
const ACTIVE_DELETED_FILE = path.join(DATA_DIR, "deleted_databases.json");
const ACTIVE_INFRA_CONFIG_FILE = path.join(DATA_DIR, "infra_config.json");
const ACTIVE_USERS_FILE = path.join(DATA_DIR, "server_users.json");
const ACTIVE_AUDIT_FILE = path.join(DATA_DIR, "security_audit.json");
const ACTIVE_SESSIONS_FILE = path.join(DATA_DIR, "server_sessions.json");

export type BackupTriggerType = "MANUAL" | "SCHEDULED" | "PRE_RESTORE";
export type BackupVerificationStatus = "VERIFIED" | "CORRUPTED" | "MISSING" | "PENDING";
export type SafeRestoreMode = "merge_safe" | "replace_registry";

export interface SystemBackupManifestItem {
  id: string;
  fileName: string;
  createdAt: string;
  trigger: BackupTriggerType;
  createdBy: string;
  note: string;
  sizeBytes: number;
  sha256: string;
  verificationStatus: BackupVerificationStatus;
  lastVerifiedAt: string | null;
  summary: {
    databaseCount: number;
    chatThreadsCount: number;
    usersCount: number;
    includesFirestoreMetadata: boolean;
  };
}

export interface RecoveryAuditLogEntry {
  id: string;
  timestamp: string;
  backupId: string;
  backupFileName: string;
  preRestoreBackupId: string;
  mode: SafeRestoreMode;
  executedBy: string;
  status: "SUCCESS" | "ABORTED" | "FAILED";
  details: string;
}

interface SnapshotPayload {
  schemaVersion: string;
  app: "SMARTCOST";
  backupId: string;
  createdAt: string;
  trigger: BackupTriggerType;
  createdBy: string;
  note: string;
  storageLayer: "SEPARATE_BACKUP_PARTITION";
  firestoreMetadata: {
    projectId: string;
    databaseId: string;
    collections: string[];
    activeCompanyIds: string[];
  };
  data: {
    serverDatabases: any[];
    mrcostHistory: Record<string, any[]>;
    deletedDatabases: any[];
    infraConfig: Record<string, any> | null;
    usersSummary: Array<{
      id: string;
      username: string;
      role: string;
      companyName: string;
      dbKey: string;
      authMethod: string;
      createdAt: string;
    }>;
  };
}

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      quotaTracker.recordServerStoreIo(1, 0);
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    }
  } catch {
    // ignore corrupted read
  }
  return fallback;
}

function writeAtomicJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
  quotaTracker.recordServerStoreIo(0, 1);
}

function sha256String(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

class SmartCostBackupManager {
  private schedulerTimer: NodeJS.Timeout | null = null;
  private lastScheduledRunAt: string | null = null;

  constructor() {
    this.ensureBackupDir();
  }

  private ensureBackupDir(): void {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  private loadManifest(): SystemBackupManifestItem[] {
    this.ensureBackupDir();
    const list = readJsonSafe<SystemBackupManifestItem[]>(MANIFEST_FILE, []);
    return Array.isArray(list) ? list : [];
  }

  private saveManifest(items: SystemBackupManifestItem[]): void {
    this.ensureBackupDir();
    writeAtomicJson(MANIFEST_FILE, items);
  }

  public getRecoveryLogs(): RecoveryAuditLogEntry[] {
    this.ensureBackupDir();
    const list = readJsonSafe<RecoveryAuditLogEntry[]>(RECOVERY_LOGS_FILE, []);
    return Array.isArray(list) ? list.slice(0, 100) : [];
  }

  private appendRecoveryLog(entry: Omit<RecoveryAuditLogEntry, "id" | "timestamp">): RecoveryAuditLogEntry {
    const logs = this.getRecoveryLogs();
    const rec: RecoveryAuditLogEntry = {
      id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    logs.unshift(rec);
    writeAtomicJson(RECOVERY_LOGS_FILE, logs.slice(0, 100));
    return rec;
  }

  public startScheduler(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }

    const policy = infraManager.getConfig().backupPolicy;
    if (!policy.autoBackupEnabled) return;

    const intervalHours = Math.max(1, Math.min(168, policy.scheduleIntervalHours || 12));
    // Check every 15 minutes whether an automatic scheduled backup is due
    const checkMs = 15 * 60 * 1000;
    this.schedulerTimer = setInterval(() => {
      const latestPolicy = infraManager.getConfig().backupPolicy;
      if (!latestPolicy.autoBackupEnabled) return;
      const manifest = this.loadManifest().filter((b) => b.trigger === "SCHEDULED");
      const lastTs = manifest[0]?.createdAt ? Date.parse(manifest[0].createdAt) : 0;
      const dueMs = Math.max(1, latestPolicy.scheduleIntervalHours || 12) * 3600 * 1000;
      if (!lastTs || Date.now() - lastTs >= dueMs) {
        this.createSystemBackup({
          trigger: "SCHEDULED",
          actorUsername: "system-scheduler",
          note: `Scheduled automatic snapshot (${latestPolicy.scheduleIntervalHours}h cadence)`,
        });
      }
    }, checkMs);
    this.schedulerTimer.unref?.();

    // Ensure at least one initial baseline verified backup exists if backup directory is empty
    const currentManifest = this.loadManifest();
    if (currentManifest.length === 0) {
      this.createSystemBackup({
        trigger: "SCHEDULED",
        actorUsername: "system-bootstrap",
        note: "Initial baseline snapshot upon multi-server backup initialization",
      });
    }
  }

  public stopScheduler(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  public createSystemBackup(options: {
    trigger: BackupTriggerType;
    actorUsername: string;
    note?: string;
  }): { ok: boolean; backup?: SystemBackupManifestItem; error?: string } {
    try {
      this.ensureBackupDir();
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const id = `bkp_${stamp}_${crypto.randomBytes(3).toString("hex")}`;
      const fileName = `smartcost_${options.trigger.toLowerCase()}_${stamp}_${id.slice(-6)}.json`;
      const filePath = path.join(BACKUP_DIR, fileName);

      const serverDatabases = readJsonSafe<any[]>(ACTIVE_DATABASES_FILE, []);
      const mrcostHistory = readJsonSafe<Record<string, any[]>>(ACTIVE_HISTORY_FILE, {});
      const deletedDatabases = readJsonSafe<any[]>(ACTIVE_DELETED_FILE, []);
      const infraConfig = readJsonSafe<Record<string, any> | null>(ACTIVE_INFRA_CONFIG_FILE, null);
      const rawUsers = readJsonSafe<any[]>(ACTIVE_USERS_FILE, []);

      // Strictly strip passwordHash and salt — NEVER store raw user hashes in downloadable backup payloads
      const usersSummary = Array.isArray(rawUsers)
        ? rawUsers.map((u) => ({
            id: String(u.id || ""),
            username: String(u.username || ""),
            role: String(u.role || "staf"),
            companyName: String(u.companyName || ""),
            dbKey: String(u.dbKey || ""),
            authMethod: String(u.authMethod || "manual"),
            createdAt: String(u.createdAt || ""),
          }))
        : [];

      const payload: SnapshotPayload = {
        schemaVersion: "2026.2",
        app: "SMARTCOST",
        backupId: id,
        createdAt: now.toISOString(),
        trigger: options.trigger,
        createdBy: options.actorUsername || "developer",
        note: (options.note || "").trim().slice(0, 200) || `${options.trigger} snapshot`,
        storageLayer: "SEPARATE_BACKUP_PARTITION",
        firestoreMetadata: {
          projectId: "reflecting-booth-740ks",
          databaseId: "ai-studio-remixsmartcostpr-940297e1-af61-42e5-8469-9bca8d60c481",
          collections: ["users", "companies"],
          activeCompanyIds: Array.isArray(serverDatabases)
            ? serverDatabases.map((d) => String(d.databaseId || "")).filter(Boolean)
            : [],
        },
        data: {
          serverDatabases: Array.isArray(serverDatabases) ? serverDatabases : [],
          mrcostHistory: mrcostHistory && typeof mrcostHistory === "object" ? mrcostHistory : {},
          deletedDatabases: Array.isArray(deletedDatabases) ? deletedDatabases : [],
          infraConfig,
          usersSummary,
        },
      };

      const serialized = JSON.stringify(payload, null, 2);
      const checksum = sha256String(serialized);
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, serialized, "utf-8");
      fs.renameSync(tmp, filePath);

      const stat = fs.statSync(filePath);
      const policy = infraManager.getConfig().backupPolicy;
      let verificationStatus: BackupVerificationStatus = "PENDING";
      let lastVerifiedAt: string | null = null;

      if (policy.verifyAfterBackup) {
        const readBack = fs.readFileSync(filePath, "utf-8");
        const verifyHash = sha256String(readBack);
        verificationStatus = verifyHash === checksum ? "VERIFIED" : "CORRUPTED";
        lastVerifiedAt = new Date().toISOString();
      }

      const item: SystemBackupManifestItem = {
        id,
        fileName,
        createdAt: now.toISOString(),
        trigger: options.trigger,
        createdBy: options.actorUsername || "developer",
        note: payload.note,
        sizeBytes: stat.size,
        sha256: checksum,
        verificationStatus,
        lastVerifiedAt,
        summary: {
          databaseCount: payload.data.serverDatabases.length,
          chatThreadsCount: Object.keys(payload.data.mrcostHistory).length,
          usersCount: usersSummary.length,
          includesFirestoreMetadata: true,
        },
      };

      const manifest = this.loadManifest();
      manifest.unshift(item);

      // Retention pruning for automated SCHEDULED backups only (preserve MANUAL & PRE_RESTORE up to generous ceiling)
      const retention = Math.max(3, policy.retentionCount || 14);
      const scheduled = manifest.filter((m) => m.trigger === "SCHEDULED");
      if (scheduled.length > retention) {
        const toRemoveIds = new Set(scheduled.slice(retention).map((m) => m.id));
        for (const rem of scheduled.slice(retention)) {
          try {
            const p = path.join(BACKUP_DIR, path.basename(rem.fileName));
            if (fs.existsSync(p)) fs.unlinkSync(p);
          } catch {}
        }
        this.saveManifest(manifest.filter((m) => !toRemoveIds.has(m.id)));
      } else {
        this.saveManifest(manifest);
      }

      if (options.trigger === "SCHEDULED") {
        this.lastScheduledRunAt = now.toISOString();
      }

      infraManager.addLog({
        level: "BACKUP",
        source: "BackupManager",
        message: `Backup ${id} created (${options.trigger}, ${(stat.size / 1024).toFixed(1)} KB, sha256=${checksum.slice(0, 12)}..., status=${verificationStatus}).`,
      });

      return { ok: true, backup: item };
    } catch (err: any) {
      infraManager.addLog({
        level: "ERROR",
        source: "BackupManager",
        message: `Backup creation failed: ${err?.message || "unknown error"}`,
      });
      return { ok: false, error: "Gagal menjana fail sandaran ke storan berasingan." };
    }
  }

  public listBackups(): {
    backups: SystemBackupManifestItem[];
    storagePath: string;
    totalBytes: number;
    lastScheduledRunAt: string | null;
    recoveryLogs: RecoveryAuditLogEntry[];
  } {
    const items = this.loadManifest().map((item) => {
      const target = path.join(BACKUP_DIR, path.basename(item.fileName));
      if (!fs.existsSync(target)) {
        return { ...item, verificationStatus: "MISSING" as BackupVerificationStatus };
      }
      return item;
    });
    const totalBytes = items.reduce((acc, i) => acc + (i.sizeBytes || 0), 0);
    return {
      backups: items,
      storagePath: "data/backups/",
      totalBytes,
      lastScheduledRunAt: this.lastScheduledRunAt || items.find((i) => i.trigger === "SCHEDULED")?.createdAt || null,
      recoveryLogs: this.getRecoveryLogs(),
    };
  }

  public verifyBackupIntegrity(backupId: string): {
    ok: boolean;
    status: BackupVerificationStatus;
    backup?: SystemBackupManifestItem;
    computedSha256?: string;
    error?: string;
  } {
    const manifest = this.loadManifest();
    const idx = manifest.findIndex((b) => b.id === backupId);
    if (idx < 0) {
      return { ok: false, status: "MISSING", error: "Rekod sandaran tidak ditemui." };
    }

    const item = manifest[idx];
    const target = path.join(BACKUP_DIR, path.basename(item.fileName));
    if (!fs.existsSync(target)) {
      manifest[idx] = {
        ...item,
        verificationStatus: "MISSING",
        lastVerifiedAt: new Date().toISOString(),
      };
      this.saveManifest(manifest);
      return { ok: false, status: "MISSING", backup: manifest[idx], error: "Fail sandaran fizikal tiada dalam storan berasingan." };
    }

    try {
      const raw = fs.readFileSync(target, "utf-8");
      const computed = sha256String(raw);
      const parsed = JSON.parse(raw) as SnapshotPayload;
      const validStructure =
        parsed &&
        parsed.app === "SMARTCOST" &&
        parsed.backupId === item.id &&
        parsed.data &&
        Array.isArray(parsed.data.serverDatabases);

      const isMatch = computed === item.sha256 && validStructure;
      const status: BackupVerificationStatus = isMatch ? "VERIFIED" : "CORRUPTED";
      manifest[idx] = {
        ...item,
        verificationStatus: status,
        lastVerifiedAt: new Date().toISOString(),
      };
      this.saveManifest(manifest);

      infraManager.addLog({
        level: isMatch ? "BACKUP" : "ERROR",
        source: "BackupVerifier",
        message: `Integrity check for ${item.id}: ${status} (hash=${computed.slice(0, 12)}...).`,
      });

      return {
        ok: isMatch,
        status,
        backup: manifest[idx],
        computedSha256: computed,
        ...(!isMatch ? { error: "Checksum SHA-256 atau struktur fail sandaran tidak sepadan!" } : {}),
      };
    } catch {
      manifest[idx] = {
        ...item,
        verificationStatus: "CORRUPTED",
        lastVerifiedAt: new Date().toISOString(),
      };
      this.saveManifest(manifest);
      return { ok: false, status: "CORRUPTED", backup: manifest[idx], error: "Fail sandaran JSON rosak." };
    }
  }

  public getSanitizedBackupPayload(backupId: string): { ok: boolean; fileName?: string; payload?: SnapshotPayload; error?: string } {
    const verification = this.verifyBackupIntegrity(backupId);
    if (!verification.ok || !verification.backup) {
      return { ok: false, error: verification.error || "Sandaran gagal pengesahan integriti." };
    }
    const target = path.join(BACKUP_DIR, path.basename(verification.backup.fileName));
    const parsed = readJsonSafe<SnapshotPayload | null>(target, null);
    if (!parsed) {
      return { ok: false, error: "Gagal membaca kandungan sandaran." };
    }
    return {
      ok: true,
      fileName: verification.backup.fileName,
      payload: parsed,
    };
  }

  public previewSafeRestore(backupId: string): {
    ok: boolean;
    verificationStatus?: BackupVerificationStatus;
    backup?: SystemBackupManifestItem;
    preview?: {
      currentDbCount: number;
      backupDbCount: number;
      missingDbsToRestore: number;
      existingDbsPreserved: number;
      currentChatThreads: number;
      backupChatThreads: number;
      usersProtectedCount: number;
    };
    error?: string;
  } {
    const check = this.verifyBackupIntegrity(backupId);
    if (!check.ok || !check.backup) {
      return {
        ok: false,
        verificationStatus: check.status,
        backup: check.backup,
        error: check.error || "Gagal mengesahkan integriti sandaran sebelum pratonton pemulihan.",
      };
    }

    const target = path.join(BACKUP_DIR, path.basename(check.backup.fileName));
    const snap = readJsonSafe<SnapshotPayload | null>(target, null);
    if (!snap) {
      return { ok: false, verificationStatus: "CORRUPTED", error: "Gagal membaca fail sandaran." };
    }

    const currentDbs = readJsonSafe<any[]>(ACTIVE_DATABASES_FILE, []);
    const currentHistory = readJsonSafe<Record<string, any[]>>(ACTIVE_HISTORY_FILE, {});
    const currentUsers = readJsonSafe<any[]>(ACTIVE_USERS_FILE, []);

    const currentDbIds = new Set(currentDbs.map((d) => String(d.databaseId || "")));
    const backupDbs = Array.isArray(snap.data.serverDatabases) ? snap.data.serverDatabases : [];
    const missingCount = backupDbs.filter((d) => !currentDbIds.has(String(d.databaseId || ""))).length;

    return {
      ok: true,
      verificationStatus: check.status,
      backup: check.backup,
      preview: {
        currentDbCount: currentDbs.length,
        backupDbCount: backupDbs.length,
        missingDbsToRestore: missingCount,
        existingDbsPreserved: currentDbs.length,
        currentChatThreads: Object.keys(currentHistory).length,
        backupChatThreads: Object.keys(snap.data.mrcostHistory || {}).length,
        usersProtectedCount: Array.isArray(currentUsers) ? currentUsers.length : 0,
      },
    };
  }

  public executeSafeRestore(options: {
    backupId: string;
    actorUid: string;
    actorUsername: string;
    confirmPhrase: string;
    mode: SafeRestoreMode;
  }): {
    ok: boolean;
    preRestoreBackupId?: string;
    restoredDatabasesCount?: number;
    restoredChatThreadsCount?: number;
    error?: string;
  } {
    if ((options.confirmPhrase || "").trim().toUpperCase() !== "PULIHKAN") {
      return {
        ok: false,
        error: "Pengesahan bertulis tidak sepadan. Sila taip 'PULIHKAN' untuk melaksanakan pemulihan selamat.",
      };
    }

    // 1. Mandatory SHA-256 verification before touching active state
    const check = this.verifyBackupIntegrity(options.backupId);
    if (!check.ok || !check.backup) {
      this.appendRecoveryLog({
        backupId: options.backupId,
        backupFileName: check.backup?.fileName || "unknown",
        preRestoreBackupId: "none",
        mode: options.mode,
        executedBy: options.actorUsername,
        status: "ABORTED",
        details: `Restore aborted: integrity check failed (${check.status}).`,
      });
      return {
        ok: false,
        error: check.error || "Pemulihan dibatalkan: fail sandaran gagal pengesahan SHA-256.",
      };
    }

    const target = path.join(BACKUP_DIR, path.basename(check.backup.fileName));
    const snap = readJsonSafe<SnapshotPayload | null>(target, null);
    if (!snap || !snap.data) {
      return { ok: false, error: "Struktur sandaran tidak sah." };
    }

    // 2. Mandatory Pre-Restore Safety Snapshot of current live state before any change
    const preRestore = this.createSystemBackup({
      trigger: "PRE_RESTORE",
      actorUsername: options.actorUsername,
      note: `Pre-restore safety snapshot before restoring ${check.backup.id}`,
    });

    if (!preRestore.ok || !preRestore.backup) {
      return {
        ok: false,
        error: "Pemulihan dibatalkan: gagal mencipta sandaran keselamatan pra-pemulihan.",
      };
    }

    try {
      const currentDbs = readJsonSafe<any[]>(ACTIVE_DATABASES_FILE, []);
      const backupDbs = Array.isArray(snap.data.serverDatabases) ? snap.data.serverDatabases : [];
      let nextDbs: any[];
      let restoredDbCount = 0;

      if (options.mode === "merge_safe") {
        const merged = new Map<string, any>();
        for (const db of backupDbs) {
          if (db?.databaseId) {
            merged.set(String(db.databaseId), db);
          }
        }
        // Preserve existing live records without overwriting active modifications
        for (const db of currentDbs) {
          if (db?.databaseId) {
            if (!merged.has(String(db.databaseId))) {
              merged.set(String(db.databaseId), db);
            } else {
              merged.set(String(db.databaseId), db);
            }
          }
        }
        nextDbs = Array.from(merged.values());
        const existingSet = new Set(currentDbs.map((d) => String(d.databaseId || "")));
        restoredDbCount = backupDbs.filter((d) => !existingSet.has(String(d.databaseId || ""))).length;
      } else {
        // replace_registry: preserve protected system infrastructure databases even in replace mode
        const protectedLive = currentDbs.filter((d) => d?.isProtected);
        const map = new Map<string, any>();
        for (const db of backupDbs) {
          if (db?.databaseId) map.set(String(db.databaseId), db);
        }
        for (const db of protectedLive) {
          if (db?.databaseId && !map.has(String(db.databaseId))) {
            map.set(String(db.databaseId), db);
          }
        }
        nextDbs = Array.from(map.values());
        restoredDbCount = nextDbs.length;
      }

      // Restore Mr Cost isolated history safely (merge non-destructively)
      const currentHistory = readJsonSafe<Record<string, any[]>>(ACTIVE_HISTORY_FILE, {});
      const backupHistory = snap.data.mrcostHistory && typeof snap.data.mrcostHistory === "object"
        ? snap.data.mrcostHistory
        : {};
      const nextHistory: Record<string, any[]> = { ...backupHistory };
      for (const [k, v] of Object.entries(currentHistory)) {
        if (!nextHistory[k] || (Array.isArray(v) && v.length >= (nextHistory[k]?.length || 0))) {
          nextHistory[k] = v;
        }
      }

      writeAtomicJson(ACTIVE_DATABASES_FILE, nextDbs);
      writeAtomicJson(ACTIVE_HISTORY_FILE, nextHistory);
      // NEVER touch ACTIVE_USERS_FILE (.session_secret or server_users.json) so zero users get locked out!

      const restoredThreads = Object.keys(backupHistory).length;
      const detailMsg = `Safe restore (${options.mode}) from ${check.backup.id}: restored ${restoredDbCount} DB entries, merged ${restoredThreads} chat partitions. Pre-restore snapshot: ${preRestore.backup.id}. Users & auth preserved.`;

      this.appendRecoveryLog({
        backupId: check.backup.id,
        backupFileName: check.backup.fileName,
        preRestoreBackupId: preRestore.backup.id,
        mode: options.mode,
        executedBy: options.actorUsername,
        status: "SUCCESS",
        details: detailMsg,
      });

      infraManager.addLog({
        level: "BACKUP",
        source: "RecoveryManager",
        message: detailMsg,
      });

      logSecurityAudit({
        jenisKejadian: "AKSES_PEMBANGUN_BERJAYA",
        uid: options.actorUid,
        role: "developer",
        status: "BERJAYA",
        butiran: `safe_restore=${check.backup.id} pre=${preRestore.backup.id} mode=${options.mode}`,
      });

      return {
        ok: true,
        preRestoreBackupId: preRestore.backup.id,
        restoredDatabasesCount: restoredDbCount,
        restoredChatThreadsCount: restoredThreads,
      };
    } catch (err: any) {
      this.appendRecoveryLog({
        backupId: check.backup.id,
        backupFileName: check.backup.fileName,
        preRestoreBackupId: preRestore.backup.id,
        mode: options.mode,
        executedBy: options.actorUsername,
        status: "FAILED",
        details: `Safe restore failed: ${err?.message || "unknown error"}`,
      });
      return { ok: false, error: "Ralat semasa menulis semula rekod pemulihan selamat." };
    }
  }

  public getDatabaseMonitoringStats() {
    const dbCheckStart = performance.now();
    const databases = readJsonSafe<any[]>(ACTIVE_DATABASES_FILE, []);
    const users = readJsonSafe<any[]>(ACTIVE_USERS_FILE, []);
    const sessions = readJsonSafe<any[]>(ACTIVE_SESSIONS_FILE, []);
    const audits = readJsonSafe<any[]>(ACTIVE_AUDIT_FILE, []);
    const history = readJsonSafe<Record<string, any[]>>(ACTIVE_HISTORY_FILE, {});
    const readLatencyMs = Number((performance.now() - dbCheckStart).toFixed(2));

    const trackedFiles = [
      { key: "server_databases.json", label: "Company Databases Registry", path: ACTIVE_DATABASES_FILE, records: databases.length },
      { key: "server_users.json", label: "Authenticated Users (Hashed)", path: ACTIVE_USERS_FILE, records: users.length },
      { key: "server_sessions.json", label: "Server Auth Sessions", path: ACTIVE_SESSIONS_FILE, records: Array.isArray(sessions) ? sessions.filter((s) => !s.revoked).length : 0 },
      { key: "mrcost_history.json", label: "Mr. Cost AI Isolated Chats", path: ACTIVE_HISTORY_FILE, records: Object.keys(history).length },
      { key: "security_audit.json", label: "Security Audit Trail", path: ACTIVE_AUDIT_FILE, records: audits.length },
      { key: "infra_config.json", label: "Infrastructure Config", path: ACTIVE_INFRA_CONFIG_FILE, records: 1 },
    ];

    const stores = trackedFiles.map((f) => {
      let sizeBytes = 0;
      let updatedAt: string | null = null;
      let exists = false;
      try {
        if (fs.existsSync(f.path)) {
          exists = true;
          const st = fs.statSync(f.path);
          sizeBytes = st.size;
          updatedAt = st.mtime.toISOString();
        }
      } catch {}
      return {
        key: f.key,
        label: f.label,
        exists,
        sizeBytes,
        records: f.records,
        updatedAt,
      };
    });

    const totalStorageBytes = stores.reduce((acc, s) => acc + s.sizeBytes, 0);
    const lbSummary = infraManager.getLoadBalancerSummary();

    return {
      engine: "Hybrid Single-Source Persistence (Firebase Firestore Enterprise + Atomic JSON Registry)",
      singleDatabaseInvariant: true,
      readLatencyMs,
      totalStorageBytes,
      registeredDatabasesCount: databases.length,
      registeredUsersCount: users.length,
      activeSessionsCount: Array.isArray(sessions) ? sessions.filter((s) => !s.revoked && s.expiresAt > Date.now()).length : 0,
      stores,
      firestore: lbSummary.firestoreTelemetry,
      backupOverview: (() => {
        const list = this.listBackups();
        return {
          totalSnapshots: list.backups.length,
          verifiedSnapshots: list.backups.filter((b) => b.verificationStatus === "VERIFIED").length,
          totalBackupBytes: list.totalBytes,
          latestSnapshotAt: list.backups[0]?.createdAt || null,
          latestSnapshotStatus: list.backups[0]?.verificationStatus || null,
          storagePath: list.storagePath,
        };
      })(),
    };
  }
}

export const backupManager = new SmartCostBackupManager();
