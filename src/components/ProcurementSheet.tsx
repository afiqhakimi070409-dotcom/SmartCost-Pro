/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { BahanMentah, KonfigurasiSistem, Language } from "../types";
import { getTranslation, formatLocalizedNumber, formatUnitLabel } from "../utils/i18n";
import { 
  Truck, 
  Check, 
  Boxes
} from "lucide-react";

interface ProcurementSheetProps {
  config: KonfigurasiSistem;
  bahanMentah: BahanMentah[];
  onUpdateBahanMentah?: (updatedList: BahanMentah[]) => void;
  systemLang?: Language;
}

interface SupplierQuote {
  supplierName: string;
  pricePerUnit: number;
  moq: number;
  deliveryFee: number;
  leadTimeDays: number;
  paymentTerm: string;
  bulkDiscountPercent: number;
  bulkMinQty: number;
  notes: string;
}

export const ProcurementSheet: React.FC<ProcurementSheetProps> = ({
  config,
  bahanMentah,
  onUpdateBahanMentah,
  systemLang = "en",
}) => {
  const isEn = systemLang === "en";
  const t = getTranslation(systemLang);
  const currency = config.currency || "RM";
  const f = (val: number) => `${currency} ${formatLocalizedNumber(val, systemLang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Active selected material to benchmark
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>(
    bahanMentah[0]?.id || ""
  );

  const selectedMaterial = bahanMentah.find((m) => m.id === selectedMaterialId) || bahanMentah[0];

  // 3 Comparison Suppliers
  const [suppliers, setSuppliers] = useState<Record<string, SupplierQuote>>({
    current: {
      supplierName: isEn ? "Current Primary Supplier" : "Pembekal Utama Semasa",
      pricePerUnit: selectedMaterial?.stdHargaPerUnit || 1.0,
      moq: 10,
      deliveryFee: 15,
      leadTimeDays: 2,
      paymentTerm: isEn ? "COD / 7 Days" : "Tunai / 7 Hari",
      bulkDiscountPercent: 0,
      bulkMinQty: 0,
      notes: isEn ? "Reliable delivery, standard retail pricing" : "Penghantaran pantas, harga runcit biasa",
    },
    supplierB: {
      supplierName: isEn ? "Regional Wholesaler (Supplier B)" : "Pemborong Negeri (Pembekal B)",
      pricePerUnit: Math.max(0.01, (selectedMaterial?.stdHargaPerUnit || 1.0) * 0.88),
      moq: 100,
      deliveryFee: 30,
      leadTimeDays: 4,
      paymentTerm: isEn ? "Net 14 Days" : "Kredit 14 Hari",
      bulkDiscountPercent: 5,
      bulkMinQty: 250,
      notes: isEn ? "Requires larger storage space, bulk savings" : "Perlukan ruang simpanan lebih besar",
    },
    supplierC: {
      supplierName: isEn ? "Direct Manufacturer / Mill (Supplier C)" : "Pengilang / Kilang Terus (Pembekal C)",
      pricePerUnit: Math.max(0.01, (selectedMaterial?.stdHargaPerUnit || 1.0) * 0.75),
      moq: 500,
      deliveryFee: 80,
      leadTimeDays: 7,
      paymentTerm: isEn ? "Net 30 Days" : "Kredit 30 Hari",
      bulkDiscountPercent: 8,
      bulkMinQty: 1000,
      notes: isEn ? "Direct factory contract, lowest unit cost" : "Kontrak terus kilang, kos paling rendah",
    },
  });

  const [appliedSuccess, setAppliedSuccess] = useState<boolean>(false);

  const handleSelectMaterial = (id: string) => {
    setSelectedMaterialId(id);
    const mat = bahanMentah.find((m) => m.id === id);
    if (!mat) return;

    setSuppliers({
      current: {
        ...suppliers.current,
        pricePerUnit: mat.stdHargaPerUnit,
      },
      supplierB: {
        ...suppliers.supplierB,
        pricePerUnit: Math.max(0.01, Number((mat.stdHargaPerUnit * 0.88).toFixed(2))),
      },
      supplierC: {
        ...suppliers.supplierC,
        pricePerUnit: Math.max(0.01, Number((mat.stdHargaPerUnit * 0.75).toFixed(2))),
      },
    });
  };

  const handleUpdateSupplier = (
    key: "current" | "supplierB" | "supplierC",
    field: keyof SupplierQuote,
    value: any
  ) => {
    setSuppliers((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value,
      },
    }));
  };

  const targetBatch = config.sasaranKuantitiStandard || 1000;
  const unitRequiredPerOutput = selectedMaterial?.stdKuantitiPerUnit || 1;
  const totalWeeklyMaterialNeeded = targetBatch * unitRequiredPerOutput;

  const calculateEffectiveUnitCost = (quote: SupplierQuote) => {
    const basePrice = quote.pricePerUnit;
    const deliveryPerUnit = totalWeeklyMaterialNeeded > 0 ? quote.deliveryFee / totalWeeklyMaterialNeeded : 0;
    return basePrice + deliveryPerUnit;
  };

  const currentLanded = calculateEffectiveUnitCost(suppliers.current);
  const supplierBLanded = calculateEffectiveUnitCost(suppliers.supplierB);
  const supplierCLanded = calculateEffectiveUnitCost(suppliers.supplierC);

  const weeklyCostCurrent = currentLanded * totalWeeklyMaterialNeeded;
  const weeklyCostB = supplierBLanded * totalWeeklyMaterialNeeded;
  const weeklyCostC = supplierCLanded * totalWeeklyMaterialNeeded;

  const weeklySavingsB = Math.max(0, weeklyCostCurrent - weeklyCostB);
  const annualSavingsB = weeklySavingsB * 52;

  const weeklySavingsC = Math.max(0, weeklyCostCurrent - weeklyCostC);
  const annualSavingsC = weeklySavingsC * 52;

  const handleApplyRate = (quote: SupplierQuote) => {
    if (!onUpdateBahanMentah || !selectedMaterial) return;
    const updated = bahanMentah.map((m) => {
      if (m.id === selectedMaterial.id) {
        return {
          ...m,
          stdHargaPerUnit: Number(quote.pricePerUnit.toFixed(2)),
        };
      }
      return m;
    });
    onUpdateBahanMentah(updated);
    setAppliedSuccess(true);
    setTimeout(() => setAppliedSuccess(false), 3500);
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* 1. Executive Banner */}
      <section className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200/90 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] font-mono font-bold text-slate-500 uppercase tracking-wider">
            <Truck className="w-3.5 h-3.5 text-blue-600" />
            <span>{t.procurement.title}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-display font-extrabold text-slate-900 tracking-tight">
            {isEn ? "Supplier Quotation & Cost Benchmark" : "Perbandingan Sebut Harga Pembekal & Penjimatan"}
          </h2>
          <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
            {isEn 
              ? `Benchmark 3 competing vendor quotations for raw materials in ${currency}. Analyze landed costs, MOQs, and apply negotiated rates to your standard costing sheet.`
              : `Bandingkan 3 sebut harga pembekal untuk bahan mentah dalam ${currency}. Nilai penjimatan bersih, MOQ, dan kemas kini harga terbaik ke lembaran kos piawai.`}
          </p>
        </div>

        {appliedSuccess && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-bold animate-fadeIn shrink-0">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>{isEn ? "Rate Applied to Standard Cost" : "Harga Dikemas Kini ke Kos Standard"}</span>
          </div>
        )}
      </section>

      {/* 2. Material Selector Header */}
      <section className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200/90 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-50 rounded-lg text-blue-600">
            <Boxes className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold block">
              {isEn ? "Select Material to Benchmark" : "Pilih Bahan Mentah Untuk Dinilai"}
            </span>
            <div className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>{selectedMaterial?.nama || (isEn ? "Raw Material" : "Bahan Mentah")}</span>
              <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 font-mono text-slate-600 font-semibold">
                {formatUnitLabel(selectedMaterial?.unit, systemLang)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedMaterialId}
            onChange={(e) => handleSelectMaterial(e.target.value)}
            className="px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:bg-white focus:border-blue-500 outline-hidden cursor-pointer"
          >
            {bahanMentah.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nama} ({currency}{m.stdHargaPerUnit.toFixed(2)} / {m.unit})
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* 3. 3-Supplier Comparison Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Supplier 1: Current */}
        <div className="bg-white rounded-xl p-5 border border-slate-200/90 shadow-2xs space-y-4 flex flex-col justify-between">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
              <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-mono font-bold uppercase">
                {isEn ? "Baseline (Current)" : "Asas Semasa"}
              </span>
              <span className="text-xs font-mono text-slate-400">#01</span>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase font-mono">{isEn ? "Supplier Name" : "Nama Pembekal"}</label>
              <input
                type="text"
                value={suppliers.current.supplierName}
                onChange={(e) => handleUpdateSupplier("current", "supplierName", e.target.value)}
                className="w-full mt-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-hidden"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">{isEn ? "Base Price" : "Harga Asas"}</label>
                <div className="relative mt-1">
                  <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-xs font-mono text-slate-400">{currency}</span>
                  <input
                    type="number"
                    step="0.01"
                    value={suppliers.current.pricePerUnit}
                    onChange={(e) => handleUpdateSupplier("current", "pricePerUnit", Number(e.target.value))}
                    className="w-full pl-8 pr-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-800 outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">{isEn ? "Delivery Fee" : "Kos Hantar"}</label>
                <div className="relative mt-1">
                  <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-xs font-mono text-slate-400">{currency}</span>
                  <input
                    type="number"
                    value={suppliers.current.deliveryFee}
                    onChange={(e) => handleUpdateSupplier("current", "deliveryFee", Number(e.target.value))}
                    className="w-full pl-8 pr-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-800 outline-hidden"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-mono block">{isEn ? "MOQ" : "MOQ (Min)"}</span>
                <input
                  type="number"
                  value={suppliers.current.moq}
                  onChange={(e) => handleUpdateSupplier("current", "moq", Number(e.target.value))}
                  className="w-full mt-1 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-semibold"
                />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-mono block">{isEn ? "Lead Time (d)" : "Masa (Hari)"}</span>
                <input
                  type="number"
                  value={suppliers.current.leadTimeDays}
                  onChange={(e) => handleUpdateSupplier("current", "leadTimeDays", Number(e.target.value))}
                  className="w-full mt-1 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-semibold"
                />
              </div>
            </div>

            {/* Landed Summary */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{isEn ? "Landed Cost / Unit:" : "Kos Bersih / Unit:"}</span>
                <span className="font-mono font-bold text-slate-900">{f(currentLanded)}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{isEn ? "Weekly Outlay:" : "Kos Seminggu:"}</span>
                <span className="font-mono font-bold text-slate-900">{f(weeklyCostCurrent)}</span>
              </div>
            </div>
          </div>

          <div className="pt-2.5 border-t border-slate-100 text-center">
            <span className="text-[11px] text-slate-400">
              {isEn ? "Current benchmark baseline" : "Penanda aras kos semasa"}
            </span>
          </div>
        </div>

        {/* Supplier 2: Wholesaler B */}
        <div className="bg-white rounded-xl p-5 border border-blue-200 shadow-2xs space-y-4 flex flex-col justify-between relative">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-mono font-bold uppercase">
                {isEn ? "Option B (Wholesaler)" : "Pilihan B (Pemborong)"}
              </span>
              <span className="text-[10px] font-mono font-bold text-blue-600 uppercase">{t.procurement.recommended}</span>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase font-mono">{isEn ? "Supplier Name" : "Nama Pembekal"}</label>
              <input
                type="text"
                value={suppliers.supplierB.supplierName}
                onChange={(e) => handleUpdateSupplier("supplierB", "supplierName", e.target.value)}
                className="w-full mt-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-hidden"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">{isEn ? "Base Price" : "Harga Asas"}</label>
                <div className="relative mt-1">
                  <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-xs font-mono text-slate-400">{currency}</span>
                  <input
                    type="number"
                    step="0.01"
                    value={suppliers.supplierB.pricePerUnit}
                    onChange={(e) => handleUpdateSupplier("supplierB", "pricePerUnit", Number(e.target.value))}
                    className="w-full pl-8 pr-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-blue-700 outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">{isEn ? "Delivery Fee" : "Kos Hantar"}</label>
                <div className="relative mt-1">
                  <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-xs font-mono text-slate-400">{currency}</span>
                  <input
                    type="number"
                    value={suppliers.supplierB.deliveryFee}
                    onChange={(e) => handleUpdateSupplier("supplierB", "deliveryFee", Number(e.target.value))}
                    className="w-full pl-8 pr-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-800 outline-hidden"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-mono block">{isEn ? "MOQ" : "MOQ (Min)"}</span>
                <input
                  type="number"
                  value={suppliers.supplierB.moq}
                  onChange={(e) => handleUpdateSupplier("supplierB", "moq", Number(e.target.value))}
                  className="w-full mt-1 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-semibold"
                />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-mono block">{isEn ? "Lead Time (d)" : "Masa (Hari)"}</span>
                <input
                  type="number"
                  value={suppliers.supplierB.leadTimeDays}
                  onChange={(e) => handleUpdateSupplier("supplierB", "leadTimeDays", Number(e.target.value))}
                  className="w-full mt-1 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-semibold"
                />
              </div>
            </div>

            {/* Savings Box */}
            <div className="p-3 bg-blue-50/80 rounded-lg border border-blue-200 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 font-semibold">{isEn ? "Landed Cost / Unit:" : "Kos Bersih / Unit:"}</span>
                <span className="font-mono font-bold text-blue-900">{f(supplierBLanded)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 font-semibold">{isEn ? "Weekly Savings:" : "Penjimatan Mingguan:"}</span>
                <span className="font-mono font-bold text-emerald-600">+{f(weeklySavingsB)}</span>
              </div>
              <div className="flex items-center justify-between text-xs pt-1 border-t border-blue-200/60">
                <span className="text-slate-700 font-bold">{isEn ? "Annual Savings:" : "Penjimatan Setahun:"}</span>
                <span className="font-mono font-extrabold text-emerald-700">+{f(annualSavingsB)}</span>
              </div>
            </div>
          </div>

          <button
            onClick={() => handleApplyRate(suppliers.supplierB)}
            className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs mt-2"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{isEn ? "Apply Rate to Standard" : "Guna Harga Dalam Kos Standard"}</span>
          </button>
        </div>

        {/* Supplier 3: Direct Factory C */}
        <div className="bg-white rounded-xl p-5 border border-emerald-200 shadow-2xs space-y-4 flex flex-col justify-between relative">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
              <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-mono font-bold uppercase">
                {isEn ? "Option C (Factory Direct)" : "Pilihan C (Kilang Terus)"}
              </span>
              <span className="text-[10px] font-mono font-bold text-emerald-700 uppercase">{t.procurement.maximum}</span>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase font-mono">{isEn ? "Supplier Name" : "Nama Pembekal"}</label>
              <input
                type="text"
                value={suppliers.supplierC.supplierName}
                onChange={(e) => handleUpdateSupplier("supplierC", "supplierName", e.target.value)}
                className="w-full mt-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-hidden"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">{isEn ? "Base Price" : "Harga Asas"}</label>
                <div className="relative mt-1">
                  <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-xs font-mono text-slate-400">{currency}</span>
                  <input
                    type="number"
                    step="0.01"
                    value={suppliers.supplierC.pricePerUnit}
                    onChange={(e) => handleUpdateSupplier("supplierC", "pricePerUnit", Number(e.target.value))}
                    className="w-full pl-8 pr-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-emerald-700 outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">{isEn ? "Delivery Fee" : "Kos Hantar"}</label>
                <div className="relative mt-1">
                  <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-xs font-mono text-slate-400">{currency}</span>
                  <input
                    type="number"
                    value={suppliers.supplierC.deliveryFee}
                    onChange={(e) => handleUpdateSupplier("supplierC", "deliveryFee", Number(e.target.value))}
                    className="w-full pl-8 pr-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-800 outline-hidden"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-mono block">{isEn ? "MOQ" : "MOQ (Min)"}</span>
                <input
                  type="number"
                  value={suppliers.supplierC.moq}
                  onChange={(e) => handleUpdateSupplier("supplierC", "moq", Number(e.target.value))}
                  className="w-full mt-1 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-semibold"
                />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-mono block">{isEn ? "Lead Time (d)" : "Masa (Hari)"}</span>
                <input
                  type="number"
                  value={suppliers.supplierC.leadTimeDays}
                  onChange={(e) => handleUpdateSupplier("supplierC", "leadTimeDays", Number(e.target.value))}
                  className="w-full mt-1 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-semibold"
                />
              </div>
            </div>

            {/* Savings Box */}
            <div className="p-3 bg-emerald-50/80 rounded-lg border border-emerald-200 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 font-semibold">{isEn ? "Landed Cost / Unit:" : "Kos Bersih / Unit:"}</span>
                <span className="font-mono font-bold text-emerald-900">{f(supplierCLanded)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 font-semibold">{isEn ? "Weekly Savings:" : "Penjimatan Mingguan:"}</span>
                <span className="font-mono font-bold text-emerald-600">+{f(weeklySavingsC)}</span>
              </div>
              <div className="flex items-center justify-between text-xs pt-1 border-t border-emerald-200/60">
                <span className="text-slate-700 font-bold">{isEn ? "Annual Savings:" : "Penjimatan Setahun:"}</span>
                <span className="font-mono font-extrabold text-emerald-700">+{f(annualSavingsC)}</span>
              </div>
            </div>
          </div>

          <button
            onClick={() => handleApplyRate(suppliers.supplierC)}
            className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs mt-2"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{isEn ? "Apply Rate to Standard" : "Guna Harga Dalam Kos Standard"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
