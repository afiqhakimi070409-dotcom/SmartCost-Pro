/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Discreet Developer Authentication Modal
 * - Compact SmartCost dark-blue (#061830 / #0b3c7a) & white design
 * - Server-verified credential check via /api/auth/session-dev
 * - Never auto-authenticates, never exposes developer credentials or username existence
 */

import React, { useState, useEffect, useRef } from "react";
import { Lock, AlertCircle, X, ShieldCheck } from "lucide-react";
import { Language } from "../utils/i18n";
import { saveServerSessionToken, getAuthFetchHeaders } from "../utils/authSessionClient";
import { apiUrl } from "../utils/apiBase";
import { UserRole } from "../types";

export interface DeveloperAuthSuccessPayload {
  id?: string;
  username: string;
  fullName: string;
  companyName?: string;
  role: UserRole;
  email?: string;
  dbKey?: string;
  freshReauthNonce?: string;
  reauthExpiresAt?: number;
}

interface DeveloperAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: DeveloperAuthSuccessPayload) => void;
  lang: Language;
  devEntryEnabled?: boolean;
  mode?: "login" | "reauth" | "refresh";
  zIndexClass?: string;
}

export default function DeveloperAuthModal({
  isOpen,
  onClose,
  onSuccess,
  lang,
  devEntryEnabled = true,
  mode = "login",
  zIndexClass = "z-50",
}: DeveloperAuthModalProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [requires2FA, setRequires2FA] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setError("");
      setPassword("");
      setTotpCode("");
      setRequires2FA(false);
      setIsSubmitting(false);
      setTimeout(() => {
        usernameInputRef.current?.focus();
      }, 30);
    } else {
      setUsername("");
      setPassword("");
      setTotpCode("");
      setRequires2FA(false);
      setError("");
      setIsSubmitting(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen || !devEntryEnabled) return null;

  const uniformCredError =
    lang === "en"
      ? "Incorrect username or password."
      : "Nama pengguna atau kata laluan tidak betul.";

  const emptyUsernameMessage =
    lang === "en"
      ? "Please enter your username."
      : "Sila masukkan nama pengguna.";

  const emptyPasswordMessage =
    lang === "en"
      ? "Please enter your password."
      : "Sila masukkan kata laluan.";

  const lockoutMessage =
    lang === "en"
      ? "Too many attempts. Please try again in a few minutes."
      : "Terlalu banyak percubaan. Cuba lagi dalam beberapa minit.";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    // Read both React state and DOM input values to support browser password-manager autofill
    const domUsername = usernameInputRef.current?.value ?? "";
    const domPassword = passwordInputRef.current?.value ?? "";
    const rawUser = (username || domUsername).trim();
    const rawPass = password || domPassword;

    if (domUsername && !username) {
      setUsername(domUsername);
    }
    if (domPassword && !password) {
      setPassword(domPassword);
    }

    if (!rawUser) {
      setError(emptyUsernameMessage);
      usernameInputRef.current?.focus();
      return;
    }

    if (!rawPass) {
      setError(emptyPasswordMessage);
      passwordInputRef.current?.focus();
      return;
    }

    const cleanUser = rawUser.toLowerCase();
    setError("");
    setIsSubmitting(true);

    try {
      if (mode === "reauth") {
        const headers = await getAuthFetchHeaders({ "Content-Type": "application/json" });
        const resp = await fetch(apiUrl("/api/auth/reauthenticate"), {
          method: "POST",
          credentials: "same-origin",
          headers,
          body: JSON.stringify({
            username: cleanUser,
            password: rawPass,
          }),
        });

        const data = await resp.json().catch(() => ({}));

        if (resp.ok && data.success) {
          if (data.sessionToken || data.csrfToken) {
            saveServerSessionToken(data.sessionToken, data.csrfToken);
          }
          setPassword("");
          setUsername("");
          onSuccess({
            username: cleanUser,
            fullName: "System Developer",
            role: "developer",
            freshReauthNonce: data.freshReauthNonce,
            reauthExpiresAt: data.reauthExpiresAt,
          });
          return;
        }

        // If the server session expired cleanly, recover by re-establishing & reauth-stamping via session-dev
        if (resp.status === 401 && data?.code === "SESSION_EXPIRED") {
          const refreshResp = await fetch(apiUrl("/api/auth/session-dev"), {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: cleanUser,
              passkey: rawPass,
              stampReauth: true,
            }),
          });
          const refreshData = await refreshResp.json().catch(() => ({}));
          if (refreshResp.ok && refreshData.success && refreshData.user && refreshData.user.role === "developer") {
            saveServerSessionToken(refreshData.sessionToken, refreshData.csrfToken);
            setPassword("");
            setUsername("");
            onSuccess({
              id: refreshData.user.id,
              username: refreshData.user.username,
              fullName: refreshData.user.fullName || "System Developer",
              companyName: refreshData.user.companyName || "DEVELOPER SANDBOX",
              role: "developer",
              email: refreshData.user.email,
              dbKey: refreshData.user.dbKey || "pengekosan_dev_sandbox_db",
              freshReauthNonce: refreshData.freshReauthNonce,
              reauthExpiresAt: refreshData.reauthExpiresAt,
            });
            return;
          }
          if (refreshResp.status === 429) {
            setError(refreshData?.error || lockoutMessage);
            return;
          }
          setError(refreshData?.error || uniformCredError);
          return;
        }

        if (resp.status === 429 || data?.code === "LOCKED") {
          setError(data?.error || lockoutMessage);
          return;
        }

        if (resp.status === 400 && data?.code === "USERNAME_EMPTY") {
          setError(data?.error || emptyUsernameMessage);
          usernameInputRef.current?.focus();
          return;
        }

        if (resp.status >= 500) {
          setError(data?.error || (lang === "en" ? "Authentication service error. Please try again." : "Ralat pelayan semasa pengesahan. Sila cuba lagi."));
          return;
        }

        setError(
          data?.error ||
            (lang === "en"
              ? "Developer authentication failed."
              : "Pengesahan pembangun gagal.")
        );
        return;
      }

      const resp = await fetch(apiUrl("/api/auth/session-dev"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: cleanUser,
          passkey: rawPass,
          ...(totpCode.trim() ? { totpCode: totpCode.trim() } : {}),
          ...(mode === "refresh" ? { stampReauth: true } : {}),
        }),
      });

      const data = await resp.json().catch(() => ({}));

      if (
        resp.status === 401 &&
        (data?.code === "TWO_FACTOR_REQUIRED" || data?.code === "INVALID_TWO_FACTOR_CODE")
      ) {
        setRequires2FA(true);
        setError(data?.error || (lang === "en" ? "Enter your 6-digit 2FA code." : "Masukkan kod pengesahan 2FA 6-digit."));
        return;
      }

      if (resp.ok && data.success && data.user && data.user.role === "developer") {
        saveServerSessionToken(data.sessionToken, data.csrfToken);
        setPassword("");
        setUsername("");
        setTotpCode("");
        setRequires2FA(false);
        onSuccess({
          id: data.user.id,
          username: data.user.username,
          fullName: data.user.fullName || "System Developer",
          companyName: data.user.companyName || "DEVELOPER SANDBOX",
          role: "developer",
          email: data.user.email,
          dbKey: data.user.dbKey || "pengekosan_dev_sandbox_db",
          freshReauthNonce: data.freshReauthNonce,
          reauthExpiresAt: data.reauthExpiresAt,
        });
        return;
      }

      if (resp.status === 429) {
        setError(data?.error || lockoutMessage);
        return;
      }

      if (resp.status === 400) {
        setError(data?.error || emptyUsernameMessage);
        return;
      }

      setError(data?.error || uniformCredError);
    } catch {
      setError(uniformCredError);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 ${zIndexClass} bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dev-auth-modal-title"
    >
      <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden animate-scaleIn">
        {/* Compact Dark-Blue Header matching SmartCost theme */}
        <div className="px-5 py-4 bg-linear-to-r from-[#061830] to-[#0b3c7a] text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-sky-300 shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <h3 id="dev-auth-modal-title" className="text-sm font-display font-bold tracking-tight text-white">
              {lang === "en" ? "Developer Authentication" : "Pengesahan Pembangun"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={lang === "en" ? "Cancel" : "Batal"}
            className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Clean White Form Body */}
        <form onSubmit={handleSubmit} noValidate className="p-5 space-y-3.5 bg-white">
          {mode === "refresh" && !error && (
            <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-medium flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                {lang === "en"
                  ? "Developer session has expired. Please re-authenticate to continue."
                  : "Sesi pembangun telah tamat tempoh. Sila sahkan semula untuk meneruskan."}
              </span>
            </div>
          )}

          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-medium flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label
              htmlFor="dev-auth-username"
              className="block text-[10px] font-mono tracking-widest text-slate-500 uppercase mb-1.5 font-semibold"
            >
              {lang === "en" ? "Developer Username" : "Nama Pengguna Pembangun"}
            </label>
            <input
              id="dev-auth-username"
              name="username"
              ref={usernameInputRef}
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (error) setError("");
              }}
              placeholder={lang === "en" ? "Enter username" : "Masukkan nama pengguna"}
              className="w-full px-3.5 py-2.5 bg-slate-50 hover:bg-slate-100/60 focus:bg-white border border-slate-200 focus:border-[#0b3c7a] rounded-xl text-xs sm:text-sm font-medium text-slate-800 transition-all outline-hidden"
            />
          </div>

          <div>
            <label
              htmlFor="dev-auth-password"
              className="block text-[10px] font-mono tracking-widest text-slate-500 uppercase mb-1.5 font-semibold"
            >
              {lang === "en" ? "Developer Password" : "Kata Laluan Pembangun"}
            </label>
            <input
              id="dev-auth-password"
              name="password"
              ref={passwordInputRef}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError("");
              }}
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 bg-slate-50 hover:bg-slate-100/60 focus:bg-white border border-slate-200 focus:border-[#0b3c7a] rounded-xl text-xs sm:text-sm font-medium text-slate-800 transition-all outline-hidden"
            />
          </div>

          {requires2FA && (
            <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl space-y-1.5">
              <label
                htmlFor="dev-auth-totp"
                className="block text-[10px] font-mono tracking-widest text-[#0b3c7a] uppercase font-bold"
              >
                {lang === "en" ? "2FA Code (6 Digits)" : "Kod 2FA (6 Digit)"}
              </label>
              <input
                id="dev-auth-totp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={totpCode}
                onChange={(e) => {
                  setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  if (error) setError("");
                }}
                placeholder="000000"
                className="w-full px-3 py-2 bg-white border border-sky-300 focus:border-[#0b3c7a] rounded-xl text-sm font-mono font-bold tracking-[0.3em] text-center text-slate-900 outline-hidden"
                autoFocus
              />
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer disabled:opacity-60"
            >
              {lang === "en" ? "Cancel" : "Batal"}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-[#0b3c7a] hover:bg-[#082d5a] text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <Lock className="w-3.5 h-3.5" />
              )}
              <span>{lang === "en" ? "Authenticate" : "Sahkan"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
