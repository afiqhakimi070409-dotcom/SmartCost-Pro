/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { BahanMentah, BuruhLangsung, OverheadBerubah, OverheadTetap, KonfigurasiSistem, UserRole, ROLE_DEFINITIONS } from "../types";
import { 
  Plus, 
  Trash2, 
  ShieldAlert, 
  Check, 
  HelpCircle, 
  Utensils, 
  Coins, 
  Clock, 
  HardHat, 
  Building, 
  Sparkles, 
  Lock, 
  CheckCircle2, 
  Layers, 
  DollarSign, 
  TrendingUp, 
  Target, 
  Info,
  Scale,
  Copy,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  FileText,
  Sliders,
  X
} from "lucide-react";
import {
  Language,
  getTranslation,
  getStoredLanguage,
  formatLocalizedNumber,
  formatLocalizedDate,
  formatUnitLabel,
  getLocalizedRoleDef,
} from "../utils/i18n";
import { handleInputEnterKey } from "../utils/inputNavigation";
import { formatCurrencyRM, kiraRingkasanKosStandard, kiraRingkasanKosSebenar, calculateMaterialCost, calculateLaborCost } from "../utils/costCalculations";
import ScenarioSimulatorSheet from "./ScenarioSimulatorSheet";
import BatchQuotationSheet from "./BatchQuotationSheet";
import ModalPortal from "./ModalPortal";
import { EmptyState, FormFieldValidation } from "./UIStates";

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

interface StandardSheetProps {
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
  onApplySimulation?: (updatedConfig: Partial<KonfigurasiSistem>) => void;
}

export default function StandardSheet({
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
  onApplySimulation,
}: StandardSheetProps) {
  const lang: Language = systemLang || config.language || getStoredLanguage();
  const t = getTranslation(lang);
  const f = (val: number) => formatCurrencyRM(val, config.currency);
  const unitLabel = formatUnitLabel(config.unitProduk, lang);
  const presetsBahan = lang === "en" ? presetsBahanEn : presetsBahanMs;
  const presetsBuruh = lang === "en" ? presetsBuruhEn : presetsBuruhMs;
  const presetsOHB = lang === "en" ? presetsOHBEn : presetsOHBMs;
  const presetsOHT = lang === "en" ? presetsOHTEn : presetsOHTMs;
  const roleDef = getLocalizedRoleDef(userRole, ROLE_DEFINITIONS[userRole] || ROLE_DEFINITIONS.admin, lang);
  const isReadOnly = readOnly || !roleDef.canEditDailyData;
  const [approvedStatus, setApprovedStatus] = useState<boolean>(false);
  const [activeToolModal, setActiveToolModal] = useState<"none" | "quotation" | "simulator">("none");

  // Summary calculations for simulator and quotation modals
  const stdSummary = kiraRingkasanKosStandard(config, bahanMentah, buruhLangsung, overheadBerubah, overheadTetap);
  const actSummary = kiraRingkasanKosSebenar(config, bahanMentah, buruhLangsung, overheadBerubah, overheadTetap);

  // State to add new items easily
  const [newBahan, setNewBahan] = useState({ nama: "", unit: "kg", stdKuantitiPerUnit: 0, stdHargaPerUnit: 0 });
  const [newBuruh, setNewBuruh] = useState({ nama: "", stdJamPerUnit: 0, stdKadarPerJam: 0 });
  const [newOHB, setNewOHB] = useState({ nama: "", stdKosPerUnit: 0 });
  const [newOHT, setNewOHT] = useState({ nama: "", stdKosMingguan: 0 });

  // Handle updates directly on input change with non-negative validation
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
    const qty = Math.max(0, newBahan.stdKuantitiPerUnit || 0);
    const price = Math.max(0, newBahan.stdHargaPerUnit || 0);
    const newItem: BahanMentah = {
      id: "bm-" + Date.now(),
      nama: newBahan.nama,
      unit: newBahan.unit,
      stdKuantitiPerUnit: qty,
      stdHargaPerUnit: price,
      sebenarKuantitiJumlah: qty, // 1:1 parity with standard input, never multiply by 1,000
      sebenarHargaPerUnit: price,
    };
    onUpdateBahanMentah([...bahanMentah, newItem]);
    setNewBahan({ nama: "", unit: "kg", stdKuantitiPerUnit: 0, stdHargaPerUnit: 0 });
  };

  // Buruh Handlers
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
    const hours = Math.max(0, newBuruh.stdJamPerUnit || 0);
    const rate = Math.max(0, newBuruh.stdKadarPerJam || 0);
    const newItem: BuruhLangsung = {
      id: "bl-" + Date.now(),
      nama: newBuruh.nama,
      stdJamPerUnit: hours,
      stdKadarPerJam: rate,
      sebenarJamJumlah: hours, // 1:1 parity with standard input (e.g. 1 hour -> 1 hour)
      sebenarKadarPerJam: rate,
    };
    onUpdateBuruhLangsung([...buruhLangsung, newItem]);
    setNewBuruh({ nama: "", stdJamPerUnit: 0, stdKadarPerJam: 0 });
  };

  // Variable Overhead Handlers
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
    const cost = Math.max(0, newOHB.stdKosPerUnit || 0);
    const newItem: OverheadBerubah = {
      id: "ob-" + Date.now(),
      nama: newOHB.nama,
      stdKosPerUnit: cost,
      sebenarKosJumlah: cost, // 1:1 parity with standard input (e.g. RM1.00 -> RM1.00)
    };
    onUpdateOverheadBerubah([...overheadBerubah, newItem]);
    setNewOHB({ nama: "", stdKosPerUnit: 0 });
  };

  // Fixed Overhead Handlers
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
    const newItem: OverheadTetap = {
      id: "ot-" + Date.now(),
      nama: newOHT.nama,
      stdKosMingguan: Math.max(0, newOHT.stdKosMingguan || 0),
      sebenarKosJumlah: Math.max(0, newOHT.stdKosMingguan || 0),
    };
    onUpdateOverheadTetap([...overheadTetap, newItem]);
    setNewOHT({ nama: "", stdKosMingguan: 0 });
  };

  // Batch & Production settings
  const batchQty = Math.max(1, config.kuantitiPengeluaranPiawai || 1);
  const batchUnit = formatUnitLabel(config.unitPengeluaran || config.unitProduk, lang);
  const salesUnit = config.unitJualan || `1 ${batchUnit}`;

  // Totals calculations for the batch
  const totalBahan = bahanMentah.reduce((sum, item) => sum + calculateMaterialCost(item.stdKuantitiPerUnit, item.unit, item.stdHargaPerUnit, item.hargaUnit), 0);
  const totalBuruh = buruhLangsung.reduce((sum, item) => sum + calculateLaborCost(item.stdJamPerUnit, item.unitMasa || "jam", item.stdKadarPerJam), 0);
  const totalOHB = overheadBerubah.reduce((sum, item) => sum + item.stdKosPerUnit, 0);
  const totalOHT = overheadTetap.reduce((sum, item) => sum + item.stdKosMingguan, 0);

  const targetQty = config.sasaranKuantitiStandard > 0 ? config.sasaranKuantitiStandard : 1;
  const fixedOverheadPerBatch = targetQty > 0 ? (totalOHT / targetQty) * batchQty : (totalOHT > 0 ? totalOHT : 0);
  const jumlahKosPengeluaranKelompok = totalBahan + totalBuruh + totalOHB + fixedOverheadPerBatch;

  // Unit costs derived from batch
  const kosBahanSeunit = totalBahan / batchQty;
  const kosBuruhSeunit = totalBuruh / batchQty;
  const kosOHBSeunit = totalOHB / batchQty;
  const kosBerubahSeunit = kosBahanSeunit + kosBuruhSeunit + kosOHBSeunit;
  const kosTetapSeunit = totalOHT / targetQty;
  const kosPenuhSeunit = kosBerubahSeunit + kosTetapSeunit;
  const hargaJualan = config.hargaJualanStandard || 0;
  const marginCarumanSeunit = hargaJualan - kosBerubahSeunit;
  const marginPercent = hargaJualan > 0 ? (marginCarumanSeunit / hargaJualan) * 100 : 0;
  const untungBersihMingguan = (marginCarumanSeunit * targetQty) - totalOHT;

  // Interactive Batch Recipe & Portion Scaler
  const [batchYield, setBatchYield] = useState<number>(100);
  const [showBatchBOM, setShowBatchBOM] = useState<boolean>(true);
  const [copiedBatchSheet, setCopiedBatchSheet] = useState<boolean>(false);

  const validBatchYield = Math.max(1, batchYield || 1);
  const batchMatCost = totalBahan * validBatchYield;
  const batchLabCost = totalBuruh * validBatchYield;
  const batchOHBCost = totalOHB * validBatchYield;
  const batchTotalVarCost = batchMatCost + batchLabCost + batchOHBCost;
  const batchRetailRevenue = hargaJualan * validBatchYield;
  const batchGrossProfit = batchRetailRevenue - batchTotalVarCost;
  const batchProfitMargin = batchRetailRevenue > 0 ? (batchGrossProfit / batchRetailRevenue) * 100 : 0;
  const totalBatchLaborHours = buruhLangsung.reduce((sum, item) => sum + (item.stdJamPerUnit * validBatchYield), 0);

  const handleCopyKitchenPrepSheet = () => {
    const isEn = lang === "en";
    const companyTitle = config.namaSyarikat || t.app.defaultCompany;
    const formattedDate = formatLocalizedDate(new Date(), lang);
    const lines = [
      `========================================`,
      t.standardSheet.kitchenPrepHeader,
      `${companyTitle} - ${config.namaProduk}`,
      `${isEn ? "Batch Size" : "Saiz Kumpulan"}: ${formatLocalizedNumber(validBatchYield, lang)} ${unitLabel}`,
      `${t.standardSheet.kitchenPrepDate}: ${formattedDate}`,
      `========================================`,
      `${t.standardSheet.kitchenPrepIngredients}:`,
      ...bahanMentah.map((item, idx) => {
        const qty = item.stdKuantitiPerUnit * validBatchYield;
        const cost = calculateMaterialCost(qty, item.unit, item.stdHargaPerUnit, item.hargaUnit);
        return `${idx + 1}. ${item.nama}: ${qty.toFixed(qty < 1 ? 3 : 2)} ${item.unit} (${f(cost)})`;
      }),
      `----------------------------------------`,
      `${t.standardSheet.kitchenPrepTotalCost.toUpperCase()}: ${f(batchMatCost)}`,
      `${isEn ? "ESTIMATED LABOR TIME" : "ANGGARAN MASA BURUH"}: ${totalBatchLaborHours.toFixed(1)} ${t.common.hours} (${f(batchLabCost)})`,
      `${isEn ? "TOTAL VARIABLE COST" : "JUMLAH KOS BERUBAH"}: ${f(batchTotalVarCost)}`,
      `${isEn ? "BATCH SALES VALUE" : "NILAI JUALAN KELOMPOK"}: ${f(batchRetailRevenue)}`,
      `${isEn ? "ESTIMATED GROSS PROFIT" : "ANGGARAN UNTUNG KASAR"}: ${f(batchGrossProfit)} (${batchProfitMargin.toFixed(1)}%)`,
      `========================================`,
    ];
    navigator.clipboard.writeText(lines.join("\n"));
    setCopiedBatchSheet(true);
    setTimeout(() => setCopiedBatchSheet(false), 2500);
  };

  return (
    <div className="space-y-6 sm:space-y-8 animate-fadeIn">
      {/* RBAC Access Notice Banner */}
      {isReadOnly && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-900 text-xs">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>{lang === "en" ? `View-Only Mode (Role Access: ${roleDef.title})` : `Mod Lihat Sahaja (Akses Jawatan: ${roleDef.title})`}</strong> — {lang === "en" ? "Daily editing permissions are restricted by organization access rules." : "Hak akses edit data harian dikunci mengikut Matriks Hak Akses Organisasi."}
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
                ? (lang === "en" ? "Data Approved" : "Data Disahkan") 
                : (lang === "en" ? "Review & Verify Staff Data" : "Sahkan & Semak Data Staf")}
            </button>
          )}
        </div>
      )}

      {/* 1. MAKLUMAT PRODUK & RINGKASAN KOS KESELURUHAN (EXECUTIVE HEADER & COST DASHBOARD) */}
      <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200/80 shadow-xs space-y-6">
        
        {/* Tajuk & Tag Produk */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-100">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-mono font-bold tracking-wider text-[#0b3c7a] uppercase flex items-center gap-1.5 bg-blue-50 px-2.5 py-0.5 rounded-md border border-blue-100">
                <Target className="w-3.5 h-3.5 text-[#0b3c7a]" />
                {lang === "en" ? "Standard Costing Architecture" : "Sistem Pengiraan Kos Piawai"}
              </span>
              <span className="text-slate-300">·</span>
              <span className="text-xs font-bold text-slate-700">
                {config.namaSyarikat || t.app.defaultCompany}
              </span>
            </div>
            <h2 className="screen-title text-slate-900 tracking-tight flex items-center gap-2.5">
              <Coins className="w-7 h-7 text-[#0b3c7a] shrink-0" />
              <span>{t.standardSheet.title}</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 leading-relaxed max-w-3xl">
              {lang === "en"
                ? `Standard budgeted costs based on standard recipe and weekly production target (${formatLocalizedNumber(config.sasaranKuantitiStandard, lang)} ${unitLabel}) for ${config.namaProduk}.`
                : `Kos piawai yang dianggarkan berdasarkan resipi standard dan sasaran jualan/pengeluaran mingguan (${formatLocalizedNumber(config.sasaranKuantitiStandard, lang)} ${unitLabel}) untuk ${config.namaProduk}.`}
            </p>
          </div>

          {/* Kad Maklumat Produk Terpilih */}
          <div className="p-3.5 sm:p-4 bg-slate-50 rounded-2xl border border-slate-200/80 shrink-0 space-y-1.5">
            <span className="text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider block">
              {lang === "en" ? "ACTIVE PRODUCT SPECIFICATION" : "SPESIFIKASI PRODUK AKTIF"}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-base sm:text-lg font-display font-extrabold text-slate-900">
                {config.namaProduk}
              </span>
              <span className="px-2 py-0.5 bg-blue-100 text-[#0b3c7a] rounded-md text-[11px] font-bold font-mono">
                {unitLabel}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-600 font-mono pt-1 border-t border-slate-200/60">
              <span>{lang === "en" ? "Target:" : "Sasaran:"} <strong className="text-slate-900">{formatLocalizedNumber(config.sasaranKuantitiStandard, lang)}</strong> {unitLabel}</span>
              <span className="text-slate-300">|</span>
              <span>{lang === "en" ? "Price:" : "Harga:"} <strong className="text-emerald-700">{f(hargaJualan)}</strong></span>
            </div>

            {/* Quick Interactive Tools Triggers */}
            <div className="flex items-center gap-2 pt-1.5">
              <button
                type="button"
                id="btn-std-open-quotation"
                onClick={() => setActiveToolModal("quotation")}
                className="flex-1 px-2.5 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs"
                title={lang === "en" ? "Scale contract batches & generate client quotation" : "Skala kumpulan kontrak & jana sebut harga pelanggan"}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{lang === "en" ? "Bulk Quotation" : "Sebut Harga"}</span>
              </button>
              <button
                type="button"
                id="btn-std-open-simulator"
                onClick={() => setActiveToolModal("simulator")}
                className="flex-1 px-2.5 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs"
                title={lang === "en" ? "Managerial sensitivity & what-if simulation" : "Simulasi sensitiviti & analisa apa-jika"}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>{lang === "en" ? "Scenario Sim" : "Simulasi Senario"}</span>
              </button>
            </div>
          </div>
        </div>

        {/* 2. RINGKASAN PECAHAN KOS SEUNIT (COST WATERFALL SUMMARY) */}
        <div>
          <span className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider block mb-3">
            {lang === "en" ? "UNIT COST FORMULATION & CONTRIBUTION MARGIN" : "PECAHAN KOS SEUNIT & MARGIN SUMBANGAN"}
          </span>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            
            {/* 1. Bahan Mentah Seunit */}
            <div className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200/70 space-y-1 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-500 font-mono">
                <span className="font-semibold">{lang === "en" ? "1. Raw Materials" : "1. Bahan Mentah"}</span>
                <Utensils className="w-3.5 h-3.5 text-blue-600" />
              </div>
              <div className="my-1">
                <span className="text-xl sm:text-2xl font-display font-extrabold text-slate-900 font-mono tabular-nums">
                  {f(totalBahan)}
                </span>
                <span className="text-[11px] text-slate-500 font-sans block mt-0.5">/ {unitLabel}</span>
              </div>
              <div className="pt-2 border-t border-slate-200/60 text-[10px] text-slate-500 font-mono">
                {lang === "en" ? "Total batch:" : "Jumlah kumpulan:"} {f(totalBahan * targetQty)}
              </div>
            </div>

            {/* 2. Buruh Langsung Seunit */}
            <div className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200/70 space-y-1 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-500 font-mono">
                <span className="font-semibold">{lang === "en" ? "2. Direct Labor" : "2. Buruh Langsung"}</span>
                <HardHat className="w-3.5 h-3.5 text-amber-600" />
              </div>
              <div className="my-1">
                <span className="text-xl sm:text-2xl font-display font-extrabold text-slate-900 font-mono tabular-nums">
                  {f(totalBuruh)}
                </span>
                <span className="text-[11px] text-slate-500 font-sans block mt-0.5">/ {unitLabel}</span>
              </div>
              <div className="pt-2 border-t border-slate-200/60 text-[10px] text-slate-500 font-mono">
                {lang === "en" ? "Total batch:" : "Jumlah kumpulan:"} {f(totalBuruh * targetQty)}
              </div>
            </div>

            {/* 3. Overhead Berubah Seunit */}
            <div className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200/70 space-y-1 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-500 font-mono">
                <span className="font-semibold">{lang === "en" ? "3. Variable OH" : "3. Overhead Berubah"}</span>
                <Clock className="w-3.5 h-3.5 text-sky-600" />
              </div>
              <div className="my-1">
                <span className="text-xl sm:text-2xl font-display font-extrabold text-slate-900 font-mono tabular-nums">
                  {f(totalOHB)}
                </span>
                <span className="text-[11px] text-slate-500 font-sans block mt-0.5">/ {unitLabel}</span>
              </div>
              <div className="pt-2 border-t border-slate-200/60 text-[10px] text-slate-500 font-mono">
                {lang === "en" ? "Total batch:" : "Jumlah kumpulan:"} {f(totalOHB * targetQty)}
              </div>
            </div>

            {/* 4. Jumlah Kos Berubah Seunit */}
            <div className="p-4 rounded-2xl bg-blue-50/60 border border-blue-200/80 space-y-1 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-[#0b3c7a] font-mono">
                <span className="font-bold">{lang === "en" ? "Total Variable Cost" : "Jumlah Kos Berubah"}</span>
                <Layers className="w-3.5 h-3.5 text-[#0b3c7a]" />
              </div>
              <div className="my-1">
                <span className="text-xl sm:text-2xl font-display font-extrabold text-[#0b3c7a] font-mono tabular-nums">
                  {f(kosBerubahSeunit)}
                </span>
                <span className="text-[11px] text-blue-700/80 font-sans block mt-0.5 font-medium">/ {unitLabel}</span>
              </div>
              <div className="pt-2 border-t border-blue-200/60 text-[10px] text-[#0b3c7a] font-mono font-bold">
                {lang === "en" ? "Sum:" : "Hasil:"} 1 + 2 + 3
              </div>
            </div>

          </div>
        </div>

        {/* 3. JALUR PRESTASI KEWANGAN & KEUNTUNGAN (FINANCIAL PERFORMANCE & PROFIT STRIP) */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 rounded-2xl text-white grid grid-cols-2 lg:grid-cols-4 gap-4 shadow-sm">
          <div>
            <span className="text-[10px] font-mono text-sky-300 block uppercase font-bold tracking-wider">
              {lang === "en" ? "Selling Price" : "Harga Jualan"}
            </span>
            <span className="text-lg sm:text-xl font-display font-bold font-mono text-white tabular-nums">
              {f(hargaJualan)}
            </span>
            <span className="text-[10px] text-slate-300 block">/ {unitLabel}</span>
          </div>

          <div className="border-l border-white/15 pl-4">
            <span className="text-[10px] font-mono text-emerald-300 block uppercase font-bold tracking-wider">
              {lang === "en" ? "Contribution Margin" : "Margin Sumbangan"}
            </span>
            <span className="text-lg sm:text-xl font-display font-bold font-mono text-emerald-300 tabular-nums">
              {f(marginCarumanSeunit)}
            </span>
            <span className="text-[10px] text-emerald-200/80 block font-mono font-bold">
              {marginPercent.toFixed(1)}% {lang === "en" ? "margin" : "margin"}
            </span>
          </div>

          <div className="border-l border-white/15 pl-4">
            <span className="text-[10px] font-mono text-blue-200 block uppercase font-bold tracking-wider">
              {lang === "en" ? "Weekly Fixed Overhead" : "Kos Tetap Mingguan"}
            </span>
            <span className="text-lg sm:text-xl font-display font-bold font-mono text-white tabular-nums">
              {f(totalOHT)}
            </span>
            <span className="text-[10px] text-slate-300 block font-mono">
              {lang === "en" ? "Unit burden:" : "Beban seunit:"} {f(kosTetapSeunit)}
            </span>
          </div>

          <div className="border-l border-white/15 pl-4">
            <span className="text-[10px] font-mono text-amber-300 block uppercase font-bold tracking-wider">
              {lang === "en" ? "Est. Weekly Net Profit" : "Anggaran Untung Bersih"}
            </span>
            <span className={`text-lg sm:text-xl font-display font-bold font-mono tabular-nums ${untungBersihMingguan >= 0 ? 'text-amber-300' : 'text-rose-300'}`}>
              {f(untungBersihMingguan)}
            </span>
            <span className="text-[10px] text-slate-300 block">
              {lang === "en" ? "at target volume" : "pada sasaran volum"}
            </span>
          </div>
        </div>

      </div>

      {/* INTERACTIVE BATCH RECIPE & PORTION SCALER */}
      <div className="bg-white rounded-3xl p-5 sm:p-7 border border-blue-200/80 shadow-xs space-y-5 relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-blue-100 text-[#0b3c7a] border border-blue-200 flex items-center gap-1.5">
                <Scale className="w-3 h-3 text-[#0b3c7a]" />
                {lang === "en" ? "Production Portion Scaler" : "Kalkulator Skala Kumpulan & Resipi"}
              </span>
              <span className="text-xs text-slate-400 font-mono">
                {config.namaProduk}
              </span>
            </div>
            <h3 className="text-lg sm:text-xl font-display font-bold text-slate-900 mt-1">
              {lang === "en" ? "Batch Production & Kitchen Prep Scaler" : "Pengiraan Saiz Kumpulan & Sukatan Bahan Dapur"}
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed max-w-2xl">
              {lang === "en"
                ? "Simulate exact raw ingredient weights, preparation labor hours, and total costs for bulk batches or custom catering orders."
                : "Skalakan kuantiti resipi, berat bahan mentah, waktu buruh penyediaan, dan kos pengeluaran mengikut saiz kumpulan pengeluaran sebenar."}
            </p>
          </div>

          {/* Quick preset selector & Custom Input */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-mono text-slate-500 font-bold uppercase">
              {lang === "en" ? "Batch Yield:" : "Saiz Batch:"}
            </span>
            {[50, 100, 250, 500, 1000].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setBatchYield(preset)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer border ${
                  batchYield === preset
                    ? "bg-[#0b3c7a] text-white border-[#0b3c7a] shadow-xs"
                    : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                }`}
              >
                {preset}
              </button>
            ))}

            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
              <input
                type="number"
                min="1"
                value={batchYield}
                onChange={(e) => setBatchYield(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-16 font-mono font-bold text-xs bg-transparent text-slate-900 outline-hidden tabular-nums"
              />
              <span className="text-[11px] text-slate-500 font-mono">{unitLabel}</span>
            </div>
          </div>
        </div>

        {/* Batch Financial Waterfall Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-200/70 space-y-1">
            <span className="text-[10px] font-mono font-bold text-slate-500 uppercase block">
              {lang === "en" ? `1. Batch Raw Ingredients (${validBatchYield} ${unitLabel})` : `1. Kos Bahan Kumpulan (${validBatchYield} ${unitLabel})`}
            </span>
            <span className="text-xl sm:text-2xl font-display font-extrabold text-slate-900 font-mono tabular-nums block">
              {f(batchMatCost)}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {bahanMentah.length} {lang === "en" ? "ingredients required" : "bahan mentah"}
            </span>
          </div>

          <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-200/70 space-y-1">
            <span className="text-[10px] font-mono font-bold text-slate-500 uppercase block">
              {lang === "en" ? "2. Batch Labor & Time" : "2. Masa & Kos Buruh"}
            </span>
            <span className="text-xl sm:text-2xl font-display font-extrabold text-slate-900 font-mono tabular-nums block">
              {f(batchLabCost)}
            </span>
            <span className="text-[10px] text-amber-700 font-mono font-bold">
              ~{totalBatchLaborHours.toFixed(1)} {lang === "en" ? "labor hours" : "jam masa kerja"}
            </span>
          </div>

          <div className="p-4 bg-blue-50/60 rounded-2xl border border-blue-200/80 space-y-1">
            <span className="text-[10px] font-mono font-bold text-[#0b3c7a] uppercase block">
              {lang === "en" ? "3. Total Batch Variable Cost" : "3. Jumlah Kos Berubah"}
            </span>
            <span className="text-xl sm:text-2xl font-display font-extrabold text-[#0b3c7a] font-mono tabular-nums block">
              {f(batchTotalVarCost)}
            </span>
            <span className="text-[10px] text-blue-700 font-mono">
              {f(kosBerubahSeunit)} / {unitLabel}
            </span>
          </div>

          <div className="p-4 bg-emerald-50/60 rounded-2xl border border-emerald-200/80 space-y-1">
            <span className="text-[10px] font-mono font-bold text-emerald-800 uppercase block">
              {lang === "en" ? "4. Gross Profit at Standard Price" : "4. Anggaran Untung Kasar"}
            </span>
            <span className="text-xl sm:text-2xl font-display font-extrabold text-emerald-700 font-mono tabular-nums block">
              {f(batchGrossProfit)}
            </span>
            <span className="text-[10px] text-emerald-800 font-mono font-bold">
              {batchProfitMargin.toFixed(1)}% {lang === "en" ? "margin" : "margin"} · {f(batchRetailRevenue)}
            </span>
          </div>
        </div>

        {/* Collapsible BOM Table & Kitchen Prep Sheet */}
        <div className="pt-2">
          <div className="flex items-center justify-between pb-2">
            <button
              type="button"
              onClick={() => setShowBatchBOM(!showBatchBOM)}
              className="text-xs font-bold text-[#0b3c7a] hover:text-blue-900 flex items-center gap-1.5 cursor-pointer font-mono"
            >
              {showBatchBOM ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              <span>{showBatchBOM ? (lang === "en" ? "Hide Scaled Recipe Table" : "Sembunyikan Jadual Sukatan") : (lang === "en" ? "Show Scaled Recipe Table" : "Papar Jadual Sukatan Resipi")}</span>
            </button>

            <button
              type="button"
              onClick={handleCopyKitchenPrepSheet}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
            >
              {copiedBatchSheet ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-sky-400" />}
              <span>{copiedBatchSheet ? (lang === "en" ? "Copied to Clipboard!" : "Disalin ke Papanklip!") : (lang === "en" ? "Copy Kitchen Prep Sheet" : "Salin Senarai Prep Dapur")}</span>
            </button>
          </div>

          {showBatchBOM && (
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 overflow-hidden">
              {/* Desktop View */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-500 font-mono uppercase text-[10px] tracking-wider">
                      <th className="p-3 font-bold">{lang === "en" ? "Ingredient" : "Bahan Mentah"}</th>
                      <th className="p-3 font-bold">{lang === "en" ? "Single Unit Portion" : "Sukatan Seunit"}</th>
                      <th className="p-3 font-bold text-blue-900 bg-blue-50/80">{lang === "en" ? `Required for Batch (${validBatchYield} ${unitLabel})` : `Jumlah Diperlukan (${validBatchYield} ${unitLabel})`}</th>
                      <th className="p-3 font-bold text-right">{lang === "en" ? "Price / Unit" : "Harga / Unit"}</th>
                      <th className="p-3 font-bold text-right">{lang === "en" ? "Total Batch Cost" : "Jumlah Kos Kumpulan"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/60 font-mono">
                    {bahanMentah.map((item) => {
                      const reqQty = item.stdKuantitiPerUnit * validBatchYield;
                      const itemCost = reqQty * item.stdHargaPerUnit;
                      return (
                        <tr key={item.id} className="hover:bg-white transition-colors">
                          <td className="p-3 font-sans font-bold text-slate-800">{item.nama}</td>
                          <td className="p-3 text-slate-600 tabular-nums">
                            {item.stdKuantitiPerUnit} {item.unit}
                          </td>
                          <td className="p-3 font-bold text-[#0b3c7a] bg-blue-50/30 tabular-nums">
                            {reqQty.toFixed(reqQty < 1 ? 3 : 2)} <span className="font-normal text-slate-600">{item.unit}</span>
                          </td>
                          <td className="p-3 text-slate-600 text-right tabular-nums">
                            {f(item.stdHargaPerUnit)} / {item.unit}
                          </td>
                          <td className="p-3 text-right font-bold text-slate-900 tabular-nums whitespace-nowrap">
                            {f(itemCost)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile View */}
              <div className="block sm:hidden p-3 space-y-2.5">
                {bahanMentah.map((item) => {
                  const reqQty = item.stdKuantitiPerUnit * validBatchYield;
                  const itemCost = reqQty * item.stdHargaPerUnit;
                  return (
                    <div key={item.id} className="p-3 bg-white dark:bg-[#132238] rounded-xl border border-slate-200/70 dark:border-slate-800 space-y-1.5 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800 dark:text-slate-100 text-xs">{item.nama}</span>
                        <span className="font-mono font-bold text-[#0b3c7a] dark:text-sky-300 text-xs tabular-nums">
                          {reqQty.toFixed(reqQty < 1 ? 3 : 2)} {item.unit}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-800">
                        <span>{t.standardSheet.portionsLabel} {item.stdKuantitiPerUnit} {item.unit}</span>
                        <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">{f(itemCost)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SECTION 1: BAHAN MENTAH LANGSUNG */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-display font-bold text-slate-800 flex items-center gap-2">
              <Utensils className="w-5 h-5 text-[#0b3c7a]" />
              <span>{lang === "en" ? "Direct Raw Materials" : "Bahan Mentah"}</span>
            </h3>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              {lang === "en"
                ? `Standard recipe quantities for batch of ${batchQty} ${batchUnit}`
                : `Sukatan resipi piawai bagi kelompok ${batchQty} ${batchUnit}`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-3 py-1 bg-blue-100 text-[#0b3c7a] rounded-lg font-mono font-bold text-xs border border-blue-200">
              {lang === "en" ? "Total Batch Cost:" : "Jumlah Kos Kelompok:"} {f(totalBahan)}
            </span>
            <span className="px-3 py-1 bg-slate-100 text-slate-700 rounded-lg font-mono font-semibold text-xs border border-slate-200">
              {lang === "en" ? "Cost Per Unit:" : "Kos Seunit:"} {f(totalBahan / batchQty)} / {batchUnit}
            </span>
          </div>
        </div>
        
        {/* Desktop Table View (>= 640px) */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[760px]">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-mono text-slate-500 uppercase bg-slate-100/70">
                <th className="py-3 px-5 font-bold min-w-[260px]">{lang === "en" ? "Material Name" : "Nama bahan"}</th>
                <th className="py-3 px-4 font-bold w-24 text-center">{lang === "en" ? "Unit" : "Unit"}</th>
                <th className="py-3 px-4 font-bold w-36 text-right">{lang === "en" ? "Standard Quantity" : "Kuantiti piawai"}</th>
                <th className="py-3 px-4 font-bold w-36 text-right">{lang === "en" ? "Price Per Unit" : "Harga seunit"}</th>
                <th className="py-3 px-4 font-bold w-36 text-right">{lang === "en" ? "Material Cost" : "Jumlah kos bahan"}</th>
                <th className="py-3 px-5 text-center w-20">{lang === "en" ? "Actions" : "Tindakan"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bahanMentah.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-4">
                    <EmptyState
                      title={lang === "en" ? "No Direct Materials Recorded" : "Senarai Bahan Mentah Kosong"}
                      description={
                        lang === "en"
                          ? "This product has no recipe ingredients yet. Add your first item below or load presets to calculate standard costs."
                          : "Resipi produk ini belum mempunyai ramuan. Masukkan item pertama anda pada baris di bawah atau pilih daripada templat pantas."
                      }
                      actionLabel={lang === "en" ? "Load Preset Recipe" : "Muat Resipi Contoh"}
                      onAction={() => {
                        const samples: BahanMentah[] = presetsBahan.map((p, idx) => ({
                          id: `preset-bm-${idx}-${Date.now()}`,
                          nama: p.nama,
                          unit: p.unit,
                          stdKuantitiPerUnit: p.stdKuantitiPerUnit,
                          stdHargaPerUnit: p.stdHargaPerUnit,
                          hargaUnit: p.unit,
                          kuantitiSebenar: p.stdKuantitiPerUnit * config.sasaranKuantitiStandard,
                          kosSebenar: p.stdHargaPerUnit * p.stdKuantitiPerUnit * config.sasaranKuantitiStandard,
                          sebenarKuantitiJumlah: p.stdKuantitiPerUnit * config.sasaranKuantitiStandard,
                          sebenarHargaPerUnit: p.stdHargaPerUnit
                        }));
                        onUpdateBahanMentah(samples);
                      }}
                    />
                  </td>
                </tr>
              )}
              {bahanMentah.map((item, index) => (
                <tr key={item.id} className="text-sm hover:bg-slate-50/40 transition-colors">
                  <td className="py-3.5 px-5">
                    <input
                      type="text"
                      value={item.nama}
                      onChange={(e) => updateBahan(index, "nama", e.target.value)}
                      onKeyDown={(e) => handleInputEnterKey(e)}
                      className="w-full min-w-[240px] bg-transparent border-b border-transparent focus:border-blue-500 font-medium text-slate-800 outline-hidden focus:px-1 py-0.5 text-sm"
                    />
                  </td>
                  <td className="py-3.5 px-4">
                    <input
                      type="text"
                      value={item.unit}
                      onChange={(e) => updateBahan(index, "unit", e.target.value)}
                      onKeyDown={(e) => handleInputEnterKey(e)}
                      className="w-full bg-transparent border-b border-transparent focus:border-blue-500 font-mono text-slate-600 outline-hidden focus:px-1 py-0.5 text-sm"
                    />
                  </td>
                  <td className="py-3.5 px-4 font-mono text-right">
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={item.stdKuantitiPerUnit}
                      onChange={(e) => updateBahan(index, "stdKuantitiPerUnit", parseFloat(e.target.value) || 0)}
                      onKeyDown={(e) => handleInputEnterKey(e)}
                      className="w-full bg-transparent border-b border-transparent focus:border-blue-500 outline-hidden font-semibold text-slate-700 focus:px-1 py-0.5 text-right tabular-nums text-sm"
                    />
                  </td>
                  <td className="py-3.5 px-4 font-mono text-right">
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-slate-400 text-xs">{config.currency}</span>
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        value={item.stdHargaPerUnit}
                        onChange={(e) => updateBahan(index, "stdHargaPerUnit", parseFloat(e.target.value) || 0)}
                        onKeyDown={(e) => handleInputEnterKey(e)}
                        className="w-full bg-transparent border-b border-transparent focus:border-blue-500 outline-hidden font-semibold text-slate-700 focus:px-1 py-0.5 text-right tabular-nums text-sm"
                      />
                    </div>
                  </td>
                  <td className="py-3.5 px-4 font-mono font-bold text-slate-800 bg-slate-50/10 text-right tabular-nums whitespace-nowrap">
                    {f(calculateMaterialCost(item.stdKuantitiPerUnit, item.unit, item.stdHargaPerUnit, item.hargaUnit))}
                  </td>
                  <td className="py-3.5 px-5 text-center">
                    <button
                      onClick={() => deleteBahan(item.id)}
                      className="text-slate-400 hover:text-rose-600 p-2 rounded-md transition-colors cursor-pointer inline-flex items-center justify-center min-h-[36px] min-w-[36px]"
                      title={t.common.delete}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}

              {/* Add New Row (Desktop) */}
              <tr className="bg-slate-50/20 text-sm">
                <td className="py-3 px-5">
                  <input
                    type="text"
                    placeholder={lang === "en" ? "e.g. Organic Flour or Spices" : "Contoh: Sayur Kangkung Segar"}
                    value={newBahan.nama}
                    onChange={(e) => setNewBahan({ ...newBahan, nama: e.target.value })}
                    onKeyDown={(e) => handleInputEnterKey(e)}
                    className="w-full min-w-[260px] bg-white border border-slate-200 focus:border-blue-500 rounded-lg px-3 py-2 font-medium outline-hidden text-sm"
                  />
                  {/* Preset Quick Tray */}
                  <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                    <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">{t.common.quickTemplates}:</span>
                    {presetsBahan.map((p) => (
                      <button
                        key={p.nama}
                        type="button"
                        onClick={() => setNewBahan({
                          nama: p.nama,
                          unit: p.unit,
                          stdKuantitiPerUnit: p.stdKuantitiPerUnit,
                          stdHargaPerUnit: p.stdHargaPerUnit
                        })}
                        className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 hover:text-[#0b3c7a] text-slate-600 text-[10px] rounded-md transition-all font-sans cursor-pointer whitespace-nowrap"
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
                    className="w-full bg-white border border-slate-200 focus:border-blue-500 rounded-lg px-2.5 py-1.5 font-mono outline-hidden text-sm"
                  />
                </td>
                <td className="py-3 px-4 text-right">
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    placeholder="0.05"
                    value={newBahan.stdKuantitiPerUnit || ""}
                    onChange={(e) => setNewBahan({ ...newBahan, stdKuantitiPerUnit: parseFloat(e.target.value) || 0 })}
                    onKeyDown={(e) => handleInputEnterKey(e)}
                    className={`w-full bg-white border rounded-lg px-2.5 py-1.5 font-mono outline-hidden text-right tabular-nums text-sm ${
                      newBahan.nama && newBahan.stdKuantitiPerUnit <= 0 ? "border-rose-400 ring-1 ring-rose-300" : "border-slate-200 focus:border-blue-500"
                    }`}
                  />
                  {newBahan.nama && newBahan.stdKuantitiPerUnit <= 0 && (
                    <FormFieldValidation error={lang === "en" ? "Qty must be > 0" : "Kuantiti mestilah > 0"} />
                  )}
                </td>
                <td className="py-3 px-4 text-right">
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    placeholder="4.50"
                    value={newBahan.stdHargaPerUnit || ""}
                    onChange={(e) => setNewBahan({ ...newBahan, stdHargaPerUnit: parseFloat(e.target.value) || 0 })}
                    onKeyDown={(e) => handleInputEnterKey(e, addBahan)}
                    className={`w-full bg-white border rounded-lg px-2.5 py-1.5 font-mono outline-hidden text-right tabular-nums text-sm ${
                      newBahan.nama && newBahan.stdHargaPerUnit <= 0 ? "border-rose-400 ring-1 ring-rose-300" : "border-slate-200 focus:border-blue-500"
                    }`}
                  />
                  {newBahan.nama && newBahan.stdHargaPerUnit <= 0 && (
                    <FormFieldValidation error={lang === "en" ? "Cost must be > 0" : "Harga mestilah > 0"} />
                  )}
                </td>
                <td className="py-3 px-4 font-mono font-bold text-slate-400 bg-slate-50/10 text-right tabular-nums whitespace-nowrap">
                  {f(calculateMaterialCost(newBahan.stdKuantitiPerUnit, newBahan.unit, newBahan.stdHargaPerUnit))}
                </td>
                <td className="py-3 px-5 text-center">
                  <button
                    onClick={addBahan}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white p-2 rounded-lg shadow-sm transition-all cursor-pointer inline-flex items-center justify-center min-h-[36px] min-w-[36px]"
                    title={lang === "en" ? "Add Material" : "Tambah Bahan"}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Mobile Stacked Card View (< 640px) */}
        <div className="block sm:hidden p-3.5 space-y-3.5">
          {bahanMentah.length === 0 && (
            <div className="p-2">
              <EmptyState
                title={lang === "en" ? "No Direct Materials Recorded" : "Senarai Bahan Mentah Kosong"}
                description={
                  lang === "en"
                    ? "Add your first item below or load presets to calculate standard costs."
                    : "Masukkan ramuan pertama anda pada borang di bawah atau pilih daripada templat pantas."
                }
                actionLabel={lang === "en" ? "Load Preset Recipe" : "Muat Resipi Contoh"}
                onAction={() => {
                  const samples: BahanMentah[] = presetsBahan.map((p, idx) => ({
                    id: `preset-bm-${idx}-${Date.now()}`,
                    nama: p.nama,
                    unit: p.unit,
                    stdKuantitiPerUnit: p.stdKuantitiPerUnit,
                    stdHargaPerUnit: p.stdHargaPerUnit,
                    hargaUnit: p.unit,
                    kuantitiSebenar: p.stdKuantitiPerUnit * config.sasaranKuantitiStandard,
                    kosSebenar: p.stdHargaPerUnit * p.stdKuantitiPerUnit * config.sasaranKuantitiStandard,
                    sebenarKuantitiJumlah: p.stdKuantitiPerUnit * config.sasaranKuantitiStandard,
                    sebenarHargaPerUnit: p.stdHargaPerUnit
                  }));
                  onUpdateBahanMentah(samples);
                }}
              />
            </div>
          )}

          {bahanMentah.map((item, index) => (
            <div key={item.id} className="p-3.5 bg-slate-50/70 dark:bg-[#101c30] rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3 shadow-2xs">
              <div className="flex items-center justify-between gap-2">
                <input
                  type="text"
                  value={item.nama}
                  onChange={(e) => updateBahan(index, "nama", e.target.value)}
                  className="flex-1 font-semibold text-slate-900 dark:text-slate-100 bg-transparent border-b border-transparent focus:border-blue-500 text-[16px] py-1 outline-hidden"
                  placeholder={t.standardSheet.matName}
                />
                <button
                  type="button"
                  onClick={() => deleteBahan(item.id)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-rose-600 active:scale-95 transition-all cursor-pointer rounded-xl bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 shadow-2xs"
                  title={t.common.delete}
                >
                  <Trash2 className="w-4 h-4 text-rose-500" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="text-[10px] font-mono font-bold text-slate-500 uppercase block mb-1 text-left">{t.common.unit}</label>
                  <input
                    type="text"
                    value={item.unit}
                    onChange={(e) => updateBahan(index, "unit", e.target.value)}
                    className="w-full bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono text-[16px] text-slate-800 dark:text-slate-100 outline-hidden focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono font-bold text-slate-500 uppercase block mb-1 text-left">{t.common.quantity}</label>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={item.stdKuantitiPerUnit}
                    onChange={(e) => updateBahan(index, "stdKuantitiPerUnit", parseFloat(e.target.value) || 0)}
                    className="w-full bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono font-semibold text-[16px] text-slate-800 dark:text-slate-100 tabular-nums outline-hidden focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono font-bold text-slate-500 uppercase block mb-1 text-left">{t.common.price} ({config.currency})</label>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={item.stdHargaPerUnit}
                    onChange={(e) => updateBahan(index, "stdHargaPerUnit", parseFloat(e.target.value) || 0)}
                    className="w-full bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono font-semibold text-[16px] text-slate-800 dark:text-slate-100 tabular-nums outline-hidden focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2.5 border-t border-slate-200/60 dark:border-slate-800">
                <span className="text-xs text-slate-500 font-medium">{t.standardSheet.unitCostLabel}</span>
                <span className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums text-sm whitespace-nowrap">
                  {f(calculateMaterialCost(item.stdKuantitiPerUnit, item.unit, item.stdHargaPerUnit, item.hargaUnit))}
                </span>
              </div>
            </div>
          ))}

          {/* Add Item Card (Mobile) */}
          <div className="p-4 bg-white dark:bg-[#132238] rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 space-y-3">
            <span className="text-[11px] font-mono font-bold text-[#0b3c7a] dark:text-sky-400 uppercase tracking-wider block text-left">
              + {lang === "en" ? "Add New Ingredient" : "Tambah Bahan Mentah Baru"}
            </span>

            <div>
              <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">{t.standardSheet.matName}</label>
              <input
                type="text"
                placeholder={lang === "en" ? "e.g. Flour / Chicken" : "Contoh: Kulit Popia / Ayam"}
                value={newBahan.nama}
                onChange={(e) => setNewBahan({ ...newBahan, nama: e.target.value })}
                className="w-full bg-slate-50 dark:bg-[#101c30] border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-[16px] text-slate-900 dark:text-slate-100 outline-hidden focus:border-blue-500"
              />
            </div>

            {/* Quick Templates Buttons with Touch Targets */}
            <div className="flex flex-wrap gap-1.5 items-center pt-0.5">
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">{t.common.quickTemplates}:</span>
              {presetsBahan.map((p) => (
                <button
                  key={p.nama}
                  type="button"
                  onClick={() => setNewBahan({
                    nama: p.nama,
                    unit: p.unit,
                    stdKuantitiPerUnit: p.stdKuantitiPerUnit,
                    stdHargaPerUnit: p.stdHargaPerUnit
                  })}
                  className="px-2.5 py-1.5 min-h-[36px] bg-slate-100 dark:bg-[#182a44] hover:bg-slate-200 text-slate-700 dark:text-slate-200 text-xs rounded-lg transition-all font-sans cursor-pointer whitespace-nowrap active:scale-95"
                >
                  {p.nama.split(" ")[0]}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">{t.common.unit}</label>
                <input
                  type="text"
                  placeholder="kg"
                  value={newBahan.unit}
                  onChange={(e) => setNewBahan({ ...newBahan, unit: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-[#101c30] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono text-[16px] text-slate-900 dark:text-slate-100 outline-hidden"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">{t.common.quantity}</label>
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  placeholder="0.05"
                  value={newBahan.stdKuantitiPerUnit || ""}
                  onChange={(e) => setNewBahan({ ...newBahan, stdKuantitiPerUnit: parseFloat(e.target.value) || 0 })}
                  className="w-full bg-slate-50 dark:bg-[#101c30] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono text-[16px] text-slate-900 dark:text-slate-100 tabular-nums outline-hidden"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">{t.common.price} ({config.currency || "RM"})</label>
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  placeholder="4.50"
                  value={newBahan.stdHargaPerUnit || ""}
                  onChange={(e) => setNewBahan({ ...newBahan, stdHargaPerUnit: parseFloat(e.target.value) || 0 })}
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
              <span>{lang === "en" ? "Add Ingredient" : "Tambah Bahan Mentah"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* SECTION 2 & 3: BURUH LANGSUNG & OVERHEAD BERUBAH */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        
        {/* BURUH LANGSUNG */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <h3 className="font-display font-bold text-slate-800 flex items-center gap-2">
              <HardHat className="w-5 h-5 text-[#0b3c7a]" />
              {t.standardSheet.laborTitle}
            </h3>
            <span className="px-2.5 py-0.5 bg-blue-100 text-blue-800 rounded-full font-mono font-bold text-xs">
              {t.common.total}: {f(totalBuruh)}
            </span>
          </div>
          
          {/* Desktop Table View (>= 640px) */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[520px]">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-mono text-slate-400 uppercase bg-slate-50/20">
                  <th className="py-3 px-4 font-semibold min-w-[200px]">{t.standardSheet.laborTask}</th>
                  <th className="py-3 px-3 font-semibold w-24 text-right">{t.standardSheet.laborHours}</th>
                  <th className="py-3 px-3 font-semibold w-28 text-right">{t.standardSheet.laborRate}</th>
                  <th className="py-3 px-3 font-semibold w-24 text-right">{t.common.total}</th>
                  <th className="py-3 px-4 text-center w-12">{t.common.delete}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {buruhLangsung.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-4">
                      <EmptyState
                        title={lang === "en" ? "No Direct Labor Recorded" : "Senarai Upah Pekerja Kosong"}
                        description={
                          lang === "en"
                            ? "Record preparation, cooking, or packaging labor hours below to calculate exact labor costs per unit."
                            : "Catatkan tugasan penyediaan, pembuatan, atau pembungkusan di bawah untuk menetapkan kadar operasi seunit."
                        }
                        actionLabel={lang === "en" ? "Load Preset Labor" : "Muat Upah Contoh"}
                        onAction={() => {
                          const samples: BuruhLangsung[] = presetsBuruh.map((p, idx) => ({
                            id: `preset-bl-${idx}-${Date.now()}`,
                            nama: p.nama,
                            stdJamPerUnit: p.stdJamPerUnit,
                            stdKadarPerJam: p.stdKadarPerJam,
                            kadarJam: p.stdKadarPerJam,
                            unitMasa: "jam" as const,
                            jamSebenar: p.stdJamPerUnit * config.sasaranKuantitiStandard,
                            kosSebenar: p.stdJamPerUnit * p.stdKadarPerJam * config.sasaranKuantitiStandard,
                            sebenarJamJumlah: p.stdJamPerUnit * config.sasaranKuantitiStandard,
                            sebenarKadarPerJam: p.stdKadarPerJam
                          }));
                          onUpdateBuruhLangsung(samples);
                        }}
                      />
                    </td>
                  </tr>
                )}
                {buruhLangsung.map((item, index) => (
                  <tr key={item.id} className="text-xs hover:bg-slate-50/40 transition-colors">
                    <td className="py-3 px-4">
                      <input
                        type="text"
                        value={item.nama}
                        onChange={(e) => updateBuruh(index, "nama", e.target.value)}
                        onKeyDown={(e) => handleInputEnterKey(e)}
                        className="w-full min-w-[180px] bg-transparent border-b border-transparent focus:border-blue-500 font-medium text-slate-800 outline-hidden focus:px-1 py-0.5 text-xs sm:text-sm"
                      />
                    </td>
                    <td className="py-3 px-3 font-mono text-right">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        value={item.stdJamPerUnit}
                        onChange={(e) => updateBuruh(index, "stdJamPerUnit", parseFloat(e.target.value) || 0)}
                        onKeyDown={(e) => handleInputEnterKey(e)}
                        className="w-full bg-transparent border-b border-transparent focus:border-blue-500 outline-hidden font-semibold text-slate-700 focus:px-1 py-0.5 text-right tabular-nums text-xs sm:text-sm"
                      />
                    </td>
                    <td className="py-3 px-3 font-mono text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <span className="text-slate-400">{config.currency}</span>
                        <input
                          type="number"
                          step="any"
                          inputMode="decimal"
                          value={item.stdKadarPerJam}
                          onChange={(e) => updateBuruh(index, "stdKadarPerJam", parseFloat(e.target.value) || 0)}
                          onKeyDown={(e) => handleInputEnterKey(e)}
                          className="w-full bg-transparent border-b border-transparent focus:border-blue-500 outline-hidden font-semibold text-slate-700 focus:px-1 py-0.5 text-right tabular-nums text-xs sm:text-sm"
                        />
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono font-bold text-slate-800 text-right tabular-nums whitespace-nowrap">
                      {f(calculateLaborCost(item.stdJamPerUnit, item.unitMasa || "jam", item.stdKadarPerJam))}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => deleteBuruh(item.id)}
                        className="text-slate-400 hover:text-rose-600 p-1.5 rounded-md transition-colors cursor-pointer inline-flex items-center justify-center min-h-[36px] min-w-[36px]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                
                {/* Add Buruh Row (Desktop) */}
                <tr className="bg-slate-50/20 text-xs">
                  <td className="py-2.5 px-4">
                    <input
                      type="text"
                      placeholder={lang === "en" ? "Kitchen assistant / Rolling task" : "Pembantu dapur / Tukang gulung"}
                      value={newBuruh.nama}
                      onChange={(e) => setNewBuruh({ ...newBuruh, nama: e.target.value })}
                      onKeyDown={(e) => handleInputEnterKey(e)}
                      className="w-full min-w-[190px] bg-white border border-slate-200 focus:border-blue-500 rounded-md px-2.5 py-1.5 outline-hidden font-medium text-xs sm:text-sm"
                    />
                    {/* Preset Quick Tray */}
                    <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                      <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">{t.common.quickAdd}:</span>
                      {presetsBuruh.map((p) => (
                        <button
                          key={p.nama}
                          type="button"
                          onClick={() => setNewBuruh({
                            nama: p.nama,
                            stdJamPerUnit: p.stdJamPerUnit,
                            stdKadarPerJam: p.stdKadarPerJam
                          })}
                          className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 hover:text-[#0b3c7a] text-slate-600 text-[9px] rounded-md transition-all font-sans cursor-pointer whitespace-nowrap"
                        >
                          {p.nama.split(" ")[0]}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      placeholder="0.04"
                      value={newBuruh.stdJamPerUnit || ""}
                      onChange={(e) => setNewBuruh({ ...newBuruh, stdJamPerUnit: parseFloat(e.target.value) || 0 })}
                      onKeyDown={(e) => handleInputEnterKey(e)}
                      className={`w-full bg-white border rounded-md px-2 py-1 outline-hidden font-mono text-right tabular-nums text-xs sm:text-sm ${
                        newBuruh.nama && newBuruh.stdJamPerUnit <= 0 ? "border-rose-400 ring-1 ring-rose-300" : "border-slate-200 focus:border-blue-500"
                      }`}
                    />
                    {newBuruh.nama && newBuruh.stdJamPerUnit <= 0 && (
                      <FormFieldValidation error={lang === "en" ? "Hours > 0" : "Masa > 0"} />
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      placeholder="8.50"
                      value={newBuruh.stdKadarPerJam || ""}
                      onChange={(e) => setNewBuruh({ ...newBuruh, stdKadarPerJam: parseFloat(e.target.value) || 0 })}
                      onKeyDown={(e) => handleInputEnterKey(e, addBuruh)}
                      className={`w-full bg-white border rounded-md px-2 py-1 outline-hidden font-mono text-right tabular-nums text-xs sm:text-sm ${
                        newBuruh.nama && newBuruh.stdKadarPerJam <= 0 ? "border-rose-400 ring-1 ring-rose-300" : "border-slate-200 focus:border-blue-500"
                      }`}
                    />
                    {newBuruh.nama && newBuruh.stdKadarPerJam <= 0 && (
                      <FormFieldValidation error={lang === "en" ? "Rate > 0" : "Kadar > 0"} />
                    )}
                  </td>
                  <td className="py-2.5 px-3 font-mono font-bold text-slate-400 text-right tabular-nums whitespace-nowrap">
                    {f(calculateLaborCost(newBuruh.stdJamPerUnit, "jam", newBuruh.stdKadarPerJam))}
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <button
                      onClick={addBuruh}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white p-1.5 rounded-md shadow-xs cursor-pointer inline-flex items-center justify-center min-h-[36px] min-w-[36px]"
                      title={t.common.add}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Card View for Buruh Langsung (< 640px) */}
          <div className="block sm:hidden p-3.5 space-y-3">
            {buruhLangsung.length === 0 && (
              <div className="p-2">
                <EmptyState
                  title={lang === "en" ? "No Direct Labor Recorded" : "Senarai Upah Pekerja Kosong"}
                  description={
                    lang === "en"
                      ? "Record preparation, cooking, or packaging labor hours below to calculate exact labor costs per unit."
                      : "Catatkan tugasan penyediaan, pembuatan, atau pembungkusan di bawah untuk menetapkan kadar operasi seunit."
                  }
                  actionLabel={lang === "en" ? "Load Preset Labor" : "Muat Upah Contoh"}
                  onAction={() => {
                    const samples: BuruhLangsung[] = presetsBuruh.map((p, idx) => ({
                      id: `preset-bl-${idx}-${Date.now()}`,
                      nama: p.nama,
                      stdJamPerUnit: p.stdJamPerUnit,
                      stdKadarPerJam: p.stdKadarPerJam,
                      kadarJam: p.stdKadarPerJam,
                      unitMasa: "jam" as const,
                      jamSebenar: p.stdJamPerUnit * config.sasaranKuantitiStandard,
                      kosSebenar: p.stdJamPerUnit * p.stdKadarPerJam * config.sasaranKuantitiStandard,
                      sebenarJamJumlah: p.stdJamPerUnit * config.sasaranKuantitiStandard,
                      sebenarKadarPerJam: p.stdKadarPerJam
                    }));
                    onUpdateBuruhLangsung(samples);
                  }}
                />
              </div>
            )}

            {buruhLangsung.map((item, index) => (
              <div key={item.id} className="p-3.5 bg-slate-50/70 dark:bg-[#101c30] rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    value={item.nama}
                    onChange={(e) => updateBuruh(index, "nama", e.target.value)}
                    className="flex-1 font-semibold text-slate-900 dark:text-slate-100 bg-transparent border-b border-transparent focus:border-blue-500 text-[16px] py-1 outline-hidden"
                    placeholder={t.standardSheet.laborTask}
                  />
                  <button
                    type="button"
                    onClick={() => deleteBuruh(item.id)}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-rose-600 active:scale-95 transition-all cursor-pointer rounded-xl bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 shadow-2xs"
                    title={t.common.delete}
                  >
                    <Trash2 className="w-4 h-4 text-rose-500" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[10px] font-mono font-bold text-slate-500 uppercase block mb-1 text-left">{t.standardSheet.laborHours}</label>
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={item.stdJamPerUnit}
                      onChange={(e) => updateBuruh(index, "stdJamPerUnit", parseFloat(e.target.value) || 0)}
                      className="w-full bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono font-semibold text-[16px] text-slate-800 dark:text-slate-100 tabular-nums outline-hidden focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono font-bold text-slate-500 uppercase block mb-1 text-left">{t.standardSheet.hourlyRateLabel} ({config.currency})</label>
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={item.stdKadarPerJam}
                      onChange={(e) => updateBuruh(index, "stdKadarPerJam", parseFloat(e.target.value) || 0)}
                      className="w-full bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono font-semibold text-[16px] text-slate-800 dark:text-slate-100 tabular-nums outline-hidden focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2.5 border-t border-slate-200/60 dark:border-slate-800">
                  <span className="text-xs text-slate-500 font-medium">{t.standardSheet.laborTotal}</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums text-sm whitespace-nowrap">
                    {f(calculateLaborCost(item.stdJamPerUnit, item.unitMasa || "jam", item.stdKadarPerJam))}
                  </span>
                </div>
              </div>
            ))}

            {/* Mobile Add Buruh Card */}
            <div className="p-4 bg-white dark:bg-[#132238] rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 space-y-3">
              <span className="text-[11px] font-mono font-bold text-[#0b3c7a] dark:text-sky-400 uppercase tracking-wider block text-left">
                + {lang === "en" ? "Add Labor Task" : "Tambah Tugasan Buruh"}
              </span>

              <div>
                <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">{t.standardSheet.laborTask}</label>
                <input
                  type="text"
                  placeholder={lang === "en" ? "e.g. Prep & Rolling" : "Contoh: Menggulung Popia / Memasak"}
                  value={newBuruh.nama}
                  onChange={(e) => setNewBuruh({ ...newBuruh, nama: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-[#101c30] border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-[16px] text-slate-900 dark:text-slate-100 outline-hidden focus:border-blue-500"
                />
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">{t.common.quickAdd}:</span>
                {presetsBuruh.map((p) => (
                  <button
                    key={p.nama}
                    type="button"
                    onClick={() => setNewBuruh({
                      nama: p.nama,
                      stdJamPerUnit: p.stdJamPerUnit,
                      stdKadarPerJam: p.stdKadarPerJam
                    })}
                    className="px-2.5 py-1.5 min-h-[36px] bg-slate-100 dark:bg-[#182a44] hover:bg-slate-200 text-slate-700 dark:text-slate-200 text-xs rounded-lg transition-all font-sans cursor-pointer whitespace-nowrap active:scale-95"
                  >
                    {p.nama.split(" ")[0]}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">{t.standardSheet.laborHours}</label>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    placeholder="0.04"
                    value={newBuruh.stdJamPerUnit || ""}
                    onChange={(e) => setNewBuruh({ ...newBuruh, stdJamPerUnit: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-50 dark:bg-[#101c30] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono text-[16px] text-slate-900 dark:text-slate-100 tabular-nums outline-hidden"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">{t.standardSheet.hourlyRateLabel} ({config.currency || "RM"})</label>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    placeholder="8.50"
                    value={newBuruh.stdKadarPerJam || ""}
                    onChange={(e) => setNewBuruh({ ...newBuruh, stdKadarPerJam: parseFloat(e.target.value) || 0 })}
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
                <span>{lang === "en" ? "Add Labor Task" : "Tambah Tugasan Buruh"}</span>
              </button>
            </div>
          </div>
        </div>

        {/* OVERHEAD BERUBAH */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <h3 className="font-display font-bold text-slate-800 flex items-center gap-2">
              <Clock className="w-5 h-5 text-[#0b3c7a]" />
              {t.standardSheet.variableOhTitle}
            </h3>
            <span className="px-2.5 py-0.5 bg-blue-100 text-blue-800 rounded-full font-mono font-bold text-xs">
              {t.common.total}: {f(totalOHB)}
            </span>
          </div>
          
          {/* Desktop Table View (>= 640px) */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[460px]">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-mono text-slate-400 uppercase bg-slate-50/20">
                  <th className="py-3 px-4 font-semibold min-w-[220px]">{t.standardSheet.varOhItem}</th>
                  <th className="py-3 px-4 font-semibold w-36 text-right">{t.standardSheet.varOhRate}</th>
                  <th className="py-3 px-4 text-center w-16">{t.common.delete}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overheadBerubah.map((item, index) => (
                  <tr key={item.id} className="text-xs hover:bg-slate-50/40 transition-colors">
                    <td className="py-3 px-4">
                      <input
                        type="text"
                        value={item.nama}
                        onChange={(e) => updateOHB(index, "nama", e.target.value)}
                        onKeyDown={(e) => handleInputEnterKey(e)}
                        className="w-full min-w-[200px] bg-transparent border-b border-transparent focus:border-blue-500 font-medium text-slate-800 outline-hidden focus:px-1 py-0.5 text-xs sm:text-sm"
                      />
                    </td>
                    <td className="py-3 px-4 font-mono text-right">
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-slate-400">{config.currency}</span>
                        <input
                          type="number"
                          step="any"
                          inputMode="decimal"
                          value={item.stdKosPerUnit}
                          onChange={(e) => updateOHB(index, "stdKosPerUnit", parseFloat(e.target.value) || 0)}
                          onKeyDown={(e) => handleInputEnterKey(e)}
                          className="w-full bg-transparent border-b border-transparent focus:border-blue-500 outline-hidden font-semibold text-slate-700 focus:px-1 py-0.5 text-right tabular-nums text-xs sm:text-sm"
                        />
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => deleteOHB(item.id)}
                        className="text-slate-400 hover:text-rose-600 p-1.5 rounded-md transition-colors cursor-pointer inline-flex items-center justify-center min-h-[36px] min-w-[36px]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                
                {/* Add OHB Row (Desktop) */}
                <tr className="bg-slate-50/20 text-xs">
                  <td className="py-2.5 px-4">
                    <input
                      type="text"
                      placeholder={lang === "en" ? "e.g. Disposable Cutlery or Ice" : "Contoh: Sudu & Garpu Plastik / Ais"}
                      value={newOHB.nama}
                      onChange={(e) => setNewOHB({ ...newOHB, nama: e.target.value })}
                      onKeyDown={(e) => handleInputEnterKey(e)}
                      className="w-full min-w-[210px] bg-white border border-slate-200 focus:border-blue-500 rounded-md px-2.5 py-1.5 outline-hidden font-medium text-xs sm:text-sm"
                    />
                    {/* Preset Quick Tray */}
                    <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                      <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">{t.common.quickAdd}:</span>
                      {presetsOHB.map((p) => (
                        <button
                          key={p.nama}
                          type="button"
                          onClick={() => setNewOHB({
                            nama: p.nama,
                            stdKosPerUnit: p.stdKosPerUnit
                          })}
                          className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 hover:text-[#0b3c7a] text-slate-600 text-[9px] rounded-md transition-all font-sans cursor-pointer whitespace-nowrap"
                        >
                          {p.nama.split(" ")[0]}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      placeholder="0.10"
                      value={newOHB.stdKosPerUnit || ""}
                      onChange={(e) => setNewOHB({ ...newOHB, stdKosPerUnit: parseFloat(e.target.value) || 0 })}
                      onKeyDown={(e) => handleInputEnterKey(e, addOHB)}
                      className="w-full bg-white border border-slate-200 focus:border-blue-500 rounded-md px-2 py-1 outline-hidden font-mono text-right tabular-nums text-xs sm:text-sm"
                    />
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <button
                      onClick={addOHB}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white p-1.5 rounded-md shadow-xs cursor-pointer inline-flex items-center justify-center min-h-[36px] min-w-[36px]"
                      title={t.common.add}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Card View for Overhead Berubah (< 640px) */}
          <div className="block sm:hidden p-3.5 space-y-3">
            {overheadBerubah.map((item, index) => (
              <div key={item.id} className="p-3.5 bg-slate-50/70 dark:bg-[#101c30] rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    value={item.nama}
                    onChange={(e) => updateOHB(index, "nama", e.target.value)}
                    className="flex-1 font-semibold text-slate-900 dark:text-slate-100 bg-transparent border-b border-transparent focus:border-blue-500 text-[16px] py-1 outline-hidden"
                    placeholder={t.standardSheet.varOhItem}
                  />
                  <button
                    type="button"
                    onClick={() => deleteOHB(item.id)}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-rose-600 active:scale-95 transition-all cursor-pointer rounded-xl bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 shadow-2xs"
                    title={t.common.delete}
                  >
                    <Trash2 className="w-4 h-4 text-rose-500" />
                  </button>
                </div>

                <div>
                  <label className="text-[10px] font-mono font-bold text-slate-500 uppercase block mb-1 text-left">{t.standardSheet.varOhRate} ({config.currency})</label>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={item.stdKosPerUnit}
                    onChange={(e) => updateOHB(index, "stdKosPerUnit", parseFloat(e.target.value) || 0)}
                    className="w-full bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono font-semibold text-[16px] text-slate-800 dark:text-slate-100 tabular-nums outline-hidden focus:border-blue-500"
                  />
                </div>
              </div>
            ))}

            {/* Mobile Add Overhead Berubah Card */}
            <div className="p-4 bg-white dark:bg-[#132238] rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 space-y-3">
              <span className="text-[11px] font-mono font-bold text-[#0b3c7a] dark:text-sky-400 uppercase tracking-wider block text-left">
                + {lang === "en" ? "Add Variable Overhead" : "Tambah Overhead Berubah"}
              </span>

              <div>
                <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">{t.standardSheet.varOhItem}</label>
                <input
                  type="text"
                  placeholder={lang === "en" ? "e.g. Cutlery / Packaging" : "Contoh: Pembungkusan / Gas"}
                  value={newOHB.nama}
                  onChange={(e) => setNewOHB({ ...newOHB, nama: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-[#101c30] border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-[16px] text-slate-900 dark:text-slate-100 outline-hidden focus:border-blue-500"
                />
              </div>

              {/* Quick Presets */}
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">{t.common.quickAdd}:</span>
                {presetsOHB.map((p) => (
                  <button
                    key={p.nama}
                    type="button"
                    onClick={() => setNewOHB({
                      nama: p.nama,
                      stdKosPerUnit: p.stdKosPerUnit
                    })}
                    className="px-2.5 py-1.5 min-h-[36px] bg-slate-100 dark:bg-[#182a44] hover:bg-slate-200 text-slate-700 dark:text-slate-200 text-xs rounded-lg transition-all font-sans cursor-pointer whitespace-nowrap active:scale-95"
                  >
                    {p.nama.split(" ")[0]}
                  </button>
                ))}
              </div>

              <div>
                <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">{t.standardSheet.varOhRate} ({config.currency || "RM"})</label>
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  placeholder="0.10"
                  value={newOHB.stdKosPerUnit || ""}
                  onChange={(e) => setNewOHB({ ...newOHB, stdKosPerUnit: parseFloat(e.target.value) || 0 })}
                  className="w-full bg-slate-50 dark:bg-[#101c30] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono text-[16px] text-slate-900 dark:text-slate-100 tabular-nums outline-hidden"
                />
              </div>

              <button
                type="button"
                onClick={addOHB}
                className="w-full min-h-[44px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer active:scale-[0.98] text-sm"
              >
                <Plus className="w-4 h-4" />
                <span>{lang === "en" ? "Add Variable Item" : "Tambah Item Berubah"}</span>
              </button>
            </div>
          </div>
        </div>

      </div>

      {/* SECTION 4: KOS TETAP MINGGUAN */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <h3 className="font-display font-bold text-slate-800 flex items-center gap-2">
            <Building className="w-5 h-5 text-[#0b3c7a]" />
            {t.standardSheet.fixedOhTitle}
          </h3>
          <span className="px-2.5 py-0.5 bg-blue-100 text-blue-800 rounded-full font-mono font-bold text-xs">
            {lang === "en" ? "Total Fixed Overhead:" : "Jumlah Kos Tetap:"} {f(totalOHT)}
          </span>
        </div>
        
        {/* Desktop Table View (>= 640px) */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-mono text-slate-400 uppercase bg-slate-50/20">
                <th className="py-3 px-5 font-semibold min-w-[280px]">{t.standardSheet.fixedOhItem}</th>
                <th className="py-3 px-4 font-semibold w-64 text-right">{t.standardSheet.fixedOhCost}</th>
                <th className="py-3 px-5 text-center w-24">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {overheadTetap.map((item, index) => (
                <tr key={item.id} className="text-sm hover:bg-slate-50/40 transition-colors">
                  <td className="py-3.5 px-5">
                    <input
                      type="text"
                      value={item.nama}
                      onChange={(e) => updateOHT(index, "nama", e.target.value)}
                      onKeyDown={(e) => handleInputEnterKey(e)}
                      className="w-full min-w-[260px] bg-transparent border-b border-transparent focus:border-blue-500 font-medium text-slate-800 outline-hidden focus:px-1 py-0.5 text-sm"
                    />
                  </td>
                  <td className="py-3.5 px-4 font-mono text-right">
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-slate-400">{config.currency}</span>
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        value={item.stdKosMingguan}
                        onChange={(e) => updateOHT(index, "stdKosMingguan", parseFloat(e.target.value) || 0)}
                        onKeyDown={(e) => handleInputEnterKey(e)}
                        className="w-full bg-transparent border-b border-transparent focus:border-blue-500 outline-hidden font-semibold text-slate-700 focus:px-1 py-0.5 text-right tabular-nums text-sm"
                      />
                    </div>
                  </td>
                  <td className="py-3.5 px-5 text-center">
                    <button
                      onClick={() => deleteOHT(item.id)}
                      className="text-slate-400 hover:text-rose-600 p-2 rounded-md transition-colors cursor-pointer inline-flex items-center justify-center min-h-[36px] min-w-[36px]"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}

              {/* Add New Row (Desktop) */}
              <tr className="bg-slate-50/20 text-sm">
                <td className="py-3 px-5">
                  <input
                    type="text"
                    placeholder={lang === "en" ? "e.g. Business Premises License" : "Contoh: Lesen Perniagaan Majlis Perbandaran"}
                    value={newOHT.nama}
                    onChange={(e) => setNewOHT({ ...newOHT, nama: e.target.value })}
                    onKeyDown={(e) => handleInputEnterKey(e)}
                    className="w-full min-w-[260px] bg-white border border-slate-200 focus:border-blue-500 rounded-lg px-3 py-2 font-medium outline-hidden text-sm"
                  />
                  {/* Preset Quick Tray */}
                  <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                    <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">{t.common.quickAdd}:</span>
                    {presetsOHT.map((p) => (
                      <button
                        key={p.nama}
                        type="button"
                        onClick={() => setNewOHT({
                          nama: p.nama,
                          stdKosMingguan: p.stdKosMingguan
                        })}
                        className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 hover:text-[#0b3c7a] text-slate-600 text-[9px] rounded-md transition-all font-sans cursor-pointer whitespace-nowrap"
                      >
                        {p.nama.split(" ")[0]}
                      </button>
                    ))}
                  </div>
                </td>
                <td className="py-3 px-4 text-right">
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    placeholder="30.00"
                    value={newOHT.stdKosMingguan || ""}
                    onChange={(e) => setNewOHT({ ...newOHT, stdKosMingguan: parseFloat(e.target.value) || 0 })}
                    onKeyDown={(e) => handleInputEnterKey(e, addOHT)}
                    className="w-full bg-white border border-slate-200 focus:border-blue-500 rounded-lg px-2.5 py-1.5 font-mono outline-hidden text-right tabular-nums text-sm"
                  />
                </td>
                <td className="py-3 px-5 text-center">
                  <button
                    onClick={addOHT}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white p-2 rounded-lg shadow-sm transition-all cursor-pointer inline-flex items-center justify-center min-h-[36px] min-w-[36px]"
                    title={t.common.add}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Mobile Stacked Card View for Overhead Tetap (< 640px) */}
        <div className="block sm:hidden p-3.5 space-y-3">
          {overheadTetap.map((item, index) => (
            <div key={item.id} className="p-3.5 bg-slate-50/70 dark:bg-[#101c30] rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3 shadow-2xs">
              <div className="flex items-center justify-between gap-2">
                <input
                  type="text"
                  value={item.nama}
                  onChange={(e) => updateOHT(index, "nama", e.target.value)}
                  className="flex-1 font-semibold text-slate-900 dark:text-slate-100 bg-transparent border-b border-transparent focus:border-blue-500 text-[16px] py-1 outline-hidden"
                  placeholder={t.standardSheet.fixedOhItem}
                />
                <button
                  type="button"
                  onClick={() => deleteOHT(item.id)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-rose-600 active:scale-95 transition-all cursor-pointer rounded-xl bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 shadow-2xs"
                  title={t.common.delete}
                >
                  <Trash2 className="w-4 h-4 text-rose-500" />
                </button>
              </div>

              <div>
                <label className="text-[10px] font-mono font-bold text-slate-500 uppercase block mb-1 text-left">{t.standardSheet.weeklyCostLabel} ({config.currency})</label>
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={item.stdKosMingguan}
                  onChange={(e) => updateOHT(index, "stdKosMingguan", parseFloat(e.target.value) || 0)}
                  className="w-full bg-white dark:bg-[#132238] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono font-semibold text-[16px] text-slate-800 dark:text-slate-100 tabular-nums outline-hidden focus:border-blue-500"
                />
              </div>
            </div>
          ))}

          {/* Mobile Add Overhead Tetap Card */}
          <div className="p-4 bg-white dark:bg-[#132238] rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 space-y-3">
            <span className="text-[11px] font-mono font-bold text-[#0b3c7a] dark:text-sky-400 uppercase tracking-wider block text-left">
              + {lang === "en" ? "Add Fixed Overhead" : "Tambah Kos Tetap Mingguan"}
            </span>

            <div>
              <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">{t.standardSheet.fixedOhItem}</label>
              <input
                type="text"
                placeholder={lang === "en" ? "e.g. Premises Rent / Permit" : "Contoh: Sewa Tapak / Lesen"}
                value={newOHT.nama}
                onChange={(e) => setNewOHT({ ...newOHT, nama: e.target.value })}
                className="w-full bg-slate-50 dark:bg-[#101c30] border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-[16px] text-slate-900 dark:text-slate-100 outline-hidden focus:border-blue-500"
              />
            </div>

            {/* Quick Presets */}
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">{t.common.quickAdd}:</span>
              {presetsOHT.map((p) => (
                <button
                  key={p.nama}
                  type="button"
                  onClick={() => setNewOHT({
                    nama: p.nama,
                    stdKosMingguan: p.stdKosMingguan
                  })}
                  className="px-2.5 py-1.5 min-h-[36px] bg-slate-100 dark:bg-[#182a44] hover:bg-slate-200 text-slate-700 dark:text-slate-200 text-xs rounded-lg transition-all font-sans cursor-pointer whitespace-nowrap active:scale-95"
                >
                  {p.nama.split(" ")[0]}
                </button>
              ))}
            </div>

            <div>
              <label className="text-[10px] font-mono text-slate-500 font-bold uppercase block mb-1 text-left">{t.standardSheet.weeklyCostLabel} ({config.currency || "RM"})</label>
              <input
                type="number"
                step="any"
                inputMode="decimal"
                placeholder="50.00"
                value={newOHT.stdKosMingguan || ""}
                onChange={(e) => setNewOHT({ ...newOHT, stdKosMingguan: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-50 dark:bg-[#101c30] border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 font-mono text-[16px] text-slate-900 dark:text-slate-100 tabular-nums outline-hidden"
              />
            </div>

            <button
              type="button"
              onClick={addOHT}
              className="w-full min-h-[44px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer active:scale-[0.98] text-sm"
            >
              <Plus className="w-4 h-4" />
              <span>{lang === "en" ? "Add Fixed Overhead" : "Tambah Kos Tetap"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* SECTION 5: RUMUSAN STRUKTUR PENGIRAAN KOS (COST SUMMARY CARD) */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs p-5 sm:p-7 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-[#0b3c7a] flex items-center justify-center border border-blue-100 shrink-0">
              <Info className="w-4 h-4" />
            </div>
            <div>
              <h4 className="font-display font-bold text-slate-900 text-sm sm:text-base">
                {lang === "en" ? "Product Costing Formulation Review" : "Rumusan Struktur & Logik Pengiraan Kos"}
              </h4>
              <p className="text-xs text-slate-500">
                {lang === "en"
                  ? `Standard breakdown for ${config.namaProduk} (${formatLocalizedNumber(config.sasaranKuantitiStandard, lang)} ${unitLabel}/week)`
                  : `Pecahan piawai untuk ${config.namaProduk} (${formatLocalizedNumber(config.sasaranKuantitiStandard, lang)} ${unitLabel}/minggu)`}
              </p>
            </div>
          </div>
          <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200/70 self-start sm:self-auto">
            {lang === "en" ? "Standard Balanced" : "Seimbang & Terkawal"}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/60 space-y-1">
            <span className="text-slate-500 text-[10px] font-bold uppercase block">{lang === "en" ? "Unit Variable Cost Formula" : "Formula Kos Berubah Seunit"}</span>
            <div className="text-slate-800 text-xs font-semibold">
              {f(totalBahan)} + {f(totalBuruh)} + {f(totalOHB)} = <strong className="text-[#0b3c7a]">{f(kosBerubahSeunit)}</strong>
            </div>
            <span className="text-slate-400 text-[10px] block font-sans">{lang === "en" ? "Materials + Labor + Variable Overhead" : "Bahan Mentah + Buruh + Overhead Berubah"}</span>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/60 space-y-1">
            <span className="text-slate-500 text-[10px] font-bold uppercase block">{lang === "en" ? "Fixed Cost Burden per Unit" : "Beban Kos Tetap Seunit"}</span>
            <div className="text-slate-800 text-xs font-semibold">
              {f(totalOHT)} ÷ {formatLocalizedNumber(config.sasaranKuantitiStandard, lang)} = <strong className="text-slate-900">{f(kosTetapSeunit)}</strong>
            </div>
            <span className="text-slate-400 text-[10px] block font-sans">{lang === "en" ? "Weekly Fixed Overhead ÷ Target Units" : "Kos Tetap Mingguan ÷ Sasaran Pengeluaran"}</span>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/60 space-y-1">
            <span className="text-slate-500 text-[10px] font-bold uppercase block">{lang === "en" ? "Unit Full Cost & Profit Margin" : "Kos Penuh & Margin Seunit"}</span>
            <div className="text-slate-800 text-xs font-semibold">
              {f(hargaJualan)} - {f(kosBerubahSeunit)} = <strong className="text-emerald-700">{f(marginCarumanSeunit)}</strong> ({marginPercent.toFixed(1)}%)
            </div>
            <span className="text-slate-400 text-[10px] block font-sans">{lang === "en" ? "Selling Price - Variable Cost" : "Harga Jualan - Kos Berubah"}</span>
          </div>
        </div>
      </div>

      {/* Interactive Modal: Scenario Simulator */}
      <ModalPortal
        isOpen={activeToolModal === "simulator"}
        onClose={() => setActiveToolModal("none")}
        title={lang === "en" ? "Managerial What-If Scenario Simulator" : "Simulator Senario Keuntungan & Titik Pulang Modal"}
        icon={<Sliders className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
        closeAriaLabel={lang === "en" ? "Close" : "Tutup"}
      >
        <ScenarioSimulatorSheet
          config={config}
          bahanMentah={bahanMentah}
          buruhLangsung={buruhLangsung}
          overheadBerubah={overheadBerubah}
          overheadTetap={overheadTetap}
          stdSummary={stdSummary}
          actSummary={actSummary}
          systemLang={lang}
          onApplySimulation={onApplySimulation}
          onClose={() => setActiveToolModal("none")}
        />
      </ModalPortal>

      {/* Interactive Modal: Batch Quotation */}
      <ModalPortal
        isOpen={activeToolModal === "quotation"}
        onClose={() => setActiveToolModal("none")}
        title={lang === "en" ? "B2B Bulk Quotation & Tier Pricing Studio" : "Studio Sebut Harga & Skala Pesanan Pukal B2B"}
        icon={<FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
        closeAriaLabel={lang === "en" ? "Close" : "Tutup"}
      >
        <BatchQuotationSheet
          config={config}
          bahanMentah={bahanMentah}
          buruhLangsung={buruhLangsung}
          overheadBerubah={overheadBerubah}
          overheadTetap={overheadTetap}
          stdSummary={stdSummary}
          actSummary={actSummary}
          systemLang={lang}
          onClose={() => setActiveToolModal("none")}
        />
      </ModalPortal>
    </div>
  );
}
