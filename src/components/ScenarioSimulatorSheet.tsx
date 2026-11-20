/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { KonfigurasiSistem, BahanMentah, BuruhLangsung, OverheadBerubah, OverheadTetap } from "../types";
import { RingkasanKos, kiraAnalisisBEP } from "../utils/costCalculations";
import { 
  Sliders, 
  TrendingUp, 
  TrendingDown, 
  RefreshCw, 
  Scale, 
  DollarSign, 
  Layers, 
  Clock, 
  Info,
  X
} from "lucide-react";
import { Language, getTranslation, getStoredLanguage } from "../utils/i18n";

interface ScenarioSimulatorSheetProps {
  config: KonfigurasiSistem;
  bahanMentah: BahanMentah[];
  buruhLangsung: BuruhLangsung[];
  overheadBerubah: OverheadBerubah[];
  overheadTetap: OverheadTetap[];
  stdSummary: RingkasanKos;
  actSummary: RingkasanKos;
  systemLang?: Language;
  onClose?: () => void;
  onApplySimulation?: (updatedConfig: Partial<KonfigurasiSistem>) => void;
}

export default function ScenarioSimulatorSheet({
  config,
  bahanMentah,
  buruhLangsung,
  overheadBerubah,
  overheadTetap,
  stdSummary,
  actSummary,
  systemLang,
  onClose,
  onApplySimulation,
}: ScenarioSimulatorSheetProps) {
  const lang: Language = systemLang || config.language || getStoredLanguage();
  const t = getTranslation(lang);
  const [appliedNotice, setAppliedNotice] = useState<string>("");
  const [copiedReport, setCopiedReport] = useState<boolean>(false);
  const f = (val: number) => `${config.currency} ${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fNum = (val: number) => val.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const unitLabel = config.unitProduk || (lang === "en" ? "units" : "batang");

  // Simulation Sliders / Parameters (percentage adjustments relative to base)
  const [matDeltaPct, setMatDeltaPct] = useState<number>(0);     // Material price change %
  const [labDeltaPct, setLabDeltaPct] = useState<number>(0);     // Labor wage change %
  const [priceDeltaPct, setPriceDeltaPct] = useState<number>(0); // Selling price change %
  const [volDeltaPct, setVolDeltaPct] = useState<number>(0);     // Sales volume change %
  const [fixedDeltaPct, setFixedDeltaPct] = useState<number>(0); // Fixed overhead change %

  // Base values from active configuration & actuals
  const basePrice = config.hargaJualanSebenar > 0 ? config.hargaJualanSebenar : config.hargaJualanStandard;
  const baseVolume = config.kuantitiSebenarDijual > 0 ? config.kuantitiSebenarDijual : config.sasaranKuantitiStandard;
  const baseMatCost = actSummary.bahanMentahSemangkuk;
  const baseLabCost = actSummary.buruhLangsungSemangkuk;
  const baseVohCost = actSummary.overheadBerubahSemangkuk;
  const baseFixedCost = actSummary.jumlahKosTetapMingguan;

  const baseUnitVarCost = baseMatCost + baseLabCost + baseVohCost;
  const baseCM = basePrice - baseUnitVarCost;
  const baseCMRatio = basePrice > 0 ? (baseCM / basePrice) * 100 : 0;
  const baseRevenue = baseVolume * basePrice;
  const baseTotalVarCost = baseVolume * baseUnitVarCost;
  const baseNetProfit = baseRevenue - baseTotalVarCost - baseFixedCost;
  const baseBEP = kiraAnalisisBEP(baseFixedCost, basePrice, baseUnitVarCost, baseVolume);

  // Simulated values
  const simMatCost = baseMatCost * (1 + matDeltaPct / 100);
  const simLabCost = baseLabCost * (1 + labDeltaPct / 100);
  const simVohCost = baseVohCost;
  const simUnitVarCost = Math.max(0.01, simMatCost + simLabCost + simVohCost);

  const simPrice = Math.max(0.01, basePrice * (1 + priceDeltaPct / 100));
  const simVolume = Math.max(1, Math.round(baseVolume * (1 + volDeltaPct / 100)));
  const simFixedCost = Math.max(0, baseFixedCost * (1 + fixedDeltaPct / 100));

  const simCM = simPrice - simUnitVarCost;
  const simCMRatio = simPrice > 0 ? (simCM / simPrice) * 100 : 0;
  const simRevenue = simVolume * simPrice;
  const simTotalVarCost = simVolume * simUnitVarCost;
  const simNetProfit = simRevenue - simTotalVarCost - simFixedCost;
  const simBEP = kiraAnalisisBEP(simFixedCost, simPrice, simUnitVarCost, simVolume);

  // Deltas
  const profitDiff = simNetProfit - baseNetProfit;
  const bepUnitDiff = simBEP.bepMangkuk - baseBEP.bepMangkuk;
  const cmDiff = simCM - baseCM;

  // Preset triggers
  const applyPreset = (preset: "inflation" | "wageHike" | "promoDrive" | "priceHike" | "reset") => {
    switch (preset) {
      case "inflation":
        setMatDeltaPct(10);
        setLabDeltaPct(5);
        setPriceDeltaPct(0);
        setVolDeltaPct(0);
        setFixedDeltaPct(5);
        break;
      case "wageHike":
        setMatDeltaPct(0);
        setLabDeltaPct(15);
        setPriceDeltaPct(0);
        setVolDeltaPct(0);
        setFixedDeltaPct(0);
        break;
      case "promoDrive":
        setMatDeltaPct(0);
        setLabDeltaPct(5);
        setPriceDeltaPct(-10);
        setVolDeltaPct(30);
        setFixedDeltaPct(0);
        break;
      case "priceHike":
        setMatDeltaPct(0);
        setLabDeltaPct(0);
        setPriceDeltaPct(8);
        setVolDeltaPct(-5);
        setFixedDeltaPct(0);
        break;
      case "reset":
        setMatDeltaPct(0);
        setLabDeltaPct(0);
        setPriceDeltaPct(0);
        setVolDeltaPct(0);
        setFixedDeltaPct(0);
        break;
    }
  };

  const handleApplyToWorksheet = () => {
    if (!onApplySimulation) {
      setAppliedNotice(lang === "en" ? "Apply function not connected." : "Fungsi pengemaskinian tidak disambungkan.");
      setTimeout(() => setAppliedNotice(""), 3500);
      return;
    }
    
    onApplySimulation({
      hargaJualanStandard: Number(simPrice.toFixed(2)),
      hargaJualanSebenar: Number(simPrice.toFixed(2)),
      sasaranKuantitiStandard: simVolume,
      kuantitiSebenarDijual: simVolume,
    });
    setAppliedNotice(
      lang === "en" 
        ? `Applied price (${f(simPrice)}) and volume (${fNum(simVolume)} ${unitLabel}) to active worksheet!` 
        : `Harga (${f(simPrice)}) dan volum (${fNum(simVolume)} ${unitLabel}) berjaya diaplikasikan ke lembaran aktif!`
    );
    setTimeout(() => setAppliedNotice(""), 4500);
  };

  const handleCopyReport = () => {
    const reportText = `================================================
SMARTCOST — MANAGERIAL WHAT-IF SIMULATION REPORT
Company: ${config.namaSyarikat}
Product: ${config.namaProduk}
Date: ${new Date().toLocaleDateString()}
================================================
SIMULATION ADJUSTMENTS:
- Material Cost Shift: ${matDeltaPct >= 0 ? `+${matDeltaPct}%` : `${matDeltaPct}%`}
- Labor Wage Shift: ${labDeltaPct >= 0 ? `+${labDeltaPct}%` : `${labDeltaPct}%`}
- Selling Price Shift: ${priceDeltaPct >= 0 ? `+${priceDeltaPct}%` : `${priceDeltaPct}%`}
- Sales Volume Shift: ${volDeltaPct >= 0 ? `+${volDeltaPct}%` : `${volDeltaPct}%`}
- Fixed Overhead Shift: ${fixedDeltaPct >= 0 ? `+${fixedDeltaPct}%` : `${fixedDeltaPct}%`}

METRICS COMPARISON:
- Selling Price: Baseline ${f(basePrice)} -> Simulated ${f(simPrice)}
- Variable Cost / Unit: Baseline ${f(baseUnitVarCost)} -> Simulated ${f(simUnitVarCost)}
- Unit Contribution Margin: Baseline ${f(baseCM)} -> Simulated ${f(simCM)} (${simCMRatio.toFixed(1)}%)
- Break-Even Sales: Baseline ${fNum(baseBEP.bepMangkuk)} ${unitLabel} -> Simulated ${fNum(simBEP.bepMangkuk)} ${unitLabel}
- Weekly Net Profit: Baseline ${f(baseNetProfit)} -> Simulated ${f(simNetProfit)} (Diff: ${profitDiff >= 0 ? `+${f(profitDiff)}` : `-${f(Math.abs(profitDiff))}`})
================================================
Generated by SmartCost Business Intelligence`;

    navigator.clipboard.writeText(reportText);
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2500);
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Applied Notice Banner */}
      {appliedNotice && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-xl text-xs font-bold flex items-center gap-2 animate-fadeIn">
          <Info className="w-4 h-4 text-emerald-600" />
          <span>{appliedNotice}</span>
        </div>
      )}

      {/* 1. EXECUTIVE HEADER BANNER */}
      <section className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200/90 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] font-mono font-bold text-slate-500 uppercase tracking-wider">
            <Sliders className="w-3.5 h-3.5 text-blue-600" />
            <span>{lang === "en" ? "Price & Profit Simulation" : "Simulasi Harga & Untung Bersih"}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-display font-extrabold text-slate-900 tracking-tight">
            {lang === "en" ? "Price & Margin Simulation" : "Simulasi Harga & Sensitiviti Margin"}
          </h2>
          <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
            {lang === "en"
              ? "Simulate changes in material costs, wages, selling price, and sales volume to see profit impact."
              : "Simulasi perubahan kos bahan mentah, upah pekerja, harga jualan, dan kuantiti untuk melihat kesannya terhadap untung anda."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onApplySimulation && (
            <button
              onClick={handleApplyToWorksheet}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs hover:shadow"
            >
              <span>{lang === "en" ? "Apply to Worksheet" : "Gunakan ke Lembaran"}</span>
            </button>
          )}

          <button
            onClick={handleCopyReport}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
          >
            <span>{copiedReport ? (lang === "en" ? "Copied!" : "Disalin!") : (lang === "en" ? "Copy Report" : "Salin Laporan")}</span>
          </button>

          <button
            onClick={() => applyPreset("reset")}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border border-slate-200 shadow-2xs"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
            <span>{lang === "en" ? "Reset" : "Set Semula"}</span>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
              title={lang === "en" ? "Close" : "Tutup"}
            >
              <X className="w-4 h-4 text-slate-300" />
              <span>{lang === "en" ? "Close" : "Tutup"}</span>
            </button>
          )}
        </div>
      </section>

      {/* 2. ONE-CLICK STRATEGIC PRESETS */}
      <section className="flex flex-wrap items-center gap-2 p-3 bg-white border border-slate-200/90 rounded-xl shadow-2xs">
        <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider pl-1">
          {lang === "en" ? "Stress Presets:" : "Pintas Senario:"}
        </span>
        <button
          onClick={() => applyPreset("inflation")}
          className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold border border-slate-200 transition-all cursor-pointer"
        >
          {lang === "en" ? "Inflation (+10% Mat)" : "Inflasi Bahan (+10%)"}
        </button>
        <button
          onClick={() => applyPreset("wageHike")}
          className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold border border-slate-200 transition-all cursor-pointer"
        >
          {lang === "en" ? "Wage Hike (+15% Wages)" : "Gaji Minimum (+15%)"}
        </button>
        <button
          onClick={() => applyPreset("promoDrive")}
          className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold border border-slate-200 transition-all cursor-pointer"
        >
          {lang === "en" ? "Promo (-10% Price, +30% Vol)" : "Kempen Diskaun (-10% Harga, +30% Unit)"}
        </button>
        <button
          onClick={() => applyPreset("priceHike")}
          className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold border border-slate-200 transition-all cursor-pointer"
        >
          {lang === "en" ? "Protect Margin (+8% Price, -5% Vol)" : "Lindung Margin (+8% Harga, -5% Unit)"}
        </button>
      </section>

      {/* 3. SIMULATOR CONTROLS & COMPARATIVE KPI GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Controls Column (5 Cols) */}
        <section className="lg:col-span-5 bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-blue-600" />
              <span>{lang === "en" ? "Sensitivity Levers" : "Tuas Pelarasan Sensitiviti"}</span>
            </h3>
            <span className="text-[10px] font-mono text-slate-400">Interaktif</span>
          </div>

          {/* Lever 1: Material Price Change % */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-blue-600" />
                <span>{lang === "en" ? "Direct Material Cost Shift" : "Kos Bahan Mentah Langsung"}</span>
              </span>
              <span className={`font-mono font-bold text-xs px-2 py-0.5 rounded ${
                matDeltaPct > 0 ? "bg-rose-100 text-rose-800" : matDeltaPct < 0 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"
              }`}>
                {matDeltaPct >= 0 ? `+${matDeltaPct}%` : `${matDeltaPct}%`}
              </span>
            </div>
            <input
              type="range"
              min="-20"
              max="40"
              step="1"
              value={matDeltaPct}
              onChange={(e) => setMatDeltaPct(parseInt(e.target.value))}
              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-400">
              <span>-20%</span>
              <span>Asas (0%)</span>
              <span>+40%</span>
            </div>
          </div>

          {/* Lever 2: Direct Labor Wage Change % */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-600" />
                <span>{lang === "en" ? "Direct Labor Wage Rate Shift" : "Kadar Upah Buruh Langsung"}</span>
              </span>
              <span className={`font-mono font-bold text-xs px-2 py-0.5 rounded ${
                labDeltaPct > 0 ? "bg-rose-100 text-rose-800" : labDeltaPct < 0 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"
              }`}>
                {labDeltaPct >= 0 ? `+${labDeltaPct}%` : `${labDeltaPct}%`}
              </span>
            </div>
            <input
              type="range"
              min="-20"
              max="40"
              step="1"
              value={labDeltaPct}
              onChange={(e) => setLabDeltaPct(parseInt(e.target.value))}
              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-amber-600"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-400">
              <span>-20%</span>
              <span>Asas (0%)</span>
              <span>+40%</span>
            </div>
          </div>

          {/* Lever 3: Selling Price Change % */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                <span>{lang === "en" ? "Selling Price Adjustment" : "Pelarasan Harga Jualan"}</span>
              </span>
              <span className={`font-mono font-bold text-xs px-2 py-0.5 rounded ${
                priceDeltaPct > 0 ? "bg-emerald-100 text-emerald-800" : priceDeltaPct < 0 ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-700"
              }`}>
                {priceDeltaPct >= 0 ? `+${priceDeltaPct}%` : `${priceDeltaPct}%`}
              </span>
            </div>
            <input
              type="range"
              min="-20"
              max="30"
              step="1"
              value={priceDeltaPct}
              onChange={(e) => setPriceDeltaPct(parseInt(e.target.value))}
              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-400">
              <span>-20%</span>
              <span>Asas (0%)</span>
              <span>+30%</span>
            </div>
          </div>

          {/* Lever 4: Sales Volume Change % */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-sky-600" />
                <span>{lang === "en" ? "Sales Volume Adjustment" : "Jumlah Jualan (Kuantiti)"}</span>
              </span>
              <span className={`font-mono font-bold text-xs px-2 py-0.5 rounded ${
                volDeltaPct > 0 ? "bg-sky-100 text-sky-800" : volDeltaPct < 0 ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-700"
              }`}>
                {volDeltaPct >= 0 ? `+${volDeltaPct}%` : `${volDeltaPct}%`}
              </span>
            </div>
            <input
              type="range"
              min="-40"
              max="60"
              step="5"
              value={volDeltaPct}
              onChange={(e) => setVolDeltaPct(parseInt(e.target.value))}
              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-sky-600"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-400">
              <span>-40%</span>
              <span>Asas (0%)</span>
              <span>+60%</span>
            </div>
          </div>

          {/* Lever 5: Fixed Costs Change % */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                <Scale className="w-3.5 h-3.5 text-slate-600" />
                <span>{lang === "en" ? "Fixed Overhead Variance" : "Kos Tetap Mingguan"}</span>
              </span>
              <span className={`font-mono font-bold text-xs px-2 py-0.5 rounded ${
                fixedDeltaPct > 0 ? "bg-rose-100 text-rose-800" : fixedDeltaPct < 0 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"
              }`}>
                {fixedDeltaPct >= 0 ? `+${fixedDeltaPct}%` : `${fixedDeltaPct}%`}
              </span>
            </div>
            <input
              type="range"
              min="-20"
              max="30"
              step="5"
              value={fixedDeltaPct}
              onChange={(e) => setFixedDeltaPct(parseInt(e.target.value))}
              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-600"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-400">
              <span>-20%</span>
              <span>Asas (0%)</span>
              <span>+30%</span>
            </div>
          </div>
        </section>

        {/* Results & Delta Matrix Column (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Forecast Impact Card */}
          <section className="bg-slate-900 rounded-xl p-5 sm:p-6 text-white border border-slate-800 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-[10px] font-mono tracking-wider text-slate-400 uppercase block font-semibold">
                  {lang === "en" ? "SIMULATED NET OPERATING PROFIT" : "PROJEKSI UNTUNG BERSIH MINGGUAN"}
                </span>
                <div className="text-2xl sm:text-3xl font-display font-extrabold tracking-tight font-mono tabular-nums mt-0.5">
                  {f(simNetProfit)}
                </div>
              </div>

              <div className="sm:text-right">
                <span className="text-[10px] font-mono tracking-wider text-slate-400 uppercase block font-semibold">
                  {lang === "en" ? "NET PROFIT IMPACT (DELTA)" : "PERUBAHAN UNTUNG BERSIH"}
                </span>
                <div className={`text-xl sm:text-2xl font-display font-extrabold font-mono tabular-nums mt-0.5 flex items-center sm:justify-end gap-1.5 ${
                  profitDiff >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}>
                  {profitDiff >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                  <span>{profitDiff >= 0 ? `+${f(profitDiff)}` : `-${f(Math.abs(profitDiff))}`}</span>
                </div>
              </div>
            </div>

            {/* Quick Context Summary */}
            <div className="pt-3 border-t border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase">Harga Simulasi</span>
                <span className="font-bold text-white tabular-nums">{f(simPrice)}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase">Kos Seunit</span>
                <span className="font-bold text-white tabular-nums">{f(simUnitVarCost)}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase">Unit CM</span>
                <span className="font-bold text-sky-300 tabular-nums">{f(simCM)} ({simCMRatio.toFixed(1)}%)</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase">Kuantiti</span>
                <span className="font-bold text-white tabular-nums">{fNum(simVolume)} {unitLabel}</span>
              </div>
            </div>
          </section>

          {/* Comparative Baseline vs Simulation Table */}
          <section className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden">
            <div className="p-4 border-b border-slate-200/80 bg-slate-50/60 flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-900">
                {lang === "en" ? "Baseline vs. Simulated Performance Metrics" : "Perbandingan Metrik Asas Lwn Simulasi"}
              </h4>
              <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200/60">
                {config.namaProduk}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] font-mono text-slate-500 uppercase bg-slate-50/40">
                    <th className="py-2.5 px-4">{lang === "en" ? "Financial Indicator" : "Penunjuk Kewangan"}</th>
                    <th className="py-2.5 px-3 text-right">{lang === "en" ? "Current Baseline" : "Asas Semasa"}</th>
                    <th className="py-2.5 px-3 text-right">{lang === "en" ? "Simulated" : "Simulasi"}</th>
                    <th className="py-2.5 px-4 text-right">{lang === "en" ? "Variance Delta" : "Perbezaan"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  <tr className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-4 font-sans font-semibold text-slate-800">
                      {lang === "en" ? "Selling Price per Unit" : "Harga Jualan Seunit"}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">{f(basePrice)}</td>
                    <td className="py-2.5 px-3 text-right font-bold text-slate-900 tabular-nums">{f(simPrice)}</td>
                    <td className={`py-2.5 px-4 text-right font-bold tabular-nums ${simPrice >= basePrice ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {simPrice >= basePrice ? `+${f(simPrice - basePrice)}` : `-${f(basePrice - simPrice)}`}
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-4 font-sans font-semibold text-slate-800">
                      {lang === "en" ? "Variable Cost per Unit" : "Kos Berubah Seunit"}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">{f(baseUnitVarCost)}</td>
                    <td className="py-2.5 px-3 text-right font-bold text-slate-900 tabular-nums">{f(simUnitVarCost)}</td>
                    <td className={`py-2.5 px-4 text-right font-bold tabular-nums ${simUnitVarCost <= baseUnitVarCost ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {simUnitVarCost <= baseUnitVarCost ? `-${f(baseUnitVarCost - simUnitVarCost)}` : `+${f(simUnitVarCost - baseUnitVarCost)}`}
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-4 font-sans font-semibold text-slate-800">
                      {lang === "en" ? "Unit Contribution Margin (CM)" : "Margin Caruman Seunit"}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">{f(baseCM)}</td>
                    <td className="py-2.5 px-3 text-right font-bold text-blue-700 tabular-nums">{f(simCM)}</td>
                    <td className={`py-2.5 px-4 text-right font-bold tabular-nums ${cmDiff >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {cmDiff >= 0 ? `+${f(cmDiff)}` : `-${f(Math.abs(cmDiff))}`}
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-4 font-sans font-semibold text-slate-800">
                      {lang === "en" ? "Contribution Margin Ratio (%)" : "Nisbah Margin Caruman (%)"}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">{baseCMRatio.toFixed(1)}%</td>
                    <td className="py-2.5 px-3 text-right font-bold text-slate-900 tabular-nums">{simCMRatio.toFixed(1)}%</td>
                    <td className={`py-2.5 px-4 text-right font-bold tabular-nums ${simCMRatio >= baseCMRatio ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {(simCMRatio - baseCMRatio).toFixed(1)}%
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-4 font-sans font-semibold text-slate-800">
                      {lang === "en" ? "Break-Even Sales Units (BEP)" : "Titik Pulang Modal (Unit)"}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">{fNum(baseBEP.bepMangkuk)}</td>
                    <td className="py-2.5 px-3 text-right font-bold text-slate-900 tabular-nums">{fNum(simBEP.bepMangkuk)}</td>
                    <td className={`py-2.5 px-4 text-right font-bold tabular-nums ${bepUnitDiff <= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {bepUnitDiff <= 0 ? `${fNum(bepUnitDiff)} ${unitLabel}` : `+${fNum(bepUnitDiff)} ${unitLabel}`}
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-4 font-sans font-semibold text-slate-800">
                      {lang === "en" ? "Margin of Safety Buffer (%)" : "Margin Keselamatan (%)"}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">{baseBEP.marginKeselamatanPeratus.toFixed(1)}%</td>
                    <td className="py-2.5 px-3 text-right font-bold text-slate-900 tabular-nums">{simBEP.marginKeselamatanPeratus.toFixed(1)}%</td>
                    <td className={`py-2.5 px-4 text-right font-bold tabular-nums ${simBEP.marginKeselamatanPeratus >= baseBEP.marginKeselamatanPeratus ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {(simBEP.marginKeselamatanPeratus - baseBEP.marginKeselamatanPeratus).toFixed(1)}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Strategic Management Insights */}
          <div className="p-4 bg-slate-50 border border-slate-200/90 rounded-xl flex items-start gap-3 text-xs text-slate-700 shadow-2xs">
            <Info className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h5 className="font-bold text-slate-900 text-xs">
                {lang === "en" ? "Corporate Financial Controller Advisory" : "Nasihat Kawalan Kewangan & Pengurusan"}
              </h5>
              <p className="leading-relaxed text-[11px] text-slate-600">
                {simNetProfit < 0 ? (
                  <span className="text-rose-700 font-semibold">
                    {lang === "en"
                      ? "⚠️ Danger: This simulation pushes the business below its break-even point into an operating deficit! Immediate price pass-through or material substitution is required."
                      : "⚠️ Amaran: Simulasi ini menyebabkan perniagaan beroperasi di bawah titik pulang modal (mengalami kerugian bersih)! Pelarasan harga jualan atau rundingan kos pembekal amat kritikal."}
                  </span>
                ) : profitDiff >= 0 ? (
                  <span>
                    {lang === "en"
                      ? "✅ Resilient Scenario: Operating profit expands by " + f(profitDiff) + ". Break-even point shifts favorably to " + fNum(simBEP.bepMangkuk) + " units."
                      : "✅ Senario Berdaya Maju: Keuntungan bersih meningkat sebanyak " + f(profitDiff) + ". Titik pulang modal bertambah baik kepada " + fNum(simBEP.bepMangkuk) + " unit."}
                  </span>
                ) : (
                  <span>
                    {lang === "en"
                      ? "⚠️ Compression Alert: Net profits compress by " + f(Math.abs(profitDiff)) + ". To maintain your baseline margin, consider raising selling price by " + ((Math.abs(profitDiff) / (simVolume || 1)) / (simPrice || 1) * 100).toFixed(1) + "%."
                      : "⚠️ Pengurangan Margin: Untung bersih menguncup sebanyak " + f(Math.abs(profitDiff)) + ". Untuk mengekalkan margin asal, pertimbangkan pelarasan harga jualan atau pengurangan pembaziran bahan mentah."}
                  </span>
                )}
              </p>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
