/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BahanMentah, BuruhLangsung, OverheadBerubah, OverheadTetap, KonfigurasiSistem } from "../types";
import { convertUnit, normalizeUnit, areUnitsCompatible } from "./mrcostEngine";

// Re-export unit intelligence utilities
export { convertUnit, normalizeUnit, areUnitsCompatible };

/**
 * Safely sanitizes numeric values to prevent NaN, Infinity, and undefined.
 */
export function safeNum(val: any, fallback = 0): number {
  if (typeof val === "number") {
    return isNaN(val) || !isFinite(val) ? fallback : val;
  }
  const parsed = parseFloat(String(val));
  return isNaN(parsed) || !isFinite(parsed) ? fallback : parsed;
}

/**
 * Calculates raw material cost with unit conversion support.
 * E.g.:
 * - Flour: 1 kg @ RM4.00/kg => RM 4.00
 * - Sugar: 2 kg @ RM3.00/kg => RM 6.00
 * - Oil: 500 ml @ RM8.00/L => 0.5 L * RM8 = RM 4.00
 * - Seasoning: 500 g @ RM4.00/kg => 0.5 kg * RM4 = RM 2.00
 * - Packaging: 10 unit @ RM0.50/unit => RM 5.00
 */
export function calculateMaterialCost(
  qty: number,
  qtyUnit: string = "unit",
  price: number,
  priceUnit?: string
): number {
  const safeQ = Math.max(0, safeNum(qty));
  const safeP = Math.max(0, safeNum(price));
  if (safeQ === 0 || safeP === 0) return 0;

  const qUnit = (qtyUnit || "unit").trim();
  const pUnit = (priceUnit || qUnit).trim();

  // If price unit is omitted or identical to quantity unit
  if (!priceUnit || qUnit.toLowerCase() === pUnit.toLowerCase()) {
    return safeQ * safeP;
  }

  // Convert quantity to price unit if compatible (e.g. 500 ml to L, 500 g to kg)
  if (areUnitsCompatible(qUnit, pUnit)) {
    const conv = convertUnit(safeQ, qUnit, pUnit);
    if (conv.success && typeof conv.convertedValue === "number") {
      return conv.convertedValue * safeP;
    }
  }

  // Safe fallback if units are distinct custom counters
  return safeQ * safeP;
}

/**
 * Normalizes working time input into standard hours (jam).
 * Standard reference:
 * - 1 hour = 60 minutes
 * - 1 minute = 60 seconds
 * E.g.:
 * - 1 jam => 1.0 hr
 * - 2 jam => 2.0 hr
 * - 8 jam => 8.0 hr
 * - 30 minit => 0.5 hr
 * - 60 minit => 1.0 hr
 * - 120 minit => 2.0 hr
 */
export function resolveLaborHours(timeValue: number, unitMasa: string = "jam"): number {
  const safeVal = Math.max(0, safeNum(timeValue));
  if (safeVal === 0) return 0;

  const unit = (unitMasa || "jam").trim().toLowerCase();
  if (unit === "minit" || unit === "min" || unit === "minute" || unit === "minutes" || unit === "m") {
    return safeVal / 60;
  }
  if (unit === "saat" || unit === "sec" || unit === "second" || unit === "seconds" || unit === "s") {
    return safeVal / 3600;
  }
  if (unit === "hari" || unit === "day" || unit === "days") {
    return safeVal * 24;
  }
  return safeVal;
}

/**
 * Calculates labour cost based on working hours and hourly rate.
 * Labour Cost = Working Hours (in hours) × Hourly Rate
 * E.g.:
 * - 1 hr @ RM10.00 => RM 10.00
 * - 2 hr @ RM10.00 => RM 20.00
 * - 8 hr @ RM10.00 => RM 80.00
 * - 9 hr @ RM10.00 => RM 90.00
 * - 30 min @ RM10.00 => 0.5 hr * RM10 = RM 5.00
 * - 60 min @ RM10.00 => 1.0 hr * RM10 = RM 10.00
 * - 120 min @ RM10.00 => 2.0 hr * RM10 = RM 20.00
 */
export function calculateLaborCost(
  timeValue: number,
  unitMasa: string = "jam",
  hourlyRate: number
): number {
  const hours = resolveLaborHours(timeValue, unitMasa);
  const rate = Math.max(0, safeNum(hourlyRate));
  return hours * rate;
}

/**
 * Converts a quantity or duration to the target standard unit.
 * E.g.:
 * - 1000 g -> 1 kg (toStdUnit: "kg")
 * - 500 g -> 0.5 kg (toStdUnit: "kg")
 * - 1000 ml -> 1 L (toStdUnit: "L")
 * - 250 ml -> 0.25 L (toStdUnit: "L")
 * - 1 unit -> 1 unit
 */
export function convertToStdUnit(val: number, fromUnit?: string, toStdUnit?: string): number {
  const safeVal = safeNum(val);
  if (!fromUnit || !toStdUnit) return safeVal;
  const fUnit = fromUnit.trim();
  const tUnit = toStdUnit.trim();
  if (fUnit.toLowerCase() === tUnit.toLowerCase()) return safeVal;

  if (areUnitsCompatible(fUnit, tUnit)) {
    const conv = convertUnit(safeVal, fUnit, tUnit);
    if (conv.success && typeof conv.convertedValue === "number") {
      return conv.convertedValue;
    }
  }
  return safeVal;
}

export interface RingkasanKos {
  // Asas Kelompok Pengeluaran (Production Batch)
  kuantitiKelompok: number;
  unitKelompok: string;
  kosBahanKelompok: number;
  kosBuruhKelompok: number;
  kosOverheadBerubahKelompok: number;
  kosOverheadTetapKelompok: number;
  jumlahKosPengeluaranKelompok: number;
  kosPenuhSeunit: number;

  // Kos Seunit (Unit basis for sales/product)
  bahanMentahSemangkuk: number;
  buruhLangsungSemangkuk: number;
  overheadBerubahSemangkuk: number;
  jumlahKosBerubahSemangkuk: number;
  
  // Mingguan / Period Jumlah
  jumlahKosBerubahMingguan: number;
  jumlahKosTetapMingguan: number;
  jumlahKosKeseluruhanMingguan: number;
  
  // Hasil & Untung
  jumlahHasilMingguan: number;
  untungBersihMingguan: number;
}

// Kira ringkasan kos bagi standard berasaskan kelompok pengeluaran yang ditetapkan
export function kiraRingkasanKosStandard(
  config: KonfigurasiSistem,
  bahanMentah: BahanMentah[],
  buruhLangsung: BuruhLangsung[],
  overheadBerubah: OverheadBerubah[],
  overheadTetap: OverheadTetap[]
): RingkasanKos {
  // Kuantiti kelompok pengeluaran piawai (cth: 20 bekas)
  const batchQty = Math.max(1, safeNum(config.kuantitiPengeluaranPiawai || 1));
  const batchUnit = config.unitPengeluaran || config.unitProduk || "bekas";
  const Q = Math.max(0, safeNum(config.sasaranKuantitiStandard));

  // 1. Kos Bahan Mentah Kelompok Piawai = sum(calculateMaterialCost)
  // Kuantiti bahan mentah adalah untuk keseluruhan kelompok pengeluaran (cth: 3kg tepung, 1.5kg mentega, 2kg coklat)
  const kosBahanKelompok = bahanMentah.reduce(
    (sum, item) => sum + calculateMaterialCost(item.stdKuantitiPerUnit, item.unit, item.stdHargaPerUnit, item.hargaUnit),
    0
  );

  // 2. Kos Buruh Langsung Kelompok Piawai
  const kosBuruhKelompok = buruhLangsung.reduce(
    (sum, item) => sum + calculateLaborCost(item.stdJamPerUnit, item.unitMasa || "jam", item.stdKadarPerJam),
    0
  );

  // 3. Kos Overhead Berubah Kelompok Piawai
  const kosOverheadBerubahKelompok = overheadBerubah.reduce(
    (sum, item) => sum + safeNum(item.stdKosPerUnit),
    0
  );

  // 4. Kos Tetap Mingguan = sum(stdKosMingguan)
  const jumlahKosTetapMingguan = overheadTetap.reduce(
    (sum, item) => sum + safeNum(item.stdKosMingguan),
    0
  );

  // Kos Tetap dialokasikan kepada satu kelompok pengeluaran
  const kosOverheadTetapKelompok = Q > 0 ? (jumlahKosTetapMingguan / Q) * batchQty : (jumlahKosTetapMingguan > 0 ? jumlahKosTetapMingguan : 0);

  // Jumlah Kos Pengeluaran Piawai Kelompok = Bahan + Buruh + Overhed
  const jumlahKosPengeluaranKelompok = kosBahanKelompok + kosBuruhKelompok + kosOverheadBerubahKelompok + kosOverheadTetapKelompok;

  // Kos Seunit Piawai (Unit Cost = Jumlah Kos Kelompok / Kuantiti Kelompok)
  const kosPenuhSeunit = jumlahKosPengeluaranKelompok / batchQty;
  const bahanMentahSemangkuk = kosBahanKelompok / batchQty;
  const buruhLangsungSemangkuk = kosBuruhKelompok / batchQty;
  const overheadBerubahSemangkuk = kosOverheadBerubahKelompok / batchQty;
  const jumlahKosBerubahSemangkuk = bahanMentahSemangkuk + buruhLangsungSemangkuk + overheadBerubahSemangkuk;

  const effectiveWeeklyQty = Q > 0 ? Q : batchQty;
  const jumlahKosBerubahMingguan = jumlahKosBerubahSemangkuk * effectiveWeeklyQty;
  const jumlahKosKeseluruhanMingguan = jumlahKosBerubahMingguan + jumlahKosTetapMingguan;
  const jumlahHasilMingguan = safeNum(config.hargaJualanStandard) * effectiveWeeklyQty;
  const untungBersihMingguan = jumlahHasilMingguan - jumlahKosKeseluruhanMingguan;

  return {
    kuantitiKelompok: batchQty,
    unitKelompok: batchUnit,
    kosBahanKelompok,
    kosBuruhKelompok,
    kosOverheadBerubahKelompok,
    kosOverheadTetapKelompok,
    jumlahKosPengeluaranKelompok,
    kosPenuhSeunit,
    bahanMentahSemangkuk,
    buruhLangsungSemangkuk,
    overheadBerubahSemangkuk,
    jumlahKosBerubahSemangkuk,
    jumlahKosBerubahMingguan,
    jumlahKosTetapMingguan,
    jumlahKosKeseluruhanMingguan,
    jumlahHasilMingguan,
    untungBersihMingguan,
  };
}

/**
 * Resolves whether an actual quantity was entered as a per-unit amount (e.g. 1, 2, 10, 1.5, 0.5)
 * or as a total batch amount (e.g. 980 for 950 units in legacy templates).
 * Returns both per-unit quantity and total batch quantity safely.
 */
export function resolveActualQty(sebenarQty: number, stdQtyPerUnit: number, Q: number): { perUnit: number; total: number } {
  const safeAct = Math.max(0, safeNum(sebenarQty));
  const safeStd = Math.max(0, safeNum(stdQtyPerUnit));
  const safeQ = Math.max(0, safeNum(Q));

  if (safeQ <= 1) {
    return { perUnit: safeAct, total: safeAct };
  }

  // If entered as batch total (e.g. legacy demo: 980 used for 950 units with std 1.0)
  const isBatchTotal = safeStd > 0 && safeAct >= safeStd * (safeQ * 0.5);
  if (isBatchTotal) {
    return { perUnit: safeAct / safeQ, total: safeAct };
  }

  // Standard/Direct input: value is per-unit (e.g. 1 -> 1, 2 -> 2, 10 -> 10, 1.5 -> 1.5)
  return { perUnit: safeAct, total: safeAct * safeQ };
}

export function resolveActualHours(sebenarJam: number, stdJamPerUnit: number, Q: number): { perUnit: number; total: number } {
  const safeAct = Math.max(0, safeNum(sebenarJam));
  const safeStd = Math.max(0, safeNum(stdJamPerUnit));
  const safeQ = Math.max(0, safeNum(Q));

  if (safeQ <= 1) {
    return { perUnit: safeAct, total: safeAct };
  }

  const isBatchTotal = safeStd > 0 && safeAct >= safeStd * (safeQ * 0.5);
  if (isBatchTotal) {
    return { perUnit: safeAct / safeQ, total: safeAct };
  }

  return { perUnit: safeAct, total: safeAct * safeQ };
}

export function resolveActualOverhead(sebenarKos: number, stdKosPerUnit: number, Q: number): { perUnit: number; total: number } {
  const safeAct = Math.max(0, safeNum(sebenarKos));
  const safeStd = Math.max(0, safeNum(stdKosPerUnit));
  const safeQ = Math.max(0, safeNum(Q));

  if (safeQ <= 1) {
    return { perUnit: safeAct, total: safeAct };
  }

  const isBatchTotal = safeStd > 0 && safeAct >= safeStd * (safeQ * 0.5);
  if (isBatchTotal) {
    return { perUnit: safeAct / safeQ, total: safeAct };
  }

  return { perUnit: safeAct, total: safeAct * safeQ };
}

// Kira ringkasan kos bagi sebenar menggunakan asas kelompok yang sama
export function kiraRingkasanKosSebenar(
  config: KonfigurasiSistem,
  bahanMentah: BahanMentah[],
  buruhLangsung: BuruhLangsung[],
  overheadBerubah: OverheadBerubah[],
  overheadTetap: OverheadTetap[]
): RingkasanKos {
  const batchQty = Math.max(1, safeNum(config.kuantitiPengeluaranSebenar || config.kuantitiPengeluaranPiawai || 1));
  const batchUnit = config.unitPengeluaran || config.unitProduk || "bekas";
  const Q = Math.max(0, safeNum(config.kuantitiSebenarDijual));

  // 1. Kos Bahan Mentah Sebenar = Kuantiti bahan sebenar × Harga sebenar bagi kelompok
  const kosBahanKelompok = bahanMentah.reduce((sum, item) => {
    const unitActual = item.sebenarUnit || item.unit || "unit";
    const priceUnitActual = item.sebenarHargaUnit || item.hargaUnit || unitActual;
    const ap = safeNum(item.sebenarHargaPerUnit);
    const aq = safeNum(item.sebenarKuantitiJumlah);
    return sum + calculateMaterialCost(aq, unitActual, ap, priceUnitActual);
  }, 0);

  // 2. Kos Buruh Sebenar = Jam bekerja sebenar × Kadar upah sejam
  const kosBuruhKelompok = buruhLangsung.reduce((sum, item) => {
    const unitMasa = item.sebenarUnitMasa || item.unitMasa || "jam";
    const ar = safeNum(item.sebenarKadarPerJam);
    const ah = safeNum(item.sebenarJamJumlah);
    return sum + calculateLaborCost(ah, unitMasa, ar);
  }, 0);

  // 3. Kos Overhead Berubah Sebenar
  const kosOverheadBerubahKelompok = overheadBerubah.reduce((sum, item) => {
    return sum + safeNum(item.sebenarKosJumlah);
  }, 0);

  // 4. Kos Tetap Sebenar
  const jumlahKosTetapMingguan = overheadTetap.reduce(
    (sum, item) => sum + safeNum(item.sebenarKosJumlah),
    0
  );
  const kosOverheadTetapKelompok = Q > 0 ? (jumlahKosTetapMingguan / Q) * batchQty : (jumlahKosTetapMingguan > 0 ? jumlahKosTetapMingguan : 0);

  // Jumlah kos pengeluaran sebenar = Bahan + Buruh + Overhead
  const jumlahKosPengeluaranKelompok = kosBahanKelompok + kosBuruhKelompok + kosOverheadBerubahKelompok + kosOverheadTetapKelompok;

  // Kos Seunit Sebenar
  const kosPenuhSeunit = jumlahKosPengeluaranKelompok / batchQty;
  const bahanMentahSemangkuk = kosBahanKelompok / batchQty;
  const buruhLangsungSemangkuk = kosBuruhKelompok / batchQty;
  const overheadBerubahSemangkuk = kosOverheadBerubahKelompok / batchQty;
  const jumlahKosBerubahSemangkuk = bahanMentahSemangkuk + buruhLangsungSemangkuk + overheadBerubahSemangkuk;

  const effectiveWeeklyQty = Q > 0 ? Q : batchQty;
  const jumlahKosBerubahMingguan = (Q > 0 && Q !== batchQty)
    ? jumlahKosBerubahSemangkuk * Q
    : (kosBahanKelompok + kosBuruhKelompok + kosOverheadBerubahKelompok);

  const jumlahKosKeseluruhanMingguan = jumlahKosBerubahMingguan + jumlahKosTetapMingguan;
  const jumlahHasilMingguan = safeNum(config.hargaJualanSebenar) * effectiveWeeklyQty;
  const untungBersihMingguan = jumlahHasilMingguan - jumlahKosKeseluruhanMingguan;

  return {
    kuantitiKelompok: batchQty,
    unitKelompok: batchUnit,
    kosBahanKelompok,
    kosBuruhKelompok,
    kosOverheadBerubahKelompok,
    kosOverheadTetapKelompok,
    jumlahKosPengeluaranKelompok,
    kosPenuhSeunit,
    bahanMentahSemangkuk,
    buruhLangsungSemangkuk,
    overheadBerubahSemangkuk,
    jumlahKosBerubahSemangkuk,
    jumlahKosBerubahMingguan,
    jumlahKosTetapMingguan,
    jumlahKosKeseluruhanMingguan,
    jumlahHasilMingguan,
    untungBersihMingguan,
  };
}

// Analisis Varians Bahan Mentah
export interface VariansBahanMentahDetail {
  id: string;
  nama: string;
  unit: string;
  stdKuantitiPerUnit: number;
  stdHargaPerUnit: number;
  sebenarKuantitiJumlah: number;
  sebenarHargaPerUnit: number;
  
  stdKuantitiDibenarkan: number; // SQ per unit * Q_act
  kosStandardDibenarkan: number;  // (SQ per unit * Q_act) * SP
  kosSebenar: number;             // AQ * AP
  
  variansHarga: number;       // (AP - SP) * AQ (positive is U, negative is F)
  variansPenggunaan: number;  // (AQ - SQ_dibenarkan) * SP (positive is U, negative is F)
  variansJumlah: number;      // Kos Sebenar - Kos Standard Dibenarkan
  
  keadaanHarga: "F" | "U";
  keadaanPenggunaan: "F" | "U";
  keadaanJumlah: "F" | "U";
}

export function analisisVariansBahan(
  Q_act: number,
  bahanMentah: BahanMentah[]
): VariansBahanMentahDetail[] {
  const Q = Math.max(0, safeNum(Q_act));
  return bahanMentah.map(item => {
    const sqUnit = safeNum(item.stdKuantitiPerUnit);
    const sp = safeNum(item.stdHargaPerUnit);
    const ap = safeNum(item.sebenarHargaPerUnit);
    const stdUnit = item.unit || "unit";
    const actUnit = item.sebenarUnit || stdUnit;
    const stdPriceUnit = item.hargaUnit || stdUnit;
    const actPriceUnit = item.sebenarHargaUnit || item.hargaUnit || actUnit;

    const { total: totalAqRaw } = resolveActualQty(item.sebenarKuantitiJumlah, item.stdKuantitiPerUnit, Q);

    // Standard allowed quantity in standard unit
    const stdKuantitiDibenarkan = sqUnit * Q;
    const kosStandardDibenarkan = calculateMaterialCost(stdKuantitiDibenarkan, stdUnit, sp, stdPriceUnit);

    // Actual cost incurred
    const kosSebenar = calculateMaterialCost(totalAqRaw, actUnit, ap, actPriceUnit);

    // Actual quantity converted to standard unit for quantity variance calculation
    const totalAqInStdUnit = convertToStdUnit(totalAqRaw, actUnit, stdUnit);

    // Quantity / Usage Variance: (AQ_std - SQ_allowed) * SP_effective
    const effectiveSpPerStdUnit = calculateMaterialCost(1, stdUnit, sp, stdPriceUnit);
    const variansPenggunaan = (totalAqInStdUnit - stdKuantitiDibenarkan) * effectiveSpPerStdUnit;

    // Price Variance: Kos Sebenar - (AQ_in_std * SP_effective)
    const variansHarga = kosSebenar - (totalAqInStdUnit * effectiveSpPerStdUnit);

    // Total Variance: Kos Sebenar - Kos Standard Dibenarkan
    const variansJumlah = kosSebenar - kosStandardDibenarkan;

    return {
      id: item.id,
      nama: item.nama,
      unit: stdUnit,
      stdKuantitiPerUnit: sqUnit,
      stdHargaPerUnit: sp,
      sebenarKuantitiJumlah: safeNum(item.sebenarKuantitiJumlah),
      sebenarHargaPerUnit: ap,
      stdKuantitiDibenarkan,
      kosStandardDibenarkan,
      kosSebenar,
      variansHarga,
      variansPenggunaan,
      variansJumlah,
      keadaanHarga: variansHarga > 0.001 ? "U" : "F",
      keadaanPenggunaan: variansPenggunaan > 0.001 ? "U" : "F",
      keadaanJumlah: variansJumlah > 0.001 ? "U" : "F",
    };
  });
}

// Analisis Varians Buruh Langsung
export interface VariansBuruhLangsungDetail {
  id: string;
  nama: string;
  stdJamPerUnit: number;
  stdKadarPerJam: number;
  sebenarJamJumlah: number;
  sebenarKadarPerJam: number;
  
  stdJamDibenarkan: number;    // SH per unit * Q_act
  kosStandardDibenarkan: number;  // (SH per unit * Q_act) * SR
  kosSebenar: number;             // AH * AR
  
  variansKadar: number;       // (AR - SR) * AH
  variansKecekapan: number;   // (AH - SH_dibenarkan) * SR
  variansJumlah: number;      // Kos Sebenar - Kos Standard Dibenarkan
  
  keadaanKadar: "F" | "U";
  keadaanKecekapan: "F" | "U";
  keadaanJumlah: "F" | "U";
}

export function analisisVariansBuruh(
  Q_act: number,
  buruhLangsung: BuruhLangsung[]
): VariansBuruhLangsungDetail[] {
  const Q = Math.max(0, safeNum(Q_act));
  return buruhLangsung.map(item => {
    const shUnit = safeNum(item.stdJamPerUnit);
    const sr = safeNum(item.stdKadarPerJam);
    const ar = safeNum(item.sebenarKadarPerJam);
    const stdUnitMasa = item.unitMasa || "jam";
    const actUnitMasa = item.sebenarUnitMasa || item.unitMasa || "jam";

    const { total: totalAhRaw } = resolveActualHours(item.sebenarJamJumlah, item.stdJamPerUnit, Q);

    // Convert both to standard hours
    const shUnitInHours = resolveLaborHours(shUnit, stdUnitMasa);
    const totalAhInHours = resolveLaborHours(totalAhRaw, actUnitMasa);

    const stdJamDibenarkan = shUnitInHours * Q;
    const kosStandardDibenarkan = stdJamDibenarkan * sr;
    const kosSebenar = totalAhInHours * ar;

    // Rate Variance: (AR - SR) * AH_hours
    const variansKadar = (ar - sr) * totalAhInHours;

    // Efficiency Variance: (AH_hours - SH_dibenarkan) * SR
    const variansKecekapan = (totalAhInHours - stdJamDibenarkan) * sr;

    const variansJumlah = kosSebenar - kosStandardDibenarkan;

    return {
      id: item.id,
      nama: item.nama,
      stdJamPerUnit: shUnit,
      stdKadarPerJam: sr,
      sebenarJamJumlah: safeNum(item.sebenarJamJumlah),
      sebenarKadarPerJam: ar,
      stdJamDibenarkan,
      kosStandardDibenarkan,
      kosSebenar,
      variansKadar,
      variansKecekapan,
      variansJumlah,
      keadaanKadar: variansKadar > 0.001 ? "U" : "F",
      keadaanKecekapan: variansKecekapan > 0.001 ? "U" : "F",
      keadaanJumlah: variansJumlah > 0.001 ? "U" : "F",
    };
  });
}

// Analisis Varians Overhead Berubah
export interface VariansOverheadBerubahDetail {
  id: string;
  nama: string;
  stdKosPerUnit: number;
  sebenarKosJumlah: number;
  kosStandardDibenarkan: number; // stdKosPerUnit * Q_act
  variansSimbahan: number;       // Sebenar - Standard Dibenarkan
  keadaan: "F" | "U";
}

export function analisisVariansOverheadBerubah(
  Q_act: number,
  overheadBerubah: OverheadBerubah[]
): VariansOverheadBerubahDetail[] {
  const Q = Math.max(0, safeNum(Q_act));
  return overheadBerubah.map(item => {
    const stdKos = safeNum(item.stdKosPerUnit);
    const actualKosInput = safeNum(item.sebenarKosJumlah);
    const { total: totalActualKos } = resolveActualOverhead(actualKosInput, stdKos, Q);

    const kosStandardDibenarkan = stdKos * Q;
    const variansSimbahan = totalActualKos - kosStandardDibenarkan;

    return {
      id: item.id,
      nama: item.nama,
      stdKosPerUnit: stdKos,
      sebenarKosJumlah: actualKosInput,
      kosStandardDibenarkan,
      variansSimbahan,
      keadaan: variansSimbahan > 0.001 ? "U" : "F",
    };
  });
}

// Analisis Varians Overhead Tetap
export interface VariansOverheadTetapDetail {
  id: string;
  nama: string;
  stdKosMingguan: number;
  sebenarKosJumlah: number;
  variansPerbelanjaan: number; // Sebenar - Standard Budget
  keadaan: "F" | "U";
}

export function analisisVariansOverheadTetap(
  overheadTetap: OverheadTetap[]
): VariansOverheadTetapDetail[] {
  return overheadTetap.map(item => {
    const budget = safeNum(item.stdKosMingguan);
    const actual = safeNum(item.sebenarKosJumlah);
    const variansPerbelanjaan = actual - budget;

    return {
      id: item.id,
      nama: item.nama,
      stdKosMingguan: budget,
      sebenarKosJumlah: actual,
      variansPerbelanjaan,
      keadaan: variansPerbelanjaan > 0.001 ? "U" : "F",
    };
  });
}

// Titik Pulang Modal (BEP) Results
export interface AnalisisBEP {
  kosTetap: number;
  hargaJualanMangkuk: number;
  kosBerubahMangkuk: number;
  marginCarumanMangkuk: number; // Harga Jualan - Kos Berubah
  nisbahMarginCaruman: number;  // Margin Caruman / Harga Jualan
  bepMangkuk: number;           // Kos Tetap / Margin Caruman Seunit (0 if unattainable)
  bepRM: number;                // bepMangkuk * Harga Jualan
  marginKeselamatanUnit: number;// Kuantiti Jualan - bepMangkuk
  marginKeselamatanPeratus: number; // Margin Keselamatan Unit / Kuantiti Jualan
  kuantitiJualan: number;
  isAttainable: boolean;        // True strictly when contribution margin > 0
  status: "attainable" | "zero_margin" | "negative_margin";
  statusMessage: string;
}

/**
 * Calculates Break-Even Point (BEP) and Margin of Safety.
 * Strictly checks for zero or negative contribution margins to avoid misleading 0 BEP units.
 */
export function kiraAnalisisBEP(
  fixedCosts: number,
  sellingPrice: number,
  variableCostPerUnit: number,
  salesQuantity: number
): AnalisisBEP {
  const safeFixed = Math.max(0, safeNum(fixedCosts));
  const safePrice = Math.max(0, safeNum(sellingPrice));
  const safeVarCost = Math.max(0, safeNum(variableCostPerUnit));
  const safeSalesQty = Math.max(0, safeNum(salesQuantity));

  const marginCarumanMangkuk = safePrice - safeVarCost;
  const nisbahMarginCaruman = safePrice > 0 ? marginCarumanMangkuk / safePrice : 0;
  
  // Titik pulang modal hanya wujud dan dapat dicapai jika margin caruman seunit adalah positif (> 0.0001)
  const isAttainable = marginCarumanMangkuk > 0.0001;

  let bepMangkuk = 0;
  let bepRM = 0;
  let marginKeselamatanUnit = 0;
  let marginKeselamatanPeratus = 0;
  let status: "attainable" | "zero_margin" | "negative_margin" = "attainable";
  let statusMessage = "Titik Pulang Modal dapat dicapai dengan volum jualan yang diunjurkan.";

  if (isAttainable) {
    bepMangkuk = safeFixed / marginCarumanMangkuk;
    bepRM = bepMangkuk * safePrice;
    marginKeselamatanUnit = safeSalesQty - bepMangkuk;
    marginKeselamatanPeratus = safeSalesQty > 0 ? (marginKeselamatanUnit / safeSalesQty) * 100 : 0;
  } else if (Math.abs(marginCarumanMangkuk) <= 0.0001) {
    status = "zero_margin";
    statusMessage = "Margin caruman sifar: Harga jualan sama dengan kos berubah. Perniagaan tidak berupaya menampung sebarang kos tetap.";
  } else {
    status = "negative_margin";
    statusMessage = "Margin caruman negatif: Harga jualan lebih rendah daripada kos berubah. Setiap jualan menghasilkan kerugian, maka Titik Pulang Modal mustahil dicapai.";
  }

  return {
    kosTetap: safeFixed,
    hargaJualanMangkuk: safePrice,
    kosBerubahMangkuk: safeVarCost,
    marginCarumanMangkuk,
    nisbahMarginCaruman,
    bepMangkuk,
    bepRM,
    marginKeselamatanUnit,
    marginKeselamatanPeratus,
    kuantitiJualan: safeSalesQty,
    isAttainable,
    status,
    statusMessage,
  };
}

/**
 * Distinguishes profit margin from markup:
 * - Profit Margin = ((Selling Price - Total Cost) / Selling Price) * 100
 * - Markup = ((Selling Price - Total Cost) / Total Cost) * 100
 */
export function kiraProfitMargin(sellingPrice: number, totalCost: number): number {
  const sp = safeNum(sellingPrice);
  const cost = safeNum(totalCost);
  if (sp <= 0) return 0;
  return ((sp - cost) / sp) * 100;
}

export function kiraMarkup(sellingPrice: number, totalCost: number): number {
  const sp = safeNum(sellingPrice);
  const cost = safeNum(totalCost);
  if (cost <= 0) return 0;
  return ((sp - cost) / cost) * 100;
}

/**
 * Format currency with full standard Malaysian Ringgit formatting.
 * Supports realistic business values and large amounts (e.g. 2,000,000.00 -> RM 2,000,000.00).
 * Handles clean NaN and negative values gracefully.
 */
export function formatCurrencyRM(val: number | string, currency = "RM"): string {
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num) || !isFinite(num)) {
    return `${currency} 0.00`;
  }
  const isNegative = num < -0.00001;
  const absNum = Math.abs(num);
  const formatted = absNum.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return isNegative ? `-${currency} ${formatted}` : `${currency} ${formatted}`;
}

export {
  FINANCIAL_COLORS,
  getProfitStatus,
  getVarianceStatus,
  getMarginStatus,
  getFinancialColor,
  formatPercentage,
  formatQuantity,
} from "./financialColors";

