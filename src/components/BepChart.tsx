/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { KonfigurasiSistem } from "../types";
import { RingkasanKos, kiraAnalisisBEP } from "../utils/costCalculations";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer, 
  ReferenceLine, 
  ReferenceDot 
} from "recharts";
import { LineChart as ChartIcon, Info, HelpCircle } from "lucide-react";
import { Language, getStoredLanguage, getTranslation, formatLocalizedNumber, formatUnitLabel } from "../utils/i18n";
import { formatCurrencyRM } from "../utils/financialColors";

interface BepChartProps {
  config: KonfigurasiSistem;
  stdSummary: RingkasanKos;
  actSummary: RingkasanKos;
  systemLang?: Language;
}

export default function BepChart({ config, stdSummary, actSummary, systemLang }: BepChartProps) {
  const lang: Language = systemLang || config.language || getStoredLanguage();
  const t = getTranslation(lang);
  const [chartMode, setChartMode] = useState<"standard" | "sebenar">("sebenar");
  const unitLabel = formatUnitLabel(config.unitProduk, lang);
  const currencySymbol = config.currency || "RM";

  // Mobile detection for responsive X-axis tick intervals and Y-axis title visibility
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth < 640;
    }
    return false;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 640);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const isStd = chartMode === "standard";
  const summary = isStd ? stdSummary : actSummary;
  const price = isStd ? config.hargaJualanStandard : config.hargaJualanSebenar;
  const salesQty = isStd ? config.sasaranKuantitiStandard : config.kuantitiSebenarDijual;

  const bepResult = kiraAnalisisBEP(
    summary.jumlahKosTetapMingguan,
    price,
    summary.jumlahKosBerubahSemangkuk,
    salesQty,
    lang
  );

  const hasData = price > 0 || summary.jumlahKosTetapMingguan > 0 || summary.jumlahKosBerubahSemangkuk > 0;

  const safeBepUnits = bepResult.isAttainable ? bepResult.bepMangkuk : 0;
  const maxUnits = Math.max(salesQty * 1.3, safeBepUnits * 1.6, 500);
  const step = Math.ceil(maxUnits / 10);

  // Standardized series names according to bilingual specification
  const nameRevenue = lang === "en" ? "Sales revenue" : "Hasil jualan";
  const nameTotalCost = lang === "en" ? "Total costs" : "Jumlah kos";
  const nameFixedCost = lang === "en" ? "Fixed costs" : "Kos tetap";

  // Chart data points
  const data = Array.from({ length: 11 }, (_, i) => {
    const units = Math.round(i * step);
    const fixedCost = bepResult.kosTetap;
    const totalCost = fixedCost + (bepResult.kosBerubahMangkuk * units);
    const revenue = price * units;

    return {
      units,
      revenue: Math.round(revenue),
      totalCost: Math.round(totalCost),
      fixedCost: Math.round(fixedCost),
    };
  });

  // Precise coordinate for the BEP Dot
  const bepDot = {
    x: bepResult.isAttainable ? Math.round(bepResult.bepMangkuk) : 0,
    y: bepResult.isAttainable ? Math.round(bepResult.bepRM) : 0
  };

  const f = (val: number) => formatCurrencyRM(val, currencySymbol);

  // Concise Y-Axis tick formatter: "RM 0", "RM 600 ribu", "RM 1.2 juta"
  const formatYAxisTick = (val: number): string => {
    if (val === 0) return `${currencySymbol} 0`;
    const absVal = Math.abs(val);
    const sign = val < 0 ? "-" : "";

    if (absVal >= 1_000_000) {
      const num = absVal / 1_000_000;
      const formatted = num % 1 === 0 ? num.toFixed(0) : num.toFixed(1);
      return `${sign}${currencySymbol} ${formatted} ${lang === "en" ? "M" : "juta"}`;
    }

    if (absVal >= 1_000) {
      const num = absVal / 1_000;
      const formatted = num % 1 === 0 ? num.toFixed(0) : num.toFixed(1);
      return `${sign}${currencySymbol} ${formatted} ${lang === "en" ? "k" : "ribu"}`;
    }

    return `${sign}${currencySymbol} ${formatLocalizedNumber(absVal, lang)}`;
  };

  return (
    <div className="space-y-6 sm:space-y-8 animate-fadeIn">
      {/* Header Info */}
      <div className="bg-white dark:bg-[#132238] rounded-2xl p-5 sm:p-6 border border-slate-100 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="screen-title text-slate-800 dark:text-white flex items-center gap-2">
            <ChartIcon className="w-6 h-6 text-[#0b3c7a] dark:text-sky-400" />
            {lang === "en" ? "Break-Even Point (BEP) Analysis Chart" : "Carta Analisis Titik Pulang Modal"}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {lang === "en"
              ? "Interactive crossover chart showing total sales revenue intersecting with total production and operating costs at the Break-Even Point."
              : "Graf visual interaktif yang menunjukkan persilangan antara Hasil Jualan dengan Jumlah Kos. Persilangan ini ialah Titik Pulang Modal."}
          </p>
        </div>

        {/* Toggle Mode Selector */}
        <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 self-start md:self-auto shrink-0">
          <button
            type="button"
            onClick={() => setChartMode("standard")}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              isStd 
                ? "bg-white dark:bg-slate-700 text-[#0b3c7a] dark:text-sky-300 shadow-xs" 
                : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            {lang === "en" ? "Standard Budget" : "Anggaran Standard"}
          </button>
          <button
            type="button"
            onClick={() => setChartMode("sebenar")}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              !isStd 
                ? "bg-white dark:bg-slate-700 text-emerald-700 dark:text-emerald-400 shadow-xs" 
                : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            {lang === "en" ? "Actual Performance" : "Prestasi Sebenar"}
          </button>
        </div>
      </div>

      {/* Main Chart Container */}
      <div className="bg-white dark:bg-[#132238] rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs p-4 sm:p-6 space-y-6 overflow-hidden">
        
        {/* Unattainable BEP Warning Banner */}
        {hasData && !bepResult.isAttainable && (
          <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-900 dark:text-amber-200 flex items-start gap-3">
            <Info className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm">
                {lang === "en" ? "Break-Even Point Unattainable" : "Titik Pulang Modal Tidak Tercapai"}
              </p>
              <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                {bepResult.statusMessage || (
                  lang === "en"
                    ? "Selling price does not exceed variable cost per unit. Every unit sold results in a loss."
                    : "Harga jualan tidak melebihi kos berubah seunit. Margin caruman adalah sifar atau negatif."
                )}
              </p>
            </div>
          </div>
        )}

        {/* Empty State Fallback when zero or no data */}
        {!hasData && (
          <div className="p-8 text-center bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 space-y-2">
            <HelpCircle className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {lang === "en" ? "No Costing Data Available" : "Tiada Data Pengekosan"}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              {lang === "en"
                ? "Enter selling price and cost records in the Standard or Actual Cost Sheet to visualize your Break-Even Point crossover chart."
                : "Sila masukkan harga jualan dan rekod kos dalam Helaian Kos Piawai atau Kos Sebenar untuk melihat carta persilangan Titik Pulang Modal."}
            </p>
          </div>
        )}

        {/* Chart Info Indicators */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 text-center">
          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-700/60">
            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-400 block font-bold uppercase">
              {lang === "en" ? "FIXED COSTS (BASELINE)" : "KOS TETAP (GARISAN RATAL)"}
            </span>
            <span className="text-lg font-display font-extrabold text-slate-700 dark:text-slate-200 font-mono">
              {f(bepResult.kosTetap)}
            </span>
          </div>
          <div className="p-3 bg-blue-50/50 dark:bg-sky-950/40 rounded-xl border border-blue-100/50 dark:border-sky-800/40">
            <span className="text-[10px] font-mono text-blue-500 dark:text-sky-400 block font-bold uppercase">
              {lang === "en" ? "BREAK-EVEN UNITS" : "TITIK PULANG MODAL"}
            </span>
            <span className="text-lg font-display font-extrabold text-[#0b3c7a] dark:text-sky-300 font-mono capitalize">
              {bepResult.isAttainable 
                ? `${bepResult.bepMangkuk.toFixed(0)} ${unitLabel}`
                : (lang === "en" ? "Unattainable" : "Tidak Tercapai")}
            </span>
          </div>
          <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/40 rounded-xl border border-emerald-100/50 dark:border-emerald-800/40">
            <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 block font-bold uppercase">
              {lang === "en" ? "BREAK-EVEN REVENUE" : "NILAI JUALAN BEP"}
            </span>
            <span className="text-lg font-display font-extrabold text-emerald-700 dark:text-emerald-300 font-mono">
              {bepResult.isAttainable ? f(bepResult.bepRM) : t.bepChart.na}
            </span>
          </div>
        </div>

        {/* Y-Axis Title Header (Visible on desktop outside tick labels, hidden on mobile) */}
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400 px-2 -mb-2">
          <span className="hidden sm:inline-block font-semibold">
            {lang === "en" ? `Total Value (${currencySymbol})` : `Jumlah Nilai (${currencySymbol})`}
          </span>
          <span className="text-[10px] sm:hidden text-slate-400">
            ({currencySymbol})
          </span>
        </div>

        {/* Chart Area */}
        <div className="w-full h-[340px] sm:h-[420px] font-mono text-xs overflow-visible">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 25, right: 20, left: 10, bottom: 40 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" className="dark:stroke-slate-800/80" />
              
              <XAxis 
                dataKey="units" 
                domain={[0, "auto"]} 
                tickLine={false} 
                stroke="#94a3b8"
                tick={{ fill: "#64748b", fontSize: 11 }}
                interval={isMobile ? 1 : 0}
                label={{ 
                  value: lang === "en" ? `Sales Volume (${unitLabel})` : `Kuantiti Jualan (${unitLabel})`, 
                  position: 'insideBottom', 
                  offset: -20, 
                  fill: "#64748b", 
                  fontWeight: 600,
                  fontSize: 11
                }}
              />

              <YAxis 
                domain={[0, "auto"]} 
                tickLine={false} 
                stroke="#94a3b8"
                tick={{ fill: "#64748b", fontSize: 11 }}
                width={82}
                tickCount={5}
                tickFormatter={formatYAxisTick}
              />

              <Tooltip 
                formatter={(value: any, name: any) => [
                  formatCurrencyRM(Number(value) || 0, currencySymbol),
                  name
                ]}
                labelFormatter={(label) => `${lang === "en" ? "Quantity" : "Kuantiti"}: ${label} ${unitLabel}`}
                contentStyle={{ 
                  borderRadius: '12px', 
                  border: '1px solid #cbd5e1', 
                  boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
                  padding: '10px 14px',
                  backgroundColor: '#ffffff',
                  color: '#0f172a'
                }}
                wrapperStyle={{ outline: "none", zIndex: 50 }}
              />

              <Legend 
                verticalAlign="top" 
                height={42} 
                iconType="circle"
                wrapperStyle={{ 
                  paddingBottom: '14px',
                  top: 0,
                  fontSize: '12px',
                  fontWeight: 600
                }}
              />
              
              {/* Lines without static dots (dot=false), showing dot only on hover (activeDot) */}
              <Line 
                name={nameRevenue} 
                type="monotone" 
                dataKey="revenue" 
                stroke="#10b981" 
                strokeWidth={3} 
                dot={false} 
                activeDot={{ r: 6, strokeWidth: 2, stroke: "#ffffff" }}
              />
              <Line 
                name={nameTotalCost} 
                type="monotone" 
                dataKey="totalCost" 
                stroke="#ef4444" 
                strokeWidth={3} 
                dot={false}
                activeDot={{ r: 6, strokeWidth: 2, stroke: "#ffffff" }}
              />
              <Line 
                name={nameFixedCost} 
                type="monotone" 
                dataKey="fixedCost" 
                stroke="#94a3b8" 
                strokeWidth={2} 
                strokeDasharray="5 5" 
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2, stroke: "#ffffff" }}
              />

              {/* Reference line for BEP units */}
              {bepResult.isAttainable && bepResult.bepMangkuk > 0 && bepResult.bepMangkuk < maxUnits && (
                <ReferenceLine 
                  x={bepDot.x} 
                  stroke="#ef4444" 
                  strokeDasharray="3 3"
                />
              )}
              {/* Reference line for BEP money */}
              {bepResult.isAttainable && bepResult.bepRM > 0 && (
                <ReferenceLine 
                  y={bepDot.y} 
                  stroke="#ef4444" 
                  strokeDasharray="3 3"
                />
              )}

              {/* Exact point representing BEP intersection */}
              {bepResult.isAttainable && bepResult.bepMangkuk > 0 && bepResult.bepMangkuk < maxUnits && (
                <ReferenceDot 
                  x={bepDot.x} 
                  y={bepDot.y} 
                  r={7} 
                  fill="#ef4444" 
                  stroke="#ffffff" 
                  strokeWidth={2}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Legend describing regions - Existing advisory text intact */}
        <div className="bg-slate-50 dark:bg-slate-850 rounded-xl p-4 border border-slate-100 dark:border-slate-800 flex flex-col md:flex-row items-center gap-4 justify-between text-xs text-slate-600 dark:text-slate-300">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
            <p>
              {!bepResult.isAttainable ? (
                lang === "en"
                  ? `To reach a break-even point and achieve profits, increase the selling price above ${currencySymbol} ${bepResult.kosBerubahMangkuk.toFixed(2)} per ${unitLabel} or lower variable production costs.`
                  : `Untuk mencapai titik pulang modal dan keuntungan, naikkan harga jualan melebihi ${currencySymbol} ${bepResult.kosBerubahMangkuk.toFixed(2)} se-${unitLabel} atau kurangkan kos berubah pengeluaran.`
              ) : lang === "en" ? (
                <>
                  The region to the <strong>right</strong> of the red marker ({bepDot.x} {unitLabel}) represents the <strong>profit zone</strong>, whereas the region to the <strong>left</strong> represents the <strong>loss zone</strong> for <strong>{config.namaSyarikat}</strong>.
                </>
              ) : (
                <>
                  Kawasan di <strong>sebelah kanan</strong> titik merah ({bepDot.x} {unitLabel}) melambangkan <strong>zon keuntungan</strong>, manakala kawasan di <strong>sebelah kiri</strong> melambangkan <strong>zon kerugian</strong> perniagaan {config.namaSyarikat ? <strong>{config.namaSyarikat}</strong> : "anda"}.
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 mt-2 md:mt-0">
            <span className="w-3.5 h-3.5 bg-emerald-100 border border-emerald-300 rounded-full inline-block"></span>
            <span className="font-semibold text-emerald-800 dark:text-emerald-400">{lang === "en" ? "Profit Zone" : "Zon untung"}</span>
            <span className="w-3.5 h-3.5 bg-rose-100 border border-rose-300 rounded-full inline-block ml-2"></span>
            <span className="font-semibold text-rose-800 dark:text-rose-400">{lang === "en" ? "Loss Zone" : "Zon rugi"}</span>
          </div>
        </div>

      </div>
    </div>
  );
}
