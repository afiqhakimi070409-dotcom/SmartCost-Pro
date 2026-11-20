/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SmartCost / MR COST AI Full System & Security Validation Suite
 * Tests costing calculations, BEP edge cases, admin backup validation, and security rules.
 */

import {
  safeNum,
  kiraProfitMargin,
  kiraMarkup,
  kiraAnalisisBEP,
} from "../src/utils/costCalculations.ts";
import { validateBackupContent } from "../src/utils/adminBackup.ts";
import { getStoredTheme, THEME_STORAGE_KEY } from "../src/utils/theme.ts";
import { getTranslation } from "../src/utils/i18n.ts";
import {
  hashPassword,
  verifyPassword,
  registerNewManualUser,
  authenticateManualLogin,
  findUserByUsername,
} from "../src/serverAuth.ts";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

console.log("\n=======================================================");
console.log("SMARTCOST / MR COST AI — FULL SYSTEM VALIDATION SUITE");
console.log("=======================================================\n");

// 1. Math and Division-by-Zero Safety
console.log("Test 1: Safe Number Parsing and Division-by-Zero Protection");
assert(safeNum(null) === 0, "safeNum(null) returns 0");
assert(safeNum(undefined) === 0, "safeNum(undefined) returns 0");
assert(safeNum(NaN) === 0, "safeNum(NaN) returns 0");
assert(safeNum("abc") === 0, "safeNum('abc') returns 0");
assert(safeNum(4.49) === 4.49, "safeNum(4.49) returns 4.49");
assert(safeNum(-5) === -5, "safeNum(-5) returns -5");

// 2. Profit Margin vs Markup Precision
console.log("\nTest 2: Profit Margin vs Markup Calculations");
// Selling price RM 10.00, Cost RM 6.00 -> Profit RM 4.00
// Margin = ((Selling Price - Total Cost) / Selling Price) * 100 = ((10 - 6) / 10) * 100 = 40%
// Markup = ((Selling Price - Total Cost) / Total Cost) * 100 = ((10 - 6) / 6) * 100 = 66.67%
const margin = kiraProfitMargin(10.0, 6.0);
const markup = kiraMarkup(10.0, 6.0);
assert(Math.abs(margin - 40.0) < 0.01, `Profit margin is 40.0% (got ${margin.toFixed(2)}%)`);
assert(Math.abs(markup - 66.67) < 0.01, `Markup is 66.67% (got ${markup.toFixed(2)}%)`);

// Guard against zero division in margin & markup
assert(kiraProfitMargin(0, 5.0) === 0, "kiraProfitMargin with zero price returns 0 safely");
assert(kiraMarkup(5.0, 0) === 0, "kiraMarkup with zero cost returns 0 safely");

// 3. Break-Even Analysis (BEP) and Unattainable Edge Cases
console.log("\nTest 3: Break-Even Point (BEP) Calculations and Edge Cases");
// Normal profitable case: Fixed cost RM 100, Price RM 5.00, Variable cost RM 3.00
// CM = RM 2.00, BEP = 100 / 2 = 50 units, BEP RM = 50 * 5 = RM 250
const normalBep = kiraAnalisisBEP(100, 5.0, 3.0, 100);
assert(normalBep.isAttainable === true, "Normal scenario BEP is attainable");
assert(normalBep.bepMangkuk === 50, "Normal BEP units is 50");
assert(normalBep.bepRM === 250, "Normal BEP revenue is RM 250");
assert(normalBep.marginCarumanMangkuk === 2.0, "Unit contribution margin is RM 2.00");

// Zero Margin case: Price == Variable cost (CM == 0)
const zeroMarginBep = kiraAnalisisBEP(100, 3.0, 3.0, 100);
assert(zeroMarginBep.isAttainable === false, "Zero margin BEP is correctly marked NOT attainable");
assert(zeroMarginBep.status === "zero_margin", "Zero margin status is 'zero_margin'");
assert(zeroMarginBep.bepMangkuk === 0, "Zero margin BEP units returns 0 without dividing by zero");
assert(zeroMarginBep.bepRM === 0, "Zero margin BEP revenue returns 0");

// Negative Margin case: Price < Variable cost (loss per unit)
const negMarginBep = kiraAnalisisBEP(100, 2.5, 3.0, 100);
assert(negMarginBep.isAttainable === false, "Negative margin BEP is correctly marked NOT attainable");
assert(negMarginBep.status === "negative_margin", "Negative margin status is 'negative_margin'");
assert(negMarginBep.bepMangkuk === 0, "Negative margin BEP units returns 0");
assert(negMarginBep.bepRM === 0, "Negative margin BEP revenue returns 0");

// 4. Admin Backup Validation Integrity
console.log("\nTest 4: Admin Backup Structure and Template Integrity");
const validBackup = {
  metadata: {
    app: "SMARTCOST",
    backupVersion: "2.0.0",
    schemaVersion: "2026.1",
    exportedAt: new Date().toISOString(),
    exportedBy: "Admin",
    companyName: "SCHOOL ENTERPRISE",
    currency: "RM",
    totalProducts: 1,
    totalRawMaterials: 0,
    totalLaborItems: 0,
    totalOverheadItems: 0,
  },
  templates: [
    {
      id: "popia-cabonara",
      namaProduk: "Crispy Carbonara Rolls",
      bahanMentah: [],
      buruhLangsung: [],
      overheadBerubah: [],
      overheadTetap: [],
    },
  ],
};

const validResult = validateBackupContent(validBackup);
assert(validResult.valid === true, "Valid SMARTCOST backup passes validation");
assert(validResult.metadata?.companyName === "SCHOOL ENTERPRISE", "Backup metadata extracted correctly");

// Corrupt backup: Missing product name
const corruptBackupNoName = {
  metadata: { app: "SMARTCOST" },
  templates: [
    {
      id: "corrupt-1",
      // namaProduk missing
      bahanMentah: [],
    },
  ],
};
const corruptResult = validateBackupContent(corruptBackupNoName);
assert(corruptResult.valid === false, "Corrupt backup without product name is rejected (valid: false)");

// Corrupt backup: Non-SMARTCOST random file
const foreignFile = { app: "OTHER_APP", data: [] };
const foreignResult = validateBackupContent(foreignFile);
assert(foreignResult.valid === false, "Foreign JSON file signature is rejected");

// ---------------------------------------------------------------------------
// TEST 5: Google Authentication Error Formatting & Redirect Failover
// ---------------------------------------------------------------------------
console.log("\nTest 5: Google Authentication Error Formatting & Human-Friendly Messages");

import { formatAuthErrorMessage } from "../src/firebase.ts";

const popupBlockedMs = formatAuthErrorMessage({ code: "auth/popup-blocked" }, "ms");
assert(popupBlockedMs.includes("popup disekat") || popupBlockedMs.includes("pelayar"), "auth/popup-blocked translated gracefully in BM");

const popupBlockedEn = formatAuthErrorMessage({ code: "auth/popup-blocked" }, "en");
assert(popupBlockedEn.includes("Popup was blocked"), "auth/popup-blocked translated gracefully in EN");

const closedByUserMs = formatAuthErrorMessage({ code: "auth/popup-closed-by-user" }, "ms");
assert(closedByUserMs.includes("ditutup"), "auth/popup-closed-by-user translated gracefully");

const unauthDomainMs = formatAuthErrorMessage({ code: "auth/unauthorized-domain" }, "ms");
assert(unauthDomainMs.includes("Authorized Domains"), "auth/unauthorized-domain explains Authorized Domains clearly");

const networkFailMs = formatAuthErrorMessage({ code: "auth/network-request-failed" }, "ms");
assert(networkFailMs.includes("sambungan") || networkFailMs.includes("rangkaian"), "auth/network-request-failed explains network connection clearly");

const accExistsMs = formatAuthErrorMessage({ code: "auth/account-exists-with-different-credential" }, "ms");
assert(accExistsMs.includes("berbeza") || accExistsMs.includes("wujud"), "auth/account-exists-with-different-credential handled cleanly");

const generalErrorSafe = formatAuthErrorMessage(new Error("Firebase: Error (auth/popup-blocked)"), "ms");
assert(!generalErrorSafe.startsWith("Firebase: Error"), "Raw technical Firebase string is converted to clean message");

// ---------------------------------------------------------------------------
// TEST 6: Kos Standard vs Kos Sebenar 1:1 Value Parity & Multiplier Protection
// ---------------------------------------------------------------------------
console.log("\nTest 6: Kos Standard vs Kos Sebenar 1:1 Value Parity & Multiplier Protection");

import {
  resolveActualQty,
  resolveActualHours,
  resolveActualOverhead,
  kiraRingkasanKosStandard,
  kiraRingkasanKosSebenar,
  analisisVariansBahan,
  analisisVariansBuruh,
} from "../src/utils/costCalculations.ts";
import { KonfigurasiSistem, BahanMentah, BuruhLangsung, OverheadBerubah, OverheadTetap } from "../src/types.ts";

const testConfig: KonfigurasiSistem = {
  namaSyarikat: "SCHOOL ENTERPRISE",
  namaProduk: "Produk Ujian",
  hargaJualanStandard: 5.00,
  hargaJualanSebenar: 5.00,
  sasaranKuantitiStandard: 1000,
  kuantitiSebenarDijual: 1000,
  currency: "RM",
  usernameLogMasuk: "admin",
  kataLaluanLogMasuk: "123",
};

// 1. Kuantiti: 1 -> 1, 2 -> 2, 10 -> 10 (never 1000, 2000, 10000)
const qty1 = resolveActualQty(1, 1, 1000);
assert(qty1.perUnit === 1, "Input Kuantiti 1 retains value 1 without multiplying by 1,000");
assert(qty1.perUnit !== 1000, "Input Kuantiti 1 does NOT display 1000");

const qty2 = resolveActualQty(2, 2, 1000);
assert(qty2.perUnit === 2, "Input Kuantiti 2 retains value 2");

const qty10 = resolveActualQty(10, 10, 1000);
assert(qty10.perUnit === 10, "Input Kuantiti 10 retains value 10");

// 2. Jam bekerja: 1 -> 1, 2 -> 2, 8 -> 8 (never 1000, 2000, 8000)
const jam1 = resolveActualHours(1, 1, 1000);
assert(jam1.perUnit === 1, "Input Jam bekerja 1 retains value 1 without multiplying by 1,000");
assert(jam1.perUnit !== 1000, "Input Jam bekerja 1 does NOT display 1000");

const jam2 = resolveActualHours(2, 2, 1000);
assert(jam2.perUnit === 2, "Input Jam bekerja 2 retains value 2");

const jam8 = resolveActualHours(8, 8, 1000);
assert(jam8.perUnit === 8, "Input Jam bekerja 8 retains value 8");

// 3. Perpuluhan: 1.5, 0.5, 2.25 berfungsi dengan tepat tanpa dipotong
const dec15 = resolveActualQty(1.5, 1.5, 1000);
assert(dec15.perUnit === 1.5, "Input perpuluhan 1.5 dipelihara tepat");

const dec05 = resolveActualQty(0.5, 0.5, 1000);
assert(dec05.perUnit === 0.5, "Input perpuluhan 0.5 dipelihara tepat");

const dec225 = resolveActualQty(2.25, 2.25, 1000);
assert(dec225.perUnit === 2.25, "Input perpuluhan 2.25 dipelihara tepat");

// 4. Kos: RM1.00 -> RM1.00, RM10.00 -> RM10.00
const testBahan1: BahanMentah[] = [
  {
    id: "bm-test-1",
    nama: "Tepung",
    unit: "kg",
    stdKuantitiPerUnit: 1,
    stdHargaPerUnit: 1.00,
    sebenarKuantitiJumlah: 1,
    sebenarHargaPerUnit: 1.00,
  },
];
const ringkasan1 = kiraRingkasanKosSebenar(testConfig, testBahan1, [], [], []);
assert(Math.abs(ringkasan1.bahanMentahSemangkuk - 1.00) < 0.001, "Kos Bahan Sebenar seunit ialah RM1.00 bagi input RM1.00");

const testBahan10: BahanMentah[] = [
  {
    id: "bm-test-10",
    nama: "Daging",
    unit: "kg",
    stdKuantitiPerUnit: 1,
    stdHargaPerUnit: 10.00,
    sebenarKuantitiJumlah: 1,
    sebenarHargaPerUnit: 10.00,
  },
];
const ringkasan10 = kiraRingkasanKosSebenar(testConfig, testBahan10, [], [], []);
assert(Math.abs(ringkasan10.bahanMentahSemangkuk - 10.00) < 0.001, "Kos Bahan Sebenar seunit ialah RM10.00 bagi input RM10.00");

// 5. Analisis Varians tepat dan seimbang bila standard = sebenar
const variansBahan = analisisVariansBahan(1000, testBahan1);
assert(Math.abs(variansBahan[0].variansJumlah) < 0.001, "Varians Bahan ialah 0 apabila Kos Standard = Kos Sebenar (1:1)");

const testBuruh1: BuruhLangsung[] = [
  {
    id: "bl-test-1",
    nama: "Penyedia",
    stdJamPerUnit: 1,
    stdKadarPerJam: 10.00,
    sebenarJamJumlah: 1,
    sebenarKadarPerJam: 10.00,
  },
];
const variansBuruh = analisisVariansBuruh(1000, testBuruh1);
assert(Math.abs(variansBuruh[0].variansJumlah) < 0.001, "Varians Buruh ialah 0 apabila Jam Standard = Jam Sebenar (1:1)");

// ---------------------------------------------------------------------------
// TEST 7: Unit Measurement, Conversions, Raw Material & Labour Integrity
// ---------------------------------------------------------------------------
console.log("\nTest 7: Comprehensive Unit Measurements, Conversions & Accounting Integrity");

import {
  calculateMaterialCost,
  resolveLaborHours,
  calculateLaborCost,
  convertToStdUnit,
  convertUnit,
} from "../src/utils/costCalculations.ts";

// A. Unit Conversions (Weight, Volume, Time, Count)
// 1 kg = 1,000 g
const c1kg = convertUnit(1, "kg", "g");
assert(c1kg.success && Math.abs((c1kg.convertedValue || 0) - 1000) < 0.001, "Unit conversion: 1 kg = 1,000 g");

// 1 g = 1,000 mg
const c1g = convertUnit(1, "g", "mg");
assert(c1g.success && Math.abs((c1g.convertedValue || 0) - 1000) < 0.001, "Unit conversion: 1 g = 1,000 mg");

// 500 g = 0.5 kg
const c500g = convertUnit(500, "g", "kg");
assert(c500g.success && Math.abs((c500g.convertedValue || 0) - 0.5) < 0.001, "Unit conversion: 500 g = 0.5 kg");

// 250 g = 0.25 kg
const c250g = convertUnit(250, "g", "kg");
assert(c250g.success && Math.abs((c250g.convertedValue || 0) - 0.25) < 0.001, "Unit conversion: 250 g = 0.25 kg");

// 1 L = 1,000 ml
const c1L = convertUnit(1, "L", "ml");
assert(c1L.success && Math.abs((c1L.convertedValue || 0) - 1000) < 0.001, "Unit conversion: 1 L = 1,000 ml");

// 500 ml = 0.5 L
const c500ml = convertUnit(500, "ml", "L");
assert(c500ml.success && Math.abs((c500ml.convertedValue || 0) - 0.5) < 0.001, "Unit conversion: 500 ml = 0.5 L");

// 250 ml = 0.25 L
const c250ml = convertUnit(250, "ml", "L");
assert(c250ml.success && Math.abs((c250ml.convertedValue || 0) - 0.25) < 0.001, "Unit conversion: 250 ml = 0.25 L");

// Time conversions
assert(Math.abs(resolveLaborHours(1, "jam") - 1) < 0.001, "Labor time: 1 jam = 1.0 hr");
assert(Math.abs(resolveLaborHours(8, "jam") - 8) < 0.001, "Labor time: 8 jam = 8.0 hr");
assert(Math.abs(resolveLaborHours(30, "minit") - 0.5) < 0.001, "Labor time: 30 minit = 0.5 hr");
assert(Math.abs(resolveLaborHours(15, "minit") - 0.25) < 0.001, "Labor time: 15 minit = 0.25 hr");
assert(Math.abs(resolveLaborHours(60, "minit") - 1.0) < 0.001, "Labor time: 60 minit = 1.0 hr");
assert(Math.abs(resolveLaborHours(120, "minit") - 2.0) < 0.001, "Labor time: 120 minit = 2.0 hr");
assert(Math.abs(resolveLaborHours(3600, "saat") - 1.0) < 0.001, "Labor time: 3600 saat = 1.0 hr");

// B. Raw Material Cost Calculations
// Flour 1 kg @ RM4.00/kg = RM 4.00
const costFlour = calculateMaterialCost(1, "kg", 4.00, "kg");
assert(Math.abs(costFlour - 4.00) < 0.001, "Flour: 1 kg @ RM4.00/kg = RM 4.00");

// Sugar 2 kg @ RM3.00/kg = RM 6.00
const costSugar = calculateMaterialCost(2, "kg", 3.00, "kg");
assert(Math.abs(costSugar - 6.00) < 0.001, "Sugar: 2 kg @ RM3.00/kg = RM 6.00");

// Oil 500 ml @ RM8.00/L = RM 4.00
const costOil = calculateMaterialCost(500, "ml", 8.00, "L");
assert(Math.abs(costOil - 4.00) < 0.001, "Oil: 500 ml @ RM8.00/L = RM 4.00");

// Seasoning 500 g @ RM4.00/kg = RM 2.00
const costSeasoning = calculateMaterialCost(500, "g", 4.00, "kg");
assert(Math.abs(costSeasoning - 2.00) < 0.001, "Seasoning: 500 g @ RM4.00/kg = RM 2.00");

// Packaging 10 unit @ RM0.50/unit = RM 5.00
const costPack = calculateMaterialCost(10, "unit", 0.50, "unit");
assert(Math.abs(costPack - 5.00) < 0.001, "Packaging: 10 unit @ RM0.50/unit = RM 5.00");

// C. Labour Cost Calculations
// 1 hour @ RM10.00/hr = RM 10.00
assert(Math.abs(calculateLaborCost(1, "jam", 10.00) - 10.00) < 0.001, "Labour: 1 hr @ RM10.00/hr = RM 10.00");

// 2 hours @ RM10.00/hr = RM 20.00
assert(Math.abs(calculateLaborCost(2, "jam", 10.00) - 20.00) < 0.001, "Labour: 2 hr @ RM10.00/hr = RM 20.00");

// 8 hours @ RM10.00/hr = RM 80.00
assert(Math.abs(calculateLaborCost(8, "jam", 10.00) - 80.00) < 0.001, "Labour: 8 hr @ RM10.00/hr = RM 80.00");

// 9 hours @ RM10.00/hr = RM 90.00
assert(Math.abs(calculateLaborCost(9, "jam", 10.00) - 90.00) < 0.001, "Labour: 9 hr @ RM10.00/hr = RM 90.00");

// 30 minutes @ RM10.00/hr = RM 5.00
assert(Math.abs(calculateLaborCost(30, "minit", 10.00) - 5.00) < 0.001, "Labour: 30 min @ RM10.00/hr = RM 5.00");

// 60 minutes @ RM10.00/hr = RM 10.00
assert(Math.abs(calculateLaborCost(60, "minit", 10.00) - 10.00) < 0.001, "Labour: 60 min @ RM10.00/hr = RM 10.00");

// 120 minutes @ RM10.00/hr = RM 20.00
assert(Math.abs(calculateLaborCost(120, "minit", 10.00) - 20.00) < 0.001, "Labour: 120 min @ RM10.00/hr = RM 20.00");

// D. Comparison & Variance with Equivalent Cross-Units
// Standard: 1 kg @ RM4.00, Actual: 1000 g @ RM4.00/kg -> Variance = 0
const crossUnitBahan: BahanMentah[] = [
  {
    id: "bm-cross-1",
    nama: "Tepung Gandum",
    unit: "kg",
    stdKuantitiPerUnit: 1,
    stdHargaPerUnit: 4.00,
    sebenarKuantitiJumlah: 1000,
    sebenarUnit: "g",
    sebenarHargaPerUnit: 4.00,
    sebenarHargaUnit: "kg",
  },
];
const crossUnitVariance = analisisVariansBahan(1, crossUnitBahan);
assert(Math.abs(crossUnitVariance[0].variansJumlah) < 0.001, "Cross-unit variance: 1 kg std vs 1000 g actual yields 0 variance");
assert(Math.abs(crossUnitVariance[0].variansPenggunaan) < 0.001, "Usage variance for 1 kg std vs 1000 g actual is 0");

// Standard: 8 hours @ RM10.00, Actual: 9 hours @ RM10.00 -> Variance = +1 hr / +RM10.00
const laborOvertime: BuruhLangsung[] = [
  {
    id: "bl-ot-1",
    nama: "Chef",
    unitMasa: "jam",
    stdJamPerUnit: 8,
    stdKadarPerJam: 10.00,
    sebenarJamJumlah: 9,
    sebenarUnitMasa: "jam",
    sebenarKadarPerJam: 10.00,
  },
];
const laborOtVariance = analisisVariansBuruh(1, laborOvertime);
assert(Math.abs(laborOtVariance[0].variansKecekapan - 10.00) < 0.001, "Labour variance for 8 hr std vs 9 hr actual is +RM 10.00 (Unfavorable)");
// 9. Dual-Theme System & Token Architecture
console.log("\nTest 9: Dual-Theme System & Token Architecture");
assert(THEME_STORAGE_KEY === "smartcost_theme_preference", "Theme storage key is correctly standardized to 'smartcost_theme_preference'");
const fallbackTheme = getStoredTheme();
assert(fallbackTheme === "light" || fallbackTheme === "dark", `getStoredTheme() safely returns a valid ThemeMode ('${fallbackTheme}')`);

const enTrans = getTranslation("en") as any;
const msTrans = getTranslation("ms") as any;
assert(Boolean(enTrans.theme?.themeSection && enTrans.theme?.brightMode && enTrans.theme?.darkMode), "English dictionary contains complete theme translations");
assert(Boolean(msTrans.theme?.themeSection && msTrans.theme?.brightMode && msTrans.theme?.darkMode), "Bahasa Melayu dictionary contains complete theme translations");

// 10. Authentication Engine, Optional Email, Scrypt Hashing & Database Isolation
console.log("\nTest 10: Authentication Engine, Optional Email, Scrypt Hashing & Database Isolation");

// A. Cryptographic Password Hashing & Verification
const testPlain = "RahsiaSyarikat123!";
const testEnc = hashPassword(testPlain);
assert(Boolean(testEnc.salt && testEnc.hash), "Password produces cryptographically random salt and scrypt hash");
assert(verifyPassword(testPlain, testEnc.salt, testEnc.hash), "Correct password validates successfully via timingSafeEqual");
assert(!verifyPassword("WrongPassword!", testEnc.salt, testEnc.hash), "Incorrect password correctly rejected");

// B. Manual Registration WITHOUT Email (Strictly Optional Email)
const uniqueTestUser = `usertestnoemail_${Date.now()}`;
const regResult = registerNewManualUser({
  username: uniqueTestUser,
  password: "SafePassword888!",
  fullName: "Ahmad Usahawan",
  companyName: "Kerepek Rangup Ent",
  role: "admin",
  email: "", // Email omitted
});
assert(regResult.success === true && Boolean(regResult.user?.id), "Registration without email succeeds with permanent UID");
assert(regResult.user?.email === undefined || regResult.user?.email === "", "User record explicitly confirms optional email");
assert(regResult.user?.role === "staf", "Primary registered user safely assigned lowest-privilege 'staf' role");
assert(
  Boolean(regResult.user?.dbKey && regResult.user.dbKey.includes("kerepek_rangup_ent")),
  "User allocated dedicated and isolated database scope"
);

// C. Verify Manual Credentials via Auth Service
const loginSuccess = authenticateManualLogin(uniqueTestUser, "SafePassword888!");
assert(loginSuccess.success === true && loginSuccess.user?.username === uniqueTestUser, "Manual login succeeds for account without email");

const loginFailed = authenticateManualLogin(uniqueTestUser, "SalahPassword!");
assert(loginFailed.success === false, "Manual login with wrong password rejected");

// Clean up synthetic test user, database & lockout entry so validateSystem does not pollute data/*.json
try {
  const fs = await import("fs");
  const path = await import("path");
  const dataDir = path.resolve(process.cwd(), "data");
  const usersFile = path.join(dataDir, "server_users.json");
  const dbsFile = path.join(dataDir, "server_databases.json");
  const lockoutsFile = path.join(dataDir, "server_lockouts.json");
  if (fs.existsSync(usersFile)) {
    const users = JSON.parse(fs.readFileSync(usersFile, "utf-8"));
    if (Array.isArray(users)) {
      fs.writeFileSync(usersFile, JSON.stringify(users.filter((u: any) => u.username !== uniqueTestUser), null, 2), "utf-8");
    }
  }
  if (fs.existsSync(dbsFile) && regResult.user?.dbKey) {
    const dbs = JSON.parse(fs.readFileSync(dbsFile, "utf-8"));
    if (Array.isArray(dbs)) {
      fs.writeFileSync(dbsFile, JSON.stringify(dbs.filter((d: any) => d.databaseId !== regResult.user?.dbKey), null, 2), "utf-8");
    }
  }
  if (fs.existsSync(lockoutsFile)) {
    const lockouts = JSON.parse(fs.readFileSync(lockoutsFile, "utf-8"));
    if (lockouts && typeof lockouts === "object") {
      delete lockouts[`user:${uniqueTestUser}`];
      fs.writeFileSync(lockoutsFile, JSON.stringify(lockouts, null, 2), "utf-8");
    }
  }
} catch {}

// D. Developer Role Hardening & Database Isolation
const devLookup = findUserByUsername("afiqhakimi070409");
assert(devLookup !== null, "Official developer account registered in server auth store");
if (devLookup) {
  assert(devLookup.role === "developer", "Developer account has verified 'developer' role");
  assert(devLookup.dbKey === "pengekosan_dev_sandbox_db", "Developer account isolated to dedicated sandbox database");
}

console.log("\n=======================================================");
console.log(`VALIDATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log("=======================================================\n");

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

