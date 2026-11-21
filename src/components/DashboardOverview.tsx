/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { RingkasanKos } from "../utils/costCalculations";
import { KonfigurasiSistem, BahanMentah, BuruhLangsung, OverheadBerubah, OverheadTetap } from "../types";
import { 
  DollarSign, 
  TrendingUp, 
  Layers, 
  UtensilsCrossed, 
  ArrowUpRight, 
  ArrowDownRight, 
  CheckCircle, 
  Percent, 
  Calendar,
  AlertTriangle,
  ChevronRight,
  Target,
  Sparkles,
  PieChart,
  Scale,
  Sliders,
  FileText,
  X,
  Calculator
} from "lucide-react";
import { Language, getTranslation, getStoredLanguage, formatLocalizedNumber, formatUnitLabel } from "../utils/i18n";
import ScenarioSimulatorSheet from "./ScenarioSimulatorSheet";
import BatchQuotationSheet from "./BatchQuotationSheet";
import ModalPortal from "./ModalPortal";
import { 
  FINANCIAL_COLORS, 
  getProfitStatus, 
  getVarianceStatus, 
  getMarginStatus, 
  formatCurrencyRM,
  formatQuantity,
  formatPercentage
} from "../utils/financialColors";

interface DashboardOverviewProps {
  config: KonfigurasiSistem;
  stdSummary: RingkasanKos;
  actSummary: RingkasanKos;
  onNavigate: (tabId: string) => void;
  systemLang?: Language;
  bahanMentah?: BahanMentah[];
  buruhLangsung?: BuruhLangsung[];
  overheadBerubah?: OverheadBerubah[];
  overheadTetap?: OverheadTetap[];
  onApplySimulation?: (updatedConfig: Partial<KonfigurasiSistem>) => void;
}

export default function DashboardOverview({
  config,
  stdSummary,
  actSummary,
  onNavigate,
  systemLang,
  bahanMentah = [],
  buruhLangsung = [],
  overheadBerubah = [],
  overheadTetap = [],
  onApplySimulation,
}: DashboardOverviewProps) {
  const lang: Language = systemLang || config.language || getStoredLanguage();
  const t = getTranslation(lang);
  const [activeModal, setActiveModal] = useState<"none" | "simulator" | "quotation">("none");

  // Format currency using standardized Malaysian Ringgit formatter (with commas & RM prefix)
  const f = (val: number) => formatCurrencyRM(val, config.currency || "RM");
  const fNum = (val: number) => formatLocalizedNumber(val, lang, { maximumFractionDigits: 0 });
  const unitLabel = formatUnitLabel(config.unitProduk, lang);

  // Dynamic Financial Status evaluations
  const costVarianceStatus = getVarianceStatus(
    actSummary.jumlahKosBerubahSemangkuk,
    stdSummary.jumlahKosBerubahSemangkuk
  );
  const costDiff = actSummary.jumlahKosBerubahSemangkuk - stdSummary.jumlahKosBerubahSemangkuk;
  const isCostFavorable = costDiff <= 0.005;

  const profitDiff = actSummary.untungBersihMingguan - stdSummary.untungBersihMingguan;
  const isProfitFavorable = profitDiff >= -0.005;

  const profitStatus = getProfitStatus(actSummary.untungBersihMingguan);

  const marginStd = config.hargaJualanStandard > 0
    ? ((config.hargaJualanStandard - stdSummary.jumlahKosBerubahSemangkuk) / config.hargaJualanStandard) * 100
    : 0;
  const marginAct = config.hargaJualanSebenar > 0
    ? ((config.hargaJualanSebenar - actSummary.jumlahKosBerubahSemangkuk) / config.hargaJualanSebenar) * 100
    : 0;
  const marginStatus = getMarginStatus(marginAct);

  // Attainment percentage
  const attainmentPercent = config.sasaranKuantitiStandard > 0
    ? Math.min(Math.round((config.kuantitiSebenarDijual / config.sasaranKuantitiStandard) * 100), 999)
    : 0;

  // Breakdown percentages for actual cost per unit
  const totalVarCost = actSummary.jumlahKosBerubahSemangkuk;
  const matPct = totalVarCost > 0 ? Math.round((actSummary.bahanMentahSemangkuk / totalVarCost) * 100) : 0;
  const labPct = totalVarCost > 0 ? Math.round((actSummary.buruhLangsungSemangkuk / totalVarCost) * 100) : 0;
  const vohPct = totalVarCost > 0 ? Math.max(0, 100 - matPct - labPct) : 0;

  return (
    <div className="space-y-6 sm:space-y-8 animate-fadeIn">
      {/* 1. EXECUTIVE HEADER BANNER */}
      <div className="rounded-[10px] bg-gradient-to-r from-[#061833] via-[#0b2853] to-[#0e3b79] p-5 sm:p-6 text-white border border-white/10">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <h2 className="screen-title text-white tracking-tight">
              {config.namaSyarikat || "SmartCost"}
            </h2>
            <p className="text-xs sm:text-sm text-blue-100/90 leading-relaxed max-w-xl">
              {lang === "en"
                ? `Cost overview, profit margins, and weekly production goals for ${config.namaProduk}.`
                : `Ringkasan kos produk, margin untung dan sasaran jualan mingguan bagi ${config.namaProduk}.`}
            </p>
          </div>

          {/* Single Primary Action Button: Mula kira kos produk */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              id="btn-primary-start-costing"
              onClick={() => onNavigate("standard")}
              className="min-h-[44px] px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-[10px] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-95"
            >
              <Calculator className="w-4 h-4" />
              <span>{lang === "en" ? "Start Costing Product" : "Mula kira kos produk"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. FOUR FINANCIAL KPI CARDS (STANDARDIZED SIZE, 10px RADIUS, BORDER 1px) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        
        {/* CARD 1: KOS PRODUK SEUNIT */}
        <button
          id="btn-nav-standard"
          onClick={() => onNavigate("standard")}
          className="group text-left p-4 sm:p-5 bg-white dark:bg-[#132238] border border-slate-200/90 dark:border-slate-800 rounded-[10px] hover:bg-slate-50/80 dark:hover:bg-[#182a44] transition-all focus:outline-hidden cursor-pointer flex flex-col justify-between min-h-[140px]"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {lang === "en" ? "Unit product cost" : "Kos seunit produk"}
            </span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
          </div>

          <div className="my-2">
            <h3 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
              {f(actSummary.jumlahKosBerubahSemangkuk)}
            </h3>
            <span className="text-xs text-slate-400 block mt-0.5">
              {lang === "en" ? `per unit (${unitLabel})` : `seunit (${unitLabel})`}
            </span>
          </div>
          
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{lang === "en" ? "Standard:" : "Piawai:"} {f(stdSummary.jumlahKosBerubahSemangkuk)}</span>
            <span 
              style={{ color: costVarianceStatus.colorHex }}
              className="font-bold tabular-nums"
            >
              {costDiff <= 0.0001 ? '-' : '+'}{f(Math.abs(costDiff))}
            </span>
          </div>
        </button>

        {/* CARD 2: HARGA JUALAN */}
        <button
          id="btn-nav-sebenar"
          onClick={() => onNavigate("settings")}
          className="group text-left p-4 sm:p-5 bg-white dark:bg-[#132238] border border-slate-200/90 dark:border-slate-800 rounded-[10px] hover:bg-slate-50/80 dark:hover:bg-[#182a44] transition-all focus:outline-hidden cursor-pointer flex flex-col justify-between min-h-[140px]"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {lang === "en" ? "Selling price" : "Harga jualan seunit"}
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>

          <div className="my-2">
            <h3 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
              {f(config.hargaJualanSebenar)}
            </h3>
            <span className="text-xs text-slate-400 block mt-0.5">
              {lang === "en" ? "current selling price" : "harga jualan semasa"}
            </span>
          </div>
          
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{lang === "en" ? "Target:" : "Piawai:"} {f(config.hargaJualanStandard)}</span>
            <span className="text-[#0b3c7a] dark:text-sky-400 font-medium">
              {lang === "en" ? "Edit price →" : "Ubah harga →"}
            </span>
          </div>
        </button>

        {/* CARD 3: MARGIN CARUMAN */}
        <button
          id="btn-nav-bep"
          onClick={() => onNavigate("bep")}
          className="group text-left p-4 sm:p-5 bg-white dark:bg-[#132238] border border-slate-200/90 dark:border-slate-800 rounded-[10px] hover:bg-slate-50/80 dark:hover:bg-[#182a44] transition-all focus:outline-hidden cursor-pointer flex flex-col justify-between min-h-[140px]"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {lang === "en" ? "Contribution margin" : "Margin sumbangan"}
            </span>
            <div 
              style={{
                backgroundColor: marginStatus.status === "profit" ? "rgba(22, 163, 74, 0.1)" : marginStatus.status === "moderate" ? "rgba(217, 119, 6, 0.1)" : "rgba(220, 38, 38, 0.1)",
                color: marginStatus.colorHex,
              }}
              className="w-8 h-8 rounded-lg flex items-center justify-center"
            >
              <Percent className="w-4 h-4" />
            </div>
          </div>

          <div className="my-2">
            <h3 
              style={{ color: marginStatus.colorHex }}
              className="text-xl sm:text-2xl font-bold tabular-nums whitespace-nowrap"
            >
              {marginAct.toFixed(1)}%
            </h3>
            <span className="text-xs text-slate-400 block mt-0.5">
              {f(config.hargaJualanSebenar - actSummary.jumlahKosBerubahSemangkuk)} {lang === "en" ? "/ unit" : "/ unit"}
            </span>
          </div>
          
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{lang === "en" ? "Target margin:" : "Margin sasaran:"} {marginStd.toFixed(1)}%</span>
            <span className="text-sky-700 dark:text-sky-400 font-medium">
              {lang === "en" ? "Check BEP →" : "Semak Titik Pulang Modal →"}
            </span>
          </div>
        </button>

        {/* CARD 4: UNTUNG BERSIH */}
        <button
          id="btn-nav-statement"
          onClick={() => onNavigate("statement")}
          className="group text-left p-4 sm:p-5 bg-white dark:bg-[#132238] border border-slate-200/90 dark:border-slate-800 rounded-[10px] hover:bg-slate-50/80 dark:hover:bg-[#182a44] transition-all focus:outline-hidden cursor-pointer flex flex-col justify-between min-h-[140px]"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {lang === "en" ? "Weekly net profit" : "Untung bersih mingguan"}
            </span>
            <div 
              style={{
                backgroundColor: profitStatus.status === "profit" ? "rgba(22, 163, 74, 0.1)" : profitStatus.status === "moderate" ? "rgba(217, 119, 6, 0.1)" : "rgba(220, 38, 38, 0.1)",
                color: profitStatus.colorHex,
              }}
              className="w-8 h-8 rounded-lg flex items-center justify-center"
            >
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>

          <div className="my-2">
            <h3 
              style={{ color: profitStatus.colorHex }}
              className="text-xl sm:text-2xl font-bold tabular-nums whitespace-nowrap"
            >
              {f(actSummary.untungBersihMingguan)}
            </h3>
            <span className="text-xs text-slate-400 block mt-0.5">
              {profitStatus.status === "profit" 
                ? (lang === "en" ? "Profitable after fixed costs" : "Untung bersih selepas kos tetap")
                : profitStatus.status === "moderate"
                ? (lang === "en" ? "Break-even (Zero net profit)" : "Pulang modal (Untung bersih sifar)")
                : (lang === "en" ? "Operating at a loss" : "Mengalami kerugian operasi")}
            </span>
          </div>
          
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{lang === "en" ? "Standard:" : "Piawai:"} {f(stdSummary.untungBersihMingguan)}</span>
            <span 
              style={{ color: profitStatus.colorHex }}
              className="font-medium"
            >
              {profitStatus.status === "profit" 
                ? (lang === "en" ? "Profit →" : "Untung →") 
                : profitStatus.status === "moderate"
                ? (lang === "en" ? "Break-Even →" : "Pulang Modal →")
                : (lang === "en" ? "Loss →" : "Rugi →")}
            </span>
          </div>
        </button>

      </div>

      {/* 2.5. STRATEGIC INTERACTIVE TOOLS (SCENARIO SIMULATOR & B2B BATCH QUOTATION) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        
        {/* Tool 1: Simulasi Senario Margin & Ujian Tekanan */}
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 text-white rounded-3xl p-6 border border-slate-700/60 shadow-md flex flex-col justify-between space-y-4 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-sky-500/10 rounded-full blur-2xl pointer-events-none group-hover:bg-sky-500/20 transition-all"></div>
          
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="px-2.5 py-1 bg-sky-500/20 text-sky-300 border border-sky-400/30 rounded-[6px] text-xs font-semibold flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-sky-400" />
                <span>{lang === "en" ? "Scenario Sim" : "Simulasi Senario"}</span>
              </span>
              <span className="text-xs text-slate-400">
                {lang === "en" ? "Interactive" : "Uji margin"}
              </span>
            </div>
            
            <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
              {lang === "en" ? "Price & Profit Simulation" : "Simulasi harga dan untung"}
            </h3>
            
            <p className="text-xs text-slate-300 leading-relaxed">
              {lang === "en"
                ? "Simulate profit changes if raw material prices rise or if you adjust selling prices without modifying live records."
                : "Uji kesan keuntungan jika kos bahan mentah berubah atau anda melaraskan harga jualan tanpa mengubah rekod asal."}
            </p>
          </div>

          <div className="pt-3 border-t border-white/10 flex items-center justify-between">
            <div className="text-[11px] text-slate-400 font-mono">
              <span>{lang === "en" ? "Current Margin:" : "Margin Semasa:"} </span>
              <strong className="text-emerald-400 font-bold">{marginAct.toFixed(1)}%</strong>
            </div>

            <button
              id="btn-open-scenario-simulator"
              onClick={() => setActiveModal("simulator")}
              className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-xs hover:shadow hover:scale-[1.02]"
            >
              <Sliders className="w-3.5 h-3.5 text-slate-950" />
              <span>{lang === "en" ? "Launch Simulator" : "Simulasi Senario"}</span>
            </button>
          </div>
        </div>

        {/* Tool 2: Penjana Sebut Harga Tempahan Pukal B2B */}
        <div className="bg-gradient-to-br from-[#061830] via-[#092244] to-[#0c3162] text-white rounded-3xl p-6 border border-blue-500/30 shadow-md flex flex-col justify-between space-y-4 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-400/10 rounded-full blur-2xl pointer-events-none group-hover:bg-blue-400/20 transition-all"></div>
          
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 rounded-[6px] text-xs font-semibold flex items-center gap-1.5">
                <Calculator className="w-3.5 h-3.5 text-emerald-400" />
                <span>{lang === "en" ? "Bulk Quotation" : "Sebut Harga"}</span>
              </span>
              <span className="text-xs text-blue-200/80">
                {lang === "en" ? "Bulk orders" : "Tempahan katering"}
              </span>
            </div>
            
            <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
              {lang === "en" ? "Quotation for Bulk Orders" : "Sebut harga tempahan pukal"}
            </h3>
            
            <p className="text-xs text-blue-100/80 leading-relaxed">
              {lang === "en"
                ? "Calculate bulk order pricing, volume discounts, kitchen batch measurements, and WhatsApp quote summary."
                : "Kira harga tempahan pukal, sukatan bahan resipi dapur mengikut kuantiti, dan salin sebut harga untuk pelanggan."}
            </p>
          </div>

          <div className="pt-3 border-t border-white/10 flex items-center justify-between">
            <div className="text-[11px] text-blue-200/80 font-mono">
              <span>{lang === "en" ? "Unit Cost:" : "Kos Unit:"} </span>
              <strong className="text-sky-300 font-bold">{f(actSummary.jumlahKosBerubahSemangkuk)}</strong>
            </div>

            <button
              id="btn-open-batch-quotation"
              onClick={() => setActiveModal("quotation")}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-xs hover:shadow hover:scale-[1.02]"
            >
              <FileText className="w-3.5 h-3.5 text-slate-950" />
              <span>{lang === "en" ? "Bulk Quotation" : "Sebut Harga"}</span>
            </button>
          </div>
        </div>

      </div>

      {/* 3. COST STRUCTURE DISTRIBUTION BAR & OPERATIONAL INSIGHTS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Cost Structure Card */}
        <div className="lg:col-span-1 bg-white rounded-3xl border border-slate-200/80 p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-display font-bold text-slate-900 flex items-center gap-2">
              <PieChart className="w-4 h-4 text-blue-600" />
              <span>{lang === "en" ? `Cost Composition (Per ${unitLabel})` : `Komposisi Kos (Se-${unitLabel})`}</span>
            </h3>
            <span className="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md tabular-nums">
              {f(actSummary.jumlahKosBerubahSemangkuk)}
            </span>
          </div>

          {/* Segmented multi-bar */}
          <div className="w-full bg-slate-100 rounded-xl h-3.5 overflow-hidden flex p-0.5 gap-0.5">
            <div style={{ width: `${matPct}%` }} className="bg-blue-600 rounded-l-lg transition-all" title={lang === "en" ? `Direct Materials: ${matPct}%` : `Bahan mentah: ${matPct}%`}></div>
            <div style={{ width: `${labPct}%` }} className="bg-amber-500 transition-all" title={lang === "en" ? `Direct Labor: ${labPct}%` : `Upah pekerja: ${labPct}%`}></div>
            <div style={{ width: `${vohPct}%` }} className="bg-emerald-500 rounded-r-lg transition-all" title={lang === "en" ? `Variable Overhead: ${vohPct}%` : `Kos berubah: ${vohPct}%`}></div>
          </div>

          {/* Legend Items */}
          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-100">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600"></span>
                <span className="text-slate-600 font-medium">{lang === "en" ? "Direct Materials" : "Bahan mentah"}</span>
              </div>
              <span className="font-mono font-bold text-slate-900 tabular-nums">{f(actSummary.bahanMentahSemangkuk)} ({matPct}%)</span>
            </div>

            <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-100">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                <span className="text-slate-600 font-medium">{lang === "en" ? "Direct Labor" : "Upah pekerja"}</span>
              </div>
              <span className="font-mono font-bold text-slate-900 tabular-nums">{f(actSummary.buruhLangsungSemangkuk)} ({labPct}%)</span>
            </div>

            <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-100">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <span className="text-slate-600 font-medium">{lang === "en" ? "Variable Overhead" : "Kos berubah"}</span>
              </div>
              <span className="font-mono font-bold text-slate-900 tabular-nums">{f(actSummary.overheadBerubahSemangkuk)} ({vohPct}%)</span>
            </div>
          </div>

          <button
            onClick={() => onNavigate("varians")}
            className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold font-mono tracking-wide flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <span>{lang === "en" ? "Analyze Variances" : "Analisis Perbezaan Kos"}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Operational Executive Insights */}
        <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200/80 p-6 shadow-xs flex flex-col justify-between space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-display font-bold text-slate-900 flex items-center gap-2">
              <UtensilsCrossed className="w-4 h-4 text-[#0b3c7a]" /> 
              <span>{t.dashboard.businessInsightTitle} {config.namaSyarikat}</span>
            </h3>
            <span className="text-xs text-slate-400 font-mono">
              {lang === "en" ? "Performance Audited" : "Prestasi Diaudit"}
            </span>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            
            {/* Status 1: Sales Performance */}
            <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-200/60 space-y-2 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-slate-500 font-bold uppercase tracking-wider">{t.dashboard.salesPerf}</span>
                <span className="px-2 py-0.5 bg-sky-100 text-sky-800 text-[10px] rounded-full font-mono font-bold">{t.dashboard.volume}</span>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed">
                {lang === "en" ? (
                  <>
                    Sold <strong className="text-slate-900 font-mono tabular-nums">{fNum(config.kuantitiSebenarDijual)}</strong> {unitLabel}, attaining <strong className="text-sky-800 font-mono">{attainmentPercent}%</strong> of budgeted volume ({fNum(config.sasaranKuantitiStandard)} {unitLabel}).
                  </>
                ) : (
                  <>
                    Perniagaan menjual <strong className="text-slate-900 font-mono tabular-nums">{fNum(config.kuantitiSebenarDijual)}</strong> {unitLabel}, iaitu <strong className="text-sky-800 font-mono">{attainmentPercent}%</strong> daripada sasaran ({fNum(config.sasaranKuantitiStandard)} {unitLabel}).
                  </>
                )}
              </p>
              <div className="text-[10px] text-sky-700 font-bold flex items-center gap-1 pt-1">
                <Target className="w-3 h-3" /> {lang === "en" ? "Volume Attainment" : "Pencapaian Volum"}
              </div>
            </div>

            {/* Status 2: Cost Control */}
            <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-200/60 space-y-2 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-slate-500 font-bold uppercase tracking-wider">{t.dashboard.varianceAnalysis}</span>
                <span className={`px-2 py-0.5 text-[10px] rounded-full font-mono font-bold uppercase ${isCostFavorable ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                  {isCostFavorable ? (lang === "en" ? "Favorable" : "Menguntungkan") : (lang === "en" ? "Unfavorable" : "Tidak Menguntungkan")}
                </span>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed">
                {isCostFavorable ? (
                  lang === "en" 
                    ? `Favorable cost variance achieved! Actual variable cost per ${unitLabel} is lower than budgeted standard.`
                    : `Perbezaan kos menguntungkan! Kos berubah sebenar se-${unitLabel} lebih rendah daripada sasaran piawai.`
                ) : (
                  lang === "en"
                    ? `Unfavorable variance of ${f(Math.abs(costDiff))} per ${unitLabel} observed. Check raw ingredient and procurement rates.`
                    : `Perbezaan kos tidak menguntungkan sebanyak ${f(Math.abs(costDiff))} se-${unitLabel} dikesan. Sila semak semula harga belian bahan mentah.`
                )}
              </p>
              <div className={`text-[10px] font-bold flex items-center gap-1 pt-1 ${isCostFavorable ? 'text-emerald-700' : 'text-rose-700'}`}>
                {isCostFavorable ? <CheckCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                {isCostFavorable ? (lang === "en" ? "Favorable Status" : "Status Menguntungkan") : (lang === "en" ? "Action Required" : "Tindakan Diperlukan")}
              </div>
            </div>

            {/* Status 3: Net Operating Income */}
            <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-200/60 space-y-2 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-slate-500 font-bold uppercase tracking-wider">{t.dashboard.bepTitle}</span>
                <span 
                  style={{
                    backgroundColor: profitStatus.status === "profit" ? "rgba(22, 163, 74, 0.15)" : profitStatus.status === "moderate" ? "rgba(217, 119, 6, 0.15)" : "rgba(220, 38, 38, 0.15)",
                    color: profitStatus.colorHex,
                  }}
                  className="px-2 py-0.5 text-[10px] rounded-full font-mono font-bold uppercase"
                >
                  {profitStatus.status === "profit" 
                    ? (lang === "en" ? "Profitable" : "Untung") 
                    : profitStatus.status === "moderate"
                    ? (lang === "en" ? "Break-Even" : "Pulang Modal")
                    : (lang === "en" ? "Deficit" : "Rugi")}
                </span>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed">
                {profitStatus.status === "profit" ? (
                  lang === "en" ? (
                    <>
                      Weekly net income recorded at <strong style={{ color: FINANCIAL_COLORS.GREEN }} className="font-mono tabular-nums">{f(actSummary.untungBersihMingguan)}</strong>, successfully clearing all operational fixed overheads.
                    </>
                  ) : (
                    <>
                      Syarikat mencatat untung bersih <strong style={{ color: FINANCIAL_COLORS.GREEN }} className="font-mono tabular-nums">{f(actSummary.untungBersihMingguan)}</strong>, melepasi Titik Pulang Modal mingguan.
                    </>
                  )
                ) : profitStatus.status === "moderate" ? (
                  lang === "en" ? (
                    <>
                      Break-even achieved at <strong style={{ color: FINANCIAL_COLORS.AMBER }} className="font-mono tabular-nums">{f(actSummary.untungBersihMingguan)}</strong>. Revenues exactly match expenses.
                    </>
                  ) : (
                    <>
                      Mencapai Titik Pulang Modal pada <strong style={{ color: FINANCIAL_COLORS.AMBER }} className="font-mono tabular-nums">{f(actSummary.untungBersihMingguan)}</strong>. Jumlah hasil menyamai kos.
                    </>
                  )
                ) : (
                  lang === "en" ? (
                    <>
                      Operating deficit of <strong style={{ color: FINANCIAL_COLORS.RED }} className="font-mono tabular-nums">{f(actSummary.untungBersihMingguan)}</strong> recorded. Fixed overheads exceed gross contribution.
                    </>
                  ) : (
                    <>
                      Mengalami kerugian operasi sebanyak <strong style={{ color: FINANCIAL_COLORS.RED }} className="font-mono tabular-nums">{f(actSummary.untungBersihMingguan)}</strong>. Kos tetap melebihi margin sumbangan.
                    </>
                  )
                )}
              </p>
              <div 
                style={{ color: profitStatus.colorHex }}
                className="text-[10px] font-bold flex items-center gap-1 pt-1"
              >
                <Scale className="w-3 h-3" /> 
                {profitStatus.status === "profit" 
                  ? (lang === "en" ? "Net Profitability Safe" : "Keuntungan Bersih Terjamin")
                  : profitStatus.status === "moderate"
                  ? (lang === "en" ? "Break-Even State" : "Keadaan Pulang Modal")
                  : (lang === "en" ? "Loss Deficit Warning" : "Amaran Defisit Rugi")}
              </div>
            </div>

          </div>

          <div className="p-3 bg-blue-50/60 border border-blue-200/70 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-blue-900">
              <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />
              <span>{lang === "en" ? "Need actionable recommendations to optimize recipe costs and pricing?" : "Perlukan cadangan bernas untuk mengoptimumkan kos resipi dan harga jualan?"}</span>
            </div>
            <button
              onClick={() => onNavigate("mrcost")}
              className="px-3.5 py-1.5 bg-[#0b3c7a] hover:bg-[#082d5a] text-white rounded-xl font-bold font-mono text-[11px] flex items-center justify-center gap-1.5 shrink-0 transition-colors cursor-pointer"
            >
              <span>{lang === "en" ? "Consult Mr. Cost AI" : "Rujuk Mr. Cost AI"}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

      </div>

      {/* Interactive Modal: Scenario Simulator */}
      <ModalPortal
        isOpen={activeModal === "simulator"}
        onClose={() => setActiveModal("none")}
        title={lang === "en" ? "Interactive What-If Simulation Studio" : "Studio Simulasi Senario What-If Interaktif"}
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
          onClose={() => setActiveModal("none")}
        />
      </ModalPortal>

      {/* Interactive Modal: Batch Quotation */}
      <ModalPortal
        isOpen={activeModal === "quotation"}
        onClose={() => setActiveModal("none")}
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
          onClose={() => setActiveModal("none")}
        />
      </ModalPortal>
    </div>
  );
}
