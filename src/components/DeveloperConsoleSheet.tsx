/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import {
  Terminal,
  Building2,
  ShieldCheck,
  Lock,
  Sliders,
  Download,
  Upload,
  UserCheck,
  FileJson,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  FileText,
  Check,
  X,
  Info,
  Clock,
  Database,
  Archive,
  ArrowRight,
  ShieldAlert,
  Layers,
  Sparkles,
  Search,
  Eye,
  Edit3,
  ArchiveRestore,
  Trash2,
  Server
} from "lucide-react";
import { KonfigurasiSistem, UserRole, ROLE_DEFINITIONS } from "../types";
import { TemplatPerniagaan } from "../data/defaultTemplates";
import { Language, getStoredLanguage } from "../utils/i18n";
import {
  validateBackupContent,
  executeTemplatesImport,
  generateBackupFileName,
  sanitizeConfigForBackup,
  BackupValidationResult,
  BackupAuditLogEntry,
  ImportMode,
  BACKUP_FORMAT_VERSION,
  BACKUP_SCHEMA_VERSION,
} from "../utils/adminBackup";
import { getAuthFetchHeaders, saveServerSessionToken } from "../utils/authSessionClient";
import { deleteCompanyFromFirestore } from "../utils/firestoreSync";
import DeveloperAuthModal from "./DeveloperAuthModal";
import ServerDatabaseManagement from "./ServerDatabaseManagement";
import { apiUrl } from "../utils/apiBase";
import { validateAndReadJsonFile } from "../utils/fileUploadSecurity";

interface DeveloperConsoleSheetProps {
  currentRole: UserRole;
  onSwitchRole: (newRole: UserRole) => void;
  config: KonfigurasiSistem;
  onUpdateConfig: (cfg: KonfigurasiSistem) => void;
  templates: TemplatPerniagaan[];
  onOpenDatabaseModal: () => void;
  onOpenAccessMatrixModal: () => void;
  systemLang?: Language;
  currentUser?: {
    id?: string;
    username?: string;
    fullName?: string;
    companyName?: string;
    role?: UserRole;
    email?: string;
    dbKey?: string;
  } | null;
  activeLoadedDbKey?: string;
  isRealDeveloperSuperuser?: boolean;
  onUpdateTemplates?: (tpls: TemplatPerniagaan[]) => void;
  onDatabaseDeleted?: (deletedDbKey: string, nextActiveDbKey?: string, recreatedDbKey?: string) => void;
  initialTab?: "databases" | "simulator" | "backup" | "infra";
}

export default function DeveloperConsoleSheet({
  currentRole,
  onSwitchRole,
  config,
  templates = [],
  onOpenDatabaseModal,
  onOpenAccessMatrixModal,
  systemLang,
  currentUser,
  activeLoadedDbKey,
  isRealDeveloperSuperuser = false,
  onUpdateTemplates,
  onDatabaseDeleted,
  initialTab,
}: DeveloperConsoleSheetProps) {
  const lang: Language = systemLang || getStoredLanguage();
  const [activeConsoleTab, setActiveConsoleTab] = useState<"databases" | "simulator" | "backup" | "infra">(initialTab || "databases");

  useEffect(() => {
    if (initialTab) {
      setActiveConsoleTab(initialTab);
    }
  }, [initialTab]);

  // Database Management State (Developer Console)
  type ConsoleDbItem = {
    companyName: string;
    dbKey: string;
    updatedAt: string;
    productCount: number;
    owner: string;
    isSandbox?: boolean;
    isArchived?: boolean;
    isDisconnected?: boolean;
    activeSessionCount?: number;
    isActiveInSession?: boolean;
    isDefault?: boolean;
    category?: "business_database" | "system_infrastructure";
    isSystemInfrastructure?: boolean;
    isDefaultBusinessDb?: boolean;
    classificationLabelMs?: string;
    classificationLabelEn?: string;
  };
  const [dbList, setDbList] = useState<ConsoleDbItem[]>([]);
  const [dbSearch, setDbSearch] = useState("");
  const [dbFeedback, setDbFeedback] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);
  const [deleteTargetDb, setDeleteTargetDb] = useState<ConsoleDbItem | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [deletePadamInput, setDeletePadamInput] = useState("");
  const [confirmActiveChecked, setConfirmActiveChecked] = useState(false);
  const [deleteDialogFeedback, setDeleteDialogFeedback] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);
  const [isDeletingDb, setIsDeletingDb] = useState(false);
  const [reauthModalOpen, setReauthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<"reauth" | "refresh">("refresh");
  const [pendingConsoleDelete, setPendingConsoleDelete] = useState<{
    target: ConsoleDbItem;
    confirmName: string;
    padamWord: string;
    confirmActiveDatabase: boolean;
    dbStatus: string;
  } | null>(null);
  const [renameTargetDb, setRenameTargetDb] = useState<{ companyName: string; dbKey: string } | null>(null);
  const [renameInputVal, setRenameInputVal] = useState("");

  const isSystemInfrastructureDb = (comp: {
    dbKey: string;
    isSandbox?: boolean;
    isSystemInfrastructure?: boolean;
  }) => {
    const k = (comp.dbKey || "").trim().toLowerCase();
    return (
      Boolean(comp.isSystemInfrastructure) ||
      Boolean(comp.isSandbox) ||
      k === "pengekosan_dev_sandbox_db" ||
      k === "firebase_auth_infra" ||
      k.startsWith("__system__") ||
      k.startsWith("system_config_") ||
      k.startsWith("auth_infra_") ||
      k.startsWith("global_config_")
    );
  };

  const isDefaultBusinessDb = (comp: {
    dbKey: string;
    companyName: string;
    isSandbox?: boolean;
    isSystemInfrastructure?: boolean;
    isDefaultBusinessDb?: boolean;
    isDefault?: boolean;
  }) => {
    if (isSystemInfrastructureDb(comp)) return false;
    const k = (comp.dbKey || "").trim().toLowerCase();
    const n = (comp.companyName || "").trim().toUpperCase();
    return (
      Boolean(comp.isDefaultBusinessDb) ||
      Boolean(comp.isDefault) ||
      k.endsWith("-default") ||
      k.endsWith("_admin_default") ||
      k === "pengekosan_company_db_school_enterprise" ||
      k.startsWith("pengekosan_company_db_school_enterprise_default") ||
      n === "SCHOOL ENTERPRISE"
    );
  };

  const loadAllDatabases = async (): Promise<ConsoleDbItem[]> => {
    if (!isRealDeveloperSuperuser) {
      setDbList([]);
      return [];
    }
    const list: ConsoleDbItem[] = [];
    const seen = new Set<string>();

    let archivedKeys: string[] = [];
    try {
      const rawArchived = localStorage.getItem("smartcost_archived_databases");
      if (rawArchived) archivedKeys = JSON.parse(rawArchived);
    } catch {}

    // Developer sandbox
    seen.add("pengekosan_dev_sandbox_db");
    const rawSandbox = localStorage.getItem("pengekosan_dev_sandbox_db");
    let pCount = 1;
    let updAt = new Date().toISOString();
    if (rawSandbox) {
      try {
        const p = JSON.parse(rawSandbox);
        pCount = Array.isArray(p.templates) ? p.templates.length : 1;
        updAt = p.updatedAt || updAt;
      } catch {}
    }
    list.push({
      companyName: lang === "en" ? "DEVELOPER SANDBOX (DEV WORKSPACE)" : "SANDBOX PEMBANGUN (DEV WORKSPACE)",
      dbKey: "pengekosan_dev_sandbox_db",
      updatedAt: updAt,
      productCount: pCount,
      owner: "developer (root)",
      isSandbox: true,
      isArchived: archivedKeys.includes("pengekosan_dev_sandbox_db"),
    });

    // Scan localStorage
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (
          key &&
          !key.endsWith("_templates") &&
          (key.startsWith("pengekosan_company_db_") || key.startsWith("pengekosan_userdb_"))
        ) {
          if (seen.has(key)) continue;
          seen.add(key);
          const raw = localStorage.getItem(key);
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              list.push({
                companyName: parsed.config?.namaSyarikat || parsed.companyName || key.replace("pengekosan_company_db_", "").toUpperCase(),
                dbKey: key,
                updatedAt: parsed.updatedAt || new Date().toISOString(),
                productCount: Array.isArray(parsed.templates) ? parsed.templates.length : 1,
                owner: parsed.ownerUsername || parsed.config?.usernameLogMasuk || "admin",
                isSandbox: false,
                isArchived: archivedKeys.includes(key),
              });
            } catch {}
          }
        }
      }
    } catch {}

    if (isRealDeveloperSuperuser) {
      try {
        const headers = await getAuthFetchHeaders();
        const resp = await fetch(apiUrl("/api/databases/list"), { credentials: "same-origin", headers });
        if (resp.ok) {
          const data = await resp.json().catch(() => null);
          const deletedSet = new Set<string>(
            Array.isArray(data?.deletedDbKeys) ? data.deletedDbKeys : []
          );
          if (deletedSet.size > 0) {
            for (const delKey of deletedSet) {
              try {
                localStorage.removeItem(delKey);
              } catch {}
            }
            for (let idx = list.length - 1; idx >= 0; idx--) {
              if (deletedSet.has(list[idx].dbKey)) {
                list.splice(idx, 1);
              }
            }
          }
          const serverDbs = Array.isArray(data?.databases) ? data.databases : [];
          for (const rec of serverDbs) {
            if (!rec?.databaseId) continue;
            const existingIdx = list.findIndex((item) => item.dbKey === rec.databaseId);
            if (existingIdx >= 0) {
              list[existingIdx] = {
                ...list[existingIdx],
                activeSessionCount: rec.activeSessionCount || 0,
                isActiveInSession: Boolean(rec.isActiveInSession),
                isDefault: Boolean(rec.isDefault),
                category: rec.category,
                isSystemInfrastructure: Boolean(rec.isSystemInfrastructure),
                isDefaultBusinessDb: Boolean(rec.isDefaultBusinessDb),
                classificationLabelMs: rec.classificationLabelMs,
                classificationLabelEn: rec.classificationLabelEn,
                owner: list[existingIdx].owner || rec.ownerUsername || "admin",
              };
            } else {
              seen.add(rec.databaseId);
              list.push({
                companyName: rec.companyName || rec.databaseId,
                dbKey: rec.databaseId,
                updatedAt: rec.createdAt || new Date().toISOString(),
                productCount: 0,
                owner: rec.ownerUsername || "admin",
                isSandbox: Boolean(rec.isSandbox),
                isArchived: archivedKeys.includes(rec.databaseId),
                isDisconnected: !rec.isSandbox,
                activeSessionCount: rec.activeSessionCount || 0,
                isActiveInSession: Boolean(rec.isActiveInSession),
                isDefault: Boolean(rec.isDefault),
                category: rec.category,
                isSystemInfrastructure: Boolean(rec.isSystemInfrastructure),
                isDefaultBusinessDb: Boolean(rec.isDefaultBusinessDb),
                classificationLabelMs: rec.classificationLabelMs,
                classificationLabelEn: rec.classificationLabelEn,
              });
            }
          }
        }
      } catch {}
    }

    setDbList(list);
    return list;
  };

  useEffect(() => {
    loadAllDatabases();
  }, [currentRole, isRealDeveloperSuperuser]);

  const handleArchiveDb = (dbKey: string, compName: string, isArchived: boolean) => {
    let archived: string[] = [];
    try {
      const raw = localStorage.getItem("smartcost_archived_databases");
      if (raw) archived = JSON.parse(raw);
    } catch {}

    const updated = isArchived ? archived.filter(k => k !== dbKey) : [...archived, dbKey];
    try {
      localStorage.setItem("smartcost_archived_databases", JSON.stringify(updated));
    } catch {}

    setDbFeedback({
      type: "info",
      msg: isArchived
        ? (lang === "en" ? `Database '${compName}' restored from archive.` : `Pangkalan data '${compName}' dipulihkan dari arkib.`)
        : (lang === "en" ? `Database '${compName}' moved to archive.` : `Pangkalan data '${compName}' diarkibkan.`),
    });
    loadAllDatabases();
  };

  const handleRenameDbSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTargetDb) return;
    const newName = renameInputVal.trim();
    if (!newName) return;

    try {
      const raw = localStorage.getItem(renameTargetDb.dbKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        parsed.companyName = newName;
        if (parsed.config) parsed.config.namaSyarikat = newName;
        parsed.updatedAt = new Date().toISOString();
        localStorage.setItem(renameTargetDb.dbKey, JSON.stringify(parsed));
      }

      try {
        const regRaw = localStorage.getItem("pengekosan_registered_users");
        if (regRaw) {
          const users = JSON.parse(regRaw);
          const updatedUsers = users.map((u: any) => {
            if (u.dbKey === renameTargetDb.dbKey || u.companyName === renameTargetDb.companyName) {
              return { ...u, companyName: newName };
            }
            return u;
          });
          localStorage.setItem("pengekosan_registered_users", JSON.stringify(updatedUsers));
        }
      } catch {}

      getAuthFetchHeaders({ "Content-Type": "application/json" })
        .then((headers) =>
          fetch(apiUrl("/api/databases/register"), {
            method: "POST",
            credentials: "same-origin",
            headers,
            body: JSON.stringify({ databaseId: renameTargetDb.dbKey, companyName: newName }),
          })
        )
        .catch(() => {});

      setDbFeedback({
        type: "success",
        msg: lang === "en" ? `Database renamed to '${newName}'.` : `Pangkalan data berjaya dinamakan kepada '${newName}'.`,
      });
      setRenameTargetDb(null);
      loadAllDatabases();
    } catch {
      setDbFeedback({
        type: "error",
        msg: lang === "en" ? "Failed to rename database." : "Gagal menamakan semula pangkalan data.",
      });
    }
  };

  const handleExportTargetDbBackup = (target: { companyName: string; dbKey: string }) => {
    try {
      const raw = localStorage.getItem(target.dbKey);
      const parsed = raw ? JSON.parse(raw) : { companyName: target.companyName, dbKey: target.dbKey };
      if (parsed?.config && typeof parsed.config === "object") {
        parsed.config = { ...parsed.config, kataLaluanLogMasuk: "" };
      }
      const blob = new Blob([JSON.stringify(parsed, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const slug = target.companyName.toLowerCase().replace(/[^a-z0-9]/g, "_") || "database";
      link.download = `sandaran_${slug}_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {}
  };

  const getConsoleDbStatus = (db: ConsoleDbItem, isLocalActive: boolean) => {
    const isActive = isLocalActive || Boolean(db.isActiveInSession) || (db.activeSessionCount || 0) > 0;
    if (isActive) {
      return {
        code: "active" as const,
        isActive: true,
        label: lang === "en" ? "Active" : "Aktif",
      };
    }
    if (db.isArchived) {
      return {
        code: "archived" as const,
        isActive: false,
        label: lang === "en" ? "Archived" : "Diarkib",
      };
    }
    if (db.isDisconnected) {
      return {
        code: "disconnected" as const,
        isActive: false,
        label: lang === "en" ? "Disconnected" : "Terputus",
      };
    }
    if (db.productCount === 0) {
      return {
        code: "unused" as const,
        isActive: false,
        label: lang === "en" ? "Unused" : "Tidak Digunakan",
      };
    }
    return {
      code: "inactive" as const,
      isActive: false,
      label: lang === "en" ? "Inactive" : "Tidak Aktif",
    };
  };

  const executeDeleteDbRequest = async (
    target: ConsoleDbItem,
    confirmName: string,
    padamWord: string,
    confirmActiveDatabase: boolean,
    dbStatus: string,
    didRefreshSession = false
  ) => {
    setIsDeletingDb(true);
    setDeleteDialogFeedback(null);
    try {
      const delHeaders = await getAuthFetchHeaders({ "Content-Type": "application/json" });
      const delResp = await fetch(apiUrl("/api/auth/delete-company-db"), {
        method: "POST",
        credentials: "same-origin",
        headers: delHeaders,
        body: JSON.stringify({
          dbKey: target.dbKey,
          companyName: target.companyName,
          confirmConfirmation: true,
          confirmTypedName: confirmName,
          confirmActiveDatabase,
          dbStatus,
          ...(isDefaultBusinessDb(target) ? { confirmPadamWord: padamWord } : {}),
        }),
      });
      const respData = await delResp.json().catch(() => ({}));

      if (!didRefreshSession && delResp.status === 401 && respData?.code === "SESSION_EXPIRED") {
        setAuthModalMode("refresh");
        setPendingConsoleDelete({ target, confirmName, padamWord, confirmActiveDatabase, dbStatus });
        setReauthModalOpen(true);
        return;
      }

      if (!delResp.ok) {
        const serverErrorText = typeof respData?.error === "string" && respData.error.trim() ? respData.error.trim() : "";
        let msg: string;
        if (!isRealDeveloperSuperuser) {
          msg = "Padam ditolak oleh pelayan.";
        } else if (serverErrorText) {
          msg = serverErrorText;
        } else if (delResp.status === 401) {
          msg = "Padam ditolak: Sesi pembangun telah tamat tempoh. Sila sahkan semula.";
        } else if (delResp.status === 403) {
          msg = "Padam ditolak: Tiada kebenaran pembangun yang sah untuk operasi ini.";
        } else {
          msg = "Padam ditolak: Ralat pelayan. Cuba lagi.";
        }
        throw new Error(msg);
      }

      if (respData.sessionToken || respData.csrfToken) {
        saveServerSessionToken(respData.sessionToken, respData.csrfToken);
      }

      const fsResult = await deleteCompanyFromFirestore(target.dbKey, {
        isServerVerifiedDev: isRealDeveloperSuperuser,
        devEmail: currentUser?.email,
      });
      if (!fsResult.ok) {
        throw new Error(
          isRealDeveloperSuperuser
            ? `Padam ditolak: ${fsResult.errorStep || "Ditolak oleh peraturan pangkalan data."}`
            : "Padam ditolak oleh pelayan."
        );
      }

      localStorage.removeItem(target.dbKey);
      try {
        if (localStorage.getItem("pengekosan_active_db_key") === target.dbKey) {
          localStorage.removeItem("pengekosan_active_db_key");
        }
        localStorage.removeItem(`mrcost_chat_history_v2_${target.dbKey}_en`);
        localStorage.removeItem(`mrcost_chat_history_v2_${target.dbKey}_ms`);
        localStorage.removeItem(`smartcost_db_cache_${target.dbKey}`);
        const hasSameNameSibling = dbList.some(
          (d) => d.dbKey !== target.dbKey && d.companyName.trim().toLowerCase() === target.companyName.trim().toLowerCase()
        );
        if (!hasSameNameSibling) {
          localStorage.removeItem(`smartcost_audit_logs_${target.companyName}`);
        }
      } catch {}

      try {
        const rawArchived = localStorage.getItem("smartcost_archived_databases");
        if (rawArchived) {
          const archived = JSON.parse(rawArchived);
          if (Array.isArray(archived)) {
            localStorage.setItem(
              "smartcost_archived_databases",
              JSON.stringify(archived.filter((k: string) => k !== target.dbKey))
            );
          }
        }
      } catch {}

      onDatabaseDeleted?.(target.dbKey, respData.nextActiveDbKey);
      const refreshed = await loadAllDatabases();
      const stillPresent = refreshed.some((d) => d.dbKey === target.dbKey);
      if (stillPresent) {
        throw new Error(
          lang === "en"
            ? "Database deletion could not be verified. Please refresh and try again."
            : "Pemadaman database tidak dapat disahkan. Sila muat semula dan cuba lagi."
        );
      }

      setDbFeedback({
        type: "success",
        msg: respData.message || "Database dipadam.",
      });
      setDeleteTargetDb(null);
      setDeleteConfirmInput("");
      setDeletePadamInput("");
      setConfirmActiveChecked(false);
      setDeleteDialogFeedback(null);
      setPendingConsoleDelete(null);
    } catch (err: any) {
      setDeleteDialogFeedback({
        type: "error",
        msg: err?.message || "Sebahagian data gagal dipadam: pelayan.",
      });
    } finally {
      setIsDeletingDb(false);
    }
  };

  const handleExecuteDeleteDb = async () => {
    if (!deleteTargetDb) return;

    if (!isRealDeveloperSuperuser) {
      setDeleteDialogFeedback({
        type: "error",
        msg: "Padam ditolak oleh pelayan.",
      });
      return;
    }

    if (isSystemInfrastructureDb(deleteTargetDb)) {
      setDeleteDialogFeedback({
        type: "error",
        msg: lang === "en"
          ? "Delete rejected: Core system infrastructure cannot be deleted."
          : "Padam ditolak: Infrastruktur teras sistem dilindungi dan tidak boleh dipadam.",
      });
      return;
    }

    const isLocalActive = activeLoadedDbKey ? deleteTargetDb.dbKey === activeLoadedDbKey : deleteTargetDb.companyName === config.namaSyarikat;
    const statusInfo = getConsoleDbStatus(deleteTargetDb, isLocalActive);

    if (statusInfo.isActive && !confirmActiveChecked) {
      setDeleteDialogFeedback({
        type: "error",
        msg: lang === "en"
          ? "Please confirm deleting this currently active database before proceeding."
          : "Sila sahkan pemadaman pangkalan data yang sedang aktif sebelum meneruskan.",
      });
      return;
    }

    if (deleteConfirmInput.trim().toLowerCase() !== deleteTargetDb.companyName.trim().toLowerCase()) {
      setDeleteDialogFeedback({
        type: "error",
        msg: lang === "en"
          ? "Please type the exact database name to confirm."
          : "Sila taip nama database dengan tepat untuk meneruskan.",
      });
      return;
    }

    if (isDefaultBusinessDb(deleteTargetDb) && deletePadamInput.trim().toUpperCase() !== "PADAM") {
      setDeleteDialogFeedback({
        type: "error",
        msg: lang === "en"
          ? "Default business database requires typing 'PADAM' as extra confirmation."
          : "Database perniagaan lalai memerlukan anda menaip 'PADAM' sebagai pengesahan tambahan.",
      });
      return;
    }

    await executeDeleteDbRequest(
      deleteTargetDb,
      deleteConfirmInput.trim(),
      deletePadamInput.trim(),
      statusInfo.isActive && confirmActiveChecked,
      statusInfo.code
    );
  };

  const isAdminAuthorized = currentRole === "admin" || isRealDeveloperSuperuser;
  const isAdminScoped = !isRealDeveloperSuperuser && (currentRole === "admin" || !isRealDeveloperSuperuser);
  const currentBusinessName = config.namaSyarikat || currentUser?.companyName || "SMARTCOST";

  // Backup & Restore state
  const [exporting, setExporting] = useState(false);
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [rawFileContent, setRawFileContent] = useState<any | null>(null);
  const [validationResult, setValidationResult] = useState<BackupValidationResult | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("insert_only");
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [importReport, setImportReport] = useState<{
    addedCount: number;
    updatedCount: number;
    skippedCount: number;
    timestamp: string;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Audit Log state
  const [auditLogs, setAuditLogs] = useState<BackupAuditLogEntry[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch initial audit logs
  useEffect(() => {
    fetchAuditLogs();
  }, [currentRole]);

  const fetchAuditLogs = async () => {
    setLoadingAudit(true);
    try {
      const auditHeaders = await getAuthFetchHeaders();
      const res = await fetch(apiUrl(`/api/admin/backup/audit-log${activeLoadedDbKey ? `?databaseId=${encodeURIComponent(activeLoadedDbKey)}` : ""}`), {
        credentials: "same-origin",
        headers: auditHeaders,
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.logs)) {
          setAuditLogs(data.logs);
          return;
        }
      }
    } catch {
      // Fallback to local storage if API is offline
    } finally {
      // Load any locally cached logs if available
      try {
        const saved = localStorage.getItem(`smartcost_audit_logs_${currentBusinessName}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setAuditLogs(parsed);
          }
        }
      } catch {}
      setLoadingAudit(false);
    }
  };

  const recordLocalAudit = (entry: Omit<BackupAuditLogEntry, "id" | "timestamp">) => {
    const fullEntry: BackupAuditLogEntry = {
      ...entry,
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
    };
    setAuditLogs((prev) => {
      const updated = [fullEntry, ...prev].slice(0, 50);
      try {
        localStorage.setItem(`smartcost_audit_logs_${currentBusinessName}`, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const isKeyOwnedByBusiness = (key: string): boolean => {
    if (!isAdminScoped) return true;

    const activeSessionKeys = [
      "pengekosan_config",
      "pengekosan_bahan",
      "pengekosan_buruh",
      "pengekosan_ohb",
      "pengekosan_oht",
      "pengekosan_templates",
      "pengekosan_active_product_id",
      "pengekosan_language",
    ];
    if (activeSessionKeys.includes(key)) return true;

    const sanitized = currentBusinessName.toLowerCase().trim().replace(/[^a-z0-9]/g, "_");
    if (key === `pengekosan_company_db_${sanitized}`) return true;
    if (key.startsWith(`pengekosan_company_db_${sanitized}_`)) return true;

    if (activeLoadedDbKey && key === activeLoadedDbKey) return true;
    if (currentUser?.dbKey && key === currentUser.dbKey) return true;
    if (currentUser?.id && key === `pengekosan_userdb_${currentUser.id}`) return true;

    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        const parsedCompany = parsed.companyName || parsed.config?.namaSyarikat || "";
        if (parsedCompany && parsedCompany.toLowerCase().trim() === currentBusinessName.toLowerCase().trim()) {
          return true;
        }
        if (currentUser?.id && parsed.id === currentUser.id) {
          return true;
        }
        if (currentUser?.email && parsed.email && parsed.email.toLowerCase() === currentUser.email.toLowerCase()) {
          return true;
        }
      }
    } catch (e) {
      // ignore
    }

    return false;
  };

  // 1. EXPORT BACKUP FUNCTION
  const handleExportBackup = async () => {
    if (!isAdminAuthorized) {
      alert(lang === "en" ? "Access Denied: Admin permissions required." : "Akses Ditolak: Memerlukan kebenaran pentadbir.");
      return;
    }

    setExporting(true);
    setExportSuccessMsg(null);
    setErrorMessage(null);

    const safeConfig = sanitizeConfigForBackup(config);
    const now = new Date();
    const fileName = generateBackupFileName(currentBusinessName);

    // Calculate item counts
    let totalMaterials = 0;
    let totalLabor = 0;
    let totalOverhead = 0;

    templates.forEach((t) => {
      if (Array.isArray(t.bahanMentah)) totalMaterials += t.bahanMentah.length;
      if (Array.isArray(t.buruhLangsung)) totalLabor += t.buruhLangsung.length;
      if (Array.isArray(t.overheadBerubah)) totalOverhead += t.overheadBerubah.length;
      if (Array.isArray(t.overheadTetap)) totalOverhead += t.overheadTetap.length;
    });

    const backupPayload = {
      metadata: {
        app: "SMARTCOST",
        backupVersion: BACKUP_FORMAT_VERSION,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: now.toISOString(),
        exportedBy: currentUser?.fullName || currentUser?.username || "Admin",
        companyName: currentBusinessName,
        currency: config.currency || "RM",
        totalProducts: templates.length,
        totalRawMaterials: totalMaterials,
        totalLaborItems: totalLabor,
        totalOverheadItems: totalOverhead,
      },
      company: {
        name: currentBusinessName,
        currency: config.currency || "RM",
        config: safeConfig,
      },
      templates,
    };

    try {
      // Attempt server-side export with verified session headers
      const exportHeaders = await getAuthFetchHeaders({ "Content-Type": "application/json" });
      const response = await fetch(apiUrl("/api/admin/backup/export"), {
        method: "POST",
        credentials: "same-origin",
        headers: exportHeaders,
        body: JSON.stringify({
          databaseId: activeLoadedDbKey,
          companyName: currentBusinessName,
          currentUser: currentUser || { username: "admin", role: currentRole },
          config: safeConfig,
          templates,
          userRole: currentRole,
        }),
      });

      let finalBlobData = backupPayload;
      let finalFileName = fileName;

      if (response.ok) {
        const result = await response.json();
        if (result.backup) finalBlobData = result.backup;
        if (result.fileName) finalFileName = result.fileName;
      }

      // Download file to client browser
      const blob = new Blob([JSON.stringify(finalBlobData, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = finalFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const successNotice = lang === "en"
        ? `Backup created successfully (${finalFileName}). Stored ${templates.length} product recipes.`
        : `Sandaran data berjaya dijana (${finalFileName}). Mengandungi ${templates.length} resipi produk.`;

      setExportSuccessMsg(successNotice);

      recordLocalAudit({
        action: "EXPORT",
        username: currentUser?.username || "admin",
        userRole: currentRole,
        companyName: currentBusinessName,
        recordsCount: templates.length,
        status: "SUCCESS",
        details: successNotice,
      });
    } catch (err: any) {
      console.warn("Server export fallback triggered:", err);
      // Fallback direct browser download
      const blob = new Blob([JSON.stringify(backupPayload, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportSuccessMsg(
        lang === "en"
          ? `Offline backup exported (${fileName}).`
          : `Sandaran offline berjaya dimuat turun (${fileName}).`
      );
    } finally {
      setExporting(false);
    }
  };

  // 2. FILE SELECTION & VALIDATION
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFileName(file.name);
    setValidationResult(null);
    setRawFileContent(null);
    setImportReport(null);
    setErrorMessage(null);

    const readRes = await validateAndReadJsonFile(file, lang === "en" ? "en" : "ms");
    if (readRes.ok === false) {
      setErrorMessage(readRes.error);
      e.target.value = "";
      return;
    }

    const parsed = readRes.data;
    setRawFileContent(parsed);

    try {
      const valHeaders = await getAuthFetchHeaders({ "Content-Type": "application/json" });
      const res = await fetch(apiUrl("/api/admin/backup/validate"), {
        method: "POST",
        credentials: "same-origin",
        headers: valHeaders,
        body: JSON.stringify({
          databaseId: activeLoadedDbKey,
          backupContent: parsed,
          existingTemplates: templates,
        }),
      });
      if (res.ok) {
        const data: BackupValidationResult = await res.json();
        setValidationResult(data);
        return;
      }
      if (res.status === 400) {
        const errData = await res.json().catch(() => ({}));
        setErrorMessage(errData.error || (lang === "en" ? "Invalid backup content." : "Kandungan sandaran tidak sah."));
        return;
      }
    } catch {
      // fallback to deterministic local validator when offline
    }

    const localResult = validateBackupContent(parsed, templates);
    setValidationResult(localResult);
  };

  // 3. EXECUTE IMPORT
  const handleExecuteImport = async () => {
    if (!rawFileContent || !validationResult?.valid) return;
    setIsConfirmModalOpen(false);
    setImporting(true);
    setErrorMessage(null);

    try {
      let extractTemplates: TemplatPerniagaan[] = [];
      if (Array.isArray(rawFileContent.templates)) {
        extractTemplates = rawFileContent.templates;
      } else if (rawFileContent.data?.templates && Array.isArray(rawFileContent.data.templates)) {
        extractTemplates = rawFileContent.data.templates;
      } else if (rawFileContent.pengekosan_templates && Array.isArray(rawFileContent.pengekosan_templates)) {
        extractTemplates = rawFileContent.pengekosan_templates;
      }

      // Perform Import
      const importResult = executeTemplatesImport({
        backupTemplates: extractTemplates,
        existingTemplates: templates,
        mode: importMode,
      });

      // Update templates in React state and LocalStorage
      if (onUpdateTemplates) {
        onUpdateTemplates(importResult.updatedTemplates);
      }
      try {
        localStorage.setItem("pengekosan_templates", JSON.stringify(importResult.updatedTemplates));
      } catch {}

      // Inform server audit log
      try {
        const impHeaders = await getAuthFetchHeaders({ "Content-Type": "application/json" });
        await fetch(apiUrl("/api/admin/backup/import"), {
          method: "POST",
          credentials: "same-origin",
          headers: impHeaders,
          body: JSON.stringify({
            databaseId: activeLoadedDbKey,
            backupContent: rawFileContent,
            existingTemplates: templates,
            mode: importMode,
            currentUser: currentUser || { username: "admin", role: currentRole },
            companyName: currentBusinessName,
          }),
        });
      } catch {}

      setImportReport({
        addedCount: importResult.addedCount,
        updatedCount: importResult.updatedCount,
        skippedCount: importResult.skippedCount,
        timestamp: new Date().toLocaleTimeString(),
      });

      const auditMsg = lang === "en"
        ? `Import [${importMode}]: Added ${importResult.addedCount}, Updated ${importResult.updatedCount}, Skipped ${importResult.skippedCount}.`
        : `Import mod [${importMode}]: Ditambah ${importResult.addedCount}, Dikemas kini ${importResult.updatedCount}, Dilangkau ${importResult.skippedCount}.`;

      recordLocalAudit({
        action: "IMPORT",
        username: currentUser?.username || "admin",
        userRole: currentRole,
        companyName: currentBusinessName,
        mode: importMode,
        recordsCount: importResult.addedCount + importResult.updatedCount,
        status: "SUCCESS",
        details: auditMsg,
      });

      // Clear file selection
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: any) {
      setErrorMessage(
        lang === "en"
          ? "Failed to restore backup data: " + (err.message || String(err))
          : "Gagal memulihkan sandaran data: " + (err.message || String(err))
      );
    } finally {
      setImporting(false);
    }
  };

  // Full Dump for superuser
  const handleExportFullDump = () => {
    const dump: Record<string, any> = {};

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && isKeyOwnedByBusiness(key)) {
        try {
          const val = localStorage.getItem(key);
          dump[key] = val ? JSON.parse(val) : val;
        } catch {
          dump[key] = localStorage.getItem(key);
        }
      }
    }

    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `smartcost-${currentBusinessName.toLowerCase().replace(/[^a-z0-9]/g, "_")}-master-dump-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isRealDeveloperSuperuser) {
    return (
      <div className="p-8 sm:p-12 text-center rounded-3xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 max-w-lg mx-auto space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-900/60 text-rose-600 dark:text-rose-300 mx-auto flex items-center justify-center">
          <Lock className="w-6 h-6" />
        </div>
        <div className="space-y-1.5">
          <h3 className="font-display font-bold text-base text-slate-900 dark:text-white">
            {lang === "en" ? "Access Restricted" : "Akses Dihadkan"}
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {lang === "en"
              ? "You do not have access to this section."
              : "Anda tidak mempunyai akses ke bahagian ini."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* 1. DEVELOPER HERO BANNER */}
      <section className="bg-slate-900 text-white rounded-xl p-5 sm:p-6 border border-slate-800 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-0.5 font-mono text-[11px] font-bold rounded bg-slate-800 text-sky-400 border border-slate-700 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5" />
              {isAdminScoped ? "ADMIN DEVELOPER CONSOLE" : "DEVELOPER ROOT ACCESS"}
            </span>

            <span className="px-2.5 py-0.5 bg-slate-800 text-slate-300 text-[10px] font-mono font-bold rounded border border-slate-700 flex items-center gap-1.5">
              <Building2 className="w-3 h-3 text-sky-400" />
              <span className="uppercase">{currentBusinessName}</span>
            </span>

            <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold rounded border border-emerald-400/30 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              {isAdminScoped ? "TERHAD PERNIAGAAN SENDIRI" : "SUPERUSER"}
            </span>
          </div>

          <h2 className="text-xl font-display font-extrabold tracking-tight text-white flex items-center gap-2">
            <span>
              {isAdminScoped
                ? (lang === "en" ? `Developer Console — ${currentBusinessName}` : `Konsol Pembangun & Pentadbiran — ${currentBusinessName}`)
                : (lang === "en" ? "System Developer Console (Superuser)" : "Konsol Pembangun Sistem (Superuser)")}
            </span>
            <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
              v2.5 PRO
            </span>
          </h2>

          <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
            {isAdminScoped ? (
              lang === "en"
                ? `Role simulator (RBAC) and enterprise backup/restore operations for ${currentBusinessName}. Operations are securely isolated.`
                : `Simulator peranan akses (RBAC) dan pusat sandaran serta pemulihan data khas Admin bagi ${currentBusinessName}.`
            ) : (
              lang === "en"
                ? "Dedicated control center for engineers to simulate user roles (RBAC) and manage data backups."
                : "Ruang khas bagi pentadbir dan jurutera untuk mensimulasikan peranan (RBAC) serta mengurus sandaran data."
            )}
          </p>
        </div>

        {/* Quick Metrics Badges */}
        <div className="grid grid-cols-2 gap-2 shrink-0 font-mono">
          <div className="p-2.5 bg-slate-800 rounded-lg border border-slate-700 text-center min-w-[100px]">
            <span className="text-[10px] text-slate-400 block uppercase">
              {lang === "en" ? "Active Role" : "Peranan"}
            </span>
            <span className="text-xs font-bold text-sky-400 uppercase">{currentRole}</span>
          </div>
          <div className="p-2.5 bg-slate-800 rounded-lg border border-slate-700 text-center min-w-[110px]">
            <span className="text-[10px] text-slate-400 block uppercase">
              {lang === "en" ? "Scope" : "Skop"}
            </span>
            <span className="text-xs font-bold text-slate-200 block truncate">
              {isAdminScoped ? "TERASING" : "UNIVERSAL"}
            </span>
          </div>
        </div>
      </section>

      {/* Admin Security Callout Banner */}
      {isAdminScoped && (
        <div className="p-3 bg-slate-100 border border-slate-200/90 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 text-slate-700 text-xs">
          <div className="flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span>
              <strong>{lang === "en" ? "Business Scope Protection Active:" : "Perlindungan Skop Data Aktif:"}</strong>{" "}
              {lang === "en"
                ? `Operations are scoped strictly to ${currentBusinessName}. Cross-tenant data tampering is strictly prohibited.`
                : `Operasi terhad kepada ${currentBusinessName} sahaja. Data perniagaan lain dilindungi secara terasing.`}
            </span>
          </div>
          <span className="px-2 py-0.5 bg-slate-200 text-slate-800 font-mono font-bold text-[10px] rounded shrink-0">
            {currentBusinessName}
          </span>
        </div>
      )}

      {/* 2. DEVELOPER CONSOLE NAVIGATION TABS */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2.5 flex-wrap">
        <button
          type="button"
          onClick={() => {
            setActiveConsoleTab("databases");
            loadAllDatabases();
          }}
          className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            activeConsoleTab === "databases"
              ? "bg-slate-900 text-white shadow-2xs"
              : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
          }`}
        >
          <Database className="w-3.5 h-3.5 text-cyan-400" />
          <span>{lang === "en" ? "Database Management" : "Pengurusan Pangkalan Data"}</span>
          <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-800 text-slate-200 font-bold">
            {dbList.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveConsoleTab("simulator")}
          className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            activeConsoleTab === "simulator"
              ? "bg-slate-900 text-white shadow-2xs"
              : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
          }`}
        >
          <Sliders className="w-3.5 h-3.5 text-sky-400" />
          <span>{lang === "en" ? "Role Simulator (RBAC)" : "Simulator Peranan (RBAC)"}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveConsoleTab("backup")}
          className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            activeConsoleTab === "backup"
              ? "bg-slate-900 text-white shadow-2xs"
              : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
          }`}
        >
          <Archive className="w-3.5 h-3.5 text-sky-400" />
          <span>{lang === "en" ? "Backup & Data Recovery" : "Sandaran dan Pemulihan Data"}</span>
        </button>

        {isRealDeveloperSuperuser && (
          <button
            type="button"
            onClick={() => setActiveConsoleTab("infra")}
            className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              activeConsoleTab === "infra"
                ? "bg-[#061830] text-white shadow-2xs"
                : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200"
            }`}
          >
            <Server className="w-3.5 h-3.5 text-emerald-400" />
            <span>SERVER &amp; DATABASE MANAGEMENT</span>
          </button>
        )}
      </div>

      {/* 3. SUB-PANEL 0: DEVELOPER DATABASE MANAGEMENT */}
      {activeConsoleTab === "databases" && (
        <section className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200/90 shadow-2xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Database className="w-4 h-4 text-cyan-600" />
                <span>{lang === "en" ? "Company Databases & Partition Governance" : "Pengurusan & Pentadbiran Pangkalan Data"}</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === "en"
                  ? "Manage registered business databases (Active, Inactive, Default, Archived, Disconnected). Core system infrastructure and user accounts remain protected."
                  : "Urus semua pangkalan data perniagaan berdaftar (Aktif, Tidak Aktif, Lalai, Diarkib, Terputus). Infrastruktur teras sistem dan akaun pengguna kekal dilindungi."}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onOpenDatabaseModal}
                className="px-3 py-1.5 bg-[#0b3c7a] hover:bg-[#093163] text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>{lang === "en" ? "Open Database Modal" : "Buka Tetingkap Database"}</span>
              </button>
              <button
                type="button"
                onClick={loadAllDatabases}
                className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs transition-all cursor-pointer border border-slate-200"
                title="Refresh"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {dbFeedback && (
            <div
              className={`p-3 rounded-xl text-xs font-medium flex items-center justify-between gap-2 ${
                dbFeedback.type === "success"
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : dbFeedback.type === "info"
                  ? "bg-sky-50 text-sky-800 border border-sky-200"
                  : "bg-rose-50 text-rose-800 border border-rose-200"
              }`}
            >
              <div className="flex items-center gap-2">
                {dbFeedback.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <span>{dbFeedback.msg}</span>
              </div>
              <button
                type="button"
                onClick={() => setDbFeedback(null)}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕
              </button>
            </div>
          )}

          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={dbSearch}
              onChange={(e) => setDbSearch(e.target.value)}
              placeholder={lang === "en" ? "Search databases by name, owner, or storage key..." : "Cari pangkalan data mengikut nama syarikat, pemilik, atau fail..."}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 focus:border-cyan-500 rounded-lg text-xs outline-hidden"
            />
          </div>

          {/* Databases Grid / List */}
          <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
            {dbList
              .filter((db) => {
                if (!dbSearch.trim()) return true;
                const q = dbSearch.toLowerCase().trim();
                return (
                  db.companyName.toLowerCase().includes(q) ||
                  db.dbKey.toLowerCase().includes(q) ||
                  db.owner.toLowerCase().includes(q)
                );
              })
              .map((db) => {
                const isActive = activeLoadedDbKey ? db.dbKey === activeLoadedDbKey : db.companyName === currentBusinessName;
                const isInfraProtected = isSystemInfrastructureDb(db);
                const isDeleteDisabled = !isRealDeveloperSuperuser || isInfraProtected;
                const deleteTooltip = !isRealDeveloperSuperuser
                  ? (lang === "en" ? "Only developers can delete this database." : "Hanya pembangun boleh memadam database.")
                  : isInfraProtected
                  ? (lang === "en" ? "Core system infrastructure is protected and cannot be deleted." : "Infrastruktur teras sistem dilindungi dan tidak boleh dipadam.")
                  : (lang === "en" ? "Delete this business database (developer mode)." : "Padam database perniagaan ini (mod pembangun).");

                return (
                  <div
                    key={db.dbKey}
                    className={`p-3.5 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-3 transition-all ${
                      isActive
                        ? "bg-blue-50/70 border-blue-200 shadow-2xs"
                        : db.isArchived
                        ? "bg-slate-50 border-slate-200 opacity-60"
                        : "bg-white border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                          db.isSandbox
                            ? "bg-slate-950 text-cyan-400 border border-cyan-500/40"
                            : isActive
                            ? "bg-[#0b3c7a] text-white"
                            : db.isArchived
                            ? "bg-purple-100 text-purple-700"
                            : "bg-slate-100 text-slate-600 border border-slate-200"
                        }`}
                      >
                        {db.isSandbox ? <Terminal className="w-4 h-4" /> : db.isArchived ? <Archive className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold text-sm text-slate-900 truncate">
                            {db.companyName}
                          </h4>
                          {db.isSandbox && (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold font-mono bg-slate-950 text-cyan-300 border border-cyan-500/40 uppercase">
                              SANDBOX
                            </span>
                          )}
                          {isActive || db.isActiveInSession || (db.activeSessionCount || 0) > 0 ? (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1 uppercase">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                              {lang === "en" ? "Active" : "Aktif"}
                            </span>
                          ) : db.isArchived ? (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-purple-100 text-purple-800 border border-purple-300 uppercase">
                              {lang === "en" ? "Archived" : "Diarkib"}
                            </span>
                          ) : db.isDisconnected ? (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-slate-200 text-slate-700 border border-slate-300 uppercase">
                              {lang === "en" ? "Disconnected" : "Terputus"}
                            </span>
                          ) : db.productCount === 0 ? (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200 uppercase">
                              {lang === "en" ? "Unused" : "Tidak Digunakan"}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-300 uppercase">
                              {lang === "en" ? "Inactive" : "Tidak Aktif"}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 font-mono flex-wrap">
                          <span>Owner: <strong className="text-slate-700">{db.owner}</strong></span>
                          <span>&bull;</span>
                          <span>{db.productCount} {lang === "en" ? "products" : "produk"}</span>
                          <span>&bull;</span>
                          <span className="bg-slate-100 px-1 rounded text-[10px] text-slate-600 truncate max-w-[200px]">
                            {db.dbKey}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Developer Action Buttons */}
                    <div className="flex items-center gap-1.5 shrink-0 justify-end pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                      {/* View Action */}
                      <button
                        type="button"
                        onClick={onOpenDatabaseModal}
                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer border border-slate-200"
                        title={lang === "en" ? "View Database Details" : "Lihat Maklumat Database"}
                      >
                        <Eye className="w-3.5 h-3.5 text-slate-600" />
                        <span>{lang === "en" ? "View" : "Lihat"}</span>
                      </button>

                      {/* Rename Action */}
                      {!db.isSandbox && (
                        <button
                          type="button"
                          onClick={() => {
                            setRenameTargetDb(db);
                            setRenameInputVal(db.companyName);
                          }}
                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer border border-slate-200"
                          title={lang === "en" ? "Rename Database" : "Namakan Semula"}
                        >
                          <Edit3 className="w-3.5 h-3.5 text-blue-600" />
                          <span>{lang === "en" ? "Rename" : "Nama"}</span>
                        </button>
                      )}

                      {/* Archive / Restore Action */}
                      {!db.isSandbox && (
                        <button
                          type="button"
                          onClick={() => handleArchiveDb(db.dbKey, db.companyName, Boolean(db.isArchived))}
                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer border border-slate-200"
                          title={db.isArchived ? "Unarchive" : "Archive"}
                        >
                          {db.isArchived ? (
                            <ArchiveRestore className="w-3.5 h-3.5 text-purple-600" />
                          ) : (
                            <Archive className="w-3.5 h-3.5 text-purple-600" />
                          )}
                          <span>{db.isArchived ? (lang === "en" ? "Restore" : "Batal Arkib") : (lang === "en" ? "Archive" : "Arkib")}</span>
                        </button>
                      )}

                      {/* Delete Action (Strict Developer Guardrails) */}
                      <span title={deleteTooltip} className={`inline-flex ${isDeleteDisabled ? "cursor-not-allowed" : ""}`}>
                        <button
                          type="button"
                          disabled={isDeleteDisabled}
                          aria-label={deleteTooltip}
                          onClick={() => {
                            setDeleteTargetDb(db);
                            setDeleteConfirmInput("");
                            setDeletePadamInput("");
                            setConfirmActiveChecked(false);
                            setDeleteDialogFeedback(null);
                          }}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all border ${
                            isDeleteDisabled
                              ? "opacity-30 cursor-not-allowed pointer-events-none border-slate-200 text-slate-400 bg-slate-50"
                              : "bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200 cursor-pointer shadow-2xs"
                          }`}
                          title={deleteTooltip}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                          <span>{lang === "en" ? "Delete" : "Padam"}</span>
                        </button>
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>

          {/* Inline Delete Confirmation Dialog */}
          {deleteTargetDb && (() => {
            const isTargetLocalActive = activeLoadedDbKey ? deleteTargetDb.dbKey === activeLoadedDbKey : deleteTargetDb.companyName === currentBusinessName;
            const targetStatusInfo = getConsoleDbStatus(deleteTargetDb, isTargetLocalActive);
            return (
            <div className="mt-4 p-4 rounded-xl border border-rose-200 bg-rose-50/80 space-y-3 animate-slideUp">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-xs text-rose-900 uppercase">
                    {lang === "en" ? "Confirm Database Deletion" : "Pengesahan Pemadaman Pangkalan Data"}
                  </h4>
                  <p className="text-[11px] text-rose-800 mt-0.5">
                    {lang === "en"
                      ? `All products, cost records, and Mr Cost chat history for '${deleteTargetDb.companyName}' (${deleteTargetDb.dbKey}) will be permanently deleted and cannot be undone.`
                      : `Semua produk, rekod kos, dan sejarah chat Mr Cost bagi '${deleteTargetDb.companyName}' (${deleteTargetDb.dbKey}) akan dipadam secara kekal dan tidak boleh dikembalikan.`}
                  </p>
                </div>
              </div>

              <div className="p-2.5 bg-white/90 rounded-lg border border-rose-200/80 text-[11px] font-mono grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <div><span className="text-slate-400">{lang === "en" ? "Database:" : "Nama:"}</span> <strong className="text-slate-900 font-sans">{deleteTargetDb.companyName}</strong></div>
                <div><span className="text-slate-400">Status:</span> <strong className={targetStatusInfo.isActive ? "text-emerald-700" : "text-slate-700"}>{targetStatusInfo.label}</strong></div>
                <div className="sm:col-span-2 truncate"><span className="text-slate-400">{lang === "en" ? "DB ID:" : "Kunci DB:"}</span> <span className="text-slate-700">{deleteTargetDb.dbKey}</span></div>
                <div className="sm:col-span-2"><span className="text-slate-400">{lang === "en" ? "Classification:" : "Klasifikasi:"}</span> <strong className="text-slate-800 font-sans">{isDefaultBusinessDb(deleteTargetDb) ? (lang === "en" ? "Default Business Database" : "Database Perniagaan Lalai") : (lang === "en" ? "Business Database" : "Database Perniagaan")}</strong></div>
                <div><span className="text-slate-400">{lang === "en" ? "Owner:" : "Pemilik:"}</span> <span className="text-slate-700">{deleteTargetDb.owner}</span></div>
                <div><span className="text-slate-400">{lang === "en" ? "Products:" : "Produk:"}</span> <span className="text-slate-700">{deleteTargetDb.productCount}</span></div>
              </div>

              {targetStatusInfo.isActive && (
                <div className="p-2.5 bg-rose-100/80 border border-rose-300 rounded-lg text-[11px] text-rose-950 space-y-1.5">
                  <p className="font-medium">
                    <strong>{lang === "en" ? "ACTIVE DATABASE WARNING:" : "AMARAN PANGKALAN DATA AKTIF:"}</strong>{" "}
                    {lang === "en"
                      ? "This database is currently active. Deleting it will terminate connected sessions and switch to another valid workspace."
                      : "Pangkalan data ini sedang aktif. Memadamkannya akan menamatkan sesi yang bersambung dan beralih ke ruang kerja lain."}
                  </p>
                  <label className="flex items-start gap-2 cursor-pointer font-semibold">
                    <input
                      type="checkbox"
                      checked={confirmActiveChecked}
                      onChange={(e) => setConfirmActiveChecked(e.target.checked)}
                      className="mt-0.5 rounded border-rose-400 text-rose-600 focus:ring-rose-500"
                    />
                    <span>
                      {lang === "en"
                        ? "Confirm deleting this currently active database."
                        : "Sahkan pemadaman pangkalan data yang sedang aktif ini."}
                    </span>
                  </label>
                </div>
              )}

              {isDefaultBusinessDb(deleteTargetDb) && (
                <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-lg text-[11px] text-amber-900 font-medium">
                  <strong>{lang === "en" ? "SPECIAL WARNING (Default Business Database):" : "AMARAN KHAS (Database Perniagaan Lalai):"}</strong>{" "}
                  {lang === "en"
                    ? "This is a default business database (not core system infrastructure). Deleting it will not automatically recreate it. Extra confirmation ('PADAM') is required."
                    : "Ini ialah database perniagaan lalai (bukan infrastruktur teras sistem). Pemadaman adalah kekal dan tidak akan dicipta semula secara automatik. Pengesahan tambahan ('PADAM') diperlukan."}
                </div>
              )}

              <div className="flex flex-col gap-2 pt-1">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <input
                    type="text"
                    autoFocus
                    value={deleteConfirmInput}
                    onChange={(e) => setDeleteConfirmInput(e.target.value)}
                    placeholder={
                      lang === "en"
                        ? `Type '${deleteTargetDb.companyName}' to confirm`
                        : `Taip '${deleteTargetDb.companyName}' untuk sahkan`
                    }
                    className="flex-1 px-3 py-1.5 bg-white border border-rose-300 focus:border-rose-600 rounded-lg text-xs font-mono font-bold text-slate-900 outline-hidden"
                  />
                  {isDefaultBusinessDb(deleteTargetDb) && (
                    <input
                      type="text"
                      value={deletePadamInput}
                      onChange={(e) => setDeletePadamInput(e.target.value)}
                      placeholder={lang === "en" ? "Type 'PADAM' to confirm default DB" : "Taip 'PADAM' untuk sahkan"}
                      className="flex-1 px-3 py-1.5 bg-white border border-rose-300 focus:border-rose-600 rounded-lg text-xs font-mono font-bold text-slate-900 outline-hidden"
                    />
                  )}
                </div>
                {deleteDialogFeedback && (
                  <div className="p-2.5 bg-white border border-rose-300 rounded-lg text-xs font-medium text-rose-700 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>{deleteDialogFeedback.msg}</span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleExportTargetDbBackup(deleteTargetDb)}
                    className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{lang === "en" ? "Download Backup First (.json)" : "Muat Turun Sandaran Dahulu (.json)"}</span>
                  </button>
                  <div className="flex items-center gap-1.5 ml-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteTargetDb(null);
                        setDeleteConfirmInput("");
                        setDeletePadamInput("");
                        setConfirmActiveChecked(false);
                        setDeleteDialogFeedback(null);
                      }}
                      className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      {lang === "en" ? "Cancel" : "Batal"}
                    </button>
                    <button
                      type="button"
                      disabled={
                        isDeletingDb ||
                        (targetStatusInfo.isActive && !confirmActiveChecked) ||
                        deleteConfirmInput.trim().toLowerCase() !== deleteTargetDb.companyName.trim().toLowerCase() ||
                        (isDefaultBusinessDb(deleteTargetDb) && deletePadamInput.trim().toUpperCase() !== "PADAM")
                      }
                      onClick={handleExecuteDeleteDb}
                      className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-xs flex items-center gap-1.5"
                    >
                      {isDeletingDb && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                      <span>{lang === "en" ? "Confirm Delete" : "Sahkan Padam"}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
            );
          })()}

          <DeveloperAuthModal
            isOpen={reauthModalOpen}
            mode={authModalMode}
            zIndexClass="z-70"
            onClose={() => {
              setReauthModalOpen(false);
              setPendingConsoleDelete(null);
              setIsDeletingDb(false);
              setDeleteDialogFeedback({
                type: "error",
                msg: "Pengesahan pembangun gagal.",
              });
            }}
            onSuccess={() => {
              setReauthModalOpen(false);
              if (pendingConsoleDelete) {
                const next = pendingConsoleDelete;
                setPendingConsoleDelete(null);
                executeDeleteDbRequest(
                  next.target,
                  next.confirmName,
                  next.padamWord,
                  next.confirmActiveDatabase,
                  next.dbStatus,
                  true
                );
              }
            }}
            lang={lang}
            devEntryEnabled={true}
          />

          {/* Inline Rename Dialog */}
          {renameTargetDb && (
            <div className="mt-4 p-4 rounded-xl border border-blue-200 bg-blue-50/80 space-y-3 animate-slideUp">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-blue-900 uppercase flex items-center gap-1.5">
                  <Edit3 className="w-4 h-4 text-blue-600" />
                  <span>{lang === "en" ? "Rename Database" : "Namakan Semula Pangkalan Data"}</span>
                </h4>
                <button
                  type="button"
                  onClick={() => setRenameTargetDb(null)}
                  className="text-slate-400 hover:text-slate-600 text-xs font-bold"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleRenameDbSubmit} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  required
                  autoFocus
                  value={renameInputVal}
                  onChange={(e) => setRenameInputVal(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-white border border-blue-300 focus:border-blue-600 rounded-lg text-xs font-bold text-slate-900 outline-hidden"
                />
                <div className="flex items-center gap-1.5 self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setRenameTargetDb(null)}
                    className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    {lang === "en" ? "Cancel" : "Batal"}
                  </button>
                  <button
                    type="submit"
                    className="px-3.5 py-1.5 bg-[#0b3c7a] hover:bg-[#093163] text-white rounded-lg text-xs font-bold cursor-pointer shadow-xs"
                  >
                    {lang === "en" ? "Save" : "Simpan"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </section>
      )}

      {/* 3. SUB-PANEL 1: RBAC ROLE SIMULATOR */}
      {activeConsoleTab === "simulator" && (
        <section className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200/90 shadow-2xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-blue-600" />
                <span>{lang === "en" ? `Role-Based Access Simulator (${currentBusinessName})` : `Simulator Peranan Akses (${currentBusinessName})`}</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === "en"
                  ? `Simulate how staff, supervisors, managers, or clerks see and interact with ${currentBusinessName}.`
                  : `Uji dan simulasikan bagaimana staf, penyelia, pengurus, atau kerani melihat serta beroperasi dalam perniagaan ${currentBusinessName}.`}
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenAccessMatrixModal}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all self-start sm:self-auto cursor-pointer border border-slate-200"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
              <span>{lang === "en" ? "Open RBAC Matrix" : "Buka Matriks RBAC"}</span>
            </button>
          </div>

          {/* Role Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(ROLE_DEFINITIONS).map(([key, def]) => {
              const isSelected = currentRole === key;
              return (
                <div
                  key={key}
                  onClick={() => onSwitchRole(key as UserRole)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer relative overflow-hidden ${
                    isSelected
                      ? "border-blue-600 bg-blue-50/50 shadow-2xs"
                      : "border-slate-200 hover:border-slate-300 bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${def.badgeColor}`}>
                        {def.title}
                      </span>
                      <div className="text-xs font-bold text-slate-900 mt-1.5">
                        {def.accessLevel}
                      </div>
                    </div>
                    {isSelected && (
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0">
                        <UserCheck className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                    {def.visibility}
                  </p>
                  <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                    <span>{def.canEditDailyData ? "Data: Boleh ubah" : "Data: Baca sahaja"}</span>
                    <span>{def.canEditSettings ? "Tetapan: Penuh" : "Tetapan: Terhad"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 4. SUB-PANEL 2: SANDARAN DAN PEMULIHAN DATA (ADMIN BACKUP & RESTORE) */}
      {activeConsoleTab === "backup" && (
        <div className="space-y-6">
          {/* Access Warning if not admin */}
          {!isAdminAuthorized && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 text-xs flex items-center gap-3">
              <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
              <div>
                <strong>{lang === "en" ? "Admin Authorization Required:" : "Kebenaran Pentadbir Diperlukan:"}</strong>{" "}
                {lang === "en"
                  ? "Data export and restoration operations are strictly restricted to verified system administrators."
                  : "Operasi eksport dan pemulihan data dihadkan sepenuhnya untuk pentadbir yang disahkan sahaja."}
              </div>
            </div>
          )}

          {/* Error Message banner */}
          {errorMessage && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 text-xs flex items-start justify-between gap-3 animate-fadeIn">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="text-rose-500 hover:text-rose-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Export Success notice */}
          {exportSuccessMsg && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs flex items-start justify-between gap-3 animate-fadeIn">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>{exportSuccessMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => setExportSuccessMsg(null)}
                className="text-emerald-500 hover:text-emerald-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Import Success Report */}
          {importReport && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-blue-950 text-xs space-y-2 animate-fadeIn">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-sm text-blue-900">
                  <CheckCircle2 className="w-4 h-4 text-blue-600" />
                  <span>{lang === "en" ? "Data Restoration Complete!" : "Pemulihan Sandaran Berjaya!"}</span>
                </div>
                <span className="text-[10px] font-mono text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
                  {importReport.timestamp}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-center">
                <div className="bg-white p-2 rounded border border-blue-200">
                  <span className="text-[10px] text-slate-500 block">{lang === "en" ? "Added" : "Ditambah"}</span>
                  <span className="text-sm font-bold text-emerald-600">+{importReport.addedCount}</span>
                </div>
                <div className="bg-white p-2 rounded border border-blue-200">
                  <span className="text-[10px] text-slate-500 block">{lang === "en" ? "Updated" : "Dikemas kini"}</span>
                  <span className="text-sm font-bold text-sky-600">{importReport.updatedCount}</span>
                </div>
                <div className="bg-white p-2 rounded border border-blue-200">
                  <span className="text-[10px] text-slate-500 block">{lang === "en" ? "Skipped" : "Dilangkau"}</span>
                  <span className="text-sm font-bold text-slate-500">{importReport.skippedCount}</span>
                </div>
              </div>
            </div>
          )}

          {/* SECTION A: EKSPORT BACKUP */}
          <section className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200/90 shadow-2xs space-y-4">
            <div className="pb-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Download className="w-4 h-4 text-blue-600" />
                  <span>{lang === "en" ? "1. Export Business Backup (Eksport Sandaran)" : "1. Eksport Sandaran Data Perniagaan"}</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {lang === "en"
                    ? `Download an encrypted, UTF-8 JSON archive containing all costing sheets, raw materials, labor, overheads, and configuration for ${currentBusinessName}.`
                    : `Muat turun salinan arkib JSON mengandungi semua rekod pengiraan kos produk, bahan mentah, buruh, overhed, dan konfigurasi bagi ${currentBusinessName}.`}
                </p>
              </div>

              <span className="px-2.5 py-1 bg-slate-100 text-slate-700 font-mono text-[11px] font-bold rounded border border-slate-200 self-start sm:self-auto">
                {templates.length} {lang === "en" ? "Product Recipes" : "Resipi Produk"}
              </span>
            </div>

            <div className="p-4 bg-slate-900 text-white rounded-xl border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4 shadow-2xs">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono font-bold text-sky-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                    SCHEMA v{BACKUP_SCHEMA_VERSION} • JSON
                  </span>
                  <span className="text-xs text-slate-400">
                    {lang === "en" ? "Unicode & Ringgit Malaysia (RM) Supported" : "Menyokong Unicode & Ringgit Malaysia (RM)"}
                  </span>
                </div>
                <h4 className="text-sm font-bold text-white">
                  {lang === "en" ? `Complete Business Archive (${currentBusinessName})` : `Arkib Penuh Perniagaan (${currentBusinessName})`}
                </h4>
                <p className="text-xs text-slate-300 max-w-xl leading-relaxed">
                  {lang === "en"
                    ? "Passcodes are strictly excluded. The downloaded file includes automated timestamps and full relational integrity for offline safety."
                    : "Kata laluan dikecualikan secara selamat. Fail sandaran mengandungi cap masa automatik dan integriti data lengkap."}
                </p>
              </div>

              <button
                type="button"
                onClick={handleExportBackup}
                disabled={exporting || !isAdminAuthorized}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 text-white font-semibold text-xs rounded-lg flex items-center gap-2 cursor-pointer shrink-0 transition-all shadow-2xs disabled:cursor-not-allowed"
              >
                {exporting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-white" />
                    <span>{lang === "en" ? "Generating Backup..." : "Menjana Sandaran..."}</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 text-white" />
                    <span>{lang === "en" ? "Export Backup (.json)" : "Eksport Backup"}</span>
                  </>
                )}
              </button>
            </div>
          </section>

          {/* SECTION B: IMPORT & PEMULIHAN BACKUP */}
          <section className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200/90 shadow-2xs space-y-4">
            <div className="pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Upload className="w-4 h-4 text-blue-600" />
                <span>{lang === "en" ? "2. Import & Restore Backup (Import & Pemulihan)" : "2. Import & Pemulihan Sandaran Data"}</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === "en"
                  ? "Upload a validated SMARTCOST JSON backup file. Review conflicting products before confirming data restoration."
                  : "Muat naik fail sandaran JSON SMARTCOST yang sah. Semak rekod dan tentukan mod pengendalian konflik sebelum memulihkan data."}
              </p>
            </div>

            {/* File Upload Zone */}
            <div className="border-2 border-dashed border-slate-200 hover:border-blue-400 rounded-xl p-6 text-center transition-all bg-slate-50/50">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileChange}
                disabled={!isAdminAuthorized || importing}
                className="hidden"
                id="smartcost-backup-file-input"
              />
              <label
                htmlFor="smartcost-backup-file-input"
                className="cursor-pointer flex flex-col items-center justify-center space-y-2"
              >
                <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-200">
                  <FileJson className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-xs font-bold text-slate-800 hover:text-blue-600">
                    {selectedFileName || (lang === "en" ? "Click to choose SMARTCOST Backup (.json)" : "Klik untuk memilih fail Sandaran (.json)")}
                  </span>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {lang === "en" ? "Supported formats: UTF-8 JSON up to 10MB" : "Format disokong: JSON (UTF-8) sehingga 10MB"}
                  </p>
                </div>
              </label>
            </div>

            {/* VALIDATION PREVIEW REPORT */}
            {validationResult && (
              <div className="mt-4 p-4 rounded-xl border space-y-3 animate-slideUp bg-slate-50 border-slate-200">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    {validationResult.valid ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-600" />
                    )}
                    <span className="text-xs font-bold text-slate-900">
                      {validationResult.valid
                        ? (lang === "en" ? "Validation Successful: Valid Backup File" : "Pengesahan Berjaya: Fail Sandaran Sah")
                        : (lang === "en" ? "Validation Failed: Invalid File" : "Pengesahan Gagal: Fail Tidak Sah")}
                    </span>
                  </div>
                  {validationResult.metadata && (
                    <span className="text-[10px] font-mono text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                      v{validationResult.metadata.backupVersion} • {validationResult.metadata.companyName}
                    </span>
                  )}
                </div>

                {validationResult.valid && validationResult.analysis ? (
                  <div className="space-y-3">
                    {/* Metrics Breakdown */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs">
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] text-slate-400 block uppercase">
                          {lang === "en" ? "In Backup" : "Dalam Fail"}
                        </span>
                        <span className="font-bold text-slate-800 text-sm">
                          {validationResult.analysis.totalProductsInBackup} {lang === "en" ? "products" : "produk"}
                        </span>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] text-slate-400 block uppercase">
                          {lang === "en" ? "New Records" : "Produk Baharu"}
                        </span>
                        <span className="font-bold text-emerald-600 text-sm">
                          +{validationResult.analysis.newProductsCount}
                        </span>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] text-slate-400 block uppercase">
                          {lang === "en" ? "Conflicts" : "Bertindih (Konflik)"}
                        </span>
                        <span className="font-bold text-amber-600 text-sm">
                          {validationResult.analysis.existingConflictsCount}
                        </span>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] text-slate-400 block uppercase">
                          {lang === "en" ? "Materials" : "Bahan Mentah"}
                        </span>
                        <span className="font-bold text-slate-700 text-sm">
                          {validationResult.analysis.totalMaterials}
                        </span>
                      </div>
                    </div>

                    {/* Conflicting Products Warning if present */}
                    {validationResult.analysis.existingConflictsCount > 0 && (
                      <div className="p-3 bg-amber-50 border border-amber-200/90 rounded-lg text-[11px] text-amber-900 space-y-1">
                        <div className="font-bold flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                          <span>
                            {lang === "en"
                              ? `Conflict Warning: ${validationResult.analysis.existingConflictsCount} product(s) overlap with current records.`
                              : `Amaran Pertindihan: Terdapat ${validationResult.analysis.existingConflictsCount} produk dengan nama/ID yang sama.`}
                          </span>
                        </div>
                        <p className="text-amber-800">
                          {lang === "en" ? "Overlapping products: " : "Produk bertindih: "}
                          <strong>{validationResult.analysis.conflictingProductNames.join(", ")}</strong>
                        </p>
                      </div>
                    )}

                    {/* Company mismatch warning */}
                    {validationResult.metadata?.companyName &&
                      validationResult.metadata.companyName.toLowerCase().trim() !== currentBusinessName.toLowerCase().trim() && (
                        <div className="p-3 bg-sky-50 border border-sky-200 rounded-lg text-[11px] text-sky-900 flex items-center gap-2">
                          <Info className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                          <span>
                            {lang === "en"
                              ? `Notice: This backup originated from '${validationResult.metadata.companyName}'. It will be restored safely into active company '${currentBusinessName}'.`
                              : `Makluman: Sandaran ini berasal dari '${validationResult.metadata.companyName}'. Ia akan diimport secara selamat ke dalam perniagaan aktif '${currentBusinessName}'.`}
                          </span>
                        </div>
                      )}

                    {/* CONFLICT HANDLING MODE SELECTOR */}
                    <div className="pt-2 border-t border-slate-200 space-y-2">
                      <label className="text-xs font-bold text-slate-800 block">
                        {lang === "en" ? "Choose Conflict Resolution Strategy:" : "Pilih Mod Pengendalian Rekod Bertindih:"}
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        <label
                          className={`p-3 rounded-lg border cursor-pointer transition-all flex items-start gap-2.5 ${
                            importMode === "insert_only"
                              ? "border-blue-600 bg-blue-50/60 text-slate-900"
                              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                          }`}
                        >
                          <input
                            type="radio"
                            name="import_mode"
                            value="insert_only"
                            checked={importMode === "insert_only"}
                            onChange={() => setImportMode("insert_only")}
                            className="mt-0.5"
                          />
                          <div>
                            <span className="font-bold block">
                              {lang === "en" ? "Insert Only (Skip Existing)" : "Tambah Sahaja (Langkau Bertindih)"}
                            </span>
                            <span className="text-[11px] text-slate-500 leading-relaxed block mt-0.5">
                              {lang === "en"
                                ? "Only imports new products. Existing records are untouched and fully preserved."
                                : "Hanya menambah produk baharu. Rekod sedia ada tidak akan disentuh atau ditimpa."}
                            </span>
                          </div>
                        </label>

                        <label
                          className={`p-3 rounded-lg border cursor-pointer transition-all flex items-start gap-2.5 ${
                            importMode === "upsert"
                              ? "border-blue-600 bg-blue-50/60 text-slate-900"
                              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                          }`}
                        >
                          <input
                            type="radio"
                            name="import_mode"
                            value="upsert"
                            checked={importMode === "upsert"}
                            onChange={() => setImportMode("upsert")}
                            className="mt-0.5"
                          />
                          <div>
                            <span className="font-bold block">
                              {lang === "en" ? "Update Existing (Upsert)" : "Kemas Kini / Timpa (Upsert)"}
                            </span>
                            <span className="text-[11px] text-slate-500 leading-relaxed block mt-0.5">
                              {lang === "en"
                                ? "Updates matched recipes & costs with backup data, and inserts new products."
                                : "Mengemas kini resipi produk sedia ada yang sepadan, dan menambah produk baharu."}
                            </span>
                          </div>
                        </label>
                      </div>
                    </div>

                    {/* RESTORE ACTION BUTTON */}
                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setIsConfirmModalOpen(true)}
                        disabled={importing || !isAdminAuthorized}
                        className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center gap-2 cursor-pointer transition-all shadow-xs"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
                        <span>{lang === "en" ? "Restore Backup Data" : "Pulihkan Sandaran Data"}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-rose-700">
                    <p className="font-semibold">{validationResult.error}</p>
                    {validationResult.warnings.map((w, idx) => (
                      <p key={idx} className="mt-0.5 text-[11px] text-rose-600">• {w}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* SECTION C: LOG AUDIT PENTADBIRAN */}
          <section className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200/90 shadow-2xs space-y-4">
            <div className="pb-3 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-600" />
                  <span>{lang === "en" ? "3. Admin Backup Audit Log" : "3. Log Audit Sandaran & Pemulihan"}</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {lang === "en"
                    ? "Verified timeline of export, import, and restoration activities."
                    : "Rekod jejak sejarah aktiviti eksport, import, dan pemulihan data pentadbir."}
                </p>
              </div>

              <button
                type="button"
                onClick={fetchAuditLogs}
                disabled={loadingAudit}
                className="px-2.5 py-1 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded text-xs flex items-center gap-1.5 cursor-pointer"
                title={lang === "en" ? "Refresh audit trail" : "Muat semula log"}
              >
                <RefreshCw className={`w-3 h-3 ${loadingAudit ? "animate-spin" : ""}`} />
                <span>{lang === "en" ? "Refresh" : "Muat Semula"}</span>
              </button>
            </div>

            {auditLogs.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-lg border border-slate-200">
                {lang === "en" ? "No backup or restore activities recorded yet." : "Tiada rekod aktiviti sandaran atau pemulihan lagi."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 text-[10px] uppercase">
                      <th className="pb-2 font-bold">{lang === "en" ? "Time" : "Masa"}</th>
                      <th className="pb-2 font-bold">{lang === "en" ? "Action" : "Tindakan"}</th>
                      <th className="pb-2 font-bold">{lang === "en" ? "User" : "Pengguna"}</th>
                      <th className="pb-2 font-bold">{lang === "en" ? "Records" : "Rekod"}</th>
                      <th className="pb-2 font-bold">{lang === "en" ? "Status" : "Status"}</th>
                      <th className="pb-2 font-bold">{lang === "en" ? "Details" : "Keterangan"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 pr-2 text-slate-500 whitespace-nowrap text-[11px]">
                          {new Date(log.timestamp).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="py-2.5 pr-2 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              log.action === "EXPORT"
                                ? "bg-blue-100 text-blue-700"
                                : log.action === "IMPORT"
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {log.action}
                          </span>
                        </td>
                        <td className="py-2.5 pr-2 whitespace-nowrap font-bold text-slate-800">
                          {log.username}
                        </td>
                        <td className="py-2.5 pr-2 whitespace-nowrap text-slate-600">
                          {log.recordsCount ?? "-"}
                        </td>
                        <td className="py-2.5 pr-2 whitespace-nowrap">
                          <span className="text-emerald-600 font-bold flex items-center gap-1">
                            <Check className="w-3 h-3" />
                            {log.status}
                          </span>
                        </td>
                        <td className="py-2.5 text-slate-600 text-[11px] truncate max-w-xs font-sans">
                          {log.details}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* SECTION D: SYSTEM MASTER DUMP (Superuser only) */}
          {!isAdminScoped && (
            <section className="bg-white rounded-xl p-5 border border-slate-200 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-mono">
                    Developer Superuser: Raw Storage Dump
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Export entire raw key-value store across all company partitions.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleExportFullDump}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-sky-400" />
                  <span>Download Master Dump</span>
                </button>
              </div>
            </section>
          )}
        </div>
      )}

      {/* 5. SUB-PANEL 3: SERVER & DATABASE MANAGEMENT (DEVELOPER ONLY) */}
      {activeConsoleTab === "infra" && isRealDeveloperSuperuser && (
        <ServerDatabaseManagement
          isRealDeveloperSuperuser={isRealDeveloperSuperuser}
          lang={lang}
        />
      )}

      {/* CONFIRMATION RESTORE MODAL */}
      {isConfirmModalOpen && validationResult?.analysis && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden animate-scaleIn">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-sm">
                  {lang === "en" ? "Confirm Data Restoration" : "Sahkan Pemulihan Sandaran Data"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs text-slate-700 leading-relaxed">
              <p>
                {lang === "en" ? (
                  <>
                    Are you sure you want to restore data into <strong>{currentBusinessName}</strong> using mode{" "}
                    <span className="font-mono font-bold uppercase text-blue-600">[{importMode}]</span>?
                  </>
                ) : (
                  <>
                    Adakah anda pasti ingin memulihkan data ke dalam perniagaan <strong>{currentBusinessName}</strong> menggunakan mod{" "}
                    <span className="font-mono font-bold uppercase text-blue-600">[{importMode === "insert_only" ? "Tambah Sahaja" : "Kemas Kini / Timpa"}]</span>?
                  </>
                )}
              </p>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span>{lang === "en" ? "New Products to Add:" : "Produk Baharu (Ditambah):"}</span>
                  <span className="font-bold text-emerald-600">+{validationResult.analysis.newProductsCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>{lang === "en" ? "Overlapping Records:" : "Produk Bertindih:"}</span>
                  <span className="font-bold text-amber-600">
                    {importMode === "upsert"
                      ? `${validationResult.analysis.existingConflictsCount} (akan dikemas kini)`
                      : `${validationResult.analysis.existingConflictsCount} (akan dilangkau)`}
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-slate-500 italic">
                {lang === "en"
                  ? "Existing unrelated business records and database partitions will be safely preserved."
                  : "Rekod perniagaan sedia ada yang tidak bertindih akan kekal selamat dan tidak terjejas."}
              </p>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                className="px-3.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold cursor-pointer"
              >
                {lang === "en" ? "Cancel" : "Batal"}
              </button>
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={importing}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                {importing && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{lang === "en" ? "Confirm & Restore" : "Sahkan & Pulihkan Data"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
