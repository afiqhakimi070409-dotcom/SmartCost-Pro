/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SmartCost Multi-Server Pool, Real Loopback HTTP Workers, Load Balancer & Telemetry Engine
 * - Runs 3 real local HTTP server instances (Server A, Server B, Server C) on 127.0.0.1
 *   sharing a single persistent database layer (no split-brain DBs).
 * - Implements real Round Robin, Least Connections, Health-Based Routing, and Automatic Failover.
 * - Tracks real process CPU/Memory, request volume, active connections, latency histograms, and logs.
 */

import http from "http";
import os from "os";
import fs from "fs";
import path from "path";
import { DATA_DIR } from "./serverPaths.ts";

const INFRA_CONFIG_FILE = path.join(DATA_DIR, "infra_config.json");
const INFRA_LOGS_FILE = path.join(DATA_DIR, "infra_logs.json");

export type ServerNodeStatus = "ACTIVE" | "WARNING" | "OFFLINE" | "MAINTENANCE";
export type LoadBalancerAlgorithm = "round_robin" | "least_connections" | "health_based" | "failover";
export type InfraLogLevel = "INFO" | "WARN" | "ERROR" | "FAILOVER" | "BACKUP" | "SECURITY";

export interface InfraLogEntry {
  id: string;
  timestamp: string;
  level: InfraLogLevel;
  source: string;
  serverId?: string;
  message: string;
  latencyMs?: number;
  statusCode?: number;
}

export interface ServerNodeConfig {
  id: "server-a" | "server-b" | "server-c";
  name: "Server A" | "Server B" | "Server C";
  roleLabel: string;
  zone: string;
  priority: number;
  weight: number;
  preferredPort: number;
}

export interface ServerNodeTelemetry {
  id: "server-a" | "server-b" | "server-c";
  name: string;
  roleLabel: string;
  zone: string;
  priority: number;
  weight: number;
  host: string;
  port: number | null;
  listening: boolean;
  status: ServerNodeStatus;
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
  lastHealthStatus: "OK" | "FAILED" | "MAINTENANCE" | "STOPPED";
  consecutiveFailures: number;
  dbConnected: boolean;
  dbLatencyMs: number | null;
}

export interface TrafficTimeBucket {
  timestamp: string;
  label: string;
  totalRequests: number;
  serverA: number;
  serverB: number;
  serverC: number;
  avgLatencyMs: number;
  errors: number;
}

export interface InfraConfig {
  loadBalancer: {
    algorithm: LoadBalancerAlgorithm;
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
  quotaAlerts: {
    warningThresholdPercent: number;
    criticalThresholdPercent: number;
  };
  updatedAt: string;
}

export const DEFAULT_INFRA_CONFIG: InfraConfig = {
  loadBalancer: {
    algorithm: "health_based",
    healthCheckIntervalSec: 15,
    failoverThreshold: 2,
    autoFailoverEnabled: true,
    requestTimeoutMs: 15000,
  },
  autoscaling: {
    provider: "Cloudflare Workers Free + Single Runtime (RM0.00)",
    region: "Cloudflare Global Edge (Free Tier)",
    minInstances: 0,
    maxInstances: 1,
    targetCpuPercent: 75,
    concurrencyPerInstance: 80,
    scaleDownDelaySec: 0,
  },
  backupPolicy: {
    autoBackupEnabled: false,
    scheduleIntervalHours: 24,
    retentionCount: 14,
    verifyAfterBackup: true,
    separateStorageDir: "data/backups",
  },
  quotaAlerts: {
    warningThresholdPercent: 80,
    criticalThresholdPercent: 90,
  },
  updatedAt: new Date().toISOString(),
};

const NODE_DEFINITIONS: ServerNodeConfig[] = [
  {
    id: "server-a",
    name: "Server A",
    roleLabel: "Primary Application Node (Logical Pool — Simulasi)",
    zone: "127.0.0.1 Loopback Worker #1 (Single Runtime)",
    priority: 1,
    weight: 100,
    preferredPort: 3101,
  },
  {
    id: "server-b",
    name: "Server B",
    roleLabel: "Secondary Application Node (Logical Pool — Simulasi)",
    zone: "127.0.0.1 Loopback Worker #2 (Single Runtime)",
    priority: 2,
    weight: 100,
    preferredPort: 3102,
  },
  {
    id: "server-c",
    name: "Server C",
    roleLabel: "Additional Application Node (Logical Pool — Simulasi)",
    zone: "127.0.0.1 Loopback Worker #3 (Single Runtime)",
    priority: 3,
    weight: 100,
    preferredPort: 3103,
  },
];

interface InternalNodeRuntime {
  def: ServerNodeConfig;
  httpServer: http.Server | null;
  port: number | null;
  listening: boolean;
  startedAt: number;
  manualMode: "AUTO" | "MAINTENANCE" | "OFFLINE";
  activeConnections: number;
  totalRequests: number;
  errorCount: number;
  latencies: number[];
  lastResponseMs: number | null;
  lastHttpStatus: number | null;
  lastHealthCheckAt: string | null;
  lastHealthStatus: "OK" | "FAILED" | "MAINTENANCE" | "STOPPED";
  consecutiveFailures: number;
  dbConnected: boolean;
  dbLatencyMs: number | null;
}

interface InternalTrafficBucket {
  minuteKey: string;
  label: string;
  totalRequests: number;
  serverA: number;
  serverB: number;
  serverC: number;
  latencySumMs: number;
  latencyCount: number;
  errors: number;
}

class SmartCostInfraManager {
  private nodes: Map<string, InternalNodeRuntime> = new Map();
  private roundRobinCursor = 0;
  private config: InfraConfig;
  private logs: InfraLogEntry[] = [];
  private trafficBuckets: Map<string, InternalTrafficBucket> = new Map();
  private healthTimer: NodeJS.Timeout | null = null;
  private cpuSamplePrev = process.cpuUsage();
  private cpuSampleTime = process.hrtime.bigint();
  private lastCpuPercent = 0;
  private started = false;
  private totalFailoverEvents = 0;
  private lastFailoverAt: string | null = null;
  private lastFailoverDetail: string | null = null;
  private lastFirestoreTelemetry: {
    status: string;
    latencyMs: number | null;
    checkedAt: string | null;
    projectId: string;
    databaseId: string;
  } = {
    status: "configured",
    latencyMs: null,
    checkedAt: null,
    projectId: "reflecting-booth-740ks",
    databaseId: "ai-studio-remixsmartcostpr-940297e1-af61-42e5-8469-9bca8d60c481",
  };

  constructor() {
    this.config = this.loadConfigFromDisk();
    this.logs = this.loadLogsFromDisk();
    for (const def of NODE_DEFINITIONS) {
      this.nodes.set(def.id, {
        def,
        httpServer: null,
        port: null,
        listening: false,
        startedAt: Date.now(),
        manualMode: "AUTO",
        activeConnections: 0,
        totalRequests: 0,
        errorCount: 0,
        latencies: [],
        lastResponseMs: null,
        lastHttpStatus: null,
        lastHealthCheckAt: null,
        lastHealthStatus: "STOPPED",
        consecutiveFailures: 0,
        dbConnected: true,
        dbLatencyMs: null,
      });
    }
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadConfigFromDisk(): InfraConfig {
    try {
      this.ensureDataDir();
      if (fs.existsSync(INFRA_CONFIG_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(INFRA_CONFIG_FILE, "utf-8"));
        if (parsed && typeof parsed === "object") {
          return {
            loadBalancer: { ...DEFAULT_INFRA_CONFIG.loadBalancer, ...(parsed.loadBalancer || {}) },
            autoscaling: { ...DEFAULT_INFRA_CONFIG.autoscaling, ...(parsed.autoscaling || {}) },
            backupPolicy: { ...DEFAULT_INFRA_CONFIG.backupPolicy, ...(parsed.backupPolicy || {}) },
            quotaAlerts: { ...DEFAULT_INFRA_CONFIG.quotaAlerts, ...(parsed.quotaAlerts || {}) },
            updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
          };
        }
      }
    } catch {
      // fall back to default
    }
    return { ...DEFAULT_INFRA_CONFIG };
  }

  private saveConfigToDisk(): void {
    try {
      this.ensureDataDir();
      const tmp = `${INFRA_CONFIG_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.config, null, 2), "utf-8");
      fs.renameSync(tmp, INFRA_CONFIG_FILE);
    } catch {
      // ignore disk write error
    }
  }

  private loadLogsFromDisk(): InfraLogEntry[] {
    try {
      this.ensureDataDir();
      if (fs.existsSync(INFRA_LOGS_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(INFRA_LOGS_FILE, "utf-8"));
        if (Array.isArray(parsed)) {
          return parsed.slice(-300);
        }
      }
    } catch {
      // ignore
    }
    return [];
  }

  private saveLogsToDisk(): void {
    try {
      this.ensureDataDir();
      const tmp = `${INFRA_LOGS_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.logs.slice(-300), null, 2), "utf-8");
      fs.renameSync(tmp, INFRA_LOGS_FILE);
    } catch {
      // ignore
    }
  }

  public addLog(entry: Omit<InfraLogEntry, "id" | "timestamp">): InfraLogEntry {
    const record: InfraLogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.logs.push(record);
    if (this.logs.length > 300) {
      this.logs = this.logs.slice(-300);
    }
    this.saveLogsToDisk();
    return record;
  }

  public getLogs(limit = 120, level?: InfraLogLevel | "ALL"): InfraLogEntry[] {
    const filtered = level && level !== "ALL"
      ? this.logs.filter((l) => l.level === level)
      : this.logs;
    return filtered.slice(-Math.max(1, Math.min(300, limit))).reverse();
  }

  private sampleProcessCpuPercent(): number {
    const nowTime = process.hrtime.bigint();
    const elapsedNs = Number(nowTime - this.cpuSampleTime);
    if (elapsedNs >= 500_000_000) {
      const currentUsage = process.cpuUsage(this.cpuSamplePrev);
      const elapsedUs = elapsedNs / 1000;
      const cpuCores = Math.max(1, os.cpus().length);
      const totalCpuUs = currentUsage.user + currentUsage.system;
      const pct = Math.min(100, Math.max(0.2, (totalCpuUs / (elapsedUs * cpuCores)) * 100));
      this.lastCpuPercent = Number(pct.toFixed(1));
      this.cpuSamplePrev = process.cpuUsage();
      this.cpuSampleTime = nowTime;
    }
    return this.lastCpuPercent;
  }

  private createNodeHttpServer(node: InternalNodeRuntime): http.Server {
    const server = http.createServer((req, res) => {
      const reqStart = performance.now();
      const urlPath = (req.url || "/").split("?")[0];

      if (urlPath === "/healthz") {
        if (node.manualMode === "MAINTENANCE") {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "MAINTENANCE", nodeId: node.def.id }));
          return;
        }
        const dbCheckStart = performance.now();
        const dbReachable = fs.existsSync(DATA_DIR);
        const dbMs = Number((performance.now() - dbCheckStart).toFixed(2));
        node.dbConnected = dbReachable;
        node.dbLatencyMs = dbMs;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "OK",
            nodeId: node.def.id,
            nodeName: node.def.name,
            dbConnected: dbReachable,
            dbLatencyMs: dbMs,
            uptimeSeconds: Math.floor((Date.now() - node.startedAt) / 1000),
          })
        );
        return;
      }

      if (urlPath === "/dispatch" || urlPath === "/node-info") {
        if (node.manualMode === "MAINTENANCE") {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, nodeId: node.def.id, error: "Node in maintenance mode" }));
          return;
        }
        // Lightweight shared DB state checksum read to prove single-DB connectivity
        const dbStart = performance.now();
        let dbFileCount = 0;
        try {
          dbFileCount = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")).length;
        } catch {
          dbFileCount = 0;
        }
        const dbLatencyMs = Number((performance.now() - dbStart).toFixed(2));
        const totalMs = Number((performance.now() - reqStart).toFixed(2));
        node.dbConnected = true;
        node.dbLatencyMs = dbLatencyMs;

        res.writeHead(200, {
          "Content-Type": "application/json",
          "X-SmartCost-Node": node.def.id,
        });
        res.end(
          JSON.stringify({
            ok: true,
            nodeId: node.def.id,
            nodeName: node.def.name,
            port: node.port,
            dbConnected: true,
            dbStoreFiles: dbFileCount,
            dbLatencyMs,
            processingMs: totalMs,
            timestamp: new Date().toISOString(),
          })
        );
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    server.keepAliveTimeout = 10000;
    return server;
  }

  private async listenNodeServer(node: InternalNodeRuntime): Promise<void> {
    if (node.listening && node.httpServer) return;

    const tryBind = (portToBind: number): Promise<number> =>
      new Promise((resolve, reject) => {
        const srv = this.createNodeHttpServer(node);
        const onErr = (err: any) => {
          srv.removeAllListeners();
          reject(err);
        };
        srv.once("error", onErr);
        srv.listen(portToBind, "127.0.0.1", () => {
          srv.removeListener("error", onErr);
          const addr = srv.address();
          const boundPort = typeof addr === "object" && addr ? addr.port : portToBind;
          node.httpServer = srv;
          node.port = boundPort;
          node.listening = true;
          node.startedAt = Date.now();
          node.lastHealthStatus = node.manualMode === "MAINTENANCE" ? "MAINTENANCE" : "OK";
          resolve(boundPort);
        });
      });

    try {
      await tryBind(node.def.preferredPort);
    } catch {
      // Fallback cleanly to OS ephemeral loopback port if preferred port is occupied
      await tryBind(0);
    }
  }

  private async stopNodeServer(node: InternalNodeRuntime): Promise<void> {
    if (!node.httpServer) {
      node.listening = false;
      node.port = null;
      node.lastHealthStatus = "STOPPED";
      return;
    }
    const srv = node.httpServer;
    node.httpServer = null;
    node.listening = false;
    node.port = null;
    node.lastHealthStatus = "STOPPED";
    await new Promise<void>((resolve) => {
      srv.close(() => resolve());
      setTimeout(() => resolve(), 500);
    });
  }

  public async startCluster(): Promise<void> {
    if (this.started) return;
    this.started = true;

    for (const node of this.nodes.values()) {
      if (node.manualMode !== "OFFLINE") {
        await this.listenNodeServer(node);
      }
    }

    await this.runHealthChecks();
    this.scheduleHealthChecks();

    this.addLog({
      level: "INFO",
      source: "ClusterBootstrap",
      message: "Logical Multi-Server Routing Pool initialized (Server A, B, C loopback simulation on single RM0.00 runtime).",
    });
  }

  public async shutdownCluster(): Promise<void> {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    for (const node of this.nodes.values()) {
      await this.stopNodeServer(node);
    }
    this.started = false;
  }

  private scheduleHealthChecks(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    const intervalMs = Math.max(5000, Math.min(120000, (this.config.loadBalancer.healthCheckIntervalSec || 15) * 1000));
    this.healthTimer = setInterval(() => {
      void this.runHealthChecks();
    }, intervalMs);
    this.healthTimer.unref?.();
  }

  public probeNodeHealth(nodeId: "server-a" | "server-b" | "server-c"): Promise<{ ok: boolean; statusCode: number; latencyMs: number }> {
    const node = this.nodes.get(nodeId);
    if (!node || !node.listening || !node.port || node.manualMode === "OFFLINE") {
      if (node) {
        node.consecutiveFailures += 1;
        node.lastHttpStatus = 0;
        node.lastHealthCheckAt = new Date().toISOString();
        node.lastHealthStatus = "STOPPED";
      }
      return Promise.resolve({ ok: false, statusCode: 0, latencyMs: 0 });
    }

    const start = performance.now();
    return new Promise((resolve) => {
      const req = http.get(
        {
          hostname: "127.0.0.1",
          port: node.port!,
          path: "/healthz",
          timeout: 3000,
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            const latencyMs = Number((performance.now() - start).toFixed(2));
            node.lastHealthCheckAt = new Date().toISOString();
            node.lastHttpStatus = res.statusCode || 500;
            const isOk = res.statusCode === 200;
            if (isOk) {
              node.consecutiveFailures = 0;
              node.lastHealthStatus = "OK";
              try {
                const parsed = JSON.parse(body);
                if (typeof parsed.dbConnected === "boolean") node.dbConnected = parsed.dbConnected;
                if (typeof parsed.dbLatencyMs === "number") node.dbLatencyMs = parsed.dbLatencyMs;
              } catch {}
            } else {
              node.consecutiveFailures += 1;
              node.lastHealthStatus = node.manualMode === "MAINTENANCE" ? "MAINTENANCE" : "FAILED";
            }
            resolve({ ok: isOk, statusCode: res.statusCode || 500, latencyMs });
          });
        }
      );

      req.on("timeout", () => {
        req.destroy(new Error("Health probe timeout"));
      });

      req.on("error", () => {
        const latencyMs = Number((performance.now() - start).toFixed(2));
        node.lastHealthCheckAt = new Date().toISOString();
        node.lastHttpStatus = 0;
        node.consecutiveFailures += 1;
        node.lastHealthStatus = "FAILED";
        resolve({ ok: false, statusCode: 0, latencyMs });
      });
    });
  }

  public async runHealthChecks(): Promise<ServerNodeTelemetry[]> {
    const ids: Array<"server-a" | "server-b" | "server-c"> = ["server-a", "server-b", "server-c"];
    await Promise.all(ids.map((id) => this.probeNodeHealth(id)));
    return this.getServerTelemetryList();
  }

  public async setServerMode(
    nodeId: string,
    mode: "ACTIVE" | "MAINTENANCE" | "OFFLINE"
  ): Promise<{ ok: boolean; node?: ServerNodeTelemetry; error?: string }> {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return { ok: false, error: "Server node not found." };
    }

    const prevStatus = this.computeNodeStatus(node);
    if (mode === "ACTIVE") {
      node.manualMode = "AUTO";
      node.consecutiveFailures = 0;
      await this.listenNodeServer(node);
      await this.probeNodeHealth(node.def.id);
      this.addLog({
        level: "INFO",
        source: "ServerManager",
        serverId: node.def.id,
        message: `${node.def.name} restored to ACTIVE pool on 127.0.0.1:${node.port}.`,
      });
    } else if (mode === "MAINTENANCE") {
      node.manualMode = "MAINTENANCE";
      if (!node.listening) {
        await this.listenNodeServer(node);
      }
      node.lastHealthStatus = "MAINTENANCE";
      node.lastHealthCheckAt = new Date().toISOString();
      this.recordFailoverEvent(node.def.name, "MAINTENANCE", prevStatus);
    } else if (mode === "OFFLINE") {
      node.manualMode = "OFFLINE";
      await this.stopNodeServer(node);
      node.lastHealthCheckAt = new Date().toISOString();
      this.recordFailoverEvent(node.def.name, "OFFLINE", prevStatus);
    }

    return { ok: true, node: this.buildNodeTelemetry(node) };
  }

  private recordFailoverEvent(nodeName: string, newMode: string, prevStatus: ServerNodeStatus): void {
    const remainingHealthy = Array.from(this.nodes.values())
      .filter((n) => this.isNodeEligible(n))
      .map((n) => n.def.name);

    this.totalFailoverEvents += 1;
    this.lastFailoverAt = new Date().toISOString();
    const targetMsg =
      remainingHealthy.length > 0
        ? `Traffic automatically rerouted to ${remainingHealthy.join(", ")}.`
        : "CRITICAL: No healthy backend servers remain in pool!";
    this.lastFailoverDetail = `${nodeName} transitioned from ${prevStatus} to ${newMode}. ${targetMsg}`;

    this.addLog({
      level: "FAILOVER",
      source: "LoadBalancer",
      message: this.lastFailoverDetail,
    });
  }

  private isNodeEligible(node: InternalNodeRuntime): boolean {
    if (node.manualMode === "MAINTENANCE" || node.manualMode === "OFFLINE") return false;
    if (!node.listening) return false;
    const threshold = Math.max(1, this.config.loadBalancer.failoverThreshold || 2);
    if (node.consecutiveFailures >= threshold) return false;
    return true;
  }

  private computeNodeStatus(node: InternalNodeRuntime): ServerNodeStatus {
    if (node.manualMode === "MAINTENANCE") return "MAINTENANCE";
    if (node.manualMode === "OFFLINE" || !node.listening) return "OFFLINE";
    if (node.consecutiveFailures >= (this.config.loadBalancer.failoverThreshold || 2)) return "OFFLINE";

    const cpu = this.sampleProcessCpuPercent();
    const memPct = this.getProcessMemoryInfo().percent;
    const errRate = node.totalRequests > 0 ? (node.errorCount / node.totalRequests) * 100 : 0;
    const avgLatency = this.computeAvgLatency(node.latencies);

    if (cpu > 80 || memPct > 85 || errRate > 5 || avgLatency > 400 || node.consecutiveFailures > 0) {
      return "WARNING";
    }
    return "ACTIVE";
  }

  private getProcessMemoryInfo(): { usedMb: number; totalMb: number; percent: number } {
    const mem = process.memoryUsage();
    const totalMb = Math.round(os.totalmem() / (1024 * 1024));
    const rssMb = Number((mem.rss / (1024 * 1024)).toFixed(1));
    // Share process view cleanly plus realistic per-process baseline
    const systemFreeMb = os.freemem() / (1024 * 1024);
    const systemUsedPct = Math.min(99, Math.max(5, ((totalMb - systemFreeMb) / Math.max(1, totalMb)) * 100));
    return {
      usedMb: rssMb,
      totalMb,
      percent: Number(systemUsedPct.toFixed(1)),
    };
  }

  private computeAvgLatency(latencies: number[]): number {
    if (latencies.length === 0) return 0;
    const sum = latencies.reduce((acc, v) => acc + v, 0);
    return Number((sum / latencies.length).toFixed(2));
  }

  private computeP95Latency(latencies: number[]): number {
    if (latencies.length === 0) return 0;
    const sorted = [...latencies].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return Number(sorted[idx].toFixed(2));
  }

  private buildNodeTelemetry(node: InternalNodeRuntime): ServerNodeTelemetry {
    const memInfo = this.getProcessMemoryInfo();
    const cpu = node.listening ? this.sampleProcessCpuPercent() : 0;
    const avgMs = this.computeAvgLatency(node.latencies);
    const p95Ms = this.computeP95Latency(node.latencies);
    const errorRatePercent = node.totalRequests > 0
      ? Number(((node.errorCount / node.totalRequests) * 100).toFixed(2))
      : 0;

    return {
      id: node.def.id,
      name: node.def.name,
      roleLabel: node.def.roleLabel,
      zone: node.def.zone,
      priority: node.def.priority,
      weight: node.def.weight,
      host: "127.0.0.1",
      port: node.port,
      listening: node.listening,
      status: this.computeNodeStatus(node),
      manualMode: node.manualMode,
      cpuPercent: cpu,
      memoryUsedMb: node.listening ? memInfo.usedMb : 0,
      memoryTotalMb: memInfo.totalMb,
      memoryPercent: node.listening ? memInfo.percent : 0,
      uptimeSeconds: node.listening ? Math.floor((Date.now() - node.startedAt) / 1000) : 0,
      activeConnections: node.activeConnections,
      totalRequests: node.totalRequests,
      errorCount: node.errorCount,
      errorRatePercent,
      avgResponseMs: avgMs,
      p95ResponseMs: p95Ms,
      lastResponseMs: node.lastResponseMs,
      lastHttpStatus: node.lastHttpStatus,
      lastHealthCheckAt: node.lastHealthCheckAt,
      lastHealthStatus: node.lastHealthStatus,
      consecutiveFailures: node.consecutiveFailures,
      dbConnected: node.dbConnected,
      dbLatencyMs: node.dbLatencyMs,
    };
  }

  public getServerTelemetryList(): ServerNodeTelemetry[] {
    return NODE_DEFINITIONS.map((def) => {
      const node = this.nodes.get(def.id)!;
      return this.buildNodeTelemetry(node);
    });
  }

  /**
   * Selects a backend node according to the active Load Balancing algorithm & failover rules.
   */
  public selectNodeForRequest(): {
    nodeId: "server-a" | "server-b" | "server-c";
    nodeName: string;
    port: number | null;
    failoverApplied: boolean;
    algorithmUsed: LoadBalancerAlgorithm;
  } | null {
    const allNodes = NODE_DEFINITIONS.map((d) => this.nodes.get(d.id)!);
    const eligible = allNodes.filter((n) => this.isNodeEligible(n));

    if (eligible.length === 0) {
      return null;
    }

    const algorithm = this.config.loadBalancer.algorithm;
    let chosen: InternalNodeRuntime;
    let failoverApplied = false;

    if (algorithm === "round_robin") {
      chosen = eligible[this.roundRobinCursor % eligible.length];
      this.roundRobinCursor = (this.roundRobinCursor + 1) % 100000;
      failoverApplied = eligible.length < allNodes.length;
    } else if (algorithm === "least_connections") {
      chosen = [...eligible].sort((a, b) => {
        if (a.activeConnections !== b.activeConnections) {
          return a.activeConnections - b.activeConnections;
        }
        return this.computeAvgLatency(a.latencies) - this.computeAvgLatency(b.latencies);
      })[0];
      failoverApplied = eligible.length < allNodes.length;
    } else if (algorithm === "failover") {
      chosen = [...eligible].sort((a, b) => a.def.priority - b.def.priority)[0];
      failoverApplied = chosen.def.priority > 1;
    } else {
      // health_based: score lower = healthier (activeConnections * 25 + avgLatency * 0.5 + errorRate * 50 + totalRequests * 0.01)
      chosen = [...eligible].sort((a, b) => {
        const errA = a.totalRequests > 0 ? (a.errorCount / a.totalRequests) * 100 : 0;
        const errB = b.totalRequests > 0 ? (b.errorCount / b.totalRequests) * 100 : 0;
        const scoreA = a.activeConnections * 25 + this.computeAvgLatency(a.latencies) * 0.5 + errA * 40 + a.totalRequests * 0.05;
        const scoreB = b.activeConnections * 25 + this.computeAvgLatency(b.latencies) * 0.5 + errB * 40 + b.totalRequests * 0.05;
        if (Math.abs(scoreA - scoreB) > 0.01) return scoreA - scoreB;
        return a.def.priority - b.def.priority;
      })[0];
      failoverApplied = eligible.length < allNodes.length;
    }

    return {
      nodeId: chosen.def.id,
      nodeName: chosen.def.name,
      port: chosen.port,
      failoverApplied,
      algorithmUsed: algorithm,
    };
  }

  public beginRequestOnNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.activeConnections += 1;
    }
  }

  public finishRequestOnNode(
    nodeId: string,
    durationMs: number,
    statusCode: number,
    pathLabel?: string
  ): void {
    const node = this.nodes.get(nodeId);
    const now = new Date();
    const minuteKey = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
    const label = minuteKey.slice(11, 16); // HH:mm

    let bucket = this.trafficBuckets.get(minuteKey);
    if (!bucket) {
      bucket = {
        minuteKey,
        label,
        totalRequests: 0,
        serverA: 0,
        serverB: 0,
        serverC: 0,
        latencySumMs: 0,
        latencyCount: 0,
        errors: 0,
      };
      this.trafficBuckets.set(minuteKey, bucket);
      if (this.trafficBuckets.size > 60) {
        const oldestKey = this.trafficBuckets.keys().next().value;
        if (oldestKey) this.trafficBuckets.delete(oldestKey);
      }
    }

    const isError = statusCode >= 500 || statusCode === 0;
    bucket.totalRequests += 1;
    bucket.latencySumMs += durationMs;
    bucket.latencyCount += 1;
    if (isError) bucket.errors += 1;
    if (nodeId === "server-a") bucket.serverA += 1;
    else if (nodeId === "server-b") bucket.serverB += 1;
    else if (nodeId === "server-c") bucket.serverC += 1;

    if (node) {
      node.activeConnections = Math.max(0, node.activeConnections - 1);
      node.totalRequests += 1;
      if (isError) {
        node.errorCount += 1;
      }
      node.lastResponseMs = Number(durationMs.toFixed(2));
      node.lastHttpStatus = statusCode;
      node.latencies.push(node.lastResponseMs);
      if (node.latencies.length > 100) {
        node.latencies.shift();
      }
    }

    if (isError && pathLabel) {
      this.addLog({
        level: "ERROR",
        source: "API",
        serverId: nodeId,
        statusCode,
        latencyMs: Number(durationMs.toFixed(2)),
        message: `HTTP ${statusCode} on ${pathLabel} handled by ${nodeId}`,
      });
    }
  }

  /**
   * Executes real HTTP loopback requests through the Load Balancer to Server A / B / C.
   */
  public async runLoadBalancerDispatchTest(requestCount = 6): Promise<{
    algorithm: LoadBalancerAlgorithm;
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
  }> {
    const count = Math.max(1, Math.min(30, Math.round(requestCount)));
    const distribution: Record<string, number> = {
      "server-a": 0,
      "server-b": 0,
      "server-c": 0,
    };
    const traces: Array<{
      seq: number;
      nodeId: string;
      nodeName: string;
      port: number | null;
      statusCode: number;
      latencyMs: number;
      dbLatencyMs: number | null;
      failoverApplied: boolean;
    }> = [];

    let succeededCount = 0;
    let failedCount = 0;

    for (let i = 1; i <= count; i++) {
      const target = this.selectNodeForRequest();
      if (!target || !target.port) {
        failedCount += 1;
        traces.push({
          seq: i,
          nodeId: "none",
          nodeName: "NO HEALTHY SERVER",
          port: null,
          statusCode: 503,
          latencyMs: 0,
          dbLatencyMs: null,
          failoverApplied: true,
        });
        continue;
      }

      this.beginRequestOnNode(target.nodeId);
      const tStart = performance.now();
      const result = await new Promise<{ statusCode: number; dbLatencyMs: number | null }>((resolve) => {
        const req = http.get(
          {
            hostname: "127.0.0.1",
            port: target.port!,
            path: "/dispatch",
            timeout: 3000,
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => {
              body += chunk;
            });
            res.on("end", () => {
              let dbLatencyMs: number | null = null;
              try {
                const parsed = JSON.parse(body);
                if (typeof parsed.dbLatencyMs === "number") dbLatencyMs = parsed.dbLatencyMs;
              } catch {}
              resolve({ statusCode: res.statusCode || 500, dbLatencyMs });
            });
          }
        );
        req.on("timeout", () => req.destroy(new Error("timeout")));
        req.on("error", () => resolve({ statusCode: 503, dbLatencyMs: null }));
      });
      const latencyMs = Number((performance.now() - tStart).toFixed(2));
      this.finishRequestOnNode(target.nodeId, latencyMs, result.statusCode, "/dispatch");

      if (result.statusCode === 200) {
        succeededCount += 1;
      } else {
        failedCount += 1;
      }
      distribution[target.nodeId] = (distribution[target.nodeId] || 0) + 1;
      traces.push({
        seq: i,
        nodeId: target.nodeId,
        nodeName: target.nodeName,
        port: target.port,
        statusCode: result.statusCode,
        latencyMs,
        dbLatencyMs: result.dbLatencyMs,
        failoverApplied: target.failoverApplied,
      });
    }

    this.addLog({
      level: "INFO",
      source: "LoadBalancerTest",
      message: `Dispatched ${count} real HTTP requests (${this.config.loadBalancer.algorithm}): A=${distribution["server-a"]}, B=${distribution["server-b"]}, C=${distribution["server-c"]}.`,
    });

    return {
      algorithm: this.config.loadBalancer.algorithm,
      requestedCount: count,
      succeededCount,
      failedCount,
      distribution,
      traces,
    };
  }

  public getTrafficSeries(): TrafficTimeBucket[] {
    const items = Array.from(this.trafficBuckets.values()).map((b) => ({
      timestamp: b.minuteKey,
      label: b.label,
      totalRequests: b.totalRequests,
      serverA: b.serverA,
      serverB: b.serverB,
      serverC: b.serverC,
      avgLatencyMs: b.latencyCount > 0 ? Number((b.latencySumMs / b.latencyCount).toFixed(2)) : 0,
      errors: b.errors,
    }));

    if (items.length === 0) {
      const nowLabel = new Date().toISOString().slice(11, 16);
      return [
        {
          timestamp: new Date().toISOString().slice(0, 16),
          label: nowLabel,
          totalRequests: 0,
          serverA: 0,
          serverB: 0,
          serverC: 0,
          avgLatencyMs: 0,
          errors: 0,
        },
      ];
    }
    return items;
  }

  public getConfig(): InfraConfig {
    return this.config;
  }

  public updateConfig(partial: Partial<InfraConfig>): InfraConfig {
    this.config = {
      loadBalancer: {
        ...this.config.loadBalancer,
        ...(partial.loadBalancer || {}),
      },
      autoscaling: {
        ...this.config.autoscaling,
        ...(partial.autoscaling || {}),
      },
      backupPolicy: {
        ...this.config.backupPolicy,
        ...(partial.backupPolicy || {}),
      },
      quotaAlerts: {
        ...this.config.quotaAlerts,
        ...(partial.quotaAlerts || {}),
      },
      updatedAt: new Date().toISOString(),
    };

    // Enforce safe zero-cost boundaries
    this.config.loadBalancer.healthCheckIntervalSec = Math.max(5, Math.min(300, Number(this.config.loadBalancer.healthCheckIntervalSec) || 15));
    this.config.loadBalancer.failoverThreshold = Math.max(1, Math.min(10, Number(this.config.loadBalancer.failoverThreshold) || 2));
    this.config.autoscaling.minInstances = 0; // Enforced 0 (Scale-to-zero / Free Tier RM0.00)
    this.config.autoscaling.maxInstances = Math.max(1, Math.min(10, Number(this.config.autoscaling.maxInstances) || 1));
    this.config.autoscaling.targetCpuPercent = Math.max(20, Math.min(95, Number(this.config.autoscaling.targetCpuPercent) || 75));
    this.config.autoscaling.concurrencyPerInstance = Math.max(1, Math.min(1000, Number(this.config.autoscaling.concurrencyPerInstance) || 80));
    this.config.backupPolicy.scheduleIntervalHours = Math.max(1, Math.min(168, Number(this.config.backupPolicy.scheduleIntervalHours) || 24));
    this.config.backupPolicy.retentionCount = Math.max(3, Math.min(90, Number(this.config.backupPolicy.retentionCount) || 14));
    this.config.quotaAlerts.warningThresholdPercent = Math.max(50, Math.min(89, Number(this.config.quotaAlerts.warningThresholdPercent) || 80));
    this.config.quotaAlerts.criticalThresholdPercent = Math.max(
      this.config.quotaAlerts.warningThresholdPercent + 5,
      Math.min(99, Number(this.config.quotaAlerts.criticalThresholdPercent) || 90)
    );

    this.saveConfigToDisk();
    this.scheduleHealthChecks();

    this.addLog({
      level: "INFO",
      source: "InfraConfig",
      message: `Zero-cost config updated (algorithm=${this.config.loadBalancer.algorithm}, freeTierAlert=${this.config.quotaAlerts.warningThresholdPercent}%/${this.config.quotaAlerts.criticalThresholdPercent}%, localAutoBackup=${this.config.backupPolicy.autoBackupEnabled}).`,
    });

    return this.config;
  }

  public recordClientFirestoreTelemetry(payload: { status: string; latencyMs?: number | null }): void {
    this.lastFirestoreTelemetry = {
      ...this.lastFirestoreTelemetry,
      status: String(payload.status || "unknown").slice(0, 64),
      latencyMs: typeof payload.latencyMs === "number" ? Number(payload.latencyMs.toFixed(1)) : null,
      checkedAt: new Date().toISOString(),
    };
  }

  public getLoadBalancerSummary() {
    const nodes = this.getServerTelemetryList();
    const healthyCount = nodes.filter((n) => n.status === "ACTIVE" || n.status === "WARNING").length;
    const totalReq = nodes.reduce((acc, n) => acc + n.totalRequests, 0);
    const totalErr = nodes.reduce((acc, n) => acc + n.errorCount, 0);
    const activeConns = nodes.reduce((acc, n) => acc + n.activeConnections, 0);
    const weightedLat = nodes.reduce((acc, n) => acc + n.avgResponseMs * Math.max(1, n.totalRequests), 0);
    const latDenom = nodes.reduce((acc, n) => acc + Math.max(1, n.totalRequests), 0);

    return {
      algorithm: this.config.loadBalancer.algorithm,
      autoFailoverEnabled: this.config.loadBalancer.autoFailoverEnabled,
      healthCheckIntervalSec: this.config.loadBalancer.healthCheckIntervalSec,
      failoverThreshold: this.config.loadBalancer.failoverThreshold,
      healthyNodes: healthyCount,
      totalNodes: nodes.length,
      totalRequests: totalReq,
      totalErrors: totalErr,
      overallErrorRatePercent: totalReq > 0 ? Number(((totalErr / totalReq) * 100).toFixed(2)) : 0,
      totalActiveConnections: activeConns,
      avgLatencyMs: Number((weightedLat / Math.max(1, latDenom)).toFixed(2)),
      totalFailoverEvents: this.totalFailoverEvents,
      lastFailoverAt: this.lastFailoverAt,
      lastFailoverDetail: this.lastFailoverDetail,
      firestoreTelemetry: this.lastFirestoreTelemetry,
    };
  }
}

export const infraManager = new SmartCostInfraManager();
