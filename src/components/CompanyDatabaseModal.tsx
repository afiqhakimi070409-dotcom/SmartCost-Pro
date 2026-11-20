/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import {
  Database,
  Building2,
  Download,
  Upload,
  Plus,
  CheckCircle2,
  X,
  Sparkles,
  AlertCircle,
  FileSpreadsheet,
  ArrowRightLeft,
  ShieldCheck,
  Terminal,
  Lock,
  Search,
  Check,
  RefreshCw,
  Trash2,
  Edit3,
  Archive,
  ArchiveRestore,
  AlertTriangle
} from "lucide-react";
import {
  CompanyDatabaseFile,
  UserRole,
  ROLE_DEFINITIONS
} from "../types";
import { createEmptyBusinessDatabase } from "../data/defaultTemplates";
import { Language, getStoredLanguage } from "../utils/i18n";
import { handleInputEnterKey } from "../utils/inputNavigation";
import { NoSearchResults, EmptyState } from "./UIStates";
import { getAuthFetchHeaders, saveServerSessionToken } from "../utils/authSessionClient";
import { deleteCompanyFromFirestore } from "../utils/firestoreSync";
import DeveloperAuthModal from "./DeveloperAuthModal";
import { apiUrl } from "../utils/apiBase";
import { validateAndReadJsonFile } from "../utils/fileUploadSecurity";

export const DEV_SANDBOX_DB_KEY = "pengekosan_dev_sandbox_db";

interface CompanyDatabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentCompanyName: string;
  onSwitchCompanyDb: (companyName: string, dbKey?: string) => void;
  onExportCompanyDb: () => void;
  onImportCompanyDb: (dbData: CompanyDatabaseFile) => void;
  userRole?: UserRole;
  isVerifiedDeveloper?: boolean;
  onCloneToSandbox?: (dbKey: string, companyName: string) => void;
  onReturnToSandbox?: () => void;
  onDatabaseDeleted?: (deletedDbKey: string, nextActiveDbKey?: string, recreatedDbKey?: string) => void;
  activeLoadedDbKey?: string;
  systemLang?: Language;
  currentUserEmail?: string;
  currentUsername?: string;
}

export interface SavedCompanyDbInfo {
  companyName: string;
  dbKey: string;
  updatedAt: string;
  productCount: number;
  isSandbox?: boolean;
  owner?: string;
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
}

export const getCompanyDbKey = (companyName: string): string => {
  const sanitized = companyName.toLowerCase().trim().replace(/[^a-z0-9]/g, "_");
  return `pengekosan_company_db_${sanitized || "school_enterprise"}`;
};

export default function CompanyDatabaseModal({
  isOpen,
  onClose,
  currentCompanyName,
  onSwitchCompanyDb,
  onExportCompanyDb,
  onImportCompanyDb,
  userRole = "admin",
  isVerifiedDeveloper = false,
  onCloneToSandbox,
  onReturnToSandbox,
  onDatabaseDeleted,
  activeLoadedDbKey,
  systemLang,
  currentUserEmail,
}: CompanyDatabaseModalProps) {
  const lang: Language = systemLang || getStoredLanguage();
  const [savedCompanies, setSavedCompanies] = useState<SavedCompanyDbInfo[]>([]);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);
  const [activeFilter, setActiveFilter] = useState<"all" | "unused" | "active" | "archived">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Rename state
  const [renameTarget, setRenameTarget] = useState<SavedCompanyDbInfo | null>(null);
  const [renameInput, setRenameInput] = useState("");

  // Delete Confirmation state
  const [deleteTarget, setDeleteTarget] = useState<SavedCompanyDbInfo | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletePadamText, setDeletePadamText] = useState("");
  const [confirmActiveChecked, setConfirmActiveChecked] = useState(false);
  const [dialogFeedback, setDialogFeedback] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [reauthModalOpen, setReauthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<"reauth" | "refresh">("reauth");
  const [pendingDeleteAction, setPendingDeleteAction] = useState<{
    target: SavedCompanyDbInfo;
    confirmName: string;
    padamWord: string;
    confirmActiveDatabase: boolean;
    dbStatus: string;
  } | null>(null);

  const isDeveloper = Boolean(isVerifiedDeveloper);
  const roleDef = ROLE_DEFINITIONS[userRole] || ROLE_DEFINITIONS.admin;

  const isSystemInfrastructureDb = (comp: {
    dbKey: string;
    isSandbox?: boolean;
    isSystemInfrastructure?: boolean;
  }) => {
    const k = (comp.dbKey || "").trim().toLowerCase();
    return (
      Boolean(comp.isSystemInfrastructure) ||
      Boolean(comp.isSandbox) ||
      k === DEV_SANDBOX_DB_KEY ||
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

  // Load archived keys from localStorage
  const getArchivedKeys = (): string[] => {
    try {
      const raw = localStorage.getItem("smartcost_archived_databases");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };

  const saveArchivedKeys = (keys: string[]) => {
    try {
      localStorage.setItem("smartcost_archived_databases", JSON.stringify(keys));
    } catch {}
  };

  // Load all company & user database keys stored in localStorage (+ server registry for Developer)
  const refreshCompanyList = async (): Promise<SavedCompanyDbInfo[]> => {
    if (!isDeveloper) {
      setSavedCompanies([]);
      return [];
    }
    const list: SavedCompanyDbInfo[] = [];
    const seenKeys = new Set<string>();
    const archivedKeys = getArchivedKeys();

    // 1. If developer, ensure Developer Sandbox is present in the list
    if (isDeveloper) {
      seenKeys.add(DEV_SANDBOX_DB_KEY);
      const rawSandbox = localStorage.getItem(DEV_SANDBOX_DB_KEY);
      let pCount = 1;
      let updatedAt = new Date().toISOString();
      if (rawSandbox) {
        try {
          const parsed = JSON.parse(rawSandbox);
          pCount = Array.isArray(parsed.templates) ? parsed.templates.length : 1;
          updatedAt = parsed.updatedAt || updatedAt;
        } catch {}
      }
      list.push({
        companyName: lang === "en" ? "DEVELOPER SANDBOX (DEV WORKSPACE)" : "SANDBOX PEMBANGUN (DEV WORKSPACE)",
        dbKey: DEV_SANDBOX_DB_KEY,
        updatedAt,
        productCount: pCount,
        isSandbox: true,
        owner: "developer (root)",
        isArchived: archivedKeys.includes(DEV_SANDBOX_DB_KEY),
      });
    }

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (
          key &&
          !key.endsWith("_templates") &&
          (key.startsWith("pengekosan_company_db_") || key.startsWith("pengekosan_userdb_"))
        ) {
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          const valStr = localStorage.getItem(key);
          if (valStr) {
            try {
              const parsed = JSON.parse(valStr);
              const isUserDb = key.startsWith("pengekosan_userdb_");
              const fallbackName = isUserDb 
                ? (lang === "en" ? `User Database (${key.replace("pengekosan_userdb_", "")})` : `Pangkalan Data Pengguna (${key.replace("pengekosan_userdb_", "")})`)
                : key.replace("pengekosan_company_db_", "").toUpperCase();

              list.push({
                companyName: parsed.config?.namaSyarikat || parsed.companyName || fallbackName,
                dbKey: key,
                updatedAt: parsed.updatedAt || new Date().toISOString(),
                productCount: Array.isArray(parsed.templates) ? parsed.templates.length : 1,
                isSandbox: false,
                owner: parsed.ownerUsername || parsed.config?.usernameLogMasuk || "admin",
                isArchived: archivedKeys.includes(key),
              });
            } catch (e) {
              console.error("Error reading database key", key, e);
            }
          }
        }
      }
    } catch (e) {
      console.error("Error scanning localStorage for databases", e);
    }

    // Include all databases registered under currentUserEmail
    let userEmailAccounts: any[] = [];
    try {
      const regRaw = localStorage.getItem("pengekosan_registered_users");
      if (regRaw) {
        const parsedUsers = JSON.parse(regRaw);
        if (currentUserEmail) {
          userEmailAccounts = parsedUsers.filter((u: any) => u.email && u.email.toLowerCase() === currentUserEmail.toLowerCase());
        }
      }
    } catch {}

    if (currentUserEmail && userEmailAccounts.length > 0) {
      userEmailAccounts.forEach((u: any) => {
        const key = u.dbKey || `pengekosan_userdb_${u.id}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          let pCount = 1;
          let updatedAt = u.registeredAt || new Date().toISOString();
          const raw = localStorage.getItem(key);
          if (raw) {
            try {
              const p = JSON.parse(raw);
              pCount = Array.isArray(p.templates) ? p.templates.length : 1;
              updatedAt = p.updatedAt || updatedAt;
            } catch {}
          }
          list.push({
            companyName: u.companyName,
            dbKey: key,
            updatedAt,
            productCount: pCount,
            isSandbox: false,
            owner: u.username || "admin",
            isArchived: archivedKeys.includes(key),
          });
        }
      });
    }

    // For verified developers, also merge server-side registered databases (including disconnected/idle/other-session DBs)
    if (isDeveloper) {
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
              seenKeys.add(rec.databaseId);
              list.push({
                companyName: rec.companyName || rec.databaseId,
                dbKey: rec.databaseId,
                updatedAt: rec.createdAt || new Date().toISOString(),
                productCount: 0,
                isSandbox: Boolean(rec.isSandbox),
                owner: rec.ownerUsername || "admin",
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

    setSavedCompanies(list);
    return list;
  };

  useEffect(() => {
    if (isOpen) {
      if (!isDeveloper) {
        setSavedCompanies([]);
      } else {
        refreshCompanyList();
      }
      setFeedback(null);
      setDialogFeedback(null);
      setDeleteTarget(null);
      setConfirmActiveChecked(false);
      setRenameTarget(null);
    }
  }, [isOpen, currentCompanyName, isDeveloper]);

  if (!isOpen) return null;

  if (!isDeveloper) {
    return (
      <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-backdrop">
        <div className="bg-white dark:bg-[#0f172a] w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border border-slate-200/90 dark:border-slate-800 p-6 sm:p-7 text-center space-y-4 animate-modal">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/60 mx-auto flex items-center justify-center">
            <Lock className="w-6 h-6" />
          </div>
          <div className="space-y-1.5">
            <h3 className="font-display font-bold text-base text-slate-900 dark:text-white">
              {lang === "en" ? "Access Restricted" : "Akses Dihadkan"}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {lang === "en"
                ? "You do not have access to this section."
                : "Anda tidak mempunyai akses ke bahagian ini."}
            </p>
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 bg-[#0b3c7a] hover:bg-[#093163] text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs"
            >
              {lang === "en" ? "Close" : "Tutup"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const activeDbKey = activeLoadedDbKey || getCompanyDbKey(currentCompanyName);
  const unusedCompanies = savedCompanies.filter((c) => c.dbKey !== activeDbKey && (!activeLoadedDbKey || c.dbKey !== activeLoadedDbKey));

  // Switch company database safely (Developer only, verified on backend for non-sandbox)
  const handleSwitchCompany = (targetCompName: string, dbKey?: string) => {
    if (!isDeveloper) return;
    if (dbKey && dbKey !== DEV_SANDBOX_DB_KEY) {
      getAuthFetchHeaders({ "Content-Type": "application/json" })
        .then((headers) =>
          fetch(apiUrl("/api/databases/inspect"), {
            method: "POST",
            credentials: "same-origin",
            headers,
            body: JSON.stringify({ databaseId: dbKey }),
          })
        )
        .catch(() => {});
    }
    onSwitchCompanyDb(targetCompName, dbKey);
    setFeedback({
      type: "success",
      msg: lang === "en"
        ? `Switched to database: ${targetCompName}`
        : `Berjaya beralih ke pangkalan data: ${targetCompName}`,
    });
  };

  // Create new company database (Developer only)
  const handleCreateCompanyDb = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDeveloper) return;
    const trimmed = newCompanyName.trim();
    if (!trimmed) return;

    const newKey = getCompanyDbKey(trimmed);

    if (savedCompanies.some((c) => c.dbKey === newKey)) {
      setFeedback({
        type: "error",
        msg: lang === "en"
          ? `A database for '${trimmed}' already exists!`
          : `Pangkalan data untuk '${trimmed}' sudah wujud!`,
      });
      return;
    }

    try {
      const newEmptyDb = createEmptyBusinessDatabase(trimmed, "admin");
      localStorage.setItem(newKey, JSON.stringify(newEmptyDb));
      getAuthFetchHeaders({ "Content-Type": "application/json" })
        .then((headers) =>
          fetch(apiUrl("/api/databases/register"), {
            method: "POST",
            credentials: "same-origin",
            headers,
            body: JSON.stringify({ databaseId: newKey, companyName: trimmed, explicitCreate: true }),
          })
        )
        .catch(() => {});

      setFeedback({
        type: "success",
        msg: lang === "en"
          ? `New database '${trimmed}' created successfully!`
          : `Pangkalan data baharu '${trimmed}' berjaya dicipta!`,
      });
      setNewCompanyName("");
      refreshCompanyList();
      onSwitchCompanyDb(trimmed, newKey);
    } catch (e) {
      setFeedback({
        type: "error",
        msg: lang === "en" ? "Failed to save new company database." : "Gagal menyimpan pangkalan data baharu.",
      });
    }
  };

  // Safe file upload / import backup handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isDeveloper) return;
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const readRes = await validateAndReadJsonFile(file, lang === "en" ? "en" : "ms");
    if (readRes.ok === false) {
      setFeedback({ type: "error", msg: readRes.error });
      return;
    }

    try {
      const parsed = readRes.data;
      if (!parsed.config || !parsed.templates || !parsed.bahanMentah) {
        throw new Error(lang === "en" ? "Invalid file structure." : "Format struktur fail sandaran tidak sah.");
      }

      const compName = parsed.companyName || parsed.config.namaSyarikat || "UNKNOWN";
      const key = getCompanyDbKey(compName);
      localStorage.setItem(key, JSON.stringify(parsed));
      getAuthFetchHeaders({ "Content-Type": "application/json" })
        .then((headers) =>
          fetch(apiUrl("/api/databases/register"), {
            method: "POST",
            credentials: "same-origin",
            headers,
            body: JSON.stringify({ databaseId: key, companyName: compName }),
          })
        )
        .catch(() => {});

      onImportCompanyDb(parsed);
      setFeedback({
        type: "success",
        msg: lang === "en"
          ? `Backup for '${compName}' restored successfully.`
          : `Sandaran data bagi '${compName}' berjaya dipulihkan.`,
      });
      refreshCompanyList();
    } catch (err: any) {
      setFeedback({
        type: "error",
        msg: lang === "en" ? `Error reading JSON file: ${err.message}` : `Ralat membaca fail sandaran JSON: ${err.message}`,
      });
    }
  };

  // Rename database action (Developer & Admin)
  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget) return;

    const newName = renameInput.trim();
    if (!newName) return;

    try {
      const raw = localStorage.getItem(renameTarget.dbKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        parsed.companyName = newName;
        if (parsed.config) parsed.config.namaSyarikat = newName;
        parsed.updatedAt = new Date().toISOString();
        localStorage.setItem(renameTarget.dbKey, JSON.stringify(parsed));
      }

      // Update registered users cache if matched
      try {
        const regRaw = localStorage.getItem("pengekosan_registered_users");
        if (regRaw) {
          const users = JSON.parse(regRaw);
          const updatedUsers = users.map((u: any) => {
            if (u.dbKey === renameTarget.dbKey || u.companyName === renameTarget.companyName) {
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
            body: JSON.stringify({ databaseId: renameTarget.dbKey, companyName: newName }),
          })
        )
        .catch(() => {});

      setFeedback({
        type: "success",
        msg: lang === "en"
          ? `Database renamed to '${newName}' successfully.`
          : `Pangkalan data berjaya dinamakan semula kepada '${newName}'.`,
      });
      setRenameTarget(null);
      refreshCompanyList();
    } catch {
      setFeedback({
        type: "error",
        msg: lang === "en" ? "Failed to rename database." : "Gagal menamakan semula pangkalan data.",
      });
    }
  };

  // Toggle Archive Database action
  const handleToggleArchive = (comp: SavedCompanyDbInfo) => {
    const archived = getArchivedKeys();
    let updatedArchived: string[];
    const isNowArchived = !comp.isArchived;

    if (isNowArchived) {
      updatedArchived = [...archived, comp.dbKey];
    } else {
      updatedArchived = archived.filter((k) => k !== comp.dbKey);
    }

    saveArchivedKeys(updatedArchived);
    setFeedback({
      type: "info",
      msg: isNowArchived
        ? (lang === "en" ? `Database '${comp.companyName}' moved to archive.` : `Pangkalan data '${comp.companyName}' telah diarkibkan.`)
        : (lang === "en" ? `Database '${comp.companyName}' restored from archive.` : `Pangkalan data '${comp.companyName}' dipulihkan dari arkib.`),
    });
    refreshCompanyList();
  };

  const handleExportTargetDbBackup = (target: SavedCompanyDbInfo) => {
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
    } catch {
      onExportCompanyDb();
    }
  };

  const getDatabaseStatusInfo = (comp: SavedCompanyDbInfo, isLocalActive: boolean) => {
    const isActiveState = isLocalActive || Boolean(comp.isActiveInSession) || (comp.activeSessionCount || 0) > 0;
    if (isActiveState) {
      return {
        code: "active" as const,
        isActive: true,
        label: comp.isSandbox
          ? (lang === "en" ? "Test Space Active" : "Ruang Ujian Aktif")
          : (lang === "en" ? "Active" : "Aktif"),
      };
    }
    if (comp.isArchived) {
      return {
        code: "archived" as const,
        isActive: false,
        label: lang === "en" ? "Archived" : "Diarkib",
      };
    }
    if (comp.isDisconnected) {
      return {
        code: "disconnected" as const,
        isActive: false,
        label: lang === "en" ? "Disconnected" : "Terputus",
      };
    }
    if (comp.productCount === 0) {
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

  const executeDeleteRequest = async (
    target: SavedCompanyDbInfo,
    confirmName: string,
    padamWord: string,
    confirmActiveDatabase: boolean,
    dbStatus: string,
    didRefreshSession = false
  ) => {
    setIsDeleting(true);
    setDialogFeedback(null);
    try {
      const delHeaders = await getAuthFetchHeaders({ "Content-Type": "application/json" });
      const deleteResp = await fetch(apiUrl("/api/auth/delete-company-db"), {
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

      const respData = await deleteResp.json().catch(() => ({}));

      if (!didRefreshSession && deleteResp.status === 401 && respData?.code === "SESSION_EXPIRED") {
        setAuthModalMode("refresh");
        setPendingDeleteAction({ target, confirmName, padamWord, confirmActiveDatabase, dbStatus });
        setReauthModalOpen(true);
        return;
      }

      if (!deleteResp.ok) {
        const serverErrorText = typeof respData?.error === "string" && respData.error.trim() ? respData.error.trim() : "";
        let msg: string;
        if (!isDeveloper) {
          msg = "Padam ditolak oleh pelayan.";
        } else if (serverErrorText) {
          msg = serverErrorText;
        } else if (deleteResp.status === 401) {
          msg = "Padam ditolak: Sesi pembangun telah tamat tempoh. Sila sahkan semula.";
        } else if (deleteResp.status === 403) {
          msg = "Padam ditolak: Tiada kebenaran pembangun yang sah untuk operasi ini.";
        } else {
          msg = "Padam ditolak: Ralat pelayan. Cuba lagi.";
        }
        throw new Error(msg);
      }

      if (respData.sessionToken || respData.csrfToken) {
        saveServerSessionToken(respData.sessionToken, respData.csrfToken);
      }

      // Firestore cloud doc cleanup strictly by unique dbKey
      const fsResult = await deleteCompanyFromFirestore(target.dbKey, {
        isServerVerifiedDev: isDeveloper,
        devEmail: currentUserEmail,
      });
      if (!fsResult.ok) {
        throw new Error(
          isDeveloper
            ? `Padam ditolak: ${fsResult.errorStep || "Ditolak oleh peraturan pangkalan data."}`
            : "Padam ditolak oleh pelayan."
        );
      }

      // Remove ONLY this database's data, chat history, and scoped caches from localStorage
      localStorage.removeItem(target.dbKey);
      try {
        if (localStorage.getItem("pengekosan_active_db_key") === target.dbKey) {
          localStorage.removeItem("pengekosan_active_db_key");
        }
        localStorage.removeItem(`mrcost_chat_history_v2_${target.dbKey}_en`);
        localStorage.removeItem(`mrcost_chat_history_v2_${target.dbKey}_ms`);
        localStorage.removeItem(`smartcost_db_cache_${target.dbKey}`);
        const hasSameNameSibling = savedCompanies.some(
          (c) => c.dbKey !== target.dbKey && c.companyName.trim().toLowerCase() === target.companyName.trim().toLowerCase()
        );
        if (!hasSameNameSibling) {
          localStorage.removeItem(`smartcost_audit_logs_${target.companyName}`);
        }
      } catch {}

      // Clean from archived keys
      const archived = getArchivedKeys().filter((k) => k !== target.dbKey);
      saveArchivedKeys(archived);

      onDatabaseDeleted?.(target.dbKey, respData.nextActiveDbKey);
      const updatedList = await refreshCompanyList();
      const stillPresent = updatedList.some((c) => c.dbKey === target.dbKey);
      if (stillPresent) {
        throw new Error(
          lang === "en"
            ? "Database deletion could not be verified. Please refresh and try again."
            : "Pemadaman database tidak dapat disahkan. Sila muat semula dan cuba lagi."
        );
      }

      setFeedback({
        type: "success",
        msg: respData.message || "Database dipadam.",
      });
      setDeleteTarget(null);
      setDeleteConfirmText("");
      setDeletePadamText("");
      setConfirmActiveChecked(false);
      setDialogFeedback(null);
      setPendingDeleteAction(null);
    } catch (err: any) {
      setDialogFeedback({
        type: "error",
        msg: err?.message || "Sebahagian data gagal dipadam: pelayan.",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // Safe Developer Database Deletion
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;

    if (!isDeveloper) {
      setDialogFeedback({
        type: "error",
        msg: "Padam ditolak oleh pelayan.",
      });
      return;
    }

    if (isSystemInfrastructureDb(deleteTarget)) {
      setDialogFeedback({
        type: "error",
        msg: lang === "en"
          ? "Delete rejected: Core system infrastructure is protected and cannot be deleted."
          : "Padam ditolak: Infrastruktur teras sistem dilindungi dan tidak boleh dipadam.",
      });
      return;
    }

    const isLocalActive = deleteTarget.dbKey === activeDbKey || Boolean(activeLoadedDbKey && deleteTarget.dbKey === activeLoadedDbKey);
    const statusInfo = getDatabaseStatusInfo(deleteTarget, isLocalActive);

    if (statusInfo.isActive && !confirmActiveChecked) {
      setDialogFeedback({
        type: "error",
        msg: lang === "en"
          ? "Please confirm that you want to delete an active database and disconnect active sessions."
          : "Sila sahkan pemadaman pangkalan data yang sedang aktif sebelum meneruskan.",
      });
      return;
    }

    if (deleteConfirmText.trim().toLowerCase() !== deleteTarget.companyName.trim().toLowerCase()) {
      setDialogFeedback({
        type: "error",
        msg: lang === "en"
          ? "Please type the exact database name to confirm."
          : "Sila taip nama database dengan tepat untuk meneruskan.",
      });
      return;
    }

    if (isDefaultBusinessDb(deleteTarget) && deletePadamText.trim().toUpperCase() !== "PADAM") {
      setDialogFeedback({
        type: "error",
        msg: lang === "en"
          ? "Default business database requires typing 'PADAM' as extra confirmation."
          : "Database perniagaan lalai memerlukan anda menaip 'PADAM' sebagai pengesahan tambahan.",
      });
      return;
    }

    await executeDeleteRequest(
      deleteTarget,
      deleteConfirmText.trim(),
      deletePadamText.trim(),
      statusInfo.isActive && confirmActiveChecked,
      statusInfo.code
    );
  };

  const displayedCompanies = savedCompanies.filter((comp) => {
    const isActive = comp.dbKey === activeDbKey || (activeLoadedDbKey && comp.dbKey === activeLoadedDbKey);
    if (activeFilter === "unused") {
      if (isActive || comp.isArchived) return false;
    } else if (activeFilter === "active") {
      if (!isActive) return false;
    } else if (activeFilter === "archived") {
      if (!comp.isArchived) return false;
    } else if (activeFilter === "all") {
      // By default in 'all', exclude archived unless searched
      if (comp.isArchived && !searchQuery.trim()) return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = comp.companyName.toLowerCase().includes(q);
      const matchKey = comp.dbKey.toLowerCase().includes(q);
      const matchOwner = (comp.owner || "").toLowerCase().includes(q);
      return matchName || matchKey || matchOwner;
    }

    return true;
  });

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-backdrop">
      <div className="bg-white dark:bg-[#0f172a] w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden border border-slate-200/90 dark:border-slate-800 flex flex-col max-h-[90vh] relative animate-modal">
        {/* Header */}
        <div className="p-5 sm:p-6 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/20 text-sky-400 flex items-center justify-center border border-sky-400/30">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-display font-bold tracking-tight text-white uppercase">
                  {lang === "en" ? "Company Databases" : "Pangkalan Data Syarikat"}
                </h2>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${roleDef.badgeColor}`}>
                  {lang === "en" ? roleDef.title : (userRole === "developer" ? "Pembangun Sistem" : roleDef.title)}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                {lang === "en"
                  ? "View, rename, archive, and manage company databases"
                  : "Lihat, namakan semula, arkib dan urus pangkalan data syarikat"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all cursor-pointer"
            aria-label="Tutup"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5">
          {feedback && (
            <div
              className={`p-3.5 rounded-xl text-xs font-medium flex items-center gap-2.5 ${
                feedback.type === "success"
                  ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                  : feedback.type === "info"
                  ? "bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800"
                  : "bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
              }`}
            >
              {feedback.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : feedback.type === "info" ? (
                <AlertCircle className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              )}
              <span>{feedback.msg}</span>
            </div>
          )}

          {/* Database Management Notice */}
          <div className="p-4 bg-gradient-to-r from-slate-900 via-[#0a2540] to-slate-900 text-white rounded-2xl border border-sky-500/30 shadow-xs space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                <h3 className="text-xs font-bold text-white tracking-wide uppercase">
                  {lang === "en" ? "Database Governance & Protection" : "Pengurusan & Perlindungan Pangkalan Data"}
                </h3>
              </div>
              <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold rounded-lg border border-emerald-400/30">
                {isDeveloper ? (lang === "en" ? "DEVELOPER ROOT ACCESS" : "AKSES PEMBANGUN AKTIF") : (lang === "en" ? "MANAGED WORKSPACE" : "RUANG KERJA TERLINDUNG")}
              </span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              {lang === "en"
                ? "Manage individual registered business databases. Authorized Developer accounts can view, rename, archive, or permanently delete any registered business database (active, inactive, idle, or default business DB) with confirmation guardrails. Core system infrastructure and user accounts remain protected."
                : "Urus pangkalan data perniagaan berasingan. Akaun Pembangun Sistem yang sah dibenarkan melihat, menamakan semula, mengarkib atau memadam sebarang pangkalan data perniagaan (aktif, tidak aktif, terbiar, atau lalai) melalui pengesahan. Infrastruktur teras sistem dan akaun pengguna dilindungi sepenuhnya."}
            </p>
          </div>

          {/* Backup & Restore Action Center */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Export Backup Card */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/80 flex flex-col justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Download className="w-4 h-4 text-[#0b3c7a] dark:text-sky-400 shrink-0" />
                  <h4 className="text-xs font-bold uppercase text-slate-800 dark:text-slate-100">
                    {lang === "en" ? "Export Database Backup" : "Eksport Sandaran Data"}
                  </h4>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  {lang === "en"
                    ? `Download a full JSON backup of '${currentCompanyName}' including all products, recipe sheets, and settings.`
                    : `Muat turun salinan sandaran JSON lengkap bagi '${currentCompanyName}' merangkumi semua produk, kos, dan tetapan.`}
                </p>
              </div>
              <button
                type="button"
                onClick={onExportCompanyDb}
                className="w-full py-2.5 px-4 bg-[#0b3c7a] hover:bg-[#093163] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs min-h-[40px]"
              >
                <Download className="w-4 h-4" />
                <span>{lang === "en" ? "Export Backup (.json)" : "Eksport Sandaran (.json)"}</span>
              </button>
            </div>

            {/* Restore Backup Card */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/80 flex flex-col justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Upload className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <h4 className="text-xs font-bold uppercase text-slate-800 dark:text-slate-100">
                    {lang === "en" ? "Restore Database Backup" : "Pulihkan Sandaran Data"}
                  </h4>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  {lang === "en"
                    ? "Upload an exported JSON backup file to safely restore product recipes, labor rates, and configurations."
                    : "Muat naik fail sandaran JSON untuk memulihkan formula kos, bahan mentah, dan tetapan dengan selamat."}
                </p>
              </div>
              <label className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs min-h-[40px]">
                <FileSpreadsheet className="w-4 h-4 text-emerald-100" />
                <span>{lang === "en" ? "Restore Backup (.json)" : "Pulihkan Sandaran (.json)"}</span>
                <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
          </div>

          {/* Create New Company Partition - DEVELOPER ACCESS */}
          {isDeveloper && (
            <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/70 space-y-3">
              <h4 className="text-xs font-mono font-bold uppercase text-slate-700 dark:text-slate-200 tracking-wider flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                {lang === "en" ? "Register New Business Partition" : "DAFTAR PANGKALAN DATA SYARIKAT BAHARU"}
              </h4>
              <form onSubmit={handleCreateCompanyDb} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  required
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  onKeyDown={(e) => handleInputEnterKey(e)}
                  placeholder={lang === "en" ? "Enter business name (e.g. Apex Caterers)..." : "Masukkan nama syarikat baharu (cth: Selera Klasik)..."}
                  className="flex-1 px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:border-[#0b3c7a] rounded-xl text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-100 outline-hidden min-h-[40px]"
                />
                <button
                  type="submit"
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs whitespace-nowrap min-h-[40px]"
                >
                  <Plus className="w-4 h-4" />
                  {lang === "en" ? "Create Partition" : "Cipta Pangkalan Data"}
                </button>
              </form>
            </div>
          )}

          {/* List of Saved Company Databases with Filter Tabs */}
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => handleInputEnterKey(e)}
                  placeholder={lang === "en" ? "Search databases by name, owner, or key..." : "Cari pangkalan data mengikut nama, pemilik, atau fail..."}
                  className="w-full pl-10 pr-8 py-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 focus:border-[#0b3c7a] rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 outline-hidden transition-all min-h-[38px]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                  >
                    ×
                  </button>
                )}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-xs font-mono font-bold uppercase text-slate-700 dark:text-slate-300 tracking-wider">
                    {lang === "en" ? "DATABASE DIRECTORY" : "SENARAI PANGKALAN DATA"} ({displayedCompanies.length}/{savedCompanies.length}):
                  </h4>
                  <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg text-[10px] font-bold">
                    <button
                      type="button"
                      onClick={() => setActiveFilter("all")}
                      className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                        activeFilter === "all" ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-xs" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      {lang === "en" ? "All" : "Semua"} ({savedCompanies.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveFilter("active")}
                      className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                        activeFilter === "active" ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-900 dark:text-emerald-300 font-extrabold shadow-xs" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      {lang === "en" ? "Active" : "Aktif"} (1)
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveFilter("unused")}
                      className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                        activeFilter === "unused" ? "bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-300 font-extrabold shadow-xs" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      {lang === "en" ? "Inactive" : "Tidak aktif"} ({unusedCompanies.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveFilter("archived")}
                      className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                        activeFilter === "archived" ? "bg-purple-100 dark:bg-purple-950 text-purple-900 dark:text-purple-300 font-extrabold shadow-xs" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      {lang === "en" ? "Archived" : "Arkib"} ({savedCompanies.filter(c => c.isArchived).length})
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
              {displayedCompanies.length === 0 ? (
                searchQuery ? (
                  <NoSearchResults
                    searchTerm={searchQuery}
                    onClearSearch={() => setSearchQuery("")}
                    onSelectSuggestion={(sug) => setSearchQuery(sug)}
                    suggestions={["school", "sandbox", "enterprise"]}
                    compact
                  />
                ) : (
                  <EmptyState
                    title={lang === "en" ? "No Databases Found" : "Tiada Rekod Penapis"}
                    description={
                      lang === "en"
                        ? "No saved entries match your active category filter. Clear the filter or create a new database."
                        : "Tiada profil tersimpan bagi kategori pilihan ini. Sila tetapkan semula carian atau daftarkan syarikat baharu."
                    }
                    actionLabel={lang === "en" ? "Reset Filter" : "Tetapkan Semula Penapis"}
                    onAction={() => {
                      setActiveFilter("all");
                      setSearchQuery("");
                    }}
                  />
                )
              ) : (
                displayedCompanies.map((comp) => {
                  const isActive = comp.dbKey === activeDbKey || (activeLoadedDbKey && comp.dbKey === activeLoadedDbKey);
                  const isInfraProtected = isSystemInfrastructureDb(comp);
                  const isDeleteDisabled = !isDeveloper || isInfraProtected;
                  const deleteTooltip = !isDeveloper
                    ? (lang === "en" ? "Only developers can delete this database." : "Hanya pembangun boleh memadam database.")
                    : isInfraProtected
                    ? (lang === "en" ? "Core system infrastructure is protected and cannot be deleted." : "Infrastruktur teras sistem dilindungi dan tidak boleh dipadam.")
                    : (lang === "en" ? "Delete this business database (developer mode)." : "Padam database perniagaan ini (mod pembangun).");

                  return (
                    <div
                      key={comp.dbKey}
                      className={`p-3.5 sm:p-4 rounded-2xl border flex flex-col md:flex-row md:items-center justify-between gap-3.5 transition-all ${
                        isActive
                          ? "bg-blue-50/80 dark:bg-sky-950/30 border-blue-200 dark:border-sky-800 shadow-xs"
                          : comp.isArchived
                          ? "bg-slate-100/60 dark:bg-slate-900/40 border-slate-300 dark:border-slate-800 opacity-75"
                          : "bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                            comp.isSandbox
                              ? "bg-slate-950 text-cyan-400 border border-cyan-500/50"
                              : isActive
                              ? "bg-[#0b3c7a] text-white"
                              : comp.isArchived
                              ? "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                          }`}
                        >
                          {comp.isSandbox ? <Terminal className="w-5 h-5" /> : comp.isArchived ? <Archive className="w-5 h-5" /> : <Building2 className="w-5 h-5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h5 className="font-display font-bold text-sm sm:text-base text-slate-900 dark:text-slate-100 break-words leading-snug">
                              {comp.companyName}
                            </h5>
                            {comp.isSandbox ? (
                              <span className="bg-slate-950 text-cyan-300 border border-cyan-400/50 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full uppercase shrink-0">
                                {lang === "en" ? "Test Space" : "Ruang Ujian"}
                              </span>
                            ) : null}
                            {comp.isArchived ? (
                              <span className="bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300 border border-purple-300 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase shrink-0">
                                {lang === "en" ? "Archived" : "Diarkib"}
                              </span>
                            ) : isActive || comp.isActiveInSession || (comp.activeSessionCount || 0) > 0 ? (
                              <span className="bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase border border-emerald-200 dark:border-emerald-800 shrink-0 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                {comp.isSandbox ? (lang === "en" ? "Test Space Active" : "Ruang Ujian Aktif") : (lang === "en" ? "Active" : "Aktif")}
                              </span>
                            ) : comp.isDisconnected ? (
                              <span className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase border border-slate-300 dark:border-slate-700 shrink-0">
                                {lang === "en" ? "Disconnected" : "Terputus"}
                              </span>
                            ) : comp.productCount === 0 ? (
                              <span className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase border border-slate-200 dark:border-slate-700 shrink-0">
                                {lang === "en" ? "Unused" : "Tidak Digunakan"}
                              </span>
                            ) : (
                              <span className="bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase border border-amber-200 dark:border-amber-800 shrink-0">
                                {lang === "en" ? "Inactive" : "Tidak Aktif"}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-slate-700 dark:text-slate-300">
                              {comp.productCount} {lang === "en" ? (comp.productCount === 1 ? "product" : "products") : "produk"}
                            </span>
                            <span className="text-slate-300 dark:text-slate-700">&bull;</span>
                            <span>{lang === "en" ? "Owner:" : "Pemilik:"} <strong>{comp.owner || "admin"}</strong></span>
                            <span className="text-slate-300 dark:text-slate-700">&bull;</span>
                            <code className="text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[10px] break-all border border-slate-200/80 dark:border-slate-700 font-mono font-medium">
                              {comp.dbKey}
                            </code>
                          </p>
                        </div>
                      </div>

                      {/* Action Buttons for Database */}
                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap sm:flex-nowrap justify-start md:justify-end pt-2 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800">
                        {/* 1. View / Switch Action */}
                        {!isActive ? (
                          <button
                            type="button"
                            onClick={() => handleSwitchCompany(comp.companyName, comp.dbKey)}
                            className={`px-3 py-1.5 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-xs whitespace-nowrap min-h-[36px] ${
                              comp.isSandbox
                                ? "bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono"
                                : "bg-[#0b3c7a] hover:bg-[#093163] text-white"
                            }`}
                            title={comp.isSandbox ? (lang === "en" ? "Open test workspace" : "Buka ruang ujian") : (lang === "en" ? "Switch / View Database" : "Lihat / Buka Pangkalan Data")}
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                            <span>{comp.isSandbox ? (lang === "en" ? "Open Test" : "Buka Ujian") : (lang === "en" ? "View / Switch" : "Lihat / Buka")}</span>
                          </button>
                        ) : (
                          <span className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs font-bold flex items-center gap-1.5 select-none min-h-[36px]">
                            <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            <span>{lang === "en" ? "Active" : "Sedang Aktif"}</span>
                          </span>
                        )}

                        {/* 2. Developer Action: Rename Database */}
                        {isDeveloper && !comp.isSandbox && (
                          <button
                            type="button"
                            onClick={() => {
                              setRenameTarget(comp);
                              setRenameInput(comp.companyName);
                            }}
                            className="p-2 text-slate-600 dark:text-slate-300 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer border border-slate-200 dark:border-slate-700 min-h-[36px] min-w-[36px] flex items-center justify-center"
                            title={lang === "en" ? "Rename Database" : "Namakan Semula Pangkalan Data"}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* 3. Developer Action: Archive / Restore Database */}
                        {isDeveloper && !comp.isSandbox && (
                          <button
                            type="button"
                            onClick={() => handleToggleArchive(comp)}
                            className="p-2 text-slate-600 dark:text-slate-300 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer border border-slate-200 dark:border-slate-700 min-h-[36px] min-w-[36px] flex items-center justify-center"
                            title={comp.isArchived ? (lang === "en" ? "Unarchive Database" : "Nyah-arkib Pangkalan Data") : (lang === "en" ? "Archive Database" : "Arkibkan Pangkalan Data")}
                          >
                            {comp.isArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                          </button>
                        )}

                        {/* 4. Developer Action: Delete Database (With Role, Default Protection & Confirmation Guards) */}
                        <span title={deleteTooltip} className={`inline-flex ${isDeleteDisabled ? "cursor-not-allowed" : ""}`}>
                          <button
                            type="button"
                            disabled={isDeleteDisabled}
                            aria-label={deleteTooltip}
                            onClick={() => {
                              setDeleteTarget(comp);
                              setDeleteConfirmText("");
                              setDeletePadamText("");
                              setConfirmActiveChecked(false);
                              setDialogFeedback(null);
                            }}
                            className={`p-2 rounded-xl transition-all border min-h-[36px] min-w-[36px] flex items-center justify-center ${
                              isDeleteDisabled
                                ? "opacity-30 cursor-not-allowed pointer-events-none border-slate-200 dark:border-slate-800 text-slate-400"
                                : "text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border-rose-200 dark:border-rose-900/60 cursor-pointer"
                            }`}
                            title={deleteTooltip}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Modal Rename Database */}
        {renameTarget && (
          <div className="fixed inset-0 z-60 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 max-w-md w-full border border-slate-200 dark:border-slate-700 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Edit3 className="w-4 h-4 text-blue-600" />
                  <span>{lang === "en" ? "Rename Database" : "Namakan Semula Pangkalan Data"}</span>
                </h4>
                <button
                  type="button"
                  onClick={() => setRenameTarget(null)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleRenameSubmit} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    {lang === "en" ? "Company / Database Name" : "Nama Pangkalan Data / Syarikat"}
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={renameInput}
                    onChange={(e) => setRenameInput(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 outline-hidden"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setRenameTarget(null)}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    {lang === "en" ? "Cancel" : "Batal"}
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-[#0b3c7a] hover:bg-[#093163] text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs"
                  >
                    {lang === "en" ? "Save Changes" : "Simpan Perubahan"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal Confirmation for Deleting Database (Safety Guard) */}
        {deleteTarget && (() => {
          const isTargetLocalActive = deleteTarget.dbKey === activeDbKey || Boolean(activeLoadedDbKey && deleteTarget.dbKey === activeLoadedDbKey);
          const targetStatusInfo = getDatabaseStatusInfo(deleteTarget, isTargetLocalActive);
          return (
          <div className="fixed inset-0 z-60 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-md w-full border border-rose-200 dark:border-rose-900/60 shadow-2xl space-y-4 animate-scaleUp max-h-[90vh] overflow-y-auto">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0 border border-rose-200 dark:border-rose-800">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-base text-rose-600 dark:text-rose-400">
                    {lang === "en" ? "Delete Database Permanently?" : "Padam Pangkalan Data Secara Kekal?"}
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    {lang === "en"
                      ? "All products, cost records, and Mr Cost chat history for this database will be permanently removed and cannot be undone."
                      : "Semua produk, rekod kos, dan sejarah chat Mr Cost bagi database ini akan dipadam secara kekal dan tidak boleh dikembalikan."}
                  </p>
                </div>
              </div>

              {targetStatusInfo.isActive && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 rounded-xl text-[11px] text-rose-900 dark:text-rose-200 space-y-2">
                  <p className="font-medium">
                    <strong>{lang === "en" ? "ACTIVE DATABASE WARNING:" : "AMARAN PANGKALAN DATA AKTIF:"}</strong>{" "}
                    {lang === "en"
                      ? "This database is currently active. Deleting it will terminate all active sessions using it and switch your workspace cleanly."
                      : "Pangkalan data ini sedang aktif. Memadamkannya akan menamatkan sesi aktif yang bersambung dan menukar ruang kerja anda secara automatik."}
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
                        ? "I understand and confirm deleting this currently active database."
                        : "Saya faham dan sahkan pemadaman pangkalan data yang sedang aktif ini."}
                    </span>
                  </label>
                </div>
              )}

              {isDefaultBusinessDb(deleteTarget) && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-xl text-[11px] text-amber-900 dark:text-amber-200 font-medium">
                  <strong>{lang === "en" ? "SPECIAL WARNING (Default Business Database):" : "AMARAN KHAS (Database Perniagaan Lalai):"}</strong>{" "}
                  {lang === "en"
                    ? "This is a default business database (not core system infrastructure). Deleting it will not automatically recreate it. Extra confirmation ('PADAM') is required."
                    : "Ini ialah database perniagaan lalai (bukan infrastruktur teras sistem). Pemadaman adalah kekal dan tidak akan dicipta semula secara automatik. Pengesahan tambahan ('PADAM') diperlukan."}
                </div>
              )}

              {/* Identified Target Database Details */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 text-xs space-y-1 font-mono">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">{lang === "en" ? "Database:" : "Pangkalan Data:"}</span>
                  <strong className="text-slate-900 dark:text-white font-sans text-right">{deleteTarget.companyName}</strong>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">{lang === "en" ? "Storage Key:" : "Kunci Storan:"}</span>
                  <span className="text-slate-600 dark:text-slate-300 truncate max-w-[200px]">{deleteTarget.dbKey}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">{lang === "en" ? "Classification:" : "Klasifikasi:"}</span>
                  <span className="text-slate-700 dark:text-slate-300 font-sans font-semibold text-right">
                    {isDefaultBusinessDb(deleteTarget)
                      ? (lang === "en" ? "Default Business Database" : "Database Perniagaan Lalai")
                      : (lang === "en" ? "Business Database" : "Database Perniagaan")}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">{lang === "en" ? "Status:" : "Status:"}</span>
                  <span className={`font-sans font-bold ${targetStatusInfo.isActive ? "text-emerald-600 dark:text-emerald-400" : "text-slate-700 dark:text-slate-300"}`}>
                    {targetStatusInfo.label}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">{lang === "en" ? "Owner:" : "Pemilik:"}</span>
                  <span className="text-slate-700 dark:text-slate-300">{deleteTarget.owner || "admin"}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">{lang === "en" ? "Products:" : "Jumlah Produk:"}</span>
                  <span className="text-slate-700 dark:text-slate-300">{deleteTarget.productCount}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleExportTargetDbBackup(deleteTarget)}
                className="w-full py-2 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer border border-slate-200 dark:border-slate-700"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{lang === "en" ? "Download Backup First (.json)" : "Muat Turun Sandaran Dahulu (.json)"}</span>
              </button>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  {lang === "en"
                    ? `Type '${deleteTarget.companyName}' to confirm:`
                    : `Taip '${deleteTarget.companyName}' untuk sahkan:`}
                </label>
                <input
                  type="text"
                  autoFocus
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={deleteTarget.companyName}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:border-rose-500 rounded-xl text-xs font-mono font-bold text-slate-800 dark:text-slate-100 outline-hidden"
                />
              </div>

              {isDefaultBusinessDb(deleteTarget) && (
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold text-rose-700 dark:text-rose-300">
                    {lang === "en"
                      ? "Type 'PADAM' as extra confirmation for default business database:"
                      : "Taip 'PADAM' sebagai pengesahan tambahan database perniagaan lalai:"}
                  </label>
                  <input
                    type="text"
                    value={deletePadamText}
                    onChange={(e) => setDeletePadamText(e.target.value)}
                    placeholder="PADAM"
                    className="w-full px-3 py-2 bg-rose-50/50 dark:bg-slate-800 border border-rose-300 dark:border-rose-700 focus:border-rose-600 rounded-xl text-xs font-mono font-bold text-slate-800 dark:text-slate-100 outline-hidden"
                  />
                </div>
              )}

              {dialogFeedback && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-xl text-xs font-medium text-rose-700 dark:text-rose-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <span>{dialogFeedback.msg}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => {
                    setDeleteTarget(null);
                    setDeleteConfirmText("");
                    setDeletePadamText("");
                    setConfirmActiveChecked(false);
                    setDialogFeedback(null);
                  }}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  {lang === "en" ? "Cancel" : "Batal"}
                </button>
                <button
                  type="button"
                  disabled={
                    isDeleting ||
                    (targetStatusInfo.isActive && !confirmActiveChecked) ||
                    deleteConfirmText.trim().toLowerCase() !== deleteTarget.companyName.trim().toLowerCase() ||
                    (isDefaultBusinessDb(deleteTarget) && deletePadamText.trim().toUpperCase() !== "PADAM")
                  }
                  onClick={handleConfirmDelete}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  {isDeleting ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  <span>{lang === "en" ? "Confirm Delete" : "Sahkan Padam"}</span>
                </button>
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
            setPendingDeleteAction(null);
            setIsDeleting(false);
            setDialogFeedback({
              type: "error",
              msg: "Pengesahan pembangun gagal.",
            });
          }}
          onSuccess={() => {
            setReauthModalOpen(false);
            if (pendingDeleteAction) {
              const next = pendingDeleteAction;
              setPendingDeleteAction(null);
              executeDeleteRequest(
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

        {/* Footer */}
        <div className="p-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="text-[11px] text-slate-600 dark:text-slate-300 font-mono">
              {lang === "en"
                ? "Protection Status: Core System Infrastructure & User Accounts Protected; Business DBs Managed by Developer"
                : "Status Perlindungan: Infrastruktur Teras Sistem & Akaun Pengguna Dilindungi Sepenuhnya"}
            </span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-bold text-xs rounded-xl transition-all cursor-pointer min-h-[38px] self-end sm:self-auto"
          >
            {lang === "en" ? "Close" : "Tutup"}
          </button>
        </div>
      </div>
    </div>
  );
}
