/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * General Setup Modal - Business Information, Accounting Period & Malaysian Tax Setup
 * Faithful implementation modeled after standard Malaysian ERP / Business Accounting specifications
 * (Reference screenshot: image_0282bc54.png)
 */

import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Check, Upload, Trash2, Building2, Calendar, FileText, Globe, Landmark, Phone, Printer, Mail, ExternalLink, ShieldAlert } from "lucide-react";
import { KonfigurasiSistem, GeneralSetupConfig } from "../types";
import { Language } from "../utils/i18n";
import { validateAndReadImageFile } from "../utils/fileUploadSecurity";

interface GeneralSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: KonfigurasiSistem;
  onSaveConfig: (updatedConfig: KonfigurasiSistem) => void;
  systemLang?: Language;
  inline?: boolean;
}

export default function GeneralSetupModal({
  isOpen,
  onClose,
  config,
  onSaveConfig,
  systemLang = "ms",
  inline = false,
}: GeneralSetupModalProps) {
  const [activeTab, setActiveTab] = useState<"company" | "options" | "stock" | "bills">("company");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Default setup values from config or standard Malaysian business template
  const initialSetup: GeneralSetupConfig = {
    companyName: config.namaSyarikat || "AMG SDN BHD",
    addressLine1: config.generalSetup?.addressLine1 || "NO 4, JALAN HARIMAU 18 TAMAN PERLING",
    addressLine2: config.generalSetup?.addressLine2 || "81300 JOHOR BAHRU",
    addressLine3: config.generalSetup?.addressLine3 || "JOHOR , DARUL TA'AZIM",
    addressLine4: config.generalSetup?.addressLine4 || "",
    businessRegNo: config.generalSetup?.businessRegNo || "118934-V",
    regNoType: config.generalSetup?.regNoType || "V",
    phone1: config.generalSetup?.phone1 || "604-6561234",
    phone2: config.generalSetup?.phone2 || "",
    fax: config.generalSetup?.fax || "604-6571234",
    bankAccount: config.generalSetup?.bankAccount || "5512-3456-7890 (Maybank)",
    email: config.generalSetup?.email || "info@amgsdnbhd.com.my",
    website: config.generalSetup?.website || "https://www.amgsdnbhd.com.my",
    logoUrl: config.generalSetup?.logoUrl || "",

    accountingPeriodFrom: config.generalSetup?.accountingPeriodFrom || "01/01/2025",
    accountingPeriodTo: config.generalSetup?.accountingPeriodTo || "31/12/2025",
    actualStartDate: config.generalSetup?.actualStartDate || "31/12/2024",
    defaultCurrency: config.generalSetup?.defaultCurrency || "MYR",
    taxCountry: config.generalSetup?.taxCountry || "Malaysia",

    gstEnabled: config.generalSetup?.gstEnabled || false,
    gstStartDate: config.generalSetup?.gstStartDate || "",
    gstTaxablePeriodMonths: config.generalSetup?.gstTaxablePeriodMonths || 3,
    gstTaxRegNo: config.generalSetup?.gstTaxRegNo || "",
    gstTaxDescription: config.generalSetup?.gstTaxDescription || "GST 0%",

    sstEnabled: config.generalSetup?.sstEnabled || true,
    sstStartDate: config.generalSetup?.sstStartDate || "01/09/2018",
    sstTaxablePeriodMonths: config.generalSetup?.sstTaxablePeriodMonths || 2,
    sstSalesTaxRegNo: config.generalSetup?.sstSalesTaxRegNo || "W10-1808-32000012",
    sstServiceTaxRegNo: config.generalSetup?.sstServiceTaxRegNo || "B16-1808-31000045",
  };

  const [formData, setFormData] = useState<GeneralSetupConfig>(initialSetup);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFormData({
        ...initialSetup,
        companyName: config.namaSyarikat || initialSetup.companyName,
        ...(config.generalSetup || {}),
      });
      setSaveSuccessNotice(false);
      setLogoUploadError(null);
    }
  }, [isOpen, config]);

  if (!isOpen) return null;

  const handleFieldChange = (field: keyof GeneralSetupConfig, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setLogoUploadError(null);
    if (!file) return;
    const res = await validateAndReadImageFile(file, systemLang === "en" ? "en" : "ms");
    if (res.ok === false) {
      setLogoUploadError(res.error);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    handleFieldChange("logoUrl", res.dataUrl);
  };

  const handleClearLogo = () => {
    setLogoUploadError(null);
    handleFieldChange("logoUrl", "");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const updatedConfig: KonfigurasiSistem = {
      ...config,
      namaSyarikat: formData.companyName.trim() || config.namaSyarikat,
      currency: formData.defaultCurrency || config.currency || "RM",
      generalSetup: formData,
    };
    onSaveConfig(updatedConfig);
    setSaveSuccessNotice(true);
    setTimeout(() => {
      onClose();
    }, 500);
  };

  const windowContent = (
    <div
      className={
        inline
          ? "bg-[#f0f2f5] dark:bg-slate-900 w-full rounded-xl shadow-md border border-slate-300 dark:border-slate-700 flex flex-col overflow-hidden text-slate-800 dark:text-slate-200 text-xs font-sans"
          : "bg-[#f0f2f5] dark:bg-slate-900 w-full max-w-4xl rounded-xl shadow-2xl border border-slate-300 dark:border-slate-700 flex flex-col max-h-[95vh] overflow-hidden text-slate-800 dark:text-slate-200 text-xs font-sans"
      }
    >
        
        {/* Title Bar - Classic System Style */}
        <div className="bg-[#0b3c7a] text-white px-3 py-2 flex items-center justify-between select-none border-b border-[#082d5a]">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
            <span className="font-bold text-xs tracking-wide">
              {systemLang === "en" ? "General Setup" : "Tetapan Umum (General Setup)"}
            </span>
            <span className="text-[10px] text-cyan-200 bg-[#061830] px-2 py-0.5 rounded border border-cyan-400/30">
              {formData.companyName || "SMARTCOST"}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-rose-600 transition-colors text-white text-xs cursor-pointer"
            title={systemLang === "en" ? "Close" : "Tutup"}
          >
            ✕
          </button>
        </div>

        {/* Tab Headers */}
        <div className="bg-slate-200 dark:bg-slate-800 px-3 pt-2 flex items-center gap-1 border-b border-slate-300 dark:border-slate-700 select-none">
          <button
            type="button"
            onClick={() => setActiveTab("company")}
            className={`px-3.5 py-1.5 rounded-t-lg font-bold text-xs transition-all cursor-pointer ${
              activeTab === "company"
                ? "bg-[#f0f2f5] dark:bg-slate-900 text-[#0b3c7a] dark:text-cyan-300 border-t-2 border-[#0b3c7a] dark:border-cyan-400 shadow-2xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            {systemLang === "en" ? "Company" : "Syarikat (Company)"}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("options")}
            className={`px-3.5 py-1.5 rounded-t-lg font-bold text-xs transition-all cursor-pointer ${
              activeTab === "options"
                ? "bg-[#f0f2f5] dark:bg-slate-900 text-[#0b3c7a] dark:text-cyan-300 border-t-2 border-[#0b3c7a] dark:border-cyan-400 shadow-2xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            {systemLang === "en" ? "Options" : "Pilihan (Options)"}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("stock")}
            className={`px-3.5 py-1.5 rounded-t-lg font-bold text-xs transition-all cursor-pointer ${
              activeTab === "stock"
                ? "bg-[#f0f2f5] dark:bg-slate-900 text-[#0b3c7a] dark:text-cyan-300 border-t-2 border-[#0b3c7a] dark:border-cyan-400 shadow-2xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            {systemLang === "en" ? "Stock" : "Stok (Stock)"}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("bills")}
            className={`px-3.5 py-1.5 rounded-t-lg font-bold text-xs transition-all cursor-pointer ${
              activeTab === "bills"
                ? "bg-[#f0f2f5] dark:bg-slate-900 text-[#0b3c7a] dark:text-cyan-300 border-t-2 border-[#0b3c7a] dark:border-cyan-400 shadow-2xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            {systemLang === "en" ? "Bills" : "Bil (Bills)"}
          </button>
        </div>

        {/* Modal Body / Tab Content */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 overflow-y-auto space-y-4">
          
          {saveSuccessNotice && (
            <div className="p-2.5 bg-emerald-100 border border-emerald-300 text-emerald-800 rounded text-xs font-bold flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>{systemLang === "en" ? "Settings saved successfully." : "Tetapan maklumat perniagaan dan perakaunan berjaya disimpan."}</span>
            </div>
          )}

          {activeTab === "company" && (
            <div className="space-y-4">
              {/* TOP SECTION: COMPANY INFO & LOGO */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                
                {/* Left 2 Cols: Form Fields */}
                <div className="md:col-span-2 space-y-2">
                  {/* Company Name */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2">
                    <label className="text-slate-700 dark:text-slate-300 font-semibold sm:text-right">
                      Company Name
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.companyName}
                      onChange={(e) => handleFieldChange("companyName", e.target.value)}
                      className="sm:col-span-3 px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-bold text-slate-800 dark:text-slate-100 uppercase focus:border-[#0b3c7a] outline-hidden"
                      placeholder="e.g. AMG SDN BHD"
                    />
                  </div>

                  {/* Address (4 Lines) */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 items-start gap-2 pt-1">
                    <label className="text-slate-700 dark:text-slate-300 font-semibold sm:text-right pt-1.5">
                      Address
                    </label>
                    <div className="sm:col-span-3 space-y-1.5">
                      <input
                        type="text"
                        value={formData.addressLine1}
                        onChange={(e) => handleFieldChange("addressLine1", e.target.value)}
                        className="w-full px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs text-slate-800 dark:text-slate-100 uppercase focus:border-[#0b3c7a] outline-hidden"
                        placeholder="NO 4, JALAN HARIMAU 18 TAMAN PERLING"
                      />
                      <input
                        type="text"
                        value={formData.addressLine2}
                        onChange={(e) => handleFieldChange("addressLine2", e.target.value)}
                        className="w-full px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs text-slate-800 dark:text-slate-100 uppercase focus:border-[#0b3c7a] outline-hidden"
                        placeholder="81300 JOHOR BAHRU"
                      />
                      <input
                        type="text"
                        value={formData.addressLine3}
                        onChange={(e) => handleFieldChange("addressLine3", e.target.value)}
                        className="w-full px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs text-slate-800 dark:text-slate-100 uppercase focus:border-[#0b3c7a] outline-hidden"
                        placeholder="JOHOR , DARUL TA'AZIM"
                      />
                      <input
                        type="text"
                        value={formData.addressLine4 || ""}
                        onChange={(e) => handleFieldChange("addressLine4", e.target.value)}
                        className="w-full px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs text-slate-800 dark:text-slate-100 uppercase focus:border-[#0b3c7a] outline-hidden"
                        placeholder="MALAYSIA"
                      />
                    </div>
                  </div>

                  {/* Business Reg. No. */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 pt-1">
                    <label className="text-slate-700 dark:text-slate-300 font-semibold sm:text-right">
                      Business Reg. No.
                    </label>
                    <div className="sm:col-span-3 flex items-center gap-1.5">
                      <input
                        type="text"
                        value={formData.businessRegNo}
                        onChange={(e) => handleFieldChange("businessRegNo", e.target.value)}
                        className="flex-1 px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono text-slate-800 dark:text-slate-100 uppercase focus:border-[#0b3c7a] outline-hidden"
                        placeholder="118934-V"
                      />
                      <select
                        value={formData.regNoType || "V"}
                        onChange={(e) => handleFieldChange("regNoType", e.target.value)}
                        className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-bold text-slate-700 dark:text-slate-300 outline-hidden cursor-pointer"
                      >
                        <option value="V">V (Standard)</option>
                        <option value="NEW">12-Digit (New SSM)</option>
                        <option value="OLD">Old Format</option>
                      </select>
                    </div>
                  </div>

                  {/* Phone #1 & Fax */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 pt-1">
                    <label className="text-slate-700 dark:text-slate-300 font-semibold sm:text-right">
                      Phone #1
                    </label>
                    <div className="sm:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={formData.phone1}
                        onChange={(e) => handleFieldChange("phone1", e.target.value)}
                        className="w-full px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono text-slate-800 dark:text-slate-100 focus:border-[#0b3c7a] outline-hidden"
                        placeholder="604-6561234"
                      />
                      <div className="flex items-center gap-1.5">
                        <label className="text-slate-600 dark:text-slate-400 shrink-0 font-medium text-[11px]">Fax</label>
                        <input
                          type="text"
                          value={formData.fax || ""}
                          onChange={(e) => handleFieldChange("fax", e.target.value)}
                          className="flex-1 px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono text-slate-800 dark:text-slate-100 focus:border-[#0b3c7a] outline-hidden"
                          placeholder="604-6571234"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Phone #2 & Bank A/C */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 pt-1">
                    <label className="text-slate-700 dark:text-slate-300 font-semibold sm:text-right">
                      Phone #2
                    </label>
                    <div className="sm:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={formData.phone2 || ""}
                        onChange={(e) => handleFieldChange("phone2", e.target.value)}
                        className="w-full px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono text-slate-800 dark:text-slate-100 focus:border-[#0b3c7a] outline-hidden"
                        placeholder="012-3456789"
                      />
                      <div className="flex items-center gap-1.5">
                        <label className="text-slate-600 dark:text-slate-400 shrink-0 font-medium text-[11px]">Bank A/C</label>
                        <input
                          type="text"
                          value={formData.bankAccount || ""}
                          onChange={(e) => handleFieldChange("bankAccount", e.target.value)}
                          className="flex-1 px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono text-slate-800 dark:text-slate-100 focus:border-[#0b3c7a] outline-hidden"
                          placeholder="Bank & No. Akaun"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Email */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 pt-1">
                    <label className="text-slate-700 dark:text-slate-300 font-semibold sm:text-right">
                      Email
                    </label>
                    <input
                      type="email"
                      value={formData.email || ""}
                      onChange={(e) => handleFieldChange("email", e.target.value)}
                      className="sm:col-span-3 px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs text-slate-800 dark:text-slate-100 focus:border-[#0b3c7a] outline-hidden"
                      placeholder="pengurusan@syarikat.com.my"
                    />
                  </div>

                  {/* Website */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 pt-1">
                    <label className="text-slate-700 dark:text-slate-300 font-semibold sm:text-right">
                      Website
                    </label>
                    <div className="sm:col-span-3 flex items-center justify-between gap-3">
                      <input
                        type="text"
                        value={formData.website || ""}
                        onChange={(e) => handleFieldChange("website", e.target.value)}
                        className="flex-1 px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs text-slate-800 dark:text-slate-100 focus:border-[#0b3c7a] outline-hidden"
                        placeholder="https://www.syarikat.com.my"
                      />
                      <button
                        type="button"
                        onClick={() => setActiveTab("options")}
                        className="text-[#0b3c7a] dark:text-cyan-400 font-bold hover:underline cursor-pointer shrink-0 text-[11px]"
                      >
                        More Company Setting
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right Col: Logo Box */}
                <div className="flex flex-col items-center justify-start gap-2 pt-2 md:pt-0">
                  <div className="w-40 h-44 sm:w-48 sm:h-48 bg-slate-200 dark:bg-slate-800 rounded border-2 border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center p-2 text-center overflow-hidden">
                    {formData.logoUrl ? (
                      <img
                        src={formData.logoUrl}
                        alt="Logo Syarikat"
                        className="max-w-full max-h-full object-contain"
                      />
                    ) : (
                      <div className="text-slate-400 space-y-1">
                        <Building2 className="w-8 h-8 mx-auto text-slate-400" />
                        <span className="text-[11px] block font-medium">Company Logo</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                      onChange={handleLogoUpload}
                      className="hidden"
                      id="company-logo-upload-input"
                    />
                    <label
                      htmlFor="company-logo-upload-input"
                      className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:border-slate-400 rounded text-slate-800 dark:text-slate-200 font-bold text-xs cursor-pointer shadow-2xs hover:bg-slate-50"
                    >
                      Load
                    </label>
                    <button
                      type="button"
                      onClick={handleClearLogo}
                      className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:border-slate-400 rounded text-slate-800 dark:text-slate-200 font-bold text-xs cursor-pointer shadow-2xs hover:bg-slate-50"
                    >
                      Clear
                    </button>
                  </div>
                  <span className="text-[10px] text-slate-500">PNG, JPG, WEBP (Maks. 2MB)</span>
                  {logoUploadError && (
                    <span className="text-[10px] text-rose-600 font-semibold text-center max-w-[190px]">
                      {logoUploadError}
                    </span>
                  )}
                </div>
              </div>

              {/* MIDDLE SECTION: THIS YEAR ACCOUNTING PERIOD */}
              <div className="border-t border-slate-300 dark:border-slate-700 pt-3 space-y-2">
                <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs">
                  This Year Accounting Period
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Dates */}
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2">
                      <label className="text-slate-700 dark:text-slate-300 font-semibold sm:text-right">
                        From Date
                      </label>
                      <div className="sm:col-span-3 flex items-center gap-2">
                        <input
                          type="text"
                          value={formData.accountingPeriodFrom}
                          onChange={(e) => handleFieldChange("accountingPeriodFrom", e.target.value)}
                          className="w-28 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono text-center outline-hidden"
                          placeholder="01/01/2025"
                        />
                        <span className="font-semibold text-slate-600 dark:text-slate-400">To</span>
                        <input
                          type="text"
                          value={formData.accountingPeriodTo}
                          onChange={(e) => handleFieldChange("accountingPeriodTo", e.target.value)}
                          className="w-28 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono text-center outline-hidden"
                          placeholder="31/12/2025"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2">
                      <label className="text-slate-700 dark:text-slate-300 font-semibold sm:text-right">
                        Actual Start Date
                      </label>
                      <div className="sm:col-span-3">
                        <input
                          type="text"
                          value={formData.actualStartDate}
                          onChange={(e) => handleFieldChange("actualStartDate", e.target.value)}
                          className="w-28 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono text-center outline-hidden"
                          placeholder="31/12/2024"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Currency & Tax */}
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2">
                      <label className="text-slate-700 dark:text-slate-300 font-semibold sm:text-right">
                        Default Currency
                      </label>
                      <div className="sm:col-span-3">
                        <input
                          type="text"
                          value={formData.defaultCurrency}
                          onChange={(e) => handleFieldChange("defaultCurrency", e.target.value)}
                          className="w-28 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono font-bold text-center outline-hidden uppercase"
                          placeholder="MYR"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2">
                      <label className="text-slate-700 dark:text-slate-300 font-semibold sm:text-right">
                        Tax
                      </label>
                      <div className="sm:col-span-3">
                        <select
                          value={formData.taxCountry}
                          onChange={(e) => handleFieldChange("taxCountry", e.target.value)}
                          className="w-36 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-bold text-slate-700 dark:text-slate-300 outline-hidden cursor-pointer"
                        >
                          <option value="Malaysia">Malaysia</option>
                          <option value="Singapore">Singapore</option>
                          <option value="Brunei">Brunei</option>
                          <option value="Indonesia">Indonesia</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* BOTTOM SECTION: GST & SST TAXATION COLUMNS */}
              <div className="border-t border-slate-300 dark:border-slate-700 pt-3 grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Left: GST Column */}
                <div className="space-y-2 bg-slate-50 dark:bg-slate-800/40 p-3 rounded border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between">
                    <h5 className="font-bold text-slate-900 dark:text-slate-100 text-xs">GST</h5>
                    <span className="text-[10px] text-slate-400 font-medium">(Optional / Legacy)</span>
                  </div>

                  <div className="grid grid-cols-3 items-center gap-2">
                    <label className="text-slate-600 dark:text-slate-400 text-right text-[11px]">Start Date</label>
                    <input
                      type="text"
                      value={formData.gstStartDate || ""}
                      onChange={(e) => handleFieldChange("gstStartDate", e.target.value)}
                      className="col-span-2 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono"
                      placeholder="DD/MM/YYYY"
                    />
                  </div>

                  <div className="grid grid-cols-3 items-center gap-2">
                    <label className="text-slate-600 dark:text-slate-400 text-right text-[11px]">Taxable Period</label>
                    <div className="col-span-2 flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="12"
                        value={formData.gstTaxablePeriodMonths || 3}
                        onChange={(e) => handleFieldChange("gstTaxablePeriodMonths", parseInt(e.target.value) || 3)}
                        className="w-16 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono text-center"
                      />
                      <span className="text-slate-600 dark:text-slate-400 text-[11px]">month(s)</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 items-center gap-2">
                    <label className="text-slate-600 dark:text-slate-400 text-right text-[11px]">Tax Reg. No.</label>
                    <input
                      type="text"
                      value={formData.gstTaxRegNo || ""}
                      onChange={(e) => handleFieldChange("gstTaxRegNo", e.target.value)}
                      className="col-span-2 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono"
                      placeholder="e.g. 000123456789"
                    />
                  </div>

                  <div className="grid grid-cols-3 items-center gap-2">
                    <label className="text-slate-600 dark:text-slate-400 text-right text-[11px]">Tax Description</label>
                    <div className="col-span-2">
                      <input
                        type="text"
                        value={formData.gstTaxDescription || "GST 0%"}
                        onChange={(e) => handleFieldChange("gstTaxDescription", e.target.value)}
                        className="w-full px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs"
                        placeholder="GST 0%"
                      />
                      <span className="text-[10px] text-slate-400 block mt-0.5">e.g.: GST 6%</span>
                    </div>
                  </div>

                  <div className="pt-1 text-left">
                    <button
                      type="button"
                      onClick={() => alert("GST setting dialog configured.")}
                      className="text-[#0b3c7a] dark:text-cyan-400 font-bold hover:underline cursor-pointer text-[11px]"
                    >
                      More GST Setting
                    </button>
                  </div>
                </div>

                {/* Right: SST Column */}
                <div className="space-y-2 bg-slate-50 dark:bg-slate-800/40 p-3 rounded border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between">
                    <h5 className="font-bold text-slate-900 dark:text-slate-100 text-xs">SST</h5>
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">Active in Malaysia</span>
                  </div>

                  <div className="grid grid-cols-3 items-center gap-2">
                    <label className="text-slate-600 dark:text-slate-400 text-right text-[11px]">Start Date</label>
                    <input
                      type="text"
                      value={formData.sstStartDate || "01/09/2018"}
                      onChange={(e) => handleFieldChange("sstStartDate", e.target.value)}
                      className="col-span-2 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono"
                      placeholder="01/09/2018"
                    />
                  </div>

                  <div className="grid grid-cols-3 items-center gap-2">
                    <label className="text-slate-600 dark:text-slate-400 text-right text-[11px]">Taxable Period</label>
                    <div className="col-span-2 flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="12"
                        value={formData.sstTaxablePeriodMonths || 2}
                        onChange={(e) => handleFieldChange("sstTaxablePeriodMonths", parseInt(e.target.value) || 2)}
                        className="w-16 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono text-center"
                      />
                      <span className="text-slate-600 dark:text-slate-400 text-[11px]">month(s)</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 items-center gap-2">
                    <label className="text-slate-600 dark:text-slate-400 text-right text-[11px]">Sales Tax Reg. No.</label>
                    <input
                      type="text"
                      value={formData.sstSalesTaxRegNo || ""}
                      onChange={(e) => handleFieldChange("sstSalesTaxRegNo", e.target.value)}
                      className="col-span-2 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono"
                      placeholder="W10-1808-32000012"
                    />
                  </div>

                  <div className="grid grid-cols-3 items-center gap-2">
                    <label className="text-slate-600 dark:text-slate-400 text-right text-[11px]">Service Tax Reg. No.</label>
                    <input
                      type="text"
                      value={formData.sstServiceTaxRegNo || ""}
                      onChange={(e) => handleFieldChange("sstServiceTaxRegNo", e.target.value)}
                      className="col-span-2 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono"
                      placeholder="B16-1808-31000045"
                    />
                  </div>

                  <div className="pt-1 text-left">
                    <button
                      type="button"
                      onClick={() => alert("SST setting dialog configured.")}
                      className="text-[#0b3c7a] dark:text-cyan-400 font-bold hover:underline cursor-pointer text-[11px]"
                    >
                      More SST Setting
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "options" && (
            <div className="p-4 bg-white dark:bg-slate-800 rounded border border-slate-300 dark:border-slate-700 space-y-3">
              <h4 className="font-bold text-slate-800 dark:text-slate-200">System Financial Options</h4>
              <p className="text-slate-600 dark:text-slate-400 text-xs">
                Configure standard cost decimals, batch calculation rules, and fiscal closing month.
              </p>
              <div className="space-y-2 pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" defaultChecked className="rounded text-[#0b3c7a]" />
                  <span>Enforce Strict 2-decimal formatting for Malaysian Ringgit (e.g. RM 1,250.00)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" defaultChecked className="rounded text-[#0b3c7a]" />
                  <span>Lock recipe standard cost modifications to System Administrator</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" defaultChecked className="rounded text-[#0b3c7a]" />
                  <span>Separate production batch quantity from retail sales units</span>
                </label>
              </div>
            </div>
          )}

          {activeTab === "stock" && (
            <div className="p-4 bg-white dark:bg-slate-800 rounded border border-slate-300 dark:border-slate-700 space-y-3">
              <h4 className="font-bold text-slate-800 dark:text-slate-200">Inventory & Stock Costing Method</h4>
              <p className="text-slate-600 dark:text-slate-400 text-xs">
                Standard Valuation: Standard Costing / Weighted Average Cost (WAC).
              </p>
              <div className="p-3 bg-blue-50 dark:bg-sky-950/40 rounded border border-blue-200 dark:border-sky-800 text-xs">
                Current method is set to <strong>Standard Costing & Production Batch BOM</strong> compliant with Malaysian SME Cost Accounting.
              </div>
            </div>
          )}

          {activeTab === "bills" && (
            <div className="p-4 bg-white dark:bg-slate-800 rounded border border-slate-300 dark:border-slate-700 space-y-3">
              <h4 className="font-bold text-slate-800 dark:text-slate-200">Billing & Invoice Header Format</h4>
              <p className="text-slate-600 dark:text-slate-400 text-xs">
                Headers on PDF variance statements, quotation sheets, and cost cards will print the company name and SST/Reg No above.
              </p>
            </div>
          )}

          {/* Bottom Right Dialog Action Buttons (Matching Screenshot) */}
          <div className="pt-3 border-t border-slate-300 dark:border-slate-700 flex items-center justify-end gap-2.5">
            <button
              type="submit"
              className="px-4 py-1.5 bg-[#0b3c7a] hover:bg-[#082d5a] text-white font-bold text-xs rounded border border-[#061830] shadow-xs flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <Check className="w-3.5 h-3.5" />
              <span>OK</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded border border-slate-300 dark:border-slate-600 flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <X className="w-3.5 h-3.5" />
              <span>Cancel</span>
            </button>
          </div>
        </form>
      </div>
  );

  if (inline) {
    return windowContent;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
      {windowContent}
    </div>,
    document.body
  );
}
