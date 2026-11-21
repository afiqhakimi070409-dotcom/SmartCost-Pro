/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { KonfigurasiSistem, BahanMentah, BuruhLangsung, OverheadBerubah, OverheadTetap } from "../types";
import { RingkasanKos } from "../utils/costCalculations";
import { handleInputEnterKey } from "../utils/inputNavigation";
import { formatCurrencyRM } from "../utils/costCalculations";
import { 
  Calculator, 
  Copy, 
  Check, 
  Download, 
  Sparkles, 
  Utensils, 
  Clock, 
  DollarSign, 
  Building2, 
  FileText,
  X
} from "lucide-react";
import { Language, getTranslation, getStoredLanguage, formatLocalizedNumber, formatLocalizedDate, formatUnitLabel } from "../utils/i18n";

interface BatchQuotationSheetProps {
  config: KonfigurasiSistem;
  bahanMentah: BahanMentah[];
  buruhLangsung: BuruhLangsung[];
  overheadBerubah: OverheadBerubah[];
  overheadTetap: OverheadTetap[];
  stdSummary: RingkasanKos;
  actSummary: RingkasanKos;
  systemLang?: Language;
  onClose?: () => void;
}

export default function BatchQuotationSheet({
  config,
  bahanMentah,
  buruhLangsung,
  overheadBerubah,
  overheadTetap,
  stdSummary,
  actSummary,
  systemLang,
  onClose,
}: BatchQuotationSheetProps) {
  const lang: Language = systemLang || config.language || getStoredLanguage();
  const t = getTranslation(lang);
  const f = (val: number) => formatCurrencyRM(val, config.currency);
  const fNum = (val: number) => formatLocalizedNumber(val, lang, { maximumFractionDigits: 0 });
  const unitLabel = formatUnitLabel(config.unitProduk, lang);

  // Quotation form state
  const [clientName, setClientName] = useState<string>(t.batchQuotation.defaultClient);
  const [orderQty, setOrderQty] = useState<number>(300);
  const [targetMarginPct, setTargetMarginPct] = useState<number>(40);
  const [deliveryFee, setDeliveryFee] = useState<number>(50);
  const [customPackagingFee, setCustomPackagingFee] = useState<number>(30);
  const [expeditedFee, setExpeditedFee] = useState<number>(0);
  const [quotationNotes, setQuotationNotes] = useState<string>(
    lang === "en" ? "Payment terms: 50% deposit upon order confirmation, 50% upon delivery." : "Terma bayaran: Deposit 50% semasa tempahan, baki 50% semasa penghantaran."
  );
  const [copied, setCopied] = useState<boolean>(false);
  const [savedSuccessMsg, setSavedSuccessMsg] = useState<string>("");
  const [showSavedDrawer, setShowSavedDrawer] = useState<boolean>(false);

  const [savedQuotes, setSavedQuotes] = useState<Array<{
    id: string;
    clientName: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    grandTotal: number;
    marginPct: number;
    date: string;
    deliveryFee: number;
    packagingFee: number;
  }>>(() => {
    try {
      const stored = localStorage.getItem(`pengekosan_quotes_${config.namaSyarikat}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Unit costs from actual/standard data
  const unitMatCost = actSummary.bahanMentahSemangkuk > 0 ? actSummary.bahanMentahSemangkuk : stdSummary.bahanMentahSemangkuk;
  const unitLabCost = actSummary.buruhLangsungSemangkuk > 0 ? actSummary.buruhLangsungSemangkuk : stdSummary.buruhLangsungSemangkuk;
  const unitVohCost = actSummary.overheadBerubahSemangkuk > 0 ? actSummary.overheadBerubahSemangkuk : stdSummary.overheadBerubahSemangkuk;
  const unitVarCost = unitMatCost + unitLabCost + unitVohCost;

  // Batch Direct Calculations
  const validQty = Math.max(1, orderQty);
  const batchMaterialCost = unitMatCost * validQty;
  const batchLaborCost = unitLabCost * validQty;
  const batchVohCost = unitVohCost * validQty;
  const batchDirectCost = batchMaterialCost + batchLaborCost + batchVohCost;

  // Fixed Overhead Share Allocation
  const allocatedFixedCost = (actSummary.jumlahKosTetapMingguan > 0 ? actSummary.jumlahKosTetapMingguan : stdSummary.jumlahKosTetapMingguan) * (validQty / (config.sasaranKuantitiStandard || 1000));
  
  const totalProductionCost = batchDirectCost + allocatedFixedCost;
  const unitProductionCost = totalProductionCost / validQty;

  // Pricing based on target margin: Price = Cost / (1 - Margin%)
  const marginDecimal = Math.min(Math.max(targetMarginPct, 5), 85) / 100;
  const recommendedUnitPrice = unitProductionCost / (1 - marginDecimal);
  const regularRetailPrice = config.hargaJualanSebenar > 0 ? config.hargaJualanSebenar : config.hargaJualanStandard;

  const subtotalProducts = recommendedUnitPrice * validQty;
  const additionalFees = deliveryFee + customPackagingFee + expeditedFee;
  const grandTotalQuote = subtotalProducts + additionalFees;

  const projectedGrossProfit = grandTotalQuote - totalProductionCost;
  const effectiveMarginPct = grandTotalQuote > 0 ? (projectedGrossProfit / grandTotalQuote) * 100 : 0;

  // Bill of Materials scaling
  const batchBOM = bahanMentah.map((item) => {
    const requiredQty = item.stdKuantitiPerUnit * validQty;
    const itemCost = requiredQty * item.stdHargaPerUnit;
    return {
      id: item.id,
      nama: item.nama,
      unit: item.unit,
      requiredQty,
      rate: item.stdHargaPerUnit,
      itemCost,
    };
  });

  // Direct Labor scaling
  const batchLabor = buruhLangsung.map((item) => {
    const requiredHours = item.stdJamPerUnit * validQty;
    const itemCost = requiredHours * item.stdKadarPerJam;
    return {
      id: item.id,
      nama: item.nama,
      requiredHours,
      rate: item.stdKadarPerJam,
      itemCost,
    };
  });

  // Copy Quotation to Clipboard
  const handleCopyQuotation = () => {
    const formattedDate = formatLocalizedDate(new Date(), lang);
    const quoteText =
      lang === "en"
        ? `================================================
OFFICIAL COMMERCIAL QUOTATION
${config.namaSyarikat || "SMARTCOST ENTERPRISE"}
================================================
Date: ${formattedDate}
Client: ${clientName}
Product: ${config.namaProduk}
Quantity: ${validQty} ${unitLabel}

PRICING BREAKDOWN:
- Unit Price: ${f(recommendedUnitPrice)} / ${unitLabel} (Retail: ${f(regularRetailPrice)})
- Product Subtotal: ${f(subtotalProducts)}
- Delivery / Logistics: ${f(deliveryFee)}
- Custom Event Packaging: ${f(customPackagingFee)}
${expeditedFee > 0 ? `- Rush Order Surcharge: ${f(expeditedFee)}\n` : ""}- GRAND TOTAL QUOTE: ${f(grandTotalQuote)}

TERMS & NOTES:
${quotationNotes}
================================================
SmartCost Commercial Accounting Engine`
        : `================================================
SEBUT HARGA RASMI KOMERSIAL
${config.namaSyarikat || "SMARTCOST ENTERPRISE"}
================================================
Tarikh: ${formattedDate}
Pelanggan: ${clientName}
Produk: ${config.namaProduk}
Kuantiti: ${validQty} ${unitLabel}

PECAHAN HARGA:
- Harga Seunit: ${f(recommendedUnitPrice)} / ${unitLabel} (Runcit: ${f(regularRetailPrice)})
- Subjumlah Produk: ${f(subtotalProducts)}
- Penghantaran / Logistik: ${f(deliveryFee)}
- Pembungkusan Khas Acara: ${f(customPackagingFee)}
${expeditedFee > 0 ? `- Caj Pesanan Segera: ${f(expeditedFee)}\n` : ""}- JUMLAH KESELURUHAN SEBUT HARGA: ${f(grandTotalQuote)}

TERMA & NOTA:
${quotationNotes}
================================================
Enjin Perakaunan Komersial SmartCost`;

    navigator.clipboard.writeText(quoteText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // Save quotation to local history
  const handleSaveQuotation = () => {
    const newQuote = {
      id: "quote-" + Date.now(),
      clientName: clientName.trim() || (lang === "en" ? "Valued Client" : "Pelanggan"),
      productName: config.namaProduk,
      quantity: validQty,
      unitPrice: recommendedUnitPrice,
      grandTotal: grandTotalQuote,
      marginPct: targetMarginPct,
      date: formatLocalizedDate(new Date(), lang),
      deliveryFee,
      packagingFee: customPackagingFee,
    };
    const updated = [newQuote, ...savedQuotes.slice(0, 19)];
    setSavedQuotes(updated);
    try {
      localStorage.setItem(`pengekosan_quotes_${config.namaSyarikat}`, JSON.stringify(updated));
    } catch {}
    setSavedSuccessMsg(lang === "en" ? "Quotation saved to history!" : "Sebut harga berjaya disimpan ke rekod!");
    setTimeout(() => setSavedSuccessMsg(""), 3500);
  };

  const handleLoadSavedQuote = (q: typeof savedQuotes[0]) => {
    setClientName(q.clientName);
    setOrderQty(q.quantity);
    setTargetMarginPct(q.marginPct);
    setDeliveryFee(q.deliveryFee || 0);
    setCustomPackagingFee(q.packagingFee || 0);
    setShowSavedDrawer(false);
  };

  const handleDeleteSavedQuote = (id: string) => {
    const updated = savedQuotes.filter((q) => q.id !== id);
    setSavedQuotes(updated);
    try {
      localStorage.setItem(`pengekosan_quotes_${config.namaSyarikat}`, JSON.stringify(updated));
    } catch {}
  };

  // Download Bill of Materials as CSV
  const handleDownloadBOM = () => {
    const headers = lang === "en"
      ? "Ingredient,Required Quantity,Unit,Unit Price,Total Cost\n"
      : "Bahan Mentah,Kuantiti Diperlukan,Unit,Harga Seunit,Jumlah Kos\n";
    const rows = batchBOM.map(b => `"${b.nama}",${b.requiredQty.toFixed(2)},"${b.unit}",${b.rate.toFixed(2)},${b.itemCost.toFixed(2)}`).join("\n");
    const csvContent = "data:text/csv;charset=utf-8," + encodeURIComponent(headers + rows);
    const link = document.createElement("a");
    link.setAttribute("href", csvContent);
    link.setAttribute("download", `BOM_Order_${clientName.replace(/[^a-z0-9]/gi, "_")}_${validQty}units.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Save Success Banner */}
      {savedSuccessMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-xl text-xs font-bold flex items-center gap-2 animate-fadeIn">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>{savedSuccessMsg}</span>
        </div>
      )}

      {/* 1. EXECUTIVE HEADER BANNER */}
      <section className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200/90 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] font-mono font-bold text-slate-500 uppercase tracking-wider">
            <Calculator className="w-3.5 h-3.5 text-blue-600" />
            <span>{lang === "en" ? "B2B Bulk Quotation & Wholesale Contract Engine" : "Kalkulator Sebut Harga Pukal B2B & Kontrak Borong"}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-display font-extrabold text-slate-900 tracking-tight">
            {lang === "en" ? "B2B Bulk Order & Wholesale Quotation Calculator" : "Sebut Harga & Pengiraan Pesanan Pukal Korporat"}
          </h2>
          <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
            {lang === "en"
              ? "Accurately compute batch contract pricing based on live ingredient yield, labor allocation, and targeted operating margins."
              : "Jana sebut harga menguntungkan untuk pesanan katering, kontrak borong, dan majlis korporat berpandukan kos bahan mentah, waktu buruh, dan sasaran margin."}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={handleSaveQuotation}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
            title={lang === "en" ? "Save quotation to company history" : "Simpan sebut harga ke rekod syarikat"}
          >
            <span>{lang === "en" ? "Save Quote" : "Simpan Draf"}</span>
          </button>

          {savedQuotes.length > 0 && (
            <button
              onClick={() => setShowSavedDrawer(!showSavedDrawer)}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold border border-slate-200 flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
            >
              <span>{lang === "en" ? `History (${savedQuotes.length})` : `Rekod (${savedQuotes.length})`}</span>
            </button>
          )}

          <button
            onClick={handleCopyQuotation}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer shadow-2xs"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-sky-400" />}
            <span>{copied ? (lang === "en" ? "Copied" : "Disalin") : (lang === "en" ? "Copy Quote" : "Salin Sebut Harga")}</span>
          </button>
          
          <button
            onClick={handleDownloadBOM}
            className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold border border-slate-200 flex items-center gap-2 transition-all cursor-pointer shadow-2xs"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>{lang === "en" ? "Export BOM" : "Eksport Resipi"}</span>
          </button>

          <button
            onClick={() => window.print()}
            className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold border border-slate-200 flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
            title={lang === "en" ? "Print or save as PDF" : "Cetak atau simpan sebagai PDF"}
          >
            <span>{lang === "en" ? "Print" : "Cetak"}</span>
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

      {/* Saved Quotes Drawer / Modal View */}
      {showSavedDrawer && (
        <section className="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-xs space-y-3 animate-fadeIn">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200">
            <span className="text-xs font-bold font-mono text-slate-700 uppercase">
              {lang === "en" ? "Saved Commercial Quotations" : "Senarai Sebut Harga Tersimpan"}
            </span>
            <button
              onClick={() => setShowSavedDrawer(false)}
              className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer font-bold"
            >
              ✕
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {savedQuotes.map((q) => (
              <div key={q.id} className="p-3 bg-white rounded-lg border border-slate-200 space-y-2 flex flex-col justify-between shadow-2xs">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-900 truncate max-w-[160px]">{q.clientName}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{q.date}</span>
                  </div>
                  <div className="text-xs text-slate-600 mt-1">
                    <span>{fNum(q.quantity)} {unitLabel}</span> · <span className="font-mono font-bold text-emerald-700">{f(q.grandTotal)}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <button
                    onClick={() => handleLoadSavedQuote(q)}
                    className="text-[11px] font-bold text-blue-600 hover:text-blue-800 cursor-pointer"
                  >
                    {lang === "en" ? "Load Quote" : "Muat Semula"}
                  </button>
                  <button
                    onClick={() => handleDeleteSavedQuote(q.id)}
                    className="text-[11px] text-rose-500 hover:text-rose-700 cursor-pointer"
                  >
                    {lang === "en" ? "Delete" : "Padam"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 2. MAIN 2-COLUMN WORKSPACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Order Parameters Form (5 Cols) */}
        <div className="lg:col-span-5 space-y-6">
          <section className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-600" />
                <span>{lang === "en" ? "Client & Order Specifications" : "Spesifikasi Pelanggan & Pesanan"}</span>
              </h3>
              <span className="text-[10px] font-mono text-slate-400 uppercase">{t.batchQuotation.inputParams}</span>
            </div>

            {/* Client / Event Name */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700">
                {lang === "en" ? "Client / Company Name" : "Nama Pelanggan / Syarikat"}
              </label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                onKeyDown={(e) => handleInputEnterKey(e)}
                placeholder={t.batchQuotation.clientPlaceholder}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-600 rounded-lg text-xs font-medium text-slate-800 outline-hidden transition-all"
              />
            </div>

            {/* Order Quantity & Target Margin */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  {lang === "en" ? "Batch Quantity" : "Kuantiti Pukal"} ({unitLabel})
                </label>
                <input
                  type="number"
                  min="1"
                  value={orderQty}
                  onChange={(e) => setOrderQty(Math.max(1, parseInt(e.target.value) || 0))}
                  onKeyDown={(e) => handleInputEnterKey(e)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-600 rounded-lg text-xs font-bold font-mono text-slate-900 outline-hidden transition-all"
                />
                {/* Quick Volume Preset Chips */}
                <div className="flex flex-wrap gap-1 pt-1">
                  {[50, 100, 200, 300, 500, 1000].map((qtyVal) => (
                    <button
                      key={qtyVal}
                      type="button"
                      onClick={() => setOrderQty(qtyVal)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all cursor-pointer ${
                        orderQty === qtyVal
                          ? "bg-[#0b3c7a] text-white shadow-2xs"
                          : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                      }`}
                    >
                      {qtyVal}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  {lang === "en" ? "Target Margin (%)" : "Sasaran Margin (%)"}
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="5"
                    max="80"
                    value={targetMarginPct}
                    onChange={(e) => setTargetMarginPct(Math.max(5, Math.min(80, parseInt(e.target.value) || 0)))}
                    onKeyDown={(e) => handleInputEnterKey(e)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-600 rounded-lg text-xs font-bold font-mono text-slate-900 outline-hidden transition-all"
                  />
                  <span className="absolute inset-y-0 right-0 flex items-center pr-3 font-mono text-xs text-slate-400 font-bold">
                    %
                  </span>
                </div>
                {/* Quick Margin Preset Chips */}
                <div className="flex flex-wrap gap-1 pt-1">
                  {[30, 35, 40, 45, 50].map((mVal) => (
                    <button
                      key={mVal}
                      type="button"
                      onClick={() => setTargetMarginPct(mVal)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all cursor-pointer ${
                        targetMarginPct === mVal
                          ? "bg-emerald-700 text-white shadow-2xs"
                          : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                      }`}
                    >
                      {mVal}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Additional Surcharges Section */}
            <div className="pt-3 border-t border-slate-100 space-y-2.5">
              <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block">
                {lang === "en" ? "Additional Service Fees & Surcharges" : "Caj Tambahan & Logistik"}
              </span>

              <div className="grid grid-cols-3 gap-2.5">
                <div className="space-y-1">
                  <label className="block text-[10px] font-mono text-slate-500 uppercase">{lang === "en" ? "Delivery" : "Logistik"}</label>
                  <input
                    type="number"
                    value={deliveryFee}
                    onChange={(e) => setDeliveryFee(Math.max(0, parseFloat(e.target.value) || 0))}
                    onKeyDown={(e) => handleInputEnterKey(e)}
                    className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-800"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-mono text-slate-500 uppercase">{lang === "en" ? "Packaging" : "Kotak Khas"}</label>
                  <input
                    type="number"
                    value={customPackagingFee}
                    onChange={(e) => setCustomPackagingFee(Math.max(0, parseFloat(e.target.value) || 0))}
                    onKeyDown={(e) => handleInputEnterKey(e)}
                    className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-800"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-mono text-slate-500 uppercase">{lang === "en" ? "Rush Order" : "Caj Segera"}</label>
                  <input
                    type="number"
                    value={expeditedFee}
                    onChange={(e) => setExpeditedFee(Math.max(0, parseFloat(e.target.value) || 0))}
                    onKeyDown={(e) => handleInputEnterKey(e)}
                    className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-800"
                  />
                </div>
              </div>
            </div>

            {/* Terms & Notes */}
            <div className="space-y-1 pt-2 border-t border-slate-100">
              <label className="block text-xs font-semibold text-slate-700">
                {lang === "en" ? "Quotation Terms & Conditions" : "Terma Sebut Harga & Syarat Pembayaran"}
              </label>
              <textarea
                rows={2}
                value={quotationNotes}
                onChange={(e) => setQuotationNotes(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-600 rounded-lg text-xs text-slate-800 outline-hidden transition-all"
              />
            </div>
          </section>

          {/* Bill of Materials Scaling Checklist */}
          <section className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h4 className="text-xs font-bold text-slate-900 flex items-center gap-2">
                <Utensils className="w-3.5 h-3.5 text-blue-600" />
                <span>
                  {lang === "en"
                    ? `Bill of Materials (BOM) for ${validQty} ${unitLabel}`
                    : `Senarai Bahan (BOM) untuk ${validQty} ${unitLabel}`}
                </span>
              </h4>
              <span className="text-xs font-mono font-bold text-slate-700 tabular-nums">
                {f(batchMaterialCost)}
              </span>
            </div>

            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1 text-xs">
              {batchBOM.map((b) => (
                <div key={b.id} className="flex items-center justify-between p-2 bg-slate-50/80 rounded-lg border border-slate-100">
                  <div className="min-w-0 pr-2">
                    <span className="font-semibold text-slate-800 block truncate">{b.nama}</span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {fNum(b.requiredQty)} {b.unit} @ {config.currency}{b.rate.toFixed(2)}
                    </span>
                  </div>
                  <span className="font-mono font-bold text-slate-900 tabular-nums shrink-0">
                    {f(b.itemCost)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right Column: Formal Quotation Preview & Financial Return (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Formal Commercial Quotation Invoice Card */}
          <section className="bg-white rounded-xl border border-slate-300 p-6 shadow-xs space-y-5">
            {/* Header Lockup */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <span className="text-[10px] font-mono font-bold text-blue-700 tracking-wider uppercase block">
                  {t.batchQuotation.officialHeader}
                </span>
                <h3 className="text-lg font-display font-extrabold text-slate-900 uppercase tracking-tight mt-0.5">
                  {config.namaSyarikat || "SMARTCOST ENTERPRISE"}
                </h3>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                  {t.batchQuotation.refLabel} QT-{Date.now().toString().slice(-6)} · {t.batchQuotation.dateLabel} {formatLocalizedDate(new Date(), lang)}
                </p>
              </div>

              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 sm:text-right shrink-0">
                <span className="text-[10px] font-mono text-slate-400 block uppercase">{t.batchQuotation.recipientLabel}</span>
                <span className="font-bold text-xs text-slate-900 block truncate max-w-[200px]">
                  {clientName || t.batchQuotation.defaultClient}
                </span>
              </div>
            </div>

            {/* Line Items Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] font-mono text-slate-500 uppercase bg-slate-50/60">
                    <th className="py-2 px-3">{t.batchQuotation.itemCol}</th>
                    <th className="py-2 px-3 text-center">{t.batchQuotation.qtyCol}</th>
                    <th className="py-2 px-3 text-right">{t.batchQuotation.unitPriceCol}</th>
                    <th className="py-2 px-3 text-right">{t.batchQuotation.totalCol} ({config.currency})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  <tr>
                    <td className="py-2.5 px-3 font-sans">
                      <div className="font-bold text-slate-900 text-xs">{config.namaProduk}</div>
                      <div className="text-[10px] text-slate-400 font-sans mt-0.5">
                        {t.batchQuotation.quoteNote}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-center text-slate-700 font-bold tabular-nums">
                      {fNum(validQty)} {unitLabel}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-slate-900 tabular-nums">
                      {f(recommendedUnitPrice)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-extrabold text-slate-900 tabular-nums">
                      {f(subtotalProducts)}
                    </td>
                  </tr>

                  {deliveryFee > 0 && (
                    <tr>
                      <td className="py-2 px-3 font-sans text-slate-700 text-xs">
                        {lang === "en" ? "Logistics & Delivery Surcharge" : "Caj Logistik & Penghantaran"}
                      </td>
                      <td className="py-2 px-3 text-center text-slate-500">
                        {t.batchQuotation.oneTrip}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-600 tabular-nums">{f(deliveryFee)}</td>
                      <td className="py-2 px-3 text-right font-bold text-slate-800 tabular-nums">{f(deliveryFee)}</td>
                    </tr>
                  )}

                  {customPackagingFee > 0 && (
                    <tr>
                      <td className="py-2 px-3 font-sans text-slate-700 text-xs">
                        {lang === "en" ? "Custom Packaging & Presentation Boxes" : "Kotak Khas & Pembungkusan Acara"}
                      </td>
                      <td className="py-2 px-3 text-center text-slate-500">
                        {lang === "en" ? "1 Pkg" : "1 Pakej"}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-600 tabular-nums">{f(customPackagingFee)}</td>
                      <td className="py-2 px-3 text-right font-bold text-slate-800 tabular-nums">{f(customPackagingFee)}</td>
                    </tr>
                  )}

                  {expeditedFee > 0 && (
                    <tr>
                      <td className="py-2 px-3 font-sans text-slate-700 text-xs">
                        {lang === "en" ? "Rush Order Priority Fee" : "Caj Pesanan Segera (Rush Order)"}
                      </td>
                      <td className="py-2 px-3 text-center text-slate-500">
                        {lang === "en" ? "1 Fee" : "1 Yuran"}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-600 tabular-nums">{f(expeditedFee)}</td>
                      <td className="py-2 px-3 text-right font-bold text-slate-800 tabular-nums">{f(expeditedFee)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Grand Total Box */}
            <div className="bg-slate-900 rounded-lg p-4 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-[10px] font-mono tracking-wider text-slate-400 uppercase block">
                  {lang === "en" ? "CONTRACT INVOICE GRAND TOTAL" : "JUMLAH KESELURUHAN INVOIS KONTRAK"}
                </span>
                <span className="text-2xl font-display font-extrabold tracking-tight text-white font-mono tabular-nums">
                  {f(grandTotalQuote)}
                </span>
              </div>
              <div className="sm:text-right">
                <span className="text-[10px] font-mono text-sky-400 block uppercase font-bold">
                  {lang === "en" ? "EQUIVALENT RETAIL VALUE" : "NILAI RUNCIT SETARA"}
                </span>
                <span className="text-xs font-mono text-slate-300">
                  {f(regularRetailPrice * validQty)}
                </span>
              </div>
            </div>

            {/* Quotation Footer Notes */}
            <div className="text-xs text-slate-600 pt-2 border-t border-slate-100 space-y-1">
              <span className="font-bold text-slate-800 block text-[10px] font-mono uppercase">
                {lang === "en" ? "Payment & Acceptance Terms:" : "Syarat Pembayaran & Penerimaan:"}
              </span>
              <p className="italic text-[11px] leading-relaxed text-slate-500">{quotationNotes}</p>
            </div>
          </section>

          {/* Internal Profitability & Margin Health Card */}
          <section className="bg-emerald-50/60 border border-emerald-200/90 rounded-xl p-5 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-emerald-950 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-emerald-700" />
                <span>
                  {lang === "en" ? "Contract Net Profit & Margin Analysis" : "Analisis Margin & Keuntungan Bersih Kontrak"}
                </span>
              </h4>
              <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded font-mono font-bold text-xs">
                {t.batchQuotation.marginLabel} {effectiveMarginPct.toFixed(1)}%
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono">
              <div className="p-2.5 bg-white rounded-lg border border-emerald-100">
                <span className="text-[10px] text-slate-400 uppercase block">
                  {lang === "en" ? "Variable Cost" : "Kos Berubah"}
                </span>
                <span className="font-bold text-slate-900 tabular-nums">{f(batchDirectCost)}</span>
              </div>

              <div className="p-2.5 bg-white rounded-lg border border-emerald-100">
                <span className="text-[10px] text-slate-400 uppercase block">
                  {lang === "en" ? "Unit Cost" : "Kos Seunit"}
                </span>
                <span className="font-bold text-slate-900 tabular-nums">{f(unitVarCost)}</span>
              </div>

              <div className="p-2.5 bg-white rounded-lg border border-emerald-100">
                <span className="text-[10px] text-slate-400 uppercase block">
                  {lang === "en" ? "Fixed Overhead" : "Overhead Tetap"}
                </span>
                <span className="font-bold text-slate-900 tabular-nums">{f(allocatedFixedCost)}</span>
              </div>

              <div className="p-2.5 bg-white rounded-lg border border-emerald-100">
                <span className="text-[10px] text-emerald-700 uppercase block font-bold">
                  {lang === "en" ? "Net Profit" : "Untung Bersih"}
                </span>
                <span className="font-extrabold text-emerald-800 text-xs tabular-nums">{f(projectedGrossProfit)}</span>
              </div>
            </div>

            <p className="text-xs text-emerald-900/80 leading-relaxed">
              {lang === "en" ? (
                <>
                  This order yields a net contribution of <strong className="font-mono">{f(projectedGrossProfit)}</strong> after covering all raw ingredients, direct labor, and fixed overhead absorption.
                </>
              ) : (
                <>
                  Pesanan ini menjana caruman bersih sebanyak <strong className="font-mono">{f(projectedGrossProfit)}</strong> setelah menolak keseluruhan kos bahan mentah, buruh langsung, dan perkongsian overhead tetap.
                </>
              )}
            </p>
          </section>

        </div>

      </div>
    </div>
  );
}
