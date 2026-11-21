/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { KonfigurasiSistem, Language } from "../types";
import { RingkasanKos } from "../utils/costCalculations";
import { getTranslation, formatLocalizedNumber } from "../utils/i18n";
import { 
  Coins, 
  TrendingUp, 
  TrendingDown, 
  Calendar, 
  AlertCircle, 
  CheckCircle2, 
  Printer, 
  ShieldCheck, 
  Clock, 
  Wallet, 
  Building2, 
  RefreshCw 
} from "lucide-react";

interface CashflowSheetProps {
  config: KonfigurasiSistem;
  stdSummary: RingkasanKos;
  actSummary: RingkasanKos;
  systemLang?: Language;
}

export const CashflowSheet: React.FC<CashflowSheetProps> = ({
  config,
  stdSummary,
  actSummary,
  systemLang = "en",
}) => {
  const isEn = systemLang === "en";
  const t = getTranslation(systemLang);
  const currency = config.currency || "RM";
  const f = (val: number) => `${currency} ${formatLocalizedNumber(val, systemLang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Corporate & SME Working Capital Parameters
  const [customerCreditDays, setCustomerCreditDays] = useState<number>(14);
  const [supplierCreditDays, setSupplierCreditDays] = useState<number>(7);
  const [inventoryDays, setInventoryDays] = useState<number>(7);
  const [initialBankBalance, setInitialBankBalance] = useState<number>(10000);
  const [safetyBufferWeeks, setSafetyBufferWeeks] = useState<number>(3);
  const [activeCycleTab, setActiveCycleTab] = useState<"weekly" | "monthly">("weekly");

  // Operational numbers
  const weeklyRevenue = actSummary.jumlahHasilMingguan > 0 ? actSummary.jumlahHasilMingguan : stdSummary.jumlahHasilMingguan;
  const weeklyMaterialCost = actSummary.bahanMentahSemangkuk * (config.kuantitiSebenarDijual || config.sasaranKuantitiStandard);
  const weeklyLaborCost = actSummary.buruhLangsungSemangkuk * (config.kuantitiSebenarDijual || config.sasaranKuantitiStandard);
  const weeklyVariableOH = actSummary.overheadBerubahSemangkuk * (config.kuantitiSebenarDijual || config.sasaranKuantitiStandard);
  const weeklyFixedOH = actSummary.jumlahKosTetapMingguan > 0 ? actSummary.jumlahKosTetapMingguan : stdSummary.jumlahKosTetapMingguan;
  
  const weeklyTotalOutflow = weeklyMaterialCost + weeklyLaborCost + weeklyVariableOH + weeklyFixedOH;
  const weeklyNetCashflow = weeklyRevenue - weeklyTotalOutflow;

  // Cash Conversion Cycle (Kitaran Penukaran Tunai)
  const cashConversionCycleDays = Math.max(0, inventoryDays + customerCreditDays - supplierCreditDays);
  
  // Working capital needed to sustain operations during conversion cycle
  const dailyCashBurn = weeklyTotalOutflow / 7;
  const workingCapitalNeeded = Math.round(dailyCashBurn * (cashConversionCycleDays > 0 ? cashConversionCycleDays : 7));
  const minimumSafetyReserve = Math.round(weeklyTotalOutflow * safetyBufferWeeks);
  const totalRecommendedLiquidity = workingCapitalNeeded + minimumSafetyReserve;

  // Cash runway
  const cashRunwayWeeks = weeklyTotalOutflow > 0 ? (initialBankBalance / weeklyTotalOutflow).toFixed(1) : t.common.na;

  // 6-Week Cash Forecast Simulation
  const weeks = [1, 2, 3, 4, 5, 6];
  let runningBalance = initialBankBalance;
  const forecastData = weeks.map((week) => {
    const inflow = weeklyRevenue;
    const outflow = weeklyTotalOutflow;
    const net = inflow - outflow;
    runningBalance += net;
    return {
      week,
      inflow,
      outflow,
      net,
      balance: runningBalance,
    };
  });

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* 1. Header Banner */}
      <section className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200/90 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] font-mono font-bold text-slate-500 uppercase tracking-wider">
            <Coins className="w-3.5 h-3.5 text-blue-600" />
            <span>{t.cashflow.title}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-display font-extrabold text-slate-900 tracking-tight">
            {isEn ? "Cash Flow & Working Capital Runway" : "Aliran Tunai & Modal Pusingan Operasi"}
          </h2>
          <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
            {isEn 
              ? `Real-time liquidity management for ${config.namaSyarikat}. Evaluate required working capital, cash conversion cycles, credit terms, and cash reserve runway in ${currency}.`
              : `Pengurusan kecairan tunai masa nyata untuk ${config.namaSyarikat}. Nilai modal pusingan diperlukan, kitaran penukaran tunai, tempoh kredit, dan penampan tunai dalam ${currency}.`}
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={handlePrint}
            className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer shadow-2xs"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{isEn ? "Print Cash Plan" : "Cetak Pelan Tunai"}</span>
          </button>
        </div>
      </section>

      {/* 2. Top 4 KPI Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Working Capital Needed */}
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200/90 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider font-mono text-slate-400">
              {isEn ? "Required Working Capital" : "Modal Pusingan Diperlukan"}
            </span>
            <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
              <Wallet className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-display font-extrabold text-slate-900 tracking-tight tabular-nums">
            {f(workingCapitalNeeded)}
          </div>
          <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-500">
            <Clock className="w-3 h-3 text-blue-500" />
            <span>{isEn ? `Covers ${cashConversionCycleDays} days cycle` : `Menampung kitaran ${cashConversionCycleDays} hari`}</span>
          </div>
        </div>

        {/* Weekly Cash Inflow / Inflow */}
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200/90 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider font-mono text-slate-400">
              {isEn ? "Weekly Cash Flow (Net)" : "Aliran Tunai Bersih Seminggu"}
            </span>
            <div className={`p-1.5 rounded-lg ${weeklyNetCashflow >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
              {weeklyNetCashflow >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            </div>
          </div>
          <div className={`text-xl font-display font-extrabold tracking-tight tabular-nums ${weeklyNetCashflow >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
            {weeklyNetCashflow >= 0 ? `+${f(weeklyNetCashflow)}` : f(weeklyNetCashflow)}
          </div>
          <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-500">
            <span>{isEn ? `Revenue: ${f(weeklyRevenue)}` : `Hasil: ${f(weeklyRevenue)}`}</span>
          </div>
        </div>

        {/* Cash Conversion Cycle Days */}
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200/90 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider font-mono text-slate-400">
              {isEn ? "Cash Conversion Cycle" : "Kitaran Penukaran Tunai"}
            </span>
            <div className="p-1.5 rounded-lg bg-amber-50 text-amber-600">
              <RefreshCw className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-display font-extrabold text-slate-900 tracking-tight tabular-nums">
            {cashConversionCycleDays} <span className="text-xs font-semibold text-slate-500">{isEn ? "Days" : "Hari"}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-500">
            <span>{isEn ? `DSO ${customerCreditDays}d - DPO ${supplierCreditDays}d` : `Kutipan ${customerCreditDays}h - Bayaran ${supplierCreditDays}h`}</span>
          </div>
        </div>

        {/* Cash Runway Buffer */}
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200/90 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider font-mono text-slate-400">
              {isEn ? "Cash Runway Buffer" : "Kekuatan Rezab Tunai"}
            </span>
            <div className="p-1.5 rounded-lg bg-purple-50 text-purple-600">
              <ShieldCheck className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-display font-extrabold text-slate-900 tracking-tight tabular-nums">
            {cashRunwayWeeks} <span className="text-xs font-semibold text-slate-500">{isEn ? "Weeks" : "Minggu"}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-500">
            <span>{isEn ? `Based on ${f(initialBankBalance)} bank` : `Berdasarkan ${f(initialBankBalance)} tunai`}</span>
          </div>
        </div>
      </div>

      {/* 3. Interactive Treasury Parameters */}
      <section className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200/90 shadow-2xs space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-600" />
              <span>{isEn ? "Working Capital Parameters & Credit Terms" : "Parameter Modal Pusingan & Terma Kredit"}</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {isEn ? "Fine-tune customer payment delay and supplier terms to stress-test your cash flow." : "Uji ketahanan tunai dengan mengubah tempoh kredit pelanggan dan pembekal."}
            </p>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setActiveCycleTab("weekly")}
              className={`px-3 py-1 rounded text-xs font-semibold transition-all cursor-pointer ${activeCycleTab === "weekly" ? "bg-white text-slate-900 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900"}`}
            >
              {isEn ? "Weekly Cycle" : "Kitaran Mingguan"}
            </button>
            <button
              onClick={() => setActiveCycleTab("monthly")}
              className={`px-3 py-1 rounded text-xs font-semibold transition-all cursor-pointer ${activeCycleTab === "monthly" ? "bg-white text-slate-900 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900"}`}
            >
              {isEn ? "Monthly Cycle (x4)" : "Kitaran Bulanan (x4)"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Customer Credit Terms */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
              <span>{isEn ? "Customer Payment Terms (DSO)" : "Tempoh Bayaran Pelanggan"}</span>
              <span className="font-mono text-blue-600 text-xs font-bold">{customerCreditDays} {isEn ? "days" : "hari"}</span>
            </label>
            <select
              value={customerCreditDays}
              onChange={(e) => setCustomerCreditDays(Number(e.target.value))}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:bg-white focus:border-blue-500 outline-hidden cursor-pointer"
            >
              <option value={0}>{isEn ? "Cash on Delivery (0 days - Retail/F&B)" : "Tunai COD (0 hari - Runcit/F&B)"}</option>
              <option value={7}>{isEn ? "7 Days (Quick Wholesalers)" : "7 Hari (Pemborong Pantas)"}</option>
              <option value={14}>{isEn ? "14 Days (Standard SME Corporate)" : "14 Hari (Standard PKS Korporat)"}</option>
              <option value={30}>{isEn ? "30 Days (Supermarkets / Hypermarkets)" : "30 Hari (Pasar Raya / Korporat)"}</option>
              <option value={60}>{isEn ? "60 Days (Large Government / MNC)" : "60 Hari (Kerajaan / MNC)"}</option>
            </select>
            <p className="text-[10px] text-slate-400">
              {isEn ? "Delay before cash enters your bank." : "Tempoh menunggu sebelum hasil jualan masuk akaun bank."}
            </p>
          </div>

          {/* Supplier Payment Terms */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
              <span>{isEn ? "Supplier Credit Terms (DPO)" : "Terma Kredit Pembekal"}</span>
              <span className="font-mono text-emerald-600 text-xs font-bold">{supplierCreditDays} {isEn ? "days" : "hari"}</span>
            </label>
            <select
              value={supplierCreditDays}
              onChange={(e) => setSupplierCreditDays(Number(e.target.value))}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:bg-white focus:border-blue-500 outline-hidden cursor-pointer"
            >
              <option value={0}>{isEn ? "Cash COD (Immediate payment)" : "Tunai COD (Bayar Serta Merta)"}</option>
              <option value={7}>{isEn ? "7 Days (Weekly Term)" : "7 Hari (Terma Mingguan)"}</option>
              <option value={14}>{isEn ? "14 Days (Standard Supplier Credit)" : "14 Hari (Kredit Pembekal Biasa)"}</option>
              <option value={30}>{isEn ? "30 Days (Net 30 Credit)" : "30 Hari (Kredit Net 30)"}</option>
            </select>
            <p className="text-[10px] text-slate-400">
              {isEn ? "Payment grace period given by suppliers." : "Tempoh kelonggaran bayaran bahan mentah."}
            </p>
          </div>

          {/* Inventory Holding Period */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
              <span>{isEn ? "Inventory Holding (DIO)" : "Simpanan Stok Bahan (Hari)"}</span>
              <span className="font-mono text-amber-600 text-xs font-bold">{inventoryDays} {isEn ? "days" : "hari"}</span>
            </label>
            <select
              value={inventoryDays}
              onChange={(e) => setInventoryDays(Number(e.target.value))}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:bg-white focus:border-blue-500 outline-hidden cursor-pointer"
            >
              <option value={3}>{isEn ? "3 Days (Perishable / Fresh F&B)" : "3 Hari (Bahan Segar F&B)"}</option>
              <option value={7}>{isEn ? "7 Days (Weekly Production Batch)" : "7 Hari (Kitaran Mingguan)"}</option>
              <option value={14}>{isEn ? "14 Days (Bi-weekly Stock)" : "14 Hari (Stok 2 Minggu)"}</option>
              <option value={30}>{isEn ? "30 Days (Monthly Dry Stock)" : "30 Hari (Stok Pembungkusan Kering)"}</option>
            </select>
            <p className="text-[10px] text-slate-400">
              {isEn ? "Days raw materials stay in storage." : "Tempoh bahan mentah disimpan sebelum digunakan."}
            </p>
          </div>

          {/* Initial Bank Cash Balance */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
              <span>{isEn ? "Current Bank Liquidity" : "Baki Tunai Bank Semasa"}</span>
              <span className="font-mono text-slate-900 text-xs font-bold">{f(initialBankBalance)}</span>
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-xs font-mono text-slate-400">{currency}</span>
              <input
                type="number"
                value={initialBankBalance}
                onChange={(e) => setInitialBankBalance(Math.max(0, Number(e.target.value)))}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-800 focus:bg-white focus:border-blue-500 outline-hidden"
              />
            </div>
            <p className="text-[10px] text-slate-400">
              {isEn ? "Cash available in company account." : "Baki tunai sedia ada dalam akaun syarikat."}
            </p>
          </div>
        </div>

        {/* Working Capital Advisory Box */}
        <div className={`p-4 rounded-xl border flex items-start gap-3 ${
          initialBankBalance >= totalRecommendedLiquidity
            ? "bg-emerald-50/70 border-emerald-200 text-emerald-900"
            : "bg-amber-50/70 border-amber-200 text-amber-900"
        }`}>
          <div className="p-1.5 rounded-lg bg-white shadow-2xs shrink-0">
            {initialBankBalance >= totalRecommendedLiquidity ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-600" />
            )}
          </div>
          <div className="space-y-1 text-xs">
            <p className="font-bold text-xs sm:text-sm">
              {initialBankBalance >= totalRecommendedLiquidity
                ? t.cashflow.healthyTitle
                : t.cashflow.warningTitle}
            </p>
            <p className="leading-relaxed opacity-90 text-[11px] sm:text-xs">
              {initialBankBalance >= totalRecommendedLiquidity
                ? (isEn
                    ? `Current cash balance of ${f(initialBankBalance)} is sufficient to cover the operating cycle (${f(workingCapitalNeeded)}) plus a ${safetyBufferWeeks}-week safety buffer (${f(minimumSafetyReserve)}). Business runway stands at ${cashRunwayWeeks} weeks.`
                    : `Baki tunai semasa ${f(initialBankBalance)} mencukupi untuk menampung kitaran operasi (${f(workingCapitalNeeded)}) ditambah penampan keselamatan ${safetyBufferWeeks} minggu (${f(minimumSafetyReserve)}). Perniagaan memiliki ketahanan selama ${cashRunwayWeeks} minggu.`)
                : (isEn
                    ? `With ${customerCreditDays}-day customer credit terms, you need at least ${f(totalRecommendedLiquidity)} in cash reserves to prevent operational cash shortages before payments are collected.`
                    : `Dengan terma kredit pelanggan ${customerCreditDays} hari, anda memerlukan sekurang-kurangnya ${f(totalRecommendedLiquidity)} rizab tunai untuk mengelakkan gangguan tunai operasi sebelum bayaran diterima.`)}
            </p>
          </div>
        </div>
      </section>

      {/* 4. 6-Week Rolling Cash Inflow vs Outflow Forecast */}
      <section className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200/90 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-emerald-600" />
              <span>{isEn ? "6-Week Rolling Cash Flow Projection" : "Unjuran Aliran Tunai 6 Minggu"}</span>
            </h3>
            <p className="text-xs text-slate-500">
              {isEn ? "Projected operational cash receipts vs payments based on current production rates." : "Unjuran kemasukan dan perbelanjaan tunai operasi mingguan."}
            </p>
          </div>
          <div className="text-xs font-mono font-bold px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg">
            {currency} — {t.cashflow.currencyNote}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400 font-mono uppercase text-[10px] bg-slate-50/60">
                <th className="py-2.5 px-3">{isEn ? "Timeline" : "Garis Masa"}</th>
                <th className="py-2.5 px-3 text-right">{isEn ? "Cash Inflow" : "Kutipan Jualan"}</th>
                <th className="py-2.5 px-3 text-right">{isEn ? "Materials" : "Bahan Mentah"}</th>
                <th className="py-2.5 px-3 text-right">{isEn ? "Direct Wages" : "Gaji Buruh"}</th>
                <th className="py-2.5 px-3 text-right">{isEn ? "Overhead / Rent" : "Overhead & Sewa"}</th>
                <th className="py-2.5 px-3 text-right font-bold text-slate-700">{isEn ? "Total Outflow" : "Jumlah Keluar"}</th>
                <th className="py-2.5 px-3 text-right font-bold text-slate-700">{isEn ? "Net Flow" : "Aliran Bersih"}</th>
                <th className="py-2.5 px-3 text-right font-bold text-blue-700 bg-blue-50/50">{isEn ? "Closing Balance" : "Baki Akhir"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
              {forecastData.map((row) => (
                <tr key={row.week} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-2.5 px-3 font-sans font-bold text-slate-800">
                    {isEn ? `Week ${row.week}` : `Minggu ${row.week}`}
                  </td>
                  <td className="py-2.5 px-3 text-right text-emerald-600 font-semibold">
                    +{f(row.inflow)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-600">
                    -{f(weeklyMaterialCost)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-600">
                    -{f(weeklyLaborCost)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-600">
                    -{f(weeklyVariableOH + weeklyFixedOH)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold text-rose-600">
                    -{f(row.outflow)}
                  </td>
                  <td className={`py-2.5 px-3 text-right font-bold ${row.net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {row.net >= 0 ? `+${f(row.net)}` : f(row.net)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold text-blue-900 bg-blue-50/50">
                    {f(row.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 font-mono font-bold bg-slate-50 text-slate-900">
                <td className="py-3 px-3 font-sans uppercase text-[10px]">{isEn ? "6-Week Total" : "Jumlah 6 Minggu"}</td>
                <td className="py-3 px-3 text-right text-emerald-700 font-bold">+{f(weeklyRevenue * 6)}</td>
                <td className="py-3 px-3 text-right text-slate-700">-{f(weeklyMaterialCost * 6)}</td>
                <td className="py-3 px-3 text-right text-slate-700">-{f(weeklyLaborCost * 6)}</td>
                <td className="py-3 px-3 text-right text-slate-700">-{f((weeklyVariableOH + weeklyFixedOH) * 6)}</td>
                <td className="py-3.5 px-3 text-right text-rose-700">-{f(weeklyTotalOutflow * 6)}</td>
                <td className="py-3.5 px-3 text-right text-emerald-800">+{f(weeklyNetCashflow * 6)}</td>
                <td className="py-3.5 px-3 text-right text-blue-900 bg-blue-100/50">{f(forecastData[forecastData.length - 1].balance)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
};
