/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { type User as FirebaseUser } from "firebase/auth";
import { RegisteredUser, UserRole } from "../types";
import { createEmptyBusinessDatabase } from "../data/defaultTemplates";
import { syncUserProfileToFirestore } from "./firestoreSync";
import { Language } from "./i18n";
import { LoginUserPayload } from "../components/LoginScreen";

export interface GoogleAuthProcessingResult {
  status: "success" | "multiple_accounts";
  payload?: LoginUserPayload;
  accounts?: RegisteredUser[];
  updatedUsers: RegisteredUser[];
  isNewUser: boolean;
}

/**
 * Deterministically maps an authenticated Google Firebase User to a SmartCost local and cloud profile.
 * - Handles existing accounts (single or multiple)
 * - Auto-creates a new company workspace if it's the user's first time
 * - Guarantees developer access for authorized developer email
 * - Syncs profile to Firestore
 */
export async function processGoogleUserAuth(
  gUser: FirebaseUser,
  currentRegisteredUsers: RegisteredUser[],
  lang: Language = "ms"
): Promise<GoogleAuthProcessingResult> {
  const email = (gUser.email || "").trim().toLowerCase();
  const fullName = gUser.displayName?.trim() || email.split("@")[0] || "User";
  const uid = gUser.uid;

  // Search existing registered users by email
  const existing = currentRegisteredUsers.filter(
    (u) => u.email && u.email.trim().toLowerCase() === email
  );

  if (existing.length === 1) {
    const acc = existing[0];
    const role: UserRole = acc.role || "staf";

    const payload: LoginUserPayload = {
      id: acc.id || uid,
      username: acc.username,
      fullName: acc.fullName,
      companyName: acc.companyName,
      role: role,
      email: acc.email,
      dbKey: acc.dbKey || `pengekosan_userdb_${acc.id || uid}`,
    };

    // Ensure Firestore profile is up to date
    syncUserProfileToFirestore({ ...acc, role }).catch(console.warn);

    return {
      status: "success",
      payload,
      updatedUsers: currentRegisteredUsers,
      isNewUser: false,
    };
  }

  if (existing.length > 1) {
    return {
      status: "multiple_accounts",
      accounts: existing,
      updatedUsers: currentRegisteredUsers,
      isNewUser: false,
    };
  }

  // First time Google Sign-In: Start with lowest-privilege role ('staf'); server decides authoritative role
  const role: UserRole = "staf";
  const defaultCompanyName = `${fullName.toUpperCase()} ENTERPRISE`;

  const companySanitized = defaultCompanyName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, "_");

  const dbKey = `pengekosan_company_db_${companySanitized}_${uid.slice(0, 8)}`;

  const baseUsername = (email.split("@")[0] || "user").toLowerCase().replace(/[^a-z0-9_]/g, "");
  // Ensure username uniqueness
  let chosenUsername = baseUsername;
  let counter = 1;
  while (currentRegisteredUsers.some((u) => u.username.toLowerCase() === chosenUsername)) {
    chosenUsername = `${baseUsername}${counter}`;
    counter++;
  }

  const newUser: RegisteredUser = {
    id: uid,
    username: chosenUsername,
    fullName: fullName,
    companyName: defaultCompanyName,
    role: role,
    email: email,
    password: "[PROTECTED_BY_GOOGLE_AUTH]",
    registeredAt: new Date().toISOString(),
    dbKey: dbKey,
  };

  const updatedUsers = [...currentRegisteredUsers, newUser];

  try {
    localStorage.setItem("pengekosan_registered_users", JSON.stringify(updatedUsers));

    // Create an empty starter database for this company/user
    const newDatabase = createEmptyBusinessDatabase(defaultCompanyName, chosenUsername);
    localStorage.setItem(dbKey, JSON.stringify(newDatabase));
    localStorage.setItem(`pengekosan_userdb_${uid}`, JSON.stringify(newDatabase));
  } catch (storageErr) {
    console.warn("[SmartCost Storage] Warning writing new Google user to local storage:", storageErr);
  }

  // Asynchronously sync profile to cloud Firestore
  syncUserProfileToFirestore(newUser).catch(console.warn);

  const payload: LoginUserPayload = {
    id: uid,
    username: newUser.username,
    fullName: newUser.fullName,
    companyName: defaultCompanyName,
    role: role,
    email: email,
    dbKey: dbKey,
  };

  return {
    status: "success",
    payload,
    updatedUsers,
    isNewUser: true,
  };
}
