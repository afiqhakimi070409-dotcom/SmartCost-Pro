/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { KonfigurasiSistem, Language } from "../types";
import { TemplatPerniagaan } from "../data/defaultTemplates";
import { RingkasanKos } from "../utils/costCalculations";
import { 
  Briefcase, 
  Layers, 
  Printer, 
  Scale, 
  Receipt 
} from "lucide-react";

interface PortfolioTaxSheetProps {
  config: KonfigurasiSistem;
  templates: TemplatPerniagaan[];
  activeProductId: string;
  onSelectProduct?: (productId: string) => void;
  stdSummary: RingkasanKos;
  actSummary: RingkasanKos;
  systemLang?: Language;
}

export const PortfolioTaxSheet: React.FC<PortfolioTaxSheetProps> = ({
  config,
  templates,
  activeProductId,
  stdSummary,
  actSummary,
  systemLang = "en",
}) => {
  const isEn = systemLang === "en";
  const currency = config.currency || "RM";
  const f = (val: number) => `${currency} ${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Malaysian SST & Tax Settings
  const [sstRate, setSstRate] = useState<number>(8);
  const [pricingMode, setPricingMode] = useState<"exclusive" | "inclusive">("exclusive");
  const [isSmeTaxTier, setIsSmeTaxTier] = useState<boolean>(true);
  const [ownerDividendPct, setOwnerDividendPct] = useState<number>(60);

  // Calculate portfolio metrics for each product in company database
  const portfolioItems = templates.map((tpl) => {
    const pConfig = tpl.konfigurasi || config;
    const price = Number(pConfig.hargaJualanStandard || 0);
    const targetQty = Number(pConfig.sasaranKuantitiStandard || 1000);

    const matCostUnit = (tpl.bahanMentah || []).reduce(
      (s, m) => s + (m.stdKuantitiPerUnit * m.stdHargaPerUnit),
      0
    );
    const laborCostUnit = (tpl.buruhLangsung || []).reduce(
      (s, l) => s + (l.stdJamPerUnit * l.stdKadarPerJam),
      0
    );
    const varOhUnit = (tpl.overheadBerubah || []).reduce(
      (s, v) => s + v.stdKosPerUnit,
      0
    );
    const totalVarUnit = matCostUnit + laborCostUnit + varOhUnit;
    const marginUnit = Math.max(0, price - totalVarUnit);
    const marginPct = price > 0 ? (marginUnit / price) * 100 : 0;
    const weeklyProfitContribution = marginUnit * targetQty;

    let statusBadge = { label: isEn ? "Balanced" : "Seimbang", color: "bg-slate-100 text-slate-800" };
    if (marginPct >= 45 && targetQty >= 800) {
      statusBadge = { label: isEn ? "Top Margin Performer" : "Prestasi Cemerlang", color: "bg-amber-100 text-amber-900 border border-amber-200" };
    } else if (targetQty >= 1000) {
      statusBadge = { label: isEn ? "High Volume Volume Driver" : "Pemacu Volume Tinggi", color: "bg-emerald-100 text-emerald-900 border border-emerald-200" };
    } else if (marginPct >= 50) {
      statusBadge = { label: isEn ? "High Margin Niche" : "Margin Tinggi", color: "bg-blue-100 text-blue-900 border border-blue-200" };
    } else if (marginPct < 25) {
      statusBadge = { label: isEn ? "Low Margin Alert" : "Margin Rendah", color: "bg-rose-100 text-rose-900 border border-rose-200" };
    }

    return {
      id: tpl.id,
      name: tpl.namaProduk || "Product",
      unit: pConfig.unitProduk || "unit",
      price,
      totalVarUnit,
      marginUnit,
      marginPct,
      targetQty,
      weeklyProfitContribution,
      statusBadge,
      isActive: tpl.id === activeProductId,
    };
  });

  // Active product pricing & SST Calculations
  const baseSellingPrice = config.hargaJualanStandard || 2.5;
  let customerPrice = baseSellingPrice;
  let netBusinessPrice = baseSellingPrice;
  let sstAmountPerUnit = 0;

  if (pricingMode === "exclusive") {
    sstAmountPerUnit = (baseSellingPrice * sstRate) / 100;
    customerPrice = baseSellingPrice + sstAmountPerUnit;
    netBusinessPrice = baseSellingPrice;
  } else {
    netBusinessPrice = baseSellingPrice / (1 + sstRate / 100);
    sstAmountPerUnit = baseSellingPrice - netBusinessPrice;
    customerPrice = baseSellingPrice;
  }

  // Annualized Corporate & SME Income Tax Calculations
  const weeklyNetProfit = actSummary.untungBersihMingguan > 0 ? actSummary.untungBersihMingguan : stdSummary.untungBersihMingguan;
  const annualProfitBeforeTax = Math.max(0, weeklyNetProfit * 52);

  let annualTaxPayable = 0;
  if (isSmeTaxTier) {
    if (annualProfitBeforeTax <= 150000) {
      annualTaxPayable = annualProfitBeforeTax * 0.15;
    } else if (annualProfitBeforeTax <= 600000) {
      annualTaxPayable = (150000 * 0.15) + ((annualProfitBeforeTax - 150000) * 0.17);
    } else {
      annualTaxPayable = (150000 * 0.15) + (450000 * 0.17) + ((annualProfitBeforeTax - 600000) * 0.24);
    }
  } else {
    annualTaxPayable = annualProfitBeforeTax * 0.24;
  }

  const netProfitAfterTax = Math.max(0, annualProfitBeforeTax - annualTaxPayable);
  const effectiveTaxRate = annualProfitBeforeTax > 0 ? (annualTaxPayable / annualProfitBeforeTax) * 100 : 0;
  const safeOwnerDividends = (netProfitAfterTax * ownerDividendPct) / 100;
  const retainedBusinessEarnings = netProfitAfterTax - safeOwnerDividends;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* 1. Header Banner */}
      <section className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200/90 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] font-mono font-bold text-slate-500 uppercase tracking-wider">
            <Briefcase className="w-3.5 h-3.5 text-blue-600" />
            <span>Strategi Portfolio Korporat & Percukaian Malaysia</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-display font-extrabold text-slate-900 tracking-tight">
            {isEn ? "Portfolio Margins & Tax Optimizer" : "Matriks Portfolio Produk & Pengoptimum Cukai"}
          </h2>
          <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
            {isEn 
              ? `Strategic product comparison, Malaysian Sales & Service Tax (SST 8%/6%) pricing structure, and SME Corporate Income Tax (LHDN) in ${currency}.`
              : `Perbandingan strategik portfolio produk, penstrukturan harga SST (8%/6%), dan anggaran cukai syarikat PKS (LHDN) dalam ${currency}.`}
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={handlePrint}
            className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer shadow-2xs"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{isEn ? "Print Summary" : "Cetak Ringkasan Cukai"}</span>
          </button>
        </div>
      </section>

      {/* 2. Multi-Product Portfolio Profitability Table */}
      <section className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200/90 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              <span>{isEn ? "Product Portfolio Margin Matrix" : "Matriks Margin Portfolio Produk Syarikat"}</span>
            </h3>
            <p className="text-xs text-slate-500">
              {isEn ? "Side-by-side profitability comparison of all products in your business database." : "Perbandingan keuntungan bagi semua produk dalam pangkalan data perniagaan."}
            </p>
          </div>
          <div className="text-xs font-mono font-bold px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg">
            {portfolioItems.length} {isEn ? "Products Registered" : "Produk Berdaftar"}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400 font-mono uppercase text-[10px] bg-slate-50/60">
                <th className="py-2.5 px-3">{isEn ? "Product Name" : "Nama Produk"}</th>
                <th className="py-2.5 px-3 text-right">{isEn ? "Selling Price" : "Harga Jual"}</th>
                <th className="py-2.5 px-3 text-right">{isEn ? "Var. Cost" : "Kos Berubah"}</th>
                <th className="py-2.5 px-3 text-right font-bold text-slate-700">{isEn ? "Margin/Unit" : "Margin/Unit"}</th>
                <th className="py-2.5 px-3 text-right font-bold text-slate-700">{isEn ? "Margin %" : "Margin %"}</th>
                <th className="py-2.5 px-3 text-right">{isEn ? "Target Qty" : "Sasaran Kuantiti"}</th>
                <th className="py-2.5 px-3 text-right font-bold text-emerald-700 bg-emerald-50/50">{isEn ? "Weekly Profit" : "Untung Mingguan"}</th>
                <th className="py-2.5 px-3 text-center">{isEn ? "Strategic Status" : "Klasifikasi"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
              {portfolioItems.map((item) => (
                <tr 
                  key={item.id} 
                  className={`hover:bg-slate-50/80 transition-colors ${item.isActive ? "bg-blue-50/40 font-semibold" : ""}`}
                >
                  <td className="py-2.5 px-3 font-sans font-bold text-slate-900 flex items-center gap-2">
                    <span>{item.name}</span>
                    {item.isActive && (
                      <span className="px-1.5 py-0.5 rounded bg-blue-600 text-white text-[9px] uppercase font-mono">
                        {isEn ? "Active" : "Aktif"}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right font-semibold text-slate-900">{f(item.price)}</td>
                  <td className="py-2.5 px-3 text-right text-slate-600">{f(item.totalVarUnit)}</td>
                  <td className="py-2.5 px-3 text-right font-bold text-blue-700">{f(item.marginUnit)}</td>
                  <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                    <span className={`px-2 py-0.5 rounded text-[11px] ${item.marginPct >= 40 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                      {item.marginPct.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-600">{item.targetQty} {item.unit}</td>
                  <td className="py-2.5 px-3 text-right font-bold text-emerald-800 bg-emerald-50/50">
                    +{f(item.weeklyProfitContribution)}
                  </td>
                  <td className="py-2.5 px-3 text-center font-sans">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${item.statusBadge.color}`}>
                      {item.statusBadge.label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. Malaysian SST Pricing Calculator & SME Corporate Income Tax */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200/90 shadow-2xs space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Receipt className="w-4 h-4 text-blue-600" />
              <span>{isEn ? "Malaysian SST & Pricing Structure" : "Struktur Harga & Cukai Jualan (SST)"}</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {isEn ? "Simulate customer invoice price and SST payable to Malaysian Royal Customs (JKDM)." : "Kira harga resit pengguna dan jumlah SST kena dibayar kepada Kastam JKDM."}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">{isEn ? "SST Tax Rate" : "Kadar Cukai SST"}</label>
              <select
                value={sstRate}
                onChange={(e) => setSstRate(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-hidden"
              >
                <option value={0}>{isEn ? "0% (SST Exempt / Basic Food)" : "0% (Dikecualikan / Makanan Asas)"}</option>
                <option value={6}>{isEn ? "6% (Standard F&B / Services)" : "6% (Standard Perkhidmatan / F&B)"}</option>
                <option value={8}>{isEn ? "8% (Standard 2024 Corporate Rate)" : "8% (Kadar Am 2024)"}</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">{isEn ? "Pricing Mode" : "Mod Paparan Harga"}</label>
              <select
                value={pricingMode}
                onChange={(e) => setPricingMode(e.target.value as any)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-hidden"
              >
                <option value="exclusive">{isEn ? "Tax Exclusive (+ SST on top)" : "Sebelum Cukai (+ SST ditambah)"}</option>
                <option value="inclusive">{isEn ? "Tax Inclusive (SST absorbed)" : "Termasuk Cukai (SST diserap)"}</option>
              </select>
            </div>
          </div>

          {/* Pricing Breakdown Cards */}
          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200/80 space-y-2 font-mono">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>{isEn ? "Base Price to Business:" : "Harga Asas Perniagaan:"}</span>
              <span className="font-bold text-slate-900">{f(netBusinessPrice)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>{isEn ? `SST (${sstRate}%) Payable to JKDM:` : `SST (${sstRate}%) Dibayar ke JKDM:`}</span>
              <span className="font-bold text-blue-700">+{f(sstAmountPerUnit)}</span>
            </div>
            <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-200 font-bold">
              <span className="text-slate-800">{isEn ? "Final Price Paid by Customer:" : "Harga Akhir Dibayar Pelanggan:"}</span>
              <span className="text-blue-900 text-sm font-extrabold">{f(customerPrice)}</span>
            </div>
          </div>
        </section>

        {/* 4. SME Corporate Income Tax (LHDN) Tier Estimator */}
        <section className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200/90 shadow-2xs space-y-4">
          <div className="pb-3 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Scale className="w-4 h-4 text-emerald-600" />
                <span>{isEn ? "Malaysian Corporate Income Tax (LHDN)" : "Anggaran Cukai Pendapatan Syarikat (LHDN)"}</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {isEn ? "Preferential SME tax tiers (15% first RM150k, 17% next RM450k, 24% standard)." : "Kadar cukai konsesi PKS (15% pertama RM150k, 17% berikutnya, 24% standard)."}
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                id="smeTier"
                checked={isSmeTaxTier}
                onChange={(e) => setIsSmeTaxTier(e.target.checked)}
                className="rounded text-emerald-600"
              />
              <label htmlFor="smeTier" className="font-semibold text-slate-700 cursor-pointer">{isEn ? "SME Tier" : "Kadar PKS"}</label>
            </div>
          </div>

          <div className="p-3.5 bg-emerald-50/70 rounded-lg border border-emerald-200/80 space-y-2 font-mono text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-600">{isEn ? "Annualized Profit Before Tax:" : "Unjuran Untung Kasar Setahun:"}</span>
              <span className="font-bold text-slate-900">{f(annualProfitBeforeTax)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">{isEn ? `Estimated LHDN Tax (${effectiveTaxRate.toFixed(1)}%):` : `Anggaran Cukai LHDN (${effectiveTaxRate.toFixed(1)}%):`}</span>
              <span className="font-bold text-rose-600">-{f(annualTaxPayable)}</span>
            </div>
            <div className="flex items-center justify-between pt-1.5 border-t border-emerald-200 text-xs font-bold">
              <span className="text-slate-800">{isEn ? "Net Profit After Tax (NPAT):" : "Untung Bersih Selepas Cukai:"}</span>
              <span className="text-emerald-800 text-sm font-extrabold">{f(netProfitAfterTax)}</span>
            </div>
          </div>

          {/* Owner Dividend & Retained Earnings Simulator */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700">{isEn ? "Safe Owner Drawings / Dividends:" : "Dividen Pemilik / Pengambilan Selamat:"}</span>
              <span className="font-mono font-bold text-blue-700">{ownerDividendPct}% = {f(safeOwnerDividends)}</span>
            </div>
            <input
              type="range"
              min={10}
              max={90}
              value={ownerDividendPct}
              onChange={(e) => setOwnerDividendPct(Number(e.target.value))}
              className="w-full accent-blue-600 cursor-pointer h-1.5"
            />
            <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
              <span>{isEn ? `Retained Business Reserves: ${f(retainedBusinessEarnings)}` : `Simpanan Syarikat: ${f(retainedBusinessEarnings)}`}</span>
              <span>{100 - ownerDividendPct}% {isEn ? "Reinvested" : "Dilabur Semula"}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
