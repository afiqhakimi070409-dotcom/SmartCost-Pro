/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { 
  ShieldCheck, Lock, Users, CheckCircle2, AlertTriangle, 
  FileSpreadsheet, ShieldAlert, X, Edit3, RotateCcw, 
  Check, ToggleLeft, ToggleRight, Sparkles, Sliders,
  Globe, Database
} from "lucide-react";
import { 
  UserRole, 
  RoleDefinition, 
  ROLE_DEFINITIONS, 
  RegisteredUser, 
  getActiveRoleDefinitions, 
  saveActiveRoleDefinitions 
} from "../types";
import { Language, getStoredLanguage, getLocalizedRoleDef } from "../utils/i18n";
import { getAuthFetchHeaders } from "../utils/authSessionClient";
import { apiUrl, getFetchCredentialsMode } from "../utils/apiBase";

interface AccessMatrixModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserRole: UserRole;
  currentUsername: string;
  onRoleChanged?: (newRole: UserRole) => void;
  onUpdateRoleDefinitions?: (defs: Record<UserRole, RoleDefinition>) => void;
  systemLang?: Language;
}

export default function AccessMatrixModal({
  isOpen,
  onClose,
  currentUserRole,
  currentUsername,
  onRoleChanged,
  onUpdateRoleDefinitions,
  systemLang,
}: AccessMatrixModalProps) {
  const lang: Language = systemLang || getStoredLanguage();
  const [users, setUsers] = useState<RegisteredUser[]>([]);
  const [roleDefs, setRoleDefs] = useState<Record<UserRole, RoleDefinition>>(getActiveRoleDefinitions());
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [updateSuccess, setUpdateSuccess] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");
  const [isUpdatingRoleUserId, setIsUpdatingRoleUserId] = useState<string | null>(null);
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    user: RegisteredUser;
    role: UserRole;
  } | null>(null);
  const [reauthPasswordInput, setReauthPasswordInput] = useState<string>("");

  const isAdmin = currentUserRole === "admin" || currentUserRole === "developer";

  useEffect(() => {
    if (!isOpen) {
      setPendingRoleChange(null);
      setReauthPasswordInput("");
      return;
    }

    setRoleDefs(getActiveRoleDefinitions());
    setActionError("");
    setPendingRoleChange(null);
    setReauthPasswordInput("");

    let localUsers: RegisteredUser[] = [];
    try {
      const savedUsers = localStorage.getItem("pengekosan_registered_users");
      if (savedUsers) {
        const parsed = JSON.parse(savedUsers);
        if (Array.isArray(parsed)) {
          localUsers = parsed;
          setUsers(parsed);
        }
      }
    } catch (e) {
      console.error("Failed to read user list:", e);
    }

    if (isAdmin) {
      let cancelled = false;
      (async () => {
        try {
          const headers = await getAuthFetchHeaders();
          const resp = await fetch(apiUrl("/api/admin/users"), {
            credentials: getFetchCredentialsMode(),
            headers,
          });
          if (!resp.ok) return;
          const data = await resp.json().catch(() => null);
          if (cancelled || !Array.isArray(data?.users)) return;

          const existingById = new Map(localUsers.map((u) => [u.id, u]));
          const serverUsers: RegisteredUser[] = data.users.map((su: any) => {
            const prev = existingById.get(su.id);
            return {
              id: su.id,
              username: su.username || prev?.username || "user",
              fullName: su.fullName || prev?.fullName || su.username || (lang === "en" ? "User" : "Pengguna"),
              companyName: su.companyName || prev?.companyName || "ENTERPRISE",
              role: (su.role || prev?.role || "staf") as UserRole,
              email: su.email ?? prev?.email,
              password: "[VERIFIED_SERVER_HASH]",
              dbKey: su.dbKey || prev?.dbKey || "",
              registeredAt: su.createdAt || prev?.registeredAt || new Date().toISOString(),
            };
          });

          setUsers(serverUsers);
          try {
            localStorage.setItem("pengekosan_registered_users", JSON.stringify(serverUsers));
          } catch {}
        } catch (err) {
          console.warn("[AccessMatrix] Failed to sync server user list:", err);
        }
      })();

      return () => {
        cancelled = true;
      };
    }
  }, [isOpen, isAdmin]);

  if (!isOpen) return null;

  const currentRoleDef = getLocalizedRoleDef(currentUserRole, roleDefs[currentUserRole] || ROLE_DEFINITIONS.admin, lang);

  const handleUpdateRole = async (
    userObj: RegisteredUser,
    roleToAssign: UserRole,
    suppliedReauthPassword?: string
  ) => {
    setActionError("");
    if (!isAdmin || (roleToAssign === "developer" && currentUserRole !== "developer")) {
      setActionError(
        lang === "en"
          ? "Only System Administrator (Admin) has authority to reassign roles or access privileges."
          : "Hanya Pentadbir Sistem (Admin) yang mempunyai kuasa untuk mengubah peranan atau hak akses."
      );
      return;
    }

    if (userObj.role === roleToAssign && !suppliedReauthPassword) {
      return;
    }

    setIsUpdatingRoleUserId(userObj.id);
    try {
      const headers = await getAuthFetchHeaders({ "Content-Type": "application/json" });
      const resp = await fetch(apiUrl("/api/admin/users/role"), {
        method: "POST",
        credentials: getFetchCredentialsMode(),
        headers,
        body: JSON.stringify({
          targetUserId: userObj.id,
          newRole: roleToAssign,
          ...(suppliedReauthPassword ? { reauthPassword: suppliedReauthPassword } : {}),
        }),
      });

      const data = await resp.json().catch(() => ({}));

      if (resp.status === 403 && data?.code === "REAUTH_REQUIRED") {
        setPendingRoleChange({ user: userObj, role: roleToAssign });
        setReauthPasswordInput("");
        setActionError(
          lang === "en"
            ? "Please enter your Administrator password below to confirm this role change."
            : "Sila masukkan kata laluan Pentadbir di bawah untuk mengesahkan pertukaran peranan ini."
        );
        return;
      }

      if (!resp.ok || !data?.success) {
        setActionError(
          data?.error ||
            (lang === "en"
              ? "Server rejected the role update request."
              : "Pelayan menolak permintaan kemas kini peranan.")
        );
        return;
      }

      const verifiedNewRole: UserRole = (data?.user?.role || roleToAssign) as UserRole;
      setPendingRoleChange(null);
      setReauthPasswordInput("");

      const updatedUsers = users.map((u) =>
        u.id === userObj.id ? { ...u, role: verifiedNewRole } : u
      );
      setUsers(updatedUsers);
      try {
        localStorage.setItem("pengekosan_registered_users", JSON.stringify(updatedUsers));
      } catch {}

      const localizedAssignedTitle = getLocalizedRoleDef(
        verifiedNewRole,
        roleDefs[verifiedNewRole] || ROLE_DEFINITIONS[verifiedNewRole] || ROLE_DEFINITIONS.staf,
        lang
      ).title;
      setUpdateSuccess(
        lang === "en"
          ? `Role access for '${userObj.fullName} (@${userObj.username})' has been updated to '${localizedAssignedTitle}'!`
          : `Hak akses untuk '${userObj.fullName} (@${userObj.username})' telah dikemas kini kepada '${localizedAssignedTitle}'!`
      );
      setTimeout(() => setUpdateSuccess(""), 4500);

      if (userObj.username.toLowerCase() === currentUsername.toLowerCase() && onRoleChanged) {
        onRoleChanged(verifiedNewRole);
      }
    } catch (err: any) {
      console.error("Failed to update role:", err);
      setActionError(
        lang === "en"
          ? "Unable to reach authentication server to save role update."
          : "Gagal menghubungi pelayan pengesahan untuk menyimpan perubahan peranan."
      );
    } finally {
      setIsUpdatingRoleUserId(null);
    }
  };

  const handleTogglePermission = (
    roleKey: UserRole,
    perm: "canEditDailyData" | "canEditSettings" | "canManageDatabase" | "canApproveTasks" | "canExportReports",
    label: string
  ) => {
    setActionError("");
    if (!isAdmin) {
      setActionError(lang === "en"
        ? "Only System Administrator (Admin) is allowed to modify role functions or permissions."
        : "Hanya Pentadbir Sistem (Admin) yang dibenarkan mengubah fungsi atau hak akses.");
      return;
    }

    // Protect Admin and Developer core permissions
    if (roleKey === "admin" && (perm === "canEditSettings" || perm === "canManageDatabase")) {
      setActionError(lang === "en"
        ? "Administrator (Admin) privileges for Settings and Database Management are protected and cannot be locked."
        : "Hak akses Pentadbir (Admin) untuk Tetapan dan Pengurusan Pangkalan Data dilindungi dan tidak boleh dikunci.");
      return;
    }
    if (roleKey === "developer") {
      setActionError(lang === "en"
        ? "System Developer privileges are absolute to maintain system reliability and integrity."
        : "Hak akses Pembangun Sistem (Developer) adalah mutlak bagi memelihara kestabilan sistem.");
      return;
    }

    const updatedDefs: Record<UserRole, RoleDefinition> = {
      ...roleDefs,
      [roleKey]: {
        ...roleDefs[roleKey],
        [perm]: !roleDefs[roleKey][perm],
      },
    };

    setRoleDefs(updatedDefs);
    saveActiveRoleDefinitions(updatedDefs);
    if (onUpdateRoleDefinitions) {
      onUpdateRoleDefinitions(updatedDefs);
    }

    const newState = updatedDefs[roleKey][perm] 
      ? (lang === "en" ? "allowed (Unlocked)" : "dibenarkan (Boleh)") 
      : (lang === "en" ? "restricted (Locked)" : "disekat (Dikunci)");
    const localizedRoleTitle = getLocalizedRoleDef(roleKey, roleDefs[roleKey], lang).title;
    setUpdateSuccess(
      lang === "en"
        ? `Permission '${label}' for role '${localizedRoleTitle}' is now ${newState}!`
        : `Fungsi '${label}' untuk jawatan '${localizedRoleTitle}' kini telah ${newState}!`
    );
    setTimeout(() => setUpdateSuccess(""), 4000);
  };

  const handleResetToDefaultPermissions = () => {
    if (!isAdmin) return;
    const confirmMsg = lang === "en"
      ? "Are you sure you want to restore all role functions and permissions to organizational default standards?"
      : "Adakah anda pasti mahu memulihkan semua fungsi dan hak akses kepada tetapan asal standard organisasi?";

    if (confirm(confirmMsg)) {
      setRoleDefs(ROLE_DEFINITIONS);
      saveActiveRoleDefinitions(ROLE_DEFINITIONS);
      if (onUpdateRoleDefinitions) {
        onUpdateRoleDefinitions(ROLE_DEFINITIONS);
      }
      setUpdateSuccess(lang === "en"
        ? "All role functions and permissions have been reset to organizational default standards!"
        : "Semua fungsi dan hak akses berjaya dipulihkan kepada tetapan asal standard organisasi!");
      setTimeout(() => setUpdateSuccess(""), 4000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-backdrop">
      <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden flex flex-col max-h-[92vh] animate-modal">
        
        {/* Header */}
        <div className="p-6 bg-linear-to-r from-[#0b3c7a] to-blue-950 text-white flex items-center justify-between border-b border-blue-900/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-sky-400/20 border border-sky-300/30 flex items-center justify-center text-sky-300 shadow-inner">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-display font-bold text-white tracking-tight">
                  {lang === "en"
                    ? "Role-Based Access Control (RBAC) & Security Matrix"
                    : "Matriks Hak Akses & Keselamatan Sistem (RBAC)"}
                </h2>
                {isAdmin ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[10px] font-bold">
                    {lang === "en" ? "Administrator Authority" : "Kuasa Penuh Pentadbir"}
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/40 text-amber-300 text-[10px] font-bold flex items-center gap-1">
                    <Lock className="w-3 h-3" /> {lang === "en" ? "View-Only Mode" : "Mod Bacaan Sahaja"}
                  </span>
                )}
              </div>
              <p className="text-xs text-sky-200 mt-0.5">
                {lang === "en"
                  ? "Organizational role governance. Only Administrator has authority to modify permissions and assign user roles."
                  : "Kawalan keselamatan berasaskan jawatan mengikut standard organisasi. Hanya Admin yang boleh mengubah fungsi & hak akses."}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">

          {/* Current Active User Status Bar */}
          <div className="p-4 bg-slate-900 text-white rounded-2xl border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-md">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600/30 border border-blue-400/40 flex items-center justify-center text-sky-400 shrink-0 font-bold uppercase">
                {currentUsername.charAt(0)}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">{lang === "en" ? "Active Account:" : "Akaun Semasa:"}</span>
                  <strong className="text-sm font-bold text-white">{currentUsername}</strong>
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${currentRoleDef.badgeColor}`}>
                    {currentRoleDef.title}
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-0.5">
                  {lang === "en" ? "Access:" : "Akses:"} <span className="text-sky-300 font-bold">{currentRoleDef.accessLevel}</span> • {lang === "en" ? "Visibility:" : "Mod Paparan:"} <span className="text-slate-200">{currentRoleDef.visibility}</span>
                </p>
              </div>
            </div>

            {/* Admin Exclusive: Quick Role Switcher Tester */}
            {isAdmin ? (
              <div className="flex items-center gap-2 shrink-0 bg-slate-800/80 p-2 rounded-xl border border-slate-700">
                <span className="text-[11px] text-slate-300 font-bold pl-1">{lang === "en" ? "Test Role:" : "Uji Peranan:"}</span>
                <select
                  value={currentUserRole}
                  onChange={(e) => onRoleChanged && onRoleChanged(e.target.value as UserRole)}
                  className="bg-slate-900 text-sky-300 text-xs font-bold px-2.5 py-1.5 rounded-lg border border-slate-600 focus:outline-none cursor-pointer"
                >
                  {Object.entries(roleDefs)
                    .filter(([key]) => currentUserRole === "developer" || key !== "developer")
                    .map(([key, def]) => (
                      <option key={key} value={key}>
                        {getLocalizedRoleDef(key as UserRole, def, lang).title} {key === "developer" ? "★" : ""}
                      </option>
                    ))}
                </select>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/80 rounded-xl border border-slate-700 text-xs text-slate-400">
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                <span>{lang === "en" ? "Permissions managed by Administrator" : "Hak akses ditentukan oleh Admin"}</span>
              </div>
            )}
          </div>

          {/* Non-Admin Security Notice Banner */}
          {!isAdmin && (
            <div className="p-4 bg-amber-50/90 rounded-2xl border border-amber-200/90 text-amber-900 flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-amber-900">
                  {lang === "en" ? "Security Control: Read-Only Mode" : "Kawalan Keselamatan: Akses Dikunci (Mod Paparan Sahaja)"}
                </p>
                <p className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
                  {lang === "en"
                    ? `You are logged in as ${currentRoleDef.title}. Per corporate security policy, only System Administrator (Admin) has authority to reassign roles or modify permission matrices.`
                    : `Anda sedang log masuk sebagai ${currentRoleDef.title}. Mengikut polisi keselamatan syarikat, hanya Pentadbir Sistem (Admin) yang mempunyai kuasa untuk mengubah fungsi atau hak akses jawatan dan pengguna.`}
                </p>
              </div>
            </div>
          )}

          {/* Admin Controls Panel: Toggle Edit Mode & Reset */}
          {isAdmin && (
            <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Sliders className="w-5 h-5 text-[#0b3c7a]" />
                <div>
                  <h4 className="text-xs font-bold text-slate-800">
                    {lang === "en" ? "Administrator Controls: Configure Roles & Permissions" : "Kawalan Pentadbir: Ubah Fungsi & Hak Akses"}
                  </h4>
                  <p className="text-[11px] text-slate-600">
                    {lang === "en"
                      ? "As Administrator, you can configure allowed actions for each role (e.g., unlocking or locking cost edit, settings, and reporting rights)."
                      : "Sebagai Admin, anda boleh mengubah fungsi bagi setiap jawatan (cth: membuka atau mengunci akses edit kos, tetapan, laporan)."}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsEditMode(!isEditMode)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs ${
                    isEditMode
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                      : "bg-[#0b3c7a] hover:bg-[#093163] text-white"
                  }`}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>{isEditMode ? (lang === "en" ? "Finish Editing" : "Selesai Ubah Fungsi") : (lang === "en" ? "Edit Permissions" : "Ubah Fungsi & Hak Akses")}</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetToDefaultPermissions}
                  className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                  title={lang === "en" ? "Reset to Standard Defaults" : "Pulihkan Tetapan Standard Asal"}
                >
                  <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                  <span className="hidden sm:inline">{lang === "en" ? "Reset Defaults" : "Set Semula Default"}</span>
                </button>
              </div>
            </div>
          )}

          {actionError && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 text-xs font-bold flex items-center gap-2 animate-fadeIn">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{actionError}</span>
            </div>
          )}

          {updateSuccess && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs font-bold flex items-center gap-2 animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{updateSuccess}</span>
            </div>
          )}

          {/* Matrix Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-display font-bold text-slate-800 flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-[#0b3c7a]" />
                <span>{lang === "en" ? "Organizational Role Permissions Matrix" : "Matriks Hak Akses Mengikut Jawatan Organisasi"}</span>
              </h3>
              {isEditMode && isAdmin && (
                <span className="px-2.5 py-1 bg-amber-100 text-amber-800 border border-amber-300 rounded-full text-[10px] font-bold animate-pulse">
                  {lang === "en" ? "Edit Mode Active: Click status buttons to toggle permissions" : "Mod Ubah Fungsi Aktif: Klik butang status untuk tukar akses"}
                </span>
              )}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-xs">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-white text-[11px] uppercase tracking-wider font-bold">
                    <th className="p-3.5 border-b border-slate-800">{lang === "en" ? "Role / Position" : "Jawatan"}</th>
                    <th className="p-3.5 border-b border-slate-800">{lang === "en" ? "Access Level" : "Hak Akses"}</th>
                    <th className="p-3.5 border-b border-slate-800">{lang === "en" ? "Visibility" : "Paparan"}</th>
                    <th className="p-3.5 border-b border-slate-800 text-center">{lang === "en" ? "Edit Cost Sheets" : "Edit Lembaran Kos"}</th>
                    <th className="p-3.5 border-b border-slate-800 text-center">{lang === "en" ? "Settings" : "Tetapan"}</th>
                    <th className="p-3.5 border-b border-slate-800 text-center">{lang === "en" ? "Purge Database" : "Padam Pangkalan Data"}</th>
                    <th className="p-3.5 border-b border-slate-800 text-center">{lang === "en" ? "Export Reports" : "Eksport Laporan"}</th>
                    <th className="p-3.5 border-b border-slate-800 text-center">{lang === "en" ? "Approval" : "Kelulusan"}</th>
                    <th className="p-3.5 border-b border-slate-800 text-center bg-slate-800/90 text-cyan-300 font-bold whitespace-nowrap">
                      {lang === "en" ? "Cross-Database Access" : "Akses Merentas Pangkalan Data"}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                  {Object.entries(roleDefs)
                    .filter(([key]) => currentUserRole === "developer" || key !== "developer")
                    .map(([key, def]) => {
                    const roleKey = key as UserRole;
                    const locDef = getLocalizedRoleDef(roleKey, def, lang);
                    const isMyRole = key === currentUserRole;
                    const isRoleAdmin = key === "admin";
                    const isRoleDeveloper = key === "developer";

                    return (
                      <tr 
                        key={key} 
                        className={`transition-colors ${
                          isRoleDeveloper 
                            ? "bg-slate-900/5 hover:bg-slate-900/10" 
                            : isMyRole 
                              ? "bg-blue-50/70 font-medium" 
                              : "hover:bg-slate-50"
                        }`}
                      >
                        
                        {/* Role Title */}
                        <td className="p-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${def.badgeColor}`}>
                              {locDef.title}
                            </span>
                            {isMyRole && (
                              <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white text-[9px] font-bold uppercase">
                                {lang === "en" ? "YOU" : "Anda"}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Access Level */}
                        <td className="p-3.5 font-bold text-slate-900 whitespace-nowrap">
                          {locDef.accessLevel}
                        </td>

                        {/* Visibility */}
                        <td className="p-3.5 text-slate-600 text-[11px] max-w-[220px]">
                          {locDef.visibility}
                        </td>

                        {/* FUNCTION 1: Edit Cost Sheets */}
                        <td className="p-3.5 text-center whitespace-nowrap">
                          {isEditMode && isAdmin && !isRoleDeveloper ? (
                            <button
                              type="button"
                              onClick={() => handleTogglePermission(roleKey, "canEditDailyData", lang === "en" ? "Edit Cost Sheets" : "Edit Lembaran Kos")}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer flex items-center gap-1 mx-auto ${
                                def.canEditDailyData
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100"
                                  : "bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200"
                              }`}
                            >
                              {def.canEditDailyData ? <Check className="w-3 h-3 text-emerald-600" /> : <Lock className="w-3 h-3 text-slate-500" />}
                              <span>{def.canEditDailyData ? (lang === "en" ? "Allowed" : "Boleh") : (lang === "en" ? "Locked" : "Dikunci")}</span>
                            </button>
                          ) : def.canEditDailyData ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-bold text-[10px]">
                              <CheckCircle2 className="w-3.5 h-3.5" /> {lang === "en" ? "Allowed" : "Boleh"}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-slate-400 text-[10px]">
                              <Lock className="w-3.5 h-3.5" /> {lang === "en" ? "Locked" : "Dikunci"}
                            </span>
                          )}
                        </td>

                        {/* FUNCTION 2: Settings */}
                        <td className="p-3.5 text-center whitespace-nowrap">
                          {isEditMode && isAdmin && !isRoleDeveloper && !isRoleAdmin ? (
                            <button
                              type="button"
                              onClick={() => handleTogglePermission(roleKey, "canEditSettings", lang === "en" ? "System Settings" : "Tetapan Sistem")}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer flex items-center gap-1 mx-auto ${
                                def.canEditSettings
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100"
                                  : "bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200"
                              }`}
                            >
                              {def.canEditSettings ? <Check className="w-3 h-3 text-emerald-600" /> : <Lock className="w-3 h-3 text-slate-500" />}
                              <span>{def.canEditSettings ? (lang === "en" ? "Allowed" : "Boleh") : (lang === "en" ? "Locked" : "Dikunci")}</span>
                            </button>
                          ) : def.canEditSettings ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-bold text-[10px]">
                              <CheckCircle2 className="w-3.5 h-3.5" /> {lang === "en" ? "Allowed" : "Boleh"}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-slate-400 text-[10px]">
                              <Lock className="w-3.5 h-3.5" /> {lang === "en" ? "Locked" : "Dikunci"}
                            </span>
                          )}
                        </td>

                        {/* FUNCTION 3: Purge Database */}
                        <td className="p-3.5 text-center whitespace-nowrap">
                          {isEditMode && isAdmin && !isRoleDeveloper && !isRoleAdmin ? (
                            <button
                              type="button"
                              onClick={() => handleTogglePermission(roleKey, "canManageDatabase", lang === "en" ? "Purge Database" : "Padam Pangkalan Data")}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer flex items-center gap-1 mx-auto ${
                                def.canManageDatabase
                                  ? "bg-purple-50 text-purple-700 border-purple-300 hover:bg-purple-100"
                                  : "bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200"
                              }`}
                            >
                              {def.canManageDatabase ? <Check className="w-3 h-3 text-purple-600" /> : <Lock className="w-3 h-3 text-slate-500" />}
                              <span>{def.canManageDatabase ? (lang === "en" ? "Allowed" : "Boleh") : (lang === "en" ? "Locked" : "Dikunci")}</span>
                            </button>
                          ) : isRoleDeveloper ? (
                            <span className="inline-flex items-center gap-1 text-cyan-300 font-bold text-[10px] bg-slate-950 px-2 py-0.5 rounded-full border border-cyan-400 font-mono">
                              <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" /> {lang === "en" ? "Full Purge Authority" : "Kuasa Penuh Pangkalan Data"}
                            </span>
                          ) : def.canManageDatabase ? (
                            <span className="inline-flex items-center gap-1 text-purple-700 font-bold text-[10px] bg-purple-100 px-2 py-0.5 rounded-full border border-purple-300">
                              <CheckCircle2 className="w-3.5 h-3.5 text-purple-600" /> {lang === "en" ? "Allowed (Admin)" : "Boleh (Admin)"}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-slate-400 text-[10px]">
                              <Lock className="w-3.5 h-3.5" /> {lang === "en" ? "Locked" : "Dikunci"}
                            </span>
                          )}
                        </td>

                        {/* FUNCTION 4: Export Reports */}
                        <td className="p-3.5 text-center whitespace-nowrap">
                          {isEditMode && isAdmin && !isRoleDeveloper ? (
                            <button
                              type="button"
                              onClick={() => handleTogglePermission(roleKey, "canExportReports", lang === "en" ? "Export Reports" : "Eksport Laporan")}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer flex items-center gap-1 mx-auto ${
                                def.canExportReports
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100"
                                  : "bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200"
                              }`}
                            >
                              {def.canExportReports ? <Check className="w-3 h-3 text-emerald-600" /> : <Lock className="w-3 h-3 text-slate-500" />}
                              <span>{def.canExportReports ? (lang === "en" ? "Allowed" : "Boleh") : (lang === "en" ? "Locked" : "Dikunci")}</span>
                            </button>
                          ) : def.canExportReports ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-bold text-[10px]">
                              <CheckCircle2 className="w-3.5 h-3.5" /> {lang === "en" ? "Allowed" : "Boleh"}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-slate-400 text-[10px]">
                              <Lock className="w-3.5 h-3.5" /> {lang === "en" ? "Locked" : "Dikunci"}
                            </span>
                          )}
                        </td>

                        {/* FUNCTION 5: Approval */}
                        <td className="p-3.5 text-center whitespace-nowrap">
                          {isEditMode && isAdmin && !isRoleDeveloper ? (
                            <button
                              type="button"
                              onClick={() => handleTogglePermission(roleKey, "canApproveTasks", lang === "en" ? "Task Approval" : "Kelulusan Tugasan")}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer flex items-center gap-1 mx-auto ${
                                def.canApproveTasks
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100"
                                  : "bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200"
                              }`}
                            >
                              {def.canApproveTasks ? <Check className="w-3 h-3 text-emerald-600" /> : <Lock className="w-3 h-3 text-slate-500" />}
                              <span>{def.canApproveTasks ? (lang === "en" ? "Allowed" : "Boleh") : (lang === "en" ? "Locked" : "Dikunci")}</span>
                            </button>
                          ) : def.canApproveTasks ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-bold text-[10px]">
                              <CheckCircle2 className="w-3.5 h-3.5" /> {lang === "en" ? "Allowed" : "Boleh"}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-slate-400 text-[10px]">
                              <Lock className="w-3.5 h-3.5" /> {lang === "en" ? "Locked" : "Dikunci"}
                            </span>
                          )}
                        </td>

                        {/* FUNCTION 6: Cross-Database */}
                        <td className="p-3.5 text-center whitespace-nowrap">
                          {isRoleDeveloper ? (
                            <div className="inline-flex flex-col items-center">
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-950 text-cyan-300 border border-cyan-400 font-mono text-[10px] font-bold shadow-xs">
                                <Globe className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                                <span>{lang === "en" ? "FREE (ISOLATED SANDBOX)" : "BEBAS (SANDBOX TERASING)"}</span>
                              </span>
                              <span className="text-[9px] text-cyan-700 font-bold mt-0.5">
                                {lang === "en" ? "Zero Interference with Live DB" : "Sifar Gangguan Pangkalan Data Lain"}
                              </span>
                            </div>
                          ) : isRoleAdmin ? (
                            <div className="inline-flex flex-col items-center">
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">
                                <Lock className="w-3 h-3 text-rose-500" />
                                <span>{lang === "en" ? "Restricted" : "Disekat"}</span>
                              </span>
                              <span className="text-[9px] text-slate-400 mt-0.5">
                                {lang === "en" ? "Bound to Own Company DB" : "Terikat Pangkalan Data Syarikat Sendiri"}
                              </span>
                            </div>
                          ) : (
                            <div className="inline-flex flex-col items-center">
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-bold">
                                <Lock className="w-3 h-3 text-slate-400" />
                                <span>{lang === "en" ? "Restricted" : "Disekat"}</span>
                              </span>
                              <span className="text-[9px] text-slate-400 mt-0.5">
                                {lang === "en" ? "Bound to Own User Account" : "Terikat Akaun Sendiri"}
                              </span>
                            </div>
                          )}
                        </td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Security Principles Banner */}
          <div className="space-y-3">
            <div className="p-4 bg-linear-to-r from-[#0b3c7a] to-slate-900 text-white rounded-2xl border border-blue-400/30 shadow-sm flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-400/40 flex items-center justify-center text-sky-300 shrink-0 mt-0.5">
                <ShieldCheck className="w-5 h-5 text-sky-300" />
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-white text-xs uppercase tracking-wide">
                    {lang === "en" ? "Multi-Tenant Data Privacy & Partitioning Principle" : "Prinsip Pengasingan Data & Privasi Organisasi (Multi-Tenant Data Privacy)"}
                  </span>
                  <span className="px-2 py-0.5 bg-blue-500/20 text-sky-300 font-mono text-[10px] font-bold rounded-md border border-blue-400/30">
                    {lang === "en" ? "PRIVACY & INTEGRITY ISOLATION" : "ISOLASI PRIVASI & INTEGRITI"}
                  </span>
                </div>
                <p className="text-[11px] text-slate-200 leading-relaxed">
                  {lang === "en"
                    ? "Each company partition is isolated from others. Administrators and personnel only manage data within their own business partition to preserve confidential financial integrity."
                    : "Setiap syarikat dan pengguna terikat secara terasing pada pangkalan data organisasi masing-masing. Pentadbir (Admin) dan kakitangan hanya boleh mengakses dan mengurus maklumat syarikat sendiri bagi memelihara kerahsiaan, privasi, dan integriti data kewangan perniagaan."}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-200/80 text-amber-900 space-y-1">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                  <ShieldAlert className="w-4 h-4 text-amber-600" />
                  <span>{lang === "en" ? "Principle of Least Privilege" : "Asas Akses Minimum (Principle of Least Privilege)"}</span>
                </div>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  {lang === "en"
                    ? "Assign only the minimum required access permissions for daily operational duties to safeguard accounting integrity."
                    : "Hanya berikan akses yang benar-benar diperlukan untuk operasi harian bagi mengelakkan manipulasi atau kerosakan integriti data kewangan."}
                </p>
              </div>

              <div className="p-3.5 bg-sky-50 rounded-2xl border border-sky-200/80 text-sky-900 space-y-1">
                <div className="flex items-center gap-2 text-xs font-bold text-sky-900">
                  <ShieldCheck className="w-4 h-4 text-[#0b3c7a]" />
                  <span>{lang === "en" ? "Administrator Governance" : "Kuasa Pentadbir (Admin Governance)"}</span>
                </div>
                <p className="text-[11px] text-sky-800 leading-relaxed">
                  {lang === "en"
                    ? "Only System Administrator (Admin) is authorized to configure role assignments, toggle permissions, or manage databases."
                    : "Hanya Pentadbir Sistem (Admin) yang dibenarkan melantik peranan, menetapkan had kebenaran fungsi, atau mengasingkan pangkalan data."}
                </p>
              </div>
            </div>
          </div>

          {/* Registered Users & Role Assignment Section */}
          <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#0b3c7a]" />
                  <span>{lang === "en" ? "User Roles & Permissions Assignment" : "Pengurusan Jawatan & Hak Akses Pengguna"}</span>
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {isAdmin
                    ? (lang === "en" ? "As System Administrator (Admin), you can assign or change roles for each user." : "Sebagai Pentadbir Sistem (Admin), anda boleh melantik dan menukar jawatan serta hak akses bagi setiap pengguna.")
                    : (lang === "en" ? "Registered user accounts for this business. Access roles are managed by Administrator." : "Senarai pengguna terdaftar dalam syarikat ini. Hak akses hanya boleh diubah oleh Pentadbir Sistem (Admin).")}
                </p>
              </div>
            </div>

            <div className="divide-y divide-slate-200 bg-white rounded-xl border border-slate-200 overflow-hidden">
              {/* Fallback default admin item shown only if not already present in fetched server user list */}
              {!users.some(
                (u) => (u.username || "").toLowerCase() === "admin" || u.id === "admin-default"
              ) && (
                <div className="p-3.5 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-800 font-bold flex items-center justify-center">
                      A
                    </div>
                    <div>
                      <span className="font-bold text-slate-800">{lang === "en" ? "admin (Default Administrator)" : "admin (Pentadbir Lalai)"}</span>
                      <p className="text-[10px] text-slate-400">{lang === "en" ? "Primary Company Administrator Account" : "Akaun Pentadbir Utama Syarikat"}</p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold border bg-purple-100 text-purple-800 border-purple-300">
                    {getLocalizedRoleDef("admin", ROLE_DEFINITIONS.admin, lang).title}
                  </span>
                </div>
              )}

              {users.filter((u) => currentUserRole === "developer" || u.role !== "developer").length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400">
                  {lang === "en" ? "No other registered accounts found in this company." : "Tiada pengguna terdaftar lain dalam syarikat ini lagi."}
                </div>
              ) : (
                users
                  .filter((u) => currentUserRole === "developer" || u.role !== "developer")
                  .map((u) => {
                  const uRole = u.role || "kerani";
                  const uRoleDef = getLocalizedRoleDef(uRole, roleDefs[uRole] || ROLE_DEFINITIONS.kerani, lang);
                  const isBusy = isUpdatingRoleUserId === u.id;

                  return (
                    <div key={u.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:bg-slate-50">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 font-bold flex items-center justify-center">
                          {(u.fullName || u.username || "U").charAt(0)}
                        </div>
                        <div>
                          <span className="font-bold text-slate-800">{u.fullName}</span>
                          <span className="text-[10px] text-slate-400 ml-2">(@{u.username})</span>
                          {u.email && <span className="text-[10px] text-sky-600 ml-1.5 font-medium">[{u.email}]</span>}
                          <p className="text-[10px] text-slate-500">{u.companyName || (lang === "en" ? "Enterprise" : "Perniagaan")}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isAdmin ? (
                          <select
                            value={uRole}
                            disabled={isBusy}
                            onChange={(e) => handleUpdateRole(u, e.target.value as UserRole)}
                            className="bg-white text-slate-800 text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0b3c7a] cursor-pointer disabled:opacity-50"
                          >
                            {Object.entries(roleDefs)
                              .filter(([key]) => currentUserRole === "developer" || key !== "developer")
                              .map(([key, def]) => (
                                <option key={key} value={key}>
                                  {getLocalizedRoleDef(key as UserRole, def, lang).title} {key === "developer" ? "★" : ""}
                                </option>
                              ))}
                          </select>
                        ) : (
                          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${uRoleDef.badgeColor}`}>
                            {uRoleDef.title}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {pendingRoleChange && (() => {
              const pendingRoleTitle = getLocalizedRoleDef(
                pendingRoleChange.role,
                roleDefs[pendingRoleChange.role] || ROLE_DEFINITIONS[pendingRoleChange.role] || ROLE_DEFINITIONS.staf,
                lang
              ).title;
              return (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2.5 animate-fadeIn">
                <p className="text-xs font-bold text-amber-900">
                  {lang === "en"
                    ? `Confirm role change for @${pendingRoleChange.user.username} → ${pendingRoleTitle}`
                    : `Sahkan pertukaran peranan untuk @${pendingRoleChange.user.username} → ${pendingRoleTitle}`}
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="password"
                    value={reauthPasswordInput}
                    onChange={(e) => setReauthPasswordInput(e.target.value)}
                    placeholder={lang === "en" ? "Enter current Admin password" : "Masukkan kata laluan Admin semasa"}
                    className="flex-1 px-3 py-2 text-xs bg-white border border-amber-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#0b3c7a]"
                  />
                  <button
                    type="button"
                    disabled={!reauthPasswordInput || isUpdatingRoleUserId === pendingRoleChange.user.id}
                    onClick={() => handleUpdateRole(pendingRoleChange.user, pendingRoleChange.role, reauthPasswordInput)}
                    className="px-4 py-2 bg-[#0b3c7a] hover:bg-[#093163] disabled:opacity-50 text-white text-xs font-bold rounded-lg cursor-pointer"
                  >
                    {lang === "en" ? "Confirm" : "Sahkan"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingRoleChange(null);
                      setReauthPasswordInput("");
                      setActionError("");
                    }}
                    className="px-3 py-2 bg-white border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    {lang === "en" ? "Cancel" : "Batal"}
                  </button>
                </div>
              </div>
              );
            })()}
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-between items-center shrink-0">
          <p className="text-[11px] text-slate-500">
            {isAdmin 
              ? (lang === "en" ? "✓ You possess Administrator authority to configure role permissions." : "✓ Anda mempunyai kebenaran Pentadbir untuk mengubah fungsi dan hak akses.")
              : (lang === "en" ? "🔒 View-Only Mode: Contact System Administrator if role modification is required." : "🔒 Mod Bacaan: Hubungi Pentadbir Sistem (Admin) jika anda memerlukan pertukaran peranan.")}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl cursor-pointer transition-all shadow-xs"
          >
            {lang === "en" ? "Close" : "Tutup"}
          </button>
        </div>

      </div>
    </div>
  );
}
