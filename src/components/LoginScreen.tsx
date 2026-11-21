/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { KeyRound, User, LogIn, Soup, UserPlus, Building2, CheckCircle2, AlertCircle, Eye, EyeOff, Sparkles, Database, Coins, X, Mail } from "lucide-react";
import { RegisteredUser, UserRole, ROLE_DEFINITIONS } from "../types";
import { defaultTemplates, createEmptyBusinessDatabase } from "../data/defaultTemplates";
import smartcostLogo from "../assets/images/smartcost_official_logo_1786593263808.jpg";
import { Language, getTranslation, getStoredLanguage } from "../utils/i18n";
import { 
  auth, 
  signInWithGoogle, 
  checkRedirectResult, 
  formatAuthErrorMessage, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword 
} from "../firebase";
import { syncUserProfileToFirestore } from "../utils/firestoreSync";
import { processGoogleUserAuth } from "../utils/googleAuthHelper";
import { handleInputEnterKey } from "../utils/inputNavigation";
import { formatCurrencyRM } from "../utils/costCalculations";
import { saveServerSessionToken } from "../utils/authSessionClient";
import { isDeveloperShortcutEvent } from "../utils/devShortcut";
import DeveloperAuthModal from "./DeveloperAuthModal";
import { apiUrl, getFetchCredentialsMode, isEdgeStandaloneResponse, isOriginUnavailableError } from "../utils/apiBase";
import { edgeBootstrapAdmin, edgeLoginManual, edgeRegisterManual } from "../utils/edgeLocalAuth";

export interface LoginUserPayload {
  id?: string;
  username: string;
  fullName: string;
  companyName?: string;
  role?: UserRole;
  email?: string;
  dbKey?: string;
}

interface LoginScreenProps {
  namaSyarikat: string;
  onLoginSuccess: (user: LoginUserPayload) => void;
  defaultUsername: string;
  defaultPassword: string;
  systemLang?: Language;
  onLanguageChange?: (lang: Language) => void;
}

export default function LoginScreen({
  namaSyarikat,
  onLoginSuccess,
  defaultUsername,
  defaultPassword,
  systemLang,
  onLanguageChange,
}: LoginScreenProps) {
  const [lang, setLang] = useState<Language>(systemLang || getStoredLanguage());
  const t = getTranslation(lang);

  useEffect(() => {
    if (systemLang) {
      setLang(systemLang);
    }
  }, [systemLang]);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Login form state
  const [loginUsername, setLoginUsername] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginRole, setLoginRole] = useState<UserRole>("admin");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [requires2FA, setRequires2FA] = useState(false);
  const [loginTotpCode, setLoginTotpCode] = useState("");

  // Register form state
  const [regFullName, setRegFullName] = useState("");
  const [regCompanyName, setRegCompanyName] = useState("");
  const [regRole, setRegRole] = useState<UserRole>("admin");
  const [regUsername, setRegUsername] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);

  // Feedback states
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isProcessingGoogle, setIsProcessingGoogle] = useState(false);
  const [googleNotice, setGoogleNotice] = useState("");

  // Registered users stored in localStorage
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);

  // Database Picker modal state when 1 email has multiple databases
  const [dbPickerModalOpen, setDbPickerModalOpen] = useState(false);
  const [selectableAccounts, setSelectableAccounts] = useState<RegisteredUser[]>([]);

  // Developer Secret Entry States
  const [devSandboxEnabled, setDevSandboxEnabled] = useState(true);
  const [secretDevModalOpen, setSecretDevModalOpen] = useState(false);

  // One-time Admin Account Activation State (shown ONLY when server reports ADMIN_SETUP_REQUIRED)
  const [adminBootstrapOpen, setAdminBootstrapOpen] = useState(false);
  const [bootstrapPassword, setBootstrapPassword] = useState("");
  const [bootstrapConfirmPassword, setBootstrapConfirmPassword] = useState("");
  const [isBootstrappingAdmin, setIsBootstrappingAdmin] = useState(false);

  const syncVerifiedUserToLocalStorage = (
    verifiedUser: any,
    fallbackCompName?: string,
    fallbackEmail?: string
  ) => {
    try {
      const compName =
        verifiedUser.companyName ||
        fallbackCompName ||
        namaSyarikat ||
        (lang === "en" ? "SCHOOL ENTERPRISE" : "PERNIAGAAN BAHARU");
      const safeUserSlug = String(verifiedUser.username || "user").toLowerCase().replace(/[^a-z0-9_\-]/g, "_") || "user";
      const userDbKey =
        verifiedUser.dbKey ||
        `pengekosan_company_db_${safeUserSlug}_${String(verifiedUser.id || "usr").slice(0, 8)}`;

      if (userDbKey && !localStorage.getItem(userDbKey)) {
        const newDb = createEmptyBusinessDatabase(compName, verifiedUser.username);
        localStorage.setItem(userDbKey, JSON.stringify(newDb));
      }

      let baseUsers: RegisteredUser[] = [];
      try {
        const raw = localStorage.getItem("pengekosan_registered_users");
        if (raw) baseUsers = JSON.parse(raw);
      } catch {}
      if (!Array.isArray(baseUsers)) baseUsers = registeredUsers;

      const normUsername = String(verifiedUser.username || "").trim().toLowerCase();
      const updated = baseUsers.filter(
        (u) => u.id !== verifiedUser.id && u.username.trim().toLowerCase() !== normUsername
      );
      updated.push({
        id: verifiedUser.id,
        username: verifiedUser.username,
        fullName: verifiedUser.fullName || verifiedUser.username,
        companyName: compName,
        role: verifiedUser.role,
        email: verifiedUser.email || fallbackEmail,
        password: "[VERIFIED_SERVER_HASH]",
        dbKey: userDbKey,
        registeredAt: verifiedUser.createdAt || new Date().toISOString(),
      });
      setRegisteredUsers(updated);
      localStorage.setItem("pengekosan_registered_users", JSON.stringify(updated));
    } catch (storageErr) {
      console.warn("[Login] Local storage sync notice:", storageErr);
    }
  };

  const mintEdgeSessionForVerifiedUser = async (verifiedUser: any) => {
    try {
      const edgeResp = await fetch(apiUrl("/api/auth/edge-session"), {
        method: "POST",
        credentials: getFetchCredentialsMode(),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: verifiedUser.id,
          username: verifiedUser.username,
          fullName: verifiedUser.fullName,
          role: verifiedUser.role,
          companyName: verifiedUser.companyName,
          dbKey: verifiedUser.dbKey,
          email: verifiedUser.email,
        }),
      });
      const edgeData = await edgeResp.json().catch(() => ({}));
      if (edgeResp.ok && edgeData.sessionToken) {
        saveServerSessionToken(edgeData.sessionToken, edgeData.csrfToken);
      }
    } catch {}
  };

  const completeFirebaseLoginWithEdgeFallback = async (
    fbUser: {
      uid: string;
      email?: string | null;
      displayName?: string | null;
      emailVerified?: boolean;
      getIdToken: (forceRefresh?: boolean) => Promise<string>;
    },
    preferred: {
      id?: string;
      username?: string;
      fullName?: string;
      companyName?: string;
      role?: UserRole;
      email?: string;
      dbKey?: string;
    },
    fallbackErrorText: string
  ): Promise<boolean> => {
    const idToken = await fbUser.getIdToken();
    let fbResp: Response | null = null;
    let fbData: any = {};
    let networkErr: unknown = null;

    try {
      fbResp = await fetch(apiUrl("/api/auth/session-firebase"), {
        method: "POST",
        credentials: getFetchCredentialsMode(),
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          dbKey: preferred.dbKey,
          companyName: preferred.companyName,
        }),
      });
      fbData = await fbResp.json().catch(() => ({}));
    } catch (err) {
      networkErr = err;
    }

    if (fbResp && fbResp.ok && fbData?.success && fbData?.user) {
      saveServerSessionToken(fbData.sessionToken, fbData.csrfToken);
      syncVerifiedUserToLocalStorage(fbData.user, preferred.companyName, preferred.email);
      onLoginSuccess({
        ...preferred,
        id: fbData.user.id || preferred.id,
        username: fbData.user.username || preferred.username || "user",
        fullName: fbData.user.fullName || preferred.fullName || "Pengguna",
        companyName: fbData.user.companyName || preferred.companyName,
        role: fbData.user.role,
        email: fbData.user.email || preferred.email,
        dbKey: fbData.user.dbKey || preferred.dbKey,
      });
      return true;
    }

    const shouldFallback =
      (networkErr && isOriginUnavailableError(networkErr)) ||
      (fbResp !== null && isEdgeStandaloneResponse(fbResp.status, fbData));

    if (shouldFallback) {
      const cleanEmail = (fbUser.email || preferred.email || "").trim().toLowerCase();
      const isVerifiedDev = Boolean(
        fbUser.emailVerified && cleanEmail === "afiqhakimi070409@gmail.com"
      );
      const safeRole: UserRole = isVerifiedDev
        ? "developer"
        : preferred.role && preferred.role !== "developer"
          ? preferred.role
          : "staf";
      const safeUser = {
        id: preferred.id || fbUser.uid,
        username: preferred.username || (cleanEmail ? cleanEmail.split("@")[0] : "user"),
        fullName: preferred.fullName || fbUser.displayName || (cleanEmail ? cleanEmail.split("@")[0] : "Pengguna"),
        companyName: isVerifiedDev
          ? "DEVELOPER SANDBOX"
          : (preferred.companyName || namaSyarikat || "SCHOOL ENTERPRISE"),
        role: safeRole,
        email: cleanEmail || undefined,
        dbKey: isVerifiedDev
          ? "pengekosan_dev_sandbox_db"
          : (preferred.dbKey || `pengekosan_userdb_${fbUser.uid}`),
      };
      await mintEdgeSessionForVerifiedUser(safeUser);
      syncVerifiedUserToLocalStorage(safeUser, safeUser.companyName, safeUser.email);
      onLoginSuccess(safeUser);
      return true;
    }

    setError(fbData?.error || fallbackErrorText);
    return false;
  };

  useEffect(() => {
    fetch(apiUrl("/api/config/features"), { credentials: getFetchCredentialsMode() })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cfg) {
          const enabled = typeof cfg.devEntryEnabled === "boolean"
            ? cfg.devEntryEnabled
            : (typeof cfg.devSandboxEnabled === "boolean" ? cfg.devSandboxEnabled : true);
          setDevSandboxEnabled(enabled);
          if (!enabled) setSecretDevModalOpen(false);
        }
      })
      .catch(() => {});
  }, []);

  // Undocumented Secret Keyboard Shortcut listener for Developer Entry (Alt+D or configurable alternative)
  useEffect(() => {
    if (!devSandboxEnabled) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isDeveloperShortcutEvent(e)) {
        e.preventDefault();
        e.stopPropagation();
        setSecretDevModalOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [devSandboxEnabled]);

  useEffect(() => {
    let isSubscribed = true;

    try {
      const savedUsers = localStorage.getItem("pengekosan_registered_users");
      if (savedUsers) {
        setRegisteredUsers(JSON.parse(savedUsers));
      }
    } catch (e) {
      console.error("Failed to load registered users:", e);
    }

    // Process redirect result if returning from signInWithRedirect()
    async function resolveRedirectSignIn() {
      try {
        const redirectUser = await checkRedirectResult();
        if (redirectUser && isSubscribed) {
          setIsProcessingGoogle(true);
          setGoogleNotice(
            lang === "en"
              ? "Google Sign-In completed! Preparing your workspace..."
              : "Log masuk Google selesai! Menyediakan ruang kerja anda..."
          );

          let currentUsers: RegisteredUser[] = [];
          try {
            const raw = localStorage.getItem("pengekosan_registered_users");
            if (raw) currentUsers = JSON.parse(raw);
          } catch {}

          const result = await processGoogleUserAuth(redirectUser, currentUsers, lang);
          if (!isSubscribed) return;

          if (result.updatedUsers) {
            setRegisteredUsers(result.updatedUsers);
          }

          if (result.status === "multiple_accounts" && result.accounts) {
            setSelectableAccounts(result.accounts);
            setDbPickerModalOpen(true);
          } else if (result.status === "success" && result.payload) {
            await completeFirebaseLoginWithEdgeFallback(
              redirectUser,
              result.payload,
              lang === "en"
                ? "Google authentication verification failed."
                : "Pengesahan log masuk Google di pelayan gagal."
            );
          }
        }
      } catch (err: any) {
        if (isSubscribed) {
          console.error("[SmartCost Auth] Redirect sign-in resolution failed:", err);
          setError(formatAuthErrorMessage(err, lang === "en" ? "en" : "ms"));
        }
      } finally {
        if (isSubscribed) {
          setIsProcessingGoogle(false);
        }
      }
    }

    resolveRedirectSignIn();

    return () => {
      isSubscribed = false;
    };
  }, []);

  // Dynamic company name based on username input or default config (never expose developer identities)
  const trimmedInputUser = loginUsername.trim().toLowerCase();
  const matchedUserForDisplay = registeredUsers.find(
    (u) => u.username.toLowerCase() === trimmedInputUser && u.role !== "developer"
  );
  const displayCompanyName =
    matchedUserForDisplay?.companyName || namaSyarikat || (lang === "en" ? "SCHOOL ENTERPRISE" : "PERNIAGAAN BAHARU");

  // UNIFIED SINGLE-PAGE LOGIN HANDLER (IMAGE 1 SPECIFICATION)
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const rawUser = loginUsername.trim();
    const rawEmail = loginEmail.trim().toLowerCase();
    const password = loginPassword;

    if (!rawUser && !rawEmail) {
      setError(lang === "en" ? "Please enter your username or email." : "Sila masukkan nama pengguna (username) atau emel anda.");
      return;
    }

    if (!password) {
      setError(lang === "en" ? "Please enter your password." : "Sila masukkan kata laluan anda.");
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Authoritative Server Manual Login (supports Username OR Optional Email directly on server)
      let resp: Response | null = null;
      let data: any = {};
      let resolvedStatus = 0;
      let resolvedOk = false;
      let fetchNetworkErr: unknown = null;

      try {
        resp = await fetch(apiUrl("/api/auth/login-manual"), {
          method: "POST",
          credentials: getFetchCredentialsMode(),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: rawUser,
            email: rawEmail,
            password: password,
            requestedRole: loginRole,
            ...(loginTotpCode.trim() ? { totpCode: loginTotpCode.trim() } : {}),
          }),
        });
        data = await resp.json().catch(() => ({}));
        resolvedStatus = resp.status;
        resolvedOk = resp.ok;
      } catch (err) {
        fetchNetworkErr = err;
      }

      // Cloudflare Standalone Edge Mode (when external Express origin is not configured or unreachable)
      const shouldUseEdgeLogin =
        (fetchNetworkErr && isOriginUnavailableError(fetchNetworkErr)) ||
        (resp !== null && isEdgeStandaloneResponse(resp.status, data));

      if (shouldUseEdgeLogin) {
        const edgeRes = await edgeLoginManual({
          username: rawUser,
          email: rawEmail,
          password,
          requestedRole: loginRole,
        });
        resolvedStatus = edgeRes.status;
        resolvedOk = edgeRes.success;
        data = edgeRes;
        if (edgeRes.success && edgeRes.user) {
          await mintEdgeSessionForVerifiedUser(edgeRes.user);
        }
      } else if (fetchNetworkErr) {
        throw fetchNetworkErr;
      }

      if (
        resolvedStatus === 401 &&
        (data?.code === "TWO_FACTOR_REQUIRED" || data?.code === "INVALID_TWO_FACTOR_CODE")
      ) {
        setRequires2FA(true);
        setError(
          data.error ||
            (lang === "en"
              ? "Please enter the 6-digit 2FA verification code from your authenticator app."
              : "Sila masukkan kod pengesahan 2FA (6 digit) daripada aplikasi Authenticator anda.")
        );
        return;
      }

      if (resolvedOk && data.success && data.user) {
        saveServerSessionToken(data.sessionToken, data.csrfToken);
        const verifiedUser = data.user;
        const compName = verifiedUser.companyName || namaSyarikat || (lang === "en" ? "SCHOOL ENTERPRISE" : "PERNIAGAAN BAHARU");
        const userDbKey =
          verifiedUser.dbKey ||
          `pengekosan_company_db_${String(verifiedUser.username || "user").toLowerCase()}_${String(verifiedUser.id || "usr").slice(0, 8)}`;

        syncVerifiedUserToLocalStorage(verifiedUser, compName, rawEmail);
        syncUserProfileToFirestore(verifiedUser).catch(console.warn);

        onLoginSuccess({
          id: verifiedUser.id,
          username: verifiedUser.username,
          fullName: verifiedUser.fullName,
          companyName: compName,
          role: verifiedUser.role,
          email: verifiedUser.email || rawEmail || undefined,
          dbKey: userDbKey,
        });
        return;
      }

      // If default Admin account has not been activated yet, show clean inline activation flow
      if (resolvedStatus === 409 && data.code === "ADMIN_SETUP_REQUIRED") {
        setAdminBootstrapOpen(true);
        setError(
          data.error ||
            (lang === "en"
              ? "Primary Admin account has not been activated yet. Please set a new Admin password below."
              : "Akaun Pentadbir Utama (admin) belum diaktifkan dengan kata laluan baharu. Sila tetapkan kata laluan Admin di bawah.")
        );
        return;
      }

      // Rate-limited
      if (resolvedStatus === 429 || data.code === "LOCKED") {
        setError(data.error || (lang === "en" ? "Too many login attempts. Please try again shortly." : "Terlalu banyak percubaan log masuk. Sila cuba lagi sebentar."));
        return;
      }

      // Role mismatch, disabled account, or developer Alt+D isolation (never mask as wrong password)
      if (
        resolvedStatus === 403 &&
        (data.code === "ROLE_MISMATCH" || data.code === "ACCOUNT_DISABLED" || data.code === "DEVELOPER_USE_ALT_D")
      ) {
        setError(data.error);
        return;
      }

      // Server-side 5xx errors (never expose raw technical gateway/Express messages)
      if (resolvedStatus >= 500) {
        setError(
          lang === "en"
            ? "Unable to connect to the authentication service. Please try again or use Google Sign-In."
            : "Tidak dapat menghubungi perkhidmatan pengesahan buat masa ini. Sila cuba lagi atau gunakan Log Masuk Google."
        );
        return;
      }

      // 2. Fallback: Firebase Email/Password Login when email is provided and manual check did not match
      const firebaseCandidateEmail =
        rawEmail && rawEmail.includes("@")
          ? rawEmail
          : rawUser.includes("@")
            ? rawUser.toLowerCase()
            : "";

      if (firebaseCandidateEmail) {
        try {
          const userCred = await signInWithEmailAndPassword(auth, firebaseCandidateEmail, password);
          const fbUser = userCred.user;
          await completeFirebaseLoginWithEdgeFallback(
            fbUser,
            {
              id: fbUser.uid,
              username: fbUser.email?.split("@")[0] || "user",
              fullName: fbUser.displayName || "Pengguna",
              companyName: namaSyarikat || "SCHOOL ENTERPRISE",
              email: fbUser.email || firebaseCandidateEmail,
            },
            lang === "en"
              ? "Firebase authentication failed on server."
              : "Pengesahan Firebase di pelayan gagal."
          );
          return;
        } catch (fbErr: any) {
          const fbCode = String(fbErr?.code || "");
          if (
            fbCode &&
            fbCode !== "auth/invalid-credential" &&
            fbCode !== "auth/wrong-password" &&
            fbCode !== "auth/user-not-found"
          ) {
            setError(formatAuthErrorMessage(fbErr, lang === "en" ? "en" : "ms"));
            return;
          }
        }
      }

      setError(data.error || (lang === "en" ? "Incorrect username or password." : "Nama pengguna atau kata laluan tidak betul."));
    } catch (err: any) {
      console.warn("[Login Notice]:", err?.code || err?.message || "login_failed");
      const errCode = String(err?.code || "");
      if (errCode === "auth/too-many-requests") {
        setError(lang === "en" ? "Too many login attempts. Please try again shortly." : "Terlalu banyak percubaan log masuk. Sila cuba lagi sebentar.");
      } else if (errCode.startsWith("auth/")) {
        setError(formatAuthErrorMessage(err, lang === "en" ? "en" : "ms"));
      } else {
        setError(
          lang === "en"
            ? "Connection or server error during login. Please try again."
            : "Ralat sambungan atau pelayan semasa log masuk. Sila cuba lagi."
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBootstrapAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (bootstrapPassword.length < 10) {
      setError(lang === "en" ? "Admin password must be at least 10 characters." : "Kata laluan Admin mestilah sekurang-kurangnya 10 aksara.");
      return;
    }
    if (bootstrapPassword !== bootstrapConfirmPassword) {
      setError(lang === "en" ? "Passwords do not match!" : "Kata laluan dan pengesahan kata laluan tidak sama!");
      return;
    }

    setIsBootstrappingAdmin(true);
    try {
      let resp: Response | null = null;
      let data: any = {};
      let resolvedOk = false;
      let netErr: unknown = null;
      try {
        resp = await fetch(apiUrl("/api/auth/bootstrap-admin"), {
          method: "POST",
          credentials: getFetchCredentialsMode(),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            password: bootstrapPassword,
            email: loginEmail.trim().toLowerCase() || undefined,
          }),
        });
        data = await resp.json().catch(() => ({}));
        resolvedOk = resp.ok;
      } catch (err) {
        netErr = err;
      }

      if (
        (netErr && isOriginUnavailableError(netErr)) ||
        (resp !== null && isEdgeStandaloneResponse(resp.status, data))
      ) {
        const edgeRes = await edgeBootstrapAdmin({
          password: bootstrapPassword,
          email: loginEmail.trim().toLowerCase() || undefined,
        });
        resolvedOk = edgeRes.success;
        data = edgeRes;
        if (edgeRes.success && edgeRes.user) {
          await mintEdgeSessionForVerifiedUser(edgeRes.user);
        }
      } else if (netErr) {
        throw netErr;
      }
      if (!resolvedOk || !data.success || !data.user) {
        setError(data.error || (lang === "en" ? "Failed to activate Admin account." : "Gagal mengaktifkan akaun Admin."));
        return;
      }
      saveServerSessionToken(data.sessionToken, data.csrfToken);
      syncVerifiedUserToLocalStorage(data.user, data.user.companyName);
      setBootstrapPassword("");
      setBootstrapConfirmPassword("");
      setAdminBootstrapOpen(false);
      onLoginSuccess({
        id: data.user.id,
        username: data.user.username,
        fullName: data.user.fullName,
        companyName: data.user.companyName,
        role: data.user.role,
        email: data.user.email,
        dbKey: data.user.dbKey,
      });
    } catch {
      setError(lang === "en" ? "Connection error while activating Admin." : "Ralat sambungan semasa mengaktifkan akaun Admin.");
    } finally {
      setIsBootstrappingAdmin(false);
    }
  };

  // REGISTRATION (EMAIL IS STRICTLY OPTIONAL)
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const fullName = regFullName.trim();
    const username = regUsername.trim();
    const company = regCompanyName.trim() || `${fullName.toUpperCase()} ENTERPRISE`;
    const email = regEmail.trim().toLowerCase() || undefined; // OPTIONAL!
    const password = regPassword;
    const confirmPass = regConfirmPassword;

    if (!fullName) {
      setError(lang === "en" ? "Please enter your full name." : "Sila masukkan nama penuh anda.");
      return;
    }

    if (!username || !/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
      setError(
        lang === "en"
          ? "Username must be 3–64 characters and contain only letters, numbers, dots (.), underscores (_), or hyphens (-)."
          : "Nama pengguna mestilah 3–64 aksara dan hanya huruf, nombor, titik (.), garis bawah (_), atau sempang (-)."
      );
      return;
    }

    if (email && (!email.includes("@") || !email.includes("."))) {
      setError(
        lang === "en"
          ? "Please enter a valid email format or leave the email field empty."
          : "Sila masukkan format emel yang sah atau biarkan ruangan emel kosong."
      );
      return;
    }

    if (password.length < 10) {
      setError(lang === "en" ? "Password must be at least 10 characters for security." : "Kata laluan mestilah sekurang-kurangnya 10 aksara demi keselamatan.");
      return;
    }

    if (password !== confirmPass) {
      setError(lang === "en" ? "Passwords do not match!" : "Kata laluan dan pengesahan kata laluan tidak sama!");
      return;
    }

    setIsSubmitting(true);

    try {
      let resp: Response | null = null;
      let data: any = {};
      let resolvedOk = false;
      let netErr: unknown = null;
      try {
        resp = await fetch(apiUrl("/api/auth/register-manual"), {
          method: "POST",
          credentials: getFetchCredentialsMode(),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            fullName,
            companyName: company,
            password,
            email,
          }),
        });
        data = await resp.json().catch(() => ({}));
        resolvedOk = resp.ok;
      } catch (err) {
        netErr = err;
      }

      if (
        (netErr && isOriginUnavailableError(netErr)) ||
        (resp !== null && isEdgeStandaloneResponse(resp.status, data))
      ) {
        const edgeRes = await edgeRegisterManual({
          username,
          fullName,
          companyName: company,
          password,
          email,
        });
        resolvedOk = edgeRes.success;
        data = edgeRes;
      } else if (netErr) {
        throw netErr;
      }

      if (!resolvedOk || !data.success || !data.user) {
        throw new Error(data.error || (lang === "en" ? "Registration failed." : "Pendaftaran akaun gagal."));
      }

      const newUser = data.user;
      const userDbKey = newUser.dbKey || `pengekosan_company_db_${username}_${newUser.id.slice(0, 8)}`;

      // Create isolated business database locally
      try {
        const newDb = createEmptyBusinessDatabase(newUser.companyName, username);
        localStorage.setItem(userDbKey, JSON.stringify(newDb));

        const updated = [...registeredUsers, {
          id: newUser.id,
          username: newUser.username,
          fullName: newUser.fullName,
          companyName: newUser.companyName,
          role: newUser.role,
          email: newUser.email,
          password: "[VERIFIED_SERVER_HASH]",
          dbKey: userDbKey,
          registeredAt: newUser.createdAt || new Date().toISOString(),
        }];
        setRegisteredUsers(updated);
        localStorage.setItem("pengekosan_registered_users", JSON.stringify(updated));
      } catch (storageErr) {
        console.warn("[Register] Storage warning:", storageErr);
      }

      // Sync profile to Firestore
      syncUserProfileToFirestore(newUser).catch(console.warn);

      // Reset form fields
      setRegFullName("");
      setRegCompanyName("");
      setRegUsername("");
      setRegEmail("");
      setRegPassword("");
      setRegConfirmPassword("");

      setLoginUsername(newUser.username || username);
      setLoginPassword("");
      setMode("login");
      setSuccess(
        lang === "en"
          ? `Account for '${newUser.companyName}' registered successfully! You can now log in using your username and password.`
          : `Pendaftaran akaun untuk '${newUser.companyName}' berjaya! Anda kini boleh log masuk menggunakan username dan kata laluan anda.`
      );
    } catch (err: any) {
      console.error("[Registration Error]:", err);
      setError(err.message || (lang === "en" ? "Registration encountered an error." : "Pendaftaran akaun mengalami ralat."));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Google Sign-In with Firebase Auth (Popup with seamless Redirect fallback)
  const handleGoogleSignIn = async (forceRedirect: boolean = false) => {
    setError("");
    setSuccess("");
    setIsProcessingGoogle(true);
    setGoogleNotice(
      forceRedirect
        ? (lang === "en" ? "Redirecting to Google Sign-In..." : "Mengalihkan ke halaman Google Sign-In...")
        : (lang === "en" ? "Opening Google Sign-In..." : "Membuka tetingkap Google Sign-In...")
    );

    try {
      const res = await signInWithGoogle({
        preferRedirect: forceRedirect,
        lang: lang === "en" ? "en" : "ms",
        onRedirectStart: () => {
          setGoogleNotice(
            lang === "en"
              ? "Popup blocked by browser. Redirecting to Google Sign-In..."
              : "Popup disekat oleh pelayar. Mengalihkan ke halaman Google Sign-In yang selamat..."
          );
        },
      });

      if (res.user) {
        setGoogleNotice(
          lang === "en" ? "Authenticated! Loading profile..." : "Pengesahan berjaya! Memuatkan profil..."
        );

        let currentUsers: RegisteredUser[] = [];
        try {
          const raw = localStorage.getItem("pengekosan_registered_users");
          if (raw) currentUsers = JSON.parse(raw);
        } catch {}

        const result = await processGoogleUserAuth(res.user, currentUsers, lang);

        if (result.updatedUsers) {
          setRegisteredUsers(result.updatedUsers);
        }

        if (result.status === "multiple_accounts" && result.accounts) {
          setSelectableAccounts(result.accounts);
          setDbPickerModalOpen(true);
        } else if (result.status === "success" && result.payload) {
          await completeFirebaseLoginWithEdgeFallback(
            res.user,
            result.payload,
            lang === "en"
              ? "Google sign-in could not be verified."
              : "Pengesahan log masuk Google gagal."
          );
        }
      } else if (res.isRedirecting) {
        // Browser will navigate to Google accounts page
        setGoogleNotice(
          lang === "en" ? "Redirecting to Google..." : "Mengalihkan ke Google..."
        );
      }
    } catch (err: any) {
      console.error("[SmartCost] Google sign-in failed:", err);
      setError(formatAuthErrorMessage(err, lang === "en" ? "en" : "ms"));
    } finally {
      setIsProcessingGoogle(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center relative overflow-hidden px-4 py-8">
      {/* Background decorations */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-blue-900/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2 pointer-events-none"></div>
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-sky-900/20 rounded-full blur-3xl translate-x-1/2 translate-y-1/2 pointer-events-none"></div>

      {/* Main Card Container */}
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden p-5 sm:p-8 lg:p-10 flex flex-col justify-between relative z-10 border border-slate-100 animate-scaleIn">
        <div>
          {/* Top Bar: Quick Language Switcher */}
          <div className="flex items-center justify-end pb-3 mb-2 border-b border-slate-100">

            {/* Language Toggle Pill */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setLang("ms");
                  onLanguageChange?.("ms");
                }}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer ${
                  lang === "ms"
                    ? "bg-[#0b3c7a] text-white shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
                title="Bahasa Melayu"
              >
                BM
              </button>
              <button
                type="button"
                onClick={() => {
                  setLang("en");
                  onLanguageChange?.("en");
                }}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer ${
                  lang === "en"
                    ? "bg-[#0b3c7a] text-white shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
                title="English"
              >
                EN
              </button>
            </div>
          </div>

          {/* Official Logo Header */}
          <div className="flex justify-center mb-3">
            <div
              className="w-24 h-24 sm:w-28 sm:h-28 bg-white border border-slate-200 rounded-2xl flex items-center justify-center shadow-md overflow-hidden p-1.5 select-none"
              title="SMARTCOST SISTEM"
            >
              <img
                src={smartcostLogo}
                alt="Logo SMARTCOST SISTEM"
                className="w-full h-full object-contain rounded-lg pointer-events-none"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>

          {/* Nama Sistem */}
          <h1 className="text-2xl sm:text-3xl font-display font-black text-center text-[#0b3c7a] tracking-wider uppercase">
            SMARTCOST
          </h1>

          {/* Nama Syarikat (ikut database) */}
          <h2 className="text-xs sm:text-sm font-display font-bold text-center text-slate-600 tracking-tight mt-1 uppercase">
            {displayCompanyName}
          </h2>

          {/* Error Banner */}
          {error && (
            <div className="mt-4 p-3.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-medium flex items-center gap-2.5 animate-fadeIn">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Banner */}
          {success && (
            <div className="mt-4 p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-medium flex items-center gap-2.5 animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{success}</span>
            </div>
          )}

          {/* MODE 0: AKTIFKAN AKAUN ADMIN UTAMA (Hanya dipaparkan jika tiada akaun Admin berdaftar) */}
          {mode === "login" && adminBootstrapOpen && (
            <form onSubmit={handleBootstrapAdminSubmit} className="mt-5 p-4 bg-blue-50/70 border border-blue-200 rounded-2xl space-y-3.5 animate-fadeIn">
              <div className="space-y-1">
                <h3 className="text-xs font-bold text-[#0b3c7a] uppercase tracking-wider">
                  {lang === "en" ? "Activate Primary Admin Account (admin)" : "Aktifkan Akaun Pentadbir Utama (admin)"}
                </h3>
                <p className="text-[11px] text-slate-600">
                  {lang === "en"
                    ? "Set your Admin password (minimum 10 characters) to unlock SCHOOL ENTERPRISE securely."
                    : "Tetapkan kata laluan Admin anda (sekurang-kurangnya 10 aksara) untuk mengaktifkan akaun SCHOOL ENTERPRISE secara selamat."}
                </p>
              </div>
              <div>
                <label className="block text-[10px] font-mono tracking-widest text-slate-500 uppercase mb-1 font-semibold">
                  {lang === "en" ? "NEW ADMIN PASSWORD (MIN 10 CHARS)" : "KATA LALUAN ADMIN BAHARU (MIN 10 AKSARA)"}
                </label>
                <input
                  type="password"
                  required
                  value={bootstrapPassword}
                  onChange={(e) => {
                    setBootstrapPassword(e.target.value);
                    setError("");
                  }}
                  placeholder="••••••••••"
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 focus:border-[#0b3c7a] rounded-xl text-sm font-medium text-slate-800 outline-hidden"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono tracking-widest text-slate-500 uppercase mb-1 font-semibold">
                  {lang === "en" ? "CONFIRM ADMIN PASSWORD" : "SAHKAN KATA LALUAN ADMIN"}
                </label>
                <input
                  type="password"
                  required
                  value={bootstrapConfirmPassword}
                  onChange={(e) => {
                    setBootstrapConfirmPassword(e.target.value);
                    setError("");
                  }}
                  placeholder="••••••••••"
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 focus:border-[#0b3c7a] rounded-xl text-sm font-medium text-slate-800 outline-hidden"
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setAdminBootstrapOpen(false);
                    setBootstrapPassword("");
                    setBootstrapConfirmPassword("");
                    setError("");
                  }}
                  className="px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl cursor-pointer"
                >
                  {lang === "en" ? "Back" : "Kembali"}
                </button>
                <button
                  type="submit"
                  disabled={isBootstrappingAdmin}
                  className="flex-1 py-2.5 px-4 bg-[#0b3c7a] hover:bg-[#093163] text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  <span>{lang === "en" ? "Activate & Log In" : "Aktifkan & Log Masuk"}</span>
                </button>
              </div>
            </form>
          )}

          {/* MODE 1: LOG MASUK (IMAGE 1 CONTINUOUS VERTICAL FORM) */}
          {mode === "login" && !adminBootstrapOpen && (
            <form onSubmit={handleLoginSubmit} className="mt-5 space-y-4">
              {/* Field 1: Username / Nama Pengguna */}
              <div>
                <label className="block text-[10px] font-mono tracking-widest text-slate-500 uppercase mb-1.5 font-semibold">
                  {lang === "en" ? "USERNAME / USER ID" : "USERNAME / NAMA PENGGUNA"}
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
                    <User className="w-4 h-4" />
                  </span>
                  <input
                    type="text"
                    value={loginUsername}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLoginUsername(val);
                      setError("");
                      if (requires2FA) {
                        setRequires2FA(false);
                        setLoginTotpCode("");
                      }

                      // Auto-select role if cached non-developer user found
                      const matching = registeredUsers.find(
                        (u) => u.username.toLowerCase() === val.trim().toLowerCase() && u.role !== "developer"
                      );
                      if (matching && matching.role) {
                        setLoginRole(matching.role);
                      }
                    }}
                    placeholder={lang === "en" ? "Enter your username..." : "Masukkan nama pengguna anda..."}
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 hover:bg-slate-100/50 focus:bg-white border border-slate-200 focus:border-[#0b3c7a] rounded-xl text-sm font-medium text-slate-800 transition-all outline-hidden"
                  />
                </div>
              </div>

              {/* Field 2: Emel / Email (Pilihan) */}
              <div>
                <label className="block text-[10px] font-mono tracking-widest text-slate-500 uppercase mb-1.5 font-semibold">
                  EMEL / EMAIL <span className="text-slate-400 font-normal">(PILIHAN)</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
                    <Mail className="w-4 h-4" />
                  </span>
                  <input
                    type="email"
                    value={loginEmail}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLoginEmail(val);
                      setError("");

                      // Auto-match username & role if registered non-developer user found by email
                      const matched = registeredUsers.find(
                        (u) => u.email && u.email.toLowerCase() === val.trim().toLowerCase() && u.role !== "developer"
                      );
                      if (matched) {
                        if (!loginUsername) setLoginUsername(matched.username);
                        if (matched.role) setLoginRole(matched.role);
                      }
                    }}
                    placeholder={lang === "en" ? "user@example.com (optional)" : "pengguna@contoh.com (pilihan)"}
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 hover:bg-slate-100/50 focus:bg-white border border-slate-200 focus:border-[#0b3c7a] rounded-xl text-sm font-medium text-slate-800 transition-all outline-hidden"
                  />
                </div>
              </div>

              {/* Field 3: Jawatan / Peranan Log Masuk (RBAC) * */}
              <div>
                <label className="block text-[10px] font-mono tracking-widest text-slate-500 uppercase mb-1.5 font-semibold">
                  {lang === "en" ? "ROLE / LOGIN POSITION (RBAC) *" : "JAWATAN / PERANAN LOG MASUK (RBAC) *"}
                </label>
                <select
                  value={loginRole}
                  onChange={(e) => setLoginRole(e.target.value as UserRole)}
                  className="w-full px-3.5 py-3 bg-slate-50 hover:bg-slate-100/50 focus:bg-white border border-slate-200 focus:border-[#0b3c7a] rounded-xl text-xs sm:text-sm font-bold text-slate-800 transition-all outline-hidden cursor-pointer"
                >
                  {Object.entries(ROLE_DEFINITIONS)
                    .filter(([key]) => key !== "developer")
                    .map(([key, def]) => (
                      <option key={key} value={key}>
                        {def.title}
                      </option>
                    ))}
                </select>
                <p className="text-[10px] text-slate-400 mt-1 italic">
                  {lang === "en" ? "Active login role:" : "Peranan semasa log masuk:"}{" "}
                  <strong className="text-slate-600 font-bold">{ROLE_DEFINITIONS[loginRole]?.title}</strong>
                </p>
              </div>

              {/* Field 4: Kata Laluan / Password */}
              <div>
                <label className="block text-[10px] font-mono tracking-widest text-slate-500 uppercase mb-1.5 font-semibold">
                  {lang === "en" ? "PASSWORD" : "KATA LALUAN / PASSWORD"}
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
                    <KeyRound className="w-4 h-4" />
                  </span>
                  <input
                    type={showLoginPassword ? "text" : "password"}
                    required
                    value={loginPassword}
                    onChange={(e) => {
                      setLoginPassword(e.target.value);
                      setError("");
                    }}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-10 py-3 bg-slate-50 hover:bg-slate-100/50 focus:bg-white border border-slate-200 focus:border-[#0b3c7a] rounded-xl text-sm font-medium text-slate-800 transition-all outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword(!showLoginPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {requires2FA && (
                <div className="p-3.5 bg-sky-50 border border-sky-200 rounded-xl space-y-2 animate-fadeIn">
                  <label className="block text-[10px] font-mono tracking-widest text-[#0b3c7a] uppercase font-bold">
                    {lang === "en" ? "2FA AUTHENTICATOR CODE (6 DIGITS)" : "KOD PENGESAHAN 2FA (6 DIGIT)"}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={loginTotpCode}
                    onChange={(e) => {
                      setLoginTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                      setError("");
                    }}
                    placeholder="000000"
                    className="w-full px-3.5 py-2.5 bg-white border border-sky-300 focus:border-[#0b3c7a] rounded-xl text-sm font-mono font-bold tracking-[0.3em] text-center text-slate-900 outline-hidden"
                    autoFocus
                  />
                </div>
              )}

              {/* Field 5: Primary Button — LOG MASUK SEKARANG */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3.5 px-4 bg-[#0b3c7a] hover:bg-[#093163] text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-blue-900/20 hover:shadow-blue-900/30 transition-all flex items-center justify-center gap-2 cursor-pointer transform hover:-translate-y-0.5 active:translate-y-0 mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4" />
                )}
                <span>{lang === "en" ? "LOG IN NOW" : "LOG MASUK SEKARANG"}</span>
              </button>

              {/* Field 6: Divider — ATAU LOG MASUK DENGAN */}
              <div className="relative my-2.5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200"></div>
                </div>
                <div className="relative flex justify-center text-[10px] uppercase font-mono">
                  <span className="bg-white px-2 text-slate-400">
                    {lang === "en" ? "OR CONTINUE WITH" : "ATAU LOG MASUK DENGAN"}
                  </span>
                </div>
              </div>

              {/* Field 7: Secondary Button — LOG MASUK GOOGLE (FIREBASE) */}
              <div className="space-y-2">
                <button
                  type="button"
                  id="btn-google-signin"
                  onClick={() => handleGoogleSignIn(false)}
                  disabled={isProcessingGoogle}
                  className="w-full py-3 px-4 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl border border-slate-200 hover:border-slate-300 shadow-xs transition-all flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isProcessingGoogle ? (
                    <div className="w-4 h-4 border-2 border-slate-300 border-t-[#0b3c7a] rounded-full animate-spin"></div>
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                    </svg>
                  )}
                  <span>
                    {isProcessingGoogle
                      ? (googleNotice || (lang === "en" ? "Processing Google Sign-In..." : "Memproses Log Masuk Google..."))
                      : "Log Masuk Google (Firebase)"}
                  </span>
                </button>

                {/* Direct Alternative / Fallback to Redirect */}
                <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                  <span>{lang === "en" ? "Popup blocked by browser?" : "Popup disekat oleh pelayar?"}</span>
                  <button
                    type="button"
                    onClick={() => handleGoogleSignIn(true)}
                    disabled={isProcessingGoogle}
                    className="text-[#0b3c7a] hover:text-blue-900 font-bold hover:underline cursor-pointer disabled:opacity-50"
                  >
                    {lang === "en" ? "Sign in via Redirect" : "Log Masuk cara Redirect"}
                  </button>
                </div>
              </div>

              {/* Registration Toggle Link */}
              <div className="pt-2 text-center">
                <p className="text-[11px] text-slate-400">
                  {t.login.noAccount}{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setMode("register");
                      setError("");
                      setSuccess("");
                    }}
                    className="text-[#0b3c7a] font-bold hover:underline cursor-pointer"
                  >
                    {t.login.registerNow}
                  </button>
                </p>
              </div>
            </form>
          )}

          {/* MODE 2: DAFTAR AKAUN BARU FORM */}
          {mode === "register" && (
            <form onSubmit={handleRegisterSubmit} className="mt-6 space-y-3.5">
              {/* Full Name Input */}
              <div>
                <label className="block text-[10px] font-mono tracking-widest text-slate-500 uppercase mb-1 font-semibold">
                  {t.login.fullNameLabel}
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
                    <User className="w-4 h-4" />
                  </span>
                  <input
                    type="text"
                    required
                    value={regFullName}
                    onChange={(e) => {
                      setRegFullName(e.target.value);
                      setError("");
                    }}
                    placeholder={t.login.fullNamePlaceholder}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 hover:bg-slate-100/50 focus:bg-white border border-slate-200 focus:border-[#0b3c7a] rounded-xl text-xs sm:text-sm font-medium text-slate-800 transition-all outline-hidden"
                  />
                </div>
              </div>

              {/* Company / Syarikat Name Input */}
              <div>
                <label className="block text-[10px] font-mono tracking-widest text-slate-500 uppercase mb-1 font-semibold">
                  {t.login.companyLabel}
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
                    <Building2 className="w-4 h-4" />
                  </span>
                  <input
                    type="text"
                    value={regCompanyName}
                    onChange={(e) => {
                      setRegCompanyName(e.target.value);
                      setError("");
                    }}
                    placeholder={namaSyarikat || "SCHOOL ENTERPRISE"}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 hover:bg-slate-100/50 focus:bg-white border border-slate-200 focus:border-[#0b3c7a] rounded-xl text-xs sm:text-sm font-medium text-slate-800 transition-all outline-hidden"
                  />
                </div>
              </div>

              {/* Jawatan / Peranan System Selection */}
              <div>
                <label className="block text-[10px] font-mono tracking-widest text-slate-500 uppercase mb-1 font-semibold">
                  {lang === "en" ? "NEW COMPANY ROLE" : "JAWATAN / PERANAN SISTEM SYARIKAT BAHARU"}
                </label>
                <div className="p-3 bg-purple-50/80 border border-purple-200 rounded-xl text-purple-900 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300">
                      {lang === "en" ? "Staff (Staf)" : "Staf Sistem (Staf)"}
                    </span>
                    <span className="text-[11px] text-purple-700 font-medium">
                      ({lang === "en" ? "Standard Workspace Access" : "Akses Asas Ruang Kerja"})
                    </span>
                  </div>
                  <span className="text-[10px] font-bold text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full uppercase">
                    {lang === "en" ? "Automatic" : "Automatik"}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 mt-1 italic">
                  {lang === "en"
                    ? "Newly registered accounts start with standard Staff access; admins can update roles in Access Matrix."
                    : "Akaun yang baru didaftarkan bermula dengan peranan Staf; pentadbir boleh mengemas kini peranan dalam Matriks Akses."}
                </p>
              </div>

              {/* Username Input */}
              <div>
                <label className="block text-[10px] font-mono tracking-widest text-slate-500 uppercase mb-1 font-semibold">
                  {t.login.usernameLabel}
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
                    <Sparkles className="w-4 h-4" />
                  </span>
                  <input
                    type="text"
                    required
                    value={regUsername}
                    onChange={(e) => {
                      setRegUsername(e.target.value);
                      setError("");
                    }}
                    placeholder="e.g. johndoe"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 hover:bg-slate-100/50 focus:bg-white border border-slate-200 focus:border-[#0b3c7a] rounded-xl text-xs sm:text-sm font-medium text-slate-800 transition-all outline-hidden"
                  />
                </div>
              </div>

              {/* Email Section Below Username on Register - STRICTLY OPTIONAL */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-mono tracking-widest text-slate-500 uppercase font-semibold">
                    {t.login.emailLabel}
                  </label>
                  <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                    {lang === "en" ? "OPTIONAL" : "PILIHAN / OPTIONAL"}
                  </span>
                </div>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
                    <Mail className="w-4 h-4" />
                  </span>
                  <input
                    type="email"
                    value={regEmail}
                    onChange={(e) => {
                      setRegEmail(e.target.value);
                      setError("");
                    }}
                    placeholder={lang === "en" ? "user@example.com (optional)" : "pengguna@contoh.com (pilihan)"}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 hover:bg-slate-100/50 focus:bg-white border border-slate-200 focus:border-[#0b3c7a] rounded-xl text-xs sm:text-sm font-medium text-slate-800 transition-all outline-hidden"
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-1 italic">
                  {lang === "en" 
                    ? "Email is optional. You can fully use SmartCost with username only." 
                    : "Emel adalah pilihan. Anda boleh menggunakan SmartCost sepenuhnya dengan Username sahaja."}
                </p>
              </div>

              {/* Password Input */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-mono tracking-widest text-slate-500 uppercase mb-1 font-semibold">
                    {t.login.passwordLabel}
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                      <KeyRound className="w-3.5 h-3.5" />
                    </span>
                    <input
                      type={showRegPassword ? "text" : "password"}
                      required
                      value={regPassword}
                      onChange={(e) => {
                        setRegPassword(e.target.value);
                        setError("");
                      }}
                      placeholder="••••••••"
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-50 hover:bg-slate-100/50 focus:bg-white border border-slate-200 focus:border-[#0b3c7a] rounded-xl text-xs font-medium text-slate-800 transition-all outline-hidden"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-mono tracking-widest text-slate-500 uppercase mb-1 font-semibold">
                    {t.login.confirmPasswordLabel}
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                      <KeyRound className="w-3.5 h-3.5" />
                    </span>
                    <input
                      type={showRegPassword ? "text" : "password"}
                      required
                      value={regConfirmPassword}
                      onChange={(e) => {
                        setRegConfirmPassword(e.target.value);
                        setError("");
                      }}
                      placeholder="••••••••"
                      className="w-full pl-9 pr-8 py-2.5 bg-slate-50 hover:bg-slate-100/50 focus:bg-white border border-slate-200 focus:border-[#0b3c7a] rounded-xl text-xs font-medium text-slate-800 transition-all outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegPassword(!showRegPassword)}
                      className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600"
                    >
                      {showRegPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Database Isolation Callout */}
              <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl text-[11px] text-emerald-900 flex items-start gap-2.5">
                <Database className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-bold block">
                    {lang === "en" ? "Isolated Business Database:" : "Pangkalan Data Perniagaan Terasing & Selamat:"}
                  </span>
                  <span className="text-slate-600 block">
                    {lang === "en" 
                      ? "Each account receives a dedicated, private database scope. Data is isolated per user/company."
                      : "Setiap akaun menerima pangkalan data peribadi yang terasing. Data anda dilindungi dan tidak bercampur dengan pengguna lain."}
                  </span>
                </div>
              </div>

              {/* Submit Register Button */}
              <button
                type="submit"
                className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-emerald-900/20 transition-all flex items-center justify-center gap-2 cursor-pointer transform hover:-translate-y-0.5 active:translate-y-0 mt-2"
              >
                <UserPlus className="w-4 h-4" />
                {t.login.registerButton}
              </button>

              {/* Google Sign-In Divider & Button on Register Tab */}
              <div className="relative my-2.5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200"></div>
                </div>
                <div className="relative flex justify-center text-[10px] uppercase font-mono">
                  <span className="bg-white px-2 text-slate-400">
                    {lang === "en" ? "OR REGISTER WITH" : "ATAU DAFTAR DENGAN"}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => handleGoogleSignIn(false)}
                  disabled={isProcessingGoogle}
                  className="w-full py-3 px-4 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl border border-slate-200 hover:border-slate-300 shadow-xs transition-all flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isProcessingGoogle ? (
                    <div className="w-4 h-4 border-2 border-slate-300 border-t-emerald-600 rounded-full animate-spin"></div>
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                    </svg>
                  )}
                  <span>
                    {isProcessingGoogle
                      ? (googleNotice || (lang === "en" ? "Processing Google Registration..." : "Memproses Pendaftaran Google..."))
                      : (lang === "en" ? "Register with Google (Firebase)" : "Daftar dengan Google (Firebase)")}
                  </span>
                </button>

                <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                  <span>{lang === "en" ? "Popup blocked by browser?" : "Popup disekat oleh pelayar?"}</span>
                  <button
                    type="button"
                    onClick={() => handleGoogleSignIn(true)}
                    disabled={isProcessingGoogle}
                    className="text-emerald-700 hover:text-emerald-900 font-bold hover:underline cursor-pointer disabled:opacity-50"
                  >
                    {lang === "en" ? "Register via Redirect" : "Daftar cara Redirect"}
                  </button>
                </div>
              </div>

              <div className="pt-2 text-center">
                <p className="text-[11px] text-slate-400">
                  {t.login.haveAccount}{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setMode("login");
                      setError("");
                      setSuccess("");
                    }}
                    className="text-[#0b3c7a] font-bold hover:underline cursor-pointer"
                  >
                    {t.login.loginNow}
                  </button>
                </p>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Modal Pemilihan Pangkalan Data untuk Emel Pelbagai Akaun */}
      {dbPickerModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-100 space-y-5 animate-scaleUp">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-blue-100 text-[#0b3c7a] flex items-center justify-center border border-blue-200 shrink-0">
                  <Database className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-display font-bold text-slate-900">
                    {lang === "en" ? "Select Company Database" : "Pilih Pangkalan Data Syarikat"}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {lang === "en"
                      ? `Email '${loginEmail}' has ${selectableAccounts.length} accessible databases. Select one to proceed:`
                      : `Emel '${loginEmail}' mempunyai ${selectableAccounts.length} pangkalan data aktif. Sila pilih:`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDbPickerModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {selectableAccounts.map((acc) => (
                <div
                  key={acc.id}
                  className="p-4 rounded-2xl border-2 border-slate-200 hover:border-[#0b3c7a] bg-slate-50/50 hover:bg-blue-50/40 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-[#0b3c7a] shrink-0 mt-0.5 shadow-2xs">
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-slate-900 group-hover:text-[#0b3c7a] transition-colors">
                          {acc.companyName}
                        </h4>
                        <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 text-[10px] font-bold">
                          {ROLE_DEFINITIONS[acc.role || "admin"]?.title || "Admin"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 flex items-center gap-2 font-mono">
                        <span>Username: <strong className="text-slate-800">{acc.username}</strong></span>
                        <span>&bull;</span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(acc.registeredAt).toLocaleDateString()}
                        </span>
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      const chosenDbKey = acc.dbKey || `pengekosan_userdb_${acc.id}`;
                      const chosenCompany = acc.companyName || namaSyarikat;
                      if (auth.currentUser) {
                        const ok = await completeFirebaseLoginWithEdgeFallback(
                          auth.currentUser,
                          {
                            id: acc.id,
                            username: acc.username,
                            fullName: acc.fullName,
                            companyName: chosenCompany,
                            role: acc.role,
                            email: acc.email,
                            dbKey: chosenDbKey,
                          },
                          lang === "en" ? "Session verification failed." : "Pengesahan sesi gagal."
                        );
                        if (ok) {
                          setDbPickerModalOpen(false);
                        }
                        return;
                      }
                      setDbPickerModalOpen(false);
                      onLoginSuccess({
                        id: acc.id,
                        username: acc.username,
                        fullName: acc.fullName,
                        companyName: chosenCompany,
                        role: acc.role || "staf",
                        email: acc.email,
                        dbKey: chosenDbKey,
                      });
                    }}
                    className="px-4 py-2 bg-[#0b3c7a] hover:bg-[#082d5a] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer shrink-0"
                  >
                    <span>{lang === "en" ? "Open Database" : "Buka Database"}</span>
                    <span>&rarr;</span>
                  </button>
                </div>
              ))}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setDbPickerModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                {lang === "en" ? "Cancel" : "Batal"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Discreet Hidden Developer Authentication Modal (Activated via Alt+D or configured alternative) */}
      <DeveloperAuthModal
        isOpen={devSandboxEnabled && secretDevModalOpen}
        onClose={() => setSecretDevModalOpen(false)}
        onSuccess={(user) => {
          setSecretDevModalOpen(false);
          onLoginSuccess(user);
        }}
        lang={lang}
        devEntryEnabled={devSandboxEnabled}
      />

      <div
        className="mt-6 text-slate-500 font-mono text-[10px] uppercase tracking-widest text-center opacity-80 z-10 select-none flex items-center justify-center gap-2"
        title="SMARTCOST"
      >
        <span>&copy; 2026 {namaSyarikat || "SCHOOL ENTERPRISE"} &bull; {lang === "en" ? "All Rights Reserved" : "Hak Cipta Terpelihara"}</span>
      </div>
    </div>
  );
}
