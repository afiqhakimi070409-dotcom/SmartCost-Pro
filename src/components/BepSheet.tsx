/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { KonfigurasiSistem } from "../types";
import { RingkasanKos, kiraAnalisisBEP } from "../utils/costCalculations";
import { Calculator, Target, HelpCircle, CheckCircle2, AlertCircle, Sparkles, Scale, TrendingUp, DollarSign } from "lucide-react";
import { Language, getTranslation, getStoredLanguage, formatLocalizedNumber, formatUnitLabel } from "../utils/i18n";
import { 
  FINANCIAL_COLORS, 
  formatCurrencyRM 
} from "../utils/financialColors";

interface BepSheetProps {
  config: KonfigurasiSistem;
  stdSummary: RingkasanKos;
  actSummary: RingkasanKos;
  systemLang?: Language;
}

export default function BepSheet({ config, stdSummary, actSummary, systemLang }: BepSheetProps) {
  const lang: Language = systemLang || config.language || getStoredLanguage();
  const t = getTranslation(lang);
  const f = (val: number) => formatCurrencyRM(val, config.currency || "RM");
  const fNum = (val: number) => formatLocalizedNumber(val, lang, { maximumFractionDigits: 0 });
  const unitLabel = formatUnitLabel(config.unitProduk, lang);

  // Inputs for target profit calculator
  const [targetProfit, setTargetProfit] = useState<number>(1200);

  // Compute BEP for Standard
  const stdBEP = kiraAnalisisBEP(
    stdSummary.jumlahKosTetapMingguan,
    config.hargaJualanStandard,
    stdSummary.jumlahKosBerubahSemangkuk,
    config.sasaranKuantitiStandard,
    lang
  );

  // Compute BEP for Actual
  const actBEP = kiraAnalisisBEP(
    actSummary.jumlahKosTetapMingguan,
    config.hargaJualanSebenar,
    actSummary.jumlahKosBerubahSemangkuk,
    config.kuantitiSebenarDijual,
    lang
  );

  // Calculate Target Profit Units
  const targetUnitsStd = stdBEP.marginCarumanMangkuk > 0 
    ? Math.ceil((stdBEP.kosTetap + targetProfit) / stdBEP.marginCarumanMangkuk)
    : 0;

  const targetUnitsAct = actBEP.marginCarumanMangkuk > 0 
    ? Math.ceil((actBEP.kosTetap + targetProfit) / actBEP.marginCarumanMangkuk)
    : 0;

  return (
    <div className="space-y-6 sm:space-y-8 animate-fadeIn">
      
      {/* 1. EXECUTIVE HEADER */}
      <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="screen-title text-slate-900 tracking-tight flex items-center gap-2">
            <Scale className="w-5 h-5 text-sky-600" />
            <span>{t.bep.title}</span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 max-w-2xl leading-relaxed">
            {lang === "en"
              ? `Determine the minimum weekly sales volume of ${unitLabel} for ${config.namaProduk} required to cover all fixed and variable expenses before generating net operating profits.`
              : `Menentukan jumlah jualan ${unitLabel} ${config.namaProduk} minimum seminggu yang diperlukan untuk menyamai segala kos sebelum mula mendapat untung.`}
          </p>
        </div>
      </div>

      {/* 2. SIDE-BY-SIDE COMPARISON: STANDARD VS ACTUAL BEP */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
        
        {/* STANDARD BEP CARD */}
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs p-5 sm:p-7 space-y-6 relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50/50 rounded-bl-full pointer-events-none"></div>
          <div>
            <span className="text-[11px] font-mono font-bold text-[#0b3c7a] uppercase tracking-wider block">
              {lang === "en" ? "STANDARD BUDGET BASELINE" : "BAJET STANDARD"}
            </span>
            <h3 className="text-xl font-display font-extrabold text-slate-900 mt-1">
              {lang === "en" ? "Budgeted Break-Even Point" : "Titik Pulang Modal Standard"}
            </h3>
          </div>

          {stdBEP.isAttainable ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-100">
                <span className="text-[10px] text-slate-500 block font-mono font-bold uppercase tracking-wider">{t.bep.bepUnits}</span>
                <span className="text-3xl font-display font-extrabold text-[#0b3c7a] font-mono tabular-nums">
                  {fNum(stdBEP.bepMangkuk)} <span className="text-xs font-normal text-slate-500 font-sans">{unitLabel}</span>
                </span>
              </div>
              <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-100">
                <span className="text-[10px] text-slate-500 block font-mono font-bold uppercase tracking-wider">{t.bep.bepRevenue}</span>
                <span className="text-3xl font-display font-extrabold text-slate-800 font-mono tabular-nums">
                  {f(stdBEP.bepRM)}
                </span>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-900 space-y-1">
              <div className="flex items-center gap-2 font-bold text-xs">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{lang === "en" ? "Break-Even Point Unattainable" : "Titik Pulang Modal Tidak Dapat Dicapai"}</span>
              </div>
              <p className="text-[11px] leading-relaxed text-rose-700">{stdBEP.statusMessage}</p>
            </div>
          )}

          {/* Breakdown Steps */}
          <div className="space-y-3 border-t border-slate-100 pt-5 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">{lang === "en" ? "Selling Price per Unit (P)" : "Harga Jualan Seunit (A)"}</span>
              <span className="font-semibold text-slate-800 font-mono tabular-nums">{f(stdBEP.hargaJualanMangkuk)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">{lang === "en" ? "Variable Cost per Unit (V)" : "Kos Berubah Seunit (B)"}</span>
              <span className="font-semibold text-slate-800 font-mono tabular-nums">{f(stdBEP.kosBerubahMangkuk)}</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-dashed border-slate-200">
              <span className="text-slate-700 font-bold">{lang === "en" ? "Contribution Margin (P - V)" : "Margin Sumbangan Seunit (A - B)"}</span>
              <span className={`font-extrabold font-mono tabular-nums ${stdBEP.marginCarumanMangkuk > 0 ? "text-[#0b3c7a]" : "text-rose-600"}`}>
                {f(stdBEP.marginCarumanMangkuk)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">{lang === "en" ? "Total Weekly Fixed Costs (FC)" : "Jumlah Kos Tetap Mingguan (C)"}</span>
              <span className="font-semibold text-slate-800 font-mono tabular-nums">{f(stdBEP.kosTetap)}</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-dashed border-slate-200">
              <span className="text-slate-700 font-bold">{t.bep.marginOfSafety}</span>
              <span className="font-extrabold text-emerald-600 font-mono tabular-nums">
                {stdBEP.isAttainable 
                  ? `${stdBEP.marginKeselamatanPeratus.toFixed(1)}% (${fNum(stdBEP.marginKeselamatanUnit)} ${unitLabel})`
                  : (lang === "en" ? "N/A (Deficit Margin)" : "T/A (Margin Defisit)")}
              </span>
            </div>
          </div>
        </div>

        {/* ACTUAL BEP CARD */}
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs p-6 sm:p-7 space-y-6 relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50/50 rounded-bl-full pointer-events-none"></div>
          <div>
            <span className="text-[11px] font-mono font-bold text-emerald-700 uppercase tracking-wider block">
              {lang === "en" ? "ACTUAL REALIZED PERFORMANCE" : "PRESTASI SEBENAR"}
            </span>
            <h3 className="text-xl font-display font-extrabold text-slate-900 mt-1">
              {lang === "en" ? "Actual Realized Break-Even" : "Titik Pulang Modal Sebenar"}
            </h3>
          </div>

          {actBEP.isAttainable ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-emerald-50/40 rounded-2xl border border-emerald-100">
                <span className="text-[10px] text-emerald-700 block font-mono font-bold uppercase tracking-wider">{t.bep.bepUnits}</span>
                <span className="text-3xl font-display font-extrabold text-emerald-700 font-mono tabular-nums">
                  {fNum(actBEP.bepMangkuk)} <span className="text-xs font-normal text-slate-500 font-sans">{unitLabel}</span>
                </span>
              </div>
              <div className="p-4 bg-emerald-50/40 rounded-2xl border border-emerald-100">
                <span className="text-[10px] text-emerald-700 block font-mono font-bold uppercase tracking-wider">{t.bep.bepRevenue}</span>
                <span className="text-3xl font-display font-extrabold text-slate-800 font-mono tabular-nums">
                  {f(actBEP.bepRM)}
                </span>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-900 space-y-1">
              <div className="flex items-center gap-2 font-bold text-xs">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{lang === "en" ? "Break-Even Point Unattainable" : "Titik Pulang Modal Tidak Dapat Dicapai"}</span>
              </div>
              <p className="text-[11px] leading-relaxed text-rose-700">{actBEP.statusMessage}</p>
            </div>
          )}

          {/* Breakdown Steps */}
          <div className="space-y-3 border-t border-slate-100 pt-5 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">{lang === "en" ? "Selling Price per Unit (P)" : "Harga Jualan Seunit (A)"}</span>
              <span className="font-semibold text-slate-800 font-mono tabular-nums">{f(actBEP.hargaJualanMangkuk)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">{lang === "en" ? "Variable Cost per Unit (V)" : "Kos Berubah Seunit (B)"}</span>
              <span className="font-semibold text-slate-800 font-mono tabular-nums">{f(actBEP.kosBerubahMangkuk)}</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-dashed border-slate-200">
              <span className="text-slate-700 font-bold">{lang === "en" ? "Contribution Margin (P - V)" : "Margin Sumbangan Seunit (A - B)"}</span>
              <span className="font-extrabold text-emerald-700 font-mono tabular-nums">{f(actBEP.marginCarumanMangkuk)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">{lang === "en" ? "Total Weekly Fixed Costs (FC)" : "Jumlah Kos Tetap Mingguan (C)"}</span>
              <span className="font-semibold text-slate-800 font-mono tabular-nums">{f(actBEP.kosTetap)}</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-dashed border-slate-200">
              <span className="text-slate-700 font-bold">{t.bep.marginOfSafety}</span>
              <span 
                style={{
                  color: actBEP.marginKeselamatanPeratus > 0.0001 
                    ? FINANCIAL_COLORS.GREEN 
                    : Math.abs(actBEP.marginKeselamatanPeratus) <= 0.0001 
                    ? FINANCIAL_COLORS.AMBER 
                    : FINANCIAL_COLORS.RED
                }}
                className="font-extrabold font-mono tabular-nums"
              >
                {actBEP.marginKeselamatanPeratus.toFixed(1)}% ({fNum(actBEP.marginKeselamatanUnit)} {unitLabel})
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* 3. FORMULA EXPLANATION CARD */}
      <div className="bg-slate-50 rounded-3xl border border-slate-200/80 p-6 sm:p-7">
        <h4 className="text-sm font-display font-bold text-slate-900 mb-3 flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-[#0b3c7a]" />
          <span>{lang === "en" ? "How CVP & Break-Even Points are Formulated" : "Bagaimana Titik Pulang Modal dihitung?"}</span>
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600">
          <div className="space-y-1.5 p-4 bg-white rounded-2xl border border-slate-200/60 shadow-2xs">
            <span className="font-bold text-slate-900 block font-mono">
              {lang === "en" ? "1. UNIT CONTRIBUTION MARGIN (CM)" : "1. MARGIN SUMBANGAN SEUNIT"}
            </span>
            <code className="block bg-slate-50 p-2.5 rounded-xl border border-slate-200 font-mono text-[#0b3c7a] font-bold">
              {lang === "en" ? "Contribution Margin = Selling Price - Variable Cost" : "Margin Sumbangan = Harga Jualan - Kos Berubah"}
            </code>
            <p className="mt-1 leading-relaxed">
              {lang === "en" 
                ? "The revenue retained from each unit sold after paying direct materials, labor, and variable overheads that directly funds weekly fixed rent and utilities."
                : "Wang hasil jualan yang disumbang untuk membayar kos sewa/overhead tetap dan menjana untung bersih."}
            </p>
          </div>
          <div className="space-y-1.5 p-4 bg-white rounded-2xl border border-slate-200/60 shadow-2xs">
            <span className="font-bold text-slate-900 block font-mono">
              {lang === "en" ? "2. BREAK-EVEN SALES VOLUME" : "2. KUANTITI TITIK PULANG MODAL"}
            </span>
            <code className="block bg-slate-50 p-2.5 rounded-xl border border-slate-200 font-mono text-[#0b3c7a] font-bold">
              {lang === "en" ? "BEP (Units) = Total Fixed Costs / Unit Contribution Margin" : "Titik Pulang Modal (Unit) = Jumlah Kos Tetap / Margin Sumbangan"}
            </code>
            <p className="mt-1 leading-relaxed">
              {lang === "en"
                ? `The zero-profit volume threshold in ${unitLabel} required to guarantee the business never operates at a financial loss.`
                : `Bilangan unit (${unitLabel}) minimum yang wajib terjual dalam seminggu agar tidak rugi.`}
            </p>
          </div>
        </div>
      </div>

      {/* 4. INTERACTIVE TARGET PROFIT CALCULATOR */}
      <div className="bg-gradient-to-r from-blue-50/80 via-sky-50/50 to-indigo-50/80 border border-blue-200/80 rounded-3xl p-6 sm:p-7 relative overflow-hidden shadow-xs">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-5 h-5 text-blue-700 animate-pulse" />
          <h3 className="text-base font-display font-extrabold text-slate-900">
            {lang === "en"
              ? `Target Net Profit Simulator (${config.namaSyarikat})`
              : `Kalkulator Sasaran Untung Bersih (${config.namaSyarikat})`}
          </h3>
        </div>

        <p className="text-xs sm:text-sm text-slate-600 mb-6 max-w-xl leading-relaxed">
          {lang === "en"
            ? `Set your desired weekly profit target. The simulator computes the exact required sales volume in ${unitLabel} to achieve it under both standard and actual cost parameters.`
            : `Tentukan sasaran keuntungan bersih seminggu. Sistem akan mengira bilangan ${unitLabel} yang perlu dijual untuk mencapainya.`}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
          
          {/* Input field */}
          <div className="space-y-2">
            <label className="block text-[11px] font-mono font-bold tracking-wider text-slate-600 uppercase">
              {lang === "en" ? "TARGET NET OPERATING PROFIT" : "SASARAN UNTUNG BERSIH SEMINGGU"}
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500 font-mono text-sm font-bold">
                {config.currency}
              </span>
              <input
                type="number"
                value={targetProfit}
                onChange={(e) => setTargetProfit(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full pl-11 pr-4 py-3 bg-white border border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20 rounded-xl font-mono font-bold text-slate-900 text-base outline-hidden transition-all shadow-2xs"
              />
            </div>
          </div>

          {/* Result Std */}
          <div className="p-4 bg-white/90 backdrop-blur-xs rounded-2xl border border-blue-200/60 shadow-2xs space-y-1">
            <span className="text-[10px] font-mono text-slate-500 font-bold tracking-wider block uppercase">
              {lang === "en" ? "REQUIRED SALES (STANDARD)" : "JUALAN DIKENAKAN (STANDARD)"}
            </span>
            <div className="text-xl font-display font-extrabold text-slate-900 font-mono tabular-nums">
              {fNum(targetUnitsStd)} <span className="text-xs font-normal font-sans text-slate-500 capitalize">{unitLabel}</span>
            </div>
            <span className="text-[11px] font-mono text-slate-500 block tabular-nums">
              {lang === "en" ? "Target Revenue:" : "Hasil Jualan:"} {f(targetUnitsStd * config.hargaJualanStandard)}
            </span>
          </div>

          {/* Result Act */}
          <div className="p-4 bg-emerald-50/80 backdrop-blur-xs rounded-2xl border border-emerald-200/80 shadow-2xs space-y-1">
            <span className="text-[10px] font-mono text-emerald-800 font-bold tracking-wider block uppercase">
              {lang === "en" ? "REQUIRED SALES (ACTUAL)" : "JUALAN DIKENAKAN (SEBENAR)"}
            </span>
            <div className="text-xl font-display font-extrabold text-emerald-800 font-mono tabular-nums">
              {fNum(targetUnitsAct)} <span className="text-xs font-normal font-sans text-emerald-700 capitalize">{unitLabel}</span>
            </div>
            <span className="text-[11px] font-mono text-emerald-700 block tabular-nums">
              {lang === "en" ? "Target Revenue:" : "Hasil Jualan:"} {f(targetUnitsAct * config.hargaJualanSebenar)}
            </span>
          </div>

        </div>
      </div>

    </div>
  );
}
