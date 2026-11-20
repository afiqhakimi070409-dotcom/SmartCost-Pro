/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { BahanMentah, BuruhLangsung, OverheadBerubah, OverheadTetap, KonfigurasiSistem, UserRole, ROLE_DEFINITIONS } from "../types";
import { Coins, Utensils, HardHat, Clock, Building, TrendingUp, Sparkles, Copy, Check, Lock, CheckCircle2, Plus, Trash2, Layers, DollarSign, Target, Info, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Language, getTranslation, getStoredLanguage } from "../utils/i18n";
import { handleInputEnterKey } from "../utils/inputNavigation";
import { formatCurrencyRM, resolveActualQty, resolveActualHours, resolveActualOverhead, calculateMaterialCost, calculateLaborCost } from "../utils/costCalculations";

const presetsBahanEn = [
  { nama: "Crispy Spring Roll Wrappers", unit: "sheets", stdKuantitiPerUnit: 1.00, stdHargaPerUnit: 0.15 },
  { nama: "Carbonara Sauce & Milk", unit: "rolls", stdKuantitiPerUnit: 1.00, stdHargaPerUnit: 0.45 },
  { nama: "Minced Beef & Sausage", unit: "lbs", stdKuantitiPerUnit: 0.05, stdHargaPerUnit: 10.00 },
  { nama: "Mozzarella & Cheddar Blend", unit: "lbs", stdKuantitiPerUnit: 0.035, stdHargaPerUnit: 18.00 },
  { nama: "Frying Oil & Breadcrumbs", unit: "rolls", stdKuantitiPerUnit: 1.00, stdHargaPerUnit: 0.20 }
];

const presetsBahanMs = [
  { nama: "Kulit Popia Premium", unit: "keping", stdKuantitiPerUnit: 1.00, stdHargaPerUnit: 0.15 },
  { nama: "Sos Carbonara & Susu Evaporated", unit: "batang", stdKuantitiPerUnit: 1.00, stdHargaPerUnit: 0.45 },
  { nama: "Daging Cincang / Ayam & Sosej", unit: "kg", stdKuantitiPerUnit: 0.02, stdHargaPerUnit: 22.00 },
  { nama: "Keju Mozzarella & Cheddar", unit: "kg", stdKuantitiPerUnit: 0.015, stdHargaPerUnit: 38.00 },
  { nama: "Minyak Goreng & Serbuk Roti", unit: "batang", stdKuantitiPerUnit: 1.00, stdHargaPerUnit: 0.20 }
];

const presetsBuruhEn = [
  { nama: "Prep & Roll Assembly", stdJamPerUnit: 0.02, stdKadarPerJam: 12.00 },
  { nama: "Frying & Service", stdJamPerUnit: 0.015, stdKadarPerJam: 11.00 }
];

const presetsBuruhMs = [
  { nama: "Pembuat & Penggulung Popia", stdJamPerUnit: 0.02, stdKadarPerJam: 9.00 },
  { nama: "Penggoreng & Khidmat Pelanggan", stdJamPerUnit: 0.015, stdKadarPerJam: 8.00 }
];

const presetsOHBEn = [
  { nama: "Commercial Cooking Gas", stdKosPerUnit: 0.10 },
  { nama: "Packaging & Boxes", stdKosPerUnit: 0.20 }
];

const presetsOHBMs = [
  { nama: "Gas Memasak", stdKosPerUnit: 0.10 },
  { nama: "Kotak Pembungkusan & Plastik Popia", stdKosPerUnit: 0.20 }
];

const presetsOHTEn = [
  { nama: "Weekly Kiosk Space Rent", stdKosMingguan: 150.00 },
  { nama: "Maintenance & Permits", stdKosMingguan: 15.00 },
  { nama: "Weekly Marketing / Ads", stdKosMingguan: 25.00 }
];

const presetsOHTMs = [
  { nama: "Sewa Tapak Kedai Mingguan", stdKosMingguan: 150.00 },
  { nama: "Penyelenggaraan & Lesen", stdKosMingguan: 15.00 },
  { nama: "Pemasaran / Iklan Mingguan", stdKosMingguan: 25.00 }
];

interface ActualSheetProps {
  config: KonfigurasiSistem;
  bahanMentah: BahanMentah[];
  buruhLangsung: BuruhLangsung[];
  overheadBerubah: OverheadBerubah[];
  overheadTetap: OverheadTetap[];
  onUpdateBahanMentah: (items: BahanMentah[]) => void;
  onUpdateBuruhLangsung: (items: BuruhLangsung[]) => void;
  onUpdateOverheadBerubah: (items: OverheadBerubah[]) => void;
  onUpdateOverheadTetap: (items: OverheadTetap[]) => void;
  readOnly?: boolean;
  userRole?: UserRole;
  systemLang?: Language;
}

export default function ActualSheet({
  config,
  bahanMentah,
  buruhLangsung,
  overheadBerubah,
  overheadTetap,
  onUpdateBahanMentah,
  onUpdateBuruhLangsung,
  onUpdateOverheadBerubah,
  onUpdateOverheadTetap,
  readOnly = false,
  userRole = "admin",
  systemLang,
}: ActualSheetProps) {
  const lang: Language = systemLang || config.language || getStoredLanguage();
  const t = getTranslation(lang);
  const f = (val: number) => formatCurrencyRM(val, config.currency);
  const fNum = (val: number) => val.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const unitLabel = config.unitProduk || (lang === "en" ? "units" : "batang");
  const presetsBahan = lang === "en" ? presetsBahanEn : presetsBahanMs;
  const presetsBuruh = lang === "en" ? presetsBuruhEn : presetsBuruhMs;
  const presetsOHB = lang === "en" ? presetsOHBEn : presetsOHBMs;
  const presetsOHT = lang === "en" ? presetsOHTEn : presetsOHTMs;

  const roleDef = ROLE_DEFINITIONS[userRole] || ROLE_DEFINITIONS.admin;
  const isReadOnly = readOnly || !roleDef.canEditDailyData;
  const [approvedStatus, setApprovedStatus] = useState<boolean>(false);

  const Q_act = config.kuantitiSebenarDijual;

  const [copiedNotification, setCopiedNotification] = useState(false);

  // State to add new items easily with quick templates
  const [newBahan, setNewBahan] = useState({
    nama: "",
    unit: "kg",
    stdKuantitiPerUnit: 0,
    stdHargaPerUnit: 0,
    sebenarKuantitiJumlah: 0,
    sebenarHargaPerUnit: 0,
  });

  const [newBuruh, setNewBuruh] = useState({
    nama: "",
    stdJamPerUnit: 0,
    stdKadarPerJam: 0,
    sebenarJamJumlah: 0,
    sebenarKadarPerJam: 0,
  });

  const [newOHB, setNewOHB] = useState({
    nama: "",
    stdKosPerUnit: 0,
    sebenarKosJumlah: 0,
  });

  const [newOHT, setNewOHT] = useState({
    nama: "",
    stdKosMingguan: 0,
    sebenarKosJumlah: 0,
  });

  // Helper untuk salin anggaran standard terus ke data sebenar (1:1 tanpa penggandaan 1,000)
  const salinStandardKeSebenar = () => {
    // 1. Bahan Mentah (1 kekal 1, 2 kekal 2, 10 kekal 10)
    const updatedBahan = bahanMentah.map(item => ({
      ...item,
      sebenarKuantitiJumlah: item.stdKuantitiPerUnit,
      sebenarHargaPerUnit: item.stdHargaPerUnit
    }));
    onUpdateBahanMentah(updatedBahan);

    // 2. Buruh Langsung (1j kekal 1j, 8j kekal 8j)
    const updatedBuruh = buruhLangsung.map(item => ({
      ...item,
      sebenarJamJumlah: item.stdJamPerUnit,
      sebenarKadarPerJam: item.stdKadarPerJam
    }));
    onUpdateBuruhLangsung(updatedBuruh);

    // 3. Overhead Berubah (RM1.00 kekal RM1.00, RM10.00 kekal RM10.00)
    const updatedOHB = overheadBerubah.map(item => ({
      ...item,
      sebenarKosJumlah: item.stdKosPerUnit
    }));
    onUpdateOverheadBerubah(updatedOHB);

    // 4. Overhead Tetap
    const updatedOHT = overheadTetap.map(item => ({
      ...item,
      sebenarKosJumlah: item.stdKosMingguan
    }));
    onUpdateOverheadTetap(updatedOHT);

    setCopiedNotification(true);
    setTimeout(() => setCopiedNotification(false), 3000);
  };

  // Materials updates & handlers
  const updateBahan = (index: number, field: keyof BahanMentah, value: any) => {
    const sanitized = typeof value === "number" ? Math.max(0, isNaN(value) ? 0 : value) : value;
    const updated = [...bahanMentah];
    updated[index] = { ...updated[index], [field]: sanitized };
    onUpdateBahanMentah(updated);
  };

  const deleteBahan = (id: string) => {
    onUpdateBahanMentah(bahanMentah.filter((item) => item.id !== id));
  };

  const addBahan = () => {
    if (!newBahan.nama) return;
    const stdPerUnit = Math.max(0, newBahan.stdKuantitiPerUnit > 0
      ? newBahan.stdKuantitiPerUnit
      : (newBahan.sebenarKuantitiJumlah > 0 ? newBahan.sebenarKuantitiJumlah : 1));
    const stdPrice = Math.max(0, newBahan.stdHargaPerUnit > 0
      ? newBahan.stdHargaPerUnit
      : newBahan.sebenarHargaPerUnit);

    const newItem: BahanMentah = {
      id: "bm-" + Date.now(),
      nama: newBahan.nama,
      unit: newBahan.unit || "kg",
      stdKuantitiPerUnit: stdPerUnit,
      stdHargaPerUnit: stdPrice,
      sebenarKuantitiJumlah: Math.max(0, newBahan.sebenarKuantitiJumlah > 0 ? newBahan.sebenarKuantitiJumlah : stdPerUnit),
      sebenarHargaPerUnit: Math.max(0, newBahan.sebenarHargaPerUnit > 0 ? newBahan.sebenarHargaPerUnit : stdPrice),
    };
    onUpdateBahanMentah([...bahanMentah, newItem]);
    setNewBahan({ nama: "", unit: "kg", stdKuantitiPerUnit: 0, stdHargaPerUnit: 0, sebenarKuantitiJumlah: 0, sebenarHargaPerUnit: 0 });
  };

  // Labor updates & handlers
  const updateBuruh = (index: number, field: keyof BuruhLangsung, value: any) => {
    const sanitized = typeof value === "number" ? Math.max(0, isNaN(value) ? 0 : value) : value;
    const updated = [...buruhLangsung];
    updated[index] = { ...updated[index], [field]: sanitized };
    onUpdateBuruhLangsung(updated);
  };

  const deleteBuruh = (id: string) => {
    onUpdateBuruhLangsung(buruhLangsung.filter((item) => item.id !== id));
  };

  const addBuruh = () => {
    if (!newBuruh.nama) return;
    const stdJam = Math.max(0, newBuruh.stdJamPerUnit > 0
      ? newBuruh.stdJamPerUnit
      : (newBuruh.sebenarJamJumlah > 0 ? newBuruh.sebenarJamJumlah : 1));
    const stdRate = Math.max(0, newBuruh.stdKadarPerJam > 0
      ? newBuruh.stdKadarPerJam
      : newBuruh.sebenarKadarPerJam);

    const newItem: BuruhLangsung = {
      id: "bl-" + Date.now(),
      nama: newBuruh.nama,
      stdJamPerUnit: stdJam,
      stdKadarPerJam: stdRate,
      sebenarJamJumlah: Math.max(0, newBuruh.sebenarJamJumlah > 0 ? newBuruh.sebenarJamJumlah : stdJam),
      sebenarKadarPerJam: Math.max(0, newBuruh.sebenarKadarPerJam > 0 ? newBuruh.sebenarKadarPerJam : stdRate),
    };
    onUpdateBuruhLangsung([...buruhLangsung, newItem]);
    setNewBuruh({ nama: "", stdJamPerUnit: 0, stdKadarPerJam: 0, sebenarJamJumlah: 0, sebenarKadarPerJam: 0 });
  };

  // Variable Overhead updates & handlers
  const updateOHB = (index: number, field: keyof OverheadBerubah, value: any) => {
    const sanitized = typeof value === "number" ? Math.max(0, isNaN(value) ? 0 : value) : value;
    const updated = [...overheadBerubah];
    updated[index] = { ...updated[index], [field]: sanitized };
    onUpdateOverheadBerubah(updated);
  };

  const deleteOHB = (id: string) => {
    onUpdateOverheadBerubah(overheadBerubah.filter((item) => item.id !== id));
  };

  const addOHB = () => {
    if (!newOHB.nama) return;
    const stdPerUnit = Math.max(0, newOHB.stdKosPerUnit > 0
      ? newOHB.stdKosPerUnit
      : (newOHB.sebenarKosJumlah > 0 ? newOHB.sebenarKosJumlah : 1));

    const newItem: OverheadBerubah = {
      id: "ob-" + Date.now(),
      nama: newOHB.nama,
      stdKosPerUnit: stdPerUnit,
      sebenarKosJumlah: Math.max(0, newOHB.sebenarKosJumlah > 0 ? newOHB.sebenarKosJumlah : stdPerUnit),
    };
    onUpdateOverheadBerubah([...overheadBerubah, newItem]);
    setNewOHB({ nama: "", stdKosPerUnit: 0, sebenarKosJumlah: 0 });
  };

  // Fixed Overhead updates & handlers
  const updateOHT = (index: number, field: keyof OverheadTetap, value: any) => {
    const sanitized = typeof value === "number" ? Math.max(0, isNaN(value) ? 0 : value) : value;
    const updated = [...overheadTetap];
    updated[index] = { ...updated[index], [field]: sanitized };
    onUpdateOverheadTetap(updated);
  };

  const deleteOHT = (id: string) => {
    onUpdateOverheadTetap(overheadTetap.filter((item) => item.id !== id));
  };

  const addOHT = () => {
    if (!newOHT.nama) return;
    const stdWeekly = Math.max(0, newOHT.stdKosMingguan > 0
      ? newOHT.stdKosMingguan
      : newOHT.sebenarKosJumlah);

    const newItem: OverheadTetap = {
      id: "ot-" + Date.now(),
      nama: newOHT.nama,
      stdKosMingguan: stdWeekly,
      sebenarKosJumlah: Math.max(0, newOHT.sebenarKosJumlah > 0 ? newOHT.sebenarKosJumlah : stdWeekly),
    };
    onUpdateOverheadTetap([...overheadTetap, newItem]);
    setNewOHT({ nama: "", stdKosMingguan: 0, sebenarKosJumlah: 0 });
  };

  // Batch & Production settings
  const batchQtyStd = Math.max(1, config.kuantitiPengeluaranPiawai || 1);
  const batchQtyAct = Math.max(1, config.kuantitiPengeluaranSebenar || config.kuantitiPengeluaranPiawai || 1);
  const batchUnit = config.unitPengeluaran || config.unitProduk || (lang === "en" ? "units" : "bekas");

  // 1. Kos Bahan Mentah Sebenar = Kuantiti bahan sebenar × Harga sebenar bagi kelompok
  let totalBahanActual = 0;
  bahanMentah.forEach(item => {
    const unitActual = item.sebenarUnit || item.unit || "unit";
    const priceUnitActual = item.sebenarHargaUnit || item.hargaUnit || unitActual;
    const ap = item.sebenarHargaPerUnit || 0;
    const aq = item.sebenarKuantitiJumlah || 0;
    totalBahanActual += calculateMaterialCost(aq, unitActual, ap, priceUnitActual);
  });

  // 2. Kos Buruh Sebenar = Jam bekerja sebenar × Kadar upah sejam
  let totalBuruhActual = 0;
  buruhLangsung.forEach(item => {
    const unitMasa = item.sebenarUnitMasa || item.unitMasa || "jam";
    const ar = item.sebenarKadarPerJam || 0;
    const ah = item.sebenarJamJumlah || 0;
    totalBuruhActual += calculateLaborCost(ah, unitMasa, ar);
  });

  // 3. Kos Overhead Berubah Sebenar
  let totalOHBActual = 0;
  overheadBerubah.forEach(item => {
    totalOHBActual += (item.sebenarKosJumlah || 0);
  });

  // 4. Kos Tetap Sebenar
  const totalOHTActual = overheadTetap.reduce((sum, item) => sum + (item.sebenarKosJumlah || 0), 0);
  const fixedOHPerBatchAct = Q_act > 0 ? (totalOHTActual / Q_act) * batchQtyAct : (totalOHTActual > 0 ? totalOHTActual : 0);

  // Jumlah Kos Pengeluaran Sebenar = Bahan + Buruh + Overhed
  const totalProductionCostActual = totalBahanActual + totalBuruhActual + totalOHBActual + fixedOHPerBatchAct;
  const actualCostPerUnit = totalProductionCostActual / batchQtyAct;
  const actualVariableCostPerBowl = (totalBahanActual + totalBuruhActual + totalOHBActual) / batchQtyAct;
  const totalVariableActual = totalBahanActual + totalBuruhActual + totalOHBActual;

  // Standard benchmarks for batch comparison
  const totalBahanStd = bahanMentah.reduce((sum, item) => sum + calculateMaterialCost(item.stdKuantitiPerUnit, item.unit, item.stdHargaPerUnit, item.hargaUnit), 0);
  const totalBuruhStd = buruhLangsung.reduce((sum, item) => sum + calculateLaborCost(item.stdJamPerUnit, item.unitMasa || "jam", item.stdKadarPerJam), 0);
  const totalOHBStd = overheadBerubah.reduce((sum, item) => sum + (item.stdKosPerUnit || 0), 0);
  const totalOHTStd = overheadTetap.reduce((sum, item) => sum + (item.stdKosMingguan || 0), 0);
  const fixedOHPerBatchStd = Q_act > 0 ? (totalOHTStd / Q_act) * batchQtyStd : (totalOHTStd > 0 ? totalOHTStd : 0);
  const totalProductionCostStd = totalBahanStd + totalBuruhStd + totalOHBStd + fixedOHPerBatchStd;
  const stdCostPerUnit = totalProductionCostStd / batchQtyStd;

  // Per-unit breakdown comparisons
  const actualBahanPerUnit = totalBahanActual / batchQtyAct;
  const stdBahanPerUnit = totalBahanStd / batchQtyStd;
  const actualBuruhPerUnit = totalBuruhActual / batchQtyAct;
  const stdBuruhPerUnit = totalBuruhStd / batchQtyStd;
  const actualOHBPerUnit = totalOHBActual / batchQtyAct;
  const stdOHBPerUnit = totalOHBStd / batchQtyStd;
  const stdVarCostPerUnit = stdBahanPerUnit + stdBuruhPerUnit + stdOHBPerUnit;
  const costDiff = actualVariableCostPerBowl - stdVarCostPerUnit;

  // Scaled standard cost if actual batch quantity differs from standard
  const scaledStdCost = stdCostPerUnit * batchQtyAct;
  const batchVariance = totalProductionCostActual - scaledStdCost;
  const isCostFavorable = batchVariance <= 0.005;

  const actualRevenue = config.hargaJualanSebenar * (Q_act > 0 ? Q_act : batchQtyAct);
  const actualContributionMargin = actualRevenue - totalVariableActual;
  const actualNetProfit = actualContributionMargin - totalOHTActual;
  const actualMarginPercent = config.hargaJualanSebenar > 0
    ? ((config.hargaJualanSebenar - actualVariableCostPerBowl) / config.hargaJualanSebenar) * 100
    : 0;

  return (
    <div className="space-y-6 sm:space-y-8 animate-fadeIn">
      {/* RBAC Access Notice Banner */}
      {isReadOnly && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-900 text-xs">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>{lang === "en" ? `View-Only Mode (Role: ${roleDef.title})` : `Mod Lihat Sahaja (Akses Jawatan: ${roleDef.title})`}</strong> — {lang === "en" ? "Daily editing permissions are restricted by organization access rules." : "Hak akses edit data harian dikunci mengikut Matriks Hak Akses Organisasi."}
            </span>
          </div>
          {roleDef.canApproveTasks && (
            <button
              onClick={() => setApprovedStatus(!approvedStatus)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                approvedStatus ? "bg-emerald-600 text-white shadow-xs" : "bg-amber-200 text-amber-900 hover:bg-amber-300"
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {approvedStatus 
                ? (lang === "en" ? "Data Approved" : "Data Disahkan (Approved)") 
                : (lang === "en" ? "Verify & Approve Staff Data" : "Sahkan & Semak Data Staf")}
            </button>
          )}
        </div>
      )}

      {/* 1. MAKLUMAT PRODUK & RINGKASAN KOS SEBENAR (EXECUTIVE ACTUAL DASHBOARD) */}
      <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200/80 shadow-xs space-y-6">
        
        {/* Tajuk & Tag Produk */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-100">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-mono font-bold tracking-wider text-emerald-800 uppercase flex items-center gap-1.5 bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-100">
                <Target className="w-3.5 h-3.5 text-emerald-700" />
                {lang === "en" ? "Actual Incurred Performance" : "Prestasi & Kos Sebenar Direkodkan"}
              </span>
              <span className="text-slate-300">·</span>
              <span className="text-xs font-bold text-slate-700">
                {config.namaSyarikat || "SCHOOL ENTERPRISE"}
              </span>
            </div>
            <h2 className="screen-title text-slate-900 tracking-tight flex items-center gap-2.5">
              <TrendingUp className="w-7 h-7 text-emerald-600 shrink-0" />
              <span>{t.actualSheet.title}</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 leading-relaxed max-w-3xl">
              {lang === "en" 
                ? `Actual expenditures incurred for raw materials, direct labor, and overhead for ${config.namaProduk} based on actual sales of ${fNum(Q_act)} ${unitLabel}.` 
                : `Kos perbelanjaan sebenar untuk bahan mentah, upah buruh, serta overhead bagi ${config.namaProduk} berdasarkan jualan sebenar sebanyak ${fNum(Q_act)} ${unitLabel}.`}
            </p>
          </div>

          {/* Kad Maklumat Produk Terpilih */}
          <div className="p-3.5 sm:p-4 bg-slate-50 rounded-2xl border border-slate-200/80 shrink-0 space-y-1.5">
            <span className="text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider block">
              {lang === "en" ? "ACTUAL REALIZED SALES" : "JUALAN SEBENAR DITERIMA"}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-base sm:text-lg font-display font-extrabold text-slate-900">
                {config.namaProduk}
              </span>
              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md text-[11px] font-bold font-mono">
                {unitLabel}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-600 font-mono pt-1 border-t border-slate-200/60">
              <span>{lang === "en" ? "Sold:" : "Dijual:"} <strong className="text-slate-900">{fNum(Q_act)}</strong> {unitLabel}</span>
              <span className="text-slate-300">|</span>
              <span>{lang === "en" ? "Actual Price:" : "Harga Sebenar:"} <strong className="text-emerald-700">{f(config.hargaJualanSebenar)}</strong></span>
            </div>
          </div>
        </div>

        {/* 2. RINGKASAN PECAHAN KOS SEUNIT SEBENAR (ACTUAL COST WATERFALL) */}
        <div>
          <span className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider block mb-3">
            {lang === "en" ? "ACTUAL UNIT COST BREAKDOWN & STANDARD VARIANCE" : "PECAHAN KOS SEUNIT SEBENAR & VARIANS STANDARD"}
          </span>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            
            {/* 1. Bahan Mentah Sebenar Seunit */}
            <div className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200/70 space-y-1 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-500 font-mono">
                <span className="font-semibold">{lang === "en" ? "1. Actual Materials" : "1. Bahan Sebenar"}</span>
                <Utensils className="w-3.5 h-3.5 text-blue-600" />
              </div>
              <div className="my-1">
                <span className="text-xl sm:text-2xl font-display font-extrabold text-slate-900 font-mono tabular-nums">
                  {f(actualBahanPerUnit)}
                </span>
                <span className="text-[11px] text-slate-500 font-sans block mt-0.5">/ {unitLabel}</span>
              </div>
              <div className="pt-2 border-t border-slate-200/60 text-[10px] text-slate-500 font-mono flex justify-between">
                <span>Total: {f(totalBahanActual)}</span>
                <span className={actualBahanPerUnit <= stdBahanPerUnit ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>
                  Std: {f(stdBahanPerUnit)}
                </span>
              </div>
            </div>

            {/* 2. Buruh Langsung Sebenar Seunit */}
            <div className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200/70 space-y-1 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-500 font-mono">
                <span className="font-semibold">{lang === "en" ? "2. Actual Labor" : "2. Buruh Sebenar"}</span>
                <HardHat className="w-3.5 h-3.5 text-amber-600" />
              </div>
              <div className="my-1">
                <span className="text-xl sm:text-2xl font-display font-extrabold text-slate-900 font-mono tabular-nums">
                  {f(actualBuruhPerUnit)}
                </span>
                <span className="text-[11px] text-slate-500 font-sans block mt-0.5">/ {unitLabel}</span>
              </div>
              <div className="pt-2 border-t border-slate-200/60 text-[10px] text-slate-500 font-mono flex justify-between">
                <span>Total: {f(totalBuruhActual)}</span>
                <span className={actualBuruhPerUnit <= stdBuruhPerUnit ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>
                  Std: {f(stdBuruhPerUnit)}
                </span>
              </div>
            </div>

            {/* 3. Overhead Berubah Sebenar Seunit */}
            <div className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200/70 space-y-1 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-500 font-mono">
                <span className="font-semibold">{lang === "en" ? "3. Actual Variable OH" : "3. Overhead Sebenar"}</span>
                <Clock className="w-3.5 h-3.5 text-sky-600" />
              </div>
              <div className="my-1">
                <span className="text-xl sm:text-2xl font-display font-extrabold text-slate-900 font-mono tabular-nums">
                  {f(actualOHBPerUnit)}
                </span>
                <span className="text-[11px] text-slate-500 font-sans block mt-0.5">/ {unitLabel}</span>
              </div>
              <div className="pt-2 border-t border-slate-200/60 text-[10px] text-slate-500 font-mono flex justify-between">
                <span>Total: {f(totalOHBActual)}</span>
                <span className={actualOHBPerUnit <= stdOHBPerUnit ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>
                  Std: {f(stdOHBPerUnit)}
                </span>
              </div>
            </div>

            {/* 4. Jumlah Kos Berubah Sebenar Seunit */}
            <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-200/80 space-y-1 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-emerald-800 font-mono">
                <span className="font-bold">{lang === "en" ? "Actual Unit Cost" : "Kos Seunit Sebenar"}</span>
                <Layers className="w-3.5 h-3.5 text-emerald-700" />
              </div>
              <div className="my-1">
                <span className="text-xl sm:text-2xl font-display font-extrabold text-emerald-800 font-mono tabular-nums">
                  {f(actualVariableCostPerBowl)}
                </span>
                <span className="text-[11px] text-emerald-700/80 font-sans block mt-0.5 font-medium">/ {unitLabel}</span>
              </div>
              <div className="pt-2 border-t border-emerald-200/60 text-[10px] font-mono flex justify-between items-center">
                <span className="text-slate-500">vs Std {f(stdVarCostPerUnit)}</span>
                <span className={`font-bold flex items-center gap-0.5 ${isCostFavorable ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {isCostFavorable ? '-' : '+'}{f(Math.abs(costDiff))}
                  {isCostFavorable ? <ArrowDownRight className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                </span>
              </div>
            </div>

          </div>
        </div>

        {/* 3. JALUR PRESTASI KEWANGAN SEBENAR (FINANCIAL REVENUE & ACTUAL NET PROFIT) */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 rounded-2xl text-white grid grid-cols-2 lg:grid-cols-4 gap-4 shadow-sm">
          <div>
            <span className="text-[10px] font-mono text-emerald-300 block uppercase font-bold tracking-wider">
              {lang === "en" ? "Actual Revenue" : "Jumlah Hasil Sebenar"}
            </span>
            <span className="text-lg sm:text-xl font-display font-bold font-mono text-white tabular-nums">
              {f(actualRevenue)}
            </span>
            <span className="text-[10px] text-slate-300 block font-mono">
              {fNum(Q_act)} × {f(config.hargaJualanSebenar)}
            </span>
          </div>

          <div className="border-l border-white/15 pl-4">
            <span className="text-[10px] font-mono text-emerald-300 block uppercase font-bold tracking-wider">
              {lang === "en" ? "Total Contribution Margin" : "Jumlah Margin Caruman"}
            </span>
            <span className="text-lg sm:text-xl font-display font-bold font-mono text-emerald-300 tabular-nums">
              {f(actualContributionMargin)}
            </span>
            <span className="text-[10px] text-emerald-200/80 block font-mono font-bold">
              {actualMarginPercent.toFixed(1)}% margin
            </span>
          </div>

          <div className="border-l border-white/15 pl-4">
            <span className="text-[10px] font-mono text-sky-200 block uppercase font-bold tracking-wider">
              {lang === "en" ? "Actual Fixed Costs" : "Kos Tetap Sebenar"}
            </span>
            <span className="text-lg sm:text-xl font-display font-bold font-mono text-white tabular-nums">
              {f(totalOHTActual)}
            </span>
            <span className="text-[10px] text-slate-300 block font-mono">
              {lang === "en" ? "Weekly total" : "Jumlah mingguan"}
            </span>
          </div>

          <div className="border-l border-white/15 pl-4">
            <span className="text-[10px] font-mono text-amber-300 block uppercase font-bold tracking-wider">
              {lang === "en" ? "Actual Net Profit" : "Untung Bersih Sebenar"}
            </span>
            <span className={`text-lg sm:text-xl font-display font-bold font-mono tabular-nums ${actualNetProfit >= 0 ? 'text-amber-300' : 'text-rose-300'}`}>
              {f(actualNetProfit)}
            </span>
            <span className="text-[10px] text-slate-300 block">
              {lang === "en" ? "Net weekly realized" : "Untung bersih mingguan"}
            </span>
          </div>
        </div>

      </div>

      {/* Quick Setup / Smooth Onboarding Banner */}
      <div className="bg-emerald-600/5 border border-emerald-600/15 rounded-2xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-2xs">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-emerald-600/10 rounded-lg text-emerald-600 shrink-0 mt-0.5">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-slate-800 text-sm">
              {lang === "en" ? "Quick 1-Click Actual Data Fill" : "Kemudahan Mengisi Data Sebenar (1-Click)"}
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === "en"
                ? `Click this button to automatically populate actual fields based on standard targets (for ${Q_act} ${unitLabel} sold). Then simply adjust whatever differed this week!`
                : `Klik butang di sebelah untuk mengisi semua lajur sebenar secara automatik berasaskan sasaran standard anda (mengikut jualan ${Q_act} ${unitLabel}). Selepas itu, anda cuma perlu selaraskan apa yang berbeza sahaja untuk minggu ini. Amat jimat masa!`}
            </p>
          </div>
        </div>
        <button
          onClick={salinStandardKeSebenar}
          className="flex items-center gap-1.5 px-4.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer whitespace-nowrap active:scale-95"
        >
          {copiedNotification ? (
            <>
              <Check className="w-4 h-4 animate-ping" /> {lang === "en" ? "Successfully Copied!" : "Berjaya Disalin!"}
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" /> {t.actualSheet.copyFromStd}
            </>
          )}
        </button>
      </div>

      {/* SECTION 1: BAHAN MENTAH LANGSUNG SEBENAR */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <h3 className="font-display font-bold text-slate-800 flex items-center gap-2">
            <Utensils className="w-5 h-5 text-emerald-600" />
            {t.actualSheet.materialTitle}
          </h3>
          <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-full font-mono font-bold text-xs">
            {t.common.total}: {f(totalBahanActual)}
          </span>
        </div>

        {/* Desktop Table View (>= 640px) */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[950px]">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-mono text-slate-400 uppercase bg-slate-50/20">
                <th className="py-3 px-5 font-semibold min-w-[280px]">{t.actualSheet.matName}</th>
                <th className="py-3 px-4 font-semibold w-24">{t.common.unit}</th>
                <th className="py-3 px-4 font-semibold w-40 text-right">{lang === "en" ? "Std Quantity" : "Std Kuantiti"}</th>
                <th className="py-3 px-4 font-semibold w-44 text-right">{t.actualSheet.actualQty}</th>
                <th className="py-3 px-4 font-semibold w-44 text-right">{t.actualSheet.actualPrice} ({config.currency})</th>
                <th className="py-3 px-4 font-semibold w-36 text-right">{t.actualSheet.actualTotal}</th>
                <th className="py-3 px-4 text-center w-16">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bahanMentah.map((item, index) => {
                const { perUnit: actQtyPerUnit } = resolveActualQty(item.sebenarKuantitiJumlah, item.stdKuantitiPerUnit, Q_act);
                const stdAllowed = item.stdKuantitiPerUnit * Q_act;
                
                // Live variance analysis
                const qtyDiff = actQtyPerUnit - item.stdKuantitiPerUnit;
                const qtyPercentDiff = item.stdKuantitiPerUnit > 0 ? (qtyDiff / item.stdKuantitiPerUnit) * 100 : 0;
                const priceDiff = item.sebenarHargaPerUnit - item.stdHargaPerUnit;

                return (
                  <tr key={item.id} className="text-sm hover:bg-slate-50/40 transition-colors">
                    <td className="py-3.5 px-5 font-medium text-slate-800">
                      <input
                        type="text"
                        value={item.nama}
                        disabled={isReadOnly}
                        onChange={(e) => updateBahan(index, "nama", e.target.value)}
                        onKeyDown={(e) => handleInputEnterKey(e)}
                        className="w-full min-w-[240px] bg-transparent border-b border-transparent focus:border-emerald-500 font-medium text-slate-800 outline-hidden focus:px-1 py-0.5 text-sm"
                      />
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-600">
                      <input
                        type="text"
                        value={item.unit}
                        disabled={isReadOnly}
                        onChange={(e) => updateBahan(index, "unit", e.target.value)}
                        onKeyDown={(e) => handleInputEnterKey(e)}
                        className="w-full bg-transparent border-b border-transparent focus:border-emerald-500 font-mono text-slate-600 outline-hidden focus:px-1 py-0.5 text-sm"
                      />
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-700 text-xs text-right">
                      <span className="font-semibold text-slate-800 tabular-nums">{fNum(item.stdKuantitiPerUnit)} {item.unit}</span>
                      {Q_act > 1 && (
                        <span className="block text-[10px] text-slate-400 font-normal tabular-nums">
                          {lang === "en" ? `Total: ${fNum(stdAllowed)} ${item.unit}` : `Jumlah: ${fNum(stdAllowed)} ${item.unit}`}
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col gap-1 max-w-[150px] ml-auto">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            step="any"
                            inputMode="decimal"
                            disabled={isReadOnly}
                            value={item.sebenarKuantitiJumlah || ""}
                            onChange={(e) => updateBahan(index, "sebenarKuantitiJumlah", parseFloat(e.target.value) || 0)}
                            onKeyDown={(e) => handleInputEnterKey(e)}
                            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-emerald-500 rounded-lg px-2.5 py-1.5 font-mono font-semibold text-slate-800 text-xs transition-all outline-hidden focus:ring-2 focus:ring-emerald-500/10 text-right tabular-nums"
                          />
                          <span className="text-slate-400 text-xs font-mono">{item.unit}</span>
                        </div>
                        {/* Live variance tag */}
                        <div className="flex items-center justify-between text-[9px] px-1 font-mono">
                          <span className="text-slate-400">Std: {fNum(item.stdKuantitiPerUnit)}</span>
                          {qtyDiff > 0.001 ? (
                            <span className="text-rose-600 font-bold whitespace-nowrap">+{qtyPercentDiff.toFixed(0)}% ⚠️</span>
                          ) : qtyDiff < -0.001 ? (
                            <span className="text-emerald-600 font-bold whitespace-nowrap">-{Math.abs(qtyPercentDiff).toFixed(0)}% ✨</span>
                          ) : (
                            <span className="text-slate-400">{lang === "en" ? "Equal" : "Sama"}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col gap-1 max-w-[150px] ml-auto">
                        <div className="relative">
                          <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 text-slate-400 font-mono text-xs">{config.currency}</span>
                          <input
                            type="number"
                            step="any"
                            inputMode="decimal"
                            disabled={isReadOnly}
                            value={item.sebenarHargaPerUnit || ""}
                            onChange={(e) => updateBahan(index, "sebenarHargaPerUnit", parseFloat(e.target.value) || 0)}
                            onKeyDown={(e) => handleInputEnterKey(e)}
                            className="w-full pl-8 pr-2 py-1.5 bg-slate-50 border border-slate-200 focus:bg-white focus:border-emerald-500 rounded-lg font-mono font-semibold text-slate-800 text-xs transition-all outline-hidden focus:ring-2 focus:ring-emerald-500/10 text-right tabular-nums"
                          />
                        </div>
                        {/* Live variance tag */}
                        <div className="flex items-center justify-between text-[9px] px-1 font-mono">
                          <span className="text-slate-400 whitespace-nowrap">Std: {f(item.stdHargaPerUnit)}</span>
                          {priceDiff > 0.005 ? (
                            <span className="text-rose-600 font-bold whitespace-nowrap">+{config.currency}{priceDiff.toFixed(2)}</span>
                          ) : priceDiff < -0.005 ? (
                            <span className="text-emerald-600 font-bold whitespace-nowrap">-{config.currency}{Math.abs(priceDiff).toFixed(2)}</span>
                          ) : (
                            <span className="text-slate-400">{lang === "en" ? "Equal" : "Sama"}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-slate-950 bg-slate-50/10 text-xs text-right tabular-nums whitespace-nowrap">
                      {f(calculateMaterialCost(item.sebenarKuantitiJumlah, item.sebenarUnit || item.unit, item.sebenarHargaPerUnit, item.sebenarHargaUnit || item.hargaUnit || item.unit))}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      {!isReadOnly && (
                        <button
                          type="button"
                          onClick={() => deleteBahan(item.id)}
                          className="text-slate-400 hover:text-rose-600 p-2 rounded-md transition-colors cursor-pointer inline-flex items-center justify-center min-h-[36px] min-w-[36px]"
                          title={lang === "en" ? "Delete Material" : "Hapus Bahan Sebenar"}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {/* Add New Row dengan Templat Pantas (Desktop) */}
              {!isReadOnly && (
                <tr className="bg-slate-50/20 text-sm">
                  <td className="py-3 px-5">
                    <input
                      type="text"
                      placeholder={lang === "en" ? "e.g. Fresh Pastry Sheets" : "Contoh: Sayur Kangkung Segar"}
                      value={newBahan.nama}
                      onChange={(e) => setNewBahan({ ...newBahan, nama: e.target.value })}
                      onKeyDown={(e) => handleInputEnterKey(e)}
                      className="w-full min-w-[260px] bg-white border border-slate-200 focus:border-emerald-500 rounded-lg px-3 py-2 font-medium outline-hidden text-sm"
                    />
                    {/* Preset Quick Tray */}
                    <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                      <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">{t.common.quickTemplates}:</span>
                      {presetsBahan.map((p) => (
                        <button
                          key={p.nama}
                          type="button"
                          onClick={() => {
                            const calculatedQty = p.stdKuantitiPerUnit;
                            setNewBahan({
                              nama: p.nama,
                              unit: p.unit,
                              stdKuantitiPerUnit: p.stdKuantitiPerUnit,
                              stdHargaPerUnit: p.stdHargaPerUnit,
                              sebenarKuantitiJumlah: calculatedQty,
                              sebenarHargaPerUnit: p.stdHargaPerUnit,
                            });
                          }}
                          className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 hover:text-emerald-700 text-slate-600 text-[10px] rounded-md transition-all font-sans cursor-pointer whitespace-nowrap"
                        >
                          {p.nama.split(" ")[0]}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <input
                      type="text"
                      placeholder="kg"
                      value={newBahan.unit}
                      onChange={(e) => setNewBahan({ ...newBahan, unit: e.target.value })}
                      onKeyDown={(e) => handleInputEnterKey(e)}
                      className="w-full bg-white border border-slate-200 focus:border-emerald-500 rounded-lg px-2.5 py-1.5 font-mono outline-hidden text-sm"
                    />
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-500 text-right">
                    {newBahan.stdKuantitiPerUnit > 0 ? (
                      <span className="tabular-nums">{fNum(newBahan.stdKuantitiPerUnit * Q_act)} {newBahan.unit}</span>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={newBahan.sebenarKuantitiJumlah || ""}
                      onChange={(e) => setNewBahan({ ...newBahan, sebenarKuantitiJumlah: parseFloat(e.target.value) || 0 })}
                      onKeyDown={(e) => handleInputEnterKey(e)}
                      className="w-full bg-white border border-slate-200 focus:border-emerald-500 rounded-lg px-2.5 py-1.5 font-mono outline-hidden text-right tabular-nums text-sm"
                    />
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 text-slate-400 font-mono text-xs">{config.currency}</span>
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={newBahan.sebenarHargaPerUnit || ""}
                        onChange={(e) => setNewBahan({ ...newBahan, sebenarHargaPerUnit: parseFloat(e.target.value) || 0 })}
                        onKeyDown={(e) => handleInputEnterKey(e, addBahan)}
                        className="w-full pl-8 pr-2 py-1.5 bg-white border border-slate-200 focus:border-emerald-500 rounded-lg font-mono outline-hidden text-right tabular-nums text-sm"
                      />
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono font-bold text-slate-500 bg-slate-50/10 text-xs text-right tabular-nums whitespace-nowrap">
                    {f(newBahan.sebenarKuantitiJumlah * newBahan.sebenarHargaPerUnit)}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <button
                      type="button"
                      onClick={addBahan}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white p-2 rounded-lg shadow-sm transition-all cursor-pointer inline-flex items-center justify-center min-h-[36px] min-w-[36px] active:scale-95"
                      title={lang === "en" ? "Add Material" : "Tambah Bahan Sebenar"}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Stacked Card View for Bahan Mentah Sebenar (< 640px) */}
        <div className="block sm:hidden p-3.5 space-y-3.5">
          {bahanMentah.map((item, index) => {
            const { perUnit: actQtyPerUnit } = resolveActualQty(item.sebenarKuantitiJumlah, item.stdKuantitiPerUnit, Q_act);
            const qtyDiff = actQtyPerUnit - item.stdKuantitiPerUnit;
            const qtyPercentDiff = item.stdKuantitiPerUnit > 0 ? (qtyDiff / item.stdKuantitiPerUnit) * 100 : 0;
            const priceDiff = item.sebenarHargaPerUnit - item.stdHargaPerUnit;

            return (
              <div key={item.id} className="p-3.5 bg-slate-50/70 dark:bg-[#101c30] rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={item.nama}
                      disabled={isReadOnly}
                      onChange={(e) => updateBahan(index, "nama", e.target.value)}
                      className="w-full font-semibold text-slate-900 dark:text-slate-100 bg-transparent border-b border-transparent focus:border-emerald-500 text-[16px] py-1 outline-hidden"
                      placeholder="Nama Bahan"
                    />
                    <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1.5 mt-0.5">
                      <span>Std: {item.stdKuantitiPerUnit} {item.unit}</span>
                      <span>·</span>
                      <span>{f(item.stdHargaPerUnit)}/{item.unit}</span>
                    </div>
                  </div>
                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={() => deleteBahan(item.id)}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-rose-600 active:scale-95 transition-all cursor-pointer rounded-xl bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 shadow-2xs"
                      title={t.common.delete}
                    >
                      <Trash2 className="w-4 h-4 text-rose-500" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-mono font-bold text-slate-500 uppercase text-left">
                        Kuantiti Sebenar ({item.unit})
                      </label>
                      {qtyDiff > 0.001 ? (
                        <span className="text-rose-600 font-bold text-[9px] font-mono">+{qtyPercentDiff.toFixed(0)}% ⚠️</span>
                      ) : qtyDiff < -0.001 ? (
                        <span className="text-emerald-600 font-bold text-[9px] font-mono">-{Math.abs(qtyPercentDiff).toFixed(0)}% ✨</span>
                      ) : null}
                    </div>
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      disabled={isReadOnly}
                      value={item.sebenarKuantitiJumlah || ""}
                      onChange={(e) => updateBahan(index, "sebenarKuantitiJumlah", parseFloat(e.target.value) || 0)}
                      className="w-full bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono font-semibold text-[16px] text-slate-800 dark:text-slate-100 tabular-nums outline-hidden focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-mono font-bold text-slate-500 uppercase text-left">
                        Harga ({config.currency})
                      </label>
                      {priceDiff > 0.005 ? (
                        <span className="text-rose-600 font-bold text-[9px] font-mono">+{priceDiff.toFixed(2)}</span>
                      ) : priceDiff < -0.005 ? (
                        <span className="text-emerald-600 font-bold text-[9px] font-mono">-{Math.abs(priceDiff).toFixed(2)}</span>
                      ) : null}
                    </div>
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      disabled={isReadOnly}
                      value={item.sebenarHargaPerUnit || ""}
                      onChange={(e) => updateBahan(index, "sebenarHargaPerUnit", parseFloat(e.target.value) || 0)}
                      className="w-full bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono font-semibold text-[16px] text-slate-800 dark:text-slate-100 tabular-nums outline-hidden focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2.5 border-t border-slate-200/60 dark:border-slate-800">
                  <span className="text-xs text-slate-500 font-medium">Jumlah Kos Sebenar</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums text-sm whitespace-nowrap">
                    {f(calculateMaterialCost(item.sebenarKuantitiJumlah, item.sebenarUnit || item.unit, item.sebenarHargaPerUnit, item.sebenarHargaUnit || item.hargaUnit || item.unit))}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Add Item Card Mobile */}
          {!isReadOnly && (
            <div className="p-4 bg-white dark:bg-[#132238] rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 space-y-3">
              <span className="text-[11px] font-mono font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block text-left">
                + {lang === "en" ? "Record Actual Ingredient" : "Tambah Bahan Sebenar"}
              </span>

              <div>
                <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">Nama Bahan</label>
                <input
                  type="text"
                  placeholder={lang === "en" ? "e.g. Flour / Seasoning" : "Contoh: Kulit Popia / Minyak Masak"}
                  value={newBahan.nama}
                  onChange={(e) => setNewBahan({ ...newBahan, nama: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-[#101c30] border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-[16px] text-slate-900 dark:text-slate-100 outline-hidden focus:border-emerald-500"
                />
              </div>

              {/* Quick Template Buttons */}
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">{t.common.quickTemplates}:</span>
                {presetsBahan.map((p) => (
                  <button
                    key={p.nama}
                    type="button"
                    onClick={() => {
                      setNewBahan({
                        nama: p.nama,
                        unit: p.unit,
                        stdKuantitiPerUnit: p.stdKuantitiPerUnit,
                        stdHargaPerUnit: p.stdHargaPerUnit,
                        sebenarKuantitiJumlah: p.stdKuantitiPerUnit,
                        sebenarHargaPerUnit: p.stdHargaPerUnit,
                      });
                    }}
                    className="px-2.5 py-1.5 min-h-[36px] bg-slate-100 dark:bg-[#182a44] hover:bg-slate-200 text-slate-700 dark:text-slate-200 text-xs rounded-lg transition-all font-sans cursor-pointer whitespace-nowrap active:scale-95"
                  >
                    {p.nama.split(" ")[0]}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">Unit</label>
                  <input
                    type="text"
                    placeholder="kg"
                    value={newBahan.unit}
                    onChange={(e) => setNewBahan({ ...newBahan, unit: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-[#101c30] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono text-[16px] text-slate-900 dark:text-slate-100 outline-hidden"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">Kuantiti</label>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={newBahan.sebenarKuantitiJumlah || ""}
                    onChange={(e) => setNewBahan({ ...newBahan, sebenarKuantitiJumlah: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-50 dark:bg-[#101c30] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono text-[16px] text-slate-900 dark:text-slate-100 tabular-nums outline-hidden"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">Harga (RM)</label>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={newBahan.sebenarHargaPerUnit || ""}
                    onChange={(e) => setNewBahan({ ...newBahan, sebenarHargaPerUnit: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-50 dark:bg-[#101c30] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono text-[16px] text-slate-900 dark:text-slate-100 tabular-nums outline-hidden"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={addBahan}
                className="w-full min-h-[44px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer active:scale-[0.98] text-sm"
              >
                <Plus className="w-4 h-4" />
                <span>{lang === "en" ? "Add Material" : "Tambah Bahan Sebenar"}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* SECTION 2: BURUH & OVERHEAD BERUBAH SEBENAR */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* BURUH SEBENAR */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <h3 className="font-display font-bold text-slate-800 flex items-center gap-2">
              <HardHat className="w-5 h-5 text-emerald-600" />
              {t.actualSheet.laborTitle}
            </h3>
            <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-full font-mono font-bold text-xs">
              {t.common.total}: {f(totalBuruhActual)}
            </span>
          </div>

          {/* Desktop Table View */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[550px]">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] font-mono text-slate-400 uppercase bg-slate-50/20">
                  <th className="py-3 px-4 font-semibold min-w-[200px] text-left">{t.actualSheet.laborTask}</th>
                  <th className="py-3 px-3 font-semibold w-28 text-right">{lang === "en" ? "Std Hours" : "Std Jam"}</th>
                  <th className="py-3 px-3 font-semibold w-32 text-right">{t.actualSheet.actualHours}</th>
                  <th className="py-3 px-3 font-semibold w-32 text-right">{t.actualSheet.actualRate}</th>
                  <th className="py-3 px-3 font-semibold w-24 text-right">{t.common.total}</th>
                  <th className="py-3 px-3 text-center w-12">{t.common.delete}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {buruhLangsung.map((item, index) => {
                  const { perUnit: actJamPerUnit } = resolveActualHours(item.sebenarJamJumlah, item.stdJamPerUnit, Q_act);
                  const stdJamAllowed = item.stdJamPerUnit * Q_act;
                  const jamDiff = actJamPerUnit - item.stdJamPerUnit;
                  const jamPercentDiff = item.stdJamPerUnit > 0 ? (jamDiff / item.stdJamPerUnit) * 100 : 0;
                  const rateDiff = item.sebenarKadarPerJam - item.stdKadarPerJam;

                  return (
                    <tr key={item.id} className="text-xs hover:bg-slate-50/40 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-4 font-medium text-slate-800 dark:text-slate-200">
                        <input
                          type="text"
                          value={item.nama}
                          disabled={isReadOnly}
                          onChange={(e) => updateBuruh(index, "nama", e.target.value)}
                          onKeyDown={(e) => handleInputEnterKey(e)}
                          className="w-full min-w-[180px] bg-transparent border-b border-transparent focus:border-emerald-500 font-medium text-slate-800 dark:text-slate-200 outline-hidden focus:px-1 py-0.5"
                        />
                      </td>
                      <td className="py-3.5 px-3 font-mono text-slate-700 dark:text-slate-300 text-[11px] text-right tabular-nums">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{fNum(item.stdJamPerUnit)}j</span>
                        {Q_act > 1 && (
                          <span className="block text-[9px] text-slate-400 font-normal">
                            {lang === "en" ? `Total: ${fNum(stdJamAllowed)}j` : `Jumlah: ${fNum(stdJamAllowed)}j`}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="flex flex-col gap-1 max-w-[130px] ml-auto">
                          <input
                            type="number"
                            step="any"
                            inputMode="decimal"
                            disabled={isReadOnly}
                            value={item.sebenarJamJumlah || ""}
                            onChange={(e) => updateBuruh(index, "sebenarJamJumlah", parseFloat(e.target.value) || 0)}
                            onKeyDown={(e) => handleInputEnterKey(e)}
                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:bg-white focus:border-emerald-500 rounded-lg px-2.5 py-1.5 font-mono font-semibold text-slate-800 dark:text-slate-100 text-xs text-right tabular-nums transition-all outline-hidden focus:ring-2 focus:ring-emerald-500/10"
                          />
                          <div className="flex items-center justify-between text-[9px] px-1 font-mono text-slate-400">
                            <span>Std: {fNum(item.stdJamPerUnit)}j</span>
                            {jamDiff > 0.01 ? (
                              <span className="text-rose-600 font-bold">+{jamPercentDiff.toFixed(0)}% ⚠️</span>
                            ) : jamDiff < -0.01 ? (
                              <span className="text-emerald-600 font-bold">-{Math.abs(jamPercentDiff).toFixed(0)}% ✨</span>
                            ) : (
                              <span>{lang === "en" ? "Equal" : "Sama"}</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="flex flex-col gap-1 max-w-[130px] ml-auto">
                          <div className="flex items-center gap-1">
                            <span className="text-slate-400 font-mono text-xs">{config.currency}</span>
                            <input
                              type="number"
                              step="any"
                              inputMode="decimal"
                              disabled={isReadOnly}
                              value={item.sebenarKadarPerJam || ""}
                              onChange={(e) => updateBuruh(index, "sebenarKadarPerJam", parseFloat(e.target.value) || 0)}
                              onKeyDown={(e) => handleInputEnterKey(e)}
                              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:bg-white focus:border-emerald-500 rounded-lg px-2.5 py-1.5 font-mono font-semibold text-slate-800 dark:text-slate-100 text-xs text-right tabular-nums transition-all outline-hidden focus:ring-2 focus:ring-emerald-500/10"
                            />
                          </div>
                          <div className="flex items-center justify-between text-[9px] px-1 font-mono text-slate-400">
                            <span>Std: {config.currency}{item.stdKadarPerJam.toFixed(2)}</span>
                            {rateDiff > 0.005 ? (
                              <span className="text-rose-600 font-bold">+{rateDiff.toFixed(1)}</span>
                            ) : rateDiff < -0.005 ? (
                              <span className="text-emerald-600 font-bold">-{Math.abs(rateDiff).toFixed(1)}</span>
                            ) : (
                              <span>{lang === "en" ? "Equal" : "Sama"}</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-3 font-mono font-bold text-slate-900 dark:text-slate-100 text-right tabular-nums whitespace-nowrap">
                        {f(calculateLaborCost(item.sebenarJamJumlah, item.sebenarUnitMasa || item.unitMasa || "jam", item.sebenarKadarPerJam))}
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        {!isReadOnly && (
                          <button
                            type="button"
                            onClick={() => deleteBuruh(item.id)}
                            className="text-slate-400 hover:text-rose-600 p-1.5 rounded-md transition-colors cursor-pointer inline-flex items-center"
                            title={lang === "en" ? "Delete Labor" : "Hapus Buruh Sebenar"}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {!isReadOnly && (
                  <tr className="bg-slate-50/20 text-xs">
                    <td className="py-2.5 px-4">
                      <input
                        type="text"
                        placeholder={lang === "en" ? "e.g. Kitchen helper / Fryer" : "Contoh: Pembantu dapur / Penggoreng"}
                        value={newBuruh.nama}
                        onChange={(e) => setNewBuruh({ ...newBuruh, nama: e.target.value })}
                        onKeyDown={(e) => handleInputEnterKey(e)}
                        className="w-full min-w-[190px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-emerald-500 rounded-md px-2.5 py-1.5 outline-hidden font-medium text-xs sm:text-sm"
                      />
                      <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                        <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">{t.common.quickAdd}:</span>
                        {presetsBuruh.map((p) => (
                          <button
                            key={p.nama}
                            type="button"
                            onClick={() => {
                              const calculatedJam = p.stdJamPerUnit;
                              setNewBuruh({
                                nama: p.nama,
                                stdJamPerUnit: p.stdJamPerUnit,
                                stdKadarPerJam: p.stdKadarPerJam,
                                sebenarJamJumlah: calculatedJam,
                                sebenarKadarPerJam: p.stdKadarPerJam,
                              });
                            }}
                            className="px-1 py-0.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-600 dark:text-slate-200 text-[9px] rounded-md transition-all font-sans cursor-pointer whitespace-nowrap"
                          >
                            {p.nama.split(" ")[0]}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 text-right tabular-nums">
                      {newBuruh.stdJamPerUnit > 0 ? `${fNum(newBuruh.stdJamPerUnit)}j` : "-"}
                    </td>
                    <td className="py-2.5 px-3">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        placeholder="0.0"
                        value={newBuruh.sebenarJamJumlah || ""}
                        onChange={(e) => setNewBuruh({ ...newBuruh, sebenarJamJumlah: parseFloat(e.target.value) || 0 })}
                        onKeyDown={(e) => handleInputEnterKey(e)}
                        className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-emerald-500 rounded-md px-2 py-1 outline-hidden font-mono text-xs text-right tabular-nums"
                      />
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1">
                        <span className="text-slate-400 font-mono text-xs">{config.currency}</span>
                        <input
                          type="number"
                          step="any"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={newBuruh.sebenarKadarPerJam || ""}
                          onChange={(e) => setNewBuruh({ ...newBuruh, sebenarKadarPerJam: parseFloat(e.target.value) || 0 })}
                          onKeyDown={(e) => handleInputEnterKey(e, addBuruh)}
                          className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-emerald-500 rounded-md px-2 py-1 outline-hidden font-mono text-xs text-right tabular-nums"
                        />
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-500 text-xs text-right tabular-nums whitespace-nowrap">
                      {f(newBuruh.sebenarJamJumlah * newBuruh.sebenarKadarPerJam)}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <button
                        type="button"
                        onClick={addBuruh}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white p-1 rounded-md shadow-sm transition-all cursor-pointer inline-flex items-center active:scale-95"
                        title={lang === "en" ? "Add Labor" : "Tambah Buruh Sebenar"}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Card View for Buruh Sebenar (< 640px) */}
          <div className="block sm:hidden p-3.5 space-y-3.5">
            {buruhLangsung.map((item, index) => {
              const { perUnit: actJamPerUnit } = resolveActualHours(item.sebenarJamJumlah, item.stdJamPerUnit, Q_act);
              const jamDiff = actJamPerUnit - item.stdJamPerUnit;
              const jamPercentDiff = item.stdJamPerUnit > 0 ? (jamDiff / item.stdJamPerUnit) * 100 : 0;
              const rateDiff = item.sebenarKadarPerJam - item.stdKadarPerJam;

              return (
                <div key={item.id} className="p-3.5 bg-slate-50/70 dark:bg-[#101c30] rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3 shadow-2xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1">
                      <input
                        type="text"
                        value={item.nama}
                        disabled={isReadOnly}
                        onChange={(e) => updateBuruh(index, "nama", e.target.value)}
                        className="w-full font-semibold text-slate-900 dark:text-slate-100 bg-transparent border-b border-transparent focus:border-emerald-500 text-[16px] py-1 outline-hidden"
                        placeholder="Nama Tugasan Buruh"
                      />
                      <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1.5 mt-0.5">
                        <span>Std: {fNum(item.stdJamPerUnit)}j</span>
                        <span>·</span>
                        <span>{f(item.stdKadarPerJam)}/j</span>
                      </div>
                    </div>
                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={() => deleteBuruh(item.id)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-rose-600 active:scale-95 transition-all cursor-pointer rounded-xl bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 shadow-2xs"
                        title={t.common.delete}
                      >
                        <Trash2 className="w-4 h-4 text-rose-500" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] font-mono font-bold text-slate-500 uppercase text-left">
                          Jam Sebenar (j)
                        </label>
                        {jamDiff > 0.01 ? (
                          <span className="text-rose-600 font-bold text-[9px] font-mono">+{jamPercentDiff.toFixed(0)}% ⚠️</span>
                        ) : jamDiff < -0.01 ? (
                          <span className="text-emerald-600 font-bold text-[9px] font-mono">-{Math.abs(jamPercentDiff).toFixed(0)}% ✨</span>
                        ) : null}
                      </div>
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        disabled={isReadOnly}
                        value={item.sebenarJamJumlah || ""}
                        onChange={(e) => updateBuruh(index, "sebenarJamJumlah", parseFloat(e.target.value) || 0)}
                        className="w-full bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono font-semibold text-[16px] text-slate-800 dark:text-slate-100 tabular-nums outline-hidden focus:border-emerald-500"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] font-mono font-bold text-slate-500 uppercase text-left">
                          Kadar ({config.currency}/j)
                        </label>
                        {rateDiff > 0.005 ? (
                          <span className="text-rose-600 font-bold text-[9px] font-mono">+{rateDiff.toFixed(1)}</span>
                        ) : rateDiff < -0.005 ? (
                          <span className="text-emerald-600 font-bold text-[9px] font-mono">-{Math.abs(rateDiff).toFixed(1)}</span>
                        ) : null}
                      </div>
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        disabled={isReadOnly}
                        value={item.sebenarKadarPerJam || ""}
                        onChange={(e) => updateBuruh(index, "sebenarKadarPerJam", parseFloat(e.target.value) || 0)}
                        className="w-full bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono font-semibold text-[16px] text-slate-800 dark:text-slate-100 tabular-nums outline-hidden focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2.5 border-t border-slate-200/60 dark:border-slate-800">
                    <span className="text-xs text-slate-500 font-medium">Jumlah Kos Buruh</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums text-sm whitespace-nowrap">
                      {f(calculateLaborCost(item.sebenarJamJumlah, item.sebenarUnitMasa || item.unitMasa || "jam", item.sebenarKadarPerJam))}
                    </span>
                  </div>
                </div>
              );
            })}

            {!isReadOnly && (
              <div className="p-4 bg-white dark:bg-[#132238] rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 space-y-3">
                <span className="text-[11px] font-mono font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block text-left">
                  + {lang === "en" ? "Record Actual Labor" : "Tambah Buruh Sebenar"}
                </span>

                <div>
                  <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">Tugasan Buruh</label>
                  <input
                    type="text"
                    placeholder={lang === "en" ? "e.g. Cook / Packaging helper" : "Contoh: Tukang Masak / Pembungkus"}
                    value={newBuruh.nama}
                    onChange={(e) => setNewBuruh({ ...newBuruh, nama: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-[#101c30] border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-[16px] text-slate-900 dark:text-slate-100 outline-hidden focus:border-emerald-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">Jam Sebenar</label>
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      placeholder="0.0"
                      value={newBuruh.sebenarJamJumlah || ""}
                      onChange={(e) => setNewBuruh({ ...newBuruh, sebenarJamJumlah: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-slate-50 dark:bg-[#101c30] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono text-[16px] text-slate-900 dark:text-slate-100 tabular-nums outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">Kadar ({config.currency}/j)</label>
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={newBuruh.sebenarKadarPerJam || ""}
                      onChange={(e) => setNewBuruh({ ...newBuruh, sebenarKadarPerJam: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-slate-50 dark:bg-[#101c30] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono text-[16px] text-slate-900 dark:text-slate-100 tabular-nums outline-hidden"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={addBuruh}
                  className="w-full min-h-[44px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer active:scale-[0.98] text-sm"
                >
                  <Plus className="w-4 h-4" />
                  <span>{lang === "en" ? "Add Labor" : "Tambah Buruh Sebenar"}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* OVERHEAD BERUBAH SEBENAR */}
        <div className="bg-white dark:bg-[#0c182b] rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-[#101c30] flex items-center justify-between">
            <h3 className="font-display font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Clock className="w-5 h-5 text-emerald-600" />
              {t.actualSheet.varOhTitle}
            </h3>
            <span className="px-2.5 py-0.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 rounded-full font-mono font-bold text-xs whitespace-nowrap tabular-nums">
              {t.common.total}: {f(totalOHBActual)}
            </span>
          </div>

          {/* Desktop Table View */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[500px]">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] font-mono text-slate-400 uppercase bg-slate-50/20">
                  <th className="py-3 px-4 font-semibold min-w-[220px] text-left">{t.actualSheet.varOhItem}</th>
                  <th className="py-3 px-4 font-semibold w-40 text-right">{lang === "en" ? "Std Cost" : "Std Kos"}</th>
                  <th className="py-3 px-4 font-semibold w-40 text-right">{t.actualSheet.actualCost}</th>
                  <th className="py-3 px-3 text-center w-12">{t.common.delete}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {overheadBerubah.map((item, index) => {
                  const { perUnit: actOHBUnit } = resolveActualOverhead(item.sebenarKosJumlah, item.stdKosPerUnit, Q_act);
                  const stdAllowed = item.stdKosPerUnit * Q_act;
                  const ohbDiff = actOHBUnit - item.stdKosPerUnit;
                  const ohPercentDiff = item.stdKosPerUnit > 0 ? (ohbDiff / item.stdKosPerUnit) * 100 : 0;
                  return (
                    <tr key={item.id} className="text-xs hover:bg-slate-50/40 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-4 font-medium text-slate-800 dark:text-slate-200">
                        <input
                          type="text"
                          value={item.nama}
                          disabled={isReadOnly}
                          onChange={(e) => updateOHB(index, "nama", e.target.value)}
                          onKeyDown={(e) => handleInputEnterKey(e)}
                          className="w-full min-w-[200px] bg-transparent border-b border-transparent focus:border-emerald-500 font-medium text-slate-800 dark:text-slate-200 outline-hidden focus:px-1 py-0.5"
                        />
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-700 dark:text-slate-300 text-xs text-right tabular-nums">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{f(item.stdKosPerUnit)}</span>
                        {Q_act > 1 && (
                          <span className="block text-[10px] text-slate-400 font-normal">
                            {lang === "en" ? `Total: ${f(stdAllowed)}` : `Jumlah: ${f(stdAllowed)}`}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono">
                        <div className="flex flex-col gap-1 max-w-[150px] ml-auto">
                          <div className="flex items-center gap-1">
                            <span className="text-slate-400 text-xs">{config.currency}</span>
                            <input
                              type="number"
                              step="any"
                              inputMode="decimal"
                              disabled={isReadOnly}
                              value={item.sebenarKosJumlah || ""}
                              onChange={(e) => updateOHB(index, "sebenarKosJumlah", parseFloat(e.target.value) || 0)}
                              onKeyDown={(e) => handleInputEnterKey(e)}
                              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:bg-white focus:border-emerald-500 rounded-lg px-2.5 py-1.5 font-mono font-semibold text-slate-800 dark:text-slate-100 text-xs text-right tabular-nums transition-all outline-hidden focus:ring-2 focus:ring-emerald-500/10"
                            />
                          </div>
                          <div className="flex items-center justify-between text-[9px] px-1 font-mono text-slate-400">
                            <span>Std: {f(item.stdKosPerUnit)}</span>
                            {ohbDiff > 0.01 ? (
                              <span className="text-rose-600 font-bold">+{ohPercentDiff.toFixed(0)}% ⚠️</span>
                            ) : ohbDiff < -0.01 ? (
                              <span className="text-emerald-600 font-bold">-{Math.abs(ohPercentDiff).toFixed(0)}% ✨</span>
                            ) : (
                              <span>{lang === "en" ? "Equal" : "Sama"}</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        {!isReadOnly && (
                          <button
                            type="button"
                            onClick={() => deleteOHB(item.id)}
                            className="text-slate-400 hover:text-rose-600 p-1.5 rounded-md transition-colors cursor-pointer inline-flex items-center"
                            title={lang === "en" ? "Delete Variable Overhead" : "Hapus Overhead Berubah Sebenar"}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {!isReadOnly && (
                  <tr className="bg-slate-50/20 text-xs">
                    <td className="py-2.5 px-4">
                      <input
                        type="text"
                        placeholder={lang === "en" ? "e.g. Plastic spoons & bags / Ice" : "Contoh: Sudu & Garpu Plastik / Ais"}
                        value={newOHB.nama}
                        onChange={(e) => setNewOHB({ ...newOHB, nama: e.target.value })}
                        onKeyDown={(e) => handleInputEnterKey(e)}
                        className="w-full min-w-[210px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-emerald-500 rounded-md px-2.5 py-1.5 outline-hidden font-medium text-xs sm:text-sm"
                      />
                      <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                        <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">{t.common.quickAdd}:</span>
                        {presetsOHB.map((p) => (
                          <button
                            key={p.nama}
                            type="button"
                            onClick={() => {
                              const calculatedKos = p.stdKosPerUnit;
                              setNewOHB({
                                nama: p.nama,
                                stdKosPerUnit: p.stdKosPerUnit,
                                sebenarKosJumlah: calculatedKos,
                              });
                            }}
                            className="px-1 py-0.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-600 dark:text-slate-200 text-[9px] rounded-md transition-all font-sans cursor-pointer whitespace-nowrap"
                          >
                            {p.nama.split(" ")[0]}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 text-right tabular-nums">
                      {newOHB.stdKosPerUnit > 0 ? f(newOHB.stdKosPerUnit) : "-"}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-1">
                        <span className="text-slate-400 text-xs font-mono">{config.currency}</span>
                        <input
                          type="number"
                          step="any"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={newOHB.sebenarKosJumlah || ""}
                          onChange={(e) => setNewOHB({ ...newOHB, sebenarKosJumlah: parseFloat(e.target.value) || 0 })}
                          onKeyDown={(e) => handleInputEnterKey(e, addOHB)}
                          className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-emerald-500 rounded-md px-2 py-1 outline-hidden font-mono text-xs text-right tabular-nums"
                        />
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <button
                        type="button"
                        onClick={addOHB}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white p-1 rounded-md shadow-sm transition-all cursor-pointer inline-flex items-center active:scale-95"
                        title={lang === "en" ? "Add Variable Overhead" : "Tambah Overhead Berubah Sebenar"}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Card View for Overhead Berubah Sebenar (< 640px) */}
          <div className="block sm:hidden p-3.5 space-y-3.5">
            {overheadBerubah.map((item, index) => {
              const { perUnit: actOHBUnit } = resolveActualOverhead(item.sebenarKosJumlah, item.stdKosPerUnit, Q_act);
              const ohbDiff = actOHBUnit - item.stdKosPerUnit;
              const ohPercentDiff = item.stdKosPerUnit > 0 ? (ohbDiff / item.stdKosPerUnit) * 100 : 0;

              return (
                <div key={item.id} className="p-3.5 bg-slate-50/70 dark:bg-[#101c30] rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3 shadow-2xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1">
                      <input
                        type="text"
                        value={item.nama}
                        disabled={isReadOnly}
                        onChange={(e) => updateOHB(index, "nama", e.target.value)}
                        className="w-full font-semibold text-slate-900 dark:text-slate-100 bg-transparent border-b border-transparent focus:border-emerald-500 text-[16px] py-1 outline-hidden"
                        placeholder="Nama Item Overhead"
                      />
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        Std: {f(item.stdKosPerUnit)} / unit
                      </div>
                    </div>
                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={() => deleteOHB(item.id)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-rose-600 active:scale-95 transition-all cursor-pointer rounded-xl bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 shadow-2xs"
                        title={t.common.delete}
                      >
                        <Trash2 className="w-4 h-4 text-rose-500" />
                      </button>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-mono font-bold text-slate-500 uppercase text-left">
                        Kos Sebenar ({config.currency})
                      </label>
                      {ohbDiff > 0.01 ? (
                        <span className="text-rose-600 font-bold text-[9px] font-mono">+{ohPercentDiff.toFixed(0)}% ⚠️</span>
                      ) : ohbDiff < -0.01 ? (
                        <span className="text-emerald-600 font-bold text-[9px] font-mono">-{Math.abs(ohPercentDiff).toFixed(0)}% ✨</span>
                      ) : null}
                    </div>
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      disabled={isReadOnly}
                      value={item.sebenarKosJumlah || ""}
                      onChange={(e) => updateOHB(index, "sebenarKosJumlah", parseFloat(e.target.value) || 0)}
                      className="w-full bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono font-semibold text-[16px] text-slate-800 dark:text-slate-100 tabular-nums outline-hidden focus:border-emerald-500"
                    />
                  </div>
                </div>
              );
            })}

            {!isReadOnly && (
              <div className="p-4 bg-white dark:bg-[#132238] rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 space-y-3">
                <span className="text-[11px] font-mono font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block text-left">
                  + {lang === "en" ? "Record Actual Variable OH" : "Tambah Overhead Berubah Sebenar"}
                </span>

                <div>
                  <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">Item Overhead</label>
                  <input
                    type="text"
                    placeholder={lang === "en" ? "e.g. Packaging / Utensils" : "Contoh: Kotak Makanan / Plastik"}
                    value={newOHB.nama}
                    onChange={(e) => setNewOHB({ ...newOHB, nama: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-[#101c30] border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-[16px] text-slate-900 dark:text-slate-100 outline-hidden focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">Kos Sebenar ({config.currency})</label>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={newOHB.sebenarKosJumlah || ""}
                    onChange={(e) => setNewOHB({ ...newOHB, sebenarKosJumlah: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-50 dark:bg-[#101c30] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono text-[16px] text-slate-900 dark:text-slate-100 tabular-nums outline-hidden"
                  />
                </div>

                <button
                  type="button"
                  onClick={addOHB}
                  className="w-full min-h-[44px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer active:scale-[0.98] text-sm"
                >
                  <Plus className="w-4 h-4" />
                  <span>{lang === "en" ? "Add Variable Overhead" : "Tambah Overhead Berubah"}</span>
                </button>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* SECTION 4: KOS TETAP SEBENAR */}
      <div className="bg-white dark:bg-[#0c182b] rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-[#101c30] flex items-center justify-between">
          <h3 className="font-display font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Building className="w-5 h-5 text-emerald-600" />
            {t.actualSheet.fixedOhTitle}
          </h3>
          <span className="px-2.5 py-0.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 rounded-full font-mono font-bold text-xs whitespace-nowrap tabular-nums">
            {t.common.total}: {f(totalOHTActual)}
          </span>
        </div>

        {/* Desktop Table View */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[750px]">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] font-mono text-slate-400 uppercase bg-slate-50/20">
                <th className="py-3 px-5 font-semibold min-w-[280px] text-left">{t.actualSheet.fixedOhItem}</th>
                <th className="py-3 px-4 font-semibold w-52 text-right">{lang === "en" ? "Estimated Std Cost" : "Kos Standard Dianggar"}</th>
                <th className="py-3 px-4 font-semibold w-56 text-right">{lang === "en" ? "Actual Cost This Week" : "Kos Sebenar Minggu Ini"}</th>
                <th className="py-3 px-4 text-center w-16">{t.common.delete}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {overheadTetap.map((item, index) => {
                const ohtDiff = item.sebenarKosJumlah - item.stdKosMingguan;
                const ohtPercentDiff = item.stdKosMingguan > 0 ? (ohtDiff / item.stdKosMingguan) * 100 : 0;
                return (
                  <tr key={item.id} className="text-sm hover:bg-slate-50/40 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-5 font-medium text-slate-800 dark:text-slate-200">
                      <input
                        type="text"
                        value={item.nama}
                        disabled={isReadOnly}
                        onChange={(e) => updateOHT(index, "nama", e.target.value)}
                        onKeyDown={(e) => handleInputEnterKey(e)}
                        className="w-full min-w-[260px] bg-transparent border-b border-transparent focus:border-emerald-500 font-medium text-slate-800 dark:text-slate-200 outline-hidden focus:px-1 py-0.5"
                      />
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-500 dark:text-slate-400 text-right tabular-nums">
                      {f(item.stdKosMingguan)}
                    </td>
                    <td className="py-3.5 px-4 font-mono">
                      <div className="flex flex-col gap-1 max-w-[180px] ml-auto">
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400">{config.currency}</span>
                          <input
                            type="number"
                            step="any"
                            inputMode="decimal"
                            disabled={isReadOnly}
                            value={item.sebenarKosJumlah || ""}
                            onChange={(e) => updateOHT(index, "sebenarKosJumlah", parseFloat(e.target.value) || 0)}
                            onKeyDown={(e) => handleInputEnterKey(e)}
                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:bg-white focus:border-emerald-500 rounded-lg px-2.5 py-1.5 font-mono font-semibold text-slate-800 dark:text-slate-100 text-xs text-right tabular-nums transition-all outline-hidden focus:ring-2 focus:ring-emerald-500/10"
                          />
                        </div>
                        <div className="flex items-center justify-between text-[9px] px-1 font-mono text-slate-400">
                          <span>Std: {f(item.stdKosMingguan)}</span>
                          {ohtDiff > 0.01 ? (
                            <span className="text-rose-600 font-bold">+{ohtPercentDiff.toFixed(0)}% ⚠️</span>
                          ) : ohtDiff < -0.01 ? (
                            <span className="text-emerald-600 font-bold">-{Math.abs(ohtPercentDiff).toFixed(0)}% ✨</span>
                          ) : (
                            <span>{lang === "en" ? "Equal" : "Sama"}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      {!isReadOnly && (
                        <button
                          type="button"
                          onClick={() => deleteOHT(item.id)}
                          className="text-slate-400 hover:text-rose-600 p-1.5 rounded-md transition-colors cursor-pointer inline-flex items-center"
                          title={lang === "en" ? "Delete Fixed Overhead" : "Hapus Kos Tetap Sebenar"}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {!isReadOnly && (
                <tr className="bg-slate-50/20 text-sm">
                  <td className="py-3 px-5">
                    <input
                      type="text"
                      placeholder={lang === "en" ? "e.g. Stall Rental / Council License" : "Contoh: Sewa Tapak / Lesen Majlis"}
                      value={newOHT.nama}
                      onChange={(e) => setNewOHT({ ...newOHT, nama: e.target.value })}
                      onKeyDown={(e) => handleInputEnterKey(e)}
                      className="w-full min-w-[260px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-emerald-500 rounded-lg px-3 py-2 font-medium outline-hidden text-sm"
                    />
                    <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                      <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">{t.common.quickAdd}:</span>
                      {presetsOHT.map((p) => (
                        <button
                          key={p.nama}
                          type="button"
                          onClick={() => {
                            setNewOHT({
                              nama: p.nama,
                              stdKosMingguan: p.stdKosMingguan,
                              sebenarKosJumlah: p.stdKosMingguan,
                            });
                          }}
                          className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-600 dark:text-slate-200 text-[10px] rounded-md transition-all font-sans cursor-pointer whitespace-nowrap"
                        >
                          {p.nama.split(" ")[0]}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-500 text-right tabular-nums">
                    {newOHT.stdKosMingguan > 0 ? f(newOHT.stdKosMingguan) : "-"}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400 text-xs font-mono">{config.currency}</span>
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={newOHT.sebenarKosJumlah || ""}
                        onChange={(e) => setNewOHT({ ...newOHT, sebenarKosJumlah: parseFloat(e.target.value) || 0 })}
                        onKeyDown={(e) => handleInputEnterKey(e, addOHT)}
                        className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-emerald-500 rounded-lg px-2.5 py-1.5 font-mono outline-hidden text-xs text-right tabular-nums"
                      />
                    </div>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <button
                      type="button"
                      onClick={addOHT}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white p-1.5 rounded-lg shadow-sm transition-all cursor-pointer inline-flex items-center active:scale-95"
                      title={lang === "en" ? "Add Fixed Overhead" : "Tambah Overhead Tetap Sebenar"}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Stacked Card View for Kos Tetap Sebenar (< 640px) */}
        <div className="block sm:hidden p-3.5 space-y-3.5">
          {overheadTetap.map((item, index) => {
            const ohtDiff = item.sebenarKosJumlah - item.stdKosMingguan;
            const ohtPercentDiff = item.stdKosMingguan > 0 ? (ohtDiff / item.stdKosMingguan) * 100 : 0;

            return (
              <div key={item.id} className="p-3.5 bg-slate-50/70 dark:bg-[#101c30] rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={item.nama}
                      disabled={isReadOnly}
                      onChange={(e) => updateOHT(index, "nama", e.target.value)}
                      className="w-full font-semibold text-slate-900 dark:text-slate-100 bg-transparent border-b border-transparent focus:border-emerald-500 text-[16px] py-1 outline-hidden"
                      placeholder="Nama Kos Tetap"
                    />
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                      Std Mingguan: {f(item.stdKosMingguan)}
                    </div>
                  </div>
                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={() => deleteOHT(item.id)}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-rose-600 active:scale-95 transition-all cursor-pointer rounded-xl bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 shadow-2xs"
                      title={t.common.delete}
                    >
                      <Trash2 className="w-4 h-4 text-rose-500" />
                    </button>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-mono font-bold text-slate-500 uppercase text-left">
                      Kos Sebenar Minggu Ini ({config.currency})
                    </label>
                    {ohtDiff > 0.01 ? (
                      <span className="text-rose-600 font-bold text-[9px] font-mono">+{ohtPercentDiff.toFixed(0)}% ⚠️</span>
                    ) : ohtDiff < -0.01 ? (
                      <span className="text-emerald-600 font-bold text-[9px] font-mono">-{Math.abs(ohtPercentDiff).toFixed(0)}% ✨</span>
                    ) : null}
                  </div>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    disabled={isReadOnly}
                    value={item.sebenarKosJumlah || ""}
                    onChange={(e) => updateOHT(index, "sebenarKosJumlah", parseFloat(e.target.value) || 0)}
                    className="w-full bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono font-semibold text-[16px] text-slate-800 dark:text-slate-100 tabular-nums outline-hidden focus:border-emerald-500"
                  />
                </div>
              </div>
            );
          })}

          {!isReadOnly && (
            <div className="p-4 bg-white dark:bg-[#132238] rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 space-y-3">
              <span className="text-[11px] font-mono font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block text-left">
                + {lang === "en" ? "Record Actual Fixed Overhead" : "Tambah Overhead Tetap Sebenar"}
              </span>

              <div>
                <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">Nama Kos Tetap</label>
                <input
                  type="text"
                  placeholder={lang === "en" ? "e.g. Stall Rental / License" : "Contoh: Sewa Tapak / Lesen"}
                  value={newOHT.nama}
                  onChange={(e) => setNewOHT({ ...newOHT, nama: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-[#101c30] border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-[16px] text-slate-900 dark:text-slate-100 outline-hidden focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">Kos Sebenar ({config.currency})</label>
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={newOHT.sebenarKosJumlah || ""}
                  onChange={(e) => setNewOHT({ ...newOHT, sebenarKosJumlah: parseFloat(e.target.value) || 0 })}
                  className="w-full bg-slate-50 dark:bg-[#101c30] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono text-[16px] text-slate-900 dark:text-slate-100 tabular-nums outline-hidden"
                />
              </div>

              <button
                type="button"
                onClick={addOHT}
                className="w-full min-h-[44px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer active:scale-[0.98] text-sm"
              >
                <Plus className="w-4 h-4" />
                <span>{lang === "en" ? "Add Fixed Overhead" : "Tambah Overhead Tetap"}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* SECTION 5: RUMUSAN PRESTASI KOS SEBENAR (ACTUAL COST REVIEW CARD) */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs p-5 sm:p-7 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center border border-emerald-100 shrink-0">
              <Info className="w-4 h-4" />
            </div>
            <div>
              <h4 className="font-display font-bold text-slate-900 text-sm sm:text-base">
                {lang === "en" ? "Actual Expenditure & Profit Realization Summary" : "Rumusan Realisasi Kos & Keuntungan Sebenar"}
              </h4>
              <p className="text-xs text-slate-500">
                {lang === "en"
                  ? `Weekly performance review for ${config.namaProduk} (${fNum(Q_act)} ${unitLabel} sold)`
                  : `Semakan prestasi mingguan bagi ${config.namaProduk} (${fNum(Q_act)} ${unitLabel} dijual)`}
              </p>
            </div>
          </div>
          <span className={`text-xs font-mono font-bold px-3 py-1 rounded-full border self-start sm:self-auto ${
            isCostFavorable ? "text-emerald-800 bg-emerald-50 border-emerald-200/80" : "text-rose-800 bg-rose-50 border-rose-200/80"
          }`}>
            {isCostFavorable 
              ? (lang === "en" ? "Variance: Favorable (Saved)" : "Perbezaan Kos: Menguntungkan") 
              : (lang === "en" ? "Variance: Unfavorable (Over Budget)" : "Perbezaan Kos: Tidak Menguntungkan")}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/60 space-y-1">
            <span className="text-slate-500 text-[10px] font-bold uppercase block">{lang === "en" ? "Actual Variable Cost per Unit" : "Kos Berubah Sebenar Seunit"}</span>
            <div className="text-slate-800 text-xs font-semibold">
              {f(totalVariableActual)} ÷ {fNum(Q_act)} = <strong className="text-emerald-700">{f(actualVariableCostPerBowl)}</strong>
            </div>
            <span className="text-slate-400 text-[10px] block font-sans">
              {lang === "en" ? `Standard baseline: ${f(stdVarCostPerUnit)}/unit` : `Standard bajet: ${f(stdVarCostPerUnit)}/unit`}
            </span>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/60 space-y-1">
            <span className="text-slate-500 text-[10px] font-bold uppercase block">{lang === "en" ? "Actual Fixed Overhead Incurred" : "Kos Tetap Sebenar Ditanggung"}</span>
            <div className="text-slate-800 text-xs font-semibold">
              <strong className="text-slate-900">{f(totalOHTActual)}</strong> ({lang === "en" ? "weekly total" : "jumlah mingguan"})
            </div>
            <span className="text-slate-400 text-[10px] block font-sans">
              {lang === "en" ? `Burdens ${f(Q_act > 0 ? totalOHTActual / Q_act : 0)}/unit sold` : `Beban ${f(Q_act > 0 ? totalOHTActual / Q_act : 0)}/unit jualan`}
            </span>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/60 space-y-1">
            <span className="text-slate-500 text-[10px] font-bold uppercase block">{lang === "en" ? "Actual Realized Net Profit" : "Untung Bersih Sebenar Mingguan"}</span>
            <div className={`text-xs font-semibold ${actualNetProfit >= 0 ? 'text-amber-700' : 'text-rose-700'}`}>
              <strong>{f(actualNetProfit)}</strong> ({actualMarginPercent.toFixed(1)}% margin)
            </div>
            <span className="text-slate-400 text-[10px] block font-sans">
              {lang === "en" ? "Revenue - Variable - Fixed Costs" : "Hasil - Kos Berubah - Kos Tetap"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
