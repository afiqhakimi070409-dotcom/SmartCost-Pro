/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { getStoredLanguage, getTranslation } from "../utils/i18n";

interface ModalPortalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  maxWidthClass?: string;
  closeAriaLabel?: string;
}

export default function ModalPortal({
  isOpen,
  onClose,
  title,
  icon,
  children,
  maxWidthClass = "max-w-6xl",
  closeAriaLabel,
}: ModalPortalProps) {
  const effectiveCloseLabel = closeAriaLabel || getTranslation(getStoredLanguage()).common.close;
  // Handle ESC key to dismiss modal
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!isOpen) return;

    // 1. Lock body scrolling and prevent horizontal layout shift
    const originalBodyOverflow = document.body.style.overflow;
    const originalBodyPaddingRight = document.body.style.paddingRight;
    const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;

    if (scrollBarWidth > 0) {
      document.body.style.paddingRight = `${scrollBarWidth}px`;
    }
    document.body.style.overflow = "hidden";

    // 2. Add Esc listener
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.body.style.paddingRight = originalBodyPaddingRight;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 lg:p-8 overflow-y-auto animate-backdrop"
      onClick={onClose}
    >
      <div
        className={`bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 w-full ${maxWidthClass} max-h-[92vh] max-h-[92dvh] overflow-y-auto rounded-3xl p-4 sm:p-6 lg:p-8 shadow-2xl border border-slate-300 dark:border-slate-700 relative space-y-4 my-auto animate-modal`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        {(title || icon) && (
          <div className="flex items-center justify-between pb-3 border-b border-slate-300 dark:border-slate-700">
            <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
              {icon}
              {title}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
              title={effectiveCloseLabel}
              aria-label={effectiveCloseLabel}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Modal Content */}
        {children}
      </div>
    </div>,
    document.body
  );
}
