/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BahanMentah, BuruhLangsung, OverheadBerubah, OverheadTetap, KonfigurasiSistem } from "../types.ts";

// ============================================================================
// 1. KECERDASAN UNIT DAN PENUKARAN (UNIT INTELLIGENCE & CONVERSION ENGINE)
// ============================================================================

export type UnitCategory = "mass" | "volume" | "length" | "time" | "count" | "unknown";

export interface UnitDefinition {
  canonical: string;
  category: UnitCategory;
  factorToBase: number; // Factor to convert this unit into the base unit of the category
  aliases: string[];
}

// Base units:
// mass: gram (g)
// volume: mililiter (ml)
// length: milimeter (mm)
// time: minit (min)
// count: unit (unit)
export const UNIT_DEFINITIONS: Record<string, UnitDefinition> = {
  // --- Jisim / Berat (Base: gram) ---
  mg: { canonical: "mg", category: "mass", factorToBase: 0.001, aliases: ["mg", "miligram", "milligram", "milligrams"] },
  g: { canonical: "g", category: "mass", factorToBase: 1, aliases: ["g", "gram", "grams", "gm"] },
  kg: { canonical: "kg", category: "mass", factorToBase: 1000, aliases: ["kg", "kilogram", "kilograms", "kilo", "kilos"] },
  tan: { canonical: "tan", category: "mass", factorToBase: 1000000, aliases: ["tan", "ton", "tonne", "tonnes", "metric ton", "metric tonnes"] },
  lbs: { canonical: "lbs", category: "mass", factorToBase: 453.59237, aliases: ["lb", "lbs", "pound", "pounds"] },
  oz: { canonical: "oz", category: "mass", factorToBase: 28.3495, aliases: ["oz", "ounce", "ounces"] },

  // --- Isipadu / Cecair (Base: mililiter) ---
  ml: { canonical: "ml", category: "volume", factorToBase: 1, aliases: ["ml", "mililiter", "milliliter", "milliliters", "cc"] },
  l: { canonical: "L", category: "volume", factorToBase: 1000, aliases: ["l", "liter", "liters", "ltr", "litre", "litres"] },

  // --- Ukuran Panjang (Base: milimeter) ---
  mm: { canonical: "mm", category: "length", factorToBase: 1, aliases: ["mm", "milimeter", "millimeter", "millimeters"] },
  cm: { canonical: "cm", category: "length", factorToBase: 10, aliases: ["cm", "sentimeter", "centimeter", "centimeters"] },
  m: { canonical: "m", category: "length", factorToBase: 1000, aliases: ["m", "meter", "metre", "meters", "metres"] },

  // --- Masa (Base: minit) ---
  s: { canonical: "saat", category: "time", factorToBase: 1 / 60, aliases: ["s", "sec", "saat", "second", "seconds"] },
  min: { canonical: "minit", category: "time", factorToBase: 1, aliases: ["min", "minit", "minute", "minutes"] },
  jam: { canonical: "jam", category: "time", factorToBase: 60, aliases: ["jam", "hr", "hour", "hours", "hrs"] },
  hari: { canonical: "hari", category: "time", factorToBase: 1440, aliases: ["hari", "day", "days"] },

  // --- Kuantiti / Bilangan (Base: unit) ---
  unit: { canonical: "unit", category: "count", factorToBase: 1, aliases: ["unit", "units", "pcs", "piece", "pieces"] },
  keping: { canonical: "keping", category: "count", factorToBase: 1, aliases: ["keping", "kpg", "sheet", "sheets", "slice", "slices"] },
  batang: { canonical: "batang", category: "count", factorToBase: 1, aliases: ["batang", "roll", "rolls", "stick", "sticks"] },
  cucuk: { canonical: "cucuk", category: "count", factorToBase: 1, aliases: ["cucuk", "skewer", "skewers"] },
  pinggan: { canonical: "pinggan", category: "count", factorToBase: 1, aliases: ["pinggan", "plate", "plates", "servings", "serving"] },
  cawan: { canonical: "cawan", category: "count", factorToBase: 1, aliases: ["cawan", "cup", "cups"] },
  bungkus: { canonical: "bungkus", category: "count", factorToBase: 1, aliases: ["bungkus", "pack", "packs", "packet", "packets"] },
  pek: { canonical: "pek", category: "count", factorToBase: 1, aliases: ["pek", "peket"] },
  biji: { canonical: "biji", category: "count", factorToBase: 1, aliases: ["biji", "bj", "buah"] },
  bekas: { canonical: "bekas", category: "count", factorToBase: 1, aliases: ["bekas", "container", "containers", "tub", "bks"] },
  botol: { canonical: "botol", category: "count", factorToBase: 1, aliases: ["botol", "bottle", "bottles", "btl"] },
  set: { canonical: "set", category: "count", factorToBase: 1, aliases: ["set", "sets"] },
  dozen: { canonical: "dozen", category: "count", factorToBase: 12, aliases: ["dozen", "doz", "selusin"] },
  kotak: { canonical: "kotak", category: "count", factorToBase: 1, aliases: ["kotak", "box", "boxes"] },
  karton: { canonical: "karton", category: "count", factorToBase: 1, aliases: ["karton", "carton", "ctn"] },
};

/**
 * Normalizes a unit string into its canonical representation.
 */
export function normalizeUnit(rawUnit: string): { canonical: string; category: UnitCategory } {
  if (!rawUnit) return { canonical: "unit", category: "count" };
  const clean = rawUnit.trim().toLowerCase();

  for (const [, def] of Object.entries(UNIT_DEFINITIONS)) {
    if (def.aliases.includes(clean)) {
      return { canonical: def.canonical, category: def.category };
    }
  }

  return { canonical: rawUnit.trim(), category: "unknown" };
}

/**
 * Checks if two units are compatible for direct mathematical conversion.
 */
export function areUnitsCompatible(unitA: string, unitB: string): boolean {
  const normA = normalizeUnit(unitA);
  const normB = normalizeUnit(unitB);

  if (normA.category === "unknown" || normB.category === "unknown") {
    return normA.canonical.toLowerCase() === normB.canonical.toLowerCase();
  }

  return normA.category === normB.category;
}

export interface UnitConversionResult {
  success: boolean;
  ratio?: number; // Multiply quantity in fromUnit by ratio to get quantity in toUnit
  convertedValue?: number;
  explanation: string;
}

/**
 * Converts a quantity from one unit to another within the same category.
 * E.g., 500 g to kg => 0.5 kg.
 * 1 kg to g => 1,000 g.
 */
export function convertUnit(
  value: number,
  fromUnit: string,
  toUnit: string
): UnitConversionResult {
  const normFrom = normalizeUnit(fromUnit);
  const normTo = normalizeUnit(toUnit);

  if (normFrom.canonical.toLowerCase() === normTo.canonical.toLowerCase()) {
    return {
      success: true,
      ratio: 1,
      convertedValue: value,
      explanation: `${value} ${normFrom.canonical} bersamaan ${value} ${normTo.canonical} (unit sama).`,
    };
  }

  if (normFrom.category !== normTo.category || normFrom.category === "unknown") {
    return {
      success: false,
      explanation: `Unit '${fromUnit}' (${normFrom.category}) dan '${toUnit}' (${normTo.category}) tidak serasi untuk penukaran terus tanpa faktor ketumpatan atau bilangan pek khusus.`,
    };
  }

  // Find definitions
  const defFrom = Object.values(UNIT_DEFINITIONS).find((d) => d.aliases.includes(fromUnit.trim().toLowerCase()));
  const defTo = Object.values(UNIT_DEFINITIONS).find((d) => d.aliases.includes(toUnit.trim().toLowerCase()));

  if (!defFrom || !defTo) {
    return {
      success: false,
      explanation: `Definisi unit untuk '${fromUnit}' atau '${toUnit}' tidak ditemui dalam pustaka piawai.`,
    };
  }

  // Convert to base, then base to target
  const valueInBase = value * defFrom.factorToBase;
  const convertedValue = valueInBase / defTo.factorToBase;
  const ratio = defFrom.factorToBase / defTo.factorToBase;

  return {
    success: true,
    ratio,
    convertedValue,
    explanation: `${value} ${defFrom.canonical} bersamaan dengan ${convertedValue.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${defTo.canonical}. (1 ${defFrom.canonical} = ${ratio} ${defTo.canonical})`,
  };
}

/**
 * Solves standard material costing when purchase unit differs from recipe/usage unit.
 * Example (Ujian C):
 * Purchase 1 kg @ RM20.00. Usage is 500 g.
 * Result: RM 10.00.
 */
export function calculateUsageCostFromPurchase({
  purchasePrice,
  purchaseQty = 1,
  purchaseUnit,
  usageQty,
  usageUnit,
}: {
  purchasePrice: number;
  purchaseQty?: number;
  purchaseUnit: string;
  usageQty: number;
  usageUnit: string;
}): {
  success: boolean;
  cost: number;
  pricePerUsageUnit: number;
  explanation: string;
} {
  if (purchaseQty <= 0) {
    return {
      success: false,
      cost: 0,
      pricePerUsageUnit: 0,
      explanation: "Kuantiti pembelian mestilah melebihi sifar.",
    };
  }

  const conversion = convertUnit(usageQty, usageUnit, purchaseUnit);

  if (!conversion.success || conversion.convertedValue === undefined) {
    return {
      success: false,
      cost: 0,
      pricePerUsageUnit: 0,
      explanation: conversion.explanation,
    };
  }

  const effectivePurchaseRate = purchasePrice / purchaseQty; // Harga seunit belian
  const cost = conversion.convertedValue * effectivePurchaseRate;
  const pricePerUsageUnit = usageQty > 0 ? cost / usageQty : 0;

  return {
    success: true,
    cost: Number(cost.toFixed(4)),
    pricePerUsageUnit: Number(pricePerUsageUnit.toFixed(4)),
    explanation: `Kadar belian: RM${effectivePurchaseRate.toFixed(2)}/${purchaseUnit}. Penggunaan ${usageQty} ${usageUnit} bersamaan ${conversion.convertedValue} ${purchaseUnit}. Kos bahan: RM${cost.toFixed(2)}.`,
  };
}

// ============================================================================
// 2. PENGESANAN KESILAPAN DAN ANOMALI (ANOMALY & ERROR DETECTION ENGINE)
// ============================================================================

export interface AnomaliData {
  id: string;
  tahap: "kritikal" | "amaran" | "maklumat";
  kategori: string;
  item: string;
  sebab: string;
  cadangan: string;
  suggestedFixValue?: {
    hargaJualanStandard?: number;
    sasaranKuantitiStandard?: number;
  };
}

export function auditDataPerniagaan({
  config,
  bahanMentah = [],
  buruhLangsung = [],
  overheadBerubah = [],
  overheadTetap = [],
  language = "en",
}: {
  config: KonfigurasiSistem;
  bahanMentah?: BahanMentah[];
  buruhLangsung?: BuruhLangsung[];
  overheadBerubah?: OverheadBerubah[];
  overheadTetap?: OverheadTetap[];
  language?: "en" | "ms";
}): AnomaliData[] {
  const anomali: AnomaliData[] = [];
  const isEn = language === "en";
  const currency = config.currency || "RM";

  const Q_std = Number(config.sasaranKuantitiStandard || 0);
  const Q_act = Number(config.kuantitiSebenarDijual || 0);
  const P_std = Number(config.hargaJualanStandard || 0);
  const P_act = Number(config.hargaJualanSebenar || 0);

  // 1. Kuantiti kosong atau tidak munasabah
  if (Q_std <= 0) {
    anomali.push({
      id: "qty-std-zero",
      tahap: "kritikal",
      kategori: isEn ? "Target Volume" : "Kuantiti Sasaran",
      item: isEn ? "Standard Target Volume" : "Sasaran Kuantiti Standard",
      sebab: isEn 
        ? "Standard target volume is 0 or negative, preventing unit cost and break-even calculations." 
        : "Sasaran kuantiti standard bernilai 0 atau negatif, menyebabkan pengiraan kos seunit dan BEP tidak dapat dijana.",
      cadangan: isEn
        ? "Enter a realistic weekly production target (e.g., 500 or 1,000 units)."
        : "Masukkan sasaran kuantiti pengeluaran mingguan yang realistik (cth: 500 atau 1,000 unit).",
      suggestedFixValue: { sasaranKuantitiStandard: 1000 },
    });
  }

  if (Q_act < 0) {
    anomali.push({
      id: "qty-act-negative",
      tahap: "kritikal",
      kategori: isEn ? "Actual Volume" : "Kuantiti Sebenar",
      item: isEn ? "Actual Quantity Sold" : "Kuantiti Sebenar Dijual",
      sebab: isEn ? "Actual quantity sold cannot be negative." : "Kuantiti jualan sebenar bernilai negatif.",
      cadangan: isEn ? "Correct actual quantity to a positive number or 0." : "Betulkan nilai kuantiti sebenar kepada angka positif atau 0 jika tiada jualan.",
    });
  }

  // 2. Harga jualan tidak sah
  if (P_std <= 0) {
    anomali.push({
      id: "price-std-zero",
      tahap: "kritikal",
      kategori: isEn ? "Selling Price" : "Harga Jualan",
      item: isEn ? "Standard Selling Price" : "Harga Jualan Standard",
      sebab: isEn ? "Standard selling price is 0 or negative." : "Harga jualan standard adalah RM0.00 atau negatif.",
      cadangan: isEn
        ? "Set a profitable selling price that recovers raw materials, labor, overhead, and provides target margin."
        : "Tetapkan harga jualan yang menampung kos bahan, buruh, dan margin keuntungan yang disasarkan.",
      suggestedFixValue: { hargaJualanStandard: 4.49 },
    });
  }

  // 3. Kira kos berubah seunit standard
  const kosBahanSeunitStd = bahanMentah.reduce((acc, b) => acc + (b.stdKuantitiPerUnit * b.stdHargaPerUnit), 0);
  const kosBuruhSeunitStd = buruhLangsung.reduce((acc, l) => acc + (l.stdJamPerUnit * l.stdKadarPerJam), 0);
  const kosOverheadBerubahSeunitStd = overheadBerubah.reduce((acc, o) => acc + o.stdKosPerUnit, 0);
  const jumlahKosBerubahSeunitStd = kosBahanSeunitStd + kosBuruhSeunitStd + kosOverheadBerubahSeunitStd;

  const kosTetapStdMingguan = overheadTetap.reduce((acc, t) => acc + t.stdKosMingguan, 0);
  const kosTetapSeunitStd = Q_std > 0 ? kosTetapStdMingguan / Q_std : 0;
  const jumlahKosPenuhSeunitStd = jumlahKosBerubahSeunitStd + kosTetapSeunitStd;

  // 4. Harga jualan lebih rendah daripada kos (Selling price below cost)
  if (P_std > 0 && P_std < jumlahKosBerubahSeunitStd) {
    // Healthy recommended price for ~35% margin on full cost (e.g., RM 4.49)
    const targetHealthyPrice = Number((jumlahKosPenuhSeunitStd / (1 - 0.35)).toFixed(2)) || 4.49;
    const roundedRecommended = Math.max(4.49, targetHealthyPrice);

    anomali.push({
      id: "price-below-variable-cost",
      tahap: "kritikal",
      kategori: isEn ? "Margin Deficit" : "Ketirisan Margin",
      item: isEn ? "Standard Selling Price" : "Harga Jualan Standard",
      sebab: isEn
        ? `Selling price (${currency}${P_std.toFixed(2)}) is LOWER than variable cost per unit (${currency}${jumlahKosBerubahSeunitStd.toFixed(2)}). This yields a negative contribution margin (-${currency}${(jumlahKosBerubahSeunitStd - P_std).toFixed(2)}/unit). Every unit sold incurs a direct loss.`
        : `Harga jualan (${currency}${P_std.toFixed(2)}) adalah LEBIH RENDAH daripada kos berubah seunit (${currency}${jumlahKosBerubahSeunitStd.toFixed(2)}). Ini menghasilkan margin caruman negatif (-${currency}${(jumlahKosBerubahSeunitStd - P_std).toFixed(2)}/unit). Setiap unit yang dijual mengalami kerugian langsung.`,
      cadangan: isEn
        ? `Increase selling price to at least ${currency}${jumlahKosBerubahSeunitStd.toFixed(2)}, or recommended ${currency}${roundedRecommended.toFixed(2)} for a healthy ~35% margin.`
        : `Naikkan harga jualan sekurang-kurangnya ke atas ${currency}${jumlahKosBerubahSeunitStd.toFixed(2)}, atau disyorkan ${currency}${roundedRecommended.toFixed(2)} untuk sasaran margin ~35%.`,
      suggestedFixValue: { hargaJualanStandard: roundedRecommended },
    });
  } else if (P_std > 0 && P_std < jumlahKosPenuhSeunitStd) {
    const targetHealthyPrice = Number((jumlahKosPenuhSeunitStd / (1 - 0.30)).toFixed(2)) || 4.00;
    anomali.push({
      id: "price-below-full-cost",
      tahap: "amaran",
      kategori: isEn ? "Net Operating Loss" : "Kerugian Bersih",
      item: isEn ? "Standard Selling Price" : "Harga Jualan Standard",
      sebab: isEn
        ? `Selling price (${currency}${P_std.toFixed(2)}) covers variable costs but fails to absorb fixed overhead (total full cost per unit is ${currency}${jumlahKosPenuhSeunitStd.toFixed(2)}).`
        : `Harga jualan (${currency}${P_std.toFixed(2)}) menampung kos berubah tetapi tidak mencukupi untuk menampung kos tetap (jumlah kos penuh seunit ${currency}${jumlahKosPenuhSeunitStd.toFixed(2)}).`,
      cadangan: isEn
        ? `Consider adjusting selling price to at least ${currency}${targetHealthyPrice.toFixed(2)} or expanding sales volume beyond break-even.`
        : `Pertimbangkan menaikkan harga jualan kepada sekurang-kurangnya ${currency}${targetHealthyPrice.toFixed(2)} atau meningkatkan volum jualan melepasi Titik Pulang Modal.`,
      suggestedFixValue: { hargaJualanStandard: targetHealthyPrice },
    });
  }

  // 5. Margin keuntungan luar biasa
  if (P_std > 0 && jumlahKosBerubahSeunitStd > 0) {
    const marginStdPercent = ((P_std - jumlahKosBerubahSeunitStd) / P_std) * 100;
    if (marginStdPercent > 92) {
      anomali.push({
        id: "margin-unusually-high",
        tahap: "maklumat",
        kategori: isEn ? "Unusual Margin" : "Margin Luar Biasa",
        item: isEn ? "Contribution Margin" : "Margin Caruman Standard",
        sebab: isEn
          ? `Contribution margin is unusually high (${marginStdPercent.toFixed(1)}%). Please check whether any raw materials or labor expenses were omitted.`
          : `Margin caruman adalah sangat tinggi (${marginStdPercent.toFixed(1)}%). Sila sahkan sama ada ada kos bahan mentah atau buruh yang tertinggal dalam lembaran.`,
        cadangan: isEn
          ? "Verify that all packaging, direct labor, and utility costs are registered."
          : "Semak semula senarai bahan dan overhead untuk memastikan tiada komponen kos yang tercicir.",
      });
    }
  }

  // 6. Kos negatif atau tidak munasabah dalam item
  bahanMentah.forEach((b, idx) => {
    if (b.stdHargaPerUnit < 0 || b.sebenarHargaPerUnit < 0 || b.stdKuantitiPerUnit < 0 || b.sebenarKuantitiJumlah < 0) {
      anomali.push({
        id: `bm-negative-${b.id || idx}`,
        tahap: "kritikal",
        kategori: isEn ? "Negative Cost" : "Kos Negatif",
        item: `${isEn ? "Material: " : "Bahan: "}${b.nama}`,
        sebab: isEn ? "Raw material quantity or unit price contains negative numbers." : "Nilai kuantiti atau harga bahan mentah mengandungi angka negatif.",
        cadangan: isEn ? "Update to valid positive figures." : "Kemas kini nilai kepada nombor positif yang sah.",
      });
    }

    // Peningkatan kos bahan yang ketara (> 20%)
    if (b.stdHargaPerUnit > 0 && b.sebenarHargaPerUnit > 0) {
      const lonjakan = ((b.sebenarHargaPerUnit - b.stdHargaPerUnit) / b.stdHargaPerUnit) * 100;
      if (lonjakan >= 20) {
        anomali.push({
          id: `bm-surge-${b.id || idx}`,
          tahap: "amaran",
          kategori: isEn ? "Material Price Surge" : "Lonjakan Harga Bahan",
          item: `${isEn ? "Material: " : "Bahan: "}${b.nama}`,
          sebab: isEn
            ? `Actual price (${currency}${b.sebenarHargaPerUnit.toFixed(2)}) surged by ${lonjakan.toFixed(1)}% compared to standard (${currency}${b.stdHargaPerUnit.toFixed(2)}).`
            : `Harga sebenar (${currency}${b.sebenarHargaPerUnit.toFixed(2)}) melonjak sebanyak ${lonjakan.toFixed(1)}% berbanding harga standard (${currency}${b.stdHargaPerUnit.toFixed(2)}).`,
          cadangan: isEn
            ? "Renegotiate volume discounts with vendor or evaluate alternative suppliers."
            : "Runding semula harga pukal dengan pembekal atau teroka pembekal alternatif bagi membendung varians harga buruk.",
        });
      }
    }

    // Unit semakan
    if (!b.unit || b.unit.trim() === "") {
      anomali.push({
        id: `bm-empty-unit-${b.id || idx}`,
        tahap: "maklumat",
        kategori: isEn ? "Missing Unit" : "Unit Bahan Tidak Lengkap",
        item: `${isEn ? "Material: " : "Bahan: "}${b.nama}`,
        sebab: isEn ? "No measurement unit specified for this raw material." : "Tiada unit pengukuran (cth: kg, g, liter, unit) dinyatakan untuk bahan ini.",
        cadangan: isEn ? "Specify exact unit of measurement (e.g. kg, sheets, lbs)." : "Nyatakan unit bahan yang tepat untuk memastikan ketepatan penukaran sukatan.",
      });
    }
  });

  buruhLangsung.forEach((bl, idx) => {
    if (bl.stdKadarPerJam < 0 || bl.sebenarKadarPerJam < 0 || bl.stdJamPerUnit < 0 || bl.sebenarJamJumlah < 0) {
      anomali.push({
        id: `bl-negative-${bl.id || idx}`,
        tahap: "kritikal",
        kategori: isEn ? "Negative Rate" : "Kos Negatif",
        item: `${isEn ? "Labor: " : "Buruh: "}${bl.nama}`,
        sebab: isEn ? "Labor rate or hours contain negative values." : "Kadar jam atau bilangan jam buruh mengandungi nilai negatif.",
        cadangan: isEn ? "Correct values to positive numbers." : "Betulkan nilai kepada angka positif.",
      });
    }
  });

  // 7. Maklumat produk belum lengkap
  if (bahanMentah.length === 0) {
    anomali.push({
      id: "empty-raw-materials",
      tahap: "amaran",
      kategori: isEn ? "Incomplete Data" : "Data Tidak Lengkap",
      item: isEn ? "Raw Materials List" : "Senarai Bahan Mentah",
      sebab: isEn ? "No direct raw materials entered in worksheet." : "Tiada sebarang bahan mentah didaftarkan dalam lembaran produk.",
      cadangan: isEn ? "Add key ingredients or materials to calculate production cost." : "Tambah sekurang-kurangnya satu bahan mentah utama untuk mengira kos pengeluaran yang tepat.",
    });
  }

  return anomali;
}

// ============================================================================
// 3. PENGIRAAN DETERMINISTIK KEWANGAN (DETERMINISTIC FINANCIAL ENGINE)
// ============================================================================

export interface TestResultDetails {
  ujian: string;
  input: Record<string, any>;
  hasil: any;
  status: "LULUS" | "GAGAL";
  catatan: string;
}

/**
 * Ujian A: Kos Seunit
 * Jumlah kos / Kuantiti unit.
 * RM100 untuk 10 unit => RM10.00 seunit.
 * Melindungi dari pembahagian dengan sifar!
 */
export function kiraKosSeunit(totalCost: number, totalUnits: number): {
  kosSeunit: number;
  bolehDikira: boolean;
  penjelasan: string;
} {
  if (totalUnits <= 0) {
    return {
      kosSeunit: 0,
      bolehDikira: false,
      penjelasan: "Kuantiti pengeluaran ialah sifar atau tidak sah. Kos seunit tidak boleh dikira (mengelakkan pembahagian dengan sifar).",
    };
  }

  const kosSeunit = totalCost / totalUnits;
  return {
    kosSeunit: Number(kosSeunit.toFixed(4)),
    bolehDikira: true,
    penjelasan: `Jumlah kos RM${totalCost.toFixed(2)} dibahagi dengan ${totalUnits} unit = RM${kosSeunit.toFixed(2)} seunit.`,
  };
}

/**
 * Ujian B: Margin Keuntungan & Penetapan Harga Jualan
 * Formula Perakaunan Pengurusan Rasmi:
 * Margin Keuntungan % = (Harga Jualan - Kos Seunit) / Harga Jualan * 100%
 * Harga Jualan = Kos Seunit / (1 - Margin%)
 * Contoh: Kos RM10.00, Margin 30% => RM10 / (1 - 0.30) = RM10 / 0.70 = RM14.2857... ≈ RM14.29.
 */
export function kiraHargaDariSasaranMargin(
  unitCost: number,
  targetMarginPercent: number
): {
  hargaJualan: number;
  keuntunganSeunit: number;
  marginSebenarPercent: number;
  penjelasan: string;
} {
  if (targetMarginPercent >= 100) {
    return {
      hargaJualan: 0,
      keuntunganSeunit: 0,
      marginSebenarPercent: 0,
      penjelasan: "Sasaran margin keuntungan tidak boleh mencecah 100% ke atas kerana formula Harga = Kos / (1 - Margin) memerlukan pembahagi melebihi sifar.",
    };
  }

  const marginDecimal = targetMarginPercent / 100;
  const hargaJualanExact = unitCost / (1 - marginDecimal);
  const hargaJualanRounded = Number(hargaJualanExact.toFixed(2));
  const keuntunganSeunit = Number((hargaJualanRounded - unitCost).toFixed(2));
  const marginSebenarPercent = hargaJualanRounded > 0 ? (keuntunganSeunit / hargaJualanRounded) * 100 : 0;

  return {
    hargaJualan: hargaJualanRounded,
    keuntunganSeunit,
    marginSebenarPercent: Number(marginSebenarPercent.toFixed(2)),
    penjelasan: `Formula: Harga Jualan = Kos / (1 - Margin%). Pengiraan: RM${unitCost.toFixed(2)} / (1 - ${marginDecimal.toFixed(2)}) = RM${unitCost.toFixed(2)} / ${(1 - marginDecimal).toFixed(2)} = RM${hargaJualanExact.toFixed(4)}... dibundarkan kepada RM${hargaJualanRounded.toFixed(2)}. Untung seunit: RM${keuntunganSeunit.toFixed(2)} (Margin: ${marginSebenarPercent.toFixed(1)}%).`,
  };
}

/**
 * Ujian D: Kenaikan Kos (Inflation / Cost Surge)
 * Kos asal RM100 meningkat 15% => RM115.00.
 */
export function kiraKenaikanKos(
  kosAsal: number,
  peratusKenaikan: number
): {
  kosBaharu: number;
  nilaiKenaikan: number;
  penjelasan: string;
} {
  const kenaikanDecimal = peratusKenaikan / 100;
  const nilaiKenaikan = kosAsal * kenaikanDecimal;
  const kosBaharu = kosAsal + nilaiKenaikan;

  return {
    kosBaharu: Number(kosBaharu.toFixed(2)),
    nilaiKenaikan: Number(nilaiKenaikan.toFixed(2)),
    penjelasan: `Kos asal RM${kosAsal.toFixed(2)} + kenaikan ${peratusKenaikan}% (RM${nilaiKenaikan.toFixed(2)}) = Kos baharu RM${kosBaharu.toFixed(2)}.`,
  };
}

/**
 * Menjalankan siri Ujian Ketepatan (A, B, C, D, E) untuk pengesahan automatik.
 */
export function jalankanUjianPengesahanMatematik(): TestResultDetails[] {
  const ujian: TestResultDetails[] = [];

  // Ujian A: Kos seunit RM100 untuk 10 unit => RM10.00
  const resA = kiraKosSeunit(100, 10);
  ujian.push({
    ujian: "Ujian A — Kos Seunit",
    input: { totalCost: 100, totalUnits: 10 },
    hasil: resA.kosSeunit,
    status: Math.abs(resA.kosSeunit - 10.00) < 0.001 ? "LULUS" : "GAGAL",
    catatan: `Hasil didapati: RM${resA.kosSeunit.toFixed(2)} (Jangkaan: RM10.00).`,
  });

  // Ujian B: Margin 30% pada kos RM10.00 => RM14.29
  const resB = kiraHargaDariSasaranMargin(10, 30);
  ujian.push({
    ujian: "Ujian B — Margin Keuntungan",
    input: { unitCost: 10, targetMarginPercent: 30 },
    hasil: resB.hargaJualan,
    status: Math.abs(resB.hargaJualan - 14.29) < 0.01 ? "LULUS" : "GAGAL",
    catatan: `Hasil didapati: RM${resB.hargaJualan.toFixed(2)} (Jangkaan: RM14.29 berasaskan RM10 / 0.70).`,
  });

  // Ujian C: Beli 1 kg @ RM20.00, guna 500 g => RM10.00
  const resC = calculateUsageCostFromPurchase({
    purchasePrice: 20,
    purchaseQty: 1,
    purchaseUnit: "kg",
    usageQty: 500,
    usageUnit: "g",
  });
  ujian.push({
    ujian: "Ujian C — Penukaran Unit",
    input: { purchase: "1 kg @ RM20.00", usage: "500 g" },
    hasil: resC.cost,
    status: Math.abs(resC.cost - 10.00) < 0.001 ? "LULUS" : "GAGAL",
    catatan: `Hasil didapati: RM${resC.cost.toFixed(2)} (Jangkaan: RM10.00).`,
  });

  // Ujian D: Kenaikan kos RM100 sebanyak 15% => RM115.00
  const resD = kiraKenaikanKos(100, 15);
  ujian.push({
    ujian: "Ujian D — Kenaikan Kos",
    input: { kosAsal: 100, peratusKenaikan: 15 },
    hasil: resD.kosBaharu,
    status: Math.abs(resD.kosBaharu - 115.00) < 0.001 ? "LULUS" : "GAGAL",
    catatan: `Hasil didapati: RM${resD.kosBaharu.toFixed(2)} (Jangkaan: RM115.00).`,
  });

  // Ujian E: Kuantiti pengeluaran sifar tidak membahagi dengan sifar
  const resE = kiraKosSeunit(100, 0);
  ujian.push({
    ujian: "Ujian E — Data Tidak Lengkap / Kuantiti Sifar",
    input: { totalCost: 100, totalUnits: 0 },
    hasil: resE.bolehDikira ? resE.kosSeunit : "Tidak dibenarkan (Selamat)",
    status: !resE.bolehDikira && !isNaN(resE.kosSeunit) ? "LULUS" : "GAGAL",
    catatan: "Sistem berjaya mengesan kuantiti 0 dan menghalang pembahagian dengan sifar secara selamat.",
  });

  return ujian;
}

// ============================================================================
// 4. CADANGAN SIMULASI BERASINGAN (SEPARATE SIMULATION PROPOSAL ENGINE)
// ============================================================================

export interface CadanganSimulasi {
  id: string;
  tajuk: string;
  tarikhDibuat: Date;
  status: "cadangan_berasingan";
  ringkasanPerubahan: string;
  dataAsal: {
    hargaJualan: number;
    kosBerubahSeunit: number;
    kosTetapMingguan: number;
    untungMingguan: number;
    marginPercent: number;
    bepUnit: number;
  };
  dataSimulasi: {
    hargaJualan: number;
    kosBerubahSeunit: number;
    kosTetapMingguan: number;
    untungMingguan: number;
    marginPercent: number;
    bepUnit: number;
  };
  perbezaan: {
    bezaUntungMingguan: number;
    bezaMarginPercent: number;
    bezaBepUnit: number;
  };
  cadanganTindakan: string[];
  andaian: string[];
}

/**
 * Menghasilkan cadangan simulasi berasingan tanpa mengubah rekod asal pengguna.
 */
export function janaSimulasiBerasingan({
  tajuk,
  config,
  bahanMentah,
  buruhLangsung,
  overheadBerubah,
  overheadTetap,
  perubahanHargaJualan,
  perubahanKuantitiJualan,
  peratusPerubahanBahan,
}: {
  tajuk: string;
  config: KonfigurasiSistem;
  bahanMentah: BahanMentah[];
  buruhLangsung: BuruhLangsung[];
  overheadBerubah: OverheadBerubah[];
  overheadTetap: OverheadTetap[];
  perubahanHargaJualan?: number; // Cth: RM 3.00
  perubahanKuantitiJualan?: number; // Cth: 1200
  peratusPerubahanBahan?: number; // Cth: +15% untuk tepung
}): CadanganSimulasi {
  const Q_std = config.sasaranKuantitiStandard || 1;
  const P_std = config.hargaJualanStandard || 0;

  // Asal
  const kosBahanStd = bahanMentah.reduce((acc, b) => acc + (b.stdKuantitiPerUnit * b.stdHargaPerUnit), 0);
  const kosBuruhStd = buruhLangsung.reduce((acc, l) => acc + (l.stdJamPerUnit * l.stdKadarPerJam), 0);
  const kosOHBStd = overheadBerubah.reduce((acc, o) => acc + o.stdKosPerUnit, 0);
  const kosBerubahStd = kosBahanStd + kosBuruhStd + kosOHBStd;
  const kosTetapStd = overheadTetap.reduce((acc, t) => acc + t.stdKosMingguan, 0);

  const hasilAsal = P_std * Q_std;
  const kosJumlahAsal = (kosBerubahStd * Q_std) + kosTetapStd;
  const untungAsal = hasilAsal - kosJumlahAsal;
  const marginAsal = P_std > 0 ? ((P_std - kosBerubahStd) / P_std) * 100 : 0;
  const bepUnitAsal = (P_std - kosBerubahStd) > 0 ? kosTetapStd / (P_std - kosBerubahStd) : 0;

  // Simulasi
  const P_sim = perubahanHargaJualan !== undefined ? perubahanHargaJualan : P_std;
  const Q_sim = perubahanKuantitiJualan !== undefined ? perubahanKuantitiJualan : Q_std;
  const faktorBahan = peratusPerubahanBahan !== undefined ? 1 + (peratusPerubahanBahan / 100) : 1;

  const kosBahanSim = kosBahanStd * faktorBahan;
  const kosBerubahSim = kosBahanSim + kosBuruhStd + kosOHBStd;

  const hasilSim = P_sim * Q_sim;
  const kosJumlahSim = (kosBerubahSim * Q_sim) + kosTetapStd;
  const untungSim = hasilSim - kosJumlahSim;
  const marginSim = P_sim > 0 ? ((P_sim - kosBerubahSim) / P_sim) * 100 : 0;
  const bepUnitSim = (P_sim - kosBerubahSim) > 0 ? kosTetapStd / (P_sim - kosBerubahSim) : 0;

  return {
    id: `sim-${Date.now()}`,
    tajuk,
    tarikhDibuat: new Date(),
    status: "cadangan_berasingan",
    ringkasanPerubahan: `Simulasi: Harga RM${P_sim.toFixed(2)}, Kuantiti ${Q_sim} unit, Perubahan bahan: ${peratusPerubahanBahan !== undefined ? `${peratusPerubahanBahan}%` : "0%"}.`,
    dataAsal: {
      hargaJualan: P_std,
      kosBerubahSeunit: Number(kosBerubahStd.toFixed(2)),
      kosTetapMingguan: Number(kosTetapStd.toFixed(2)),
      untungMingguan: Number(untungAsal.toFixed(2)),
      marginPercent: Number(marginAsal.toFixed(1)),
      bepUnit: Math.ceil(bepUnitAsal),
    },
    dataSimulasi: {
      hargaJualan: P_sim,
      kosBerubahSeunit: Number(kosBerubahSim.toFixed(2)),
      kosTetapMingguan: Number(kosTetapStd.toFixed(2)),
      untungMingguan: Number(untungSim.toFixed(2)),
      marginPercent: Number(marginSim.toFixed(1)),
      bepUnit: Math.ceil(bepUnitSim),
    },
    perbezaan: {
      bezaUntungMingguan: Number((untungSim - untungAsal).toFixed(2)),
      bezaMarginPercent: Number((marginSim - marginAsal).toFixed(1)),
      bezaBepUnit: Math.ceil(bepUnitSim) - Math.ceil(bepUnitAsal),
    },
    cadanganTindakan: [
      untungSim >= untungAsal
        ? `Langkah ini berpotensi meningkatkan keuntungan sebanyak RM${(untungSim - untungAsal).toFixed(2)}/minggu.`
        : `Langkah ini mengurangkan keuntungan sebanyak RM${Math.abs(untungSim - untungAsal).toFixed(2)}/minggu. Perlu langkah mitigasi kos.`,
      `Semak sama ada volum sasaran ${Q_sim} unit boleh dicapai oleh kapasiti pasaran.`,
    ],
    andaian: [
      "Kualiti dan resipi produk asas tidak berubah.",
      "Kos tetap mingguan kekal tidak berubah dalam jangka masa pendek.",
      "Hasil simulasi disimpan sebagai cadangan berasingan dan TIDAK mengubah rekod rasmi.",
    ],
  };
}

// ============================================================================
// 5. PENGENALPASTIAN PELUANG PENJIMATAN KOS (COST SAVING OPPORTUNITY ENGINE)
// ============================================================================

export interface PeluangPenjimatanKos {
  kategori: string;
  masalah: string;
  buktiNilai: string;
  tindakan: string;
  anggaranPenjimatan: string;
  andaian: string;
}

export function kenalPastiPeluangPenjimatan({
  bahanMentah = [],
  buruhLangsung = [],
  overheadBerubah = [],
  kuantitiSebenar = 0,
}: {
  bahanMentah: BahanMentah[];
  buruhLangsung: BuruhLangsung[];
  overheadBerubah: OverheadBerubah[];
  kuantitiSebenar: number;
}): PeluangPenjimatanKos[] {
  const peluang: PeluangPenjimatanKos[] = [];

  // 1. Semak pembaziran kuantiti bahan (Adverse Usage Variance)
  bahanMentah.forEach((b) => {
    const stdBenar = b.stdKuantitiPerUnit * kuantitiSebenar;
    const lebihanKuantiti = b.sebenarKuantitiJumlah - stdBenar;
    if (lebihanKuantiti > 0.01 && b.stdHargaPerUnit > 0) {
      const kosLebihan = lebihanKuantiti * b.stdHargaPerUnit;
      if (kosLebihan >= 5) {
        peluang.push({
          kategori: "Pembaziran Bahan Mentah (Usage Variance)",
          masalah: `Penggunaan bahan '${b.nama}' melebihi formula standard sebanyak ${lebihanKuantiti.toFixed(2)} ${b.unit}.`,
          buktiNilai: `Kuantiti dibenarkan standard: ${stdBenar.toFixed(2)} ${b.unit} vs Kuantiti sebenar: ${b.sebenarKuantitiJumlah.toFixed(2)} ${b.unit} (Varians merugikan: RM${kosLebihan.toFixed(2)}).`,
          tindakan: "Laksanakan kawalan porsi yang ketat (portion control scoops/scales) dan periksa kadar sisa buangan di stesen kerja.",
          anggaranPenjimatan: `Penjimatan berpotensi sehingga RM${kosLebihan.toFixed(2)}/minggu jika mematuhi resipi standard.`,
          andaian: "Kualiti dan rasa produk tidak terjejas dengan porsi standard.",
        });
      }
    }
  });

  // 2. Semak lonjakan harga belian bahan (Adverse Price Variance)
  bahanMentah.forEach((b) => {
    const bezaHarga = b.sebenarHargaPerUnit - b.stdHargaPerUnit;
    if (bezaHarga > 0.01 && b.sebenarKuantitiJumlah > 0) {
      const jumlahKerugianHarga = bezaHarga * b.sebenarKuantitiJumlah;
      if (jumlahKerugianHarga >= 10) {
        peluang.push({
          kategori: "Peningkatan Kos Bahan Mentah (Price Variance)",
          masalah: `Harga belian seunit '${b.nama}' meningkat sebanyak RM${bezaHarga.toFixed(2)}/${b.unit}.`,
          buktiNilai: `Harga standard RM${b.stdHargaPerUnit.toFixed(2)} vs Harga belian sebenar RM${b.sebenarHargaPerUnit.toFixed(2)} (Kesan kos tambahan: RM${jumlahKerugianHarga.toFixed(2)}).`,
          tindakan: "Runding pembelian pukal (bulk buying discount), dapatkan sebut harga daripada 2 pembekal alternatif, atau buat kontrak harga tetap.",
          anggaranPenjimatan: `Penjimatan anggaran RM${(jumlahKerugianHarga * 0.5).toFixed(2)} hingga RM${jumlahKerugianHarga.toFixed(2)}/minggu jika harga dapat distabilkan.`,
          andaian: "Pembekal alternatif menawarkan kualiti gred bahan yang setara.",
        });
      }
    }
  });

  // 3. Semak kecekapan buruh
  buruhLangsung.forEach((bl) => {
    const stdJamDibenarkan = bl.stdJamPerUnit * kuantitiSebenar;
    const lebihanJam = bl.sebenarJamJumlah - stdJamDibenarkan;
    if (lebihanJam > 0.5 && bl.stdKadarPerJam > 0) {
      const kosLebihanJam = lebihanJam * bl.stdKadarPerJam;
      peluang.push({
        kategori: "Ketidakcekapan Buruh Langsung (Labor Efficiency)",
        masalah: `Masa operasi untuk '${bl.nama}' mengambil ${lebihanJam.toFixed(1)} jam lebih daripada piawaian.`,
        buktiNilai: `Standard dibenarkan: ${stdJamDibenarkan.toFixed(1)} jam vs Masa sebenar: ${bl.sebenarJamJumlah.toFixed(1)} jam (Kos masa tambahan: RM${kosLebihanJam.toFixed(2)}).`,
        tindakan: "Susun semula jadual giliran tugas (line balancing), sediakan stesen 'prep' awal, dan latih staf mengikut teknik kerja pantas.",
        anggaranPenjimatan: `Penjimatan anggaran RM${kosLebihanJam.toFixed(2)}/minggu dari pengurangan jam kerja berlebihan.`,
        andaian: "Kadar jam kerja tidak terjejas oleh waktu lebih masa (OT).",
      });
    }
  });

  // 4. Semak kos pembungkusan jika ada
  overheadBerubah.forEach((ob: any) => {
    const namaItem = String(ob?.nama || ob?.jenis || "").toLowerCase();
    if (namaItem.includes("bungkus") || namaItem.includes("kotak") || namaItem.includes("pack")) {
      const kosPerUnit = Number(ob.stdKosPerUnit || 0);
      if (kosPerUnit > 0.40) {
        peluang.push({
          kategori: "Kos Pembungkusan Tinggi",
          masalah: `Kos pembungkusan '${ob?.nama || ob?.jenis || "Pembungkusan"}' agak tinggi iaitu RM${kosPerUnit.toFixed(2)} seunit produk.`,
          buktiNilai: `Kos per unit pembungkusan: RM${kosPerUnit.toFixed(2)}. Bagi ${kuantitiSebenar || 1000} unit, jumlah perbelanjaan pembungkusan ialah RM${(kosPerUnit * (kuantitiSebenar || 1000)).toFixed(2)}.`,
          tindakan: "Pertimbangkan pembelian kotak/bekas terus daripada kilang pembuat dalam kuantiti karton besar (1,000 - 5,000 pcs) untuk memotong kos perantara.",
          anggaranPenjimatan: `Penjimatan berpotensi 15-25% (sekitar RM${((kosPerUnit * 0.20) * (kuantitiSebenar || 1000)).toFixed(2)}/minggu).`,
          andaian: "Mempunyai ruang stor yang mencukupi untuk menyimpan stok pembungkusan pukal.",
        });
      }
    }
  });

  return peluang;
}
