/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SmartCost Server-Side Input, Upload, Schema & Costing Integrity Validation
 * - Prototype pollution & XSS control-character sanitization
 * - Strict schema validation for manual registration, database registration, and JSON backups
 * - Image data-URL magic-byte & size validation (PNG, JPEG, WEBP only; blocks SVG/HTML)
 * - Server-side deterministic financial & costing formula verification (exact parity with costCalculations.ts)
 */

import type {
  BahanMentah,
  BuruhLangsung,
  KonfigurasiSistem,
  OverheadBerubah,
  OverheadTetap,
} from "./types.ts";
import {
  analisisVariansBahan,
  analisisVariansBuruh,
  analisisVariansOverheadBerubah,
  analisisVariansOverheadTetap,
  kiraAnalisisBEP,
  kiraProfitMargin,
  kiraRingkasanKosSebenar,
  kiraRingkasanKosStandard,
  safeNum,
} from "./utils/costCalculations.ts";

const DANGEROUS_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_JSON_DEPTH = 14;
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB hard ceiling
const MAX_NUMERIC_FINANCIAL_VALUE = 1_000_000_000; // 1B ceiling prevents overflow/NaN abuse

export function hasPrototypePollutionKey(val: unknown, depth = 0): boolean {
  if (depth > MAX_JSON_DEPTH || val === null || typeof val !== "object") return false;
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) {
      if (hasPrototypePollutionKey(val[i], depth + 1)) return true;
    }
    return false;
  }
  const keys = Object.keys(val as Record<string, unknown>);
  for (const k of keys) {
    if (DANGEROUS_OBJECT_KEYS.has(k)) return true;
    const rawDesc = Object.getOwnPropertyDescriptor(val, k);
    if (rawDesc && hasPrototypePollutionKey(rawDesc.value, depth + 1)) return true;
  }
  return false;
}

export function stripPrototypePollutionKeys<T>(val: T, depth = 0): T {
  if (depth > MAX_JSON_DEPTH || val === null || typeof val !== "object") {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map((item) => stripPrototypePollutionKeys(item, depth + 1)) as unknown as T;
  }
  const cleanObj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (DANGEROUS_OBJECT_KEYS.has(k)) continue;
    cleanObj[k] = stripPrototypePollutionKeys(v, depth + 1);
  }
  return cleanObj as T;
}

/**
 * Sanitizes plain text fields against control characters and embedded HTML/script fragments
 * without corrupting legitimate Malaysian/English business names (e.g. '&', '/', '-', '.').
 */
export function sanitizePlainText(input: unknown, maxLen = 128): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

export function containsSuspiciousScriptOrHtml(input: unknown): boolean {
  if (typeof input !== "string") return false;
  return /<\s*script|on\w+\s*=|javascript\s*:|<\s*iframe|<\s*svg/i.test(input);
}

export function clampFiniteNonNegative(val: unknown, fallback = 0, max = MAX_NUMERIC_FINANCIAL_VALUE): number {
  const num = safeNum(val, fallback);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.min(max, num);
}

/**
 * Validates an uploaded logo data URL using real decoded magic bytes (PNG/JPEG/WEBP only).
 * Explicitly rejects SVG/XML/HTML/unknown types and payloads exceeding 2MB.
 */
export function validateLogoDataUrl(dataUrl: unknown): { valid: boolean; error?: string } {
  if (dataUrl === undefined || dataUrl === null || dataUrl === "") {
    return { valid: true };
  }
  if (typeof dataUrl !== "string") {
    return { valid: false, error: "Format logo tidak sah." };
  }
  const trimmed = dataUrl.trim();
  if (!trimmed) return { valid: true };

  // Allow safe HTTPS external logo URL only if not javascript:/data:
  if (trimmed.startsWith("https://") && trimmed.length <= 1024 && !containsSuspiciousScriptOrHtml(trimmed)) {
    return { valid: true };
  }

  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(trimmed);
  if (!match) {
    return {
      valid: false,
      error: "Hanya imej PNG, JPEG atau WEBP yang sah dibenarkan untuk logo syarikat (SVG dan HTML disekat).",
    };
  }

  const mime = match[1].toLowerCase();
  const base64Body = match[2];
  const estimatedBytes = Math.floor((base64Body.length * 3) / 4);
  if (estimatedBytes <= 0 || estimatedBytes > MAX_LOGO_BYTES) {
    return {
      valid: false,
      error: "Saiz fail logo melebihi had maksimum 2MB.",
    };
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64Body, "base64");
  } catch {
    return { valid: false, error: "Kandungan base64 logo tidak sah." };
  }

  if (bytes.length < 12 || bytes.length > MAX_LOGO_BYTES) {
    return { valid: false, error: "Fail imej logo rosak atau melebihi had 2MB." };
  }

  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;

  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

  const isWebp =
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";

  if ((mime === "image/png" && isPng) || ((mime === "image/jpeg" || mime === "image/jpg") && isJpeg) || (mime === "image/webp" && isWebp)) {
    return { valid: true };
  }

  return {
    valid: false,
    error: "Tandatangan bait (magic bytes) imej tidak sepadan dengan PNG/JPEG/WEBP.",
  };
}

export function validateManualRegisterInput(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
  cleaned?: {
    username: string;
    fullName: string;
    companyName: string;
    password: string;
    email?: string;
  };
} {
  if (!body || typeof body !== "object" || hasPrototypePollutionKey(body)) {
    return { valid: false, error: "Permintaan pendaftaran tidak sah." };
  }
  const rawUsername = typeof body.username === "string" ? body.username.trim() : "";
  const rawFullName = typeof body.fullName === "string" ? body.fullName : "";
  const rawCompanyName = typeof body.companyName === "string" ? body.companyName : "";
  const rawPassword = typeof body.password === "string" ? body.password : "";
  const rawEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (
    containsSuspiciousScriptOrHtml(rawUsername) ||
    containsSuspiciousScriptOrHtml(rawFullName) ||
    containsSuspiciousScriptOrHtml(rawCompanyName) ||
    containsSuspiciousScriptOrHtml(rawEmail)
  ) {
    return { valid: false, error: "Input mengandungi aksara atau tag yang tidak dibenarkan." };
  }

  const fullName = sanitizePlainText(rawFullName, 100);
  const companyName = sanitizePlainText(rawCompanyName, 128);
  if (!fullName || fullName.length < 2) {
    return { valid: false, error: "Nama penuh yang sah (minimum 2 aksara) diperlukan." };
  }
  if (rawEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rawEmail) || rawEmail.length > 128)) {
    return { valid: false, error: "Format emel tidak sah." };
  }

  return {
    valid: true,
    cleaned: {
      username: rawUsername,
      fullName,
      companyName: companyName || `${fullName.toUpperCase()} ENTERPRISE`,
      password: rawPassword,
      ...(rawEmail ? { email: rawEmail } : {}),
    },
  };
}

export function sanitizeBackupContentPayload<T>(payload: T): {
  valid: boolean;
  error?: string;
  cleaned?: T;
} {
  if (!payload || typeof payload !== "object") {
    return { valid: false, error: "Kandungan sandaran tidak sah atau bukan objek JSON." };
  }
  if (hasPrototypePollutionKey(payload)) {
    return { valid: false, error: "Struktur fail sandaran mengandungi kunci berbahaya yang disekat." };
  }

  const cleanPayload = stripPrototypePollutionKeys(payload) as any;

  // Strip any secret/credential keys inside config or templates recursively
  const stripSecretsFromConfig = (cfg: any) => {
    if (!cfg || typeof cfg !== "object") return {};
    const {
      kataLaluanLogMasuk: _pw1,
      password: _pw2,
      passwordHash: _pw3,
      salt: _salt,
      sessionToken: _st,
      csrfToken: _ct,
      twoFactorSecretEnc: _tf1,
      twoFactorPendingSecretEnc: _tf2,
      ...rest
    } = cfg;
    if (typeof rest.namaSyarikat === "string") {
      rest.namaSyarikat = sanitizePlainText(rest.namaSyarikat, 128) || "SMARTCOST";
    }
    if (rest.generalSetup && typeof rest.generalSetup === "object" && rest.generalSetup.logoUrl) {
      const logoCheck = validateLogoDataUrl(rest.generalSetup.logoUrl);
      if (!logoCheck.valid) {
        rest.generalSetup.logoUrl = "";
      }
    }
    return rest;
  };

  if (cleanPayload.company?.config) {
    cleanPayload.company.config = stripSecretsFromConfig(cleanPayload.company.config);
  }
  if (cleanPayload.config) {
    cleanPayload.config = stripSecretsFromConfig(cleanPayload.config);
  }
  if (Array.isArray(cleanPayload.templates)) {
    if (cleanPayload.templates.length > 500) {
      return { valid: false, error: "Bilangan templat melebihi had maksimum 500 per sandaran." };
    }
    cleanPayload.templates = cleanPayload.templates.map((tpl: any) => {
      if (!tpl || typeof tpl !== "object") return tpl;
      const next = { ...tpl };
      if (typeof next.namaProduk === "string") {
        next.namaProduk = sanitizePlainText(next.namaProduk, 128);
      }
      if (typeof next.namaSyarikat === "string") {
        next.namaSyarikat = sanitizePlainText(next.namaSyarikat, 128);
      }
      if (next.konfigurasi && typeof next.konfigurasi === "object") {
        next.konfigurasi = stripSecretsFromConfig(next.konfigurasi);
      }
      return next;
    });
  }

  return { valid: true, cleaned: cleanPayload as T };
}

export interface CostingVerificationRequest {
  config: Partial<KonfigurasiSistem>;
  bahanMentah: Array<Partial<BahanMentah>>;
  buruhLangsung: Array<Partial<BuruhLangsung>>;
  overheadBerubah: Array<Partial<OverheadBerubah>>;
  overheadTetap: Array<Partial<OverheadTetap>>;
  clientSummary?: {
    stdCostPerUnit?: number;
    actCostPerUnit?: number;
    stdNetProfit?: number;
    actNetProfit?: number;
    bepUnits?: number;
  };
}

/**
 * Server-side authoritative verification & sanitization of all costing inputs and calculations.
 * Uses the exact same deterministic formulas in src/utils/costCalculations.ts (never modifies formulas).
 */
export function verifyCostingSummaryOnServer(input: CostingVerificationRequest): {
  valid: boolean;
  error?: string;
  sanitizedConfig?: KonfigurasiSistem;
  standardSummary?: ReturnType<typeof kiraRingkasanKosStandard>;
  actualSummary?: ReturnType<typeof kiraRingkasanKosSebenar>;
  bepStandard?: ReturnType<typeof kiraAnalisisBEP>;
  bepActual?: ReturnType<typeof kiraAnalisisBEP>;
  profitStandard?: ReturnType<typeof kiraProfitMargin>;
  profitActual?: ReturnType<typeof kiraProfitMargin>;
  variances?: {
    bahan: ReturnType<typeof analisisVariansBahan>;
    buruh: ReturnType<typeof analisisVariansBuruh>;
    overheadBerubah: ReturnType<typeof analisisVariansOverheadBerubah>;
    overheadTetap: ReturnType<typeof analisisVariansOverheadTetap>;
  };
  discrepancies?: string[];
} {
  if (!input || typeof input !== "object" || hasPrototypePollutionKey(input)) {
    return { valid: false, error: "Payload pengiraan kos tidak sah." };
  }

  const rawCfg = input.config || {};
  const materialsIn = Array.isArray(input.bahanMentah) ? input.bahanMentah : [];
  const laborIn = Array.isArray(input.buruhLangsung) ? input.buruhLangsung : [];
  const varOhIn = Array.isArray(input.overheadBerubah) ? input.overheadBerubah : [];
  const fixOhIn = Array.isArray(input.overheadTetap) ? input.overheadTetap : [];

  if (
    materialsIn.length > 500 ||
    laborIn.length > 200 ||
    varOhIn.length > 200 ||
    fixOhIn.length > 200
  ) {
    return { valid: false, error: "Bilangan item kos melebihi had maksimum sistem." };
  }

  const sanitizedConfig: KonfigurasiSistem = {
    namaSyarikat: sanitizePlainText(rawCfg.namaSyarikat || "SMARTCOST", 128) || "SMARTCOST",
    namaProduk: sanitizePlainText(rawCfg.namaProduk || "Produk", 128) || "Produk",
    unitProduk: sanitizePlainText(rawCfg.unitProduk || "unit", 32) || "unit",
    unitPengeluaran: sanitizePlainText(rawCfg.unitPengeluaran || rawCfg.unitProduk || "unit", 32) || "unit",
    kuantitiPengeluaranPiawai: Math.max(1, clampFiniteNonNegative(rawCfg.kuantitiPengeluaranPiawai, 1)),
    sasaranKuantitiStandard: clampFiniteNonNegative(rawCfg.sasaranKuantitiStandard, 0),
    hargaJualanStandard: clampFiniteNonNegative(rawCfg.hargaJualanStandard, 0),
    kuantitiSebenarDijual: clampFiniteNonNegative(rawCfg.kuantitiSebenarDijual, 0),
    hargaJualanSebenar: clampFiniteNonNegative(rawCfg.hargaJualanSebenar, 0),
    currency: sanitizePlainText(rawCfg.currency || "RM", 12) || "RM",
    usernameLogMasuk: "",
    kataLaluanLogMasuk: "",
  };

  const bahanMentah: BahanMentah[] = materialsIn.map((m, idx) => {
    const raw = (m || {}) as any;
    return {
      id: sanitizePlainText(raw.id || `bm-${idx}`, 64) || `bm-${idx}`,
      nama: sanitizePlainText(raw.nama || `Bahan ${idx + 1}`, 128) || `Bahan ${idx + 1}`,
      unit: sanitizePlainText(raw.unit || "unit", 32) || "unit",
      stdKuantitiPerUnit: clampFiniteNonNegative(raw.stdKuantitiPerUnit, 0),
      stdHargaPerUnit: clampFiniteNonNegative(raw.stdHargaPerUnit, 0),
      ...(raw.hargaUnit ? { hargaUnit: sanitizePlainText(raw.hargaUnit, 32) } : {}),
      sebenarKuantitiJumlah: clampFiniteNonNegative(raw.sebenarKuantitiJumlah ?? raw.sebenarKuantitiTotal, 0),
      ...(raw.sebenarUnit ? { sebenarUnit: sanitizePlainText(raw.sebenarUnit, 32) } : {}),
      sebenarHargaPerUnit: clampFiniteNonNegative(raw.sebenarHargaPerUnit, 0),
      ...(raw.sebenarHargaUnit ? { sebenarHargaUnit: sanitizePlainText(raw.sebenarHargaUnit, 32) } : {}),
    };
  });

  const buruhLangsung: BuruhLangsung[] = laborIn.map((l, idx) => {
    const raw = (l || {}) as any;
    const unitMasa = raw.unitMasa === "minit" ? "minit" : "jam";
    const sebenarUnitMasa = raw.sebenarUnitMasa === "minit" ? "minit" : raw.sebenarUnitMasa === "jam" ? "jam" : undefined;
    return {
      id: sanitizePlainText(raw.id || `bl-${idx}`, 64) || `bl-${idx}`,
      nama: sanitizePlainText(raw.nama || raw.namaPekerja || `Pekerja ${idx + 1}`, 128) || `Pekerja ${idx + 1}`,
      stdJamPerUnit: clampFiniteNonNegative(raw.stdJamPerUnit, 0),
      ...(raw.unitMasa ? { unitMasa } : {}),
      stdKadarPerJam: clampFiniteNonNegative(raw.stdKadarPerJam, 0),
      sebenarJamJumlah: clampFiniteNonNegative(raw.sebenarJamJumlah ?? raw.sebenarJamTotal, 0),
      ...(sebenarUnitMasa ? { sebenarUnitMasa } : {}),
      sebenarKadarPerJam: clampFiniteNonNegative(raw.sebenarKadarPerJam, 0),
    };
  });

  const overheadBerubah: OverheadBerubah[] = varOhIn.map((o, idx) => {
    const raw = (o || {}) as any;
    return {
      id: sanitizePlainText(raw.id || `ob-${idx}`, 64) || `ob-${idx}`,
      nama: sanitizePlainText(raw.nama || raw.item || `Overhead ${idx + 1}`, 128) || `Overhead ${idx + 1}`,
      stdKosPerUnit: clampFiniteNonNegative(raw.stdKosPerUnit, 0),
      sebenarKosJumlah: clampFiniteNonNegative(raw.sebenarKosJumlah ?? raw.sebenarKosTotal, 0),
    };
  });

  const overheadTetap: OverheadTetap[] = fixOhIn.map((o, idx) => {
    const raw = (o || {}) as any;
    return {
      id: sanitizePlainText(raw.id || `ot-${idx}`, 64) || `ot-${idx}`,
      nama: sanitizePlainText(raw.nama || raw.item || `Kos Tetap ${idx + 1}`, 128) || `Kos Tetap ${idx + 1}`,
      stdKosMingguan: clampFiniteNonNegative(raw.stdKosMingguan, 0),
      sebenarKosJumlah: clampFiniteNonNegative(raw.sebenarKosJumlah ?? raw.sebenarKosMingguan, 0),
    };
  });

  const standardSummary = kiraRingkasanKosStandard(
    sanitizedConfig,
    bahanMentah,
    buruhLangsung,
    overheadBerubah,
    overheadTetap
  );
  const actualSummary = kiraRingkasanKosSebenar(
    sanitizedConfig,
    bahanMentah,
    buruhLangsung,
    overheadBerubah,
    overheadTetap
  );
  const qStd = Math.max(1, sanitizedConfig.sasaranKuantitiStandard || sanitizedConfig.kuantitiPengeluaranPiawai || 1);
  const qAct = Math.max(1, sanitizedConfig.kuantitiSebenarDijual || 1);

  const bepStandard = kiraAnalisisBEP(
    standardSummary.jumlahKosTetapMingguan,
    sanitizedConfig.hargaJualanStandard,
    standardSummary.jumlahKosBerubahSemangkuk,
    qStd
  );
  const bepActual = kiraAnalisisBEP(
    actualSummary.jumlahKosTetapMingguan,
    sanitizedConfig.hargaJualanSebenar,
    actualSummary.jumlahKosBerubahSemangkuk,
    qAct
  );
  const profitStandard = kiraProfitMargin(
    sanitizedConfig.hargaJualanStandard,
    standardSummary.kosPenuhSeunit
  );
  const profitActual = kiraProfitMargin(
    sanitizedConfig.hargaJualanSebenar,
    actualSummary.kosPenuhSeunit
  );

  const variances = {
    bahan: analisisVariansBahan(qAct, bahanMentah),
    buruh: analisisVariansBuruh(qAct, buruhLangsung),
    overheadBerubah: analisisVariansOverheadBerubah(qAct, overheadBerubah),
    overheadTetap: analisisVariansOverheadTetap(overheadTetap),
  };

  const discrepancies: string[] = [];
  if (input.clientSummary && typeof input.clientSummary === "object") {
    const tol = 0.05;
    if (
      typeof input.clientSummary.stdCostPerUnit === "number" &&
      Math.abs(input.clientSummary.stdCostPerUnit - standardSummary.kosPenuhSeunit) > tol
    ) {
      discrepancies.push("stdCostPerUnit");
    }
    if (
      typeof input.clientSummary.actCostPerUnit === "number" &&
      Math.abs(input.clientSummary.actCostPerUnit - actualSummary.kosPenuhSeunit) > tol
    ) {
      discrepancies.push("actCostPerUnit");
    }
    if (
      typeof input.clientSummary.stdNetProfit === "number" &&
      Math.abs(input.clientSummary.stdNetProfit - standardSummary.untungBersihMingguan) > tol
    ) {
      discrepancies.push("stdNetProfit");
    }
    if (
      typeof input.clientSummary.actNetProfit === "number" &&
      Math.abs(input.clientSummary.actNetProfit - actualSummary.untungBersihMingguan) > tol
    ) {
      discrepancies.push("actNetProfit");
    }
  }

  return {
    valid: discrepancies.length === 0,
    sanitizedConfig,
    standardSummary,
    actualSummary,
    bepStandard,
    bepActual,
    profitStandard,
    profitActual,
    variances,
    discrepancies,
  };
}
