/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import {
  KonfigurasiSistem,
  GeneralSetupConfig,
  UserRole,
  ROLE_DEFINITIONS,
  ThemeMode,
} from "../types";
import { TemplatPerniagaan } from "../data/defaultTemplates";
import {
  Settings,
  Save,
  Lock,
  Building,
  Building2,
  Info,
  Trash2,
  FileText,
  Soup,
  Plus,
  Database,
  Download,
  Upload,
  ShieldCheck,
  Globe,
  Check,
  Terminal,
  AlertTriangle,
  X,
  Sun,
  Moon,
  Landmark,
  ChevronRight,
  ChevronLeft,
  User,
  Key,
  Clock,
  Coins,
  Scale,
  Calendar,
  Calculator,
  Sliders,
  LogOut,
  Archive,
  ShieldAlert,
  Layers,
  Sparkles,
  CheckCircle2,
  Phone,
  Mail,
  MapPin,
  ExternalLink,
  CreditCard,
  Image as ImageIcon,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  Language,
  getTranslation,
  setStoredLanguage,
  getStoredLanguage,
  getLocalizedRoleDef,
  formatUnitLabel,
} from "../utils/i18n";
import { handleInputEnterKey } from "../utils/inputNavigation";
import { getStoredTheme, setStoredTheme } from "../utils/theme";
import GeneralSetupModal from "./GeneralSetupModal";
import DeveloperConsoleSheet from "./DeveloperConsoleSheet";
import { UNIT_DEFINITIONS } from "../utils/mrcostEngine";
import { PermissionDenied } from "./UIStates";
import { getAuthFetchHeaders, saveServerSessionToken } from "../utils/authSessionClient";
import { auth } from "../firebase";
import { syncUserProfileToFirestore } from "../utils/firestoreSync";
import { apiUrl, getFetchCredentialsMode, isEdgeStandaloneResponse, isOriginUnavailableError } from "../utils/apiBase";
import { edgeChangePassword, edgeLinkManual } from "../utils/edgeLocalAuth";
import { validateAndReadImageFile } from "../utils/fileUploadSecurity";
import { sanitizeConfigForBackup } from "../utils/adminBackup";

export type SettingsSubpage =
  | "business-profile"
  | "general-setup"
  | "company-info"
  | "user-profile"
  | "account-info"
  | "language"
  | "theme"
  | "currency"
  | "units"
  | "format"
  | "std-cost"
  | "act-cost"
  | "products"
  | "costing-pref"
  | "password"
  | "auth"
  | "account-security"
  | "session"
  | "database-info"
  | "backup"
  | "import"
  | "export"
  | "developer-console"
  | "developer-db"
  | "developer-simulator"
  | "developer-diagnostics"
  | null;

interface SettingsSheetProps {
  config: KonfigurasiSistem;
  templates: TemplatPerniagaan[];
  activeProductId: string;
  onUpdateConfig: (newConfig: KonfigurasiSistem) => void;
  onResetToTemplate: (template: TemplatPerniagaan) => void;
  onDeleteProduct: (id: string) => void;
  onAddProduct: (name: string) => void;
  onOpenDatabaseModal?: () => void;
  onOpenAccessMatrixModal?: () => void;
  userRole?: UserRole;
  onSwitchToDeveloper?: () => void;
  theme?: ThemeMode;
  onThemeChange?: (newTheme: ThemeMode) => void;
  currentUser?: {
    id?: string;
    username?: string;
    fullName?: string;
    companyName?: string;
    role?: UserRole;
    email?: string;
    dbKey?: string;
  } | null;
  onLogout?: () => void;
  onLanguageChange?: (lang: Language) => void;
  isRealDeveloperSuperuser?: boolean;
  activeLoadedDbKey?: string;
  onUpdateTemplates?: (tpls: TemplatPerniagaan[]) => void;
  onDatabaseDeleted?: (deletedDbKey: string, nextActiveDbKey?: string, recreatedDbKey?: string) => void;
  onSwitchRole?: (newRole: UserRole) => void;
  onCredentialsUpdated?: (updatedUser: {
    id?: string;
    username?: string;
    fullName?: string;
    companyName?: string;
    role?: UserRole;
    email?: string;
    dbKey?: string;
  }) => void;
  systemLang?: Language;
  initialSubpage?: SettingsSubpage;
}

const MALAYSIAN_STATES = [
  "Johor",
  "Kedah",
  "Kelantan",
  "Melaka",
  "Negeri Sembilan",
  "Pahang",
  "Perak",
  "Perlis",
  "Pulau Pinang",
  "Sabah",
  "Sarawak",
  "Selangor",
  "Terengganu",
  "Wilayah Persekutuan Kuala Lumpur",
  "Wilayah Persekutuan Labuan",
  "Wilayah Persekutuan Putrajaya",
];

const MALAYSIAN_BANKS = [
  "Maybank",
  "CIMB Bank",
  "Public Bank",
  "RHB Bank",
  "Hong Leong Bank",
  "AmBank",
  "Bank Islam",
  "Bank Rakyat",
  "Bank Muamalat",
  "Affin Bank",
  "Alliance Bank",
  "Standard Chartered",
  "HSBC Bank",
  "OCBC Bank",
  "UOB Bank",
];

export default function SettingsSheet({
  config,
  templates,
  activeProductId,
  onUpdateConfig,
  onResetToTemplate,
  onDeleteProduct,
  onAddProduct,
  onOpenDatabaseModal,
  onOpenAccessMatrixModal,
  userRole = "admin",
  onSwitchToDeveloper,
  theme,
  onThemeChange,
  currentUser,
  onLogout,
  onLanguageChange,
  isRealDeveloperSuperuser = false,
  activeLoadedDbKey,
  onUpdateTemplates,
  onDatabaseDeleted,
  onSwitchRole,
  onCredentialsUpdated,
  systemLang,
  initialSubpage = null,
}: SettingsSheetProps) {
  const [currentTheme, setCurrentTheme] = useState<ThemeMode>(
    theme || config.theme || getStoredTheme()
  );
  const authoritativeUsername = (currentUser?.username || config.usernameLogMasuk || "").trim();
  const [localConfig, setLocalConfig] = useState<KonfigurasiSistem>({
    ...config,
    usernameLogMasuk: authoritativeUsername,
    kataLaluanLogMasuk: "",
    language: config.language || systemLang || getStoredLanguage(),
  });
  const [activeSubpage, setActiveSubpage] = useState<SettingsSubpage>(initialSubpage);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [credentialSuccessMsg, setCredentialSuccessMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [currentPasswordInput, setCurrentPasswordInput] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isSavingCredentials, setIsSavingCredentials] = useState(false);
  const [newMenuName, setNewMenuName] = useState("");
  const [menuPendingDelete, setMenuPendingDelete] = useState<TemplatPerniagaan | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Optional 2FA (TOTP Authenticator) management states for privileged roles
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [twoFaSupported, setTwoFaSupported] = useState(userRole === "admin" || userRole === "developer");
  const [twoFaPendingSecret, setTwoFaPendingSecret] = useState<string | null>(null);
  const [twoFaOtpUri, setTwoFaOtpUri] = useState<string | null>(null);
  const [twoFaCodeInput, setTwoFaCodeInput] = useState("");
  const [twoFaDisablePassword, setTwoFaDisablePassword] = useState("");
  const [twoFaBusy, setTwoFaBusy] = useState(false);
  const [twoFaMsg, setTwoFaMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Helper to extract clean business form data
  const getInitialBusinessData = (cfg: KonfigurasiSistem) => ({
    companyName: cfg.namaSyarikat || cfg.generalSetup?.companyName || "SCHOOL ENTERPRISE",
    logoUrl: cfg.generalSetup?.logoUrl || "",
    businessRegNo: cfg.generalSetup?.businessRegNo || "118934-V",
    addressLine1: cfg.generalSetup?.addressLine1 || "NO 4, JALAN HARIMAU 18 TAMAN PERLING",
    postcode: cfg.generalSetup?.postcode || "81300",
    city: cfg.generalSetup?.city || "JOHOR BAHRU",
    state: cfg.generalSetup?.state || "Johor",
    country: cfg.generalSetup?.country || "Malaysia",
    phone1: cfg.generalSetup?.phone1 || "604-6561234",
    email: cfg.generalSetup?.email || "info@amgsdnbhd.com.my",
    website: cfg.generalSetup?.website || "https://www.amgsdnbhd.com.my",
    bankName: cfg.generalSetup?.bankName || "Maybank",
    bankAccountNo: cfg.generalSetup?.bankAccountNo || "5512-3456-7890",
    bankAccountHolder: cfg.generalSetup?.bankAccountHolder || cfg.namaSyarikat || "SCHOOL ENTERPRISE",
  });

  const [businessForm, setBusinessForm] = useState(() => getInitialBusinessData(config));

  useEffect(() => {
    setLocalConfig({
      ...config,
      usernameLogMasuk: (currentUser?.username || config.usernameLogMasuk || "").trim(),
      kataLaluanLogMasuk: "",
      language: config.language || systemLang || getStoredLanguage(),
    });
    setBusinessForm(getInitialBusinessData(config));
  }, [config, currentUser?.username, systemLang]);

  useEffect(() => {
    if (theme) {
      setCurrentTheme(theme);
    }
  }, [theme]);

  useEffect(() => {
    if (initialSubpage) {
      setActiveSubpage(initialSubpage);
    }
  }, [initialSubpage]);

  useEffect(() => {
    setCurrentPasswordInput("");
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setCredentialSuccessMsg(null);
    setSaveError(null);
    setLocalConfig((prev) => ({
      ...prev,
      usernameLogMasuk: (currentUser?.username || config.usernameLogMasuk || prev.usernameLogMasuk || "").trim(),
      kataLaluanLogMasuk: "",
    }));
  }, [activeSubpage, currentUser?.username, config.usernameLogMasuk]);

  useEffect(() => {
    if ((activeSubpage === "password" || activeSubpage === "auth") && (userRole === "admin" || userRole === "developer")) {
      setTwoFaMsg(null);
      getAuthFetchHeaders()
        .then((headers) =>
          fetch(apiUrl("/api/auth/2fa/status"), {
            credentials: getFetchCredentialsMode(),
            headers,
          })
        )
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) {
            setTwoFaSupported(Boolean(d.supported));
            setTwoFaEnabled(Boolean(d.enabled));
          }
        })
        .catch(() => {});
    }
  }, [activeSubpage, userRole]);

  const handleStart2FASetup = async () => {
    setTwoFaMsg(null);
    setTwoFaBusy(true);
    try {
      const headers = await getAuthFetchHeaders({ "Content-Type": "application/json" });
      const res = await fetch(apiUrl("/api/auth/2fa/setup"), {
        method: "POST",
        credentials: getFetchCredentialsMode(),
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.manualSecret) {
        setTwoFaMsg({
          type: "err",
          text: data.error || (currentLang === "en" ? "Failed to initialize 2FA setup." : "Gagal memulakan persediaan 2FA."),
        });
        return;
      }
      setTwoFaPendingSecret(data.manualSecret);
      setTwoFaOtpUri(data.otpAuthUri || null);
      setTwoFaCodeInput("");
    } catch {
      setTwoFaMsg({
        type: "err",
        text: currentLang === "en" ? "Server connection error." : "Ralat sambungan pelayan.",
      });
    } finally {
      setTwoFaBusy(false);
    }
  };

  const handleConfirmEnable2FA = async () => {
    setTwoFaMsg(null);
    setTwoFaBusy(true);
    try {
      const headers = await getAuthFetchHeaders({ "Content-Type": "application/json" });
      const res = await fetch(apiUrl("/api/auth/2fa/enable"), {
        method: "POST",
        credentials: getFetchCredentialsMode(),
        headers,
        body: JSON.stringify({ totpCode: twoFaCodeInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setTwoFaMsg({
          type: "err",
          text: data.error || (currentLang === "en" ? "Invalid 2FA code." : "Kod 2FA tidak sah."),
        });
        return;
      }
      setTwoFaEnabled(true);
      setTwoFaPendingSecret(null);
      setTwoFaOtpUri(null);
      setTwoFaCodeInput("");
      setTwoFaMsg({
        type: "ok",
        text: currentLang === "en" ? "Two-Factor Authentication (2FA) enabled." : "Pengesahan Dua Faktor (2FA) berjaya diaktifkan.",
      });
    } catch {
      setTwoFaMsg({
        type: "err",
        text: currentLang === "en" ? "Server connection error." : "Ralat sambungan pelayan.",
      });
    } finally {
      setTwoFaBusy(false);
    }
  };

  const handleDisable2FA = async () => {
    setTwoFaMsg(null);
    setTwoFaBusy(true);
    try {
      const headers = await getAuthFetchHeaders({ "Content-Type": "application/json" });
      const res = await fetch(apiUrl("/api/auth/2fa/disable"), {
        method: "POST",
        credentials: getFetchCredentialsMode(),
        headers,
        body: JSON.stringify({
          currentPassword: twoFaDisablePassword,
          totpCode: twoFaCodeInput.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setTwoFaMsg({
          type: "err",
          text: data.error || (currentLang === "en" ? "Failed to disable 2FA." : "Gagal menyahaktifkan 2FA."),
        });
        return;
      }
      setTwoFaEnabled(false);
      setTwoFaDisablePassword("");
      setTwoFaCodeInput("");
      setTwoFaMsg({
        type: "ok",
        text: currentLang === "en" ? "Two-Factor Authentication (2FA) disabled." : "Pengesahan Dua Faktor (2FA) telah dinyahaktifkan.",
      });
    } catch {
      setTwoFaMsg({
        type: "err",
        text: currentLang === "en" ? "Server connection error." : "Ralat sambungan pelayan.",
      });
    } finally {
      setTwoFaBusy(false);
    }
  };

  const currentLang: Language = localConfig.language || systemLang || "en";
  const t = getTranslation(currentLang);
  const roleDef = getLocalizedRoleDef(userRole, ROLE_DEFINITIONS[userRole] || ROLE_DEFINITIONS.admin, currentLang);
  const isAuthorizedDeveloper = Boolean(isRealDeveloperSuperuser);
  const isDeveloperActor = userRole === "developer" || isAuthorizedDeveloper;

  const handleThemeChange = (newTheme: ThemeMode) => {
    setCurrentTheme(newTheme);
    setStoredTheme(newTheme);
    if (onThemeChange) {
      onThemeChange(newTheme);
    }
    const updated = { ...localConfig, theme: newTheme };
    setLocalConfig(updated);
    onUpdateConfig(updated);
  };

  const handleLanguageChange = (lang: Language) => {
    const updated = { ...localConfig, language: lang };
    setLocalConfig(updated);
    setStoredLanguage(lang);
    if (onLanguageChange) {
      onLanguageChange(lang);
    }
    onUpdateConfig(updated);
  };

  const handleSaveConfig = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaveError(null);
    if (!roleDef.canEditSettings) {
      setSaveError(
        currentLang === "en"
          ? "Only System Administrator (Admin) is allowed to modify system configuration."
          : "Hanya Pentadbir Sistem (Admin) yang dibenarkan mengubah konfigurasi ini."
      );
      return;
    }
    onUpdateConfig(localConfig);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 4000);
  };

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(false);
    setCredentialSuccessMsg(null);

    if (!roleDef.canEditSettings && userRole !== "admin" && userRole !== "developer") {
      setSaveError(
        currentLang === "en"
          ? "Only System Administrator (Admin) is allowed to modify credentials."
          : "Hanya Pentadbir Sistem (Admin) yang dibenarkan mengubah kredensial ini."
      );
      return;
    }

    const newUsername = (localConfig.usernameLogMasuk || "").trim();
    const newPassword = localConfig.kataLaluanLogMasuk || "";
    const existingUsername = (currentUser?.username || config.usernameLogMasuk || "").trim();
    const isUsernameChanged = Boolean(newUsername !== existingUsername);

    if (!newUsername || !/^[a-zA-Z0-9._-]{3,64}$/.test(newUsername)) {
      setSaveError(
        currentLang === "en"
          ? "Username must be 3–64 characters and contain only letters, numbers, dots (.), underscores (_), or hyphens (-)."
          : "Nama pengguna mestilah 3–64 aksara dan hanya huruf, nombor, titik (.), garis bawah (_), atau sempang (-)."
      );
      return;
    }
    if (!newPassword && !isUsernameChanged) {
      setSaveError(
        currentLang === "en"
          ? "No changes to save."
          : "Tiada perubahan untuk disimpan."
      );
      return;
    }
    if (!currentPasswordInput) {
      setSaveError(currentLang === "en" ? "Current password is incorrect." : "Kata laluan semasa tidak betul.");
      return;
    }
    if (newPassword && (newPassword.length < 8 || newPassword === currentPasswordInput)) {
      setSaveError(
        currentLang === "en"
          ? "New password must be at least 8 characters and different from the current one."
          : "Kata laluan baharu mesti sekurang-kurangnya 8 aksara dan berbeza daripada yang semasa."
      );
      return;
    }

    setIsSavingCredentials(true);
    try {
      const headers = await getAuthFetchHeaders({ "Content-Type": "application/json" });
      let resp: Response | null = null;
      let data: any = {};
      let resolvedOk = false;
      let resolvedStatus = 0;
      let netErr: unknown = null;

      try {
        resp = await fetch(apiUrl("/api/auth/change-password"), {
          method: "POST",
          credentials: getFetchCredentialsMode(),
          headers,
          body: JSON.stringify({
            userId: currentUser?.id,
            currentPassword: currentPasswordInput,
            newPassword,
            newUsername,
          }),
        });
        data = await resp.json().catch(() => ({}));
        resolvedOk = resp.ok;
        resolvedStatus = resp.status;
      } catch (err) {
        netErr = err;
      }

      if (
        (netErr && isOriginUnavailableError(netErr)) ||
        (resp !== null && isEdgeStandaloneResponse(resp.status, data))
      ) {
        let edgeRes = await edgeChangePassword({
          userId: currentUser?.id,
          username: currentUser?.username || localConfig.usernameLogMasuk,
          currentPassword: currentPasswordInput,
          newPassword,
          newUsername,
          lang: currentLang,
        });
        if (!edgeRes.success && edgeRes.code === "NO_MANUAL_PASSWORD_SET" && newPassword.length >= 8) {
          edgeRes = await edgeLinkManual({
            userId: currentUser?.id,
            username: newUsername,
            password: newPassword,
            fullName: currentUser?.fullName,
            companyName: currentUser?.companyName,
            email: currentUser?.email,
            role: currentUser?.role,
            dbKey: currentUser?.dbKey,
            lang: currentLang,
          });
        }
        resolvedOk = edgeRes.success;
        resolvedStatus = edgeRes.status;
        data = edgeRes;
      } else if (netErr) {
        throw netErr;
      } else if (resp && !resp.ok && data?.code === "NO_MANUAL_PASSWORD_SET") {
        if (!newPassword || newPassword.length < 8) {
          setSaveError(
            currentLang === "en"
              ? "New password must be at least 8 characters and different from the current one."
              : "Kata laluan baharu mesti sekurang-kurangnya 8 aksara dan berbeza daripada yang semasa."
          );
          return;
        }
        resp = await fetch(apiUrl("/api/auth/link-manual"), {
          method: "POST",
          credentials: getFetchCredentialsMode(),
          headers,
          body: JSON.stringify({
            userId: currentUser?.id,
            username: newUsername,
            password: newPassword,
          }),
        });
        data = await resp.json().catch(() => ({}));
        resolvedOk = resp.ok;
        resolvedStatus = resp.status;
      }

      if (!resolvedOk || !data.success) {
        if (resolvedStatus === 429 || data?.code === "CHANGE_PASSWORD_LOCKED") {
          setSaveError(
            currentLang === "en"
              ? "Too many attempts. Try again in 15 minutes."
              : "Terlalu banyak percubaan. Cuba lagi selepas 15 minit."
          );
        } else if (data?.code === "NO_CHANGES") {
          setSaveError(
            currentLang === "en"
              ? "No changes to save."
              : "Tiada perubahan untuk disimpan."
          );
        } else if (data?.code === "USERNAME_TAKEN") {
          setSaveError(
            currentLang === "en"
              ? "Username is already taken."
              : "Nama pengguna sudah digunakan."
          );
        } else if (data?.code === "INVALID_USERNAME") {
          setSaveError(
            currentLang === "en"
              ? "Username must be 3–64 characters and contain only letters, numbers, dots (.), underscores (_), or hyphens (-)."
              : "Nama pengguna mestilah 3–64 aksara dan hanya huruf, nombor, titik (.), garis bawah (_), atau sempang (-)."
          );
        } else if (data?.code === "USERNAME_RESERVED") {
          setSaveError(
            currentLang === "en"
              ? "This username is reserved by the system."
              : "Nama pengguna ini terpelihara oleh sistem."
          );
        } else if (data?.code === "INVALID_CURRENT_PASSWORD") {
          setSaveError(
            currentLang === "en"
              ? "Current password is incorrect."
              : "Kata laluan semasa tidak betul."
          );
        } else if (data?.code === "INVALID_NEW_PASSWORD") {
          setSaveError(
            currentLang === "en"
              ? "New password must be at least 8 characters and different from the current one."
              : "Kata laluan baharu mesti sekurang-kurangnya 8 aksara dan berbeza daripada yang semasa."
          );
        } else {
          setSaveError(data.error || (currentLang === "en" ? "Failed to update credentials." : "Gagal mengemas kini kredensial."));
        }
        return;
      }

      saveServerSessionToken(data.sessionToken, data.csrfToken);
      const savedUsername = data.user?.username || newUsername;
      const updatedSafeConfig = {
        ...localConfig,
        usernameLogMasuk: savedUsername,
        kataLaluanLogMasuk: "",
      };
      setLocalConfig(updatedSafeConfig);
      setCurrentPasswordInput("");
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      onUpdateConfig(updatedSafeConfig);
      if (data.user && onCredentialsUpdated) {
        onCredentialsUpdated(data.user);
      }
      if (data.user && auth.currentUser) {
        syncUserProfileToFirestore(data.user).catch(console.warn);
      }
      setCredentialSuccessMsg(
        currentLang === "en"
          ? "Login details updated. Use the new username and password next time you sign in."
          : "Maklumat log masuk dikemas kini. Gunakan nama pengguna dan kata laluan baharu pada log masuk seterusnya."
      );
      setTimeout(() => setCredentialSuccessMsg(null), 6000);
    } catch {
      setSaveError(currentLang === "en" ? "Server connection error while updating credentials." : "Ralat sambungan pelayan semasa mengemas kini kredensial.");
    } finally {
      setIsSavingCredentials(false);
    }
  };

  // Dedicated Handler for Logo File Upload (strict magic-bytes + <=2MB, SVG/HTML blocked)
  const handleLogoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setSaveError(null);
    if (!file) return;
    const res = await validateAndReadImageFile(file, currentLang === "en" ? "en" : "ms");
    if (res.ok === false) {
      setSaveError(res.error);
      if (logoInputRef.current) logoInputRef.current.value = "";
      return;
    }
    setBusinessForm((prev) => ({ ...prev, logoUrl: res.dataUrl }));
  };

  // Dedicated Handler to Save Business Information Form
  const handleSaveBusinessProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    if (!roleDef.canEditSettings) {
      setSaveError(
        currentLang === "en"
          ? "Only System Administrator (Admin) is allowed to modify business information."
          : "Hanya Pentadbir Sistem (Admin) yang dibenarkan mengubah maklumat perniagaan."
      );
      return;
    }

    const companyNameTrimmed = businessForm.companyName.trim() || localConfig.namaSyarikat;

    const updatedGeneralSetup: GeneralSetupConfig = {
      accountingPeriodFrom: localConfig.generalSetup?.accountingPeriodFrom || "01/01/2025",
      accountingPeriodTo: localConfig.generalSetup?.accountingPeriodTo || "31/12/2025",
      actualStartDate: localConfig.generalSetup?.actualStartDate || "31/12/2024",
      defaultCurrency: localConfig.currency || "MYR",
      taxCountry: localConfig.generalSetup?.taxCountry || "Malaysia",
      ...(localConfig.generalSetup || {}),
      companyName: companyNameTrimmed,
      logoUrl: businessForm.logoUrl,
      businessRegNo: businessForm.businessRegNo.trim(),
      addressLine1: businessForm.addressLine1.trim(),
      addressLine2: localConfig.generalSetup?.addressLine2 || "",
      addressLine3: localConfig.generalSetup?.addressLine3 || "",
      postcode: businessForm.postcode.trim(),
      city: businessForm.city.trim(),
      state: businessForm.state.trim(),
      country: businessForm.country.trim() || "Malaysia",
      phone1: businessForm.phone1.trim(),
      email: businessForm.email.trim(),
      website: businessForm.website.trim(),
      bankName: businessForm.bankName.trim(),
      bankAccountNo: businessForm.bankAccountNo.trim(),
      bankAccountHolder: businessForm.bankAccountHolder.trim(),
      bankAccount: `${businessForm.bankAccountNo.trim()}${businessForm.bankName ? ` (${businessForm.bankName.trim()})` : ""}`,
    };

    const updatedConfig: KonfigurasiSistem = {
      ...localConfig,
      namaSyarikat: companyNameTrimmed,
      generalSetup: updatedGeneralSetup,
    };

    setLocalConfig(updatedConfig);
    onUpdateConfig(updatedConfig);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 4000);
  };

  const handleCancelBusinessProfile = () => {
    // Revert form back to existing localConfig
    setBusinessForm(getInitialBusinessData(localConfig));
    setActiveSubpage(null);
  };

  // ---------------------------------------------------------------------------
  // SUBPAGES RENDERER
  // ---------------------------------------------------------------------------
  if (activeSubpage) {
    // 1. Developer Console Subpage (strictly guarded by server-verified developer status)
    if (
      activeSubpage === "developer-console" ||
      activeSubpage === "developer-db" ||
      activeSubpage === "developer-simulator" ||
      activeSubpage === "developer-diagnostics"
    ) {
      if (!isAuthorizedDeveloper) {
        return (
          <PermissionDenied
            roleName={roleDef.title}
            requiredPermission="developer"
            lang={currentLang}
            onGoBack={() => setActiveSubpage(null)}
          />
        );
      }

      const initialConsoleTab =
        activeSubpage === "developer-simulator" ? "simulator" : "databases";

      return (
        <div className="space-y-4 animate-fadeIn">
          {/* Top navigation back button */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setActiveSubpage(null)}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>{t.settings.backToSettings || "Kembali ke Tetapan"}</span>
            </button>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                {currentLang === "en" ? "Developer Access Active" : "Akses Pembangun Aktif"}
              </span>
            </div>
          </div>

          <DeveloperConsoleSheet
            currentRole={userRole}
            onSwitchRole={onSwitchRole || (() => {})}
            config={localConfig}
            onUpdateConfig={(cfg) => {
              setLocalConfig(cfg);
              onUpdateConfig(cfg);
            }}
            templates={templates}
            onOpenDatabaseModal={isAuthorizedDeveloper ? (onOpenDatabaseModal || (() => {})) : (() => {})}
            onOpenAccessMatrixModal={onOpenAccessMatrixModal || (() => {})}
            systemLang={currentLang}
            currentUser={currentUser}
            activeLoadedDbKey={activeLoadedDbKey}
            isRealDeveloperSuperuser={isRealDeveloperSuperuser}
            onUpdateTemplates={onUpdateTemplates}
            onDatabaseDeleted={onDatabaseDeleted}
            initialTab={initialConsoleTab}
          />
        </div>
      );
    }

    // Generic subpage header
    const renderSubpageHeader = (categoryName: string, itemTitle: string, itemDesc: string) => (
      <div className="space-y-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setActiveSubpage(null)}
            className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>{t.settings.backToSettings || "Kembali ke Tetapan"}</span>
          </button>
          <span className="text-[11px] font-mono font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            {categoryName}
          </span>
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            {itemTitle}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {itemDesc}
          </p>
        </div>
      </div>
    );

    return (
      <div className={`max-w-4xl mx-auto space-y-6 pb-12 ${activeSubpage === "general-setup" ? "" : "animate-fadeIn"}`}>
        {/* A. Business Profile / Maklumat Perniagaan Form (Direct Navigation & Full 12 Fields) */}
        {activeSubpage === "business-profile" && (
          <div className="space-y-6">
            {renderSubpageHeader(
              t.settings.categories?.accountProfile || "AKAUN & PROFIL",
              currentLang === "en" ? "Business Information Form" : "Borang Maklumat Perniagaan",
              currentLang === "en"
                ? "Manage official company name, logo, address, registration numbers, and banking details"
                : "Lengkapkan maklumat rasmi perniagaan, logo syarikat, alamat premis dan akaun bank"
            )}

            <form
              onSubmit={handleSaveBusinessProfile}
              className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-6 shadow-xs"
            >
              {/* SECTION 1: IDENTITI & LOGO SYARIKAT */}
              <div className="space-y-4">
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300 pb-2 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
                  <Building className="w-4 h-4" />
                  <span>1. {currentLang === "en" ? "Company Identity & Logo" : "Identiti Syarikat & Logo"}</span>
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
                  {/* 2. Company Logo */}
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {currentLang === "en" ? "Company Logo" : "Logo Syarikat"}
                    </label>
                    <div className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl bg-slate-50 dark:bg-slate-900/60 text-center space-y-3">
                      <div className="w-20 h-20 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden shadow-2xs">
                        {businessForm.logoUrl ? (
                          <img
                            src={businessForm.logoUrl}
                            alt={currentLang === "en" ? "Company Logo" : "Logo Syarikat"}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <ImageIcon className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          ref={logoInputRef}
                          type="file"
                          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={handleLogoFileUpload}
                          disabled={!roleDef.canEditSettings}
                        />
                        <button
                          type="button"
                          onClick={() => logoInputRef.current?.click()}
                          disabled={!roleDef.canEditSettings}
                          className="px-3 py-1.5 bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/60 text-[#0b3c7a] dark:text-sky-300 text-xs font-semibold rounded-lg border border-sky-200 dark:border-sky-800 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>{currentLang === "en" ? "Upload Logo" : "Muat Naik"}</span>
                        </button>
                        {businessForm.logoUrl && (
                          <button
                            type="button"
                            onClick={() => setBusinessForm({ ...businessForm, logoUrl: "" })}
                            disabled={!roleDef.canEditSettings}
                            className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-all cursor-pointer"
                            title={currentLang === "en" ? "Remove Logo" : "Padam Logo"}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400">
                        {currentLang === "en" ? "PNG, JPG or WEBP (Max 2MB)" : "PNG, JPG atau WEBP (Maks. 2MB)"}
                      </p>
                    </div>
                  </div>

                  <div className="md:col-span-2 space-y-4">
                    {/* 1. Company Name */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {currentLang === "en" ? "Company Name" : "Nama Syarikat / Perniagaan"} <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                          <Building className="w-4 h-4" />
                        </span>
                        <input
                          type="text"
                          value={businessForm.companyName}
                          onChange={(e) => setBusinessForm({ ...businessForm, companyName: e.target.value })}
                          onKeyDown={handleInputEnterKey}
                          disabled={!roleDef.canEditSettings}
                          placeholder={currentLang === "en" ? "e.g. AMG SDN BHD / ABC FOODS ENTERPRISE" : "cth: AMG SDN BHD / ABC FOODS ENTERPRISE"}
                          className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white focus:border-[#0b3c7a] outline-hidden"
                          required
                        />
                      </div>
                    </div>

                    {/* 3. Business Registration Number */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {currentLang === "en" ? "Business Registration Number (SSM)" : "No. Pendaftaran Perniagaan (SSM)"} <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                          <FileText className="w-4 h-4" />
                        </span>
                        <input
                          type="text"
                          value={businessForm.businessRegNo}
                          onChange={(e) => setBusinessForm({ ...businessForm, businessRegNo: e.target.value })}
                          onKeyDown={handleInputEnterKey}
                          disabled={!roleDef.canEditSettings}
                          placeholder={currentLang === "en" ? "e.g. 118934-V or 202401001234" : "cth: 118934-V atau 202401001234"}
                          className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono font-medium text-slate-900 dark:text-white focus:border-[#0b3c7a] outline-hidden"
                          required
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 2: ALAMAT PREMIS & LOKASI */}
              <div className="space-y-4 pt-2">
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300 pb-2 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  <span>2. {currentLang === "en" ? "Business Address & Location" : "Alamat Premis & Lokasi"}</span>
                </h4>

                <div className="space-y-4">
                  {/* 4. Business Address */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {currentLang === "en" ? "Business Address (Street / Building)" : "Alamat Premis / Perniagaan (Jalan & Bangunan)"} <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={businessForm.addressLine1}
                      onChange={(e) => setBusinessForm({ ...businessForm, addressLine1: e.target.value })}
                      onKeyDown={handleInputEnterKey}
                      disabled={!roleDef.canEditSettings}
                      placeholder={currentLang === "en" ? "e.g. NO 4, JALAN HARIMAU 18, TAMAN PERLING" : "cth: NO 4, JALAN HARIMAU 18, TAMAN PERLING"}
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:border-[#0b3c7a] outline-hidden"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    {/* 5. Postcode */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {currentLang === "en" ? "Postcode" : "Poskod"} <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={businessForm.postcode}
                        onChange={(e) => setBusinessForm({ ...businessForm, postcode: e.target.value })}
                        onKeyDown={handleInputEnterKey}
                        disabled={!roleDef.canEditSettings}
                        placeholder="81300"
                        className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono font-medium text-slate-900 dark:text-white focus:border-[#0b3c7a] outline-hidden"
                        required
                      />
                    </div>

                    {/* 6. City */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {currentLang === "en" ? "City" : "Bandar"} <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={businessForm.city}
                        onChange={(e) => setBusinessForm({ ...businessForm, city: e.target.value })}
                        onKeyDown={handleInputEnterKey}
                        disabled={!roleDef.canEditSettings}
                        placeholder="JOHOR BAHRU"
                        className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:border-[#0b3c7a] outline-hidden"
                        required
                      />
                    </div>

                    {/* 7. State */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {currentLang === "en" ? "State" : "Negeri"} <span className="text-rose-500">*</span>
                      </label>
                      <select
                        value={businessForm.state}
                        onChange={(e) => setBusinessForm({ ...businessForm, state: e.target.value })}
                        disabled={!roleDef.canEditSettings}
                        className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:border-[#0b3c7a] outline-hidden cursor-pointer"
                        required
                      >
                        {MALAYSIAN_STATES.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* 8. Country */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {currentLang === "en" ? "Country" : "Negara"}
                      </label>
                      <input
                        type="text"
                        value={businessForm.country}
                        onChange={(e) => setBusinessForm({ ...businessForm, country: e.target.value })}
                        onKeyDown={handleInputEnterKey}
                        disabled={!roleDef.canEditSettings}
                        placeholder="Malaysia"
                        className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:border-[#0b3c7a] outline-hidden"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 3: PERHUBUNGAN & WEB */}
              <div className="space-y-4 pt-2">
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300 pb-2 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  <span>3. {currentLang === "en" ? "Contact & Online Presence" : "Maklumat Perhubungan & Web"}</span>
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* 9. Phone Number */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {currentLang === "en" ? "Phone Number" : "No. Telefon"} <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                        <Phone className="w-4 h-4" />
                      </span>
                      <input
                        type="text"
                        value={businessForm.phone1}
                        onChange={(e) => setBusinessForm({ ...businessForm, phone1: e.target.value })}
                        onKeyDown={handleInputEnterKey}
                        disabled={!roleDef.canEditSettings}
                        placeholder={currentLang === "en" ? "604-6561234 or 012-3456789" : "604-6561234 atau 012-3456789"}
                        className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono font-medium text-slate-900 dark:text-white focus:border-[#0b3c7a] outline-hidden"
                        required
                      />
                    </div>
                  </div>

                  {/* 10. Email Address */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {currentLang === "en" ? "Email Address" : "Alamat Emel"} <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                        <Mail className="w-4 h-4" />
                      </span>
                      <input
                        type="email"
                        value={businessForm.email}
                        onChange={(e) => setBusinessForm({ ...businessForm, email: e.target.value })}
                        onKeyDown={handleInputEnterKey}
                        disabled={!roleDef.canEditSettings}
                        placeholder="info@amgsdnbhd.com.my"
                        className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:border-[#0b3c7a] outline-hidden"
                        required
                      />
                    </div>
                  </div>

                  {/* 11. Website */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {currentLang === "en" ? "Website" : "Laman Web"}
                    </label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                        <ExternalLink className="w-4 h-4" />
                      </span>
                      <input
                        type="url"
                        value={businessForm.website}
                        onChange={(e) => setBusinessForm({ ...businessForm, website: e.target.value })}
                        onKeyDown={handleInputEnterKey}
                        disabled={!roleDef.canEditSettings}
                        placeholder="https://www.amgsdnbhd.com.my"
                        className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:border-[#0b3c7a] outline-hidden"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 4: MAKLUMAT AKAUN BANK */}
              <div className="space-y-4 pt-2">
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300 pb-2 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
                  <CreditCard className="w-4 h-4" />
                  <span>4. {currentLang === "en" ? "Bank Account Information" : "Maklumat Akaun Bank Perniagaan"}</span>
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Bank Name */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {currentLang === "en" ? "Bank Name" : "Nama Bank"}
                    </label>
                    <input
                      type="text"
                      list="malaysian-banks-list"
                      value={businessForm.bankName}
                      onChange={(e) => setBusinessForm({ ...businessForm, bankName: e.target.value })}
                      onKeyDown={handleInputEnterKey}
                      disabled={!roleDef.canEditSettings}
                      placeholder="Maybank / CIMB"
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:border-[#0b3c7a] outline-hidden"
                    />
                    <datalist id="malaysian-banks-list">
                      {MALAYSIAN_BANKS.map((b) => (
                        <option key={b} value={b} />
                      ))}
                    </datalist>
                  </div>

                  {/* Bank Account Number */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {currentLang === "en" ? "Bank Account Number" : "No. Akaun Bank"}
                    </label>
                    <input
                      type="text"
                      value={businessForm.bankAccountNo}
                      onChange={(e) => setBusinessForm({ ...businessForm, bankAccountNo: e.target.value })}
                      onKeyDown={handleInputEnterKey}
                      disabled={!roleDef.canEditSettings}
                      placeholder="5512-3456-7890"
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono font-medium text-slate-900 dark:text-white focus:border-[#0b3c7a] outline-hidden"
                    />
                  </div>

                  {/* Account Holder Name */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {currentLang === "en" ? "Account Holder Name" : "Nama Pemegang Akaun"}
                    </label>
                    <input
                      type="text"
                      value={businessForm.bankAccountHolder}
                      onChange={(e) => setBusinessForm({ ...businessForm, bankAccountHolder: e.target.value })}
                      onKeyDown={handleInputEnterKey}
                      disabled={!roleDef.canEditSettings}
                      placeholder="AMG SDN BHD"
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:border-[#0b3c7a] outline-hidden"
                    />
                  </div>
                </div>
              </div>

              {/* Notices */}
              {saveSuccess && (
                <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs flex items-center gap-2 border border-emerald-200 dark:border-emerald-800 animate-fadeIn">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>
                    {currentLang === "en"
                      ? "Business information successfully saved and synced across all system records!"
                      : "Maklumat perniagaan telah berjaya disimpan dan disegerakkan ke seluruh sistem!"}
                  </span>
                </div>
              )}

              {saveError && (
                <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 rounded-xl text-xs flex items-center gap-2 border border-rose-200 dark:border-rose-800 animate-fadeIn">
                  <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                  <span>{saveError}</span>
                </div>
              )}

              {/* ACTION BUTTONS: SAVE & CANCEL */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCancelBusinessProfile}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold transition-all cursor-pointer shadow-2xs"
                >
                  {currentLang === "en" ? "Cancel" : "Batal"}
                </button>

                {roleDef.canEditSettings && (
                  <button
                    type="submit"
                    className="px-6 py-2.5 bg-[#0b3c7a] hover:bg-[#093163] text-white font-bold text-xs rounded-xl shadow-md shadow-blue-900/20 transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>{currentLang === "en" ? "Save Business Information" : "Simpan Maklumat Perniagaan"}</span>
                  </button>
                )}
              </div>
            </form>
          </div>
        )}

        {/* General Setup */}
        {activeSubpage === "general-setup" && (
          <div className="space-y-6">
            {renderSubpageHeader(
              t.settings.categories?.accountProfile || "AKAUN & PROFIL",
              t.settings.items?.generalSetup || "Persediaan Umum",
              t.settings.items?.generalSetupDesc || "Tempoh perakaunan, SST / GST dan tetapan cukai syarikat"
            )}
            <GeneralSetupModal
              isOpen={true}
              inline={true}
              onClose={() => setActiveSubpage(null)}
              config={localConfig}
              onSaveConfig={(updated) => {
                setLocalConfig(updated);
                onUpdateConfig(updated);
              }}
              systemLang={currentLang}
            />
          </div>
        )}

        {/* Company Info */}
        {activeSubpage === "company-info" && (
          <div className="space-y-6">
            {renderSubpageHeader(
              t.settings.categories?.accountProfile,
              t.settings.items?.companyInfo,
              t.settings.items?.companyInfoDesc
            )}
            <div className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-slate-400 font-medium block">{t.generalSetup.companyName}</span>
                  <p className="font-bold text-slate-800 dark:text-slate-100 text-sm mt-1">
                    {localConfig.namaSyarikat || "SmartCost Enterprise"}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400 font-medium block">{t.generalSetup.regNo}</span>
                  <p className="font-bold text-slate-800 dark:text-slate-100 text-sm mt-1">
                    {localConfig.generalSetup?.businessRegNo || "118934-V"}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400 font-medium block">{t.generalSetup.address}</span>
                  <p className="font-medium text-slate-700 dark:text-slate-300 mt-1">
                    {localConfig.generalSetup?.addressLine1 || "No 4, Jalan Harimau 18, Taman Perling, Johor Bahru"}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400 font-medium block">
                    {currentLang === "en" ? "Contact Details" : "Maklumat Perhubungan"}
                  </span>
                  <p className="font-medium text-slate-700 dark:text-slate-300 mt-1">
                    Tel: {localConfig.generalSetup?.phone1 || "07-2345678"} | {currentLang === "en" ? "Email" : "Emel"}: {localConfig.generalSetup?.email || "info@smartcost.my"}
                  </p>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                <button
                  type="button"
                  onClick={() => setActiveSubpage("business-profile")}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer"
                >
                  <Building className="w-4 h-4 text-[#0b3c7a] dark:text-sky-400" />
                  <span>{currentLang === "en" ? "Edit Business Profile" : "Kemaskini Maklumat Syarikat"}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* User Profile */}
        {activeSubpage === "user-profile" && (
          <div className="space-y-6">
            {renderSubpageHeader(
              t.settings.categories?.accountProfile,
              t.settings.items?.userProfile,
              t.settings.items?.userProfileDesc
            )}
            <div className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xs">
              <div className="flex items-center gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                <div className="w-14 h-14 rounded-2xl bg-[#0b3c7a] text-white flex items-center justify-center font-bold text-lg">
                  {currentUser?.username?.[0]?.toUpperCase() || "U"}
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">
                    {currentUser?.fullName || currentUser?.username || (currentLang === "en" ? "SmartCost Administrator" : "Pentadbir SmartCost")}
                  </h3>
                  <span className="inline-block mt-0.5 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-blue-100 text-[#0b3c7a] dark:bg-sky-950 dark:text-sky-300 border border-blue-200 dark:border-sky-800">
                    {roleDef.title}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-slate-400 font-medium block">{t.login.username}</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200 mt-1 block">
                    {currentUser?.username || localConfig.usernameLogMasuk || "admin"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 font-medium block">
                    {currentLang === "en" ? "Email / Contact" : "Emel / Hubungan"}
                  </span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200 mt-1 block">
                    {currentUser?.email || "admin@smartcost.my"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Account Info */}
        {activeSubpage === "account-info" && (
          <div className="space-y-6">
            {renderSubpageHeader(
              t.settings.categories?.accountProfile,
              t.settings.items?.accountInfo,
              t.settings.items?.accountInfoDesc
            )}
            <div className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800">
                  <span className="text-slate-400 block font-medium">
                    {currentLang === "en" ? "Isolated Database Scope" : "Pangkalan Data Terasing"}
                  </span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200 mt-1 block truncate">
                    {activeLoadedDbKey || "pengekosan_company_db_smartcost"}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800">
                  <span className="text-slate-400 block font-medium">
                    {currentLang === "en" ? "Workspace Isolation Status" : "Status Pengasingan Ruang Kerja"}
                  </span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 mt-1 block flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>
                      {currentLang === "en"
                        ? "Active & Protected (100% Isolated)"
                        : "Aktif & Terpelihara (Terasing Penuh)"}
                    </span>
                  </span>
                </div>
              </div>
              {isAuthorizedDeveloper && onOpenDatabaseModal && (
                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={onOpenDatabaseModal}
                    className="px-4 py-2 bg-[#0b3c7a] hover:bg-[#093163] text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-2"
                  >
                    <Database className="w-4 h-4 text-sky-400" />
                    <span>{currentLang === "en" ? "Manage Company Database" : "Urus Pangkalan Data Syarikat"}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* B. Language */}
        {activeSubpage === "language" && (
          <div className="space-y-6">
            {renderSubpageHeader(
              t.settings.categories?.systemPreferences,
              t.settings.items?.displayLanguage,
              t.settings.items?.displayLanguageDesc
            )}
            <div className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => handleLanguageChange("en")}
                  className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex items-start justify-between ${
                    currentLang === "en"
                      ? "bg-blue-50/70 dark:bg-sky-950/40 border-[#0b3c7a] dark:border-sky-500 shadow-sm"
                      : "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300"
                  }`}
                >
                  <div>
                    <span className="font-bold text-sm text-slate-900 dark:text-white block">
                      {t.settings.englishOption}
                    </span>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {currentLang === "en"
                        ? "Standard professional costing terminology and financial metrics."
                        : "Paparan rasmi bahasa Inggeris untuk pengekosan dan laporan kewangan."}
                    </p>
                  </div>
                  {currentLang === "en" && <Check className="w-5 h-5 text-[#0b3c7a] dark:text-sky-400 shrink-0" />}
                </button>

                <button
                  type="button"
                  onClick={() => handleLanguageChange("ms")}
                  className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex items-start justify-between ${
                    currentLang === "ms"
                      ? "bg-blue-50/70 dark:bg-sky-950/40 border-[#0b3c7a] dark:border-sky-500 shadow-sm"
                      : "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300"
                  }`}
                >
                  <div>
                    <span className="font-bold text-sm text-slate-900 dark:text-white block">
                      {t.settings.malayOption}
                    </span>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {currentLang === "en"
                        ? "Official Bahasa Melayu interface tailored for Malaysian enterprises."
                        : "Bahasa rasmi yang jelas dan mesra usahawan di Malaysia."}
                    </p>
                  </div>
                  {currentLang === "ms" && <Check className="w-5 h-5 text-[#0b3c7a] dark:text-sky-400 shrink-0" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {t.settings.languageApplyNotice}
              </p>
            </div>
          </div>
        )}

        {/* Theme */}
        {activeSubpage === "theme" && (
          <div className="space-y-6">
            {renderSubpageHeader(
              t.settings.categories?.systemPreferences || "KEUTAMAAN SISTEM",
              t.settings.items?.appearanceTheme || "Rupa & Tema",
              t.settings.items?.appearanceThemeDesc || "Pilih mod visual Cerah (Terang) atau Gelap (Navy)"
            )}
            <div className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => handleThemeChange("light")}
                  className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex items-start justify-between ${
                    currentTheme === "light"
                      ? "bg-blue-50/70 border-[#0b3c7a] shadow-sm"
                      : "bg-slate-50 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                      <Sun className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="font-bold text-sm text-slate-900 block">
                        {t.settings.brightMode}
                      </span>
                      <p className="text-xs text-slate-500 mt-1">
                        {t.settings.brightModeDesc}
                      </p>
                    </div>
                  </div>
                  {currentTheme === "light" && <Check className="w-5 h-5 text-[#0b3c7a] shrink-0" />}
                </button>

                <button
                  type="button"
                  onClick={() => handleThemeChange("dark")}
                  className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex items-start justify-between ${
                    currentTheme === "dark"
                      ? "bg-slate-900 border-sky-500 shadow-sm text-white"
                      : "bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-200"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-sky-950 flex items-center justify-center text-sky-400 shrink-0">
                      <Moon className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="font-bold text-sm text-white block">
                        {t.settings.darkMode}
                      </span>
                      <p className="text-xs text-slate-400 mt-1">
                        {t.settings.darkModeDesc}
                      </p>
                    </div>
                  </div>
                  {currentTheme === "dark" && <Check className="w-5 h-5 text-sky-400 shrink-0" />}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Currency Settings */}
        {activeSubpage === "currency" && (
          <div className="space-y-6">
            {renderSubpageHeader(
              t.settings.categories?.systemPreferences || "KEUTAMAAN SISTEM",
              t.settings.items?.currencySettings || "Tetapan Mata Wang",
              t.settings.items?.currencySettingsDesc || "Kod mata wang utama, simbol dan format titik perpuluhan"
            )}
            <form onSubmit={handleSaveConfig} className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xs">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {t.settings.currencySymbol}
                </label>
                <input
                  type="text"
                  value={localConfig.currency}
                  onChange={(e) => setLocalConfig({ ...localConfig, currency: e.target.value })}
                  onKeyDown={handleInputEnterKey}
                  disabled={!roleDef.canEditSettings}
                  className="w-full max-w-xs px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white"
                  placeholder="RM"
                  required
                />
              </div>

              <div className="space-y-1.5 pt-2">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 block">
                  {currentLang === "en" ? "Regional Quick Currency Presets:" : "Pilihan Pantas Mata Wang Serantau:"}
                </span>
                <div className="flex flex-wrap gap-2">
                  {[
                    { code: "RM", label: currentLang === "en" ? "RM (Malaysian Ringgit)" : "RM (Ringgit Malaysia)" },
                    { code: "SGD", label: currentLang === "en" ? "SGD (Singapore Dollar)" : "SGD (Dolar Singapura)" },
                    { code: "USD", label: "USD ($)" },
                    { code: "EUR", label: "EUR (€)" },
                    { code: "GBP", label: "GBP (£)" },
                    { code: "IDR", label: "IDR (Rp)" },
                  ].map((curr) => (
                    <button
                      key={curr.code}
                      type="button"
                      disabled={!roleDef.canEditSettings}
                      onClick={() => setLocalConfig({ ...localConfig, currency: curr.code })}
                      className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer ${
                        localConfig.currency === curr.code
                          ? "bg-emerald-600 text-white shadow-xs"
                          : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200"
                      }`}
                    >
                      {curr.label}
                    </button>
                  ))}
                </div>
              </div>

              {saveSuccess && (
                <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>{t.settings.saveSuccess}</span>
                </div>
              )}

              {roleDef.canEditSettings && (
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-[#0b3c7a] hover:bg-[#093163] text-white font-semibold text-xs rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>{t.settings.saveButton}</span>
                  </button>
                </div>
              )}
            </form>
          </div>
        )}

        {/* Measurement Units */}
        {activeSubpage === "units" && (
          <div className="space-y-6">
            {renderSubpageHeader(
              t.settings.categories?.systemPreferences || "KEUTAMAAN SISTEM",
              t.settings.items?.measurementUnits || "Unit Ukuran",
              t.settings.items?.measurementUnitsDesc || "Unit produk dan bahan mentah (kg, gram, keping, botol, dll.)"
            )}
            <div className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 font-mono uppercase border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="p-2.5">{currentLang === "en" ? "Category" : "Kategori"}</th>
                      <th className="p-2.5">{currentLang === "en" ? "Unit Symbol" : "Simbol Unit"}</th>
                      <th className="p-2.5">{currentLang === "en" ? "Full Name" : "Nama Penuh"}</th>
                      <th className="p-2.5">{currentLang === "en" ? "Base Factor" : "Faktor Asas"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                    {Object.entries(UNIT_DEFINITIONS).slice(0, 15).map(([symbol, u]) => {
                      const catLabel =
                        currentLang === "en"
                          ? u.category
                          : u.category === "mass"
                            ? "jisim"
                            : u.category === "volume"
                              ? "isipadu"
                              : u.category === "length"
                                ? "panjang"
                                : "kiraan";
                      return (
                      <tr key={symbol} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/50">
                        <td className="p-2.5 font-sans font-bold capitalize text-slate-800 dark:text-slate-200">
                          {catLabel}
                        </td>
                        <td className="p-2.5 font-bold text-sky-600 dark:text-sky-400">
                          {u.canonical || symbol}
                        </td>
                        <td className="p-2.5 text-slate-600 dark:text-slate-400 capitalize">
                          {u.aliases?.[1] || u.aliases?.[0] || symbol}
                        </td>
                        <td className="p-2.5 text-slate-500">
                          {u.factorToBase} {u.category === "mass" ? "gram" : u.category === "volume" ? "ml" : u.category === "length" ? "mm" : (currentLang === "en" ? "units" : "unit")}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Date & Number Format */}
        {activeSubpage === "format" && (
          <div className="space-y-6">
            {renderSubpageHeader(
              t.settings.categories?.systemPreferences || "KEUTAMAAN SISTEM",
              t.settings.items?.dateNumberFormat || "Format Tarikh & Nombor",
              t.settings.items?.dateNumberFormatDesc || "Format tarikh DD/MM/YYYY dan pemisah digit ribuan"
            )}
            <div className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xs text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 space-y-1">
                  <span className="text-slate-400 font-semibold block">
                    {currentLang === "en" ? "Standard Date Format" : "Format Tarikh Piawai"}
                  </span>
                  <span className="font-bold text-slate-900 dark:text-white text-sm block">DD/MM/YYYY</span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {currentLang === "en"
                      ? "Example: 31/12/2025 (International Business Standard)"
                      : "Contoh: 31/12/2025 (Piawaian Malaysia & Komanwel)"}
                  </p>
                </div>
                <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 space-y-1">
                  <span className="text-slate-400 font-semibold block">
                    {currentLang === "en" ? "Decimal Precision Format" : "Format Titik Perpuluhan"}
                  </span>
                  <span className="font-bold text-slate-900 dark:text-white text-sm block">
                    {currentLang === "en" ? "2 Decimal Places (0.00)" : "2 Tempat Perpuluhan (0.00)"}
                  </span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {currentLang === "en"
                      ? `Example: ${localConfig.currency || "RM"} 1,250.50 with comma thousands separator`
                      : `Contoh: ${localConfig.currency || "RM"} 1,250.50 dengan pemisah koma ribuan`}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* C. Standard Cost Settings */}
        {activeSubpage === "std-cost" && (
          <div className="space-y-6">
            {renderSubpageHeader(
              t.settings.categories?.costingConfig || "KONFIGURASI PENGEKOSAN",
              t.settings.items?.standardCostSettings || "Tetapan Kos Piawai",
              t.settings.items?.standardCostSettingsDesc || "Asas kiraan bahan mentah langsung, upah langsung dan overhed"
            )}
            <form onSubmit={handleSaveConfig} className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-5 shadow-xs">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {t.settings.stdSellingPrice} ({localConfig.currency || "RM"})
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={localConfig.hargaJualanStandard}
                    onChange={(e) => setLocalConfig({ ...localConfig, hargaJualanStandard: parseFloat(e.target.value) || 0 })}
                    onKeyDown={handleInputEnterKey}
                    disabled={!roleDef.canEditSettings}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {currentLang === "en" ? "Standard Production Batch Target" : "Sasaran Kuantiti Pengeluaran Piawai (Kelompok)"}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={localConfig.kuantitiPengeluaranPiawai || 20}
                    onChange={(e) => setLocalConfig({ ...localConfig, kuantitiPengeluaranPiawai: Math.max(1, parseFloat(e.target.value) || 1) })}
                    onKeyDown={handleInputEnterKey}
                    disabled={!roleDef.canEditSettings}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {currentLang === "en" ? "Production Output Unit" : "Unit Pengeluaran Dapur / Kilang"}
                  </label>
                  <input
                    type="text"
                    value={localConfig.unitPengeluaran || (currentLang === "en" ? "units" : "unit")}
                    onChange={(e) => setLocalConfig({ ...localConfig, unitPengeluaran: e.target.value })}
                    onKeyDown={handleInputEnterKey}
                    disabled={!roleDef.canEditSettings}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {saveSuccess && (
                <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>{t.settings.saveSuccess}</span>
                </div>
              )}

              {roleDef.canEditSettings && (
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-[#0b3c7a] hover:bg-[#093163] text-white font-semibold text-xs rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>{t.settings.saveButton}</span>
                  </button>
                </div>
              )}
            </form>
          </div>
        )}

        {/* Actual Cost Settings */}
        {activeSubpage === "act-cost" && (
          <div className="space-y-6">
            {renderSubpageHeader(
              t.settings.categories?.costingConfig || "KONFIGURASI PENGEKOSAN",
              t.settings.items?.actualCostSettings || "Tetapan Kos Sebenar",
              t.settings.items?.actualCostSettingsDesc || "Pantau kos sebenar mingguan dan analisa perbezaan varians"
            )}
            <form onSubmit={handleSaveConfig} className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-5 shadow-xs">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {t.settings.actSellingPrice} ({localConfig.currency || "RM"})
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={localConfig.hargaJualanSebenar}
                    onChange={(e) => setLocalConfig({ ...localConfig, hargaJualanSebenar: parseFloat(e.target.value) || 0 })}
                    onKeyDown={handleInputEnterKey}
                    disabled={!roleDef.canEditSettings}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {t.settings.actQtySold}
                  </label>
                  <input
                    type="number"
                    value={localConfig.kuantitiSebenarDijual}
                    onChange={(e) => setLocalConfig({ ...localConfig, kuantitiSebenarDijual: parseInt(e.target.value) || 0 })}
                    onKeyDown={handleInputEnterKey}
                    disabled={!roleDef.canEditSettings}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {currentLang === "en" ? "Actual Production Batch Quantity" : "Kuantiti Pengeluaran Sebenar (Kelompok)"}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={localConfig.kuantitiPengeluaranSebenar || localConfig.kuantitiPengeluaranPiawai || 20}
                    onChange={(e) => setLocalConfig({ ...localConfig, kuantitiPengeluaranSebenar: Math.max(1, parseFloat(e.target.value) || 1) })}
                    onKeyDown={handleInputEnterKey}
                    disabled={!roleDef.canEditSettings}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {saveSuccess && (
                <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>{t.settings.saveSuccess}</span>
                </div>
              )}

              {roleDef.canEditSettings && (
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-[#0b3c7a] hover:bg-[#093163] text-white font-semibold text-xs rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>{t.settings.saveButton}</span>
                  </button>
                </div>
              )}
            </form>
          </div>
        )}

        {/* Products / Menu Management */}
        {activeSubpage === "products" && (
          <div className="space-y-6">
            {renderSubpageHeader(
              t.settings.categories?.costingConfig || "KONFIGURASI PENGEKOSAN",
              t.settings.items?.productionUnits || "Unit Pengeluaran & Produk",
              t.settings.items?.productionUnitsDesc || "Urus senarai menu & produk perniagaan anda"
            )}
            <div className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-5 shadow-xs">
              {roleDef.canEditSettings && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newMenuName.trim()) {
                      onAddProduct(newMenuName.trim());
                      setNewMenuName("");
                    }
                  }}
                  className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900 p-2 rounded-xl border border-slate-200 dark:border-slate-800"
                >
                  <input
                    type="text"
                    value={newMenuName}
                    onChange={(e) => setNewMenuName(e.target.value)}
                    placeholder={t.settings.addNewMenuPlaceholder}
                    className="flex-1 px-3.5 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-900 dark:text-white"
                    required
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-[#0b3c7a] hover:bg-[#093163] text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t.settings.addNewMenuButton}</span>
                  </button>
                </form>
              )}

              <div className="space-y-2 pt-2">
                <span className="text-xs font-mono font-bold uppercase text-slate-400 block tracking-wider">
                  {t.settings.currentMenuList}
                </span>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden">
                  {templates.map((tpl) => {
                    const isActive = tpl.id === activeProductId;
                    return (
                      <div
                        key={tpl.id}
                        className={`flex items-center justify-between p-3.5 transition-all ${
                          isActive
                            ? "bg-blue-50/50 dark:bg-sky-950/30"
                            : "bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${
                            isActive
                              ? "bg-blue-100 border-blue-200 text-[#0b3c7a] dark:bg-sky-900 dark:border-sky-800 dark:text-sky-300"
                              : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500"
                          }`}>
                            <Soup className="w-4 h-4" />
                          </div>
                          <div>
                            <span className="font-bold text-xs text-slate-800 dark:text-slate-100 block">
                              {tpl.namaProduk}
                            </span>
                            <span className="text-[10px] text-slate-400 block">
                              {tpl.namaSyarikat} {isActive && <span className="text-emerald-600 dark:text-emerald-400 font-bold ml-1">{t.settings.currentlyActive}</span>}
                            </span>
                          </div>
                        </div>

                        {roleDef.canEditSettings && (
                          <button
                            type="button"
                            onClick={() => setMenuPendingDelete(tpl)}
                            className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{t.common.delete}</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Costing Preferences */}
        {activeSubpage === "costing-pref" && (
          <div className="space-y-6">
            {renderSubpageHeader(
              t.settings.categories?.costingConfig || "KONFIGURASI PENGEKOSAN",
              t.settings.items?.costingPreferences || "Keutamaan Pengekosan",
              t.settings.items?.costingPreferencesDesc || "Sasaran margin untung kasar, formula TPM dan amaran kos"
            )}
            <div className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xs text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 space-y-1">
                  <span className="text-slate-400 font-semibold block">
                    {t.settings.costingTargetMarginLabel}
                  </span>
                  <span className="font-bold text-slate-900 dark:text-white text-base block">40.0%</span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {currentLang === "en"
                      ? "Recommended industry benchmark for F&B and small-scale manufacturing."
                      : "Cadangan piawai industri F&B dan perkilangan kecil."}
                  </p>
                </div>
                <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 space-y-1">
                  <span className="text-slate-400 font-semibold block">
                    {t.settings.costingBepMethodLabel}
                  </span>
                  <span className="font-bold text-slate-900 dark:text-white text-base block">
                    {currentLang === "en" ? "Fixed Costs ÷ Contribution Margin" : "Kos Tetap ÷ Margin Caruman"}
                  </span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {currentLang === "en"
                      ? "Computes the minimum sales volume needed to reach break-even."
                      : "Mengira jumlah unit minimum untuk pulang modal."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* D. Change Password / Auth */}
        {(activeSubpage === "password" || activeSubpage === "auth") && (
          <div className="space-y-6">
            {renderSubpageHeader(
              t.settings.categories?.securityPrivacy || "KESELAMATAN & PRIVASI",
              t.settings.items?.changePassword || "Tukar Kata Laluan & Kredensial",
              t.settings.items?.changePasswordDesc || "Kemas kini kata laluan keselamatan akaun pentadbir atau pengguna"
            )}
            <form onSubmit={handleSaveCredentials} className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xs">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {currentLang === "en" ? "Current Password" : "Kata Laluan Semasa"}
                  </label>
                  <div className="relative">
                    <input
                      type={!isDeveloperActor && showCurrentPassword ? "text" : "password"}
                      value={currentPasswordInput}
                      onChange={(e) => {
                        setCurrentPasswordInput(e.target.value);
                        if (saveError) setSaveError(null);
                        if (credentialSuccessMsg) setCredentialSuccessMsg(null);
                      }}
                      onCopy={isDeveloperActor ? (e) => e.preventDefault() : undefined}
                      onCut={isDeveloperActor ? (e) => e.preventDefault() : undefined}
                      onKeyDown={handleInputEnterKey}
                      disabled={!roleDef.canEditSettings}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className={`w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white ${!isDeveloperActor ? "pr-10" : ""}`}
                    />
                    {!isDeveloperActor && (
                      <button
                        type="button"
                        onClick={() => setShowCurrentPassword((v) => !v)}
                        disabled={!roleDef.canEditSettings}
                        aria-label={
                          currentLang === "en"
                            ? (showCurrentPassword ? "Hide current password" : "Show current password")
                            : (showCurrentPassword ? "Sembunyikan kata laluan semasa" : "Lihat kata laluan semasa")
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer disabled:opacity-40"
                      >
                        {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {t.settings.newUsername}
                  </label>
                  <input
                    type="text"
                    value={localConfig.usernameLogMasuk}
                    onChange={(e) => {
                      setLocalConfig({ ...localConfig, usernameLogMasuk: e.target.value });
                      if (saveError) setSaveError(null);
                      if (credentialSuccessMsg) setCredentialSuccessMsg(null);
                    }}
                    onKeyDown={handleInputEnterKey}
                    disabled={!roleDef.canEditSettings}
                    autoComplete="username"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {t.settings.newPassword}
                  </label>
                  <div className="relative">
                    <input
                      type={!isDeveloperActor && showNewPassword ? "text" : "password"}
                      value={localConfig.kataLaluanLogMasuk}
                      onChange={(e) => {
                        setLocalConfig({ ...localConfig, kataLaluanLogMasuk: e.target.value });
                        if (saveError) setSaveError(null);
                        if (credentialSuccessMsg) setCredentialSuccessMsg(null);
                      }}
                      onCopy={isDeveloperActor ? (e) => e.preventDefault() : undefined}
                      onCut={isDeveloperActor ? (e) => e.preventDefault() : undefined}
                      onKeyDown={handleInputEnterKey}
                      disabled={!roleDef.canEditSettings}
                      autoComplete="new-password"
                      placeholder="••••••••"
                      className={`w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white ${!isDeveloperActor ? "pr-10" : ""}`}
                    />
                    {!isDeveloperActor && (
                      <button
                        type="button"
                        onClick={() => setShowNewPassword((v) => !v)}
                        disabled={!roleDef.canEditSettings}
                        aria-label={
                          currentLang === "en"
                            ? (showNewPassword ? "Hide new password" : "Show new password")
                            : (showNewPassword ? "Sembunyikan kata laluan baharu" : "Lihat kata laluan baharu")
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer disabled:opacity-40"
                      >
                        {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {currentLang === "en"
                  ? "Passwords cannot be viewed by anyone, including system developers. You can only change it by entering your current password."
                  : "Kata laluan tidak boleh dilihat oleh sesiapa, termasuk pembangun sistem. Anda hanya boleh menukarnya dengan memasukkan kata laluan semasa."}
              </p>

              {saveError && (
                <div className="p-3 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{saveError}</span>
                </div>
              )}

              {credentialSuccessMsg && (
                <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{credentialSuccessMsg}</span>
                </div>
              )}

              {roleDef.canEditSettings && (
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                  <button
                    type="submit"
                    disabled={isSavingCredentials}
                    className="px-5 py-2.5 bg-[#0b3c7a] hover:bg-[#093163] text-white font-semibold text-xs rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    <Save className="w-4 h-4" />
                    <span>{t.settings.saveButton}</span>
                  </button>
                </div>
              )}
            </form>

            {(userRole === "admin" || userRole === "developer") && twoFaSupported && (
              <div className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-[#0b3c7a] dark:text-sky-400" />
                      <span>
                        {currentLang === "en"
                          ? "Two-Factor Authentication (Optional 2FA)"
                          : "Pengesahan Dua Faktor (2FA Pilihan)"}
                      </span>
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {currentLang === "en"
                        ? "Protect your Admin or Developer account with a 6-digit TOTP Authenticator app."
                        : "Lindungi akaun Pentadbir atau Pembangun anda dengan kod 6-digit aplikasi Authenticator (TOTP)."}
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold w-fit ${
                      twoFaEnabled
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    }`}
                  >
                    {twoFaEnabled
                      ? (currentLang === "en" ? "Enabled" : "Aktif")
                      : (currentLang === "en" ? "Not Enabled" : "Tidak Aktif")}
                  </span>
                </div>

                {twoFaMsg && (
                  <div
                    className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                      twoFaMsg.type === "ok"
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                        : "bg-rose-50 text-rose-800 border-rose-200"
                    }`}
                  >
                    {twoFaMsg.type === "ok" ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    )}
                    <span>{twoFaMsg.text}</span>
                  </div>
                )}

                {!twoFaEnabled && !twoFaPendingSecret && (
                  <button
                    type="button"
                    disabled={twoFaBusy}
                    onClick={handleStart2FASetup}
                    className="px-4 py-2 bg-[#0b3c7a] hover:bg-[#093163] text-white text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-60"
                  >
                    {currentLang === "en" ? "Set Up Authenticator 2FA" : "Sediakan 2FA Authenticator"}
                  </button>
                )}

                {!twoFaEnabled && twoFaPendingSecret && (
                  <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                    <div className="text-xs text-slate-700 dark:text-slate-300 space-y-1">
                      <p className="font-semibold">
                        {currentLang === "en"
                          ? "1. Add this secret key into Google Authenticator / Authy (Time-based TOTP):"
                          : "1. Masukkan kunci rahsia ini ke dalam aplikasi Google Authenticator / Authy (TOTP):"}
                      </p>
                      <div className="p-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg font-mono text-xs font-bold tracking-wider select-all text-[#0b3c7a] dark:text-sky-300">
                        {twoFaPendingSecret}
                      </div>
                      {twoFaOtpUri && (
                        <p className="text-[10px] text-slate-400 break-all font-mono">{twoFaOtpUri}</p>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={twoFaCodeInput}
                        onChange={(e) => setTwoFaCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder={currentLang === "en" ? "Enter 6-digit code" : "Kod 6-digit"}
                        className="px-3.5 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-bold tracking-widest text-slate-900 dark:text-white"
                      />
                      <button
                        type="button"
                        disabled={twoFaBusy || twoFaCodeInput.trim().length !== 6}
                        onClick={handleConfirmEnable2FA}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl cursor-pointer disabled:opacity-60"
                      >
                        {currentLang === "en" ? "Verify & Enable 2FA" : "Sahkan & Aktifkan 2FA"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTwoFaPendingSecret(null);
                          setTwoFaOtpUri(null);
                          setTwoFaCodeInput("");
                        }}
                        className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
                      >
                        {currentLang === "en" ? "Cancel" : "Batal"}
                      </button>
                    </div>
                  </div>
                )}

                {twoFaEnabled && (
                  <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      {currentLang === "en"
                        ? "To disable 2FA, enter your current password or current 6-digit Authenticator code."
                        : "Untuk menyahaktifkan 2FA, masukkan kata laluan semasa atau kod 6-digit Authenticator."}
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="password"
                        value={twoFaDisablePassword}
                        onChange={(e) => setTwoFaDisablePassword(e.target.value)}
                        placeholder={currentLang === "en" ? "Current password" : "Kata laluan semasa"}
                        className="px-3.5 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={twoFaCodeInput}
                        onChange={(e) => setTwoFaCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder={currentLang === "en" ? "or 6-digit code" : "atau kod 6-digit"}
                        className="px-3.5 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                      />
                      <button
                        type="button"
                        disabled={twoFaBusy || (!twoFaDisablePassword && twoFaCodeInput.trim().length !== 6)}
                        onClick={handleDisable2FA}
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl cursor-pointer disabled:opacity-60"
                      >
                        {currentLang === "en" ? "Disable 2FA" : "Nyahaktifkan 2FA"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Account Security (RBAC) */}
        {activeSubpage === "account-security" && (
          <div className="space-y-6">
            {renderSubpageHeader(
              t.settings.categories?.securityPrivacy || "KESELAMATAN & PRIVASI",
              t.settings.items?.accountSecurity || "Keselamatan Akaun (Matriks RBAC)",
              t.settings.items?.accountSecurityDesc || "Kebenaran capaian mengikut peranan, had kuasa dan rekod audit"
            )}
            <div className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xs">
              <div className="p-4 bg-sky-50 dark:bg-sky-950/40 rounded-xl border border-sky-100 dark:border-sky-800 flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-sky-950 dark:text-sky-200">
                    {currentLang === "en" ? "Role-Based Access Control (RBAC)" : "Kawalan Capaian Berasaskan Peranan (RBAC)"}
                  </h4>
                  <p className="text-xs text-sky-700 dark:text-sky-400 mt-0.5">
                    {currentLang === "en"
                      ? "Ensures clerks, managers, supervisors, and auditors only access authorized modules."
                      : "Memastikan kerani, pengurus, penyelia dan juruaudit hanya mengakses modul yang dibenarkan."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onOpenAccessMatrixModal}
                  className="px-4 py-2 bg-[#0b3c7a] hover:bg-[#093163] text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5 shrink-0"
                >
                  <Lock className="w-4 h-4" />
                  <span>{currentLang === "en" ? "Open RBAC Matrix" : "Buka Matriks RBAC"}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Session Management */}
        {activeSubpage === "session" && (
          <div className="space-y-6">
            {renderSubpageHeader(
              t.settings.categories?.securityPrivacy || "KESELAMATAN & PRIVASI",
              t.settings.items?.sessionManagement || "Pengurusan Sesi",
              t.settings.items?.sessionManagementDesc || "Pantau peranti yang log masuk, tempoh tamat sesi dan keselamatan"
            )}
            <div className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xs text-xs">
              <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {currentLang === "en" ? "Current Browser Session" : "Sesi Pelayar Web Semasa"}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    {currentLang === "en" ? "Active Now" : "Aktif Sekarang"}
                  </span>
                </div>
                <p className="text-slate-500">
                  {currentLang === "en" ? "Signed in as:" : "Log masuk sebagai:"}{" "}
                  <strong className="text-slate-700 dark:text-slate-300">{currentUser?.username || "admin"}</strong> ({roleDef.title})
                </p>
              </div>
              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={onLogout}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  <span>{t.nav.logout}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* E. Database Info */}
        {activeSubpage === "database-info" && (
          <div className="space-y-6">
            {renderSubpageHeader(
              t.settings.categories?.dataManagement || "PENGURUSAN DATA",
              t.settings.items?.databaseInfo || "Maklumat Pangkalan Data",
              t.settings.items?.databaseInfoDesc || "Status pangkalan data syarikat yang diasingkan, jumlah dokumen dan saiz"
            )}
            <div className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800">
                  <span className="text-slate-400 block font-medium">
                    {currentLang === "en" ? "Database Storage Key" : "Kunci Storan Pangkalan Data"}
                  </span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200 mt-1 block truncate">
                    {activeLoadedDbKey || "pengekosan_company_db_smartcost"}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800">
                  <span className="text-slate-400 block font-medium">
                    {currentLang === "en" ? "Total Registered Products" : "Jumlah Produk Didaftarkan"}
                  </span>
                  <span className="font-bold text-slate-800 dark:text-slate-200 mt-1 block">
                    {currentLang === "en" ? `${templates.length} products` : `${templates.length} produk`}
                  </span>
                </div>
              </div>
              {isAuthorizedDeveloper && onOpenDatabaseModal && (
                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={onOpenDatabaseModal}
                    className="px-4 py-2 bg-[#0b3c7a] hover:bg-[#093163] text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-2"
                  >
                    <Database className="w-4 h-4 text-sky-400" />
                    <span>{currentLang === "en" ? "Manage Company Database" : "Urus Pangkalan Data Syarikat"}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Backup & Restore / Import / Export */}
        {(activeSubpage === "backup" || activeSubpage === "import" || activeSubpage === "export") && (
          <div className="space-y-6">
            {renderSubpageHeader(
              t.settings.categories?.dataManagement || "PENGURUSAN DATA",
              t.settings.items?.backupRestore || "Sandaran & Pemulihan Data",
              t.settings.items?.backupRestoreDesc || "Cipta fail sandaran JSON dan pulihkan rekod perniagaan anda"
            )}
            <div className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xs">
              <div className="p-4 bg-sky-50 dark:bg-sky-950/40 rounded-xl border border-sky-100 dark:border-sky-800 space-y-2">
                <h4 className="font-bold text-sm text-sky-950 dark:text-sky-200">
                  {currentLang === "en" ? "Export Database Backup (JSON)" : "Eksport Sandaran Pangkalan Data (JSON)"}
                </h4>
                <p className="text-xs text-sky-700 dark:text-sky-400">
                  {currentLang === "en"
                    ? "Download a JSON backup file containing all costing records, product templates, materials, and company settings."
                    : "Muat turun fail sandaran mengandungi semua rekod kos, templat produk, bahan mentah dan tetapan syarikat."}
                </p>
                <div className="pt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const safeConfig = sanitizeConfigForBackup(localConfig);
                      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
                        version: "2.0",
                        companyName: localConfig.namaSyarikat,
                        exportedAt: new Date().toISOString(),
                        templates: templates.map((tpl) =>
                          tpl?.konfigurasi
                            ? { ...tpl, konfigurasi: sanitizeConfigForBackup(tpl.konfigurasi) }
                            : tpl
                        ),
                        config: safeConfig,
                      }, null, 2));
                      const downloadAnchor = document.createElement("a");
                      downloadAnchor.setAttribute("href", dataStr);
                      downloadAnchor.setAttribute("download", `smartcost_backup_${(localConfig.namaSyarikat || "smartcost").toLowerCase().replace(/[^a-z0-9]/g, "_")}_${new Date().toISOString().slice(0, 10)}.json`);
                      document.body.appendChild(downloadAnchor);
                      downloadAnchor.click();
                      downloadAnchor.remove();
                    }}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
                  >
                    <Download className="w-4 h-4" />
                    <span>{currentLang === "en" ? "Download Backup (JSON)" : "Muat Turun Sandaran (JSON)"}</span>
                  </button>
                  {isAuthorizedDeveloper && onOpenDatabaseModal && (
                    <button
                      type="button"
                      onClick={onOpenDatabaseModal}
                      className="px-4 py-2 bg-[#0b3c7a] hover:bg-[#093163] text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
                    >
                      <Database className="w-4 h-4 text-sky-400" />
                      <span>{currentLang === "en" ? "Manage Archives & Backups" : "Urus Arkib & Sandaran di Pangkalan Data"}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // MAIN SETTINGS CATEGORIZED LIST VIEW WITH TOP-PRIORITY BUSINESS PROFILE
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fadeIn pb-16">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Settings className="w-6 h-6 text-[#0b3c7a] dark:text-sky-400" />
            <span>{t.settings.title}</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t.settings.description}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleLanguageChange(currentLang === "en" ? "ms" : "en")}
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition-all shadow-2xs hover:bg-slate-50 cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5 text-[#0b3c7a] dark:text-sky-400" />
            <span>{currentLang === "en" ? t.settings.malayOption : t.settings.englishOption}</span>
          </button>
          <button
            type="button"
            onClick={() => handleThemeChange(currentTheme === "dark" ? "light" : "dark")}
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition-all shadow-2xs hover:bg-slate-50 cursor-pointer"
          >
            {currentTheme === "dark" ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-slate-600" />}
            <span>{currentTheme === "dark" ? t.settings.lightLabel : t.settings.darkLabel}</span>
          </button>
        </div>
      </div>

      {/* =========================================================================
          1. TOP-PRIORITY BUSINESS PROFILE CARD (IMMEDIATELY VISIBLE AT VERY TOP)
          Refined with dedicated dark-blue palette:
          - Background: solid #061830 (flat, no gradient)
          - Border: 1px solid #0B3C7A
          - Title: #FFFFFF
          - Description: #C7D4E8
          - Meta info: #9FB3CF
          - Top Priority Badge: Translucent orange with #FCD34D
          - SSM Badge: White #FFFFFF with dark text #1E293B
          - Building Icon Container: White #FFFFFF
          - Action Button: #0B3C7A with 1px border rgba(255, 255, 255, 0.2)
          ========================================================================= */}
      <div 
        onClick={() => setActiveSubpage("business-profile")}
        style={{
          backgroundColor: "#061830",
          border: "1px solid #0B3C7A",
        }}
        className="rounded-2xl p-4 sm:p-5 shadow-md transition-all hover:border-[#1d5aa6] cursor-pointer group"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            {/* Logo Preview or Icon - White container */}
            <div className="w-13 h-13 rounded-xl bg-white border border-slate-200 p-1 flex items-center justify-center shrink-0 shadow-2xs overflow-hidden">
              {businessForm.logoUrl ? (
                <img
                  src={businessForm.logoUrl}
                  alt={businessForm.companyName}
                  className="w-full h-full object-contain"
                />
              ) : (
                <Building className="w-6 h-6 text-[#0b3c7a]" />
              )}
            </div>

            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span 
                  style={{ color: "#FFFFFF" }}
                  className="font-bold text-sm sm:text-base tracking-tight truncate"
                >
                  {businessForm.companyName || "SCHOOL ENTERPRISE"}
                </span>
                <span 
                  style={{ 
                    backgroundColor: "rgba(217, 119, 6, 0.2)",
                    color: "#FCD34D",
                    borderColor: "rgba(217, 119, 6, 0.35)",
                  }}
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold border"
                >
                  {currentLang === "en" ? "Top Priority" : "Keutamaan Utama"}
                </span>
                {businessForm.businessRegNo && (
                  <span 
                    style={{ 
                      backgroundColor: "#FFFFFF",
                      color: "#1E293B",
                    }}
                    className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border border-slate-300 shadow-2xs"
                  >
                    SSM: {businessForm.businessRegNo}
                  </span>
                )}
              </div>

              <p 
                style={{ color: "#C7D4E8" }}
                className="text-xs leading-relaxed"
              >
                {currentLang === "en"
                  ? "Click to directly edit official company details, logo, premises address, and bank account."
                  : "Klik untuk melengkapkan maklumat rasmi perniagaan, logo, alamat premis dan akaun bank."}
              </p>

              <div 
                style={{ color: "#9FB3CF" }}
                className="flex items-center gap-3 text-[11px] pt-0.5 flex-wrap font-medium"
              >
                {businessForm.city && <span>📍 {businessForm.city}, {businessForm.state}</span>}
                {businessForm.phone1 && <span>📞 {businessForm.phone1}</span>}
                {businessForm.email && <span>✉️ {businessForm.email}</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
            <button
              type="button"
              style={{
                backgroundColor: "#0B3C7A",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                color: "#FFFFFF",
              }}
              className="px-3.5 py-2 hover:brightness-110 text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5 group-hover:shadow-md cursor-pointer"
            >
              <Building className="w-3.5 h-3.5 text-sky-200" />
              <span>{currentLang === "en" ? "Fill Business Info" : "Isi Maklumat Perniagaan"}</span>
              <ChevronRight className="w-3.5 h-3.5 text-sky-200 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        </div>
      </div>

      {/* CATEGORY A: AKAUN & PROFIL / ACCOUNT & PROFILE */}
      <div className="space-y-1.5">
        <h3 className="text-xs font-mono font-bold tracking-wider uppercase text-slate-500 dark:text-slate-400 px-3">
          {t.settings.categories?.accountProfile || "AKAUN & PROFIL"}
        </h3>
        <div className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs divide-y divide-slate-100 dark:divide-slate-800/80">
          {/* 1. Profil Perniagaan (Opens Direct Business Information Form) */}
          <button
            type="button"
            onClick={() => setActiveSubpage("business-profile")}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group bg-blue-50/20 dark:bg-sky-950/10 border-l-4 border-l-[#0b3c7a] dark:border-l-sky-500"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-sky-950/80 border border-blue-200 dark:border-sky-700/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <Building className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                    {t.settings.items?.businessProfile || "Profil Perniagaan"}
                  </span>
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-sky-100 text-[#0b3c7a] dark:bg-sky-900/60 dark:text-sky-300 uppercase">
                    {currentLang === "en" ? "Direct Form" : "Borang Terus"}
                  </span>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {businessForm.companyName} • {businessForm.businessRegNo || "SSM"} • {businessForm.city || (currentLang === "en" ? "Premises Address" : "Alamat Premis")}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* 2. Persediaan Umum */}
          <button
            type="button"
            onClick={() => {
              setActiveSubpage("general-setup");
              const mainEl = document.querySelector("main");
              if (mainEl) mainEl.scrollTo({ top: 0, behavior: "auto" });
            }}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <Landmark className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.generalSetup || "Persediaan Umum"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {t.settings.items?.generalSetupDesc || "Tempoh perakaunan, SST / GST dan tetapan cukai"}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* 3. Maklumat Syarikat */}
          <button
            type="button"
            onClick={() => setActiveSubpage("company-info")}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <Building2 className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.companyInfo || "Maklumat Syarikat"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {t.settings.items?.companyInfoDesc || "Alamat premis, nombor pendaftaran dan maklumat perhubungan"}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* 4. Profil Pengguna */}
          <button
            type="button"
            onClick={() => setActiveSubpage("user-profile")}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <User className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.userProfile || "Profil Pengguna"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {currentUser?.username || "admin"} ({userRole.toUpperCase()})
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* 5. Maklumat Akaun */}
          <button
            type="button"
            onClick={() => setActiveSubpage("account-info")}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <Info className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.accountInfo || "Maklumat Akaun"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {t.settings.items?.accountInfoDesc || "Status akaun, ruang kerja organisasi dan pangkalan data khusus"}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>
        </div>
      </div>

      {/* CATEGORY B: KEUTAMAAN SISTEM / SYSTEM PREFERENCES */}
      <div className="space-y-1.5">
        <h3 className="text-xs font-mono font-bold tracking-wider uppercase text-slate-500 dark:text-slate-400 px-3">
          {t.settings.categories?.systemPreferences || "KEUTAMAAN SISTEM"}
        </h3>
        <div className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs divide-y divide-slate-100 dark:divide-slate-800/80">
          {/* 1. Bahasa Paparan */}
          <button
            type="button"
            onClick={() => setActiveSubpage("language")}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <Globe className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.displayLanguage || "Bahasa Paparan"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {currentLang === "ms" ? t.settings.malayOption : t.settings.englishOption}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* 2. Rupa & Tema */}
          <button
            type="button"
            onClick={() => setActiveSubpage("theme")}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                {currentTheme === "dark" ? <Moon className="w-4.5 h-4.5" /> : <Sun className="w-4.5 h-4.5" />}
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.appearanceTheme || "Rupa & Tema"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {currentTheme === "dark" ? t.settings.darkOptionDesc : t.settings.lightOptionDesc}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* 3. Tetapan Mata Wang */}
          <button
            type="button"
            onClick={() => setActiveSubpage("currency")}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <Coins className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.currencySettings || "Tetapan Mata Wang"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {currentLang === "en" ? "Active currency:" : "Mata wang semasa:"}{" "}
                  <strong className="font-mono text-emerald-600 dark:text-emerald-400">{localConfig.currency || "RM"}</strong>
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* 4. Unit Ukuran */}
          <button
            type="button"
            onClick={() => setActiveSubpage("units")}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <Scale className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.measurementUnits || "Unit Ukuran"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {t.settings.items?.measurementUnitsDesc}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* 5. Format Tarikh & Nombor */}
          <button
            type="button"
            onClick={() => setActiveSubpage("format")}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <Calendar className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.dateNumberFormat || "Format Tarikh & Nombor"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {currentLang === "en"
                    ? "DD/MM/YYYY • 2 decimal places (0.00)"
                    : "DD/MM/YYYY • Format 2 perpuluhan mata wang (0.00)"}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>
        </div>
      </div>

      {/* CATEGORY C: KONFIGURASI PENGEKOSAN / COSTING CONFIGURATION */}
      <div className="space-y-1.5">
        <h3 className="text-xs font-mono font-bold tracking-wider uppercase text-slate-500 dark:text-slate-400 px-3">
          {t.settings.categories?.costingConfig || "KONFIGURASI PENGEKOSAN"}
        </h3>
        <div className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs divide-y divide-slate-100 dark:divide-slate-800/80">
          {/* 1. Tetapan Kos Piawai */}
          <button
            type="button"
            onClick={() => setActiveSubpage("std-cost")}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <Calculator className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.standardCostSettings || "Tetapan Kos Piawai"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {currentLang === "en" ? "Standard price:" : "Harga piawai:"} {localConfig.currency} {localConfig.hargaJualanStandard?.toFixed(2)} • {t.common.batch}: {localConfig.kuantitiPengeluaranPiawai || 20}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* 2. Tetapan Kos Sebenar */}
          <button
            type="button"
            onClick={() => setActiveSubpage("act-cost")}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <Calculator className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.actualCostSettings || "Tetapan Kos Sebenar"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {currentLang === "en" ? "Actual selling price:" : "Harga jualan sebenar:"} {localConfig.currency} {localConfig.hargaJualanSebenar?.toFixed(2)} • {t.settings.actQtySold}: {localConfig.kuantitiSebenarDijual}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* 3. Unit Pengeluaran & Produk */}
          <button
            type="button"
            onClick={() => setActiveSubpage("products")}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <Soup className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.productionUnits || "Unit Pengeluaran & Produk"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {currentLang === "en"
                    ? `${templates.length} registered products • Manage menus and recipes`
                    : `${templates.length} produk didaftarkan • Urus menu dan resipi`}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* 4. Keutamaan Pengekosan */}
          <button
            type="button"
            onClick={() => setActiveSubpage("costing-pref")}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <Sliders className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.costingPreferences || "Keutamaan Pengekosan"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {t.settings.items?.costingPreferencesDesc || "Sasaran margin untung kasar, formula TPM dan amaran kos"}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>
        </div>
      </div>

      {/* CATEGORY D: KESELAMATAN & PRIVASI / SECURITY & PRIVACY */}
      <div className="space-y-1.5">
        <h3 className="text-xs font-mono font-bold tracking-wider uppercase text-slate-500 dark:text-slate-400 px-3">
          {t.settings.categories?.securityPrivacy || "KESELAMATAN & PRIVASI"}
        </h3>
        <div className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs divide-y divide-slate-100 dark:divide-slate-800/80">
          {/* 1. Tukar Kata Laluan */}
          <button
            type="button"
            onClick={() => setActiveSubpage("password")}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <ShieldCheck className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.changePassword || "Tukar Kata Laluan"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {t.settings.items?.changePasswordDesc || "Kemas kini kata laluan keselamatan akaun pentadbir atau pengguna"}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* 2. Log Masuk & Pengesahan */}
          <button
            type="button"
            onClick={() => setActiveSubpage("auth")}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <Key className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.loginAuth || "Log Masuk & Pengesahan"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {t.settings.items?.loginAuthDesc || "Kawalan sesi log masuk, pengesahan pelbagai peranan dan keselamatan"}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* 3. Keselamatan Akaun (Matriks RBAC) */}
          <button
            type="button"
            onClick={onOpenAccessMatrixModal}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <Lock className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.accountSecurity || "Keselamatan Akaun (Matriks RBAC)"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {t.settings.items?.accountSecurityDesc || "Kebenaran capaian mengikut peranan, had kuasa dan rekod audit"}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* 4. Pengurusan Sesi */}
          <button
            type="button"
            onClick={() => setActiveSubpage("session")}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <Clock className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.sessionManagement || "Pengurusan Sesi"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {t.settings.items?.sessionManagementDesc || "Pantau peranti yang log masuk, tempoh tamat sesi dan keselamatan token"}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* 5. Log Keluar */}
          <button
            type="button"
            onClick={onLogout}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-rose-50/40 dark:hover:bg-rose-950/20 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-100 dark:border-rose-800/60 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
                <LogOut className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-rose-700 dark:text-rose-300 block">
                  {t.settings.items?.signOut || "Log Keluar"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {t.settings.items?.signOutDesc || "Tamatkan sesi perniagaan semasa dengan selamat"}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-rose-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>
        </div>
      </div>

      {/* CATEGORY E: PENGURUSAN DATA / DATA MANAGEMENT */}
      <div className="space-y-1.5">
        <h3 className="text-xs font-mono font-bold tracking-wider uppercase text-slate-500 dark:text-slate-400 px-3">
          {t.settings.categories?.dataManagement || "PENGURUSAN DATA"}
        </h3>
        <div className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs divide-y divide-slate-100 dark:divide-slate-800/80">
          {/* 1. Maklumat Pangkalan Data */}
          <button
            type="button"
            onClick={() => {
              if (isAuthorizedDeveloper && onOpenDatabaseModal) {
                onOpenDatabaseModal();
              } else {
                setActiveSubpage("database-info");
              }
            }}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <Database className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.databaseInfo || "Maklumat Pangkalan Data"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {t.settings.items?.databaseInfoDesc || "Status pangkalan data syarikat yang diasingkan, jumlah dokumen dan saiz"}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* 2. Sandaran & Pemulihan */}
          <button
            type="button"
            onClick={() => setActiveSubpage("backup")}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <Archive className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.backupRestore || "Sandaran & Pemulihan"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {t.settings.items?.backupRestoreDesc || "Cipta sandaran JSON selamat dan pulihkan rekod perniagaan bila-bila masa"}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* 3. Import Data */}
          <button
            type="button"
            onClick={() => setActiveSubpage("import")}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <Upload className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.importData || "Import Data"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {t.settings.items?.importDataDesc || "Muat naik templat kos, resipi produk dan katalog bahan mentah"}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* 4. Eksport Data */}
          <button
            type="button"
            onClick={() => setActiveSubpage("export")}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <Download className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.exportData || "Eksport Data"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {t.settings.items?.exportDataDesc || "Muat turun pangkalan data syarikat lengkap, laporan Excel dan arkib rekod"}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>
        </div>
      </div>

      {/* ABOUT US / TENTANG KAMI */}
      <div className="space-y-1.5">
        <h3 className="text-xs font-mono font-bold tracking-wider uppercase text-slate-500 dark:text-slate-400 px-3">
          {t.settings.categories?.aboutSection || (currentLang === "en" ? "ABOUT & INFORMATION" : "TENTANG & MAKLUMAT")}
        </h3>
        <div className="bg-white dark:bg-[#061830] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs divide-y divide-slate-100 dark:divide-slate-800/80">
          <a
            href="https://smartcostwebsites.smartcost.workers.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-sky-950/60 border border-blue-100 dark:border-sky-800/60 flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 shrink-0">
                <Info className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                  {t.settings.items?.aboutUs || "About Us"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                  {t.settings.items?.aboutUsDesc || "Lawati laman web rasmi SmartCost (smartcostwebsites.smartcost.workers.dev)"}
                </span>
              </div>
            </div>
            <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors shrink-0" />
          </a>
        </div>
      </div>

      {/* CATEGORY F: PEMBANGUN / DEVELOPER SETTINGS (Strictly visible ONLY to authorized Developer accounts) */}
      {isAuthorizedDeveloper && (
        <div className="space-y-1.5 pt-2">
          <div className="flex items-center justify-between px-3">
            <h3 className="text-xs font-mono font-bold tracking-wider uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5" />
              <span>{t.settings.categories?.developerSettings || "PEMBANGUN"}</span>
            </h3>
            <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold">
              {currentLang === "en" ? "Elevated Clearance" : "Kebenaran Peringkat Tinggi"}
            </span>
          </div>

          <div className="bg-white dark:bg-[#061830] rounded-2xl border border-emerald-500/30 dark:border-emerald-500/20 overflow-hidden shadow-xs divide-y divide-slate-100 dark:divide-slate-800/80">
            {/* 1. Konsol Pembangun */}
            <button
              type="button"
              onClick={() => setActiveSubpage("developer-console")}
              className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition-colors text-left cursor-pointer group"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                  <Terminal className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors">
                    {t.settings.items?.developerConsole || "Konsol Pembangun"}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                    {t.settings.items?.developerConsoleDesc || "Khusus akaun Developer yang dibenarkan"}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 tracking-wide uppercase">
                  {currentLang === "en" ? "Restricted" : "Rahsia"}
                </span>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </button>

            {/* 2. Pengurusan Pangkalan Data (Developer Level) */}
            <button
              type="button"
              onClick={onOpenDatabaseModal}
              className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0">
                  <Database className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                    {t.settings.items?.developerDatabaseMgmt || "Pengurusan Pangkalan Data (Pembangun)"}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                    {t.settings.items?.developerDatabaseMgmtDesc || "Urus pangkalan data berbilang syarikat, sandbox pengasingan dan arkib"}
                  </span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
            </button>

            {/* 3. Simulator Peranan */}
            <button
              type="button"
              onClick={() => setActiveSubpage("developer-simulator")}
              className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0">
                  <Sliders className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                    {t.settings.items?.developerSandbox || "Kotak Pasir & Simulator Peranan"}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                    {t.settings.items?.developerSandboxDesc || "Uji akses peranan pengguna tanpa menjejaskan data syarikat"}
                  </span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
            </button>

            {/* 4. Kawalan Keselamatan & Perlindungan Data */}
            <button
              type="button"
              onClick={() => setActiveSubpage("developer-diagnostics")}
              className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-blue-950/40 transition-colors text-left cursor-pointer group"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0">
                  <ShieldAlert className="w-4.5 h-4.5 text-amber-500" />
                </div>
                <div className="min-w-0">
                  <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 block group-hover:text-[#0b3c7a] dark:group-hover:text-sky-300 transition-colors">
                    {t.settings.items?.developerDiagnostics || "Diagnostik Sistem & Kawalan Keselamatan"}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">
                    {t.settings.items?.developerDiagnosticsDesc || "Peraturan keselamatan Firestore, perlindungan hapus kekal dan integriti skema"}
                  </span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
            </button>
          </div>
        </div>
      )}

      {/* Delete Menu Modal */}
      {menuPendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white dark:bg-[#061830] rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-5 animate-scaleIn">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5 text-rose-600 dark:text-rose-400">
                <div className="w-10 h-10 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-100 dark:border-rose-900/60 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                    {currentLang === "en" ? "Confirm Product Deletion" : "Sahkan Pemadaman Produk"}
                  </h3>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {menuPendingDelete.namaSyarikat}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMenuPendingDelete(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300">
              <p className="leading-relaxed">
                {currentLang === "en" ? (
                  <>
                    Are you sure you want to permanently delete menu <strong>"{menuPendingDelete.namaProduk}"</strong>?
                  </>
                ) : (
                  <>
                    Adakah anda pasti ingin memadam menu <strong>"{menuPendingDelete.namaProduk}"</strong>?
                  </>
                )}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setMenuPendingDelete(null)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-xs transition-all cursor-pointer"
              >
                {currentLang === "en" ? "Cancel" : "Batal"}
              </button>
              <button
                type="button"
                onClick={() => {
                  const idToDelete = menuPendingDelete.id;
                  setMenuPendingDelete(null);
                  onDeleteProduct(idToDelete);
                }}
                className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{currentLang === "en" ? "Yes, Delete Menu" : "Ya, Padam Menu Ini"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
