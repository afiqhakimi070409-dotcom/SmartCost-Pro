/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SmartCost — 10 Essential UI States Design System
 * Inspired by strategyfox principles:
 * 01. Empty state: say why it is empty, then give one next step.
 * 02. Loading state: show the shape of what is coming, not a spinner.
 * 03. Error state: what went wrong, whose fault, and how to fix it.
 * 04. No internet: keep cached content on screen, say what still works.
 * 05. Slow network: show real progress and offer a lighter path.
 * 06. No search results: fix typo / suggest keywords and clear search.
 * 07. Permission denied: explain why and give a way back.
 * 08. Session expired: save their work before signing them out.
 * 09. Form validation: flag exact field inline with how to fix it.
 * 10. Success state: confirm, reassure, then show what is next.
 */

import React, { useState, useEffect } from "react";
import {
  PackageOpen,
  Plus,
  RefreshCw,
  AlertTriangle,
  WifiOff,
  Wifi,
  Clock,
  Search,
  Lock,
  CheckCircle2,
  XCircle,
  ArrowRight,
  ShieldAlert,
  ArrowLeft,
  X,
  FileText,
  Info
} from "lucide-react";
import { getStoredLanguage, getTranslation, tr, type Language } from "../utils/i18n";

// ============================================================================
// STATE 01: EMPTY STATE
// Purpose: Say why it is empty, then give one clear next step.
// ============================================================================
export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  className = "",
}) => {
  return (
    <div
      className={`p-8 sm:p-12 text-center rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 flex flex-col items-center justify-center animate-fadeIn ${className}`}
    >
      <div className="w-16 h-16 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-xs flex items-center justify-center text-[#0b3c7a] dark:text-sky-400 mb-4">
        {icon || <PackageOpen className="w-8 h-8 stroke-[1.5]" />}
      </div>
      <h3 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white tracking-tight mb-2">
        {title}
      </h3>
      <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-6 leading-relaxed">
        {description}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="px-4 py-2.5 bg-[#0b3c7a] hover:bg-[#093163] text-white text-xs font-semibold rounded-[10px] shadow-xs hover:shadow transition-all flex items-center gap-2 cursor-pointer min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>{actionLabel}</span>
          </button>
        )}
        {secondaryActionLabel && onSecondaryAction && (
          <button
            type="button"
            onClick={onSecondaryAction}
            className="px-4 py-2.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-xl transition-all cursor-pointer"
          >
            {secondaryActionLabel}
          </button>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// STATE 02: LOADING STATE (SKELETON)
// Purpose: Show the shape of what is coming, not a blank screen or raw spinner.
// ============================================================================
export interface SkeletonLoaderProps {
  type?: "cards" | "table" | "chart" | "sheet" | "dashboard";
  count?: number;
  className?: string;
}

export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  type = "cards",
  count = 4,
  className = "",
}) => {
  if (type === "cards") {
    return (
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse ${className}`}>
        {Array.from({ length: count }).map((_, idx) => (
          <div
            key={idx}
            className="p-5 bg-white dark:bg-[#0f1d32] border border-slate-200 dark:border-slate-800 rounded-2xl space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="h-3 w-20 bg-slate-200 dark:bg-slate-800 rounded-md"></div>
              <div className="w-8 h-8 rounded-xl bg-slate-200 dark:bg-slate-800"></div>
            </div>
            <div className="h-7 w-32 bg-slate-200 dark:bg-slate-800 rounded-lg"></div>
            <div className="h-2.5 w-24 bg-slate-100 dark:bg-slate-800/60 rounded-md"></div>
          </div>
        ))}
      </div>
    );
  }

  if (type === "table") {
    return (
      <div className={`bg-white dark:bg-[#0f1d32] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden animate-pulse ${className}`}>
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="h-4 w-36 bg-slate-200 dark:bg-slate-800 rounded-md"></div>
          <div className="h-8 w-24 bg-slate-200 dark:bg-slate-800 rounded-xl"></div>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {Array.from({ length: count }).map((_, idx) => (
            <div key={idx} className="p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1">
                <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-800 shrink-0"></div>
                <div className="space-y-1.5 flex-1">
                  <div className="h-3.5 w-44 bg-slate-200 dark:bg-slate-800 rounded-md"></div>
                  <div className="h-2.5 w-28 bg-slate-100 dark:bg-slate-800/60 rounded-md"></div>
                </div>
              </div>
              <div className="h-4 w-16 bg-slate-200 dark:bg-slate-800 rounded-md"></div>
              <div className="h-4 w-20 bg-slate-200 dark:bg-slate-800 rounded-md"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // General sheet skeleton
  return (
    <div className={`space-y-4 animate-pulse ${className}`}>
      <div className="h-24 bg-slate-200 dark:bg-slate-800 rounded-2xl w-full"></div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="h-48 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        <div className="h-48 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        <div className="h-48 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
      </div>
    </div>
  );
};

// ============================================================================
// STATE 03: ERROR STATE
// Purpose: Say what went wrong, whose fault, and how to fix it.
// ============================================================================
export interface ErrorStateCardProps {
  title?: string;
  message: string;
  fault?: "user" | "network" | "server" | "permission";
  onRetry?: () => void;
  onDismiss?: () => void;
  technicalDetails?: string;
  className?: string;
  lang?: Language;
}

export const ErrorStateCard: React.FC<ErrorStateCardProps> = ({
  title,
  message,
  fault = "network",
  onRetry,
  onDismiss,
  technicalDetails,
  className = "",
  lang,
}) => {
  const [showTechnical, setShowTechnical] = useState(false);
  const t = getTranslation(lang || getStoredLanguage()).uiStates;

  const faultLabel = {
    user: t.faultUser,
    network: t.faultNetwork,
    server: t.faultServer,
    permission: t.faultPermission,
  }[fault];

  return (
    <div
      className={`p-5 rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/90 dark:bg-rose-950/40 text-slate-800 dark:text-rose-100 space-y-3 animate-fadeIn ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-rose-100 dark:bg-rose-900/60 text-rose-600 dark:text-rose-300 flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-display font-bold text-sm text-rose-900 dark:text-rose-200 uppercase tracking-tight">
              {title || t.errorTitle}
            </h4>
            <p className="text-xs text-rose-700 dark:text-rose-300/90 mt-1 leading-relaxed">
              {message}
            </p>
            <p className="text-[11px] font-mono text-rose-600/80 dark:text-rose-400/80 mt-1">
              {t.causePrefix} {faultLabel}
            </p>
          </div>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-rose-400 hover:text-rose-600 dark:hover:text-rose-200 p-1 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-rose-200/60 dark:border-rose-900/40">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold tracking-wider uppercase flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t.retry}</span>
          </button>
        )}
        {technicalDetails && (
          <button
            type="button"
            onClick={() => setShowTechnical(!showTechnical)}
            className="text-[11px] text-rose-700 dark:text-rose-300 underline cursor-pointer hover:opacity-80"
          >
            {showTechnical ? t.hideLog : t.showLog}
          </button>
        )}
      </div>

      {showTechnical && technicalDetails && (
        <pre className="p-3 bg-white/80 dark:bg-black/40 rounded-xl text-[10px] font-mono text-slate-700 dark:text-slate-300 overflow-x-auto border border-rose-200 dark:border-rose-900">
          {technicalDetails}
        </pre>
      )}
    </div>
  );
};

// ============================================================================
// STATE 04: NO INTERNET (OFFLINE)
// ============================================================================
export interface NoInternetBannerProps {
  isOffline?: boolean;
  onRetry?: () => void;
  onRetryConnection?: () => void;
  lang?: Language;
}

export const NoInternetBanner: React.FC<NoInternetBannerProps> = ({
  isOffline = true,
  onRetry,
  onRetryConnection,
  lang,
}) => {
  const handleRetry = onRetry || onRetryConnection;
  if (!isOffline) return null;
  const t = getTranslation(lang || getStoredLanguage()).uiStates;

  return (
    <div className="sticky top-0 z-50 w-full bg-slate-900 text-white border-b border-amber-500/40 px-4 py-2.5 shadow-lg animate-slideDown flex items-center justify-between gap-3 text-xs">
      <div className="flex items-center gap-2.5">
        <span className="p-1 rounded-md bg-amber-500/20 text-amber-400 shrink-0">
          <WifiOff className="w-4 h-4" />
        </span>
        <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2">
          <span className="font-bold text-amber-300 uppercase tracking-wide text-[11px]">
            {t.offlineTitle}
          </span>
          <span className="text-slate-300 text-[11px]">
            {t.offlineDesc}
          </span>
        </div>
      </div>
      {handleRetry && (
        <button
          type="button"
          onClick={handleRetry}
          className="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-400/40 rounded-lg font-bold text-[10px] uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shrink-0"
        >
          <RefreshCw className="w-3 h-3" />
          <span>{t.checkConnection}</span>
        </button>
      )}
    </div>
  );
};

// ============================================================================
// STATE 05: SLOW NETWORK
// ============================================================================
export interface SlowNetworkNoticeProps {
  isSlow?: boolean;
  progress?: number;
  progressPercent?: number;
  operationLabel?: string;
  onUseOffline?: () => void;
  onContinueOffline?: () => void;
  onDismiss?: () => void;
  lang?: Language;
}

export const SlowNetworkNotice: React.FC<SlowNetworkNoticeProps> = ({
  isSlow = true,
  progress,
  progressPercent = 65,
  operationLabel,
  onUseOffline,
  onContinueOffline,
  onDismiss,
  lang,
}) => {
  const pct = progress !== undefined ? progress : progressPercent;
  const handleOffline = onUseOffline || onContinueOffline;
  if (!isSlow) return null;
  const t = getTranslation(lang || getStoredLanguage()).uiStates;
  const effectiveOpLabel = operationLabel || t.slowNetworkDefaultLabel;

  return (
    <div className="p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 rounded-2xl text-amber-900 dark:text-amber-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fadeIn my-2">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
          <Clock className="w-4 h-4 animate-spin" />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-bold">
            <span>{t.slowNetworkTitle}</span>
            <span className="font-mono text-[10px] bg-amber-200/70 dark:bg-amber-900/70 px-1.5 py-0.5 rounded">
              {pct}%
            </span>
          </div>
          <p className="text-[11px] text-amber-800 dark:text-amber-300/80">
            {effectiveOpLabel} {t.slowNetworkWaitSuffix}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {handleOffline && (
          <button
            type="button"
            onClick={handleOffline}
            className="px-3 py-1.5 bg-white dark:bg-slate-800 text-[#0b3c7a] dark:text-sky-300 border border-amber-300 dark:border-amber-700 text-xs font-bold rounded-lg cursor-pointer hover:bg-amber-100/50"
          >
            {t.continueWithoutWaiting}
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="p-1 text-amber-600 dark:text-amber-400 hover:text-amber-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// STATE 06: NO SEARCH RESULTS
// Purpose: Fix typo for them and suggest next search.
// ============================================================================
export interface NoSearchResultsProps {
  searchTerm: string;
  onClearSearch: () => void;
  onSelectSuggestion?: (term: string) => void;
  suggestions?: string[];
  compact?: boolean;
  lang?: Language;
}

export const NoSearchResults: React.FC<NoSearchResultsProps> = ({
  searchTerm,
  onClearSearch,
  onSelectSuggestion,
  suggestions,
  compact = false,
  lang,
}) => {
  const effectiveLang = lang || getStoredLanguage();
  const t = getTranslation(effectiveLang).uiStates;
  const effectiveSuggestions =
    suggestions ?? (effectiveLang === "en" ? ["Rolls", "Cake", "Bread", "Sauce", "Chicken"] : ["Popia", "Kek", "Roti", "Sos", "Ayam"]);

  return (
    <div className={`${compact ? "p-4 sm:p-6" : "p-8"} text-center rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1d32] space-y-4 animate-fadeIn`}>
      <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 mx-auto flex items-center justify-center">
        <Search className="w-6 h-6" />
      </div>
      <div>
        <h4 className="font-display font-bold text-sm text-slate-800 dark:text-white uppercase tracking-tight">
          {t.noResultsFor} &ldquo;<span className="text-[#0b3c7a] dark:text-sky-400">{searchTerm}</span>&rdquo;
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
          {t.noResultsDesc}
        </p>
      </div>

      {effectiveSuggestions && effectiveSuggestions.length > 0 && (
        <div className="pt-2">
          <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-2">
            {t.suggestedKeywords}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {effectiveSuggestions.map((sug) => (
              <button
                key={sug}
                type="button"
                onClick={() => onSelectSuggestion && onSelectSuggestion(sug)}
                className="px-2.5 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-[#0b3c7a] hover:text-white transition-all cursor-pointer"
              >
                {sug}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={onClearSearch}
          className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold uppercase rounded-xl transition-all cursor-pointer"
        >
          {t.clearSearch}
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// STATE 07: PERMISSION DENIED
// ============================================================================
export interface PermissionDeniedProps {
  userRole?: string;
  roleName?: string;
  requiredRole?: string;
  requiredPermission?: string;
  onGoBack?: () => void;
  onReturnToDashboard?: () => void;
  lang?: Language;
}

export const PermissionDenied: React.FC<PermissionDeniedProps> = ({
  userRole = "staf",
  roleName,
  requiredRole = "admin",
  requiredPermission,
  onGoBack,
  onReturnToDashboard,
  lang,
}) => {
  const effectiveLang = lang || getStoredLanguage();
  const t = getTranslation(effectiveLang).uiStates;
  const currentRole = roleName || userRole;
  const targetRole = requiredPermission || requiredRole;
  const handleBack = onGoBack || onReturnToDashboard || (() => {});

  return (
    <div className="p-8 sm:p-12 text-center rounded-3xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 max-w-lg mx-auto space-y-5 animate-scaleUp">
      <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 mx-auto flex items-center justify-center">
        <Lock className="w-7 h-7" />
      </div>
      <div className="space-y-1.5">
        <h3 className="font-display font-black text-lg text-amber-950 dark:text-amber-200 uppercase tracking-tight">
          {t.permissionDeniedTitle}
        </h3>
        <p className="text-xs sm:text-sm text-amber-800 dark:text-amber-300/90 leading-relaxed">
          {tr(effectiveLang, "uiStates.permissionDeniedBody", {
            required: targetRole.toUpperCase(),
            current: currentRole.toUpperCase(),
          })}
        </p>
      </div>
      <div className="p-3 bg-white/80 dark:bg-black/30 rounded-xl text-left border border-amber-200/80 dark:border-amber-900/80 text-[11px] space-y-1 text-slate-600 dark:text-slate-400">
        <p className="font-semibold text-slate-800 dark:text-slate-200">{t.howToGetAccessTitle}</p>
        <p>{t.howToGetAccessDesc}</p>
      </div>
      <div>
        <button
          type="button"
          onClick={handleBack}
          className="px-6 py-3 bg-[#0b3c7a] hover:bg-[#093163] text-white rounded-xl font-bold text-xs uppercase tracking-wider shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 mx-auto cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{t.backToDashboard}</span>
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// STATE 08: SESSION EXPIRED
// ============================================================================
export interface SessionExpiredModalProps {
  isOpen?: boolean;
  onReLogin?: () => void;
  onLoginAgain?: () => void;
  lang?: Language;
}

export const SessionExpiredModal: React.FC<SessionExpiredModalProps> = ({
  isOpen = true,
  onReLogin,
  onLoginAgain,
  lang,
}) => {
  const handleLogin = onReLogin || onLoginAgain || (() => {});
  if (!isOpen) return null;
  const t = getTranslation(lang || getStoredLanguage()).uiStates;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-white dark:bg-[#0f1d32] rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl border border-slate-200 dark:border-slate-800 text-center space-y-5 animate-scaleUp">
        <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-900/40 text-[#0b3c7a] dark:text-sky-300 mx-auto flex items-center justify-center">
          <Clock className="w-7 h-7" />
        </div>
        <div className="space-y-1.5">
          <h3 className="font-display font-black text-lg text-slate-800 dark:text-white uppercase tracking-tight">
            {t.sessionExpiredTitle}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {t.sessionExpiredDesc}
          </p>
        </div>
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 rounded-2xl text-[11px] text-emerald-800 dark:text-emerald-200 flex items-center gap-2.5 text-left">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>
            <strong>{t.draftSafePrefix}</strong> {t.draftSafeDesc}
          </span>
        </div>
        <button
          type="button"
          onClick={handleLogin}
          className="w-full py-3.5 bg-[#0b3c7a] hover:bg-[#093163] text-white rounded-xl font-bold text-xs uppercase tracking-wider shadow-lg shadow-blue-900/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          <span>{t.reLoginContinue}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// STATE 09: FORM VALIDATION
// ============================================================================
export interface FormFieldValidationProps {
  label?: string;
  error?: string;
  isValid?: boolean;
  required?: boolean;
  helperText?: string;
  successMessage?: string;
  children?: React.ReactNode;
  lang?: Language;
}

export const FormFieldValidation: React.FC<FormFieldValidationProps> = ({
  label,
  error,
  isValid,
  required,
  helperText,
  successMessage,
  children,
  lang,
}) => {
  const t = getTranslation(lang || getStoredLanguage()).uiStates;
  if (!children) {
    if (error) {
      return (
        <p className="text-[10px] text-rose-600 dark:text-rose-400 flex items-center gap-1 font-medium animate-fadeIn mt-0.5">
          <XCircle className="w-3 h-3 shrink-0" />
          <span>{error}</span>
        </p>
      );
    }
    if (isValid) {
      return (
        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium animate-fadeIn mt-0.5">
          <CheckCircle2 className="w-3 h-3 shrink-0" />
          <span>{successMessage || t.validBadge}</span>
        </p>
      );
    }
    return null;
  }

  return (
    <div className="space-y-1">
      {label && (
        <div className="flex items-center justify-between">
          <label className="block text-[10px] font-mono tracking-widest text-slate-500 dark:text-slate-400 uppercase font-semibold">
            {label} {required && <span className="text-rose-500">*</span>}
          </label>
          {isValid && (
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1 animate-fadeIn">
              <CheckCircle2 className="w-3 h-3" />
              <span>{t.validBadge}</span>
            </span>
          )}
        </div>
      )}

      <div className="relative">{children}</div>

      {error ? (
        <p className="text-[11px] text-rose-600 dark:text-rose-400 flex items-center gap-1 font-medium animate-fadeIn">
          <XCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : helperText ? (
        <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
          {helperText}
        </p>
      ) : null}
    </div>
  );
};

// ============================================================================
// STATE 10: SUCCESS STATE
// Purpose: Confirm, reassure, then show what happens next.
// ============================================================================
export interface SuccessBannerProps {
  title: string;
  message: string;
  actionLabel?: string;
  nextActionLabel?: string;
  onAction?: () => void;
  onNextAction?: () => void;
  onDismiss?: () => void;
  autoDismissMs?: number;
}

export const SuccessBanner: React.FC<SuccessBannerProps> = ({
  title,
  message,
  actionLabel,
  nextActionLabel,
  onAction,
  onNextAction,
  onDismiss,
  autoDismissMs = 4500,
}) => {
  const label = actionLabel || nextActionLabel;
  const handleAction = onAction || onNextAction;

  useEffect(() => {
    if (autoDismissMs && onDismiss) {
      const timer = setTimeout(() => {
        onDismiss();
      }, autoDismissMs);
      return () => clearTimeout(timer);
    }
  }, [autoDismissMs, onDismiss]);

  return (
    <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 rounded-2xl text-emerald-900 dark:text-emerald-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md animate-slideDown">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-300 flex items-center justify-center shrink-0 mt-0.5">
          <CheckCircle2 className="w-5 h-5" />
        </div>
        <div>
          <h4 className="font-display font-bold text-xs sm:text-sm uppercase tracking-tight text-emerald-950 dark:text-emerald-200">
            {title}
          </h4>
          <p className="text-xs text-emerald-800 dark:text-emerald-300/90 mt-0.5">
            {message}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {nextActionLabel && onNextAction && (
          <button
            type="button"
            onClick={onNextAction}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <span>{nextActionLabel}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="p-1 text-emerald-600 dark:text-emerald-400 hover:text-emerald-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};
