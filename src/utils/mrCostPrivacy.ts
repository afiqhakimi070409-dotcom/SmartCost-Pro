/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mr Cost Data Boundary, PII Minimization, Output Verification & Safe Metadata Helpers.
 */

import crypto from "crypto";

export type MrCostQuestionType = "theory" | "data";

export const OUTPUT_BOUNDARY_REPLACEMENT_TEXT =
  "Saya hanya boleh melihat data perniagaan yang sedang dipilih.";

export const DATABASE_ACCESS_DENIED_MESSAGE = "Tidak dapat mengakses data ini";

/**
 * Generates a short irreversible SHA-256 hash for safe server logging (never logs business names).
 */
export function hashDatabaseIdShort(databaseId?: string | null): string {
  const clean = (databaseId || "").trim();
  if (!clean) return "none";
  return crypto.createHash("sha256").update(clean).digest("hex").slice(0, 10);
}

/**
 * Escapes any delimiter tags inside untrusted database strings so injected product names
 * cannot break out of <data_perniagaan>...</data_perniagaan>.
 */
export function sanitizeDelimiterText(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  const str = String(raw)
    .replace(/<\s*\/?\s*data_perniagaan\s*>/gi, "[data]")
    .replace(/[\r\n]+/g, " ")
    .trim();
  return redactPiiFromString(str);
}

/**
 * Redacts personal/confidential patterns (emails, phone numbers, Malaysian IC, SSM/bank patterns).
 */
export function redactPiiFromString(input: string): string {
  if (!input) return "";
  let out = input;
  // Emails
  out = out.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, "[EMEL_DISENSOR]");
  // Malaysian IC (e.g. 900101-14-5678 or 900101145678)
  out = out.replace(/\b\d{6}-?\d{2}-?\d{4}\b/g, "[NO_KP_DISENSOR]");
  // Phone numbers (+601x / 01x / 03-xxxx etc.)
  out = out.replace(/(?:\+?6?01\d[- ]?\d{3,4}[- ]?\d{4}|\+?6?0[2-9][- ]?\d{7,8})/g, "[TELEFON_DISENSOR]");
  // Explicit supplier/customer name patterns like "Pembekal: Ali" -> "Pembekal 1"
  let supplierCounter = 0;
  out = out.replace(/\b(?:pembekal|supplier)\s*[:\-]\s*[^,;|\n]+/gi, () => {
    supplierCounter += 1;
    return `Pembekal ${supplierCounter}`;
  });
  let customerCounter = 0;
  out = out.replace(/\b(?:pelanggan|customer|client)\s*[:\-]\s*[^,;|\n]+/gi, () => {
    customerCounter += 1;
    return `Pelanggan ${customerCounter}`;
  });
  return out;
}

/**
 * Classifies whether a user query requires active business database records ("data")
 * or is a general theory / user-typed-numbers question ("theory").
 * Mixed questions (theory + user business data) return "data".
 */
export function classifyMrCostQuestion(
  message: string,
  activeProductNames: string[] = []
): MrCostQuestionType {
  const lower = (message || "").toLowerCase().trim();
  if (!lower) return "theory";

  // 1. Direct match on any active product name stored in the current database
  for (const prod of activeProductNames) {
    const cleanProd = (prod || "").toLowerCase().trim();
    if (cleanProd.length >= 3 && lower.includes(cleanProd)) {
      return "data";
    }
  }

  // 2. Explicit reference to user's own active records/business/worksheet
  const activeDataKeywords = [
    "produk saya",
    "perniagaan saya",
    "kedai saya",
    "syarikat saya",
    "rekod saya",
    "data saya",
    "lembaran saya",
    "lembaran aktif",
    "lembaran kerja",
    "untung saya",
    "kos saya",
    "jualan saya",
    "margin saya",
    "bep saya",
    "titik pulang modal saya",
    "produk ini",
    "perniagaan ini",
    "produk aktif",
    "produk semasa",
    "produk kami",
    "syarikat ini",
    "kedai ini",
    "perniagaan kami",
    "rekod ini",
    "kos semasa",
    "dua produk saya",
    "semua produk saya",
    "my product",
    "my business",
    "my company",
    "my profit",
    "my cost",
    "my sales",
    "my margin",
    "my data",
    "active product",
    "current worksheet",
    "compare two products",
    "anomali",
    "anomaly",
    "anomalies",
    "peluang jimat",
    "penjimatan",
    "cost leakage",
    "reduce production cost",
    "kurangkan kos pengeluaran",
  ];

  for (const kw of activeDataKeywords) {
    if (lower.includes(kw)) {
      return "data";
    }
  }

  // 3. Simulation or pricing on active worksheet when NOT purely self-contained numbers
  const simulationPhrases = [
    "kalau harga tepung naik",
    "kalau bahan naik",
    "if flour",
    "if the price of raw flour",
    "kalau saya jual",
    "if i sell at",
    "sasaran margin",
    "target profit margin",
    "harga jualan yang sesuai",
    "recommended selling price",
    "simulasi kenaikan harga",
    "simulate a",
  ];
  for (const sp of simulationPhrases) {
    if (lower.includes(sp)) {
      return "data";
    }
  }

  // Cross-database probes (e.g., "database B", "kedai X", "tunjuk semua database")
  // and pure theory/calculation questions ("Apa itu margin sumbangan?", "Kos RM100 dan jualan RM150")
  // must NOT receive database records.
  return "theory";
}

export interface SafeBusinessContextInput {
  message: string;
  currency: string;
  productName: string;
  unitLabel: string;
  Q_std: number;
  P_std: number;
  Q_act: number;
  P_act: number;
  dmPerUnitStd: number;
  dlPerUnitStd: number;
  vohPerUnitStd: number;
  varCostPerUnitStd: number;
  totalFohStd: number;
  fullCostPerUnitStd: number;
  cmPerUnitStd: number;
  cmRatioStd: number;
  bepUnitsStd: number | null;
  bepRevenueStd: number | null;
  pricing30: number;
  pricing35: number;
  pricing40: number;
  bahanMentah?: Array<{ nama?: string; stdKuantitiPerUnit?: number; unit?: string; stdHargaPerUnit?: number }>;
  detectedAnomalies?: Array<{ tahap?: string; item?: string; sebab?: string }>;
  savingsOpportunities?: Array<{ kategori?: string; masalah?: string; anggaranPenjimatan?: string }>;
  otherProductsSummary?: Array<{
    namaProduk?: string;
    hargaJualan: number;
    kosBerubahSeunit: number;
    kosPenuhSeunit: number;
    marginCarumanSeunit: number;
    marginCarumanPercent: number;
    sasaranKuantiti: number;
  }>;
}

/**
 * Builds minimal, PII-free active-database context wrapped strictly inside
 * <data_perniagaan> ... </data_perniagaan> delimiters.
 */
export function buildSafeBusinessContextBlock(input: SafeBusinessContextInput): {
  contextBlock: string;
  includedRecordCount: number;
} {
  const lowerMsg = (input.message || "").toLowerCase();
  const safeCurrency = sanitizeDelimiterText(input.currency || "RM") || "RM";
  const safeProductName = sanitizeDelimiterText(input.productName || "Produk") || "Produk";
  const safeUnitLabel = sanitizeDelimiterText(input.unitLabel || "unit") || "unit";

  let recordCount = 1; // Active product record
  const lines: string[] = [
    `<data_perniagaan>`,
    `Produk Aktif: ${safeProductName} (${safeUnitLabel})`,
    `Kuantiti Standard: ${input.Q_std} | Harga Jualan Standard: ${safeCurrency} ${input.P_std.toFixed(2)}`,
    `Kuantiti Sebenar: ${input.Q_act} | Harga Jualan Sebenar: ${safeCurrency} ${input.P_act.toFixed(2)}`,
    `Kos Bahan/Unit: ${safeCurrency} ${input.dmPerUnitStd.toFixed(2)} | Kos Buruh/Unit: ${safeCurrency} ${input.dlPerUnitStd.toFixed(2)} | Overhead Berubah/Unit: ${safeCurrency} ${input.vohPerUnitStd.toFixed(2)}`,
    `Kos Berubah/Unit: ${safeCurrency} ${input.varCostPerUnitStd.toFixed(2)} | Overhead Tetap Mingguan: ${safeCurrency} ${input.totalFohStd.toFixed(2)} | Kos Penuh/Unit: ${safeCurrency} ${input.fullCostPerUnitStd.toFixed(2)}`,
    `Margin Caruman/Unit: ${safeCurrency} ${input.cmPerUnitStd.toFixed(2)} (${input.cmRatioStd.toFixed(1)}%) | BEP: ${input.bepUnitsStd !== null ? Math.ceil(input.bepUnitsStd) : "N/A"} ${safeUnitLabel}${input.bepRevenueStd !== null ? ` (${safeCurrency} ${input.bepRevenueStd.toFixed(2)})` : ""}`,
  ];

  // Include margin target prices only when question involves pricing/margin/profit
  const asksPricing =
    lowerMsg.includes("margin") ||
    lowerMsg.includes("harga") ||
    lowerMsg.includes("price") ||
    lowerMsg.includes("untung") ||
    lowerMsg.includes("profit") ||
    lowerMsg.includes("sebut harga") ||
    lowerMsg.includes("quotation");
  if (asksPricing) {
    lines.push(
      `Sasaran Harga Margin (30%/35%/40%): ${safeCurrency} ${input.pricing30.toFixed(2)} / ${safeCurrency} ${input.pricing35.toFixed(2)} / ${safeCurrency} ${input.pricing40.toFixed(2)}`
    );
  }

  // Include raw materials breakdown ONLY if relevant to question
  const asksMaterials =
    lowerMsg.includes("tepung") ||
    lowerMsg.includes("bahan") ||
    lowerMsg.includes("flour") ||
    lowerMsg.includes("ingredient") ||
    lowerMsg.includes("material") ||
    lowerMsg.includes("kurangkan kos") ||
    lowerMsg.includes("reduce") ||
    lowerMsg.includes("kos produk");
  if (asksMaterials && Array.isArray(input.bahanMentah) && input.bahanMentah.length > 0) {
    const mats = input.bahanMentah.slice(0, 12).map((b, idx) => {
      const mName = sanitizeDelimiterText(b.nama || `Bahan ${idx + 1}`);
      const q = Number(b.stdKuantitiPerUnit || 0);
      const u = sanitizeDelimiterText(b.unit || "unit");
      const p = Number(b.stdHargaPerUnit || 0);
      return `${mName} (${q} ${u} @ ${safeCurrency} ${p.toFixed(2)})`;
    });
    recordCount += mats.length;
    lines.push(`Komponen Bahan Utama: ${mats.join("; ")}`);
  }

  // Include anomalies / savings ONLY if relevant to question
  const asksAnomaliesOrSavings =
    lowerMsg.includes("anomali") ||
    lowerMsg.includes("anomaly") ||
    lowerMsg.includes("jimat") ||
    lowerMsg.includes("kurangkan") ||
    lowerMsg.includes("rendah") ||
    lowerMsg.includes("leakage") ||
    lowerMsg.includes("margin") ||
    lowerMsg.includes("reduce");

  if (asksAnomaliesOrSavings && Array.isArray(input.detectedAnomalies) && input.detectedAnomalies.length > 0) {
    const anomItems = input.detectedAnomalies.slice(0, 5).map((a) =>
      `[${sanitizeDelimiterText(a.tahap || "INFO").toUpperCase()}] ${sanitizeDelimiterText(a.item)}: ${sanitizeDelimiterText(a.sebab)}`
    );
    recordCount += anomItems.length;
    lines.push(`Anomali (${input.detectedAnomalies.length}): ${anomItems.join("; ")}`);
  }

  if (asksAnomaliesOrSavings && Array.isArray(input.savingsOpportunities) && input.savingsOpportunities.length > 0) {
    const savItems = input.savingsOpportunities.slice(0, 3).map((s) =>
      `${sanitizeDelimiterText(s.kategori)}: ${sanitizeDelimiterText(s.masalah)} (${sanitizeDelimiterText(s.anggaranPenjimatan)})`
    );
    recordCount += savItems.length;
    lines.push(`Peluang Penjimatan (${input.savingsOpportunities.length}): ${savItems.join("; ")}`);
  }

  // Include other products ONLY within the SAME active database and ONLY if comparing/listing products
  const otherProds = input.otherProductsSummary || [];
  const asksMultiProduct =
    lowerMsg.includes("banding") ||
    lowerMsg.includes("compare") ||
    lowerMsg.includes("dua produk") ||
    lowerMsg.includes("two products") ||
    lowerMsg.includes("semua produk") ||
    otherProds.some((p) => {
      const n = (p.namaProduk || "").toLowerCase().trim();
      return n.length >= 3 && lowerMsg.includes(n);
    });

  if (asksMultiProduct && otherProds.length > 1) {
    const prodLines = otherProds.slice(0, 10).map((p) =>
      `${sanitizeDelimiterText(p.namaProduk)} (Harga ${safeCurrency} ${p.hargaJualan.toFixed(2)}, Kos Penuh ${safeCurrency} ${p.kosPenuhSeunit.toFixed(2)}, Margin ${p.marginCarumanPercent.toFixed(1)}%)`
    );
    recordCount += prodLines.length - 1;
    lines.push(`Produk Lain Dalam Perniagaan Aktif: ${prodLines.join("; ")}`);
  }

  lines.push(`</data_perniagaan>`);
  return {
    contextBlock: lines.join("\n"),
    includedRecordCount: recordCount,
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Second-layer server output validation:
 * Checks AI response against unauthorized database names & IDs (full-name match only).
 * Ignores names also present in the active database to prevent false positives.
 */
export function sanitizeXssText(input: string): string {
  if (!input) return "";
  return input
    .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<\s*\/?\s*(?:script|iframe|object|embed|form|meta|link|style)[^>]*>/gi, "")
    .replace(/\bon[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript\s*:/gi, "blocked:")
    .replace(/vbscript\s*:/gi, "blocked:");
}

export function validateMrCostOutput(
  responseText: string,
  forbiddenEntries: Array<{ databaseId: string; companyName: string }>,
  activeAllowedNames: string[] = []
): { blocked: boolean; safeText: string } {
  const text = sanitizeXssText(responseText || "");
  if (!text.trim() || !Array.isArray(forbiddenEntries) || forbiddenEntries.length === 0) {
    return { blocked: false, safeText: text };
  }

  const allowedSet = new Set(
    activeAllowedNames
      .map((n) => (n || "").trim().toLowerCase())
      .filter((n) => n.length >= 2)
  );

  // Generic system placeholders that should not trigger false positives if duplicated
  allowedSet.add("school enterprise");
  allowedSet.add("developer sandbox");
  allowedSet.add("sandbox pembangun");

  for (const entry of forbiddenEntries) {
    const candidates = [entry.companyName, entry.databaseId];
    for (const candidate of candidates) {
      const clean = (candidate || "").trim();
      if (clean.length < 4) continue;
      if (allowedSet.has(clean.toLowerCase())) continue;

      const pattern = new RegExp(`(?<![a-zA-Z0-9_])${escapeRegex(clean)}(?![a-zA-Z0-9_])`, "i");
      if (pattern.test(text)) {
        return {
          blocked: true,
          safeText: OUTPUT_BOUNDARY_REPLACEMENT_TEXT,
        };
      }
    }
  }

  return { blocked: false, safeText: text };
}

/**
 * Strips sensitive/PII fields from arbitrary businessData objects.
 */
export function stripSensitiveBusinessData(businessData: any): any {
  if (!businessData || typeof businessData !== "object") return {};
  const rawConfig = businessData.config && typeof businessData.config === "object" ? businessData.config : {};
  const {
    kataLaluanLogMasuk: _pw,
    password: _rawPw,
    passwordHash: _pwHash,
    salt: _salt,
    usernameLogMasuk: _un,
    generalSetup: _gs,
    email: _em,
    phone: _ph,
    phone1: _p1,
    phone2: _p2,
    address: _ad,
    addressLine1: _a1,
    addressLine2: _a2,
    bankAccount: _ba,
    bankAccountNo: _bno,
    businessRegNo: _ssm,
    ...safeConfig
  } = rawConfig;

  return {
    config: safeConfig,
    bahanMentah: Array.isArray(businessData.bahanMentah) ? businessData.bahanMentah : [],
    buruhLangsung: Array.isArray(businessData.buruhLangsung) ? businessData.buruhLangsung : [],
    overheadBerubah: Array.isArray(businessData.overheadBerubah) ? businessData.overheadBerubah : [],
    overheadTetap: Array.isArray(businessData.overheadTetap) ? businessData.overheadTetap : [],
    templates: Array.isArray(businessData.templates) ? businessData.templates : [],
  };
}
