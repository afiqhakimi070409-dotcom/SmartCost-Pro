/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hook to manage Network connectivity (Online / Offline / Slow Network)
 * and Session tracking (Auto-saving drafts before session expiry).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { apiUrl } from "./apiBase";

export interface NetworkAndSessionState {
  isOffline: boolean;
  isSlowNetwork: boolean;
  networkProgress: number;
  slowOperationLabel: string;
  isSessionExpired: boolean;
  checkConnection: () => void;
  startSlowNetworkTracker: (label?: string) => () => void;
  dismissSlowNetwork: () => void;
  handleRestoreSession: () => void;
  triggerSessionExpiryTest: () => void;
}

export function useNetworkAndSession(
  isLoggedIn: boolean,
  getCurrentSnapshot?: () => any
): NetworkAndSessionState {
  const [isOffline, setIsOffline] = useState<boolean>(!navigator.onLine);
  const [isSlowNetwork, setIsSlowNetwork] = useState<boolean>(false);
  const [networkProgress, setNetworkProgress] = useState<number>(0);
  const [slowOperationLabel, setSlowOperationLabel] = useState<string>("Memuatkan data...");
  const [isSessionExpired, setIsSessionExpired] = useState<boolean>(false);

  const lastActivityRef = useRef<number>(Date.now());
  const progressTimerRef = useRef<any>(null);

  // 1. Network Status Listeners
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      setIsSlowNetwork(false);
    };

    const handleOffline = () => {
      setIsOffline(true);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // 2. Slow Network Tracker Helper
  const startSlowNetworkTracker = useCallback((label = "Menyegerakkan data...") => {
    setSlowOperationLabel(label);
    setNetworkProgress(10);

    let progress = 10;
    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 15) + 5;
      if (progress >= 90) {
        progress = 90;
        setIsSlowNetwork(true);
      }
      setNetworkProgress(progress);
    }, 800);

    return () => {
      clearInterval(interval);
      setNetworkProgress(100);
      setTimeout(() => {
        setIsSlowNetwork(false);
      }, 500);
    };
  }, []);

  const dismissSlowNetwork = useCallback(() => {
    setIsSlowNetwork(false);
  }, []);

  // 3. User Activity & Session Inactivity Check (30 mins default, with draft preservation)
  useEffect(() => {
    if (!isLoggedIn) return;

    const handleUserActivity = () => {
      lastActivityRef.current = Date.now();
    };

    window.addEventListener("mousemove", handleUserActivity, { passive: true });
    window.addEventListener("keydown", handleUserActivity, { passive: true });
    window.addEventListener("touchstart", handleUserActivity, { passive: true });

    // Check inactivity every 60 seconds
    const checkInterval = setInterval(() => {
      const now = Date.now();
      const inactiveMinutes = (now - lastActivityRef.current) / (1000 * 60);

      // Session expires after 30 minutes of complete inactivity
      if (inactiveMinutes >= 30 && !isSessionExpired) {
        // Snapshot unsaved work to local storage draft
        if (getCurrentSnapshot) {
          try {
            const snapshot = getCurrentSnapshot();
            localStorage.setItem("pengekosan_session_backup_draft", JSON.stringify({
              savedAt: new Date().toISOString(),
              data: snapshot,
            }));
          } catch (e) {
            console.warn("[Session] Could not save emergency draft:", e);
          }
        }
        setIsSessionExpired(true);
      }
    }, 60000);

    return () => {
      window.removeEventListener("mousemove", handleUserActivity);
      window.removeEventListener("keydown", handleUserActivity);
      window.removeEventListener("touchstart", handleUserActivity);
      clearInterval(checkInterval);
    };
  }, [isLoggedIn, isSessionExpired, getCurrentSnapshot]);

  const checkConnection = useCallback(() => {
    setIsOffline(!navigator.onLine);
    if (navigator.onLine) {
      // Test actual connectivity with lightweight endpoint
      fetch(apiUrl("/api/health"), { method: "HEAD", cache: "no-store" })
        .then(() => setIsOffline(false))
        .catch(() => setIsOffline(true));
    }
  }, []);

  const handleRestoreSession = useCallback(() => {
    setIsSessionExpired(false);
    lastActivityRef.current = Date.now();
  }, []);

  const triggerSessionExpiryTest = useCallback(() => {
    if (getCurrentSnapshot) {
      try {
        const snapshot = getCurrentSnapshot();
        localStorage.setItem("pengekosan_session_backup_draft", JSON.stringify({
          savedAt: new Date().toISOString(),
          data: snapshot,
        }));
      } catch (e) {}
    }
    setIsSessionExpired(true);
  }, [getCurrentSnapshot]);

  return {
    isOffline,
    isSlowNetwork,
    networkProgress,
    slowOperationLabel,
    isSessionExpired,
    checkConnection,
    startSlowNetworkTracker,
    dismissSlowNetwork,
    handleRestoreSession,
    triggerSessionExpiryTest,
  };
}
