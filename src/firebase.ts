/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithRedirect,
  getRedirectResult,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  type User as FirebaseUser
} from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  doc,
  getDocFromServer,
  type Firestore
} from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);

// CRITICAL: Must pass firebaseConfig.firestoreDatabaseId.
// In browser environments (including sandboxed iframes and proxies), force long-polling
// so WebChannel streaming never stalls past Firestore's 10s backend response timeout.
function createFirestoreInstance(): Firestore {
  if (typeof window !== "undefined") {
    try {
      return initializeFirestore(
        app,
        {
          experimentalForceLongPolling: true,
          ignoreUndefinedProperties: true,
        },
        firebaseConfig.firestoreDatabaseId
      );
    } catch {
      return getFirestore(app, firebaseConfig.firestoreDatabaseId);
    }
  }
  return getFirestore(app, firebaseConfig.firestoreDatabaseId);
}

export const db = createFirestoreInstance();
export const auth = getAuth(app);

// Configure Google Provider with prompt: select_account
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account"
});

export type ConnectionStatus = "connected" | "offline" | "permission_denied" | "unauthenticated" | "error" | "testing";

export interface FirestoreConnectionCheckResult {
  status: ConnectionStatus;
  message: string;
  isOnline: boolean;
  timestamp: string;
}

export interface GoogleAuthOptions {
  preferRedirect?: boolean;
  lang?: "en" | "ms";
  onRedirectStart?: () => void;
}

export interface GoogleAuthResult {
  user: FirebaseUser | null;
  method: "popup" | "redirect";
  isRedirecting?: boolean;
}

/**
 * Converts Firebase Authentication error codes into polite, human-readable messages
 * without exposing raw technical strings.
 */
export function formatAuthErrorMessage(error: any, lang: "en" | "ms" = "en"): string {
  const code = error?.code || "";
  const rawMsg = error?.message || String(error || "");

  switch (code) {
    case "auth/popup-blocked":
      return lang === "en"
        ? "Popup was blocked by your browser. Redirecting you to the secure Google sign-in page..."
        : "Tetingkap popup disekat oleh pelayar web anda. Sistem sedang mengalihkan anda ke halaman log masuk Google yang selamat...";
    case "auth/popup-closed-by-user":
      return lang === "en"
        ? "The Google sign-in window was closed before completing. Please click the button to try again."
        : "Tetingkap log masuk Google ditutup sebelum proses selesai. Sila klik semula butang untuk cuba lagi.";
    case "auth/cancelled-popup-request":
      return lang === "en"
        ? "A previous login request was cancelled. Please click the sign-in button again."
        : "Permintaan log masuk sebelumnya telah dibatalkan atau bertindih. Sila klik semula butang log masuk.";
    case "auth/unauthorized-domain": {
      const currentDomain =
        typeof window !== "undefined" && window.location?.hostname
          ? window.location.hostname
          : lang === "en" ? "(current domain)" : "(domain semasa)";
      return lang === "en"
        ? `Google sign-in failed because the current domain "${currentDomain}" is not authorized yet. Developer: add "${currentDomain}" in Firebase > Authentication > Settings > Authorized domains.`
        : `Log masuk Google gagal kerana domain semasa "${currentDomain}" belum dibenarkan. Sila tambah "${currentDomain}" di Firebase > Authentication > Settings > Authorized domains.`;
    }
    case "auth/network-request-failed":
      return lang === "en"
        ? "Network connection issue. Please check your internet connection and try again."
        : "Ralat sambungan rangkaian. Sila semak sambungan internet anda dan cuba lagi.";
    case "auth/account-exists-with-different-credential":
      return lang === "en"
        ? "An account with this email already exists using a different sign-in method."
        : "Akaun dengan alamat emel ini telah wujud menggunakan kaedah log masuk yang berbeza.";
    case "auth/operation-not-allowed":
      return lang === "en"
        ? "This sign-in provider is not enabled in Firebase Authentication console. Please enable it in Firebase Console or sign in with Google."
        : "Kaedah log masuk ini belum diaktifkan dalam konsol Firebase Authentication. Sila aktifkannya dalam Firebase Console atau log masuk menggunakan Google.";
    case "auth/user-disabled":
      return lang === "en"
        ? "This account has been disabled by an administrator."
        : "Akaun pengguna ini telah dinyahaktifkan oleh pentadbir.";
    case "auth/too-many-requests":
      return lang === "en"
        ? "Too many login attempts. Please wait a moment before trying again."
        : "Terlalu banyak percubaan log masuk. Sila tunggu sebentar sebelum mencuba lagi.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return lang === "en"
        ? "Invalid email or password. Please verify your credentials."
        : "Emel atau kata laluan tidak sah. Sila semak semula kredensial anda.";
    default:
      if (rawMsg.includes("popup-blocked")) {
        return lang === "en"
          ? "Popup blocked by browser. Redirecting to Google login page..."
          : "Popup disekat oleh pelayar. Mengalihkan ke halaman log masuk Google...";
      }
      return lang === "en"
        ? `Authentication note: ${rawMsg}`
        : `Makluman pengesahan: ${rawMsg}`;
  }
}

/**
 * Performs Google Sign-In with robust failover:
 * 1. Executes directly on user click gesture using signInWithPopup() as the primary method.
 * 2. If popup is blocked by the browser ('auth/popup-blocked'), it seamlessly switches to signInWithRedirect().
 */
export async function signInWithGoogle(options?: GoogleAuthOptions): Promise<GoogleAuthResult> {
  const lang = options?.lang || "en";

  // If user explicitly chose redirect mode
  if (options?.preferRedirect) {
    options?.onRedirectStart?.();
    try {
      await signInWithRedirect(auth, googleProvider);
      return { user: null, method: "redirect", isRedirecting: true };
    } catch (redirectErr: any) {
      console.error("[SmartCost Auth] Direct signInWithRedirect error:", redirectErr);
      throw redirectErr;
    }
  }

  // Primary method: signInWithPopup
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return { user: result.user, method: "popup", isRedirecting: false };
  } catch (popupError: any) {
    const code = popupError?.code || "";
    const isBlocked = code === "auth/popup-blocked" || 
                      code === "auth/cancelled-popup-request" ||
                      (popupError?.message && popupError.message.includes("popup-blocked"));

    if (isBlocked) {
      console.warn("[SmartCost Auth] Popup was blocked by browser. Automatically falling back to signInWithRedirect...");
      options?.onRedirectStart?.();
      try {
        await signInWithRedirect(auth, googleProvider);
        return { user: null, method: "redirect", isRedirecting: true };
      } catch (redirectError: any) {
        console.error("[SmartCost Auth] Fallback signInWithRedirect failed:", redirectError);
        throw redirectError;
      }
    }

    // Pass through other errors (such as user voluntarily closing the popup)
    throw popupError;
  }
}

/**
 * Resolves the authentication result when user returns from a signInWithRedirect() flow.
 */
export async function checkRedirectResult(): Promise<FirebaseUser | null> {
  try {
    const result = await getRedirectResult(auth);
    if (result && result.user) {
      return result.user;
    }
    return null;
  } catch (error) {
    console.error("[SmartCost Auth] getRedirectResult error:", error);
    throw error;
  }
}

export async function logOut(): Promise<void> {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Sign-Out Error:", error);
    throw error;
  }
}

/**
 * Validates connection to Firestore and distinguishes status:
 * - "connected": Server responded
 * - "offline": Client is offline or network unreachable
 * - "permission_denied": Access rules restricted the path
 * - "unauthenticated": Auth token needed
 * - "error": General server/service failure
 */
export async function testFirestoreConnection(): Promise<FirestoreConnectionCheckResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      status: "offline",
      message: "Network unavailable. Firestore client is offline.",
      isOnline: false,
      timestamp: new Date().toISOString(),
    };
  }

  try {
    await getDocFromServer(doc(db, "test", "connection"));
    return {
      status: "connected",
      message: "Firestore connected successfully.",
      isOnline: true,
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    const errMsg = (error?.message || String(error)).toLowerCase();
    const code = error?.code || "";

    if (
      errMsg.includes("the client is offline") ||
      code === "unavailable" ||
      code === "deadline-exceeded" ||
      errMsg.includes("offline") ||
      errMsg.includes("didn't respond")
    ) {
      return {
        status: "offline",
        message: "Network unavailable. Firestore client is offline.",
        isOnline: false,
        timestamp: new Date().toISOString(),
      };
    }

    if (code === "permission-denied" || errMsg.includes("permission") || errMsg.includes("insufficient permissions")) {
      return {
        status: "permission_denied",
        message: "Firestore permission denied.",
        isOnline: true,
        timestamp: new Date().toISOString(),
      };
    }

    if (code === "unauthenticated" || errMsg.includes("unauthenticated")) {
      return {
        status: "unauthenticated",
        message: "Authentication required to access Firestore.",
        isOnline: true,
        timestamp: new Date().toISOString(),
      };
    }

    return {
      status: "error",
      message: error?.message || "Failed to reach Firestore.",
      isOnline: false,
      timestamp: new Date().toISOString(),
    };
  }
}

export {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  type FirebaseUser
};

export default app;
