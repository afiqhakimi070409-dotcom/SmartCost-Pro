/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Activity,
  Server,
  GitBranch,
  Database,
  Archive,
  RotateCcw,
  BarChart3,
  FileTerminal,
  ShieldAlert,
  SlidersHorizontal,
  RefreshCw,
  Play,
  Wrench,
  PowerOff,
  Power,
  CheckCircle2,
  AlertTriangle,
  Download,
  ShieldCheck,
  Search,
  Lock,
  HardDrive,
  Cpu,
  MemoryStick,
  Zap,
  Cloud,
  Gauge,
  BellRing,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { getAuthFetchHeaders } from "../utils/authSessionClient";
import { testFirestoreConnection } from "../firebase";
import { Language, getTranslation, formatLocalizedNumber, formatLocalizedTime, formatLocalizedDateTime } from "../utils/i18n";
import { apiUrl, getFetchCredentialsMode } from "../utils/apiBase";

export type InfraSubSection =
  | "overview"
  | "servers"
  | "load-balancer"
  | "database"
  | "backups"
  | "recovery"
  | "traffic"
  | "logs"
  | "security"
  | "configuration";

interface ServerNodeTelemetry {
  id: "server-a" | "server-b" | "server-c";
  name: string;
  roleLabel: string;
  zone: string;
  priority: number;
  weight: number;
  host: string;
  port: number | null;
  listening: boolean;
  status: "ACTIVE" | "WARNING" | "OFFLINE" | "MAINTENANCE";
  manualMode: "AUTO" | "MAINTENANCE" | "OFFLINE";
  cpuPercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  memoryPercent: number;
  uptimeSeconds: number;
  activeConnections: number;
  totalRequests: number;
  errorCount: number;
  errorRatePercent: number;
  avgResponseMs: number;
  p95ResponseMs: number;
  lastResponseMs: number | null;
  lastHttpStatus: number | null;
  lastHealthCheckAt: string | null;
  lastHealthStatus: string;
  consecutiveFailures: number;
  dbConnected: boolean;
  dbLatencyMs: number | null;
}

interface SystemBackupItem {
  id: string;
  fileName: string;
  createdAt: string;
  trigger: "MANUAL" | "SCHEDULED" | "PRE_RESTORE";
  createdBy: string;
  note: string;
  sizeBytes: number;
  sha256: string;
  verificationStatus: "VERIFIED" | "CORRUPTED" | "MISSING" | "PENDING";
  lastVerifiedAt: string | null;
  summary: {
    databaseCount: number;
    chatThreadsCount: number;
    usersCount: number;
    includesFirestoreMetadata: boolean;
  };
}

interface RecoveryLogItem {
  id: string;
  timestamp: string;
  backupId: string;
  backupFileName: string;
  preRestoreBackupId: string;
  mode: "merge_safe" | "replace_registry";
  executedBy: string;
  status: "SUCCESS" | "ABORTED" | "FAILED";
  details: string;
}

interface InfraOverviewResponse {
  servers: ServerNodeTelemetry[];
  loadBalancer: {
    algorithm: "round_robin" | "least_connections" | "health_based" | "failover";
    autoFailoverEnabled: boolean;
    healthCheckIntervalSec: number;
    failoverThreshold: number;
    healthyNodes: number;
    totalNodes: number;
    totalRequests: number;
    totalErrors: number;
    overallErrorRatePercent: number;
    totalActiveConnections: number;
    avgLatencyMs: number;
    totalFailoverEvents: number;
    lastFailoverAt: string | null;
    lastFailoverDetail: string | null;
    firestoreTelemetry: {
      status: string;
      latencyMs: number | null;
      checkedAt: string | null;
      projectId: string;
      databaseId: string;
    };
  };
  config: {
    loadBalancer: {
      algorithm: "round_robin" | "least_connections" | "health_based" | "failover";
      healthCheckIntervalSec: number;
      failoverThreshold: number;
      autoFailoverEnabled: boolean;
      requestTimeoutMs: number;
    };
    autoscaling: {
      provider: string;
      region: string;
      minInstances: number;
      maxInstances: number;
      targetCpuPercent: number;
      concurrencyPerInstance: number;
      scaleDownDelaySec: number;
    };
    backupPolicy: {
      autoBackupEnabled: boolean;
      scheduleIntervalHours: number;
      retentionCount: number;
      verifyAfterBackup: boolean;
      separateStorageDir: string;
    };
    quotaAlerts?: {
      warningThresholdPercent: number;
      criticalThresholdPercent: number;
    };
    updatedAt: string;
  };
  traffic: Array<{
    timestamp: string;
    label: string;
    totalRequests: number;
    serverA: number;
    serverB: number;
    serverC: number;
    avgLatencyMs: number;
    errors: number;
  }>;
  database: {
    engine: string;
    singleDatabaseInvariant: boolean;
    readLatencyMs: number;
    totalStorageBytes: number;
    registeredDatabasesCount: number;
    registeredUsersCount: number;
    activeSessionsCount: number;
    stores: Array<{
      key: string;
      label: string;
      exists: boolean;
      sizeBytes: number;
      records: number;
      updatedAt: string | null;
    }>;
    firestore: {
      status: string;
      latencyMs: number | null;
      checkedAt: string | null;
      projectId: string;
      databaseId: string;
    };
    backupOverview: {
      totalSnapshots: number;
      verifiedSnapshots: number;
      totalBackupBytes: number;
      latestSnapshotAt: string | null;
      latestSnapshotStatus: string | null;
      storagePath: string;
    };
  };
  backups: {
    backups: SystemBackupItem[];
    storagePath: string;
    totalBytes: number;
    lastScheduledRunAt: string | null;
    recoveryLogs: RecoveryLogItem[];
  };
  usageLimits?: {
    dateMyt: string;
    monthMyt: string;
    estimatedMonthlyCost: string;
    warningThresholdPercent: number;
    highUsageThresholdPercent: number;
    exceededThresholdPercent: number;
    overallStatus: "ACTIVE" | "WARNING" | "LIMIT REACHED";
    alerts: Array<{
      id: string;
      metricKey: string;
      severity: "APPROACHING LIMIT" | "HIGH USAGE" | "FREE QUOTA EXCEEDED";
      thresholdPercent: 80 | 90 | 100;
      title: string;
      message: string;
      percentUsed: number;
    }>;
    metrics: {
      dailyApiRequests: {
        observedCount: number;
        freeLimit: number;
        unit: string;
        percentUsed: number;
        status: string;
        source: string;
        externalStatus: "NOT AVAILABLE";
        externalNote: string;
      };
      monthlyApiRequests: {
        observedCount: number;
        freeLimitReference: number;
        unit: string;
        percentUsed: number;
        status: string;
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
        status: string;
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
        status: string;
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
        status: string;
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
        status: string;
        source: string;
        externalStatus: "NOT AVAILABLE";
        externalNote: string;
      };
      bandwidthUsage: {
        observedExpressEgressBytesToday: number;
        cloudflarePagesStaticPolicy: string;
        status: string;
        source: string;
        externalStatus: "NOT AVAILABLE";
        externalNote: string;
      };
    };
    firestoreAudit: {
      projectId: string;
      databaseId: string;
      edition: string;
      planCompatibility: string;
      autoMigrationAllowed: boolean;
      summaryNote: string;
    };
  };
  cloudDeployment: {
    runtimeEnvironment: string;
    zeroCostMode?: boolean;
    monthlyBudgetTarget?: string;
    architectureType?: string;
    managedCloudRunActive: boolean;
    serviceName: string;
    revision: string;
    region: string;
    geminiApiKeyConfigured: boolean;
  };
}

interface Props {
  isRealDeveloperSuperuser: boolean;
  lang: Language;
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  WARNING: "bg-amber-50 text-amber-700 border-amber-200",
  OFFLINE: "bg-rose-50 text-rose-700 border-rose-200",
  MAINTENANCE: "bg-slate-100 text-slate-700 border-slate-300",
  "LIMIT REACHED": "bg-rose-50 text-rose-700 border-rose-200",
  "NOT AVAILABLE": "bg-slate-100 text-slate-600 border-slate-200",
};

const STATUS_DOT: Record<string, string> = {
  ACTIVE: "bg-emerald-500",
  WARNING: "bg-amber-500",
  OFFLINE: "bg-rose-500",
  MAINTENANCE: "bg-slate-500",
  "LIMIT REACHED": "bg-rose-600",
  "NOT AVAILABLE": "bg-slate-400",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatUptime(seconds: number, hourShort: string): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}${hourShort} ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function ServerDatabaseManagement({ isRealDeveloperSuperuser, lang }: Props) {
  const t = getTranslation(lang);
  const [section, setSection] = useState<InfraSubSection>("overview");
  const [data, setData] = useState<InfraOverviewResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);

  // Load Balancer Dispatch Test state
  const [lbTestCount, setLbTestCount] = useState<number>(6);
  const [lbTestResult, setLbTestResult] = useState<{
    algorithm: string;
    requestedCount: number;
    succeededCount: number;
    failedCount: number;
    distribution: Record<string, number>;
    traces: Array<{
      seq: number;
      nodeId: string;
      nodeName: string;
      port: number | null;
      statusCode: number;
      latencyMs: number;
      dbLatencyMs: number | null;
      failoverApplied: boolean;
    }>;
  } | null>(null);

  // Backup & Recovery state
  const [backupNote, setBackupNote] = useState("");
  const [selectedRestoreId, setSelectedRestoreId] = useState<string>("");
  const [restoreMode, setRestoreMode] = useState<"merge_safe" | "replace_registry">("merge_safe");
  const [restoreConfirmPhrase, setRestoreConfirmPhrase] = useState("");
  const [restorePreview, setRestorePreview] = useState<{
    verificationStatus?: string;
    preview?: {
      currentDbCount: number;
      backupDbCount: number;
      missingDbsToRestore: number;
      existingDbsPreserved: number;
      currentChatThreads: number;
      backupChatThreads: number;
      usersProtectedCount: number;
    };
  } | null>(null);

  // Logs & Security state
  const [logs, setLogs] = useState<Array<{
    id: string;
    timestamp: string;
    level: string;
    source: string;
    serverId?: string;
    message: string;
    latencyMs?: number;
    statusCode?: number;
  }>>([]);
  const [logLevelFilter, setLogLevelFilter] = useState<string>("ALL");
  const [logSearch, setLogSearch] = useState<string>("");
  const [securityData, setSecurityData] = useState<{
    summary: {
      totalEvents: number;
      failedLoginsAndLockouts: number;
      blockedUnauthorizedRequests: number;
      developerAuthRejections: number;
      bcryptCostFactor: number;
      csrfProtectionActive: boolean;
      sessionIdleTimeoutMin: number;
      zeroSecretsExposed: boolean;
    };
    auditLogs: Array<{
      masa: string;
      jenisKejadian: string;
      role?: string;
      status: string;
      ip?: string;
      butiran?: string;
    }>;
  } | null>(null);

  // Configuration form state
  const [cfgForm, setCfgForm] = useState<InfraOverviewResponse["config"] | null>(null);

  const loadOverview = useCallback(async (silent = false) => {
    if (!isRealDeveloperSuperuser) return;
    if (!silent) setRefreshing(true);
    try {
      const headers = await getAuthFetchHeaders();
      const resp = await fetch(apiUrl("/api/infra/overview"), { credentials: getFetchCredentialsMode(), headers });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${resp.status}`);
      }
      const json = (await resp.json()) as InfraOverviewResponse;
      setData(json);
      setCfgForm((prev) => prev || json.config);
      if (!selectedRestoreId && json.backups?.backups?.length > 0) {
        setSelectedRestoreId(json.backups.backups[0].id);
      }
    } catch (e: any) {
      setFeedback({ type: "error", msg: e?.message || (lang === "en" ? "Failed to load server telemetry." : "Gagal memuatkan telemetri pelayan.") });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isRealDeveloperSuperuser, selectedRestoreId, lang]);

  const loadLogs = useCallback(async () => {
    if (!isRealDeveloperSuperuser) return;
    try {
      const headers = await getAuthFetchHeaders();
      const resp = await fetch(apiUrl(`/api/infra/logs?level=${encodeURIComponent(logLevelFilter)}&limit=150`), {
        credentials: getFetchCredentialsMode(),
        headers,
      });
      if (resp.ok) {
        const json = await resp.json();
        setLogs(Array.isArray(json.logs) ? json.logs : []);
      }
    } catch {}
  }, [isRealDeveloperSuperuser, logLevelFilter]);

  const loadSecurity = useCallback(async () => {
    if (!isRealDeveloperSuperuser) return;
    try {
      const headers = await getAuthFetchHeaders();
      const resp = await fetch(apiUrl("/api/infra/security"), { credentials: getFetchCredentialsMode(), headers });
      if (resp.ok) {
        setSecurityData(await resp.json());
      }
    } catch {}
  }, [isRealDeveloperSuperuser]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (section === "logs" || section === "database") loadLogs();
    if (section === "security") loadSecurity();
  }, [section, loadLogs, loadSecurity]);

  // Auto-refresh live metrics every 12 seconds while panel is open
  useEffect(() => {
    if (!isRealDeveloperSuperuser) return;
    const timer = setInterval(() => {
      loadOverview(true);
    }, 12000);
    return () => clearInterval(timer);
  }, [isRealDeveloperSuperuser, loadOverview]);

  const handleRunHealthCheck = async () => {
    setActionBusy("health-check");
    setFeedback(null);
    try {
      const headers = await getAuthFetchHeaders({ "Content-Type": "application/json" });
      const resp = await fetch(apiUrl("/api/infra/health-check"), {
        method: "POST",
        credentials: getFetchCredentialsMode(),
        headers,
      });
      if (!resp.ok) throw new Error(lang === "en" ? "Health check failed" : "Ujian kesihatan gagal");
      await loadOverview(true);
      setFeedback({
        type: "success",
        msg: lang === "en" ? "Health probes completed across Server A, Server B, and Server C." : "Ujian kesihatan HTTP selesai bagi Server A, Server B dan Server C.",
      });
    } catch (e: any) {
      setFeedback({ type: "error", msg: e?.message || (lang === "en" ? "Health check failed" : "Ujian kesihatan gagal") });
    } finally {
      setActionBusy(null);
    }
  };

  const handleServerMode = async (nodeId: string, mode: "ACTIVE" | "MAINTENANCE" | "OFFLINE") => {
    setActionBusy(`mode-${nodeId}`);
    setFeedback(null);
    try {
      const headers = await getAuthFetchHeaders({ "Content-Type": "application/json" });
      const resp = await fetch(apiUrl(`/api/infra/servers/${encodeURIComponent(nodeId)}/mode`), {
        method: "POST",
        credentials: getFetchCredentialsMode(),
        headers,
        body: JSON.stringify({ mode }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || (lang === "en" ? "Failed to update server mode" : "Gagal menukar mod pelayan"));
      await loadOverview(true);
      setFeedback({
        type: "info",
        msg: lang === "en"
          ? `${nodeId.toUpperCase()} set to ${mode}. Load balancer routing updated automatically.`
          : `${nodeId.toUpperCase()} ditukar ke mod ${mode}. Penghalaan Load Balancer dikemas kini secara automatik.`,
      });
    } catch (e: any) {
      setFeedback({ type: "error", msg: e?.message || (lang === "en" ? "Failed to update server status." : "Gagal menukar status pelayan.") });
    } finally {
      setActionBusy(null);
    }
  };

  const handleUpdateAlgorithm = async (algo: "round_robin" | "least_connections" | "health_based" | "failover") => {
    setActionBusy("lb-algo");
    setFeedback(null);
    try {
      const headers = await getAuthFetchHeaders({ "Content-Type": "application/json" });
      const resp = await fetch(apiUrl("/api/infra/config"), {
        method: "POST",
        credentials: getFetchCredentialsMode(),
        headers,
        body: JSON.stringify({ loadBalancer: { algorithm: algo } }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || (lang === "en" ? "Failed to update algorithm" : "Gagal menukar algoritma"));
      setCfgForm(json.config);
      await loadOverview(true);
      setFeedback({
        type: "success",
        msg: lang === "en" ? `Load balancing algorithm switched to ${algo}.` : `Algoritma Load Balancer ditukar kepada ${algo}.`,
      });
    } catch (e: any) {
      setFeedback({ type: "error", msg: e?.message || (lang === "en" ? "Error updating algorithm" : "Ralat menukar algoritma") });
    } finally {
      setActionBusy(null);
    }
  };

  const handleRunLbDispatchTest = async () => {
    setActionBusy("lb-test");
    setFeedback(null);
    try {
      const headers = await getAuthFetchHeaders({ "Content-Type": "application/json" });
      const resp = await fetch(apiUrl("/api/infra/load-balancer/test"), {
        method: "POST",
        credentials: getFetchCredentialsMode(),
        headers,
        body: JSON.stringify({ requestCount: lbTestCount }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || (lang === "en" ? "Test failed" : "Ujian gagal"));
      setLbTestResult(json);
      await loadOverview(true);
    } catch (e: any) {
      setFeedback({ type: "error", msg: e?.message || (lang === "en" ? "Load distribution test failed." : "Ujian agihan beban gagal.") });
    } finally {
      setActionBusy(null);
    }
  };

  const handleTestFirestorePing = async () => {
    setActionBusy("fs-ping");
    setFeedback(null);
    try {
      const t0 = performance.now();
      const res = await testFirestoreConnection();
      const latencyMs = Number((performance.now() - t0).toFixed(1));
      const headers = await getAuthFetchHeaders({ "Content-Type": "application/json" });
      await fetch(apiUrl("/api/infra/firestore-telemetry"), {
        method: "POST",
        credentials: getFetchCredentialsMode(),
        headers,
        body: JSON.stringify({ status: res.status, latencyMs }),
      });
      await loadOverview(true);
      setFeedback({
        type: res.status === "connected" ? "success" : "info",
        msg: `Firestore Ping: ${res.status.toUpperCase()} (${latencyMs} ms) — ${res.message}`,
      });
    } catch (e: any) {
      setFeedback({ type: "error", msg: e?.message || (lang === "en" ? "Firestore ping failed" : "Ujian sambungan Firestore gagal") });
    } finally {
      setActionBusy(null);
    }
  };

  const handleCreateBackup = async () => {
    setActionBusy("create-backup");
    setFeedback(null);
    try {
      const headers = await getAuthFetchHeaders({ "Content-Type": "application/json" });
      const resp = await fetch(apiUrl("/api/infra/backups/create"), {
        method: "POST",
        credentials: getFetchCredentialsMode(),
        headers,
        body: JSON.stringify({ note: backupNote.trim() || "Manual snapshot from Developer Console" }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || (lang === "en" ? "Backup creation failed" : "Gagal menjana sandaran"));
      setBackupNote("");
      if (json.backup?.id) setSelectedRestoreId(json.backup.id);
      await loadOverview(true);
      setFeedback({
        type: "success",
        msg: lang === "en"
          ? `Backup ${json.backup?.id} saved to separate storage (SHA-256 verified).`
          : `Sandaran ${json.backup?.id} disimpan dalam storan berasingan (SHA-256 disahkan).`,
      });
    } catch (e: any) {
      setFeedback({ type: "error", msg: e?.message || (lang === "en" ? "Failed to create backup." : "Gagal menjana sandaran.") });
    } finally {
      setActionBusy(null);
    }
  };

  const handleVerifyBackup = async (backupId: string) => {
    setActionBusy(`verify-${backupId}`);
    setFeedback(null);
    try {
      const headers = await getAuthFetchHeaders({ "Content-Type": "application/json" });
      const resp = await fetch(apiUrl("/api/infra/backups/verify"), {
        method: "POST",
        credentials: getFetchCredentialsMode(),
        headers,
        body: JSON.stringify({ backupId }),
      });
      const json = await resp.json().catch(() => ({}));
      await loadOverview(true);
      setFeedback({
        type: json.ok ? "success" : "error",
        msg: json.ok
          ? (lang === "en"
              ? `SHA-256 VERIFIED (${backupId}): ${String(json.computedSha256 || "").slice(0, 16)}...`
              : `SHA-256 DISAHKAN (${backupId}): ${String(json.computedSha256 || "").slice(0, 16)}...`)
          : (json.error || (lang === "en" ? "Checksum mismatch!" : "Semakan integriti tidak sepadan!")),
      });
    } catch (e: any) {
      setFeedback({ type: "error", msg: e?.message || (lang === "en" ? "Verification error" : "Ralat pengesahan") });
    } finally {
      setActionBusy(null);
    }
  };

  const handleDownloadBackup = async (backupId: string, fileName: string) => {
    try {
      const headers = await getAuthFetchHeaders();
      const resp = await fetch(apiUrl(`/api/infra/backups/${encodeURIComponent(backupId)}/download`), {
        credentials: getFetchCredentialsMode(),
        headers,
      });
      if (!resp.ok) throw new Error(lang === "en" ? "Download failed or file is corrupted." : "Muat turun gagal atau fail rosak.");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setFeedback({ type: "error", msg: e?.message || (lang === "en" ? "Failed to download backup." : "Gagal memuat turun sandaran.") });
    }
  };

  const handlePreviewRestore = async () => {
    if (!selectedRestoreId) return;
    setActionBusy("restore-preview");
    setRestorePreview(null);
    setFeedback(null);
    try {
      const headers = await getAuthFetchHeaders({ "Content-Type": "application/json" });
      const resp = await fetch(apiUrl("/api/infra/backups/restore-preview"), {
        method: "POST",
        credentials: getFetchCredentialsMode(),
        headers,
        body: JSON.stringify({ backupId: selectedRestoreId }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || (lang === "en" ? "Preview failed" : "Pratonton gagal"));
      setRestorePreview(json);
    } catch (e: any) {
      setFeedback({ type: "error", msg: e?.message || (lang === "en" ? "Restore preview failed." : "Pratonton pemulihan gagal.") });
    } finally {
      setActionBusy(null);
    }
  };

  const handleExecuteSafeRestore = async () => {
    if (!selectedRestoreId) return;
    setActionBusy("restore-exec");
    setFeedback(null);
    try {
      const headers = await getAuthFetchHeaders({ "Content-Type": "application/json" });
      const resp = await fetch(apiUrl("/api/infra/backups/restore"), {
        method: "POST",
        credentials: getFetchCredentialsMode(),
        headers,
        body: JSON.stringify({
          backupId: selectedRestoreId,
          confirmPhrase: restoreConfirmPhrase,
          mode: restoreMode,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || (lang === "en" ? "Safe restore failed." : "Pemulihan selamat gagal."));
      setRestoreConfirmPhrase("");
      setRestorePreview(null);
      await loadOverview(true);
      setFeedback({
        type: "success",
        msg: lang === "en"
          ? `Safe restore complete! Pre-restore snapshot: ${json.preRestoreBackupId}. Restored DB entries: ${json.restoredDatabasesCount}. Users & auth untouched.`
          : `Pemulihan selamat berjaya! Sandaran pra-pemulihan: ${json.preRestoreBackupId}. Entri DB dipulihkan: ${json.restoredDatabasesCount}. Akaun pengguna dikekalkan.`,
      });
    } catch (e: any) {
      setFeedback({ type: "error", msg: e?.message || (lang === "en" ? "Restore failed." : "Pemulihan gagal.") });
    } finally {
      setActionBusy(null);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cfgForm) return;
    setActionBusy("save-config");
    setFeedback(null);
    try {
      const headers = await getAuthFetchHeaders({ "Content-Type": "application/json" });
      const resp = await fetch(apiUrl("/api/infra/config"), {
        method: "POST",
        credentials: getFetchCredentialsMode(),
        headers,
        body: JSON.stringify(cfgForm),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || (lang === "en" ? "Failed to save configuration." : "Gagal menyimpan konfigurasi."));
      setCfgForm(json.config);
      await loadOverview(true);
      setFeedback({
        type: "success",
        msg: lang === "en" ? "Infrastructure configuration saved." : "Konfigurasi infrastruktur & penskalaan automatik disimpan.",
      });
    } catch (e: any) {
      setFeedback({ type: "error", msg: e?.message || (lang === "en" ? "Error saving configuration." : "Ralat menyimpan konfigurasi.") });
    } finally {
      setActionBusy(null);
    }
  };

  const filteredLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) =>
        l.message.toLowerCase().includes(q) ||
        l.source.toLowerCase().includes(q) ||
        (l.serverId || "").toLowerCase().includes(q) ||
        l.level.toLowerCase().includes(q)
    );
  }, [logs, logSearch]);

  if (!isRealDeveloperSuperuser) {
    return (
      <div className="p-8 text-center rounded-xl border border-rose-200 bg-rose-50 text-rose-900 space-y-2">
        <Lock className="w-6 h-6 text-rose-600 mx-auto" />
        <p className="text-sm font-bold">
          {lang === "en" ? "Developer Authorization Required" : "Kebenaran Pembangun Sistem Diperlukan"}
        </p>
        <p className="text-xs text-rose-700">
          {lang === "en"
            ? "Access to Server & Database Management is restricted to verified System Developers."
            : "Akses kepada modul Pengurusan Server & Database terhad kepada Pembangun Sistem yang disahkan sahaja."}
        </p>
      </div>
    );
  }

  const navItems: Array<{ id: InfraSubSection; labelMs: string; labelEn: string; icon: React.ReactNode }> = [
    { id: "overview", labelMs: "1. Gambaran Infrastruktur", labelEn: "1. Infrastructure Overview", icon: <Activity className="w-3.5 h-3.5" /> },
    { id: "servers", labelMs: "2. Pengurusan Pelayan", labelEn: "2. Server Management", icon: <Server className="w-3.5 h-3.5" /> },
    { id: "load-balancer", labelMs: "3. Pengimbang Beban (LB)", labelEn: "3. Load Balancer", icon: <GitBranch className="w-3.5 h-3.5" /> },
    { id: "database", labelMs: "4. Pemantauan Pangkalan Data", labelEn: "4. Database Monitoring", icon: <Database className="w-3.5 h-3.5" /> },
    { id: "backups", labelMs: "5. Pengurusan Sandaran", labelEn: "5. Backup Management", icon: <Archive className="w-3.5 h-3.5" /> },
    { id: "recovery", labelMs: "6. Pengurusan Pemulihan", labelEn: "6. Recovery Management", icon: <RotateCcw className="w-3.5 h-3.5" /> },
    { id: "traffic", labelMs: "7. Analitik Trafik", labelEn: "7. Traffic Analytics", icon: <BarChart3 className="w-3.5 h-3.5" /> },
    { id: "logs", labelMs: "8. Log Pelayan", labelEn: "8. Server Logs", icon: <FileTerminal className="w-3.5 h-3.5" /> },
    { id: "security", labelMs: "9. Pemantauan Keselamatan", labelEn: "9. Security Monitoring", icon: <ShieldAlert className="w-3.5 h-3.5" /> },
    { id: "configuration", labelMs: "10. Konfigurasi Infrastruktur", labelEn: "10. Infrastructure Configuration", icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
  ];

  const servers = data?.servers || [];
  const lb = data?.loadBalancer;
  const dbStats = data?.database;
  const backupsList = data?.backups?.backups || [];
  const usageLimits = data?.usageLimits;

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="bg-[#061830] text-white rounded-xl p-4 sm:p-5 border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-sky-300 uppercase tracking-wider">
            <Server className="w-3.5 h-3.5" />
            <span>{lang === "en" ? "SERVER & DATABASE MANAGEMENT" : "PENGURUSAN PELAYAN & PANGKALAN DATA"}</span>
            <span className="text-slate-500">/</span>
            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 font-bold">
              {lang === "en" ? "ZERO-COST: RM0.00/MONTH" : "KOS SIFAR: RM0.00/BULAN"}
            </span>
          </div>
          <h3 className="text-base sm:text-lg font-bold tracking-tight">
            {lang === "en"
              ? "Zero-Cost Cloud Infrastructure, Free Tier Quota & Safe Backup Console"
              : "Infrastruktur Awan Kos Sifar (RM0.00), Kuota Free Tier & Pemulihan Data"}
          </h3>
          <p className="text-xs text-slate-300">
            {lang === "en"
              ? "Cloudflare Pages + Workers Free target, Firebase Auth & Firestore Free quota monitoring, logical routing pools (Server A/B/C simulation), and manual SHA-256 backups."
              : "Sasaran Cloudflare Pages + Workers Free, pemantauan kuota Firebase Auth & Firestore percuma, simulasi logik Server A/B/C pada 1 runtime, dan sandaran SHA-256 manual."}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleRunHealthCheck}
            disabled={actionBusy === "health-check"}
            className="px-3 py-2 bg-[#0b3c7a] hover:bg-[#0e4a96] disabled:opacity-60 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Zap className={`w-3.5 h-3.5 ${actionBusy === "health-check" ? "animate-pulse" : ""}`} />
            <span>{lang === "en" ? "Probe Health" : "Uji Kesihatan"}</span>
          </button>
          <button
            type="button"
            onClick={() => loadOverview(false)}
            disabled={refreshing}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer border border-slate-700 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span>{lang === "en" ? "Refresh" : "Muat Semula"}</span>
          </button>
        </div>
      </div>

      {/* Free Tier Quota Alert Banner (80% / 90% / 100%) */}
      {usageLimits && usageLimits.alerts.length > 0 && (
        <div
          className={`p-3.5 rounded-xl border space-y-1.5 ${
            usageLimits.overallStatus === "LIMIT REACHED"
              ? "border-rose-300 bg-rose-50 text-rose-950"
              : "border-amber-300 bg-amber-50 text-amber-950"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold">
              <BellRing className="w-4 h-4 text-amber-700" />
              <span>{t.serverDb.freeTierWarning} ({usageLimits.alerts.length}) — {usageLimits.overallStatus}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSection("overview");
                setTimeout(() => document.getElementById("free-tier-usage-panel")?.scrollIntoView({ behavior: "smooth" }), 50);
              }}
              className="text-[11px] font-semibold underline cursor-pointer"
            >
              {t.serverDb.viewFreeTierUsage}
            </button>
          </div>
          {usageLimits.alerts.map((al) => (
            <div key={al.id} className="text-xs">
              <strong>[{al.severity}]</strong> {al.title}: {al.message}
            </div>
          ))}
        </div>
      )}

      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2 ${
            feedback.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : feedback.type === "info"
              ? "bg-sky-50 border-sky-200 text-sky-900"
              : "bg-rose-50 border-rose-200 text-rose-800"
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : feedback.type === "info" ? (
              <Activity className="w-4 h-4 text-sky-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{feedback.msg}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs font-bold opacity-60 hover:opacity-100 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Workspace Canvas: Sidebar Nav (10 Modules) + Main Viewport */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <aside className="lg:col-span-3 bg-white rounded-xl border border-slate-200 p-2 space-y-0.5">
          {navItems.map((item) => {
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer ${
                  active
                    ? "bg-[#061830] text-white"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                <span className={active ? "text-sky-300" : "text-slate-500"}>{item.icon}</span>
                <span className="truncate">{lang === "en" ? item.labelEn : item.labelMs}</span>
              </button>
            );
          })}
        </aside>

        <div className="lg:col-span-9 space-y-4">
          {loading && !data ? (
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3 animate-pulse">
              <div className="h-5 bg-slate-200 rounded w-1/3" />
              <div className="grid grid-cols-3 gap-3">
                <div className="h-20 bg-slate-100 rounded-lg" />
                <div className="h-20 bg-slate-100 rounded-lg" />
                <div className="h-20 bg-slate-100 rounded-lg" />
              </div>
              <div className="h-40 bg-slate-100 rounded-lg" />
            </div>
          ) : null}

          {/* 1. INFRASTRUCTURE OVERVIEW */}
          {data && section === "overview" && (
            <div className="space-y-4">
              {/* KPI Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
                <div className="bg-white rounded-xl border border-slate-200 p-3.5">
                  <span className="text-[10px] uppercase text-slate-500 block">
                    {lang === "en" ? "Healthy Nodes" : "Server Sihat"}
                  </span>
                  <div className="text-xl font-bold text-slate-900 mt-1">
                    {lb?.healthyNodes ?? 0} / {lb?.totalNodes ?? 3}
                  </div>
                  <span className="text-[11px] text-emerald-700 font-sans">
                    {lb?.healthyNodes === lb?.totalNodes ? t.serverDb.activeNodes : t.serverDb.failoverActive}
                  </span>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-3.5">
                  <span className="text-[10px] uppercase text-slate-500 block">
                    {lang === "en" ? "LB Requests" : "Jumlah Permintaan"}
                  </span>
                  <div className="text-xl font-bold text-slate-900 mt-1">
                    {formatLocalizedNumber(lb?.totalRequests ?? 0, lang)}
                  </div>
                  <span className="text-[11px] text-slate-500 font-sans">
                    {lang === "en" ? "Algo:" : "Algoritma:"} {lb?.algorithm}
                  </span>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-3.5">
                  <span className="text-[10px] uppercase text-slate-500 block">
                    {lang === "en" ? "Avg Latency" : "Purata Masa Respons"}
                  </span>
                  <div className="text-xl font-bold text-slate-900 mt-1">
                    {lb?.avgLatencyMs ?? 0} ms
                  </div>
                  <span className="text-[11px] text-slate-500 font-sans">
                    {lang === "en" ? "Error rate:" : "Kadar ralat:"} {lb?.overallErrorRatePercent ?? 0}%
                  </span>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-3.5">
                  <span className="text-[10px] uppercase text-slate-500 block">
                    {lang === "en" ? "Verified Backups" : "Sandaran Disahkan"}
                  </span>
                  <div className="text-xl font-bold text-slate-900 mt-1">
                    {dbStats?.backupOverview.verifiedSnapshots ?? 0} / {dbStats?.backupOverview.totalSnapshots ?? 0}
                  </div>
                  <span className="text-[11px] text-slate-500 font-sans">
                    {formatBytes(dbStats?.backupOverview.totalBackupBytes ?? 0)}
                  </span>
                </div>
              </div>

              {/* Architecture Topology Map */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">
                      {lang === "en" ? "Live Multi-Server & Shared Database Topology" : "Topologi Multi-Server & Pangkalan Data Tunggal"}
                    </h4>
                    <p className="text-xs text-slate-500">
                      {lang === "en"
                        ? "All traffic passes through the Load Balancer to Server A/B/C, sharing a single unified database layer and separated backup partition."
                        : "Semua trafik melalui Load Balancer ke Server A/B/C yang berkongsi satu lapisan pangkalan data dan storan sandaran terasing."}
                    </p>
                  </div>
                  <span className="text-[11px] font-mono bg-slate-100 text-slate-700 px-2.5 py-1 rounded border border-slate-200">
                    {data.cloudDeployment.managedCloudRunActive
                      ? "GCP Cloud Run"
                      : (lang === "en" ? "Local Node HTTP Pool" : "Kolam HTTP Nod Tempatan")}
                  </span>
                </div>

                {/* Tier 1 -> Tier 2 -> Tier 3 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-stretch">
                  {/* Tier 1: Zero-Cost Edge & Routing */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col justify-between space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <GitBranch className="w-4 h-4 text-[#0b3c7a]" />
                        {lang === "en" ? "Free Edge & Routing" : "Penghalaan & Pinggir Percuma"}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                        RM0.00
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 space-y-1 font-mono tabular-nums">
                      <div>{lang === "en" ? "Algorithm:" : "Algoritma:"} <strong>{lb?.algorithm}</strong></div>
                      <div>{lang === "en" ? "API Today:" : "API Hari Ini:"} <strong>{usageLimits?.metrics.dailyApiRequests.observedCount ?? 0}</strong> / 100k</div>
                      <div>{lang === "en" ? "Failover Events:" : "Kejadian Failover:"} <strong>{lb?.totalFailoverEvents ?? 0}</strong></div>
                      <div>Pages + Workers: <strong>{lang === "en" ? "Free Tier" : "Pelan Percuma"}</strong></div>
                    </div>
                  </div>

                  {/* Tier 2: Logical Simulation Pool (Single Runtime) */}
                  <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                    <div className="text-[11px] font-bold uppercase text-slate-500 tracking-wide">
                      {lang === "en" ? "Logical Pool" : "Kolam Logik"} {t.serverDb.simRuntime}
                    </div>
                    {servers.map((srv) => (
                      <div key={srv.id} className="flex items-center justify-between text-xs border border-slate-200 rounded-lg px-2.5 py-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[srv.status]}`} />
                          <span className="font-bold text-slate-900 truncate">{srv.name}</span>
                          <span className="text-[10px] font-mono text-slate-500">:{srv.port ?? "—"}</span>
                        </div>
                        <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums">
                          <span className="text-slate-600">{srv.totalRequests} {lang === "en" ? "req" : "perm"}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${STATUS_STYLE[srv.status]}`}>
                            {srv.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Tier 3: Single Shared DB + Separate Backups */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col justify-between space-y-2.5">
                    <div>
                      <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <Database className="w-4 h-4 text-[#0b3c7a]" />
                        {lang === "en" ? "Single Shared DB Layer" : "Lapisan Pangkalan Data Tunggal"}
                      </span>
                      <p className="text-[11px] text-slate-600 mt-1">
                        Firestore (<span className="font-mono">{dbStats?.firestore.projectId}</span>) + {lang === "en" ? "Atomic JSON Registry" : "Daftar JSON Atomik"} (<span className="font-mono">{dbStats?.registeredDatabasesCount} DB</span>)
                      </p>
                    </div>
                    <div className="pt-2 border-t border-slate-200">
                      <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <Archive className="w-4 h-4 text-emerald-700" />
                        {lang === "en" ? "Zero-Cost Manual Backup" : "Sandaran Manual Kos Sifar"}
                      </span>
                      <p className="text-[11px] text-slate-600 font-mono mt-0.5">
                        {dbStats?.backupOverview.storagePath} • {dbStats?.backupOverview.totalSnapshots} {lang === "en" ? "snapshots" : "snapshot"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Honest Zero-Cost Scope Notice */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs text-slate-700 flex items-start gap-2.5">
                <Cloud className="w-4 h-4 text-[#0b3c7a] shrink-0 mt-0.5" />
                <div>
                  <strong>{lang === "en" ? "Honest Free Tier Scope (RM0.00/mo):" : "Skop Infrastruktur Kos Sifar (RM0.00/bln):"}</strong>{" "}
                  {lang === "en"
                    ? "Running 1 unified runtime with logical application node pools (Server A, B, C on 127.0.0.1 — NOT 3 separate paid physical VMs). Cloudflare Pages + Cloudflare Workers Free edge gateway specs are ready in /wrangler.toml and /workers. Zero paid GCP Load Balancers, zero paid Cloud Run min-instances, and zero paid Managed Backups are enabled."
                    : "Sistem berjalan pada 1 runtime tunggal dengan kolam nod logik (Server A, B, C di 127.0.0.1 — BUKAN 3 pelayan fizikal berbayar). Konfigurasi Cloudflare Pages + Cloudflare Workers Free tersedia di /wrangler.toml & /workers. Tiada Load Balancer berbayar, tiada Cloud Run min-instances berbayar dan tiada perkhidmatan sandaran berbayar diaktifkan."}
                </div>
              </div>

              {/* FREE TIER USAGE MONITORING (Bahagian 11 - Integrated cleanly inside Infrastructure Overview) */}
              {usageLimits && (
                <div id="free-tier-usage-panel" className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        <Gauge className="w-4 h-4 text-[#0b3c7a]" />
                        <span>{lang === "en" ? "FREE TIER USAGE MONITORING (RM0.00 / MONTH)" : "PEMANTAUAN PENGGUNAAN PELAN PERCUMA (RM0.00 / BULAN)"}</span>
                      </h4>
                      <p className="text-xs text-slate-500">
                        {lang === "en" ? "MYT Date:" : "Tarikh MYT:"} <strong className="font-mono">{usageLimits.dateMyt}</strong> • {lang === "en" ? "Month:" : "Bulan:"}{" "}
                        <strong className="font-mono">{usageLimits.monthMyt}</strong> • {lang === "en" ? "Thresholds:" : "Ambang:"}{" "}
                        <strong className="font-mono">{usageLimits.warningThresholdPercent}% ({lang === "en" ? "Approaching Limit" : "Hampir Had"})</strong> •{" "}
                        <strong className="font-mono">{usageLimits.highUsageThresholdPercent}% ({lang === "en" ? "High Usage" : "Penggunaan Tinggi"})</strong> •{" "}
                        <strong className="font-mono">100% ({lang === "en" ? "Free Quota Exceeded" : "Kuota Melebihi Had"})</strong>
                      </p>
                    </div>
                    <span className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold border ${STATUS_STYLE[usageLimits.overallStatus] || STATUS_STYLE.ACTIVE}`}>
                      STATUS: {usageLimits.overallStatus} • {usageLimits.estimatedMonthlyCost}/{lang === "en" ? "mo" : "bln"}
                    </span>
                  </div>

                  {/* 8 Required Free Tier Usage Metrics */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    {/* 1. Daily API Usage */}
                    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">{lang === "en" ? "1. Daily API Usage" : "1. Penggunaan API Harian"}</span>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${STATUS_STYLE[usageLimits.metrics.dailyApiRequests.status] || STATUS_STYLE.ACTIVE}`}>
                          {usageLimits.metrics.dailyApiRequests.status}
                        </span>
                      </div>
                      <div className="font-mono tabular-nums text-base font-bold text-slate-900">
                        {formatLocalizedNumber(usageLimits.metrics.dailyApiRequests.observedCount, lang)} /{" "}
                        {formatLocalizedNumber(usageLimits.metrics.dailyApiRequests.freeLimit, lang)}{" "}
                        <span className="text-xs font-normal text-slate-500">({usageLimits.metrics.dailyApiRequests.percentUsed}%)</span>
                      </div>
                      <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#0b3c7a]"
                          style={{ width: `${Math.min(100, Math.max(1, usageLimits.metrics.dailyApiRequests.percentUsed))}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-slate-600">{usageLimits.metrics.dailyApiRequests.source}</p>
                      <p className="text-[10px] text-slate-700 bg-slate-100 border border-slate-200 rounded px-2 py-1">
                        <strong>{lang === "en" ? "External:" : "Luaran:"} {usageLimits.metrics.dailyApiRequests.externalStatus}</strong> — {usageLimits.metrics.dailyApiRequests.externalNote}
                      </p>
                    </div>

                    {/* 2. Monthly API Usage */}
                    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">
                          {lang === "en" ? `2. Monthly API Usage (${usageLimits.monthMyt})` : `2. Penggunaan API Bulanan (${usageLimits.monthMyt})`}
                        </span>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${STATUS_STYLE[usageLimits.metrics.monthlyApiRequests.status] || STATUS_STYLE.ACTIVE}`}>
                          {usageLimits.metrics.monthlyApiRequests.status}
                        </span>
                      </div>
                      <div className="font-mono tabular-nums text-base font-bold text-slate-900">
                        {formatLocalizedNumber(usageLimits.metrics.monthlyApiRequests.observedCount, lang)} /{" "}
                        {formatLocalizedNumber(usageLimits.metrics.monthlyApiRequests.freeLimitReference, lang)}{" "}
                        <span className="text-xs font-normal text-slate-500">({usageLimits.metrics.monthlyApiRequests.percentUsed}%)</span>
                      </div>
                      <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#0b3c7a]"
                          style={{ width: `${Math.min(100, Math.max(1, usageLimits.metrics.monthlyApiRequests.percentUsed))}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-slate-600">{usageLimits.metrics.monthlyApiRequests.source}</p>
                      <p className="text-[10px] text-slate-700 bg-slate-100 border border-slate-200 rounded px-2 py-1">
                        <strong>{lang === "en" ? "External:" : "Luaran:"} {usageLimits.metrics.monthlyApiRequests.externalStatus}</strong> — {usageLimits.metrics.monthlyApiRequests.externalNote}
                      </p>
                    </div>

                    {/* 3. Database Reads */}
                    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">
                          {lang === "en" ? "3. Database Reads (Firestore & Server JSON)" : "3. Bacaan Pangkalan Data (Firestore & JSON Pelayan)"}
                        </span>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${STATUS_STYLE[usageLimits.metrics.databaseReads.status] || STATUS_STYLE.ACTIVE}`}>
                          {usageLimits.metrics.databaseReads.status}
                        </span>
                      </div>
                      <div className="font-mono tabular-nums text-base font-bold text-slate-900">
                        {formatLocalizedNumber(usageLimits.metrics.databaseReads.firestoreObservedToday, lang)} Firestore /{" "}
                        {formatLocalizedNumber(usageLimits.metrics.databaseReads.freeLimit, lang)}{" "}
                        <span className="text-xs font-normal text-slate-500">({usageLimits.metrics.databaseReads.percentUsed}%)</span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-700">
                        {t.serverDb.serverJsonReadsToday} <strong>{formatLocalizedNumber(usageLimits.metrics.databaseReads.serverStoreReadsToday, lang)}</strong>
                      </div>
                      <p className="text-[10px] text-slate-700 bg-slate-100 border border-slate-200 rounded px-2 py-1">
                        <strong>{lang === "en" ? "External:" : "Luaran:"} {usageLimits.metrics.databaseReads.externalStatus}</strong> — {usageLimits.metrics.databaseReads.externalNote}
                      </p>
                    </div>

                    {/* 4. Database Writes */}
                    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">
                          {lang === "en" ? "4. Database Writes (Firestore & Server JSON)" : "4. Tulisan Pangkalan Data (Firestore & JSON Pelayan)"}
                        </span>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${STATUS_STYLE[usageLimits.metrics.databaseWrites.status] || STATUS_STYLE.ACTIVE}`}>
                          {usageLimits.metrics.databaseWrites.status}
                        </span>
                      </div>
                      <div className="font-mono tabular-nums text-base font-bold text-slate-900">
                        {formatLocalizedNumber(usageLimits.metrics.databaseWrites.firestoreObservedToday, lang)} Firestore /{" "}
                        {formatLocalizedNumber(usageLimits.metrics.databaseWrites.freeLimit, lang)}{" "}
                        <span className="text-xs font-normal text-slate-500">({usageLimits.metrics.databaseWrites.percentUsed}%)</span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-700">
                        {t.serverDb.serverJsonWritesToday} <strong>{formatLocalizedNumber(usageLimits.metrics.databaseWrites.serverStoreWritesToday, lang)}</strong>
                      </div>
                      <p className="text-[10px] text-slate-700 bg-slate-100 border border-slate-200 rounded px-2 py-1">
                        <strong>{lang === "en" ? "External:" : "Luaran:"} {usageLimits.metrics.databaseWrites.externalStatus}</strong> — {usageLimits.metrics.databaseWrites.externalNote}
                      </p>
                    </div>

                    {/* 5. Storage Consumption */}
                    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">
                          {lang === "en" ? "5. Storage Consumption (Measured on Disk)" : "5. Penggunaan Storan (Diukur pada Cakera)"}
                        </span>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${STATUS_STYLE[usageLimits.metrics.storageUsage.status] || STATUS_STYLE.ACTIVE}`}>
                          {usageLimits.metrics.storageUsage.status}
                        </span>
                      </div>
                      <div className="font-mono tabular-nums text-xs text-slate-800 space-y-0.5">
                        <div>{lang === "en" ? "Active Data (data/):" : "Data Aktif (data/):"} <strong>{formatBytes(usageLimits.metrics.storageUsage.activeDataBytes)}</strong></div>
                        <div>{lang === "en" ? "Backups (data/backups/):" : "Sandaran (data/backups/):"} <strong>{formatBytes(usageLimits.metrics.storageUsage.backupStorageBytes)}</strong></div>
                        <div>{lang === "en" ? "Frontend Build (dist/):" : "Binaan Frontend (dist/):"} <strong>{formatBytes(usageLimits.metrics.storageUsage.distBuildBytes)}</strong> ({lang === "en" ? "Pages file limit: 25 MiB" : "Had fail Pages: 25 MiB"})</div>
                      </div>
                      <p className="text-[10px] text-slate-700 bg-slate-100 border border-slate-200 rounded px-2 py-1">
                        <strong>{lang === "en" ? "External:" : "Luaran:"} {usageLimits.metrics.storageUsage.externalStatus}</strong> — {usageLimits.metrics.storageUsage.externalNote}
                      </p>
                    </div>

                    {/* 6. Request Limits & CPU Budget */}
                    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">
                          {lang === "en" ? "6. Request Limits & Worker 10ms CPU Budget" : "6. Had Permintaan & Bajet CPU Worker 10ms"}
                        </span>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${STATUS_STYLE[usageLimits.metrics.cpuUsage.status] || STATUS_STYLE.ACTIVE}`}>
                          {usageLimits.metrics.cpuUsage.status}
                        </span>
                      </div>
                      <div className="font-mono tabular-nums text-xs text-slate-800 space-y-0.5">
                        <div>{lang === "en" ? "API 100% Safety Limit:" : "Had Keselamatan API 100%:"} <strong>{lang === "en" ? "Auto HTTP 429 @ 100,000 req/day" : "Auto HTTP 429 @ 100,000 perm/hari"}</strong></div>
                        <div>{lang === "en" ? "Node Process CPU:" : "CPU Proses Node:"} <strong>{usageLimits.metrics.cpuUsage.processCpuPercent}%</strong> ({usageLimits.metrics.cpuUsage.cpuCores} {lang === "en" ? "cores" : "teras"}) • {lang === "en" ? "Avg:" : "Purata:"} <strong>{usageLimits.metrics.cpuUsage.avgApiDurationMs} ms</strong></div>
                        <div>{lang === "en" ? "Requests >10ms Today:" : "Permintaan >10ms Hari Ini:"} <strong>{usageLimits.metrics.cpuUsage.slowRequestsOver10MsToday}</strong> ({lang === "en" ? "Worker Free limit:" : "Had Worker Percuma:"} {usageLimits.metrics.cpuUsage.workerCpuBudgetMs}ms)</div>
                      </div>
                      <p className="text-[10px] text-slate-700 bg-slate-100 border border-slate-200 rounded px-2 py-1">
                        <strong>{lang === "en" ? "External:" : "Luaran:"} {usageLimits.metrics.cpuUsage.externalStatus}</strong> — {usageLimits.metrics.cpuUsage.externalNote}
                      </p>
                    </div>

                    {/* 7. Bandwidth Usage */}
                    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">{lang === "en" ? "7. Bandwidth Usage" : "7. Penggunaan Jalur Lebar"}</span>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${STATUS_STYLE[usageLimits.metrics.bandwidthUsage.status] || STATUS_STYLE.ACTIVE}`}>
                          {usageLimits.metrics.bandwidthUsage.status}
                        </span>
                      </div>
                      <div className="font-mono tabular-nums text-xs text-slate-800 space-y-0.5">
                        <div>{lang === "en" ? "Express API Egress Today:" : "Egress API Express Hari Ini:"} <strong>{formatBytes(usageLimits.metrics.bandwidthUsage.observedExpressEgressBytesToday)}</strong></div>
                        <div>{lang === "en" ? "Static Asset Policy:" : "Polisi Aset Statik:"} <strong>{usageLimits.metrics.bandwidthUsage.cloudflarePagesStaticPolicy}</strong></div>
                      </div>
                      <p className="text-[10px] text-slate-700 bg-slate-100 border border-slate-200 rounded px-2 py-1">
                        <strong>{lang === "en" ? "External:" : "Luaran:"} {usageLimits.metrics.bandwidthUsage.externalStatus}</strong> — {usageLimits.metrics.bandwidthUsage.externalNote}
                      </p>
                    </div>

                    {/* 8. Estimated Monthly Cost */}
                    <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-emerald-950">{lang === "en" ? "8. Estimated Monthly Cost" : "8. Anggaran Kos Bulanan"}</span>
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-white text-emerald-800 border border-emerald-300">
                          {lang === "en" ? "FREE TIER LOCKED" : "PELAN PERCUMA DIKUNCI"}
                        </span>
                      </div>
                      <div className="font-mono tabular-nums text-2xl font-bold text-emerald-900">
                        {usageLimits.estimatedMonthlyCost} / {lang === "en" ? "month" : "bulan"}
                      </div>
                      <p className="text-[11px] text-emerald-900">
                        {lang === "en"
                          ? "Zero paid Cloud Load Balancers, zero paid Cloud Run min-instances, zero paid Cloud Storage, and zero paid Firestore Managed Backups are enabled."
                          : "Tiada Cloud Load Balancer berbayar, tiada Cloud Run min-instances, tiada Cloud Storage berbayar, dan tiada Firestore Managed Backup diaktifkan."}
                      </p>
                    </div>
                  </div>

                  {/* Firestore Enterprise Free Tier Compatibility Audit */}
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900">
                        {lang === "en" ? "Firestore Enterprise Free Tier Compatibility Audit" : "Audit Keserasian Firestore Enterprise (Pelan Percuma)"}
                      </span>
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {lang === "en" ? "NO AUTO MIGRATION" : "TIADA MIGRASI AUTOMATIK"}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-600">
                      {lang === "en" ? "Project:" : "Projek:"} {usageLimits.firestoreAudit.projectId} • DB: {usageLimits.firestoreAudit.databaseId}
                    </div>
                    <p className="text-xs text-slate-700">{usageLimits.firestoreAudit.summaryNote}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 2. SERVER MANAGEMENT */}
          {data && section === "servers" && (
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs text-slate-700 flex items-start gap-2.5">
                <Server className="w-4 h-4 text-[#0b3c7a] shrink-0 mt-0.5" />
                <div>
                  <strong>
                    {lang === "en"
                      ? "Logical Application Node Pool (1 Runtime Simulation — Not 3 Paid Physical VMs):"
                      : "Kolam Nod Aplikasi Logik (Simulasi 1 Runtime — Bukan 3 VM Fizikal):"}
                  </strong>{" "}
                  {lang === "en"
                    ? "Each node listens on a separate loopback port inside a single Express process to track Health Check, Request Count, HTTP Response Status, Error Rate, and Last Heartbeat at RM0.00 cost."
                    : "Setiap nod mendengar pada port loopback berasingan dalam satu proses Express tunggal untuk memantau Health Check, Request Count, HTTP Response Status, Error Rate, dan Last Heartbeat pada kos RM0.00."}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {servers.map((srv) => (
                  <div key={srv.id} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                            <span className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[srv.status]}`} />
                            <span>{srv.name}</span>
                          </div>
                          <div className="text-[10px] font-mono text-slate-500">ID: {srv.id}</div>
                          <div className="text-[11px] text-slate-500">{srv.roleLabel}</div>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${STATUS_STYLE[srv.status]}`}>
                          {srv.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums pt-1 border-t border-slate-100">
                        <div>
                          <span className="text-[10px] text-slate-400 block">{lang === "en" ? "ENDPOINT" : "TITIK HUJUNG"}</span>
                          <span className="font-bold text-slate-800">{srv.host}:{srv.port ?? "STOP"}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block">{lang === "en" ? "HEALTH CHECK" : "SEMAKAN KESIHATAN"}</span>
                          <span className="font-bold text-slate-800">{srv.lastHealthStatus}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block">{lang === "en" ? "RESPONSE STATUS" : "STATUS RESPONS"}</span>
                          <span className="font-bold text-slate-800">HTTP {srv.lastHttpStatus ?? "—"}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block">{lang === "en" ? "UPTIME" : "MASA HIDUP"}</span>
                          <span className="font-bold text-slate-800">{formatUptime(srv.uptimeSeconds, t.serverDb.hourShort)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Cpu className="w-3 h-3 text-slate-400" />
                          <span>CPU: <strong>{srv.cpuPercent}%</strong></span>
                        </div>
                        <div className="flex items-center gap-1">
                          <MemoryStick className="w-3 h-3 text-slate-400" />
                          <span>RAM: <strong>{srv.memoryUsedMb} MB</strong></span>
                        </div>
                        <div>{lang === "en" ? "Req:" : "Perm:"} <strong>{srv.totalRequests}</strong></div>
                        <div>{lang === "en" ? "Conn:" : "Samb:"} <strong>{srv.activeConnections}</strong></div>
                        <div>{lang === "en" ? "Avg:" : "Purata:"} <strong>{srv.avgResponseMs} ms</strong></div>
                        <div>{lang === "en" ? "Err:" : "Ralat:"} <strong>{srv.errorCount} ({srv.errorRatePercent}%)</strong></div>
                      </div>

                      <div className="text-[10px] text-slate-500 flex items-center justify-between pt-1 border-t border-slate-100 font-mono">
                        <span>{lang === "en" ? "Heartbeat:" : "Degupan:"} {srv.lastHealthCheckAt ? formatLocalizedTime(srv.lastHealthCheckAt, lang) : "—"}</span>
                        <span>DB: {srv.dbLatencyMs !== null ? `${srv.dbLatencyMs} ms` : "—"}</span>
                      </div>
                    </div>

                    {/* Controls */}
                    <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => handleServerMode(srv.id, "ACTIVE")}
                        disabled={actionBusy === `mode-${srv.id}` || srv.manualMode === "AUTO"}
                        className="px-2 py-1.5 rounded text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Power className="w-3 h-3" />
                        <span>{lang === "en" ? "Active" : "Aktif"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleServerMode(srv.id, "MAINTENANCE")}
                        disabled={actionBusy === `mode-${srv.id}` || srv.manualMode === "MAINTENANCE"}
                        className="px-2 py-1.5 rounded text-[11px] font-semibold bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Wrench className="w-3 h-3" />
                        <span>{lang === "en" ? "Maint." : "Selenggara"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleServerMode(srv.id, "OFFLINE")}
                        disabled={actionBusy === `mode-${srv.id}` || srv.manualMode === "OFFLINE"}
                        className="px-2 py-1.5 rounded text-[11px] font-semibold bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <PowerOff className="w-3 h-3" />
                        <span>{lang === "en" ? "Offline" : "Luar Talian"}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Compact Telemetry Comparison Table */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500">
                    <tr>
                      <th className="py-2.5 px-3">{lang === "en" ? "Node ID / Name" : "ID / Nama Nod"}</th>
                      <th className="py-2.5 px-3">{lang === "en" ? "Status" : "Status"}</th>
                      <th className="py-2.5 px-3">{lang === "en" ? "Health Check" : "Kesihatan"}</th>
                      <th className="py-2.5 px-3 text-right">{lang === "en" ? "Requests" : "Permintaan"}</th>
                      <th className="py-2.5 px-3">{lang === "en" ? "Response Status" : "Status Respons"}</th>
                      <th className="py-2.5 px-3 text-right">{lang === "en" ? "Avg / P95" : "Purata / P95"}</th>
                      <th className="py-2.5 px-3 text-right">{lang === "en" ? "Errors" : "Ralat"}</th>
                      <th className="py-2.5 px-3">{lang === "en" ? "Last Heartbeat" : "Degupan Terkini"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {servers.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900">{s.name} (:{s.port ?? "—"})</div>
                          <div className="text-[10px] text-slate-500">{s.id}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${STATUS_STYLE[s.status]}`}>
                            {s.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-bold text-slate-700">{s.lastHealthStatus}</td>
                        <td className="py-2.5 px-3 text-right">{s.totalRequests} ({s.activeConnections} {lang === "en" ? "conn" : "samb"})</td>
                        <td className="py-2.5 px-3 font-bold text-slate-800">HTTP {s.lastHttpStatus ?? "—"}</td>
                        <td className="py-2.5 px-3 text-right">{s.avgResponseMs} / {s.p95ResponseMs} ms</td>
                        <td className="py-2.5 px-3 text-right">{s.errorCount} ({s.errorRatePercent}%)</td>
                        <td className="py-2.5 px-3 text-slate-500">
                          {s.lastHealthCheckAt ? formatLocalizedTime(s.lastHealthCheckAt, lang) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 3. LOAD BALANCER */}
          {data && section === "load-balancer" && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">
                      {lang === "en" ? "Load Balancing Strategy & Automatic Failover" : "Strategi Load Balancing & Failover Automatik"}
                    </h4>
                    <p className="text-xs text-slate-500">
                      {lang === "en"
                        ? "Select how incoming requests are distributed across healthy Server A, Server B, and Server C nodes."
                        : "Pilih algoritma pengagihan trafik merentasi nod Server A, Server B dan Server C yang sihat."}
                    </p>
                  </div>
                  <span className="text-xs font-mono font-bold text-[#0b3c7a] bg-slate-100 px-2.5 py-1 rounded border border-slate-200">
                    Active: {lb?.algorithm}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    {
                      id: "round_robin" as const,
                      title: "Round Robin",
                      desc: lang === "en" ? "Rotates traffic evenly across all healthy instances (A → B → C)." : "Mengagihkan trafik secara bergilir sekata ke semua server aktif.",
                    },
                    {
                      id: "least_connections" as const,
                      title: "Least Connections",
                      desc: lang === "en" ? "Routes to the healthy server with the fewest active connections." : "Menghantar permintaan ke server dengan sambungan aktif paling sedikit.",
                    },
                    {
                      id: "health_based" as const,
                      title: "Health-Based Routing",
                      desc: lang === "en" ? "Scores response latency, error rate, and load before selecting node." : "Menilai latensi respons, kadar ralat dan beban sebelum memilih nod.",
                    },
                    {
                      id: "failover" as const,
                      title: "Automatic Priority Failover",
                      desc: lang === "en" ? "Pins traffic to Server A; fails over to B/C automatically on failure." : "Utamakan Server A; alih automatik ke B/C jika berlaku gangguan.",
                    },
                  ].map((opt) => {
                    const selected = lb?.algorithm === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleUpdateAlgorithm(opt.id)}
                        disabled={actionBusy === "lb-algo"}
                        className={`text-left p-3.5 rounded-xl border transition-colors cursor-pointer ${
                          selected
                            ? "border-[#0b3c7a] bg-[#0b3c7a]/5"
                            : "border-slate-200 hover:border-slate-300 bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-900">{opt.title}</span>
                          {selected && <CheckCircle2 className="w-4 h-4 text-[#0b3c7a]" />}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">{opt.desc}</p>
                      </button>
                    );
                  })}
                </div>

                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-700">
                  {lang === "en" ? (
                    <>
                      <strong>Free Tier Platform Limit Note:</strong> The <code className="font-mono">Least Connections</code> algorithm measures actual <code className="font-mono">activeConnections</code> on the local Express runtime. On <em>Cloudflare Workers Free</em> without paid <em>Durable Objects</em>, global cross-PoP active connection tracking is unsupported and local <code className="font-mono">round_robin</code>/<code className="font-mono">failover</code> is used instead.
                    </>
                  ) : (
                    <>
                      <strong>Nota Batasan Platform Pelan Percuma:</strong> Algoritma <code className="font-mono">Least Connections</code> mengukur <code className="font-mono">activeConnections</code> sebenar pada runtime Express tempatan. Bagi persekitaran <em>Cloudflare Workers Free</em> tanpa <em>Durable Objects</em> berbayar, pengesanan sambungan aktif rentas PoP global tidak disokong dan hanya <code className="font-mono">round_robin</code>/<code className="font-mono">failover</code> tempatan digunakan.
                    </>
                  )}
                </div>

                {lb?.lastFailoverDetail && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                    <strong>{lang === "en" ? "Latest Failover Event:" : "Rekod Failover Terkini:"}</strong>{" "}
                    {lb.lastFailoverDetail} ({lb.lastFailoverAt ? formatLocalizedDateTime(lb.lastFailoverAt, lang) : ""})
                  </div>
                )}
              </div>

              {/* Real Dispatch Test Runner */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">
                      {lang === "en" ? "Live HTTP Dispatch & Failover Verification" : "Ujian Penghantaran HTTP & Failover Masa Nyata"}
                    </h4>
                    <p className="text-xs text-slate-500">
                      {lang === "en"
                        ? "Dispatches real loopback HTTP requests to /dispatch on active worker servers and traces routing."
                        : "Menghantar permintaan HTTP sebenar ke endpoint /dispatch pelayan pekerja untuk mengesahkan agihan dan failover."}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={lbTestCount}
                      onChange={(e) => setLbTestCount(Number(e.target.value))}
                      className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-mono bg-white"
                    >
                      <option value={6}>6 {lang === "en" ? "requests" : "permintaan"}</option>
                      <option value={12}>12 {lang === "en" ? "requests" : "permintaan"}</option>
                      <option value={20}>20 {lang === "en" ? "requests" : "permintaan"}</option>
                    </select>
                    <button
                      type="button"
                      onClick={handleRunLbDispatchTest}
                      disabled={actionBusy === "lb-test"}
                      className="px-3.5 py-1.5 bg-[#061830] hover:bg-[#0b3c7a] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>{actionBusy === "lb-test" ? t.serverDb.running : (lang === "en" ? "Run Dispatch Test" : "Jalankan Ujian")}</span>
                    </button>
                  </div>
                </div>

                {lbTestResult && (
                  <div className="space-y-3 pt-2 border-t border-slate-100">
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 font-mono text-xs tabular-nums">
                      <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                        <span className="text-[10px] text-slate-400 block">{t.serverDb.succeeded}</span>
                        <span className="font-bold text-emerald-700">{lbTestResult.succeededCount} / {lbTestResult.requestedCount}</span>
                      </div>
                      <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                        <span className="text-[10px] text-slate-400 block">SERVER A</span>
                        <span className="font-bold text-slate-900">{lbTestResult.distribution["server-a"] || 0}</span>
                      </div>
                      <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                        <span className="text-[10px] text-slate-400 block">SERVER B</span>
                        <span className="font-bold text-slate-900">{lbTestResult.distribution["server-b"] || 0}</span>
                      </div>
                      <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                        <span className="text-[10px] text-slate-400 block">SERVER C</span>
                        <span className="font-bold text-slate-900">{lbTestResult.distribution["server-c"] || 0}</span>
                      </div>
                      <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                        <span className="text-[10px] text-slate-400 block">{lang === "en" ? "FAILED" : "GAGAL"}</span>
                        <span className="font-bold text-rose-700">{lbTestResult.failedCount}</span>
                      </div>
                    </div>

                    <div className="overflow-x-auto max-h-60 border border-slate-200 rounded-lg">
                      <table className="w-full text-left text-xs font-mono tabular-nums">
                        <thead className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 uppercase">
                          <tr>
                            <th className="py-2 px-3">#</th>
                            <th className="py-2 px-3">{lang === "en" ? "Routed Node" : "Nod Dihalakan"}</th>
                            <th className="py-2 px-3">{lang === "en" ? "Port" : "Port"}</th>
                            <th className="py-2 px-3">HTTP</th>
                            <th className="py-2 px-3 text-right">{lang === "en" ? "Latency" : "Latensi"}</th>
                            <th className="py-2 px-3 text-right">{lang === "en" ? "DB Check" : "Semak DB"}</th>
                            <th className="py-2 px-3">{lang === "en" ? "Failover" : "Failover"}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {lbTestResult.traces.map((tr) => (
                            <tr key={tr.seq}>
                              <td className="py-1.5 px-3">{tr.seq}</td>
                              <td className="py-1.5 px-3 font-bold">{tr.nodeName}</td>
                              <td className="py-1.5 px-3">{tr.port ?? "—"}</td>
                              <td className="py-1.5 px-3">
                                <span className={tr.statusCode === 200 ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>
                                  {tr.statusCode}
                                </span>
                              </td>
                              <td className="py-1.5 px-3 text-right">{tr.latencyMs} ms</td>
                              <td className="py-1.5 px-3 text-right">{tr.dbLatencyMs !== null ? `${tr.dbLatencyMs} ms` : "—"}</td>
                              <td className="py-1.5 px-3">{tr.failoverApplied ? "REROUTED" : "NORMAL"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 4. DATABASE MONITORING (8 Bahagian-6 Sub-Cards) */}
          {data && section === "database" && dbStats && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Database className="w-4 h-4 text-[#0b3c7a]" />
                      <span>
                        {lang === "en"
                          ? "Database Monitoring — Unified Single Database Layer"
                          : "Pemantauan Pangkalan Data — Lapisan Tunggal Bersepadu"}
                      </span>
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">{dbStats.engine}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleTestFirestorePing}
                    disabled={actionBusy === "fs-ping"}
                    className="px-3 py-1.5 bg-[#0b3c7a] hover:bg-[#093163] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>
                      {actionBusy === "fs-ping"
                        ? (lang === "en" ? "Pinging..." : "Menguji...")
                        : (lang === "en" ? "Ping Firestore" : "Uji Sambungan Firestore")}
                    </span>
                  </button>
                </div>

                {/* Sub-Cards 1 to 4: Overview, Status, Connections, Usage */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {/* 4.1 Database Overview */}
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1.5">
                    <div className="text-[10px] uppercase text-slate-500 font-bold">
                      {lang === "en" ? "1. Database Overview" : "1. Gambaran Pangkalan Data"}
                    </div>
                    <div className="font-mono text-slate-900 font-bold">{lang === "en" ? "Project:" : "Projek:"} {dbStats.firestore.projectId}</div>
                    <div className="font-mono text-slate-600 break-all text-[11px]">DB ID: {dbStats.firestore.databaseId}</div>
                    <div className="font-mono text-slate-700 pt-1">
                      {lang === "en" ? "Registered DBs:" : "DB Berdaftar:"} <strong>{dbStats.registeredDatabasesCount}</strong> • {lang === "en" ? "Users:" : "Pengguna:"} <strong>{dbStats.registeredUsersCount}</strong>
                    </div>
                  </div>

                  {/* 4.2 Database Status */}
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1.5">
                    <div className="text-[10px] uppercase text-slate-500 font-bold">
                      {lang === "en" ? "2. Database Status" : "2. Status Pangkalan Data"}
                    </div>
                    <div className="font-mono flex items-center justify-between">
                      <span>Firestore Enterprise:</span>
                      <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold uppercase">
                        {dbStats.firestore.status}
                      </span>
                    </div>
                    <div className="font-mono flex items-center justify-between">
                      <span>{lang === "en" ? "Single-DB Invariant:" : "Ketekalan DB Tunggal:"}</span>
                      <span className="font-bold text-emerald-700">
                        {dbStats.singleDatabaseInvariant
                          ? (lang === "en" ? "VERIFIED (NO SPLIT-BRAIN)" : "DISAHKAN (TUNGGAL)")
                          : (lang === "en" ? "CHECK" : "SEMAK")}
                      </span>
                    </div>
                  </div>

                  {/* 4.3 Database Connection Monitoring */}
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1.5 font-mono tabular-nums">
                    <div className="text-[10px] uppercase text-slate-500 font-bold font-sans">
                      {lang === "en" ? "3. Database Connection Monitoring" : "3. Pemantauan Sambungan Pangkalan Data"}
                    </div>
                    <div>
                      Firestore Ping RTT:{" "}
                      <strong>
                        {dbStats.firestore.latencyMs !== null
                          ? `${dbStats.firestore.latencyMs} ms`
                          : (lang === "en" ? "Not pinged yet" : "Belum diuji")}
                      </strong>
                    </div>
                    <div>
                      {lang === "en" ? "Local Disk Read Latency:" : "Latensi Bacaan Cakera Tempatan:"}{" "}
                      <strong>{dbStats.readLatencyMs} ms</strong>
                    </div>
                    <div>
                      {lang === "en" ? "Active Authenticated Sessions:" : "Sesi Disahkan Aktif:"}{" "}
                      <strong>{dbStats.activeSessionsCount}</strong>
                    </div>
                  </div>

                  {/* 4.4 Database Usage */}
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1.5 font-mono tabular-nums">
                    <div className="text-[10px] uppercase text-slate-500 font-bold font-sans">
                      {lang === "en" ? "4. Database Usage (Today & Disk)" : "4. Penggunaan Pangkalan Data (Hari Ini & Storan)"}
                    </div>
                    <div>
                      {lang === "en" ? "Firestore Reads/Writes:" : "Bacaan/Tulisan Firestore:"}{" "}
                      <strong>{usageLimits?.metrics.databaseReads.firestoreObservedToday ?? 0}R / {usageLimits?.metrics.databaseWrites.firestoreObservedToday ?? 0}W</strong>
                    </div>
                    <div>
                      {lang === "en" ? "Server JSON Store Reads/Writes:" : "Bacaan/Tulisan Storan JSON:"}{" "}
                      <strong>{usageLimits?.metrics.databaseReads.serverStoreReadsToday ?? 0}R / {usageLimits?.metrics.databaseWrites.serverStoreWritesToday ?? 0}W</strong>
                    </div>
                    <div>
                      {lang === "en" ? "Active Persistence Size (data/):" : "Saiz Storan Aktif (data/):"}{" "}
                      <strong>{formatBytes(dbStats.totalStorageBytes)}</strong>
                    </div>
                  </div>
                </div>

                {/* Store Files Table */}
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-left text-xs font-mono tabular-nums">
                    <thead className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 uppercase">
                      <tr>
                        <th className="py-2 px-3">{lang === "en" ? "Store File" : "Fail Storan"}</th>
                        <th className="py-2 px-3">{lang === "en" ? "Description" : "Keterangan"}</th>
                        <th className="py-2 px-3 text-right">{lang === "en" ? "Records" : "Rekod"}</th>
                        <th className="py-2 px-3 text-right">{lang === "en" ? "Size" : "Saiz"}</th>
                        <th className="py-2 px-3">{lang === "en" ? "Last Modified" : "Kemas Kini Terakhir"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {dbStats.stores.map((st) => (
                        <tr key={st.key}>
                          <td className="py-2 px-3 font-bold text-slate-900">{st.key}</td>
                          <td className="py-2 px-3 font-sans text-slate-600">{st.label}</td>
                          <td className="py-2 px-3 text-right">{st.records}</td>
                          <td className="py-2 px-3 text-right">{formatBytes(st.sizeBytes)}</td>
                          <td className="py-2 px-3 text-slate-500">
                            {st.updatedAt ? formatLocalizedDateTime(st.updatedAt, lang) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Sub-Cards 5 to 8: Error Logs, Security + Multi-Instance Audit, Backup Summary, Recovery Shortcut */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {/* 4.5 Database Error Logs */}
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                    <div className="text-[10px] uppercase text-slate-500 font-bold">
                      {lang === "en" ? "5. Database Error Logs" : "5. Log Ralat Pangkalan Data"}
                    </div>
                    {(() => {
                      const dbErrLogs = logs.filter(
                        (l) => l.level === "ERROR" || l.source.toLowerCase().includes("db") || l.source.toLowerCase().includes("firestore")
                      );
                      if (dbErrLogs.length === 0) {
                        return (
                          <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2.5 py-2">
                            {t.serverDb.zeroErrorsRecorded}
                          </p>
                        );
                      }
                      return (
                        <div className="space-y-1 max-h-28 overflow-y-auto font-mono text-[11px]">
                          {dbErrLogs.slice(0, 6).map((el) => (
                            <div key={el.id} className="bg-white border border-slate-200 rounded px-2 py-1 text-slate-800">
                              [{el.level}] {el.message}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* 4.6 Database Security & Multi-Instance JSON Consistency Audit */}
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1.5">
                    <div className="text-[10px] uppercase text-slate-500 font-bold">
                      {lang === "en" ? "6. Database Security & Multi-Instance Audit" : "6. Audit Keselamatan & Konsistensi Multi-Nod"}
                    </div>
                    <div className="text-slate-800">
                      {lang === "en" ? (
                        <>• <code className="font-mono">firestore.rules</code> company isolation (<code className="font-mono">ownerId</code>) remains strictly enforced.</>
                      ) : (
                        <>• <code className="font-mono">firestore.rules</code> pengasingan syarikat (<code className="font-mono">ownerId</code>) kekal aktif (tiada pelemahan).</>
                      )}
                    </div>
                    <div className="text-amber-900 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 text-[11px]">
                      {lang === "en" ? (
                        <>
                          <strong>Multi-Instance JSON Consistency Audit:</strong>{" "}
                          <code className="font-mono">server_sessions.json</code>, <code className="font-mono">server_users.json</code>,{" "}
                          <code className="font-mono">server_databases.json</code> &amp; <code className="font-mono">quota_usage.json</code> use atomic renames on a single Express origin, and are unsuitable for shared stateless workers without D1/KV migration.
                        </>
                      ) : (
                        <>
                          <strong>Audit Konsistensi JSON Multi-Instance:</strong> Fail <code className="font-mono">server_sessions.json</code>,{" "}
                          <code className="font-mono">server_users.json</code>, <code className="font-mono">server_databases.json</code> &amp;{" "}
                          <code className="font-mono">quota_usage.json</code> selamat dengan <em>atomic rename</em> pada 1 Express origin, tetapi tidak sesuai dikongsi merentasi pekerja tanpa keadaan (stateless workers) tanpa migrasi ke D1/KV.
                        </>
                      )}
                    </div>
                  </div>

                  {/* 4.7 Database Backup History Summary */}
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase text-slate-500 font-bold">
                        {lang === "en" ? "7. Database Backup History" : "7. Sejarah Sandaran Pangkalan Data"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSection("backups")}
                        className="text-[11px] font-semibold text-[#0b3c7a] underline cursor-pointer"
                      >
                        {lang === "en" ? "Open Backup Management →" : "Buka Pengurusan Sandaran →"}
                      </button>
                    </div>
                    <div className="font-mono text-slate-800">
                      {lang === "en" ? "Snapshots:" : "Snapshot:"} <strong>{dbStats.backupOverview.verifiedSnapshots}</strong> {lang === "en" ? "verified /" : "disahkan /"} <strong>{dbStats.backupOverview.totalSnapshots}</strong> {lang === "en" ? "total" : "jumlah"} ({formatBytes(dbStats.backupOverview.totalBackupBytes)})
                    </div>
                    <div className="font-mono text-[11px] text-slate-600">
                      {lang === "en" ? "Latest:" : "Terkini:"} {dbStats.backupOverview.latestSnapshotAt ? formatLocalizedDateTime(dbStats.backupOverview.latestSnapshotAt, lang) : "—"} ({dbStats.backupOverview.latestSnapshotStatus ?? (lang === "en" ? "NONE" : "TIADA")})
                    </div>
                  </div>

                  {/* 4.8 Recovery Shortcut */}
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase text-slate-500 font-bold">
                        {lang === "en" ? "8. Data Recovery Guard" : "8. Pengawal Pemulihan Data"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSection("recovery")}
                        className="text-[11px] font-semibold text-[#0b3c7a] underline cursor-pointer"
                      >
                        {lang === "en" ? "Open Recovery Management →" : "Buka Pengurusan Pemulihan →"}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-700">
                      {lang === "en" ? (
                        <>
                          Recovery requires SHA-256 checksum verification, automatic <em>pre-restore snapshot</em> creation, and confirmation phrase{" "}
                          <code className="font-mono font-bold">PULIHKAN</code>.
                        </>
                      ) : (
                        <>
                          Pemulihan memerlukan pengesahan SHA-256, penciptaan <em>snapshot pra-pemulihan</em> automatik, serta frasa pengesahan{" "}
                          <code className="font-mono font-bold">PULIHKAN</code>.
                        </>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 5. BACKUP MANAGEMENT */}
          {data && section === "backups" && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <HardDrive className="w-4 h-4 text-[#0b3c7a]" />
                      <span>{lang === "en" ? "Separated Backup Storage & Integrity Manager" : "Storan Sandaran Berasingan & Pengesahan SHA-256"}</span>
                    </h4>
                    <p className="text-xs text-slate-500">
                      {lang === "en" ? "Location:" : "Lokasi:"} <code className="font-mono text-slate-800">{data.backups.storagePath}</code> • {lang === "en" ? "Auto Schedule:" : "Jadual Auto:"}{" "}
                      <strong>
                        {data.config.backupPolicy.autoBackupEnabled
                          ? (lang === "en"
                              ? `Every ${data.config.backupPolicy.scheduleIntervalHours}h`
                              : `Setiap ${data.config.backupPolicy.scheduleIntervalHours}j`)
                          : (lang === "en" ? "Disabled" : "Dimatikan")}
                      </strong>
                    </p>
                  </div>
                  <div className="text-xs font-mono text-slate-600 tabular-nums">
                    {lang === "en" ? "Total:" : "Jumlah:"} <strong>{backupsList.length}</strong> ({formatBytes(data.backups.totalBytes)})
                  </div>
                </div>

                {/* Create Manual Backup Bar */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={backupNote}
                    onChange={(e) => setBackupNote(e.target.value)}
                    placeholder={lang === "en" ? "Snapshot note (e.g. Before deployment)..." : "Catatan snapshot (cth. Sebelum kemas kini)..."}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleCreateBackup}
                    disabled={actionBusy === "create-backup"}
                    className="px-4 py-2 bg-[#061830] hover:bg-[#0b3c7a] text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>
                      {actionBusy === "create-backup"
                        ? (lang === "en" ? "Creating..." : "Menjana...")
                        : (lang === "en" ? "Create Verified Backup" : "Cipta Sandaran Sekarang")}
                    </span>
                  </button>
                </div>

                {/* Snapshot Table */}
                {backupsList.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500 border border-slate-200 rounded-lg bg-slate-50">
                    {lang === "en" ? "No snapshots stored yet." : "Tiada snapshot sandaran lagi."}
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-left text-xs font-mono tabular-nums">
                      <thead className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 uppercase">
                        <tr>
                          <th className="py-2 px-3">{lang === "en" ? "Snapshot ID" : "ID Snapshot"}</th>
                          <th className="py-2 px-3">{lang === "en" ? "Trigger" : "Pencetus"}</th>
                          <th className="py-2 px-3">{lang === "en" ? "Created" : "Dicipta"}</th>
                          <th className="py-2 px-3 text-right">{lang === "en" ? "Size" : "Saiz"}</th>
                          <th className="py-2 px-3">SHA-256</th>
                          <th className="py-2 px-3">{lang === "en" ? "Status" : "Status"}</th>
                          <th className="py-2 px-3 text-right">{lang === "en" ? "Actions" : "Tindakan"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {backupsList.map((b) => (
                          <tr key={b.id} className="hover:bg-slate-50">
                            <td className="py-2 px-3 font-bold text-slate-900">
                              <div>{b.id}</div>
                              <div className="text-[10px] font-sans font-normal text-slate-500 truncate max-w-[180px]">{b.note}</div>
                            </td>
                            <td className="py-2 px-3">{b.trigger}</td>
                            <td className="py-2 px-3 text-slate-600">{formatLocalizedDateTime(b.createdAt, lang)}</td>
                            <td className="py-2 px-3 text-right">{formatBytes(b.sizeBytes)}</td>
                            <td className="py-2 px-3 text-slate-500">{b.sha256.slice(0, 10)}…</td>
                            <td className="py-2 px-3">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                  b.verificationStatus === "VERIFIED"
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : b.verificationStatus === "PENDING"
                                    ? "bg-amber-50 text-amber-700 border-amber-200"
                                    : "bg-rose-50 text-rose-700 border-rose-200"
                                }`}
                              >
                                {b.verificationStatus}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right space-x-1 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handleVerifyBackup(b.id)}
                                disabled={actionBusy === `verify-${b.id}`}
                                className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-sans font-semibold cursor-pointer"
                              >
                                {t.serverDb.verify}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDownloadBackup(b.id, b.fileName)}
                                className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-sans font-semibold cursor-pointer inline-flex items-center gap-1"
                              >
                                <Download className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedRestoreId(b.id);
                                  setRestorePreview(null);
                                  setSection("recovery");
                                }}
                                className="px-2 py-1 rounded bg-[#0b3c7a] hover:bg-[#093163] text-white text-[11px] font-sans font-semibold cursor-pointer"
                              >
                                {t.serverDb.restore}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 6. RECOVERY MANAGEMENT */}
          {data && section === "recovery" && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <div className="border-b border-slate-100 pb-3">
                  <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <RotateCcw className="w-4 h-4 text-[#0b3c7a]" />
                    <span>{lang === "en" ? "Safe Recovery Workflow (Pre-Restore Snapshot Protected)" : "Aliran Pemulihan Selamat (Dilindungi Pra-Pemulihan)"}</span>
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {lang === "en"
                      ? "Every restore verifies SHA-256 integrity first, saves an automatic pre-restore snapshot, and preserves all user accounts/passwords."
                      : "Setiap pemulihan mengesahkan checksum SHA-256 dahulu, mencipta snapshot keselamatan pra-pemulihan automatik, dan mengekalkan akaun pengguna."}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {lang === "en" ? "1. Select Verified Snapshot" : "1. Pilih Snapshot Sandaran"}
                    </label>
                    <select
                      value={selectedRestoreId}
                      onChange={(e) => {
                        setSelectedRestoreId(e.target.value);
                        setRestorePreview(null);
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono bg-white"
                    >
                      {backupsList.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.id} [{b.trigger}] — {b.verificationStatus} ({formatLocalizedDateTime(b.createdAt, lang)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {lang === "en" ? "2. Recovery Mode" : "2. Mod Pemulihan Selamat"}
                    </label>
                    <select
                      value={restoreMode}
                      onChange={(e) => setRestoreMode(e.target.value as "merge_safe" | "replace_registry")}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                    >
                      <option value="merge_safe">
                        {lang === "en" ? "Safe Merge (Restore missing & preserve newer)" : "Gabung Selamat (Pulih rekod hilang, kekal terkini)"}
                      </option>
                      <option value="replace_registry">
                        {lang === "en" ? "Restore Registry State (Keep Protected Infra + Users)" : "Pulih Status Daftar (Kekalkan Infra & Akaun)"}
                      </option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePreviewRestore}
                    disabled={!selectedRestoreId || actionBusy === "restore-preview"}
                    className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    {actionBusy === "restore-preview"
                      ? (lang === "en" ? "Verifying..." : "Mengesahkan...")
                      : (lang === "en" ? "Run Integrity & Dry-Run Preview" : "Semak Integriti & Pratonton Kesan")}
                  </button>
                </div>

                {restorePreview?.preview && (
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-900">
                      <span>{lang === "en" ? "Dry-Run Impact Summary" : "Ringkasan Kesan Pratonton"} (SHA-256: {restorePreview.verificationStatus})</span>
                      <span className="text-emerald-700">{lang === "en" ? "Pre-Restore Snapshot: MANDATORY" : "Snapshot Pra-Pemulihan: WAJIB"}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs tabular-nums">
                      <div className="bg-white p-2.5 rounded border border-slate-200">
                        <span className="text-[10px] text-slate-400 block">{lang === "en" ? "LIVE DBs" : "DB AKTIF"}</span>
                        <span className="font-bold">{restorePreview.preview.currentDbCount}</span>
                      </div>
                      <div className="bg-white p-2.5 rounded border border-slate-200">
                        <span className="text-[10px] text-slate-400 block">{lang === "en" ? "TO RESTORE" : "AKAN DIPULIH"}</span>
                        <span className="font-bold text-emerald-700">+{restorePreview.preview.missingDbsToRestore}</span>
                      </div>
                      <div className="bg-white p-2.5 rounded border border-slate-200">
                        <span className="text-[10px] text-slate-400 block">{lang === "en" ? "CHAT THREADS" : "UTAS SEMBANG"}</span>
                        <span className="font-bold">{restorePreview.preview.backupChatThreads}</span>
                      </div>
                      <div className="bg-white p-2.5 rounded border border-slate-200">
                        <span className="text-[10px] text-slate-400 block">{lang === "en" ? "USERS SAFE" : "PENGGUNA SELAMAT"}</span>
                        <span className="font-bold text-[#0b3c7a]">{restorePreview.preview.usersProtectedCount}</span>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-slate-200">
                      <input
                        type="text"
                        value={restoreConfirmPhrase}
                        onChange={(e) => setRestoreConfirmPhrase(e.target.value)}
                        placeholder={lang === "en" ? "Type PULIHKAN to confirm safe restore" : "Taip PULIHKAN untuk mengesahkan pemulihan"}
                        className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono"
                      />
                      <button
                        type="button"
                        onClick={handleExecuteSafeRestore}
                        disabled={restoreConfirmPhrase.trim().toUpperCase() !== "PULIHKAN" || actionBusy === "restore-exec"}
                        className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-400 text-white rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap"
                      >
                        {actionBusy === "restore-exec"
                          ? (lang === "en" ? "Restoring..." : "Memulihkan...")
                          : (lang === "en" ? "Execute Safe Restore" : "Laksanakan Pemulihan Selamat")}
                      </button>
                    </div>
                  </div>
                )}

                {/* Recovery Audit Trail */}
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <h5 className="text-xs font-bold text-slate-800 uppercase">
                    {lang === "en" ? "Recovery Audit History" : "Sejarah Audit Pemulihan"}
                  </h5>
                  {data.backups.recoveryLogs.length === 0 ? (
                    <p className="text-xs text-slate-500">{t.serverDb.noRecoveryActivity}</p>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 uppercase">
                          <tr>
                            <th className="py-2 px-3">{t.serverDb.timeCol}</th>
                            <th className="py-2 px-3">{lang === "en" ? "Backup" : "Sandaran"}</th>
                            <th className="py-2 px-3">{lang === "en" ? "Pre-Restore Snap" : "Snap Pra-Pulih"}</th>
                            <th className="py-2 px-3">{lang === "en" ? "Status" : "Status"}</th>
                            <th className="py-2 px-3">{lang === "en" ? "Details" : "Butiran"}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {data.backups.recoveryLogs.map((rl) => (
                            <tr key={rl.id}>
                              <td className="py-2 px-3 whitespace-nowrap">{formatLocalizedDateTime(rl.timestamp, lang)}</td>
                              <td className="py-2 px-3">{rl.backupId}</td>
                              <td className="py-2 px-3">{rl.preRestoreBackupId}</td>
                              <td className="py-2 px-3 font-bold text-emerald-700">{rl.status}</td>
                              <td className="py-2 px-3 font-sans text-slate-600">{rl.details}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 7. TRAFFIC ANALYTICS */}
          {data && section === "traffic" && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <div className="border-b border-slate-100 pb-3">
                  <h4 className="text-sm font-bold text-slate-900">
                    {lang === "en" ? "Per-Server Request Distribution & Latency Analytics" : "Analitik Agihan Trafik & Masa Respons Setiap Server"}
                  </h4>
                  <p className="text-xs text-slate-500">
                    {lang === "en"
                      ? "Real request volume distributed across Server A, Server B, and Server C per minute window."
                      : "Jumlah permintaan sebenar yang diagihkan merentasi Server A, Server B dan Server C mengikut tetingkap masa."}
                  </p>
                </div>

                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.traffic}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="serverA" name="Server A" stackId="nodes" fill="#061830" />
                      <Bar dataKey="serverB" name="Server B" stackId="nodes" fill="#0b3c7a" />
                      <Bar dataKey="serverC" name="Server C" stackId="nodes" fill="#0284c7" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="h-56 w-full pt-2 border-t border-slate-100">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.traffic}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="avgLatencyMs" name={lang === "en" ? "Avg Response (ms)" : "Purata Respons (ms)"} stroke="#0b3c7a" strokeWidth={2} />
                      <Line type="monotone" dataKey="errors" name={lang === "en" ? "5xx Errors" : "Ralat 5xx"} stroke="#dc2626" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* 8. SERVER LOGS */}
          {section === "logs" && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <h4 className="text-sm font-bold text-slate-900">
                  {lang === "en" ? "Structured Server, Failover & Backup Logs" : "Log Operasi Pelayan, Failover & Sandaran"}
                </h4>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                    <input
                      type="text"
                      value={logSearch}
                      onChange={(e) => setLogSearch(e.target.value)}
                      placeholder={lang === "en" ? "Filter logs..." : "Tapis log..."}
                      className="pl-8 pr-3 py-1 border border-slate-300 rounded-lg text-xs"
                    />
                  </div>
                  <select
                    value={logLevelFilter}
                    onChange={(e) => setLogLevelFilter(e.target.value)}
                    className="px-2.5 py-1 border border-slate-300 rounded-lg text-xs font-mono bg-white"
                  >
                    <option value="ALL">{lang === "en" ? "ALL" : "SEMUA"}</option>
                    <option value="INFO">INFO</option>
                    <option value="FAILOVER">FAILOVER</option>
                    <option value="BACKUP">BACKUP</option>
                    <option value="SECURITY">SECURITY</option>
                    <option value="ERROR">ERROR</option>
                  </select>
                  <button
                    type="button"
                    onClick={loadLogs}
                    className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto max-h-96 border border-slate-200 rounded-lg">
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 uppercase">
                    <tr>
                      <th className="py-2 px-3">{t.serverDb.timeCol}</th>
                      <th className="py-2 px-3">{t.serverDb.levelCol}</th>
                      <th className="py-2 px-3">{t.serverDb.sourceCol}</th>
                      <th className="py-2 px-3">{t.serverDb.messageCol}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-slate-400 font-sans">
                          {lang === "en" ? "No log entries matching current filter." : "Tiada entri log sepadan dengan penapis semasa."}
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.map((l) => (
                        <tr key={l.id} className="hover:bg-slate-50">
                          <td className="py-1.5 px-3 whitespace-nowrap text-slate-500">
                            {formatLocalizedTime(l.timestamp, lang)}
                          </td>
                          <td className="py-1.5 px-3">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                l.level === "ERROR" || l.level === "SECURITY"
                                  ? "bg-rose-50 text-rose-700"
                                  : l.level === "FAILOVER"
                                  ? "bg-amber-50 text-amber-700"
                                  : l.level === "BACKUP"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {l.level}
                            </span>
                          </td>
                          <td className="py-1.5 px-3 text-slate-700 whitespace-nowrap">{l.source}</td>
                          <td className="py-1.5 px-3 text-slate-800 font-sans">{l.message}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 9. SECURITY MONITORING */}
          {section === "security" && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-700" />
                    <span>{lang === "en" ? "Security & Credential Protection Monitoring" : "Pemantauan Keselamatan & Perlindungan Kredensial"}</span>
                  </h4>
                  <p className="text-xs text-slate-500">
                    {lang === "en"
                      ? "Tracks brute-force lockouts, blocked RBAC requests, and verifies zero secret exposure."
                      : "Memantau cubaan gagal log masuk, sekatan akses RBAC dan memastikan tiada rahsia/API key terdedah."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadSecurity}
                  className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              {securityData && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <span className="text-[10px] text-slate-500 block">{lang === "en" ? "AUDIT EVENTS" : "KEJADIAN AUDIT"}</span>
                      <span className="text-lg font-bold text-slate-900">{securityData.summary.totalEvents}</span>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <span className="text-[10px] text-slate-500 block">{lang === "en" ? "LOGIN FAIL / LOCK" : "GAGAL / KUNCI LOG MASUK"}</span>
                      <span className="text-lg font-bold text-amber-700">{securityData.summary.failedLoginsAndLockouts}</span>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <span className="text-[10px] text-slate-500 block">{lang === "en" ? "BLOCKED RBAC" : "SEKATAN RBAC"}</span>
                      <span className="text-lg font-bold text-rose-700">{securityData.summary.blockedUnauthorizedRequests}</span>
                    </div>
                    <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                      <span className="text-[10px] text-emerald-700 block">{lang === "en" ? "SECRETS EXPOSED" : "RAHSIA TERDEDAH"}</span>
                      <span className="text-lg font-bold text-emerald-800">{lang === "en" ? "0 (PROTECTED)" : "0 (DILINDUNGI)"}</span>
                    </div>
                  </div>

                  <div className="overflow-x-auto max-h-80 border border-slate-200 rounded-lg">
                    <table className="w-full text-left text-xs font-mono tabular-nums">
                      <thead className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 uppercase">
                        <tr>
                          <th className="py-2 px-3">{t.serverDb.timeCol}</th>
                          <th className="py-2 px-3">{lang === "en" ? "Event" : "Kejadian"}</th>
                          <th className="py-2 px-3">{lang === "en" ? "Role" : "Peranan"}</th>
                          <th className="py-2 px-3">{lang === "en" ? "Status" : "Status"}</th>
                          <th className="py-2 px-3">{lang === "en" ? "Detail" : "Butiran"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {securityData.auditLogs.slice(0, 50).map((ev, idx) => (
                          <tr key={idx}>
                            <td className="py-1.5 px-3 whitespace-nowrap text-slate-500">
                              {formatLocalizedDateTime(ev.masa, lang)}
                            </td>
                            <td className="py-1.5 px-3 font-bold text-slate-800">{ev.jenisKejadian}</td>
                            <td className="py-1.5 px-3">{ev.role || "—"}</td>
                            <td className="py-1.5 px-3">
                              <span className={ev.status === "BERJAYA" || ev.status === "SUCCESS" ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>
                                {ev.status}
                              </span>
                            </td>
                            <td className="py-1.5 px-3 text-slate-600 font-sans">{ev.butiran || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 11. ZERO-COST INFRASTRUCTURE CONFIGURATION */}
          {cfgForm && section === "configuration" && (
            <form onSubmit={handleSaveConfig} className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">
              <div className="border-b border-slate-100 pb-3">
                <h4 className="text-sm font-bold text-slate-900">
                  {lang === "en" ? "Zero-Cost Routing, Free Tier Alerts & Manual Backup Config" : "Konfigurasi Kos Sifar (RM0.00), Amaran Kuota & Sandaran"}
                </h4>
                <p className="text-xs text-slate-500">
                  {lang === "en"
                    ? "Strictly enforces RM0.00 Free Tier limits (min instances locked to 0 scale-to-zero, zero paid cloud subscriptions)."
                    : "Menguatkuasakan had Free Tier RM0.00 (min instances dikunci pada 0 scale-to-zero, tiada langganan berbayar diaktifkan)."}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                {/* Load Balancer Settings */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                  <div className="font-bold text-slate-900">{lang === "en" ? "Logical Pool Routing" : "Penghalaan Kolam Logik"}</div>
                  <div>
                    <label className="block text-slate-600 mb-1">{lang === "en" ? "Algorithm" : "Algoritma"}</label>
                    <select
                      value={cfgForm.loadBalancer.algorithm}
                      onChange={(e) =>
                        setCfgForm({
                          ...cfgForm,
                          loadBalancer: { ...cfgForm.loadBalancer, algorithm: e.target.value as any },
                        })
                      }
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono"
                    >
                      <option value="health_based">health_based</option>
                      <option value="round_robin">round_robin</option>
                      <option value="least_connections">least_connections</option>
                      <option value="failover">failover</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">{lang === "en" ? "Health Check Interval (sec)" : "Selang Semakan Kesihatan (saat)"}</label>
                    <input
                      type="number"
                      min={5}
                      max={300}
                      value={cfgForm.loadBalancer.healthCheckIntervalSec}
                      onChange={(e) =>
                        setCfgForm({
                          ...cfgForm,
                          loadBalancer: { ...cfgForm.loadBalancer, healthCheckIntervalSec: Number(e.target.value) },
                        })
                      }
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">{lang === "en" ? "Failover Threshold (fails)" : "Ambang Failover (kegagalan)"}</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={cfgForm.loadBalancer.failoverThreshold}
                      onChange={(e) =>
                        setCfgForm({
                          ...cfgForm,
                          loadBalancer: { ...cfgForm.loadBalancer, failoverThreshold: Number(e.target.value) },
                        })
                      }
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                </div>

                {/* Free Tier Quota Thresholds */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                  <div className="font-bold text-slate-900">{lang === "en" ? "Free Tier Quota Alerts (RM0.00)" : "Amaran Kuota Percuma (RM0.00)"}</div>
                  <div className="p-2 rounded bg-emerald-50 border border-emerald-200 text-[11px] font-mono text-emerald-800">
                    100%: <strong>{lang === "en" ? "FREE QUOTA EXCEEDED (Auto HTTP 429)" : "KUOTA MELEBIHI HAD (Auto HTTP 429)"}</strong> • Min: <strong>0</strong>
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">{lang === "en" ? "Approaching Limit Alert (%)" : "Amaran Hampir Had (%)"}</label>
                    <input
                      type="number"
                      min={50}
                      max={89}
                      value={cfgForm.quotaAlerts?.warningThresholdPercent ?? 80}
                      onChange={(e) =>
                        setCfgForm({
                          ...cfgForm,
                          quotaAlerts: {
                            warningThresholdPercent: Number(e.target.value),
                            criticalThresholdPercent: cfgForm.quotaAlerts?.criticalThresholdPercent ?? 90,
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">{lang === "en" ? "High Usage Alert (%)" : "Amaran Penggunaan Tinggi (%)"}</label>
                    <input
                      type="number"
                      min={55}
                      max={99}
                      value={cfgForm.quotaAlerts?.criticalThresholdPercent ?? 90}
                      onChange={(e) =>
                        setCfgForm({
                          ...cfgForm,
                          quotaAlerts: {
                            warningThresholdPercent: cfgForm.quotaAlerts?.warningThresholdPercent ?? 80,
                            criticalThresholdPercent: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                </div>

                {/* Backup Policy (Free Local Only) */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                  <div className="font-bold text-slate-900">{lang === "en" ? "Zero-Cost Local Backup Policy" : "Polisi Sandaran Tempatan Kos Sifar"}</div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfgForm.backupPolicy.autoBackupEnabled}
                      onChange={(e) =>
                        setCfgForm({
                          ...cfgForm,
                          backupPolicy: { ...cfgForm.backupPolicy, autoBackupEnabled: e.target.checked },
                        })
                      }
                    />
                    <span>{lang === "en" ? "Local Snapshot Schedule (No Paid Cloud)" : "Jadual Snapshot Tempatan (Tiada Awan Berbayar)"}</span>
                  </label>
                  <div>
                    <label className="block text-slate-600 mb-1">{lang === "en" ? "Schedule Interval (hours)" : "Selang Jadual (jam)"}</label>
                    <input
                      type="number"
                      min={1}
                      max={168}
                      value={cfgForm.backupPolicy.scheduleIntervalHours}
                      onChange={(e) =>
                        setCfgForm({
                          ...cfgForm,
                          backupPolicy: { ...cfgForm.backupPolicy, scheduleIntervalHours: Number(e.target.value) },
                        })
                      }
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">{lang === "en" ? "Retention Count (Snapshots)" : "Bilangan Simpanan (Snapshot)"}</label>
                    <input
                      type="number"
                      min={3}
                      max={90}
                      value={cfgForm.backupPolicy.retentionCount}
                      onChange={(e) =>
                        setCfgForm({
                          ...cfgForm,
                          backupPolicy: { ...cfgForm.backupPolicy, retentionCount: Number(e.target.value) },
                        })
                      }
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={actionBusy === "save-config"}
                  className="px-4 py-2 bg-[#061830] hover:bg-[#0b3c7a] text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  {actionBusy === "save-config"
                    ? t.serverDb.saving
                    : (lang === "en" ? "Save Zero-Cost Configuration" : "Simpan Konfigurasi Kos Sifar")}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
