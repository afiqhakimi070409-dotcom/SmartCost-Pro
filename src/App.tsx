/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { defaultTemplates, createEmptyBusinessDatabase, TemplatPerniagaan } from "./data/defaultTemplates";
import { KonfigurasiSistem, BahanMentah, BuruhLangsung, OverheadBerubah, OverheadTetap } from "./types";
import { kiraRingkasanKosStandard, kiraRingkasanKosSebenar } from "./utils/costCalculations";

import LoginScreen from "./components/LoginScreen";
import DashboardOverview from "./components/DashboardOverview";
import StandardSheet from "./components/StandardSheet";
import ActualSheet from "./components/ActualSheet";
import VarianceSheet from "./components/VarianceSheet";
import BepSheet from "./components/BepSheet";
import BepChart from "./components/BepChart";
import StatementSheet from "./components/StatementSheet";
import SettingsSheet, { SettingsSubpage } from "./components/SettingsSheet";
import MrCostSheet from "./components/MrCostSheet";
import DeveloperAuthModal from "./components/DeveloperAuthModal";
import { isDeveloperShortcutEvent } from "./utils/devShortcut";
import CompanyDatabaseModal, { getCompanyDbKey } from "./components/CompanyDatabaseModal";
import { syncCompanyToFirestore, fetchCompanyFromFirestore } from "./utils/firestoreSync";
import { testFirestoreConnection, auth, onAuthStateChanged, logOut } from "./firebase";
import { apiUrl, getFetchCredentialsMode } from "./utils/apiBase";

import { 
  LayoutDashboard, 
  Coins, 
  TrendingUp, 
  Flame, 
  Scale, 
  LineChart, 
  FileText, 
  Settings, 
  LogOut, 
  Menu, 
  X, 
  Soup, 
  Layers, 
  Plus, 
  Bot, 
  Database, 
  Download, 
  Upload, 
  ArrowRightLeft, 
  ShieldCheck,
  Terminal,
  Cpu,
  Sparkles,
  Globe,
  RotateCcw,
  AlertCircle,
  Sun,
  Moon,
  ChevronDown
} from "lucide-react";
import { 
  CompanyDatabaseFile, 
  UserRole, 
  ROLE_DEFINITIONS, 
  RoleDefinition, 
  getActiveRoleDefinitions,
  ThemeMode
} from "./types";
import AccessMatrixModal from "./components/AccessMatrixModal";
import { DEV_SANDBOX_DB_KEY } from "./components/CompanyDatabaseModal";
import { Language, getTranslation, getStoredLanguage, setStoredLanguage } from "./utils/i18n";
import { getStoredTheme, setStoredTheme, applyThemeToDOM } from "./utils/theme";
import {
  SkeletonLoader,
  ErrorStateCard,
  NoInternetBanner,
  SlowNetworkNotice,
  NoSearchResults,
  PermissionDenied,
  SessionExpiredModal,
  FormFieldValidation,
  SuccessBanner
} from "./components/UIStates";
import { useNetworkAndSession } from "./utils/useNetworkAndSession";
import {
  getAuthFetchHeaders,
  saveServerSessionToken,
  clearServerSessionToken,
  getServerSessionToken,
} from "./utils/authSessionClient";

function toTitleCase(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .split(" ")
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ""))
    .join(" ");
}

export default function App() {
  // Session persistence across page refreshes
  const [currentUser, setCurrentUser] = useState<{
    id?: string;
    username: string;
    fullName: string;
    companyName?: string;
    role?: UserRole;
    email?: string;
    dbKey?: string;
  } | null>(() => {
    try {
      const sess = localStorage.getItem("pengekosan_current_session");
      if (sess) {
        const parsed = JSON.parse(sess);
        return parsed.user || null;
      }
    } catch {}
    return null;
  });

  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => {
    try {
      const sess = localStorage.getItem("pengekosan_current_session");
      if (sess) {
        const parsed = JSON.parse(sess);
        return Boolean(parsed.user);
      }
    } catch {}
    return false;
  });

  const [userRole, setUserRole] = useState<UserRole>(() => {
    try {
      const sess = localStorage.getItem("pengekosan_current_session");
      if (sess) {
        const parsed = JSON.parse(sess);
        // Never trust client-stored "developer" role prior to server session verification
        if (parsed.role && parsed.role !== "developer") {
          return parsed.role;
        }
        return "staf";
      }
    } catch {}
    return "admin";
  });

  // Never trust localStorage for Developer privilege; must be verified by server /api/auth/session
  const [isDevSuperuser, setIsDevSuperuser] = useState<boolean>(false);
  const [devAuthModalOpen, setDevAuthModalOpen] = useState<boolean>(false);

  const [roleDefs, setRoleDefs] = useState<Record<UserRole, RoleDefinition>>(getActiveRoleDefinitions());
  const [accessMatrixModalOpen, setAccessMatrixModalOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [settingsInitialSubpage, setSettingsInitialSubpage] = useState<SettingsSubpage | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [toast, setToast] = useState<{ message: string; type: "info" | "warning" | "error" | "success" } | null>(null);

  const [devEntryEnabled, setDevEntryEnabled] = useState<boolean>(true);
  const [sessionCheckDone, setSessionCheckDone] = useState<boolean>(false);
  const restrictedDbUrlAttemptRef = useRef<boolean>(false);

  // Strip/ignore any direct URL or hash tampering attempting to force developer tab or database directory
  useEffect(() => {
    const inspectRestrictedUrl = () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const tabParam = (params.get("tab") || "").toLowerCase();
        const roleParam = (params.get("role") || "").toLowerCase();
        const modalParam = (params.get("modal") || params.get("view") || params.get("section") || params.get("open") || "").toLowerCase();
        const hashVal = (window.location.hash || "").toLowerCase();
        const dbDirectoryPattern = /(database|pangkalan[-_]?data|company[-_]?db|db[-_]?(list|dir|directory|modal)|senarai)/i;

        const targetsDbDir =
          dbDirectoryPattern.test(tabParam) ||
          dbDirectoryPattern.test(modalParam) ||
          dbDirectoryPattern.test(hashVal);
        const targetsDev =
          tabParam.includes("dev") ||
          roleParam.includes("dev") ||
          modalParam.includes("dev") ||
          hashVal.includes("dev");

        if (targetsDbDir || targetsDev) {
          if (targetsDbDir) {
            restrictedDbUrlAttemptRef.current = true;
            if (isLoggedIn && !isDevSuperuser) {
              setCompanyDbModalOpen(true);
            }
          }
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } catch {}
    };

    inspectRestrictedUrl();
    window.addEventListener("hashchange", inspectRestrictedUrl);
    return () => window.removeEventListener("hashchange", inspectRestrictedUrl);
  }, [isLoggedIn, isDevSuperuser]);

  useEffect(() => {
    if (sessionCheckDone && isLoggedIn && !isDevSuperuser && restrictedDbUrlAttemptRef.current) {
      restrictedDbUrlAttemptRef.current = false;
      setCompanyDbModalOpen(true);
    }
  }, [sessionCheckDone, isLoggedIn, isDevSuperuser]);

  useEffect(() => {
    fetch(apiUrl("/api/config/features"), { credentials: getFetchCredentialsMode() })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cfg) {
          const enabled = typeof cfg.devEntryEnabled === "boolean"
            ? cfg.devEntryEnabled
            : (typeof cfg.devSandboxEnabled === "boolean" ? cfg.devSandboxEnabled : true);
          setDevEntryEnabled(enabled);
          if (!enabled) setDevAuthModalOpen(false);
        }
      })
      .catch(() => {});
  }, []);

  // Global Secret Developer Hotkey (ALT+D or configurable alternative)
  useEffect(() => {
    if (!devEntryEnabled) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isDeveloperShortcutEvent(e)) {
        e.preventDefault();
        e.stopPropagation();
        if (isDevSuperuser) {
          setUserRole("developer");
          setActiveTab("developer");
          setSettingsInitialSubpage("developer-console");
        } else {
          setDevAuthModalOpen(true);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDevSuperuser, devEntryEnabled]);

  const showToast = (message: string, type: "info" | "warning" | "error" | "success" = "warning") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  // System language state (default: English, can switch to Bahasa Melayu)
  const [systemLang, setSystemLang] = useState<Language>(() => {
    return getStoredLanguage();
  });
  const t = getTranslation(systemLang);

  // Visual theme state: "light" (Bright Mode) or "dark" (Dark Mode)
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());

  useEffect(() => {
    applyThemeToDOM(theme);
  }, [theme]);

  const handleToggleTheme = (newTheme?: ThemeMode) => {
    const nextTheme: ThemeMode = newTheme || (theme === "light" ? "dark" : "light");
    setTheme(nextTheme);
    setStoredTheme(nextTheme);
    const updatedConfig = { ...config, theme: nextTheme };
    setConfig(updatedConfig);
    saveStateToLocalStorage(updatedConfig, bahanMentah, buruhLangsung, overheadBerubah, overheadTetap);
  };

  const handleSetLanguage = (lang: Language) => {
    setSystemLang(lang);
    setStoredLanguage(lang);
    const updatedConfig = { ...config, language: lang };
    setConfig(updatedConfig);
    saveStateToLocalStorage(updatedConfig, bahanMentah, buruhLangsung, overheadBerubah, overheadTetap);
  };

  // Core App states
  const [config, setConfig] = useState<KonfigurasiSistem>(() => {
    const lang = getStoredLanguage();
    return {
      namaSyarikat: "SCHOOL ENTERPRISE",
      namaProduk: lang === "en" ? "Crispy Carbonara Rolls" : "Popia Cabonara Crispy",
      unitProduk: lang === "en" ? "rolls" : "batang",
      hargaJualanStandard: 4.00,
      hargaJualanSebenar: 4.00,
      sasaranKuantitiStandard: 1000,
      kuantitiSebenarDijual: 950,
      currency: "RM",
      usernameLogMasuk: "admin",
      kataLaluanLogMasuk: "",
      language: lang,
    };
  });
  const [bahanMentah, setBahanMentah] = useState<BahanMentah[]>([]);
  const [buruhLangsung, setBuruhLangsung] = useState<BuruhLangsung[]>([]);
  const [overheadBerubah, setOverheadBerubah] = useState<OverheadBerubah[]>([]);
  const [overheadTetap, setOverheadTetap] = useState<OverheadTetap[]>([]);

  // Products and Templates states
  const [activeProductId, setActiveProductId] = useState<string>("popia-cabonara");
  const [templates, setTemplates] = useState<TemplatPerniagaan[]>([]);

  // Hook for Network Status (State 04: No internet, State 05: Slow network) and Session Inactivity Draft-Saving (State 08)
  const getCurrentSnapshot = () => ({
    config,
    bahanMentah,
    buruhLangsung,
    overheadBerubah,
    overheadTetap,
    activeProductId,
    currentUser,
    timestamp: new Date().toISOString()
  });

  const {
    isOffline,
    isSlowNetwork,
    networkProgress,
    slowOperationLabel,
    isSessionExpired,
    checkConnection,
    dismissSlowNetwork,
    handleRestoreSession
  } = useNetworkAndSession(isLoggedIn, getCurrentSnapshot);

  const [isProductSwitching, setIsProductSwitching] = useState<boolean>(false);
  const [successBanner, setSuccessBanner] = useState<{ title: string; message: string; nextActionLabel?: string; onNextAction?: () => void } | null>(null);

  // Sync to localStorage or load from it if exists to support persistency
  useEffect(() => {
    testFirestoreConnection().catch(console.error);
    const unsubscribeAuth = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        let skipFirebaseOverride = Boolean(getServerSessionToken());
        if (!skipFirebaseOverride) {
          try {
            const rawSess = localStorage.getItem("pengekosan_current_session");
            if (rawSess) {
              const parsedSess = JSON.parse(rawSess);
              if (
                parsedSess?.isDev ||
                parsedSess?.role === "developer" ||
                parsedSess?.user?.authProvider === "manual"
              ) {
                skipFirebaseOverride = true;
              }
            }
          } catch {}
        }
        if (skipFirebaseOverride) return;

        try {
          const idToken = await fbUser.getIdToken();
          const currentDb = localStorage.getItem("pengekosan_active_db_key") || activeLoadedDbKey;
          const fbResp = await fetch(apiUrl("/api/auth/session-firebase"), {
            method: "POST",
            credentials: getFetchCredentialsMode(),
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              dbKey: currentDb,
              companyName: config.namaSyarikat,
            }),
          });
          if (fbResp.ok) {
            const fbData = await fbResp.json().catch(() => ({}));
            saveServerSessionToken(fbData.sessionToken, fbData.csrfToken);
          }
        } catch {}
      }
    });

    // Verify restored session & authoritative server role (enforces 30-min idle timeout & restores Alt+D/manual cookie sessions)
    (async () => {
      try {
        if (typeof auth.authStateReady === "function") {
          await auth.authStateReady();
        }
        const headers = await getAuthFetchHeaders();
        const probe = await fetch(apiUrl("/api/auth/session"), { credentials: getFetchCredentialsMode(), headers });
        if (probe.status === 401 || probe.status === 403) {
          try {
            localStorage.removeItem("pengekosan_current_session");
          } catch {}
          clearServerSessionToken();
          setIsLoggedIn(false);
          setCurrentUser(null);
          setIsDevSuperuser(false);
          return;
        }
        if (probe.ok) {
          const sessData = await probe.json().catch(() => null);
          if (sessData?.authenticated && sessData?.user && sessData?.role) {
            const serverIsDev = sessData.role === "developer" && Boolean(sessData.isVerifiedDeveloper);
            const verifiedRole: UserRole = serverIsDev
              ? "developer"
              : (sessData.role === "developer" ? "staf" : sessData.role);
            saveServerSessionToken(sessData.sessionToken, sessData.csrfToken);
            setCurrentUser(sessData.user);
            setIsLoggedIn(true);
            setIsDevSuperuser(serverIsDev);
            setUserRole(verifiedRole);
            try {
              localStorage.setItem(
                "pengekosan_current_session",
                JSON.stringify({
                  user: sessData.user,
                  role: verifiedRole,
                  isDev: serverIsDev,
                })
              );
            } catch {}
            if (!serverIsDev && activeTab === "developer") {
              setActiveTab("dashboard");
            }
            const targetKey = sessData.activeDbKey || sessData.user.dbKey;
            if (sessData.user.username) {
              setConfig((prev) => ({
                ...prev,
                usernameLogMasuk: sessData.user.username,
              }));
            }
            if (targetKey) {
              const targetComp =
                targetKey === DEV_SANDBOX_DB_KEY
                  ? "SANDBOX PEMBANGUN"
                  : (sessData.user.companyName || config.namaSyarikat);
              loadCompanyDatabase(
                targetComp,
                sessData.user.username,
                sessData.user.id,
                targetKey,
                serverIsDev
              );
            }
          }
        }
      } catch {} finally {
        setSessionCheckDone(true);
      }
    })();

    return () => {
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    const savedTemplates = localStorage.getItem("pengekosan_templates");
    let loadedTemplates = defaultTemplates;
    if (savedTemplates) {
      try {
        const parsed = JSON.parse(savedTemplates);
        if (Array.isArray(parsed) && parsed.length > 0) {
          loadedTemplates = parsed;
        }
      } catch (e) {
        loadedTemplates = defaultTemplates;
      }
    }

    const currentLang = getStoredLanguage();
    // Preserve saved company name and localize defaults safely
    const migratedTemplates = loadedTemplates.map(tpl => {
      const isPopia = tpl.id === "popia-cabonara" || (tpl.namaProduk || "").toLowerCase().includes("popia") || (tpl.namaProduk || "").toLowerCase().includes("rolls");
      const companyName = tpl.namaSyarikat || tpl.namaPerniagaan || currentUser?.companyName || "SCHOOL ENTERPRISE";
      const unit = currentLang === "en" 
        ? (isPopia ? "rolls" : (tpl.konfigurasi?.unitProduk || "units")) 
        : (isPopia ? "batang" : (tpl.konfigurasi?.unitProduk || "batang"));
      const prodName = currentLang === "en" && (tpl.namaProduk === "Popia Cabonara Crispy" || tpl.namaProduk === "Popia Carbonara Crispy")
        ? "Crispy Carbonara Rolls"
        : tpl.namaProduk;
      const currency = (!tpl.konfigurasi?.currency || tpl.konfigurasi.currency === "$") ? "RM" : tpl.konfigurasi.currency;

      return {
        ...tpl,
        namaProduk: prodName,
        namaSyarikat: companyName,
        namaPerniagaan: companyName,
        konfigurasi: {
          ...tpl.konfigurasi,
          namaProduk: prodName,
          namaSyarikat: companyName,
          unitProduk: unit,
          currency: currency
        }
      };
    });

    setTemplates(migratedTemplates);
    try {
      localStorage.setItem("pengekosan_templates", JSON.stringify(migratedTemplates));
    } catch {}

    const savedActiveId = localStorage.getItem("pengekosan_active_product_id") || "popia-cabonara";
    setActiveProductId(savedActiveId);

    // If an active authenticated session exists, restore their isolated company database
    if (currentUser) {
      loadCompanyDatabase(
        currentUser.companyName || config.namaSyarikat,
        currentUser.username,
        currentUser.id,
        currentUser.dbKey,
        Boolean(isDevSuperuser || userRole === "developer")
      );
    } else {
      const activeTpl = migratedTemplates.find(t => t.id === savedActiveId) || migratedTemplates[0];
      if (activeTpl) {
        const savedConfig = localStorage.getItem("pengekosan_config");
        const savedBahan = localStorage.getItem("pengekosan_bahan");
        const savedBuruh = localStorage.getItem("pengekosan_buruh");
        const savedOHB = localStorage.getItem("pengekosan_ohb");
        const savedOHT = localStorage.getItem("pengekosan_oht");

        let finalConfig: KonfigurasiSistem = activeTpl.konfigurasi;
        if (savedConfig) {
          try {
            finalConfig = JSON.parse(savedConfig);
          } catch {}
        }

        const initialLang = finalConfig.language || getStoredLanguage();
        const isPopiaActive = activeTpl.id === "popia-cabonara" || (activeTpl.namaProduk || "").toLowerCase().includes("popia") || (activeTpl.namaProduk || "").toLowerCase().includes("rolls");
        finalConfig = {
          ...finalConfig,
          namaSyarikat: finalConfig.namaSyarikat || "SCHOOL ENTERPRISE",
          namaProduk: initialLang === "en" && isPopiaActive ? "Crispy Carbonara Rolls" : (finalConfig.namaProduk || activeTpl.namaProduk),
          unitProduk: initialLang === "en" ? (isPopiaActive ? "rolls" : (finalConfig.unitProduk || "units")) : (finalConfig.unitProduk || "batang"),
          language: initialLang,
          currency: (!finalConfig.currency || finalConfig.currency === "$") ? "RM" : finalConfig.currency,
        };

        if (isPopiaActive && (finalConfig.hargaJualanStandard < 2.64 || finalConfig.hargaJualanStandard === 2.50 || finalConfig.hargaJualanStandard === 4.00)) {
          finalConfig.hargaJualanStandard = 4.49;
          finalConfig.hargaJualanSebenar = 4.49;
        }

        setConfig(finalConfig);
        setSystemLang(initialLang);

        let loadedBahan = activeTpl.bahanMentah;
        let loadedBuruh = activeTpl.buruhLangsung;
        let loadedOHB = activeTpl.overheadBerubah;
        let loadedOHT = activeTpl.overheadTetap;

        if (savedBahan) {
          try { loadedBahan = JSON.parse(savedBahan); } catch {}
        }
        if (savedBuruh) {
          try { loadedBuruh = JSON.parse(savedBuruh); } catch {}
        }
        if (savedOHB) {
          try { loadedOHB = JSON.parse(savedOHB); } catch {}
        }
        if (savedOHT) {
          try { loadedOHT = JSON.parse(savedOHT); } catch {}
        }

        if (initialLang === "en" && isPopiaActive) {
          const hasMalayBahan = loadedBahan.some((b: any) => b.nama && (b.nama.includes("Kulit") || b.nama.includes("Sos Carbonara") || b.nama.includes("Daging")));
          setBahanMentah(hasMalayBahan ? activeTpl.bahanMentah : loadedBahan);
          const hasMalayBuruh = loadedBuruh.some((b: any) => b.nama && (b.nama.includes("Pembuat") || b.nama.includes("Penggoreng")));
          setBuruhLangsung(hasMalayBuruh ? activeTpl.buruhLangsung : loadedBuruh);
          const hasMalayOHB = loadedOHB.some((b: any) => b.nama && (b.nama.includes("Gas Memasak") || b.nama.includes("Kotak Pembungkusan")));
          setOverheadBerubah(hasMalayOHB ? activeTpl.overheadBerubah : loadedOHB);
          const hasMalayOHT = loadedOHT.some((b: any) => b.nama && (b.nama.includes("Sewa Tapak") || b.nama.includes("Bil Elektrik")));
          setOverheadTetap(hasMalayOHT ? activeTpl.overheadTetap : loadedOHT);
        } else {
          setBahanMentah(loadedBahan);
          setBuruhLangsung(loadedBuruh);
          setOverheadBerubah(loadedOHB);
          setOverheadTetap(loadedOHT);
        }
      }
    }
  }, []);

  const [companyDbModalOpen, setCompanyDbModalOpen] = useState<boolean>(false);
  const [activeLoadedDbKey, setActiveLoadedDbKey] = useState<string>(() => {
    return localStorage.getItem("pengekosan_active_db_key") || getCompanyDbKey("SCHOOL ENTERPRISE");
  });
  const [isDevInspectingOtherDb, setIsDevInspectingOtherDb] = useState<boolean>(false);
  const [inspectedDbName, setInspectedDbName] = useState<string>("");

  // Helper to discover all registered or local company/user databases (Strictly Developer only)
  const getAllStoredDatabases = () => {
    if (!isDevSuperuser && userRole !== "developer") return [];
    const list: { name: string; key: string }[] = [];
    const seen = new Set<string>();

    // Developer Sandbox is always available at top
    list.push({
      name: systemLang === "en" ? "DEVELOPER SANDBOX (Independent & Isolated)" : "SANDBOX PEMBANGUN (Bebas & Terasing)",
      key: DEV_SANDBOX_DB_KEY,
    });
    seen.add(DEV_SANDBOX_DB_KEY);

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
              const isUserDb = key.startsWith("pengekosan_userdb_");
              const fallbackName = isUserDb 
                ? (systemLang === "en" ? `User (${key.replace("pengekosan_userdb_", "")})` : `Pengguna (${key.replace("pengekosan_userdb_", "")})`) 
                : key.replace("pengekosan_company_db_", "").toUpperCase();
              list.push({
                name: parsed.config?.namaSyarikat || parsed.companyName || fallbackName,
                key,
              });
            } catch {
              list.push({ name: key, key });
            }
          }
        }
      }
    } catch {}

    return list;
  };

  // Load specific company database (fully isolated per user/account, but developer is completely unbound to any DB)
  const loadCompanyDatabase = (
    companyNameInput: string,
    usernameInput?: string,
    userIdInput?: string,
    userDbKeyInput?: string,
    forceIsDev?: boolean
  ) => {
    const isDev = Boolean(forceIsDev) || userRole === "developer" || isDevSuperuser;
    const companyName = companyNameInput || config.namaSyarikat || "SCHOOL ENTERPRISE";
    const userKey = usernameInput || currentUser?.username || "admin";
    const userId = userIdInput || currentUser?.id;
    const isDefaultAdminDemo =
      !isDev &&
      userKey === "admin" &&
      (companyName === "SCHOOL ENTERPRISE" || !companyName) &&
      (!userId || userId === "admin-default");

    // Determine the isolated database key
    let targetDbKey: string;
    if (isDev) {
      // JAMINAN SIFAR GANGGUAN (ZERO COLLISION):
      // Developer tidak sesekali terikat dengan mana-mana database syarikat!
      if (userDbKeyInput && userDbKeyInput !== DEV_SANDBOX_DB_KEY) {
        // Developer memilih untuk memeriksa database lain dalam mod lihat sahaja
        targetDbKey = userDbKeyInput;
        setIsDevInspectingOtherDb(true);
        setInspectedDbName(companyName);
      } else if (companyNameInput && companyNameInput !== "SANDBOX PEMBANGUN" && companyNameInput !== "DEVELOPER SANDBOX" && !userDbKeyInput) {
        targetDbKey = getCompanyDbKey(companyNameInput);
        setIsDevInspectingOtherDb(true);
        setInspectedDbName(companyNameInput);
      } else {
        // Default for Developer: Isolated sandbox workspace
        targetDbKey = DEV_SANDBOX_DB_KEY;
        setIsDevInspectingOtherDb(false);
        setInspectedDbName("");
      }
    } else {
      setIsDevInspectingOtherDb(false);
      setInspectedDbName("");
      const ownAuthorizedKey =
        currentUser?.dbKey ||
        (userId && userId !== "admin-default" && userId !== "dev-master"
          ? `pengekosan_userdb_${userId}`
          : getCompanyDbKey(currentUser?.companyName || companyName));
      const isSchoolDefaultAlias =
        userId === "admin-default" &&
        (userDbKeyInput === "pengekosan_company_db_school_enterprise" ||
          userDbKeyInput === "pengekosan_company_db_school_enterprise_admin_default");
      if (userDbKeyInput && currentUser?.dbKey && userDbKeyInput !== currentUser.dbKey && !isSchoolDefaultAlias) {
        targetDbKey = ownAuthorizedKey;
      } else {
        targetDbKey = userDbKeyInput || ownAuthorizedKey;
      }
    }

    setActiveLoadedDbKey(targetDbKey);
    try {
      localStorage.setItem("pengekosan_active_db_key", targetDbKey);
    } catch {}
    (async () => {
      try {
        const headers = await getAuthFetchHeaders({ "Content-Type": "application/json" });
        if (headers["Authorization"] || headers["X-SmartCost-Session"]) {
          let activeResp: Response;
          if (localStorage.getItem(targetDbKey)) {
            const regResp = await fetch(apiUrl("/api/databases/register"), {
              method: "POST",
              credentials: getFetchCredentialsMode(),
              headers,
              body: JSON.stringify({ databaseId: targetDbKey, companyName }),
            }).catch(() => null);
            if (regResp && regResp.status === 410) {
              try {
                if (localStorage.getItem("pengekosan_active_db_key") === targetDbKey) {
                  localStorage.removeItem("pengekosan_active_db_key");
                }
                localStorage.removeItem(targetDbKey);
              } catch {}
              if (isDev && targetDbKey !== DEV_SANDBOX_DB_KEY) {
                setActiveLoadedDbKey(DEV_SANDBOX_DB_KEY);
                setIsDevInspectingOtherDb(false);
                setInspectedDbName("");
                try {
                  localStorage.setItem("pengekosan_active_db_key", DEV_SANDBOX_DB_KEY);
                } catch {}
                loadCompanyDatabase("SANDBOX PEMBANGUN", userKey, userId, DEV_SANDBOX_DB_KEY, true);
              } else if (!isDev) {
                showToast(
                  systemLang === "en"
                    ? "Your business database has been deleted."
                    : "Pangkalan data perniagaan ini telah dipadam.",
                  "warning"
                );
                handleLogout();
              }
              return;
            }
          }
          activeResp = await fetch(apiUrl("/api/databases/active"), {
            method: "POST",
            credentials: getFetchCredentialsMode(),
            headers,
            body: JSON.stringify({ databaseId: targetDbKey }),
          });
          if (activeResp.status === 410) {
            try {
              if (localStorage.getItem("pengekosan_active_db_key") === targetDbKey) {
                localStorage.removeItem("pengekosan_active_db_key");
              }
              localStorage.removeItem(targetDbKey);
            } catch {}
            if (isDev && targetDbKey !== DEV_SANDBOX_DB_KEY) {
              const fallbackTarget = DEV_SANDBOX_DB_KEY;
              const fallbackTitle = "SANDBOX PEMBANGUN";
              setActiveLoadedDbKey(fallbackTarget);
              setIsDevInspectingOtherDb(false);
              setInspectedDbName("");
              try {
                localStorage.setItem("pengekosan_active_db_key", fallbackTarget);
              } catch {}
              loadCompanyDatabase(fallbackTitle, userKey, userId, fallbackTarget, true);
            } else if (!isDev) {
              showToast(
                systemLang === "en"
                  ? "Your active business database has been deleted."
                  : "Pangkalan data perniagaan aktif telah dipadam.",
                "warning"
              );
              handleLogout();
            }
            return;
          }
          if (activeResp.ok) {
            const activeData = await activeResp.json().catch(() => ({}));
            saveServerSessionToken(activeData.sessionToken, activeData.csrfToken);
          }
        }
      } catch {}
    })();

    // Try finding data from targetDbKey first
    let savedDbStr = localStorage.getItem(targetDbKey);

    // If not found in targetDbKey, check if there's user ID key
    if (!savedDbStr && userId && !isDev) {
      savedDbStr = localStorage.getItem(`pengekosan_userdb_${userId}`);
    }

    // Fallback to company key if not isolated yet
    if (!savedDbStr && !isDev) {
      savedDbStr = localStorage.getItem(getCompanyDbKey(companyName));
    }

    let compDb: {
      version?: string;
      companyName?: string;
      templates: TemplatPerniagaan[];
      activeProductId: string;
      config: KonfigurasiSistem;
      bahanMentah: BahanMentah[];
      buruhLangsung: BuruhLangsung[];
      overheadBerubah: OverheadBerubah[];
      overheadTetap: OverheadTetap[];
      isDevSandbox?: boolean;
    } | null = null;

    if (savedDbStr) {
      try {
        compDb = JSON.parse(savedDbStr);
      } catch (e) {
        console.error("Error parsing company database:", e);
      }
    }

    const isRecreatedEmptyDefault = targetDbKey.toLowerCase().startsWith("pengekosan_company_db_school_enterprise_default");
    if (!compDb || !Array.isArray(compDb.templates) || compDb.templates.length === 0) {
      if (isDev && targetDbKey === DEV_SANDBOX_DB_KEY) {
        const sandboxName = systemLang === "en" ? "DEVELOPER SANDBOX" : "SANDBOX PEMBANGUN";
        const initialDevTemplates = defaultTemplates.map((tpl) => ({
          ...tpl,
          namaPerniagaan: sandboxName,
          namaSyarikat: sandboxName,
          konfigurasi: {
            ...tpl.konfigurasi,
            namaSyarikat: sandboxName,
            usernameLogMasuk: userKey || currentUser?.username || "",
          },
        }));

        const activeTpl = initialDevTemplates[0];
        compDb = {
          version: "2.0",
          companyName: sandboxName,
          templates: initialDevTemplates,
          activeProductId: activeTpl.id,
          config: activeTpl.konfigurasi,
          bahanMentah: activeTpl.bahanMentah,
          buruhLangsung: activeTpl.buruhLangsung,
          overheadBerubah: activeTpl.overheadBerubah,
          overheadTetap: activeTpl.overheadTetap,
          isDevSandbox: true,
        };
        try {
          localStorage.setItem(DEV_SANDBOX_DB_KEY, JSON.stringify(compDb));
        } catch {}
      } else if (isDefaultAdminDemo && !isRecreatedEmptyDefault) {
        // Sample demo account for default system admin
        const initialCompanyTemplates = defaultTemplates.map((tpl) => ({
          ...tpl,
          namaPerniagaan: companyName || "SCHOOL ENTERPRISE",
          namaSyarikat: companyName || "SCHOOL ENTERPRISE",
          konfigurasi: {
            ...tpl.konfigurasi,
            namaSyarikat: companyName || "SCHOOL ENTERPRISE",
            usernameLogMasuk: userKey,
          },
        }));

        const activeTpl = initialCompanyTemplates[0];

        compDb = {
          version: "2.0",
          companyName: companyName || "SCHOOL ENTERPRISE",
          templates: initialCompanyTemplates,
          activeProductId: activeTpl.id,
          config: activeTpl.konfigurasi,
          bahanMentah: activeTpl.bahanMentah,
          buruhLangsung: activeTpl.buruhLangsung,
          overheadBerubah: activeTpl.overheadBerubah,
          overheadTetap: activeTpl.overheadTetap,
        };
        try {
          localStorage.setItem(targetDbKey, JSON.stringify(compDb));
        } catch {}
      } else {
        // Any registered user, separated account, or cleanly recreated default DB starts empty
        compDb = createEmptyBusinessDatabase(companyName, userKey);
        try {
          localStorage.setItem(targetDbKey, JSON.stringify(compDb));
        } catch (e) {
          console.error("Gagal menyimpan database syarikat baharu:", e);
        }
      }
    }

    // Ensure default currency is RM and never hydrate stored/legacy passwords into client state
    if (!compDb.config.currency || compDb.config.currency === "$") {
      compDb.config.currency = "RM";
    }
    const resolvedAuthUsername = (userKey || currentUser?.username || compDb.config.usernameLogMasuk || "").trim();
    compDb.config = {
      ...compDb.config,
      ...(resolvedAuthUsername ? { usernameLogMasuk: resolvedAuthUsername } : {}),
      kataLaluanLogMasuk: "",
    };
    compDb.templates = compDb.templates.map(t => ({
      ...t,
      konfigurasi: {
        ...t.konfigurasi,
        currency: (!t.konfigurasi?.currency || t.konfigurasi.currency === "$") ? "RM" : t.konfigurasi.currency,
        ...(resolvedAuthUsername ? { usernameLogMasuk: resolvedAuthUsername } : {}),
        kataLaluanLogMasuk: "",
      }
    }));

    setTemplates(compDb.templates);
    setActiveProductId(compDb.activeProductId);
    setConfig(compDb.config);
    setBahanMentah(compDb.bahanMentah);
    setBuruhLangsung(compDb.buruhLangsung);
    setOverheadBerubah(compDb.overheadBerubah);
    setOverheadTetap(compDb.overheadTetap);

    try {
      localStorage.setItem("pengekosan_templates", JSON.stringify(compDb.templates));
      localStorage.setItem("pengekosan_active_product_id", compDb.activeProductId);
      localStorage.setItem("pengekosan_config", JSON.stringify(compDb.config));
      localStorage.setItem("pengekosan_bahan", JSON.stringify(compDb.bahanMentah));
      localStorage.setItem("pengekosan_buruh", JSON.stringify(compDb.buruhLangsung));
      localStorage.setItem("pengekosan_ohb", JSON.stringify(compDb.overheadBerubah));
      localStorage.setItem("pengekosan_oht", JSON.stringify(compDb.overheadTetap));
    } catch (e) {
      console.warn("[SmartCost DB] Storage write warning:", e);
    }

    // Seamless Firestore synchronization when user is authenticated with Firebase (strictly keyed by targetDbKey)
    if (auth.currentUser && !isDev) {
      fetchCompanyFromFirestore(targetDbKey, companyName).then((remoteData) => {
        if (remoteData && Array.isArray(remoteData.templates) && remoteData.templates.length > 0) {
          if (!savedDbStr) {
            setTemplates(remoteData.templates);
            if (remoteData.activeProductId) setActiveProductId(remoteData.activeProductId);
            if (remoteData.config) setConfig(remoteData.config);
            if (remoteData.bahanMentah) setBahanMentah(remoteData.bahanMentah);
            if (remoteData.buruhLangsung) setBuruhLangsung(remoteData.buruhLangsung);
            if (remoteData.overheadBerubah) setOverheadBerubah(remoteData.overheadBerubah);
            if (remoteData.overheadTetap) setOverheadTetap(remoteData.overheadTetap);

            try {
              localStorage.setItem(targetDbKey, JSON.stringify(remoteData));
            } catch {}
          }
        }
      }).catch((e) => {
        console.warn("[SmartCost] Firestore fetch notice:", e);
      });
    }
  };

  const saveStateToLocalStorage = (
    c: KonfigurasiSistem,
    bm: BahanMentah[],
    bl: BuruhLangsung[],
    ob: OverheadBerubah[],
    ot: OverheadTetap[],
    updatedTemplates?: TemplatPerniagaan[],
    actId?: string
  ) => {
    const safeConfigForStorage: KonfigurasiSistem = { ...c, kataLaluanLogMasuk: "" };
    try {
      localStorage.setItem("pengekosan_config", JSON.stringify(safeConfigForStorage));
      localStorage.setItem("pengekosan_bahan", JSON.stringify(bm));
      localStorage.setItem("pengekosan_buruh", JSON.stringify(bl));
      localStorage.setItem("pengekosan_ohb", JSON.stringify(ob));
      localStorage.setItem("pengekosan_oht", JSON.stringify(ot));
    } catch (e) {
      console.warn("[SmartCost DB] Storage write warning:", e);
    }

    const isDev = userRole === "developer" || isDevSuperuser;

    if (isDev) {
      // JAMINAN SIFAR GANGGUAN (ZERO-COLLISION GUARANTEE):
      // Akses developer TIDAK TERIKAT dengan mana-mana database yang ada!
      // Sebarang ujian formula, penambahan modul, atau suntingan oleh developer HANYA disimpan
      // di dalam Developer Sandbox (pengekosan_dev_sandbox_db).
      // Ia TIDAK AKAN sesekali menulis, mengacau, atau mengubah database syarikat lain!
      const devDb = {
        version: "2.0",
        companyName: isDevInspectingOtherDb ? `SANDBOX PEMBANGUN (Ujian: ${c.namaSyarikat})` : "SANDBOX PEMBANGUN",
        updatedAt: new Date().toISOString(),
        templates: updatedTemplates || templates,
        activeProductId: actId || activeProductId,
        config: safeConfigForStorage,
        bahanMentah: bm,
        buruhLangsung: bl,
        overheadBerubah: ob,
        overheadTetap: ot,
        isDevSandbox: true,
      };

      try {
        localStorage.setItem(DEV_SANDBOX_DB_KEY, JSON.stringify(devDb));
      } catch (e) {
        console.error("Gagal simpan ke sandbox pembangun:", e);
      }
      return; // BERHENTI DI SINI! Database syarikat lain (SCHOOL ENTERPRISE, dll.) dilindungi 100%!
    }

    const compName = c.namaSyarikat || config.namaSyarikat || "SCHOOL ENTERPRISE";
    const dbKey =
      currentUser?.dbKey ||
      (currentUser?.id && currentUser.id !== "admin-default" && currentUser.id !== "dev-master"
        ? `pengekosan_userdb_${currentUser.id}`
        : getCompanyDbKey(compName));

    const compDb = {
      version: "2.0",
      companyName: compName,
      updatedAt: new Date().toISOString(),
      templates: updatedTemplates || templates,
      activeProductId: actId || activeProductId,
      config: safeConfigForStorage,
      bahanMentah: bm,
      buruhLangsung: bl,
      overheadBerubah: ob,
      overheadTetap: ot,
    };

    try {
      const canonicalDbKey = activeLoadedDbKey || dbKey;
      localStorage.setItem(canonicalDbKey, JSON.stringify(compDb));
      if (!isDev) {
        if (currentUser?.dbKey && currentUser.dbKey !== canonicalDbKey && !activeLoadedDbKey) {
          localStorage.setItem(currentUser.dbKey, JSON.stringify(compDb));
        }
        // Seamlessly sync to Firebase Firestore cloud database strictly keyed by canonicalDbKey
        syncCompanyToFirestore(canonicalDbKey, { ...compDb, dbKey: canonicalDbKey }, canonicalDbKey).catch(console.error);
      }
    } catch (e) {
      console.warn("[SmartCost DB] Gagal menyimpan ke pangkalan data syarikat:", e);
    }
  };

  // Helper for Developer to clone any target company's DB into Sandbox for safe experimentation
  const handleCloneToDevSandbox = (sourceDbKey?: string, sourceCompanyName?: string) => {
    if (!isDevSuperuser) return;
    const keyToClone = sourceDbKey || activeLoadedDbKey;
    const raw = localStorage.getItem(keyToClone);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      const clonedName = parsed.config?.namaSyarikat || sourceCompanyName || "Syarikat Asal";
      const clonedTemplates = (parsed.templates || templates).map((tpl: any) => ({
        ...tpl,
        namaPerniagaan: `[SANDBOX KLON] ${clonedName}`,
        namaSyarikat: `[SANDBOX KLON] ${clonedName}`,
        konfigurasi: {
          ...(tpl.konfigurasi || {}),
          namaSyarikat: `[SANDBOX KLON] ${clonedName}`,
        },
      }));

      const clonedDb = {
        ...parsed,
        companyName: `SANDBOX PEMBANGUN (Klon: ${clonedName})`,
        updatedAt: new Date().toISOString(),
        templates: clonedTemplates,
        isDevSandbox: true,
      };

      localStorage.setItem(DEV_SANDBOX_DB_KEY, JSON.stringify(clonedDb));
      getAuthFetchHeaders({ "Content-Type": "application/json" })
        .then((headers) =>
          fetch(apiUrl("/api/databases/clone-sandbox"), {
            method: "POST",
            credentials: getFetchCredentialsMode(),
            headers,
            body: JSON.stringify({ databaseId: keyToClone }),
          })
        )
        .catch(() => {});
      loadCompanyDatabase("SANDBOX PEMBANGUN", currentUser?.username || "developer", currentUser?.id, DEV_SANDBOX_DB_KEY, true);
    } catch (e) {
      console.error("Gagal mengklon ke sandbox:", e);
    }
  };

  // Helper for Developer to immediately return to isolated sandbox
  const handleReturnToDevSandbox = () => {
    loadCompanyDatabase("SANDBOX PEMBANGUN", currentUser?.username || "developer", currentUser?.id, DEV_SANDBOX_DB_KEY);
  };

  // Switch gracefully to another database if the currently active database was deleted by Developer
  const handleDatabaseDeleted = (deletedDbKey: string, nextActiveDbKey?: string) => {
    if (!deletedDbKey) return;
    try {
      if (localStorage.getItem("pengekosan_active_db_key") === deletedDbKey) {
        localStorage.removeItem("pengekosan_active_db_key");
      }
    } catch {}

    const available = getAllStoredDatabases().filter((d) => d.key !== deletedDbKey);
    const hasSuggested =
      nextActiveDbKey &&
      nextActiveDbKey !== deletedDbKey &&
      (nextActiveDbKey === DEV_SANDBOX_DB_KEY || Boolean(localStorage.getItem(nextActiveDbKey)));
    const fallbackKey = hasSuggested
      ? nextActiveDbKey!
      : (isDevSuperuser ? DEV_SANDBOX_DB_KEY : (available.find((d) => d.key !== DEV_SANDBOX_DB_KEY)?.key || ""));
    const matched = available.find((d) => d.key === fallbackKey);
    const fallbackName =
      fallbackKey === DEV_SANDBOX_DB_KEY
        ? "SANDBOX PEMBANGUN"
        : (matched?.name || "SMARTCOST");

    if (currentUser?.dbKey === deletedDbKey) {
      const updatedUser = { ...currentUser, dbKey: fallbackKey };
      setCurrentUser(updatedUser);
      try {
        const rawSess = localStorage.getItem("pengekosan_current_session");
        if (rawSess) {
          const parsedSess = JSON.parse(rawSess);
          parsedSess.user = { ...(parsedSess.user || updatedUser), dbKey: fallbackKey };
          localStorage.setItem("pengekosan_current_session", JSON.stringify(parsedSess));
        }
      } catch {}
    }

    if (deletedDbKey !== activeLoadedDbKey) return;
    if (!fallbackKey && !isDevSuperuser) {
      handleLogout();
      return;
    }
    loadCompanyDatabase(fallbackName, currentUser?.username, currentUser?.id, fallbackKey || DEV_SANDBOX_DB_KEY, isDevSuperuser);
  };

  // Export company database file (.json)
  const handleExportCompanyDb = () => {
    const compName = config.namaSyarikat || "SCHOOL ENTERPRISE";
    const dbKey = getCompanyDbKey(compName);

    const companyDb: CompanyDatabaseFile = {
      version: "2.0",
      companyId: dbKey,
      companyName: compName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      templates,
      activeProductId,
      config,
      bahanMentah,
      buruhLangsung,
      overheadBerubah,
      overheadTetap,
    };

    const jsonString = JSON.stringify(companyDb, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const sanitizedFileName = compName.toLowerCase().replace(/[^a-z0-9]/g, "_");
    link.download = `database_syarikat_${sanitizedFileName}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Import company database file (.json)
  const handleImportCompanyDb = (dbFile: CompanyDatabaseFile) => {
    const compName = dbFile.config?.namaSyarikat || dbFile.companyName || "Syarikat Diimport";
    const dbKey = getCompanyDbKey(compName);

    setTemplates(dbFile.templates);
    setActiveProductId(dbFile.activeProductId);
    setConfig(dbFile.config);
    setBahanMentah(dbFile.bahanMentah);
    setBuruhLangsung(dbFile.buruhLangsung);
    setOverheadBerubah(dbFile.overheadBerubah);
    setOverheadTetap(dbFile.overheadTetap);

    localStorage.setItem(dbKey, JSON.stringify(dbFile));
    if (currentUser) {
      setCurrentUser((prev) => (prev ? { ...prev, companyName: compName } : null));
    }
  };

  const syncActiveStateToTemplates = (
    c: KonfigurasiSistem,
    bm: BahanMentah[],
    bl: BuruhLangsung[],
    ob: OverheadBerubah[],
    ot: OverheadTetap[],
    allTemplates: TemplatPerniagaan[],
    activeId: string
  ) => {
    const finalBusinessName = c.namaSyarikat || "SCHOOL ENTERPRISE";
    const updated = allTemplates.map(tpl => {
      if (tpl.id === activeId) {
        return {
          ...tpl,
          namaPerniagaan: finalBusinessName,
          namaSyarikat: finalBusinessName,
          namaProduk: c.namaProduk,
          konfigurasi: {
            ...c,
            namaSyarikat: finalBusinessName
          },
          bahanMentah: bm,
          buruhLangsung: bl,
          overheadBerubah: ob,
          overheadTetap: ot
        };
      }
      // Keep other templates' business names synchronized too
      return {
        ...tpl,
        namaPerniagaan: finalBusinessName,
        namaSyarikat: finalBusinessName,
        konfigurasi: {
          ...tpl.konfigurasi,
          namaSyarikat: finalBusinessName
        }
      };
    });
    setTemplates(updated);
    saveStateToLocalStorage(c, bm, bl, ob, ot, updated, activeId);
  };

  // State update handlers
  const handleUpdateConfig = (newConfig: KonfigurasiSistem) => {
    if (userRole !== "admin" && userRole !== "developer" && !roleDef.canEditSettings) {
      showToast(systemLang === "en"
        ? "Only System Administrator (Admin) is allowed to modify system configuration or functions!"
        : "Hanya Pentadbir Sistem (Admin) yang dibenarkan mengubah konfigurasi atau fungsi sistem!", "error");
      return;
    }
    const finalBusinessName = newConfig.namaSyarikat || "SCHOOL ENTERPRISE";
    const updatedConfig = { ...newConfig, namaSyarikat: finalBusinessName };
    if (newConfig.language) {
      setSystemLang(newConfig.language);
      setStoredLanguage(newConfig.language);
    }
    setConfig(updatedConfig);
    syncActiveStateToTemplates(updatedConfig, bahanMentah, buruhLangsung, overheadBerubah, overheadTetap, templates, activeProductId);
  };

  const handleUpdateBahanMentah = (items: BahanMentah[]) => {
    setBahanMentah(items);
    syncActiveStateToTemplates(config, items, buruhLangsung, overheadBerubah, overheadTetap, templates, activeProductId);
  };

  const handleUpdateBuruhLangsung = (items: BuruhLangsung[]) => {
    setBuruhLangsung(items);
    syncActiveStateToTemplates(config, bahanMentah, items, overheadBerubah, overheadTetap, templates, activeProductId);
  };

  const handleUpdateOverheadBerubah = (items: OverheadBerubah[]) => {
    setOverheadBerubah(items);
    syncActiveStateToTemplates(config, bahanMentah, buruhLangsung, items, overheadTetap, templates, activeProductId);
  };

  const handleUpdateOverheadTetap = (items: OverheadTetap[]) => {
    setOverheadTetap(items);
    syncActiveStateToTemplates(config, bahanMentah, buruhLangsung, overheadBerubah, items, templates, activeProductId);
  };

  const handleActivateProductInList = (tplId: string, currentTemplatesList: TemplatPerniagaan[]) => {
    const targetTpl = currentTemplatesList.find(t => t.id === tplId);
    if (targetTpl) {
      setIsProductSwitching(true);
      setTimeout(() => {
        setIsProductSwitching(false);
      }, 200);

      setActiveProductId(tplId);
      try {
        localStorage.setItem("pengekosan_active_product_id", tplId);
      } catch {}

      const currentNamaSyarikat = config.namaSyarikat || "SCHOOL ENTERPRISE";
      const targetConfig = {
        ...targetTpl.konfigurasi,
        namaSyarikat: currentNamaSyarikat,
        usernameLogMasuk: currentUser?.username || config.usernameLogMasuk || targetTpl.konfigurasi.usernameLogMasuk,
        kataLaluanLogMasuk: "",
      };

      setConfig(targetConfig);
      setBahanMentah([ ...targetTpl.bahanMentah ]);
      setBuruhLangsung([ ...targetTpl.buruhLangsung ]);
      setOverheadBerubah([ ...targetTpl.overheadBerubah ]);
      setOverheadTetap([ ...targetTpl.overheadTetap ]);

      saveStateToLocalStorage(
        targetConfig,
        targetTpl.bahanMentah,
        targetTpl.buruhLangsung,
        targetTpl.overheadBerubah,
        targetTpl.overheadTetap,
        currentTemplatesList,
        tplId
      );
    }
  };

  const handleActivateProduct = (tplId: string) => {
    handleActivateProductInList(tplId, templates);
    setActiveTab("dashboard");
  };

  const handleAddProduct = (newTemplate: TemplatPerniagaan) => {
    const updated = [...templates, newTemplate];
    setTemplates(updated);
    saveStateToLocalStorage(
      newTemplate.konfigurasi,
      newTemplate.bahanMentah,
      newTemplate.buruhLangsung,
      newTemplate.overheadBerubah,
      newTemplate.overheadTetap,
      updated,
      newTemplate.id
    );
    handleActivateProductInList(newTemplate.id, updated);
    setSuccessBanner({
      title: systemLang === "en" ? "Product Created Successfully" : "Produk Berjaya Ditambah",
      message: systemLang === "en"
        ? `"${newTemplate.namaProduk}" is now active and ready for standard recipe costing.`
        : `"${newTemplate.namaProduk}" kini aktif dan sedia untuk penetapan resipi kos standard.`,
      nextActionLabel: systemLang === "en" ? "Configure Standard Sheet" : "Tetapkan Kos Standard",
      onNextAction: () => {
        setSuccessBanner(null);
        setActiveTab("standard");
      }
    });
  };

  const handleDeleteProduct = (tplId: string) => {
    if (userRole !== "admin" && userRole !== "developer" && !roleDef.canEditSettings) {
      showToast(systemLang === "en" 
        ? "Only System Administrator (Admin) is allowed to delete product items!" 
        : "Hanya Pentadbir Sistem (Admin) yang dibenarkan memadam menu produk!", "error");
      return;
    }
    const tplToDelete = templates.find(t => t.id === tplId);
    const updated = templates.filter(t => t.id !== tplId);

    if (updated.length > 0) {
      setTemplates(updated);
      if (activeProductId === tplId) {
        const nextTpl = updated[0];
        setActiveProductId(nextTpl.id);
        setConfig(nextTpl.konfigurasi);
        setBahanMentah(nextTpl.bahanMentah);
        setBuruhLangsung(nextTpl.buruhLangsung);
        setOverheadBerubah(nextTpl.overheadBerubah);
        setOverheadTetap(nextTpl.overheadTetap);
        saveStateToLocalStorage(
          nextTpl.konfigurasi,
          nextTpl.bahanMentah,
          nextTpl.buruhLangsung,
          nextTpl.overheadBerubah,
          nextTpl.overheadTetap,
          updated,
          nextTpl.id
        );
      } else {
        saveStateToLocalStorage(
          config,
          bahanMentah,
          buruhLangsung,
          overheadBerubah,
          overheadTetap,
          updated,
          activeProductId
        );
      }
      showToast(
        systemLang === "en" 
          ? `Product menu "${tplToDelete?.namaProduk || ''}" successfully deleted!` 
          : `Menu "${tplToDelete?.namaProduk || ''}" berjaya dipadamkan!`, 
        "success"
      );
    } else {
      // If user deletes the last remaining menu, initialize a clean slate menu for their company
      const compName = config.namaSyarikat || "PERNIAGAAN SAYA";
      const freshTemplate: TemplatPerniagaan = {
        id: `product-${Date.now()}`,
        namaPerniagaan: compName,
        namaProduk: systemLang === "en" ? "New Product Menu" : "Menu Produk Baharu",
        namaSyarikat: compName,
        konfigurasi: {
          ...config,
          namaProduk: systemLang === "en" ? "New Product Menu" : "Menu Produk Baharu",
        },
        bahanMentah: [],
        buruhLangsung: [],
        overheadBerubah: [],
        overheadTetap: [],
      };
      const newUpdated = [freshTemplate];
      setTemplates(newUpdated);
      setActiveProductId(freshTemplate.id);
      setConfig(freshTemplate.konfigurasi);
      setBahanMentah([]);
      setBuruhLangsung([]);
      setOverheadBerubah([]);
      setOverheadTetap([]);
      saveStateToLocalStorage(
        freshTemplate.konfigurasi,
        [],
        [],
        [],
        [],
        newUpdated,
        freshTemplate.id
      );
      showToast(
        systemLang === "en" 
          ? `Product menu deleted. Fresh blank menu initialized!` 
          : `Menu dipadamkan. Menu baharu bersih telah disediakan!`, 
        "success"
      );
    }
  };

  const handleAddNewProduct = (name: string) => {
    if (userRole !== "admin" && userRole !== "developer" && !roleDef.canEditSettings) {
      showToast(systemLang === "en"
        ? "Only System Administrator (Admin) is allowed to add new product items!"
        : "Hanya Pentadbir Sistem (Admin) yang dibenarkan menambah menu produk baharu!", "error");
      return;
    }
    if (!name.trim()) return;

    const newId = `product-${Date.now()}`;
    const refTpl = templates.find(t => t.id === activeProductId) || templates[0];
    
    let copiedBahan: BahanMentah[] = [];
    let copiedBuruh: BuruhLangsung[] = [];
    let copiedOHB: OverheadBerubah[] = [];
    let copiedOHT: OverheadTetap[] = [];

    if (refTpl) {
      copiedBahan = refTpl.bahanMentah.map((item, idx) => ({
        ...item,
        id: `bm-c-${Date.now()}-${idx}`,
        sebenarKuantitiJumlah: 0,
        sebenarHargaPerUnit: item.stdHargaPerUnit,
      }));
      copiedBuruh = refTpl.buruhLangsung.map((item, idx) => ({
        ...item,
        id: `bl-c-${Date.now()}-${idx}`,
        sebenarJamJumlah: 0,
        sebenarKadarPerJam: item.stdKadarPerJam,
      }));
      copiedOHB = refTpl.overheadBerubah.map((item, idx) => ({
        ...item,
        id: `ob-c-${Date.now()}-${idx}`,
        sebenarKosJumlah: 0,
      }));
      copiedOHT = refTpl.overheadTetap.map((item, idx) => ({
        ...item,
        id: `ot-c-${Date.now()}-${idx}`,
        sebenarKosJumlah: 0,
      }));
    }

    const newConfig = {
      namaSyarikat: config.namaSyarikat || "SCHOOL ENTERPRISE",
      namaProduk: name.trim(),
      hargaJualanStandard: config.hargaJualanStandard || 4.49,
      hargaJualanSebenar: config.hargaJualanStandard || 4.49,
      sasaranKuantitiStandard: config.sasaranKuantitiStandard || 1000,
      kuantitiSebenarDijual: config.sasaranKuantitiStandard || 1000,
      currency: (config.currency && config.currency !== "$") ? config.currency : "RM",
      usernameLogMasuk: currentUser?.username || config.usernameLogMasuk || "",
      kataLaluanLogMasuk: ""
    };

    const newTemplate: TemplatPerniagaan = {
      id: newId,
      namaPerniagaan: config.namaSyarikat || "SCHOOL ENTERPRISE",
      namaSyarikat: config.namaSyarikat || "SCHOOL ENTERPRISE",
      namaProduk: name.trim(),
      konfigurasi: newConfig,
      bahanMentah: copiedBahan,
      buruhLangsung: copiedBuruh,
      overheadBerubah: copiedOHB,
      overheadTetap: copiedOHT,
    };

    handleAddProduct(newTemplate);
  };

  // Template loaders
  const handleResetToTemplate = (tpl: TemplatPerniagaan) => {
    const currentNamaSyarikat = config.namaSyarikat || "SCHOOL ENTERPRISE";
    const resetConfig = {
      ...tpl.konfigurasi,
      namaSyarikat: currentNamaSyarikat,
      usernameLogMasuk: currentUser?.username || config.usernameLogMasuk || tpl.konfigurasi.usernameLogMasuk,
      kataLaluanLogMasuk: "",
    };
    setConfig(resetConfig);
    setBahanMentah([ ...tpl.bahanMentah ]);
    setBuruhLangsung([ ...tpl.buruhLangsung ]);
    setOverheadBerubah([ ...tpl.overheadBerubah ]);
    setOverheadTetap([ ...tpl.overheadTetap ]);
    setActiveTab("dashboard");
    saveStateToLocalStorage(resetConfig, tpl.bahanMentah, tpl.buruhLangsung, tpl.overheadBerubah, tpl.overheadTetap);
    syncActiveStateToTemplates(resetConfig, tpl.bahanMentah, tpl.buruhLangsung, tpl.overheadBerubah, tpl.overheadTetap, templates, activeProductId);
  };

  const handleApplySimulation = (updatedConfig: Partial<KonfigurasiSistem>) => {
    const newConfig = { ...config, ...updatedConfig };
    setConfig(newConfig);
    saveStateToLocalStorage(
      newConfig,
      bahanMentah,
      buruhLangsung,
      overheadBerubah,
      overheadTetap,
      templates,
      activeProductId
    );
    showToast(
      systemLang === "en"
        ? "Simulation proposal successfully applied to active worksheet!"
        : "Cadangan simulasi berjaya diaplikasikan ke lembaran aktif!",
      "success"
    );
  };

  // Perform Calculations
  const stdSummary = kiraRingkasanKosStandard(config, bahanMentah, buruhLangsung, overheadBerubah, overheadTetap);
  const actSummary = kiraRingkasanKosSebenar(config, bahanMentah, buruhLangsung, overheadBerubah, overheadTetap);

  // Safety guard: Restrict developer tab strictly to server-verified developer sessions
  useEffect(() => {
    if (activeTab === "developer" && !isDevSuperuser) {
      setActiveTab("dashboard");
    }
    if (!isDevSuperuser && settingsInitialSubpage && settingsInitialSubpage.startsWith("developer-")) {
      setSettingsInitialSubpage(null);
    }
  }, [activeTab, isDevSuperuser, settingsInitialSubpage]);

  // Centralized logout handler to clean all sessions
  const handleLogout = () => {
    try {
      localStorage.removeItem("pengekosan_current_session");
    } catch {}
    clearServerSessionToken();
    fetch(apiUrl("/api/auth/logout"), {
      method: "POST",
      credentials: getFetchCredentialsMode(),
    }).catch(() => {});
    logOut().catch(console.warn);
    setIsLoggedIn(false);
    setCurrentUser(null);
    setUserRole("admin");
    setIsDevSuperuser(false);
    setDevAuthModalOpen(false);
    setSettingsInitialSubpage(null);
    setActiveTab("dashboard");
    setMobileSidebarOpen(false);
  };

  // Return to Login Screen if not authenticated
  if (!isLoggedIn) {
    return (
      <LoginScreen
        namaSyarikat={config.namaSyarikat}
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          const role = (user.role || "staf") as UserRole;
          const isDev = role === "developer" && devEntryEnabled;
          const verifiedRole: UserRole = isDev ? "developer" : (role === "developer" ? "staf" : role);
          setUserRole(verifiedRole);
          setIsDevSuperuser(isDev);
          if (isDev) {
            setActiveTab("developer");
            setSettingsInitialSubpage("developer-console");
          } else {
            setActiveTab("dashboard");
            setSettingsInitialSubpage(null);
          }
          setIsLoggedIn(true);

          try {
            localStorage.setItem(
              "pengekosan_current_session",
              JSON.stringify({
                user: { ...user, role: verifiedRole },
                role: verifiedRole,
                isDev,
              })
            );
          } catch (e) {
            console.warn("[SmartCost DB] Failed to store session:", e);
          }

          loadCompanyDatabase(
            user.companyName || config.namaSyarikat,
            user.username,
            user.id,
            user.dbKey,
            isDev
          );
        }}
        defaultUsername=""
        defaultPassword=""
        systemLang={systemLang}
        onLanguageChange={handleSetLanguage}
      />
    );
  }

  const roleDef = roleDefs[userRole] || ROLE_DEFINITIONS.admin;

  // Group navigation into 4 clean SME-friendly categories
  const navigationGroups = [
    {
      groupTitle: systemLang === "en" ? "Main" : "Utama",
      items: [
        { id: "dashboard", label: t.nav.dashboard, icon: LayoutDashboard },
        { id: "standard", label: t.nav.standard, icon: Coins },
        { id: "sebenar", label: t.nav.sebenar, icon: TrendingUp },
      ],
    },
    {
      groupTitle: systemLang === "en" ? "Analysis" : "Analisis",
      items: [
        { id: "varians", label: t.nav.varians, icon: Flame },
        { id: "bep", label: t.nav.bep, icon: Scale },
        { id: "chart", label: t.nav.chart, icon: LineChart },
      ],
    },
    {
      groupTitle: systemLang === "en" ? "Reports & Help" : "Laporan & Bantuan",
      items: [
        { id: "statement", label: t.nav.statement, icon: FileText },
        { id: "mrcost", label: t.nav.mrcost, icon: Bot },
      ],
    },
    {
      groupTitle: systemLang === "en" ? "System" : "Sistem & Tetapan",
      items: [
        { id: "settings", label: t.nav.settings, icon: Settings },
      ],
    },
  ];

  const allNavigationItems = navigationGroups.flatMap((g) => g.items);
  const navigationItems = allNavigationItems.filter((item) => roleDef.allowedTabs.includes(item.id));
  const isTabAllowed =
    activeTab === "developer"
      ? isDevSuperuser
      : (roleDef.allowedTabs.includes(activeTab) || userRole === "admin" || isDevSuperuser);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0b1528] text-slate-800 dark:text-slate-100 flex flex-col lg:flex-row relative transition-colors duration-200">
      
      {/* STATE 04: NO INTERNET BANNER */}
      {isOffline && (
        <div className="fixed top-0 left-0 right-0 z-50">
          <NoInternetBanner onRetry={checkConnection} />
        </div>
      )}
      
      {/* 1. SIDEBAR DESKTOP */}
      <aside className="hidden lg:flex print:hidden flex-col w-64 xl:w-72 h-screen sticky top-0 bg-[#061830] text-white shrink-0 shadow-2xl border-r border-blue-950/60 overflow-hidden z-30">
        {/* Company Logo & Brand Header */}
        <div className="p-5 xl:p-6 border-b border-white/10 relative z-10 flex items-center gap-3 bg-black/15">
          <div className="w-10 h-10 bg-sky-500/20 rounded-[10px] flex items-center justify-center border border-sky-300/30 shrink-0">
            <Soup className="w-5 h-5 text-sky-300" />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-xs tracking-wide text-sky-300">
              {t.nav.systemTitle}
            </h1>
            <p className="font-bold text-sm tracking-tight text-white truncate">
              {config.namaSyarikat || "Perniagaan Anda"}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-sky-200/90">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
              <span className="truncate">{t.nav.isolatedDb}</span>
            </div>
          </div>
        </div>

        {/* Grouped Navigation Items */}
        <nav className="flex-1 px-3.5 py-4 space-y-4 relative z-10 overflow-y-auto">
          {navigationGroups.map((group) => {
            const visibleItems = group.items.filter((item) => roleDef.allowedTabs.includes(item.id));
            if (visibleItems.length === 0) return null;
            return (
              <div key={group.groupTitle} className="space-y-1">
                <p className="px-3 text-[11px] font-semibold text-sky-300/60 tracking-wide">
                  {group.groupTitle}
                </p>
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      id={`tab-${item.id}`}
                      onClick={() => setActiveTab(item.id)}
                      className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-[10px] text-xs font-medium transition-all duration-150 focus:outline-hidden group cursor-pointer min-h-[44px] ${
                        isActive 
                          ? "bg-white/15 text-white border-l-4 border-sky-400 font-bold shadow-xs" 
                          : "text-blue-100/80 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 transition-transform duration-200 ${isActive ? 'text-sky-300' : 'text-blue-300/70'}`} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* User Profile & Logout Bottom Footer */}
        <div className="p-4 border-t border-white/10 relative z-10 space-y-2.5 bg-black/15">
          {currentUser && (
            <div className="p-3 bg-white/5 rounded-[10px] border border-white/10 space-y-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-[8px] bg-sky-400/20 text-sky-200 flex items-center justify-center font-bold text-xs shrink-0 border border-sky-300/30">
                  {currentUser.fullName ? currentUser.fullName.charAt(0).toUpperCase() : "U"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-white text-xs truncate leading-tight">{currentUser.fullName}</p>
                  <p className="text-[10px] text-sky-300/80 truncate">@{currentUser.username}</p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-white/10">
                <span className={`px-2 py-0.5 rounded-[6px] text-[10px] font-medium border ${roleDef.badgeColor}`}>
                  {roleDef.title}
                </span>
                <button
                  type="button"
                  onClick={() => setAccessMatrixModalOpen(true)}
                  className="p-1 hover:bg-white/15 text-sky-300 rounded-[6px] transition-colors cursor-pointer"
                  title={systemLang === "en" ? "View Role-Based Access Control (RBAC) Matrix" : "Lihat Matriks Hak Akses RBAC"}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-rose-200 hover:text-white hover:bg-rose-900/30 rounded-[10px] border border-rose-900/30 transition-all cursor-pointer min-h-[44px]"
          >
            <LogOut className="w-3.5 h-3.5" />
            {t.nav.logout}
          </button>
        </div>
      </aside>

      {/* 2. MOBILE HEADER & SIDEBAR OVERLAY */}
      <div className="lg:hidden print:hidden w-full sticky top-0 left-0 bg-[#061830] text-white p-3 flex items-center justify-between shadow-md z-40 border-b border-white/10">
        <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
          <Soup className="w-5 h-5 text-sky-300 shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="font-bold text-xs text-white truncate leading-tight">
              {config.namaSyarikat || "SmartCost"}
            </h1>
            <div className="relative mt-0.5 max-w-[200px]">
              <select
                id="mobile-product-switcher"
                value={activeProductId}
                onChange={(e) => handleActivateProductInList(e.target.value, templates)}
                className="w-full bg-white/10 text-white text-xs font-medium rounded-[6px] px-2 py-1 pr-6 border border-white/20 truncate focus:outline-none cursor-pointer appearance-none"
                aria-label="Pilih Produk"
              >
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id} className="bg-[#061830] text-white">
                    {tpl.namaProduk}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-sky-300 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
            className="p-2 rounded-[10px] hover:bg-white/10 text-white min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Menu"
          >
            {mobileSidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Sidebar overlay menu */}
      {mobileSidebarOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/80 z-40 animate-backdrop" onClick={() => setMobileSidebarOpen(false)}>
          <aside 
            className="w-72 bg-[#061830] text-white h-full flex flex-col shadow-2xl relative z-50 p-4 border-r border-white/10 animate-slideUp opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-3">
              <div className="flex items-center gap-2">
                <Soup className="w-5 h-5 text-sky-300" />
                <span className="font-bold text-sm text-white truncate">
                  {t.nav.menuSystem}
                </span>
              </div>
              <button 
                onClick={() => setMobileSidebarOpen(false)} 
                className="text-white p-2 hover:bg-white/10 rounded-[10px] min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Tutup"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 space-y-4 overflow-y-auto">
              {navigationGroups.map((group) => {
                const visibleItems = group.items.filter((item) => roleDef.allowedTabs.includes(item.id));
                if (visibleItems.length === 0) return null;
                return (
                  <div key={group.groupTitle} className="space-y-1">
                    <p className="px-3 text-[11px] font-semibold text-sky-300/60 tracking-wide">
                      {group.groupTitle}
                    </p>
                    {visibleItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            setActiveTab(item.id);
                            setMobileSidebarOpen(false);
                          }}
                          className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-[10px] text-xs font-medium transition-all cursor-pointer min-h-[44px] ${
                            isActive 
                              ? "bg-white/15 text-white font-bold border-l-4 border-sky-400" 
                              : "text-blue-100 hover:bg-white/5"
                          }`}
                        >
                          <Icon className="w-4 h-4 shrink-0 text-sky-300" />
                          <span className="truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </nav>

            {/* Quick Controls in Mobile Drawer */}
            <div className="pt-3 border-t border-white/10 space-y-2">
              <p className="text-[10px] font-bold text-sky-300/60 uppercase tracking-wider px-1">
                {systemLang === "en" ? "Quick Controls" : "Tetapan Pantas"}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleToggleTheme()}
                  className="px-2.5 py-2 bg-white/10 hover:bg-white/15 rounded-[10px] text-xs font-medium text-white flex items-center justify-center gap-1.5 min-h-[44px] cursor-pointer"
                >
                  {theme === "dark" ? <Sun className="w-4 h-4 text-amber-300" /> : <Moon className="w-4 h-4 text-sky-300" />}
                  <span>{theme === "dark" ? (systemLang === "en" ? "Light" : "Cerah") : (systemLang === "en" ? "Dark" : "Gelap")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSetLanguage(systemLang === "en" ? "ms" : "en")}
                  className="px-2.5 py-2 bg-white/10 hover:bg-white/15 rounded-[10px] text-xs font-medium text-white flex items-center justify-center gap-1.5 min-h-[44px] cursor-pointer"
                >
                  <Globe className="w-4 h-4 text-sky-300" />
                  <span>{systemLang === "en" ? "BM" : "EN"}</span>
                </button>
              </div>
              {isDevSuperuser ? (
                <button
                  type="button"
                  onClick={() => {
                    setMobileSidebarOpen(false);
                    setCompanyDbModalOpen(true);
                  }}
                  className="w-full px-3 py-2 bg-white/10 hover:bg-white/15 rounded-[10px] text-xs font-medium text-white flex items-center justify-between min-h-[44px] cursor-pointer"
                  title={config.namaSyarikat || "School Enterprise"}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <Database className="w-4 h-4 text-sky-400 shrink-0" />
                    <span className="shrink-0 text-sky-200/80 font-normal">
                      {systemLang === "en" ? "Company:" : "Syarikat:"}
                    </span>
                    <span className="truncate font-semibold">
                      {toTitleCase(config.namaSyarikat || "School Enterprise")}
                    </span>
                  </span>
                  <span className="text-[10px] text-sky-300 font-medium shrink-0 ml-2">
                    {systemLang === "en" ? "Change" : "Tukar"}
                  </span>
                </button>
              ) : (
                <div
                  className="w-full px-3 py-2 bg-white/10 rounded-[10px] text-xs font-medium text-white flex items-center min-h-[44px] select-none"
                  title={config.namaSyarikat || "School Enterprise"}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <Database className="w-4 h-4 text-sky-400 shrink-0" />
                    <span className="shrink-0 text-sky-200/80 font-normal">
                      {systemLang === "en" ? "Company:" : "Syarikat:"}
                    </span>
                    <span className="truncate font-semibold">
                      {toTitleCase(config.namaSyarikat || "School Enterprise")}
                    </span>
                  </span>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-white/10 space-y-2">
              {currentUser && (
                <div className="flex items-center gap-2.5 px-3 py-2 bg-white/10 rounded-[10px] border border-white/10">
                  <div className="w-7 h-7 rounded-[6px] bg-sky-400/20 text-sky-200 flex items-center justify-center font-bold text-xs shrink-0 border border-sky-300/30">
                    {currentUser.fullName ? currentUser.fullName.charAt(0).toUpperCase() : "U"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-white text-xs truncate leading-tight">{currentUser.fullName}</p>
                    <p className="text-[10px] text-sky-300 truncate">@{currentUser.username}</p>
                  </div>
                </div>
              )}
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-rose-200 hover:text-white hover:bg-rose-900/30 rounded-[10px] border border-rose-900/30 transition-all cursor-pointer min-h-[44px]"
              >
                <LogOut className="w-4 h-4" />
                {t.nav.logout}
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* 3. MAIN CONTENT BODY */}
      <main className="flex-1 min-w-0 p-3 sm:p-5 lg:p-8 pt-4 sm:pt-6 lg:pt-8 overflow-y-auto overflow-x-hidden max-w-full pb-[calc(env(safe-area-inset-bottom,16px)+5.5rem)] lg:pb-8 print:p-0 print:m-0 print:overflow-visible">
        <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8 print:max-w-none print:space-y-0">
          
          {/* Top Bar: Clean Product Dropdown Selector & Quick Add Button */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3.5 print:hidden">
            <div className="flex items-center gap-3">
              <label htmlFor="quick-product-switcher" className="text-xs font-semibold text-slate-500 dark:text-slate-400 shrink-0">
                {systemLang === "en" ? "Active Product:" : "Produk Semasa:"}
              </label>
              <div className="relative min-w-[200px] sm:min-w-[260px] max-w-full">
                <select
                  id="quick-product-switcher"
                  value={activeProductId}
                  onChange={(e) => handleActivateProductInList(e.target.value, templates)}
                  className="w-full appearance-none bg-white dark:bg-[#132238] text-slate-800 dark:text-slate-100 font-semibold text-sm rounded-[10px] pl-3.5 pr-9 py-2 border border-slate-300 dark:border-slate-700 shadow-2xs focus:outline-none focus:ring-2 focus:ring-[#0b3c7a] dark:focus:ring-sky-500 cursor-pointer h-10 min-h-[40px]"
                  aria-label={systemLang === "en" ? "Select Product" : "Pilih Produk"}
                >
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.namaProduk}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 dark:text-slate-400">
                  <ChevronDown className="w-4 h-4 shrink-0" />
                </div>
              </div>
            </div>

            {/* Right side controls: Discreet theme & language & database pills for desktop */}
            <div className="hidden sm:flex items-center gap-2">
              <button
                type="button"
                id="quick-theme-toggle-btn"
                onClick={() => handleToggleTheme()}
                className="px-3 py-2 bg-white dark:bg-[#182a44] hover:bg-slate-100 dark:hover:bg-[#1f3554] text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-[10px] text-xs font-semibold flex items-center gap-1.5 transition-all shadow-2xs hover:shadow-xs cursor-pointer min-h-[40px]"
                title={theme === "dark" ? (systemLang === "en" ? "Switch to Light Mode" : "Tukar ke Mod Cerah") : (systemLang === "en" ? "Switch to Dark Mode" : "Tukar ke Mod Gelap")}
                aria-label={systemLang === "en" ? "Toggle Theme" : "Tukar Tema"}
              >
                {theme === "dark" ? (
                  <>
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                    <span>{systemLang === "en" ? "Light" : "Cerah"}</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5 text-indigo-600" />
                    <span>{systemLang === "en" ? "Dark" : "Gelap"}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleSetLanguage(systemLang === "en" ? "ms" : "en")}
                className="px-3 py-2 bg-white dark:bg-[#182a44] hover:bg-slate-100 dark:hover:bg-[#1f3554] text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-[10px] text-xs font-semibold flex items-center gap-1.5 transition-all shadow-2xs hover:shadow-xs cursor-pointer min-h-[40px]"
                title={systemLang === "en" ? "Tukar ke Bahasa Melayu" : "Switch to English"}
              >
                <Globe className="w-3.5 h-3.5 text-[#0b3c7a] dark:text-sky-400" />
                <span>{systemLang === "en" ? "BM" : "EN"}</span>
              </button>

              {isDevSuperuser ? (
                <button
                  type="button"
                  onClick={() => setCompanyDbModalOpen(true)}
                  className="px-3.5 py-2 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white rounded-[10px] text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer whitespace-nowrap border border-slate-800 dark:border-slate-700 min-h-[40px] max-w-[200px] sm:max-w-[240px]"
                  title={config.namaSyarikat || "School Enterprise"}
                >
                  <Database className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span className="shrink-0 text-slate-300 font-normal">
                    {systemLang === "en" ? "Company:" : "Syarikat:"}
                  </span>
                  <span className="truncate">
                    {toTitleCase(config.namaSyarikat || "School Enterprise")}
                  </span>
                </button>
              ) : (
                <div
                  className="px-3.5 py-2 bg-slate-900 dark:bg-slate-800 text-white rounded-[10px] text-xs font-semibold flex items-center gap-1.5 shadow-xs whitespace-nowrap border border-slate-800 dark:border-slate-700 min-h-[40px] max-w-[200px] sm:max-w-[240px] select-none"
                  title={config.namaSyarikat || "School Enterprise"}
                >
                  <Database className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span className="shrink-0 text-slate-300 font-normal">
                    {systemLang === "en" ? "Company:" : "Syarikat:"}
                  </span>
                  <span className="truncate">
                    {toTitleCase(config.namaSyarikat || "School Enterprise")}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* STATE 05: SLOW NETWORK NOTICE */}
          {isSlowNetwork && (
            <SlowNetworkNotice
              progress={networkProgress}
              operationLabel={slowOperationLabel}
              onUseOffline={() => {
                dismissSlowNetwork();
                showToast(
                  systemLang === "en" ? "Switched to fast local cache mode." : "Beralih ke mod pantas storan cache tempatan.",
                  "info"
                );
              }}
            />
          )}

          {/* STATE 10: SUCCESS BANNER */}
          {successBanner && (
            <SuccessBanner
              title={successBanner.title}
              message={successBanner.message}
              actionLabel={successBanner.nextActionLabel}
              onAction={successBanner.onNextAction}
              onDismiss={() => setSuccessBanner(null)}
            />
          )}

          {/* Main Content Router with Smooth View Transition & UI States */}
          {isProductSwitching ? (
            <div className="py-4">
              <SkeletonLoader
                type={activeTab === "standard" || activeTab === "sebenar" ? "table" : "dashboard"}
                count={activeTab === "dashboard" ? 3 : 1}
              />
            </div>
          ) : !isTabAllowed ? (
            <div className="py-6">
              <PermissionDenied
                roleName={roleDef.title}
                requiredPermission={activeTab}
                onGoBack={() => setActiveTab("dashboard")}
              />
            </div>
          ) : (
            <div key={activeTab} className="animate-fadeIn space-y-8">
            {activeTab === "dashboard" && (
              <DashboardOverview
                config={config}
                stdSummary={stdSummary}
                actSummary={actSummary}
                onNavigate={(tab) => setActiveTab(tab)}
                systemLang={systemLang}
                bahanMentah={bahanMentah}
                buruhLangsung={buruhLangsung}
                overheadBerubah={overheadBerubah}
                overheadTetap={overheadTetap}
                onApplySimulation={handleApplySimulation}
              />
            )}

            {activeTab === "standard" && (
              <StandardSheet
                config={config}
                bahanMentah={bahanMentah}
                buruhLangsung={buruhLangsung}
                overheadBerubah={overheadBerubah}
                overheadTetap={overheadTetap}
                onUpdateBahanMentah={handleUpdateBahanMentah}
                onUpdateBuruhLangsung={handleUpdateBuruhLangsung}
                onUpdateOverheadBerubah={handleUpdateOverheadBerubah}
                onUpdateOverheadTetap={handleUpdateOverheadTetap}
                userRole={userRole}
                systemLang={systemLang}
                onApplySimulation={handleApplySimulation}
              />
            )}

            {activeTab === "sebenar" && (
              <ActualSheet
                config={config}
                bahanMentah={bahanMentah}
                buruhLangsung={buruhLangsung}
                overheadBerubah={overheadBerubah}
                overheadTetap={overheadTetap}
                onUpdateBahanMentah={handleUpdateBahanMentah}
                onUpdateBuruhLangsung={handleUpdateBuruhLangsung}
                onUpdateOverheadBerubah={handleUpdateOverheadBerubah}
                onUpdateOverheadTetap={handleUpdateOverheadTetap}
                userRole={userRole}
                systemLang={systemLang}
              />
            )}

            {activeTab === "varians" && (
              <VarianceSheet
                config={config}
                bahanMentah={bahanMentah}
                buruhLangsung={buruhLangsung}
                overheadBerubah={overheadBerubah}
                overheadTetap={overheadTetap}
                systemLang={systemLang}
              />
            )}

            {activeTab === "bep" && (
              <BepSheet
                config={config}
                stdSummary={stdSummary}
                actSummary={actSummary}
                systemLang={systemLang}
              />
            )}

            {activeTab === "chart" && (
              <BepChart
                config={config}
                stdSummary={stdSummary}
                actSummary={actSummary}
                systemLang={systemLang}
              />
            )}

            {activeTab === "statement" && (
              <StatementSheet
                config={config}
                bahanMentah={bahanMentah}
                buruhLangsung={buruhLangsung}
                overheadBerubah={overheadBerubah}
                overheadTetap={overheadTetap}
                stdSummary={stdSummary}
                actSummary={actSummary}
                templates={templates}
                systemLang={systemLang}
              />
            )}

            {activeTab === "mrcost" && (
              <MrCostSheet
                databaseId={activeLoadedDbKey}
                config={config}
                bahanMentah={bahanMentah}
                buruhLangsung={buruhLangsung}
                overheadBerubah={overheadBerubah}
                overheadTetap={overheadTetap}
                stdSummary={stdSummary}
                actSummary={actSummary}
                templates={templates}
                systemLang={systemLang}
                userRole={userRole}
                currentUser={currentUser}
                onApplySimulation={handleApplySimulation}
              />
            )}

            {(activeTab === "settings" || (activeTab === "developer" && isDevSuperuser)) && (
              <SettingsSheet
                config={config}
                templates={templates}
                activeProductId={activeProductId}
                theme={theme}
                onThemeChange={handleToggleTheme}
                onUpdateConfig={handleUpdateConfig}
                onResetToTemplate={handleResetToTemplate}
                onDeleteProduct={handleDeleteProduct}
                onAddProduct={handleAddNewProduct}
                onOpenDatabaseModal={isDevSuperuser ? () => setCompanyDbModalOpen(true) : undefined}
                onOpenAccessMatrixModal={() => setAccessMatrixModalOpen(true)}
                userRole={userRole}
                onSwitchToDeveloper={() => {
                  if (!isDevSuperuser || !devEntryEnabled) return;
                  setUserRole("developer");
                  setSettingsInitialSubpage("developer-console");
                  loadCompanyDatabase("SANDBOX PEMBANGUN", currentUser?.username || "developer", currentUser?.id, DEV_SANDBOX_DB_KEY, true);
                }}
                currentUser={currentUser}
                onLogout={handleLogout}
                onLanguageChange={handleSetLanguage}
                isRealDeveloperSuperuser={isDevSuperuser}
                activeLoadedDbKey={activeLoadedDbKey}
                onUpdateTemplates={(updated) => {
                  setTemplates(updated);
                  try {
                    localStorage.setItem("pengekosan_templates", JSON.stringify(updated));
                    const sanitized = (config.namaSyarikat || "SMARTCOST").toLowerCase().trim().replace(/[^a-z0-9]/g, "_");
                    localStorage.setItem(`pengekosan_company_db_${sanitized}_templates`, JSON.stringify(updated));
                  } catch {}
                  showToast(
                    systemLang === "en"
                      ? "Templates successfully restored from backup!"
                      : "Templat produk berjaya dipulihkan dari sandaran data!",
                    "success"
                  );
                }}
                onSwitchRole={(newRole) => {
                  if (newRole === "developer" && !isDevSuperuser) return;
                  setUserRole(newRole);
                }}
                onCredentialsUpdated={(updatedUser) => {
                  const nextUsername = updatedUser.username || currentUser?.username || config.usernameLogMasuk;
                  const mergedUser = currentUser
                    ? { ...currentUser, ...updatedUser, username: nextUsername }
                    : updatedUser;
                  setCurrentUser(mergedUser as any);
                  const nextConfig: KonfigurasiSistem = {
                    ...config,
                    usernameLogMasuk: nextUsername,
                    kataLaluanLogMasuk: "",
                  };
                  const nextTemplates = templates.map((tpl) => ({
                    ...tpl,
                    konfigurasi: {
                      ...tpl.konfigurasi,
                      usernameLogMasuk: nextUsername,
                      kataLaluanLogMasuk: "",
                    },
                  }));
                  setConfig(nextConfig);
                  setTemplates(nextTemplates);
                  saveStateToLocalStorage(
                    nextConfig,
                    bahanMentah,
                    buruhLangsung,
                    overheadBerubah,
                    overheadTetap,
                    nextTemplates,
                    activeProductId
                  );
                  try {
                    const rawSess = localStorage.getItem("pengekosan_current_session");
                    if (rawSess) {
                      const parsed = JSON.parse(rawSess);
                      localStorage.setItem(
                        "pengekosan_current_session",
                        JSON.stringify({
                          ...parsed,
                          user: { ...(parsed.user || {}), ...mergedUser, username: nextUsername },
                        })
                      );
                    }
                    const rawUsers = localStorage.getItem("pengekosan_registered_users");
                    if (rawUsers) {
                      const arr = JSON.parse(rawUsers);
                      if (Array.isArray(arr)) {
                        const nextArr = arr.map((u: any) =>
                          u.id === mergedUser.id ? { ...u, username: nextUsername } : u
                        );
                        localStorage.setItem("pengekosan_registered_users", JSON.stringify(nextArr));
                      }
                    }
                  } catch {}
                }}
                onDatabaseDeleted={handleDatabaseDeleted}
                systemLang={systemLang}
                initialSubpage={activeTab === "developer" ? "developer-console" : settingsInitialSubpage}
              />
            )}
          </div>
          )}

        </div>
      </main>

      {/* Modal Pengurusan Database Syarikat Terasing (Strictly Verified Developer Only) */}
      <CompanyDatabaseModal
        isOpen={companyDbModalOpen}
        onClose={() => setCompanyDbModalOpen(false)}
        currentCompanyName={config.namaSyarikat}
        onSwitchCompanyDb={(compName, dbKey) => {
          if (!isDevSuperuser) return;
          loadCompanyDatabase(compName, undefined, undefined, dbKey, true);
        }}
        onExportCompanyDb={handleExportCompanyDb}
        onImportCompanyDb={(dbFile) => {
          if (!isDevSuperuser) return;
          handleImportCompanyDb(dbFile);
        }}
        userRole={userRole}
        isVerifiedDeveloper={isDevSuperuser}
        onCloneToSandbox={isDevSuperuser ? handleCloneToDevSandbox : undefined}
        onReturnToSandbox={isDevSuperuser ? handleReturnToDevSandbox : undefined}
        onDatabaseDeleted={isDevSuperuser ? handleDatabaseDeleted : undefined}
        activeLoadedDbKey={activeLoadedDbKey}
        systemLang={systemLang}
        currentUserEmail={currentUser?.email}
        currentUsername={currentUser?.username}
      />

      {/* Modal Matriks Hak Akses System (RBAC) */}
      <AccessMatrixModal
        isOpen={accessMatrixModalOpen}
        onClose={() => setAccessMatrixModalOpen(false)}
        currentUserRole={userRole}
        currentUsername={currentUser?.username || "admin"}
        systemLang={systemLang}
        onRoleChanged={(newRole) => {
          if (newRole === "developer" && !isDevSuperuser) return;
          setUserRole(newRole);
          if (newRole === "developer" && isDevSuperuser) {
            setActiveTab("developer");
            loadCompanyDatabase("SANDBOX PEMBANGUN", currentUser?.username || "developer", currentUser?.id, DEV_SANDBOX_DB_KEY);
          }
          if (currentUser) {
            setCurrentUser({ ...currentUser, role: newRole });
          }
        }}
        onUpdateRoleDefinitions={(newDefs) => {
          setRoleDefs(newDefs);
        }}
      />

      {/* Hidden Developer Authentication Modal (Activated via Alt+D or configured alternative) */}
      <DeveloperAuthModal
        isOpen={devEntryEnabled && devAuthModalOpen}
        onClose={() => setDevAuthModalOpen(false)}
        onSuccess={(devUser) => {
          const normalizedDevUser = {
            ...devUser,
            authProvider: devUser.email ? "google" : "manual",
          };
          setCurrentUser(normalizedDevUser);
          setUserRole("developer");
          setIsDevSuperuser(true);
          setDevAuthModalOpen(false);
          setActiveTab("developer");
          setSettingsInitialSubpage("developer-console");
          try {
            localStorage.setItem(
              "pengekosan_current_session",
              JSON.stringify({
                user: normalizedDevUser,
                role: "developer",
                isDev: true,
              })
            );
          } catch {}
          loadCompanyDatabase(
            "SANDBOX PEMBANGUN",
            devUser.username,
            devUser.id,
            DEV_SANDBOX_DB_KEY,
            true
          );
        }}
        lang={systemLang}
        devEntryEnabled={devEntryEnabled}
      />

      {/* In-App Floating Toast Notification (Safe for iframe, positioned above safe area and bottom nav) */}
      {toast && (
        <div className="fixed bottom-[calc(env(safe-area-inset-bottom,16px)+4.5rem)] lg:bottom-6 right-3 sm:right-6 z-50 max-w-md animate-fadeIn print:hidden">
          <div className={`p-4 rounded-2xl shadow-xl border flex items-start gap-3 backdrop-blur-md ${
            toast.type === "error"
              ? "bg-rose-950/90 border-rose-700/80 text-rose-100"
              : toast.type === "success"
              ? "bg-emerald-950/90 border-emerald-700/80 text-emerald-100"
              : toast.type === "info"
              ? "bg-sky-950/90 border-sky-700/80 text-sky-100"
              : "bg-amber-950/90 border-amber-700/80 text-amber-100"
          }`}>
            <AlertCircle className={`w-5 h-5 shrink-0 mt-0.5 ${
              toast.type === "error" ? "text-rose-400" : toast.type === "success" ? "text-emerald-400" : "text-amber-400"
            }`} />
            <div className="flex-1 text-xs font-medium leading-relaxed">
              {toast.message}
            </div>
            <button
              onClick={() => setToast(null)}
              className="text-white/60 hover:text-white text-xs font-bold p-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* 4. MOBILE BOTTOM NAVIGATION TAB BAR (< 1024px) with Safe Area inset */}
      <nav 
        aria-label="Navigasi Mudah Alih"
        className="lg:hidden print:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-[#0c182b]/95 backdrop-blur-md border-t border-slate-200/90 dark:border-slate-800 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] px-2 pt-1 pb-[max(env(safe-area-inset-bottom,8px),8px)]"
      >
        <div className="grid grid-cols-5 gap-1 max-w-md mx-auto items-center">
          <button
            type="button"
            onClick={() => setActiveTab("dashboard")}
            className={`min-h-[44px] flex flex-col items-center justify-center rounded-xl px-1 py-1 transition-all cursor-pointer ${
              activeTab === "dashboard"
                ? "text-[#0b3c7a] dark:text-sky-400 font-bold"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <LayoutDashboard className={`w-5 h-5 ${activeTab === "dashboard" ? "scale-110" : ""}`} />
            <span className="text-[10px] tracking-tight mt-0.5 truncate max-w-full">
              {systemLang === "en" ? "Overview" : "Utama"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("standard")}
            className={`min-h-[44px] flex flex-col items-center justify-center rounded-xl px-1 py-1 transition-all cursor-pointer ${
              activeTab === "standard"
                ? "text-[#0b3c7a] dark:text-sky-400 font-bold"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <Coins className={`w-5 h-5 ${activeTab === "standard" ? "scale-110" : ""}`} />
            <span className="text-[10px] tracking-tight mt-0.5 truncate max-w-full">
              {systemLang === "en" ? "Standard" : "Standard"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("sebenar")}
            className={`min-h-[44px] flex flex-col items-center justify-center rounded-xl px-1 py-1 transition-all cursor-pointer ${
              activeTab === "sebenar"
                ? "text-[#0b3c7a] dark:text-sky-400 font-bold"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <TrendingUp className={`w-5 h-5 ${activeTab === "sebenar" ? "scale-110" : ""}`} />
            <span className="text-[10px] tracking-tight mt-0.5 truncate max-w-full">
              {systemLang === "en" ? "Actual" : "Sebenar"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("varians")}
            className={`min-h-[44px] flex flex-col items-center justify-center rounded-xl px-1 py-1 transition-all cursor-pointer ${
              activeTab === "varians"
                ? "text-[#0b3c7a] dark:text-sky-400 font-bold"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <Flame className={`w-5 h-5 ${activeTab === "varians" ? "scale-110" : ""}`} />
            <span className="text-[10px] tracking-tight mt-0.5 truncate max-w-full">
              {systemLang === "en" ? "Variance" : "Varians"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            className={`min-h-[44px] flex flex-col items-center justify-center rounded-xl px-1 py-1 transition-all cursor-pointer ${
              !["dashboard", "standard", "sebenar", "varians"].includes(activeTab)
                ? "text-[#0b3c7a] dark:text-sky-400 font-bold"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <Menu className="w-5 h-5" />
            <span className="text-[10px] tracking-tight mt-0.5 truncate max-w-full">
              {systemLang === "en" ? "Menu" : "Lainnya"}
            </span>
          </button>
        </div>
      </nav>

      {/* STATE 08: SESSION EXPIRED MODAL (Saves work before prompt, 1-click restore & sign in) */}
      {isSessionExpired && (
        <SessionExpiredModal
          onReLogin={() => {
            handleRestoreSession();
            setIsLoggedIn(false);
          }}
        />
      )}

    </div>
  );
}
