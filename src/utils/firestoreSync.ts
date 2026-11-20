/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";
import { db, auth } from "../firebase";
import { handleFirestoreError, OperationType } from "./firestoreErrors";
import { getAuthFetchHeaders } from "./authSessionClient";
import { apiUrl, getFetchCredentialsMode } from "./apiBase";

let pendingReads = 0;
let pendingWrites = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function reportObservedFirestoreOp(reads: number, writes: number): void {
  pendingReads += reads;
  pendingWrites += writes;
  if (typeof window === "undefined") return;
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    const r = pendingReads;
    const w = pendingWrites;
    pendingReads = 0;
    pendingWrites = 0;
    if (r <= 0 && w <= 0) return;
    try {
      const headers = await getAuthFetchHeaders({ "Content-Type": "application/json" });
      await fetch(apiUrl("/api/telemetry/firestore-ops"), {
        method: "POST",
        credentials: getFetchCredentialsMode(),
        headers,
        body: JSON.stringify({ readsDelta: r, writesDelta: w }),
      });
    } catch {
      // Non-blocking telemetry — ignore network errors
    }
  }, 1500);
}

function isOfflineNetworkError(error: any): boolean {
  const code = String(error?.code || "").toLowerCase();
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    code === "unavailable" ||
    code === "deadline-exceeded" ||
    msg.includes("the client is offline") ||
    msg.includes("offline") ||
    msg.includes("didn't respond")
  );
}

function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function sanitizeFirestoreDocId(keyOrName: string): string {
  return (keyOrName || "")
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, "_")
    .slice(0, 128);
}

export async function syncCompanyToFirestore(companyKeyOrId: string, companyData: any, explicitDbKey?: string): Promise<boolean> {
  const uniqueKey = (explicitDbKey || companyData?.dbKey || companyKeyOrId || "").trim();
  const sanitizedId = sanitizeFirestoreDocId(uniqueKey);
  if (!sanitizedId) return false;
  const path = `companies/${sanitizedId}`;

  // If there is no authenticated Firebase user or browser is offline, keep data in local storage without stalled cloud requests
  if (!auth.currentUser || isBrowserOffline()) {
    return false;
  }

  try {
    const ownerId = auth.currentUser.uid;
    const { kataLaluanLogMasuk: _strippedPw, ...safeConfig } = (companyData.config || {}) as Record<string, unknown>;
    const payload = {
      id: sanitizedId,
      ...(uniqueKey ? { dbKey: uniqueKey.slice(0, 128) } : {}),
      companyName: companyData.companyName || "SCHOOL ENTERPRISE",
      ownerId: ownerId,
      updatedAt: new Date().toISOString(),
      activeProductId: companyData.activeProductId || "popia-cabonara",
      config: safeConfig,
      templates: companyData.templates || [],
      bahanMentah: companyData.bahanMentah || [],
      buruhLangsung: companyData.buruhLangsung || [],
      overheadBerubah: companyData.overheadBerubah || [],
      overheadTetap: companyData.overheadTetap || [],
      version: companyData.version || "2.0",
      savedAt: new Date().toISOString(),
      isDevSandbox: Boolean(companyData.isDevSandbox),
    };

    await setDoc(doc(db, "companies", sanitizedId), payload, { merge: true });
    reportObservedFirestoreOp(0, 1);
    return true;
  } catch (error) {
    console.warn("[Firestore] Failed to sync company to cloud (falling back to local cache):", error);
    if (!isOfflineNetworkError(error)) {
      try {
        handleFirestoreError(error, OperationType.WRITE, path);
      } catch {}
    }
    return false;
  }
}

export async function fetchCompanyFromFirestore(companyKeyOrId: string, fallbackCompanyName?: string): Promise<any | null> {
  const sanitizedId = sanitizeFirestoreDocId(companyKeyOrId);
  if (!sanitizedId || !auth.currentUser || isBrowserOffline()) {
    return null;
  }

  const path = `companies/${sanitizedId}`;
  try {
    const snap = await getDoc(doc(db, "companies", sanitizedId));
    reportObservedFirestoreOp(1, 0);
    if (snap.exists()) {
      return snap.data();
    }
    // Optional safe legacy fallback only if explicitly requested and doc isn't bound to another dbKey
    if (fallbackCompanyName && fallbackCompanyName !== companyKeyOrId) {
      const legacyId = sanitizeFirestoreDocId(fallbackCompanyName.toLowerCase());
      if (legacyId && legacyId !== sanitizedId) {
        const legacySnap = await getDoc(doc(db, "companies", legacyId));
        reportObservedFirestoreOp(1, 0);
        if (legacySnap.exists()) {
          const data = legacySnap.data();
          if (!data?.dbKey || data.dbKey === companyKeyOrId) {
            return data;
          }
        }
      }
    }
    return null;
  } catch (error) {
    console.warn("[Firestore] Failed to fetch company from cloud:", error);
    if (!isOfflineNetworkError(error)) {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch {}
    }
    return null;
  }
}

export async function syncUserProfileToFirestore(userProfile: any): Promise<boolean> {
  const userId = userProfile.id || auth.currentUser?.uid;
  if (!userId || !auth.currentUser || isBrowserOffline()) return false;
  const path = `users/${userId}`;

  try {
    const payload = {
      id: userId,
      username: userProfile.username || "admin",
      fullName: userProfile.fullName || "Administrator",
      email: userProfile.email || auth.currentUser?.email || "",
      role: userProfile.role || "admin",
      companyName: userProfile.companyName || "SCHOOL ENTERPRISE",
      dbKey: userProfile.dbKey || "",
      createdAt: userProfile.createdAt || new Date().toISOString(),
    };

    await setDoc(doc(db, "users", userId), payload, { merge: true });
    reportObservedFirestoreOp(0, 1);
    return true;
  } catch (error) {
    console.warn("[Firestore] Failed to sync user profile:", error);
    if (!isOfflineNetworkError(error)) {
      try {
        handleFirestoreError(error, OperationType.WRITE, path);
      } catch {}
    }
    return false;
  }
}

export interface FirestoreDeleteResult {
  ok: boolean;
  skipped?: boolean;
  reasonCode?: "RULES_DENIED" | "ID_MISMATCH" | "SERVER_ERROR";
  errorStep?: string;
}

export interface FirestoreDeleteOptions {
  isServerVerifiedDev?: boolean;
  devEmail?: string;
}

export async function deleteCompanyFromFirestore(
  dbKey: string,
  options?: FirestoreDeleteOptions
): Promise<FirestoreDeleteResult> {
  const cleanDbKey = (dbKey || "").trim();
  const sanitizedId = sanitizeFirestoreDocId(cleanDbKey);
  if (!sanitizedId) {
    return { ok: false, reasonCode: "ID_MISMATCH", errorStep: "Pengecam database tidak sepadan." };
  }

  // If user is not authenticated with Firebase Auth client or browser is offline, no cloud deletion is pending
  if (!auth.currentUser || isBrowserOffline()) {
    return { ok: true, skipped: true };
  }

  // If a passkey developer (Alt+D) is executing deletion while a non-developer Google user happens
  // to remain signed into Firebase Auth in the same browser, client Firebase SDK cannot impersonate
  // the server-verified developer; server deletion has already succeeded authoritatively.
  const fbEmail = (auth.currentUser.email || "").trim().toLowerCase();
  const devEmail = (options?.devEmail || "").trim().toLowerCase();
  const isMismatchedPasskeyDev = Boolean(options?.isServerVerifiedDev && (!devEmail || fbEmail !== devEmail));

  try {
    const docRef = doc(db, "companies", sanitizedId);
    const snap = await getDoc(docRef);
    reportObservedFirestoreOp(1, 0);
    if (!snap.exists()) {
      return { ok: true, skipped: true };
    }
    await deleteDoc(docRef);
    reportObservedFirestoreOp(0, 1);
    return { ok: true };
  } catch (error: any) {
    if (isOfflineNetworkError(error)) {
      return { ok: false, reasonCode: "SERVER_ERROR", errorStep: "Ralat pelayan. Cuba lagi." };
    }
    const errCode = String(error?.code || "").toLowerCase();
    const errMsg = String(error?.message || "").toLowerCase();
    if (errCode.includes("permission-denied") || errMsg.includes("missing or insufficient permissions")) {
      if (isMismatchedPasskeyDev) {
        return { ok: true, skipped: true };
      }
      return { ok: false, reasonCode: "RULES_DENIED", errorStep: "Ditolak oleh peraturan pangkalan data." };
    }
    console.warn("[Firestore] Failed to delete company document from cloud:", error);
    return { ok: false, reasonCode: "SERVER_ERROR", errorStep: "Ralat pelayan. Cuba lagi." };
  }
}
