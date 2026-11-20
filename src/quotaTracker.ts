/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SmartCost Zero-Cost Free Tier Quota & Usage Telemetry Tracker
 * - Tracks real in-app observed Daily & Monthly API requests, response bandwidth bytes, request CPU duration (ms),
 *   local persistence reads/writes, disk storage sizes, and authenticated client-observed Firestore reads/writes.
 * - Enforces Free Tier alert thresholds:
 *   * 80%  -> WARNING ("APPROACHING LIMIT")
 *   * 90%  -> WARNING ("HIGH USAGE")
 *   * 100% -> LIMIT REACHED ("FREE QUOTA EXCEEDED")
 * - NEVER fabricates external billing/cloud metrics: external GCP Cloud Monitoring & Cloudflare Account Analytics
 *   explicitly report "NOT AVAILABLE" when external platform APIs are not connected at RM0.00.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { BACKUP_DIR, DATA_DIR, DIST_DIR, PROJECT_ROOT as ROOT_DIR } from "./serverPaths.ts";

const QUOTA_FILE = path.join(DATA_DIR, "quota_usage.json");

export type QuotaMetricStatus = "ACTIVE" | "WARNING" | "LIMIT REACHED" | "NOT AVAILABLE";

export interface DailyQuotaPersistedState {
  dateMyt: string;
  monthMyt: string;
  apiRequestsToday: number;
  apiRequestsThisMonth: number;
  apiErrorsToday: number;
  bandwidthBytesToday: number;
  serverStoreReadsToday: number;
  serverStoreWritesToday: number;
  firestoreObservedReadsToday: number;
  firestoreObservedWritesToday: number;
  totalRequestDurationMsToday: number;
  slowRequestsOver10MsToday: number;
  lastUpdatedAt: string;
}

export interface FreeTierQuotaAlert {
  id: string;
  metricKey: string;
  severity: "APPROACHING LIMIT" | "HIGH USAGE" | "FREE QUOTA EXCEEDED";
  thresholdPercent: 80 | 90 | 100;
  title: string;
  message: string;
  percentUsed: number;
}

export interface UsageLimitsOverview {
  dateMyt: string;
  monthMyt: string;
  estimatedMonthlyCost: "RM0.00";
  warningThresholdPercent: number;
  highUsageThresholdPercent: number;
  exceededThresholdPercent: 100;
  overallStatus: "ACTIVE" | "WARNING" | "LIMIT REACHED";
  alerts: FreeTierQuotaAlert[];
  metrics: {
    dailyApiRequests: {
      observedCount: number;
      freeLimit: number;
      unit: string;
      percentUsed: number;
      status: QuotaMetricStatus;
      source: string;
      externalStatus: "NOT AVAILABLE";
      externalNote: string;
    };
    monthlyApiRequests: {
      observedCount: number;
      freeLimitReference: number;
      unit: string;
      percentUsed: number;
      status: QuotaMetricStatus;
      source: string;
      externalStatus: "NOT AVAILABLE";
      externalNote: string;
    };
    databaseReads: {
      firestoreObservedToday: number;
      serverStoreReadsToday: number;
      freeLimit: number;
      unit: string;
      percentUsed: number;
      status: QuotaMetricStatus;
      source: string;
      externalStatus: "NOT AVAILABLE";
      externalNote: string;
    };
    databaseWrites: {
      firestoreObservedToday: number;
      serverStoreWritesToday: number;
      freeLimit: number;
      unit: string;
      percentUsed: number;
      status: QuotaMetricStatus;
      source: string;
      externalStatus: "NOT AVAILABLE";
      externalNote: string;
    };
    storageUsage: {
      activeDataBytes: number;
      backupStorageBytes: number;
      distBuildBytes: number;
      totalLocalBytes: number;
      firestoreFreeLimitBytes: number;
      workerScriptMaxBytes: number;
      percentUsedOf1GiB: number;
      status: QuotaMetricStatus;
      source: string;
      externalStatus: "NOT AVAILABLE";
      externalNote: string;
    };
    cpuUsage: {
      processCpuPercent: number;
      avgApiDurationMs: number;
      workerCpuBudgetMs: number;
      slowRequestsOver10MsToday: number;
      cpuCores: number;
      status: QuotaMetricStatus;
      source: string;
      externalStatus: "NOT AVAILABLE";
      externalNote: string;
    };
    bandwidthUsage: {
      observedExpressEgressBytesToday: number;
      cloudflarePagesStaticPolicy: string;
      status: QuotaMetricStatus;
      source: string;
      externalStatus: "NOT AVAILABLE";
      externalNote: string;
    };
  };
  firestoreAudit: {
    projectId: string;
    databaseId: string;
    edition: string;
    planCompatibility: "COMPATIBLE_WITH_FREE_QUOTA_MONITORING";
    autoMigrationAllowed: false;
    summaryNote: string;
  };
}

function getCurrentMytDateString(): string {
  const nowMyt = new Date(Date.now() + 8 * 3600 * 1000);
  return nowMyt.toISOString().slice(0, 10);
}

function getCurrentMytMonthString(): string {
  return getCurrentMytDateString().slice(0, 7);
}

function createEmptyDayState(dateMyt: string, prevMonthCount = 0, prevMonthMyt?: string): DailyQuotaPersistedState {
  const monthMyt = dateMyt.slice(0, 7);
  const apiRequestsThisMonth = prevMonthMyt === monthMyt ? prevMonthCount : 0;
  return {
    dateMyt,
    monthMyt,
    apiRequestsToday: 0,
    apiRequestsThisMonth,
    apiErrorsToday: 0,
    bandwidthBytesToday: 0,
    serverStoreReadsToday: 0,
    serverStoreWritesToday: 0,
    firestoreObservedReadsToday: 0,
    firestoreObservedWritesToday: 0,
    totalRequestDurationMsToday: 0,
    slowRequestsOver10MsToday: 0,
    lastUpdatedAt: new Date().toISOString(),
  };
}

function sumDirectoryBytes(dirPath: string): number {
  try {
    if (!fs.existsSync(dirPath)) return 0;
    let total = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dirPath, ent.name);
      if (ent.isFile()) {
        total += fs.statSync(full).size;
      } else if (ent.isDirectory()) {
        total += sumDirectoryBytes(full);
      }
    }
    return total;
  } catch {
    return 0;
  }
}

class SmartCostQuotaTracker {
  private state: DailyQuotaPersistedState;
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private cpuSamplePrev = process.cpuUsage();
  private cpuSampleTime = process.hrtime.bigint();
  private lastCpuPercent = 0;

  // Official Free Tier Reference Ceilings (RM0.00/month)
  private readonly WORKER_FREE_DAILY_REQUESTS = 100_000;
  private readonly WORKER_FREE_MONTHLY_REFERENCE = 3_000_000; // 100,000/day * 30 days
  private readonly FIRESTORE_FREE_DAILY_READS = 50_000;
  private readonly FIRESTORE_FREE_DAILY_WRITES = 20_000;
  private readonly FIRESTORE_FREE_STORAGE_BYTES = 1024 * 1024 * 1024; // 1 GiB
  private readonly WORKER_FREE_CPU_MS_LIMIT = 10;

  constructor() {
    this.state = this.loadFromDisk();
    this.flushTimer = setInterval(() => {
      if (this.dirty) {
        this.saveToDisk();
      }
    }, 3000);
    this.flushTimer.unref?.();
  }

  private ensureRollover(): void {
    const today = getCurrentMytDateString();
    if (this.state.dateMyt !== today) {
      this.state = createEmptyDayState(today, this.state.apiRequestsThisMonth, this.state.monthMyt);
      this.dirty = true;
    }
  }

  private loadFromDisk(): DailyQuotaPersistedState {
    const today = getCurrentMytDateString();
    const month = getCurrentMytMonthString();
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(QUOTA_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(QUOTA_FILE, "utf-8"));
        if (parsed && parsed.dateMyt === today) {
          return {
            ...createEmptyDayState(today, parsed.apiRequestsThisMonth || 0, parsed.monthMyt || month),
            ...parsed,
            monthMyt: parsed.monthMyt || month,
            apiRequestsThisMonth: typeof parsed.apiRequestsThisMonth === "number" ? parsed.apiRequestsThisMonth : (parsed.apiRequestsToday || 0),
          };
        }
        if (parsed && parsed.monthMyt === month) {
          return createEmptyDayState(today, parsed.apiRequestsThisMonth || 0, parsed.monthMyt);
        }
      }
    } catch {
      // ignore corrupted read
    }
    return createEmptyDayState(today);
  }

  public saveToDisk(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      this.state.lastUpdatedAt = new Date().toISOString();
      const tmp = `${QUOTA_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf-8");
      fs.renameSync(tmp, QUOTA_FILE);
      this.dirty = false;
    } catch {
      // ignore disk write failure
    }
  }

  public isDailyApiQuotaExceeded(): boolean {
    this.ensureRollover();
    return this.state.apiRequestsToday >= this.WORKER_FREE_DAILY_REQUESTS;
  }

  public recordApiRequest(durationMs: number, statusCode: number, responseBytes: number): void {
    this.ensureRollover();
    this.state.apiRequestsToday += 1;
    this.state.apiRequestsThisMonth += 1;
    if (statusCode >= 500 || statusCode === 0) {
      this.state.apiErrorsToday += 1;
    }
    if (responseBytes > 0) {
      this.state.bandwidthBytesToday += Math.round(responseBytes);
    }
    if (durationMs > 0) {
      this.state.totalRequestDurationMsToday += Number(durationMs.toFixed(2));
      if (durationMs > this.WORKER_FREE_CPU_MS_LIMIT) {
        this.state.slowRequestsOver10MsToday += 1;
      }
    }
    this.dirty = true;
  }

  public recordServerStoreIo(reads: number, writes: number): void {
    this.ensureRollover();
    if (reads > 0) this.state.serverStoreReadsToday += Math.round(reads);
    if (writes > 0) this.state.serverStoreWritesToday += Math.round(writes);
    this.dirty = true;
  }

  public recordFirestoreClientOps(readsDelta: number, writesDelta: number): void {
    this.ensureRollover();
    const safeReads = Math.max(0, Math.min(500, Math.round(readsDelta || 0)));
    const safeWrites = Math.max(0, Math.min(500, Math.round(writesDelta || 0)));
    if (safeReads > 0 || safeWrites > 0) {
      this.state.firestoreObservedReadsToday += safeReads;
      this.state.firestoreObservedWritesToday += safeWrites;
      this.dirty = true;
      this.saveToDisk();
    }
  }

  private sampleProcessCpuPercent(): number {
    const nowTime = process.hrtime.bigint();
    const elapsedNs = Number(nowTime - this.cpuSampleTime);
    if (elapsedNs >= 400_000_000) {
      const currentUsage = process.cpuUsage(this.cpuSamplePrev);
      const elapsedUs = elapsedNs / 1000;
      const cpuCores = Math.max(1, os.cpus().length);
      const totalCpuUs = currentUsage.user + currentUsage.system;
      const pct = Math.min(100, Math.max(0.1, (totalCpuUs / (elapsedUs * cpuCores)) * 100));
      this.lastCpuPercent = Number(pct.toFixed(1));
      this.cpuSamplePrev = process.cpuUsage();
      this.cpuSampleTime = nowTime;
    }
    return this.lastCpuPercent;
  }

  private evaluateStatus(percent: number, warnThreshold: number): QuotaMetricStatus {
    if (percent >= 100) return "LIMIT REACHED";
    if (percent >= warnThreshold) return "WARNING";
    return "ACTIVE";
  }

  private classifyAlert(
    id: string,
    metricKey: string,
    titleBase: string,
    percent: number,
    warnThreshold: number,
    highThreshold: number,
    detail: string
  ): FreeTierQuotaAlert | null {
    if (percent >= 100) {
      return {
        id,
        metricKey,
        severity: "FREE QUOTA EXCEEDED",
        thresholdPercent: 100,
        title: `${titleBase} — FREE QUOTA EXCEEDED (100%)`,
        message: detail,
        percentUsed: percent,
      };
    }
    if (percent >= highThreshold) {
      return {
        id,
        metricKey,
        severity: "HIGH USAGE",
        thresholdPercent: 90,
        title: `${titleBase} — HIGH USAGE (${highThreshold}%+)`,
        message: detail,
        percentUsed: percent,
      };
    }
    if (percent >= warnThreshold) {
      return {
        id,
        metricKey,
        severity: "APPROACHING LIMIT",
        thresholdPercent: 80,
        title: `${titleBase} — APPROACHING LIMIT (${warnThreshold}%+)`,
        message: detail,
        percentUsed: percent,
      };
    }
    return null;
  }

  public getUsageLimitsOverview(warnThreshold = 80, highThreshold = 90): UsageLimitsOverview {
    this.ensureRollover();
    if (this.dirty) {
      this.saveToDisk();
    }

    const safeWarn = Math.max(50, Math.min(89, warnThreshold));
    const safeHigh = Math.max(safeWarn + 5, Math.min(99, highThreshold));

    const apiPct = Number(((this.state.apiRequestsToday / this.WORKER_FREE_DAILY_REQUESTS) * 100).toFixed(2));
    const apiStatus = this.evaluateStatus(apiPct, safeWarn);

    const monthlyPct = Number(((this.state.apiRequestsThisMonth / this.WORKER_FREE_MONTHLY_REFERENCE) * 100).toFixed(2));
    const monthlyStatus = this.evaluateStatus(monthlyPct, safeWarn);

    const fsReadPct = Number(((this.state.firestoreObservedReadsToday / this.FIRESTORE_FREE_DAILY_READS) * 100).toFixed(2));
    const fsReadStatus = this.evaluateStatus(fsReadPct, safeWarn);

    const fsWritePct = Number(((this.state.firestoreObservedWritesToday / this.FIRESTORE_FREE_DAILY_WRITES) * 100).toFixed(2));
    const fsWriteStatus = this.evaluateStatus(fsWritePct, safeWarn);

    const totalDataDirBytes = sumDirectoryBytes(DATA_DIR);
    const backupBytes = sumDirectoryBytes(BACKUP_DIR);
    const activeDataBytes = Math.max(0, totalDataDirBytes - backupBytes);
    const distBuildBytes = sumDirectoryBytes(DIST_DIR);
    const storagePct = Number(((totalDataDirBytes / this.FIRESTORE_FREE_STORAGE_BYTES) * 100).toFixed(4));
    const storageStatus = this.evaluateStatus(storagePct, safeWarn);

    const cpuPct = this.sampleProcessCpuPercent();
    const avgDurationMs = this.state.apiRequestsToday > 0
      ? Number((this.state.totalRequestDurationMsToday / this.state.apiRequestsToday).toFixed(2))
      : 0;
    const cpuStatus: QuotaMetricStatus = cpuPct >= 95 ? "LIMIT REACHED" : cpuPct >= safeWarn ? "WARNING" : "ACTIVE";

    const alerts: FreeTierQuotaAlert[] = [];
    const pushIf = (a: FreeTierQuotaAlert | null) => {
      if (a) alerts.push(a);
    };

    pushIf(
      this.classifyAlert(
        "alert-api-daily",
        "dailyApiRequests",
        "Daily API Usage",
        apiPct,
        safeWarn,
        safeHigh,
        `${this.state.apiRequestsToday.toLocaleString()} / ${this.WORKER_FREE_DAILY_REQUESTS.toLocaleString()} permintaan (${apiPct}%). Had Cloudflare Workers Free ialah 100,000 req/hari.`
      )
    );
    pushIf(
      this.classifyAlert(
        "alert-fs-reads",
        "databaseReads",
        "Database Reads",
        fsReadPct,
        safeWarn,
        safeHigh,
        `${this.state.firestoreObservedReadsToday.toLocaleString()} / ${this.FIRESTORE_FREE_DAILY_READS.toLocaleString()} bacaan (${fsReadPct}%).`
      )
    );
    pushIf(
      this.classifyAlert(
        "alert-fs-writes",
        "databaseWrites",
        "Database Writes",
        fsWritePct,
        safeWarn,
        safeHigh,
        `${this.state.firestoreObservedWritesToday.toLocaleString()} / ${this.FIRESTORE_FREE_DAILY_WRITES.toLocaleString()} tulisan (${fsWritePct}%).`
      )
    );
    pushIf(
      this.classifyAlert(
        "alert-storage",
        "storageUsage",
        "Storage Consumption",
        storagePct,
        safeWarn,
        safeHigh,
        `Storan tempatan ${storagePct}% daripada rujukan percuma 1 GiB.`
      )
    );

    const overallStatus: "ACTIVE" | "WARNING" | "LIMIT REACHED" =
      alerts.some((a) => a.severity === "FREE QUOTA EXCEEDED") || cpuStatus === "LIMIT REACHED"
        ? "LIMIT REACHED"
        : alerts.length > 0 || cpuStatus === "WARNING"
        ? "WARNING"
        : "ACTIVE";

    return {
      dateMyt: this.state.dateMyt,
      monthMyt: this.state.monthMyt,
      estimatedMonthlyCost: "RM0.00",
      warningThresholdPercent: safeWarn,
      highUsageThresholdPercent: safeHigh,
      exceededThresholdPercent: 100,
      overallStatus,
      alerts,
      metrics: {
        dailyApiRequests: {
          observedCount: this.state.apiRequestsToday,
          freeLimit: this.WORKER_FREE_DAILY_REQUESTS,
          unit: "req/hari",
          percentUsed: apiPct,
          status: apiStatus,
          source: "Measured live by Express /api middleware",
          externalStatus: "NOT AVAILABLE",
          externalNote: "Metrik akaun Cloudflare Workers global: NOT AVAILABLE secara percuma tanpa Cloudflare API Token.",
        },
        monthlyApiRequests: {
          observedCount: this.state.apiRequestsThisMonth,
          freeLimitReference: this.WORKER_FREE_MONTHLY_REFERENCE,
          unit: "req/bulan",
          percentUsed: monthlyPct,
          status: monthlyStatus,
          source: "Measured in-app monthly accumulator (quota_usage.json)",
          externalStatus: "NOT AVAILABLE",
          externalNote: "Bilangan permintaan bulanan rasmi di papan pemuka Cloudflare: NOT AVAILABLE tanpa API luaran.",
        },
        databaseReads: {
          firestoreObservedToday: this.state.firestoreObservedReadsToday,
          serverStoreReadsToday: this.state.serverStoreReadsToday,
          freeLimit: this.FIRESTORE_FREE_DAILY_READS,
          unit: "read units/hari",
          percentUsed: fsReadPct,
          status: fsReadStatus,
          source: "Measured in-app (Client Firestore SDK + Server JSON store)",
          externalStatus: "NOT AVAILABLE",
          externalNote: "Kaunter bil/kuota projek Google Cloud Monitoring: NOT AVAILABLE tanpa GCP Monitoring API & billing IAM.",
        },
        databaseWrites: {
          firestoreObservedToday: this.state.firestoreObservedWritesToday,
          serverStoreWritesToday: this.state.serverStoreWritesToday,
          freeLimit: this.FIRESTORE_FREE_DAILY_WRITES,
          unit: "write units/hari",
          percentUsed: fsWritePct,
          status: fsWriteStatus,
          source: "Measured in-app (Client Firestore SDK + Server JSON store)",
          externalStatus: "NOT AVAILABLE",
          externalNote: "Kaunter tulisan projek Google Cloud Monitoring: NOT AVAILABLE tanpa GCP Monitoring API.",
        },
        storageUsage: {
          activeDataBytes,
          backupStorageBytes: backupBytes,
          distBuildBytes,
          totalLocalBytes: totalDataDirBytes,
          firestoreFreeLimitBytes: this.FIRESTORE_FREE_STORAGE_BYTES,
          workerScriptMaxBytes: 3 * 1024 * 1024,
          percentUsedOf1GiB: storagePct,
          status: storageStatus,
          source: "Measured directly on disk (data/, data/backups/, dist/)",
          externalStatus: "NOT AVAILABLE",
          externalNote: "Saiz storan fizikal Firestore Enterprise di pelayan Google tidak didedahkan oleh Client SDK (NOT AVAILABLE).",
        },
        cpuUsage: {
          processCpuPercent: cpuPct,
          avgApiDurationMs: avgDurationMs,
          workerCpuBudgetMs: this.WORKER_FREE_CPU_MS_LIMIT,
          slowRequestsOver10MsToday: this.state.slowRequestsOver10MsToday,
          cpuCores: Math.max(1, os.cpus().length),
          status: cpuStatus,
          source: "Measured live via Node.js process.cpuUsage() & request wall-time",
          externalStatus: "NOT AVAILABLE",
          externalNote: "CPU Worker Cloudflare sebenar: NOT AVAILABLE tanpa API Cloudflare. Nota: bcryptjs cost-12 (>100ms) melebihi bajet 10ms Workers Free.",
        },
        bandwidthUsage: {
          observedExpressEgressBytesToday: this.state.bandwidthBytesToday,
          cloudflarePagesStaticPolicy: "Unlimited static assets (Cloudflare Pages Free — tertakluk polisi penggunaan wajar)",
          status: "ACTIVE",
          source: "Measured Express response payload bytes",
          externalStatus: "NOT AVAILABLE",
          externalNote: "Bandwidth CDN Cloudflare global: NOT AVAILABLE tanpa Cloudflare Analytics API.",
        },
      },
      firestoreAudit: {
        projectId: "reflecting-booth-740ks",
        databaseId: "ai-studio-remixsmartcostpr-940297e1-af61-42e5-8469-9bca8d60c481",
        edition: "Firestore Enterprise Edition",
        planCompatibility: "COMPATIBLE_WITH_FREE_QUOTA_MONITORING",
        autoMigrationAllowed: false,
        summaryNote: "Pangkalan data Firestore Enterprise asal dikekalkan tanpa migrasi automatik ke Standard. Operasi menggunakan getDoc/setDoc terus tanpa listener berlebihan supaya bacaan kekal rendah di bawah kuota percuma 50,000 unit/hari.",
      },
    };
  }
}

export const quotaTracker = new SmartCostQuotaTracker();
