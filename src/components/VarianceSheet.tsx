/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { BahanMentah, BuruhLangsung, OverheadBerubah, OverheadTetap, KonfigurasiSistem } from "../types";
import { 
  analisisVariansBahan, 
  analisisVariansBuruh, 
  analisisVariansOverheadBerubah, 
  analisisVariansOverheadTetap 
} from "../utils/costCalculations";
import { CheckCircle2, AlertOctagon, HelpCircle, Flame, ShieldAlert, BadgeCheck, Lightbulb, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Layers, Clock } from "lucide-react";
import { Language, getTranslation, getStoredLanguage, formatUnitLabel } from "../utils/i18n";
import { 
  FINANCIAL_COLORS, 
  formatCurrencyRM, 
  getVarianceStatus 
} from "../utils/financialColors";

interface VarianceSheetProps {
  config: KonfigurasiSistem;
  bahanMentah: BahanMentah[];
  buruhLangsung: BuruhLangsung[];
  overheadBerubah: OverheadBerubah[];
  overheadTetap: OverheadTetap[];
  systemLang?: Language;
}

export default function VarianceSheet({
  config,
  bahanMentah,
  buruhLangsung,
  overheadBerubah,
  overheadTetap,
  systemLang,
}: VarianceSheetProps) {
  const lang: Language = systemLang || config.language || getStoredLanguage();
  const t = getTranslation(lang);
  const f = (val: number) => formatCurrencyRM(val, config.currency || "RM");
  const fDiff = (val: number) => {
    if (Math.abs(val) <= 0.0001) return `${config.currency || "RM"} 0.00`;
    if (val > 0) return `+${formatCurrencyRM(val, config.currency || "RM")}`;
    return formatCurrencyRM(val, config.currency || "RM");
  };
  const unitLabel = formatUnitLabel(config.unitProduk, lang);

  const Q_act = config.kuantitiSebenarDijual;

  // Perform computations
  const variansBahanList = analisisVariansBahan(Q_act, bahanMentah);
  const variansBuruhList = analisisVariansBuruh(Q_act, buruhLangsung);
  const variansOHBList = analisisVariansOverheadBerubah(Q_act, overheadBerubah);
  const variansOHTList = analisisVariansOverheadTetap(overheadTetap);

  // Totals for summary cards
  const totalMPV = variansBahanList.reduce((sum, item) => sum + item.variansHarga, 0);
  const totalMQV = variansBahanList.reduce((sum, item) => sum + item.variansPenggunaan, 0);
  const totalDMV = variansBahanList.reduce((sum, item) => sum + item.variansJumlah, 0);

  const totalLRV = variansBuruhList.reduce((sum, item) => sum + item.variansKadar, 0);
  const totalLEV = variansBuruhList.reduce((sum, item) => sum + item.variansKecekapan, 0);
  const totalDLV = variansBuruhList.reduce((sum, item) => sum + item.variansJumlah, 0);

  const totalVOHV = variansOHBList.reduce((sum, item) => sum + item.variansSimbahan, 0);
  const totalFOHV = variansOHTList.reduce((sum, item) => sum + item.variansPerbelanjaan, 0);

  // Overarching Variances
  const totalNetVariance = totalDMV + totalDLV + totalVOHV + totalFOHV;

  // Direct Standard vs Actual Cost Comparisons for Executive Table
  const stdMatCost = variansBahanList.reduce((sum, item) => sum + item.kosStandardDibenarkan, 0);
  const actMatCost = variansBahanList.reduce((sum, item) => sum + item.kosSebenar, 0);
  const diffMatCost = actMatCost - stdMatCost;

  const stdLabCost = variansBuruhList.reduce((sum, item) => sum + item.kosStandardDibenarkan, 0);
  const actLabCost = variansBuruhList.reduce((sum, item) => sum + item.kosSebenar, 0);
  const diffLabCost = actLabCost - stdLabCost;

  const stdOHCost = variansOHBList.reduce((sum, item) => sum + item.kosStandardDibenarkan, 0) + variansOHTList.reduce((sum, item) => sum + item.stdKosMingguan, 0);
  const actOHCost = variansOHBList.reduce((sum, item) => sum + item.sebenarKosJumlah, 0) + variansOHTList.reduce((sum, item) => sum + item.sebenarKosJumlah, 0);
  const diffOHCost = actOHCost - stdOHCost;

  const totalStdProdCost = stdMatCost + stdLabCost + stdOHCost;
  const totalActProdCost = actMatCost + actLabCost + actOHCost;
  const diffTotalProdCost = totalActProdCost - totalStdProdCost;

  const Badge = ({ condition }: { condition: "F" | "U" }) => {
    if (condition === "F") {
      return (
        <span 
          style={{ 
            color: FINANCIAL_COLORS.GREEN, 
            borderColor: "rgba(22, 163, 74, 0.3)",
            backgroundColor: "rgba(22, 163, 74, 0.08)"
          }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-bold rounded-lg border shadow-2xs"
        >
          <BadgeCheck className="w-3.5 h-3.5 text-[#16A34A]" />
          <span>{lang === "en" ? "F (Favorable Variance)" : "F (Menguntungkan)"}</span>
        </span>
      );
    }
    return (
      <span 
        style={{ 
          color: FINANCIAL_COLORS.RED, 
          borderColor: "rgba(220, 38, 38, 0.3)",
          backgroundColor: "rgba(220, 38, 38, 0.08)"
        }}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-bold rounded-lg border shadow-2xs"
      >
        <ShieldAlert className="w-3.5 h-3.5 text-[#DC2626]" />
        <span>{lang === "en" ? "U (Unfavorable Variance)" : "U (Tidak Menguntungkan)"}</span>
      </span>
    );
  };

  const isNetFavorable = totalNetVariance < -0.0001;
  const isNetNeutral = Math.abs(totalNetVariance) <= 0.0001;

  return (
    <div className="space-y-6 sm:space-y-8 animate-fadeIn">
      {/* 1. EXECUTIVE HEADER BANNER */}
      <div className="bg-white dark:bg-[#132238] rounded-3xl p-5 sm:p-7 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-1">
          <h2 className="screen-title text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Flame className="w-5 h-5 text-amber-500" />
            <span>{t.variance.title}</span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-2xl leading-relaxed">
            {lang === "en"
              ? `Formal standard vs actual cost variance analysis comparing costs incurred against standard allowed budget for ${Q_act} ${unitLabel} sold.`
              : `Analisis perbezaan antara kos sebenar dengan kos piawai yang dibenarkan untuk jualan sebanyak ${Q_act} ${unitLabel}.`}
          </p>
        </div>

        {/* Big Overall Cost Status Pill */}
        <div 
          style={{
            backgroundColor: isNetFavorable ? "rgba(22, 163, 74, 0.1)" : isNetNeutral ? "rgba(217, 119, 6, 0.1)" : "rgba(220, 38, 38, 0.1)",
            borderColor: isNetFavorable ? "rgba(22, 163, 74, 0.35)" : isNetNeutral ? "rgba(217, 119, 6, 0.35)" : "rgba(220, 38, 38, 0.35)",
          }}
          className="p-5 rounded-2xl border flex items-center gap-5 shrink-0"
        >
          <div>
            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 font-bold block uppercase tracking-wider">
              {lang === "en" ? "Net Cost Variance" : "Jumlah perbezaan kos"}
            </span>
            <span 
              style={{
                color: isNetFavorable ? FINANCIAL_COLORS.GREEN : isNetNeutral ? FINANCIAL_COLORS.AMBER : FINANCIAL_COLORS.RED
              }}
              className="text-2xl font-display font-extrabold font-mono tabular-nums"
            >
              {fDiff(totalNetVariance)}
            </span>
          </div>
          <div className="border-l border-slate-200 dark:border-slate-700 pl-4">
            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 font-bold block uppercase tracking-wider">
              {lang === "en" ? "Overall Status" : "Status keseluruhan"}
            </span>
            <span 
              style={{
                color: isNetFavorable ? FINANCIAL_COLORS.GREEN : isNetNeutral ? FINANCIAL_COLORS.AMBER : FINANCIAL_COLORS.RED
              }}
              className="text-xs font-mono font-bold block uppercase mt-1"
            >
              {isNetFavorable
                ? (lang === "en" ? "FAVORABLE (SAVINGS)" : "MENGUNTUNGKAN (PENJIMATAN)") 
                : isNetNeutral
                ? (lang === "en" ? "MODERATE (ON BUDGET)" : "PRESTASI SEDERHANA (MENEPATI BAJET)")
                : (lang === "en" ? "UNFAVORABLE (OVER BUDGET)" : "TIDAK MENGUNTUNGKAN (LEBIH BAJET)")}
            </span>
          </div>
        </div>
      </div>

      {/* 2. FOUR SUMMARY METRIC CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* DMV Card */}
        <div className="p-5 bg-white dark:bg-[#132238] rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t.variance.directMaterialsTitle}</span>
            <Layers className="w-4 h-4 text-blue-600" />
          </div>
          <div 
            style={{
              color: totalDMV < -0.0001 ? FINANCIAL_COLORS.GREEN : Math.abs(totalDMV) <= 0.0001 ? FINANCIAL_COLORS.AMBER : FINANCIAL_COLORS.RED
            }}
            className="text-xl font-display font-extrabold font-mono tabular-nums"
          >
            {fDiff(totalDMV)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex justify-between font-mono pt-2 border-t border-slate-100 dark:border-slate-800">
            <span>MPV: {fDiff(totalMPV)}</span>
            <span>MQV: {fDiff(totalMQV)}</span>
          </div>
        </div>

        {/* DLV Card */}
        <div className="p-5 bg-white dark:bg-[#132238] rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t.variance.directLaborTitle}</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div 
            style={{
              color: totalDLV < -0.0001 ? FINANCIAL_COLORS.GREEN : Math.abs(totalDLV) <= 0.0001 ? FINANCIAL_COLORS.AMBER : FINANCIAL_COLORS.RED
            }}
            className="text-xl font-display font-extrabold font-mono tabular-nums"
          >
            {fDiff(totalDLV)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex justify-between font-mono pt-2 border-t border-slate-100 dark:border-slate-800">
            <span>LRV: {fDiff(totalLRV)}</span>
            <span>LEV: {fDiff(totalLEV)}</span>
          </div>
        </div>

        {/* Variable Overhead Card */}
        <div className="p-5 bg-white dark:bg-[#132238] rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t.variance.variableOverheadTitle}</span>
            <Flame className="w-4 h-4 text-emerald-600" />
          </div>
          <div 
            style={{
              color: totalVOHV < -0.0001 ? FINANCIAL_COLORS.GREEN : Math.abs(totalVOHV) <= 0.0001 ? FINANCIAL_COLORS.AMBER : FINANCIAL_COLORS.RED
            }}
            className="text-xl font-display font-extrabold font-mono tabular-nums"
          >
            {fDiff(totalVOHV)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono pt-2 border-t border-slate-100 dark:border-slate-800">
            {t.variance.variableOverheadSub}
          </div>
        </div>

        {/* Fixed Overhead Card */}
        <div className="p-5 bg-white dark:bg-[#132238] rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t.variance.fixedOverheadTitle}</span>
            <ShieldAlert className="w-4 h-4 text-sky-600" />
          </div>
          <div 
            style={{
              color: totalFOHV < -0.0001 ? FINANCIAL_COLORS.GREEN : Math.abs(totalFOHV) <= 0.0001 ? FINANCIAL_COLORS.AMBER : FINANCIAL_COLORS.RED
            }}
            className="text-xl font-display font-extrabold font-mono tabular-nums"
          >
            {fDiff(totalFOHV)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono pt-2 border-t border-slate-100 dark:border-slate-800">
            {t.variance.fixedOverheadSub}
          </div>
        </div>

      </div>

      {/* EXECUTIVE DIRECT COMPARISON TABLE (Standard vs Actual Production Costs) */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-slate-200/80 bg-slate-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#0b3c7a]"></span>
              <h3 className="font-display font-bold text-slate-900 text-base">
                {lang === "en" ? "Executive Production Cost Variance Summary" : "Ringkasan Perbandingan Kos Pengeluaran Piawai vs Sebenar"}
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === "en"
                ? `Direct comparison of standard budgeted production costs against actual costs incurred for ${Q_act} ${unitLabel}.`
                : `Perbandingan langsung antara kos piawai dengan kos sebenar yang dibelanjakan bagi volum ${Q_act} ${unitLabel}.`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-slate-500 font-bold uppercase">{lang === "en" ? "Net Status:" : "Status Bersih:"}</span>
            <Badge condition={diffTotalProdCost <= 0.005 ? "F" : "U"} />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-mono text-slate-500 uppercase bg-slate-100/70">
                <th className="py-3.5 px-5 font-bold">{lang === "en" ? "Cost Component" : "Komponen Kos Pengeluaran"}</th>
                <th className="py-3.5 px-4 font-bold text-right">{lang === "en" ? "Standard Cost" : "Kos Piawai"}</th>
                <th className="py-3.5 px-4 font-bold text-right">{lang === "en" ? "Actual Cost" : "Kos Sebenar"}</th>
                <th className="py-3.5 px-4 font-bold text-right">{lang === "en" ? "Cost Variance (Actual - Standard)" : "Perbezaan Kos (Sebenar - Piawai)"}</th>
                <th className="py-3.5 px-5 font-bold text-center w-36">{lang === "en" ? "Variance Flag" : "Penunjuk (F/U)"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono text-xs">
              {/* 1. Kos Bahan Mentah */}
              <tr className="hover:bg-slate-50/50 transition-colors">
                <td className="py-3.5 px-5 font-sans font-bold text-slate-800">
                  {lang === "en" ? "Direct Raw Materials" : "Bahan Mentah"}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums text-slate-700">
                  {f(stdMatCost)}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums text-slate-900 font-semibold">
                  {f(actMatCost)}
                </td>
                <td className={`py-3.5 px-4 text-right tabular-nums font-bold ${diffMatCost <= 0.005 ? "text-emerald-700" : "text-rose-700"}`}>
                  {fDiff(diffMatCost)}
                </td>
                <td className="py-3.5 px-5 text-center">
                  <Badge condition={diffMatCost <= 0.005 ? "F" : "U"} />
                </td>
              </tr>

              {/* 2. Kos Upah Pekerja / Buruh Langsung */}
              <tr className="hover:bg-slate-50/50 transition-colors">
                <td className="py-3.5 px-5 font-sans font-bold text-slate-800">
                  {lang === "en" ? "Direct Labour" : "Upah Pekerja (Buruh Langsung)"}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums text-slate-700">
                  {f(stdLabCost)}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums text-slate-900 font-semibold">
                  {f(actLabCost)}
                </td>
                <td className={`py-3.5 px-4 text-right tabular-nums font-bold ${diffLabCost <= 0.005 ? "text-emerald-700" : "text-rose-700"}`}>
                  {fDiff(diffLabCost)}
                </td>
                <td className="py-3.5 px-5 text-center">
                  <Badge condition={diffLabCost <= 0.005 ? "F" : "U"} />
                </td>
              </tr>

              {/* 3. Kos Overhed */}
              <tr className="hover:bg-slate-50/50 transition-colors">
                <td className="py-3.5 px-5 font-sans font-bold text-slate-800">
                  {lang === "en" ? "Total Overhead (Variable & Fixed)" : "Overhed Pengeluaran (Berubah & Tetap)"}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums text-slate-700">
                  {f(stdOHCost)}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums text-slate-900 font-semibold">
                  {f(actOHCost)}
                </td>
                <td className={`py-3.5 px-4 text-right tabular-nums font-bold ${diffOHCost <= 0.005 ? "text-emerald-700" : "text-rose-700"}`}>
                  {fDiff(diffOHCost)}
                </td>
                <td className="py-3.5 px-5 text-center">
                  <Badge condition={diffOHCost <= 0.005 ? "F" : "U"} />
                </td>
              </tr>

              {/* 4. Jumlah Kos Pengeluaran */}
              <tr className="bg-slate-100/70 font-bold text-sm border-t-2 border-slate-300">
                <td className="py-4 px-5 font-sans text-slate-950 uppercase tracking-tight">
                  {lang === "en" ? "Total Production Cost" : "Jumlah Kos Pengeluaran"}
                </td>
                <td className="py-4 px-4 text-right tabular-nums text-slate-900">
                  {f(totalStdProdCost)}
                </td>
                <td className="py-4 px-4 text-right tabular-nums text-slate-950">
                  {f(totalActProdCost)}
                </td>
                <td className={`py-4 px-4 text-right tabular-nums text-base ${diffTotalProdCost <= 0.005 ? "text-emerald-700" : "text-rose-700"}`}>
                  {fDiff(diffTotalProdCost)}
                </td>
                <td className="py-4 px-5 text-center">
                  <Badge condition={diffTotalProdCost <= 0.005 ? "F" : "U"} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. SECTION 1: BAHAN MENTAH LANGSUNG VARIANS */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-slate-200/80 bg-slate-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-display font-bold text-slate-900 text-base">
              {lang === "en" ? "1. Direct Material Variances (DMV)" : "1. Perbezaan Kos Bahan Mentah"}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === "en"
                ? "Purchasing rate efficiency (Material Price Variance) & kitchen yield/portion efficiency (Material Quantity/Usage Variance)."
                : "Mengukur perbezaan harga belian bahan dan perbezaan penggunaan sukatan resipi."}
            </p>
          </div>
          <span className={`px-3 py-1.5 text-xs font-mono font-bold rounded-xl border shrink-0 ${totalDMV <= 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
            {lang === "en" ? "Total DMV:" : "Jumlah Perbezaan Bahan:"} {fDiff(totalDMV)}
          </span>
        </div>

        {/* Desktop Table View */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead>
              <tr className="border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-mono text-slate-500 uppercase bg-slate-50/40 dark:bg-slate-800/40">
                <th className="py-3.5 px-6 font-semibold">{lang === "en" ? "Raw Material" : "Bahan Mentah"}</th>
                <th className="py-3.5 px-4 font-semibold text-center">{lang === "en" ? "Price Variance (MPV)" : "Perbezaan Harga"}</th>
                <th className="py-3.5 px-4 font-semibold text-center">{lang === "en" ? "Usage Variance (MQV)" : "Perbezaan Penggunaan"}</th>
                <th className="py-3.5 px-4 font-semibold text-right">{lang === "en" ? "Total Material Variance" : "Jumlah Perbezaan Bahan"}</th>
                <th className="py-3.5 px-6 text-center w-36">{t.common.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {variansBahanList.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="py-4 px-6 font-medium text-slate-800 dark:text-slate-200">
                    <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">{item.nama}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                      {t.actualSheet.stdLabel} {item.stdKuantitiPerUnit}{item.unit} · {lang === "en" ? "Act:" : "Sebenar:"} {item.sebenarKuantitiJumlah}{item.unit} · {t.variance.stdRate} {config.currency}{item.stdHargaPerUnit} · {t.variance.actRate} {config.currency}{item.sebenarHargaPerUnit}
                    </div>
                  </td>
                  <td className="py-4 px-4 text-center font-mono">
                    <div className={`font-bold tabular-nums whitespace-nowrap ${item.variansHarga > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                      {fDiff(item.variansHarga)}
                    </div>
                    <div className="text-[10px] text-slate-400 font-sans mt-0.5">(AP - SP) × AQ</div>
                  </td>
                  <td className="py-4 px-4 text-center font-mono">
                    <div className={`font-bold tabular-nums whitespace-nowrap ${item.variansPenggunaan > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                      {fDiff(item.variansPenggunaan)}
                    </div>
                    <div className="text-[10px] text-slate-400 font-sans mt-0.5">(AQ - SQ) × SP</div>
                  </td>
                  <td className="py-4 px-4 text-right font-mono font-extrabold text-slate-900 dark:text-slate-100 bg-slate-50/20 dark:bg-slate-800/20 tabular-nums whitespace-nowrap">
                    {fDiff(item.variansJumlah)}
                  </td>
                  <td className="py-4 px-6 text-center">
                    <Badge condition={item.keadaanJumlah} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Stacked Card View for DMV (< 640px) */}
        <div className="block sm:hidden p-3.5 space-y-3.5">
          {variansBahanList.map((item) => (
            <div key={item.id} className="p-4 bg-slate-50/70 dark:bg-[#101c30] rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3 shadow-2xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">{item.nama}</span>
                <Badge condition={item.keadaanJumlah} />
              </div>
              
              <div className="text-[11px] text-slate-500 font-mono space-y-0.5">
                <div>{t.actualSheet.stdLabel} {item.stdKuantitiPerUnit} {item.unit} · {config.currency}{item.stdHargaPerUnit}/{item.unit}</div>
                <div>{lang === "en" ? "Act:" : "Sebenar:"} {item.sebenarKuantitiJumlah} {item.unit} · {config.currency}{item.sebenarHargaPerUnit}/{item.unit}</div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-center pt-2 border-t border-slate-200/60 dark:border-slate-800">
                <div className="p-2.5 bg-white dark:bg-[#132238] rounded-xl border border-slate-100 dark:border-slate-700/60">
                  <span className="text-[10px] font-mono font-bold text-slate-400 uppercase block">{t.variance.mpvLabel}</span>
                  <span className={`text-xs font-mono font-bold tabular-nums whitespace-nowrap ${item.variansHarga > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {fDiff(item.variansHarga)}
                  </span>
                </div>
                <div className="p-2.5 bg-white dark:bg-[#132238] rounded-xl border border-slate-100 dark:border-slate-700/60">
                  <span className="text-[10px] font-mono font-bold text-slate-400 uppercase block">{t.variance.mqvLabel}</span>
                  <span className={`text-xs font-mono font-bold tabular-nums whitespace-nowrap ${item.variansPenggunaan > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {fDiff(item.variansPenggunaan)}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 dark:border-slate-800">
                <span className="text-xs text-slate-500 font-medium">{lang === "en" ? "Net DMV" : "Jumlah Varians"}</span>
                <span className={`font-mono font-extrabold text-sm tabular-nums whitespace-nowrap ${item.variansJumlah > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  {fDiff(item.variansJumlah)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. SECTION 2: BURUH LANGSUNG VARIANS */}
      <div className="bg-white dark:bg-[#0c182b] rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-[#101c30] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-display font-bold text-slate-900 dark:text-slate-100 text-base">
              {lang === "en" ? "2. Direct Labor Variances (DLV)" : "2. Perbezaan Kos Upah Pekerja"}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === "en"
                ? "Hourly wage rate deviations (Labor Rate Variance) & crew assembly speed/efficiency (Labor Efficiency Variance)."
                : "Mengukur perbezaan kadar upah sejam dan perbezaan masa bekerja."}
            </p>
          </div>
          <span className={`px-3 py-1.5 text-xs font-mono font-bold rounded-xl border shrink-0 whitespace-nowrap tabular-nums ${totalDLV <= 0 ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300' : 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'}`}>
            {lang === "en" ? "Total DLV:" : "Jumlah Perbezaan Upah:"} {fDiff(totalDLV)}
          </span>
        </div>

        {/* Desktop Table View */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead>
              <tr className="border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-mono text-slate-500 uppercase bg-slate-50/40 dark:bg-slate-800/40">
                <th className="py-3.5 px-6 font-semibold">{lang === "en" ? "Labor Task" : "Tugasan Pekerja"}</th>
                <th className="py-3.5 px-4 font-semibold text-center">{lang === "en" ? "Rate Variance (LRV)" : "Perbezaan Kadar"}</th>
                <th className="py-3.5 px-4 font-semibold text-center">{lang === "en" ? "Efficiency Variance (LEV)" : "Perbezaan Masa"}</th>
                <th className="py-3.5 px-4 font-semibold text-right">{lang === "en" ? "Total Labor Variance" : "Jumlah Perbezaan Upah"}</th>
                <th className="py-3.5 px-6 text-center w-36">{t.common.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {variansBuruhList.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="py-4 px-6 font-medium text-slate-800 dark:text-slate-200">
                    <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">{item.nama}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                      {t.variance.stdHrs} {item.stdJamPerUnit} · {t.variance.actHrs} {item.sebenarJamJumlah} · {t.variance.stdRate} {config.currency}{item.stdKadarPerJam}{t.variance.perHr} · {t.variance.actRate} {config.currency}{item.sebenarKadarPerJam}{t.variance.perHr}
                    </div>
                  </td>
                  <td className="py-4 px-4 text-center font-mono">
                    <div className={`font-bold tabular-nums whitespace-nowrap ${item.variansKadar > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                      {fDiff(item.variansKadar)}
                    </div>
                    <div className="text-[10px] text-slate-400 font-sans mt-0.5">(AR - SR) × AH</div>
                  </td>
                  <td className="py-4 px-4 text-center font-mono">
                    <div className={`font-bold tabular-nums whitespace-nowrap ${item.variansKecekapan > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                      {fDiff(item.variansKecekapan)}
                    </div>
                    <div className="text-[10px] text-slate-400 font-sans mt-0.5">(AH - SH) × SR</div>
                  </td>
                  <td className="py-4 px-4 text-right font-mono font-extrabold text-slate-900 dark:text-slate-100 bg-slate-50/20 dark:bg-slate-800/20 tabular-nums whitespace-nowrap">
                    {fDiff(item.variansJumlah)}
                  </td>
                  <td className="py-4 px-6 text-center">
                    <Badge condition={item.keadaanJumlah} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Stacked Card View for DLV (< 640px) */}
        <div className="block sm:hidden p-3.5 space-y-3.5">
          {variansBuruhList.map((item) => (
            <div key={item.id} className="p-4 bg-slate-50/70 dark:bg-[#101c30] rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3 shadow-2xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">{item.nama}</span>
                <Badge condition={item.keadaanJumlah} />
              </div>
              
              <div className="text-[11px] text-slate-500 font-mono space-y-0.5">
                <div>{t.actualSheet.stdLabel} {item.stdJamPerUnit}{t.actualSheet.hourSuffix} · {config.currency}{item.stdKadarPerJam}/{t.actualSheet.hourSuffix}</div>
                <div>{lang === "en" ? "Act:" : "Sebenar:"} {item.sebenarJamJumlah}{t.actualSheet.hourSuffix} · {config.currency}{item.sebenarKadarPerJam}/{t.actualSheet.hourSuffix}</div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-center pt-2 border-t border-slate-200/60 dark:border-slate-800">
                <div className="p-2.5 bg-white dark:bg-[#132238] rounded-xl border border-slate-100 dark:border-slate-700/60">
                  <span className="text-[10px] font-mono font-bold text-slate-400 uppercase block">{t.variance.lrvLabel}</span>
                  <span className={`text-xs font-mono font-bold tabular-nums whitespace-nowrap ${item.variansKadar > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {fDiff(item.variansKadar)}
                  </span>
                </div>
                <div className="p-2.5 bg-white dark:bg-[#132238] rounded-xl border border-slate-100 dark:border-slate-700/60">
                  <span className="text-[10px] font-mono font-bold text-slate-400 uppercase block">{t.variance.levLabel}</span>
                  <span className={`text-xs font-mono font-bold tabular-nums whitespace-nowrap ${item.variansKecekapan > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {fDiff(item.variansKecekapan)}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 dark:border-slate-800">
                <span className="text-xs text-slate-500 font-medium">{lang === "en" ? "Net DLV" : "Jumlah Varians"}</span>
                <span className={`font-mono font-extrabold text-sm tabular-nums whitespace-nowrap ${item.variansJumlah > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  {fDiff(item.variansJumlah)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 5. SECTIONS 3 & 4: OVERHEAD VARIANS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* OVERHEAD BERUBAH */}
        <div className="bg-white dark:bg-[#0c182b] rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="p-5 sm:p-6 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-[#101c30] flex items-center justify-between">
            <div>
              <h3 className="font-display font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">
                {lang === "en" ? "3. Variable Overhead Variance" : "3. Perbezaan Kos Berubah"}
              </h3>
            </div>
            <span className={`px-2.5 py-1 text-xs font-mono font-bold rounded-xl border whitespace-nowrap tabular-nums ${totalVOHV <= 0 ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300' : 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'}`}>
              {fDiff(totalVOHV)}
            </span>
          </div>

          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200/80 dark:border-slate-800 text-[10px] font-mono text-slate-500 uppercase bg-slate-50/40 dark:bg-slate-800/40">
                <th className="py-3 px-5">{lang === "en" ? "Variable Overhead Item" : "Perkara Kos Berubah"}</th>
                <th className="py-3 px-4 text-right">{lang === "en" ? "Variance" : "Perbezaan Kos"}</th>
                <th className="py-3 px-5 text-center">{t.common.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {variansOHBList.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="py-3.5 px-5 font-semibold text-slate-800 dark:text-slate-200">{item.nama}</td>
                  <td className={`py-3.5 px-4 text-right font-mono font-bold tabular-nums whitespace-nowrap ${item.variansSimbahan > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {fDiff(item.variansSimbahan)}
                  </td>
                  <td className="py-3.5 px-5 text-center">
                    <Badge condition={item.keadaan} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* OVERHEAD TETAP */}
        <div className="bg-white dark:bg-[#0c182b] rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="p-5 sm:p-6 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-[#101c30] flex items-center justify-between">
            <div>
              <h3 className="font-display font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">
                {lang === "en" ? "4. Fixed Overhead Spending Variance" : "4. Perbezaan Kos Tetap"}
              </h3>
            </div>
            <span className={`px-2.5 py-1 text-xs font-mono font-bold rounded-xl border whitespace-nowrap tabular-nums ${totalFOHV <= 0 ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300' : 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'}`}>
              {fDiff(totalFOHV)}
            </span>
          </div>

          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200/80 dark:border-slate-800 text-[10px] font-mono text-slate-500 uppercase bg-slate-50/40 dark:bg-slate-800/40">
                <th className="py-3 px-5">{lang === "en" ? "Fixed Overhead Item" : "Perkara Kos Tetap"}</th>
                <th className="py-3 px-4 text-right">{lang === "en" ? "Spending Variance" : "Perbezaan Belanja"}</th>
                <th className="py-3 px-5 text-center">{t.common.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {variansOHTList.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="py-3.5 px-5 font-semibold text-slate-800 dark:text-slate-200">{item.nama}</td>
                  <td className={`py-3.5 px-4 text-right font-mono font-bold tabular-nums whitespace-nowrap ${item.variansPerbelanjaan > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {fDiff(item.variansPerbelanjaan)}
                  </td>
                  <td className="py-3.5 px-5 text-center">
                    <Badge condition={item.keadaan} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>

      {/* 6. INTELLIGENT COST ANALYSIS REPORT CARD */}
      <div className="bg-gradient-to-r from-blue-50/80 via-sky-50/60 to-indigo-50/80 border border-blue-200/80 rounded-3xl p-6 sm:p-7 shadow-xs">
        <h3 className="text-base font-display font-bold text-slate-900 mb-2 flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-blue-700" />
          <span>
            {lang === "en" 
              ? `Operational Variance Advisory for ${config.namaSyarikat || "SCHOOL ENTERPRISE"}`
              : `Rumusan Pengekosan & Cadangan Operasi untuk ${config.namaSyarikat || "SCHOOL ENTERPRISE"}`}
          </span>
        </h3>
        <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
          {totalNetVariance <= 0 ? (
            <span>
              {lang === "en" ? (
                <>
                  <strong className="text-emerald-800">Favorable Financial Control!</strong> Total actual production spending was <strong className="text-emerald-800 font-mono">{f(Math.abs(totalNetVariance))}</strong> below the standard budgeted baseline. This signals effective ingredient batching and tight labor scheduling. Maintain standardized recipe measurements to lock in these margins.
                </>
              ) : (
                <>
                  <strong className="text-emerald-800">Kawalan Kewangan Cemerlang!</strong> Jumlah kos sebenar adalah lebih rendah berbanding bajet standard sebanyak <strong className="text-emerald-800 font-mono">{f(Math.abs(totalNetVariance))}</strong>. Ini dipacu oleh penggunaan dapur yang cekap dan disiplin waktu buruh.
                </>
              )}
            </span>
          ) : (
            <span>
              {lang === "en" ? (
                <>
                  <strong className="text-rose-800">Corrective Action Recommended!</strong> An unfavorable cost variance of <strong className="text-rose-800 font-mono">{f(totalNetVariance)}</strong> occurred compared to standard authorized budget.
                  {totalMPV > 0 && " High Material Price Variance (MPV) indicates wholesale cost inflation; evaluate bulk order discounts or alternate certified vendors."}
                  {totalMQV > 0 && " High Material Quantity Variance (MQV) shows recipe portion overrun; audit prep scrap and re-train rolling staff on portioning."}
                </>
              ) : (
                <>
                  <strong className="text-rose-800">Tindakan Pembetulan Diperlukan!</strong> Anda mengalami kos berlebihan sebanyak <strong className="text-rose-800 font-mono">{f(totalNetVariance)}</strong> minggu ini berbanding kos standard yang dibenarkan.
                  {totalMPV > 0 && " Kenaikan harga pasaran bahan (MPV) mencadangkan keperluan rundingan pembekal baharu."}
                  {totalMQV > 0 && " Pembaziran bahan mentah (MQV) dikesan; semak semula sukatan resipi semasa penyediaan."}
                </>
              )}
            </span>
          )}
        </p>
      </div>

    </div>
  );
}
