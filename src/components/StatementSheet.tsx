/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import { KonfigurasiSistem, BahanMentah, BuruhLangsung, OverheadBerubah, OverheadTetap } from "../types";
import { RingkasanKos, kiraRingkasanKosStandard, kiraRingkasanKosSebenar } from "../utils/costCalculations";
import { TemplatPerniagaan } from "../data/defaultTemplates";
import {
  FileDown,
  Printer,
  FileText,
  RefreshCw,
  Layers,
  Soup,
  ExternalLink,
  X,
} from "lucide-react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { Language, getTranslation, getStoredLanguage, formatLocalizedNumber, formatLocalizedDate } from "../utils/i18n";
import { formatCurrencyRM } from "../utils/financialColors";

interface StatementSheetProps {
  config: KonfigurasiSistem;
  bahanMentah: BahanMentah[];
  buruhLangsung: BuruhLangsung[];
  overheadBerubah: OverheadBerubah[];
  overheadTetap: OverheadTetap[];
  stdSummary: RingkasanKos;
  actSummary: RingkasanKos;
  templates: TemplatPerniagaan[];
  systemLang?: Language;
}

interface StatementRowItem {
  id: string;
  kind: "section" | "item" | "subtotal" | "bar";
  label: string;
  calcNote?: string;
  indented?: boolean;
  stdVal?: number;
  actVal?: number;
  diffVal?: number;
  isPositiveFavorable?: boolean;
}

const getVarianceClass = (diff: number, isPositiveFavorable: boolean): string => {
  if (Math.abs(diff) <= 0.0001) return "statement-var-zero";
  const favorable = isPositiveFavorable ? diff > 0 : diff < 0;
  return favorable ? "statement-var-favorable" : "statement-var-unfavorable";
};

const extractSafePrintStylesForClone = (): string => {
  const safeChunks: string[] = [];
  const sheets = Array.from(document.styleSheets);

  const collectSafeRules = (rules: CSSRuleList): string[] => {
    const out: string[] = [];
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (rule instanceof CSSMediaRule) {
        if (rule.conditionText.toLowerCase().includes("print")) continue;
        const inner = collectSafeRules(rule.cssRules);
        if (inner.length > 0) {
          out.push(`@media ${rule.conditionText} { ${inner.join("\n")} }`);
        }
        continue;
      }
      if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) {
        const inner = collectSafeRules((rule as CSSGroupingRule).cssRules);
        if (inner.length > 0 && rule instanceof CSSSupportsRule) {
          out.push(`@supports ${rule.conditionText} { ${inner.join("\n")} }`);
        }
        continue;
      }
      const text = rule.cssText || "";
      if (
        text.includes("oklch(") ||
        text.includes("oklab(") ||
        text.includes("color-mix(")
      ) {
        continue;
      }
      if (
        text.includes(".statement-") ||
        text.startsWith("@font-face") ||
        text.includes("tabular-nums")
      ) {
        out.push(text);
      }
    }
    return out;
  };

  for (const sheet of sheets) {
    try {
      if (!sheet.cssRules) continue;
      safeChunks.push(...collectSafeRules(sheet.cssRules));
    } catch {
      // Cross-origin font stylesheets (e.g. Google Fonts) are kept via <link> elements
    }
  }

  return safeChunks.join("\n");
};

export default function StatementSheet({
  config,
  bahanMentah,
  buruhLangsung,
  overheadBerubah,
  overheadTetap,
  stdSummary,
  actSummary,
  templates = [],
  systemLang,
}: StatementSheetProps) {
  const lang: Language = systemLang || config.language || getStoredLanguage();
  const isEn = lang === "en";
  const t = getTranslation(lang);
  const currency = config.currency || "RM";

  const [downloading, setDownloading] = useState(false);
  const [printingFallback, setPrintingFallback] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [printPreviewUrl, setPrintPreviewUrl] = useState<string | null>(null);
  const [selectedViewId, setSelectedViewId] = useState<string>("consolidated");
  const printableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (printPreviewUrl) {
        URL.revokeObjectURL(printPreviewUrl);
      }
    };
  }, [printPreviewUrl]);

  const f = (val: number) => formatCurrencyRM(val, currency);
  const fDiff = (val: number) => {
    if (Math.abs(val) <= 0.0001) return `${currency} 0.00`;
    if (val > 0) return `+${formatCurrencyRM(val, currency)}`;
    return formatCurrencyRM(val, currency);
  };

  const unitWord = isEn ? "units" : "unit";
  const formatUnits = (val: number) => `${formatLocalizedNumber(val, lang)} ${unitWord}`;
  const formatUnitDiff = (diff: number) => {
    if (Math.abs(diff) <= 0.0001) return `0 ${unitWord}`;
    const absStr = formatLocalizedNumber(Math.abs(diff), lang);
    return `${diff > 0 ? "+" : "-"}${absStr} ${unitWord}`;
  };

  const isConsolidated = selectedViewId === "consolidated";

  // Grouped Fixed Costs for Consolidated View (kept identical to existing calculations)
  const mapGroupedFixedCosts = () => {
    const grouped: { [key: string]: { std: number; act: number } } = {};
    templates.forEach((tpl) => {
      tpl.overheadTetap.forEach((item) => {
        let normalized = item.nama;
        const lower = normalized.toLowerCase();
        if (lower.includes("sewa") || lower.includes("lease") || lower.includes("rent")) {
          normalized = isEn ? "Storefront & Facility Rent" : "Sewa Tapak Kedai";
        } else if (
          lower.includes("bil") ||
          lower.includes("elektrik") ||
          lower.includes("power") ||
          lower.includes("water") ||
          lower.includes("utiliti") ||
          lower.includes("utilities")
        ) {
          normalized = isEn ? "Utilities (Power & Water)" : "Bil Elektrik & Air";
        } else if (lower.includes("susutnilai") || lower.includes("depreciation")) {
          normalized = isEn ? "Equipment Depreciation" : "Susutnilai Peralatan & Dapur";
        } else if (lower.includes("lesen") || lower.includes("permit") || lower.includes("license")) {
          normalized = isEn ? "Business Licenses & Permits" : "Lesen Perniagaan";
        }

        if (!grouped[normalized]) {
          grouped[normalized] = { std: 0, act: 0 };
        }
        grouped[normalized].std += item.stdKosMingguan;
        grouped[normalized].act += item.sebenarKosJumlah;
      });
    });
    return Object.keys(grouped).map((nama, idx) => ({
      id: `grouped-foh-${idx}`,
      nama,
      stdKosMingguan: grouped[nama].std,
      sebenarKosJumlah: grouped[nama].act,
    }));
  };

  // Compute variables dynamically based on view selection (preserving exact existing logic)
  let currentSyarikat = config.namaSyarikat || "SCHOOL ENTERPRISE";
  let currentProduk = "";

  let Q_std = 0;
  let Q_act = 0;
  let revenueStd = 0;
  let revenueAct = 0;
  let bahanCostStd = 0;
  let bahanCostAct = 0;
  let buruhCostStd = 0;
  let buruhCostAct = 0;
  let ohbCostStd = 0;
  let ohbCostAct = 0;
  let fcStd = 0;
  let fcAct = 0;
  let listOverheadTetap: { id: string; nama: string; stdKosMingguan: number; sebenarKosJumlah: number }[] = [];

  if (isConsolidated) {
    currentProduk = isEn ? "Consolidated All Products" : "Konsolidasi Semua Produk";

    templates.forEach((tpl) => {
      const tplStd = kiraRingkasanKosStandard(
        tpl.konfigurasi,
        tpl.bahanMentah,
        tpl.buruhLangsung,
        tpl.overheadBerubah,
        tpl.overheadTetap
      );

      Q_std += tpl.konfigurasi.sasaranKuantitiStandard;
      Q_act += tpl.konfigurasi.kuantitiSebenarDijual;

      revenueStd += tpl.konfigurasi.hargaJualanStandard * tpl.konfigurasi.sasaranKuantitiStandard;
      revenueAct += tpl.konfigurasi.hargaJualanSebenar * tpl.konfigurasi.kuantitiSebenarDijual;

      bahanCostStd += tplStd.bahanMentahSemangkuk * tpl.konfigurasi.sasaranKuantitiStandard;
      bahanCostAct += tpl.bahanMentah.reduce(
        (sum, item) => sum + item.sebenarKuantitiJumlah * item.sebenarHargaPerUnit,
        0
      );

      buruhCostStd += tplStd.buruhLangsungSemangkuk * tpl.konfigurasi.sasaranKuantitiStandard;
      buruhCostAct += tpl.buruhLangsung.reduce(
        (sum, item) => sum + item.sebenarJamJumlah * item.sebenarKadarPerJam,
        0
      );

      ohbCostStd += tplStd.overheadBerubahSemangkuk * tpl.konfigurasi.sasaranKuantitiStandard;
      ohbCostAct += tpl.overheadBerubah.reduce((sum, item) => sum + item.sebenarKosJumlah, 0);
    });

    listOverheadTetap = mapGroupedFixedCosts();
    fcStd = listOverheadTetap.reduce((sum, item) => sum + item.stdKosMingguan, 0);
    fcAct = listOverheadTetap.reduce((sum, item) => sum + item.sebenarKosJumlah, 0);
  } else {
    const tpl = templates.find((item) => item.id === selectedViewId) || {
      id: "active",
      namaProduk: config.namaProduk,
      namaSyarikat: config.namaSyarikat,
      konfigurasi: config,
      bahanMentah,
      buruhLangsung,
      overheadBerubah,
      overheadTetap,
    };

    currentProduk = tpl.namaProduk;
    currentSyarikat = tpl.namaSyarikat;

    const tplStd =
      tpl.id === "active"
        ? stdSummary
        : kiraRingkasanKosStandard(
            tpl.konfigurasi,
            tpl.bahanMentah,
            tpl.buruhLangsung,
            tpl.overheadBerubah,
            tpl.overheadTetap
          );
    const tplAct =
      tpl.id === "active"
        ? actSummary
        : kiraRingkasanKosSebenar(
            tpl.konfigurasi,
            tpl.bahanMentah,
            tpl.buruhLangsung,
            tpl.overheadBerubah,
            tpl.overheadTetap
          );

    Q_std = tpl.konfigurasi.sasaranKuantitiStandard;
    Q_act = tpl.konfigurasi.kuantitiSebenarDijual;

    revenueStd = tpl.konfigurasi.hargaJualanStandard * Q_std;
    revenueAct = tpl.konfigurasi.hargaJualanSebenar * Q_act;

    bahanCostStd = tplStd.bahanMentahSemangkuk * Q_std;
    bahanCostAct = tpl.bahanMentah.reduce(
      (sum, item) => sum + item.sebenarKuantitiJumlah * item.sebenarHargaPerUnit,
      0
    );

    buruhCostStd = tplStd.buruhLangsungSemangkuk * Q_std;
    buruhCostAct = tpl.buruhLangsung.reduce(
      (sum, item) => sum + item.sebenarJamJumlah * item.sebenarKadarPerJam,
      0
    );

    ohbCostStd = tplStd.overheadBerubahSemangkuk * Q_std;
    ohbCostAct = tpl.overheadBerubah.reduce((sum, item) => sum + item.sebenarKosJumlah, 0);

    listOverheadTetap = tpl.overheadTetap.map((item) => ({
      id: item.id,
      nama: item.nama,
      stdKosMingguan: item.stdKosMingguan,
      sebenarKosJumlah: item.sebenarKosJumlah,
    }));
    fcStd = tplStd.jumlahKosTetapMingguan;
    fcAct = tplAct.jumlahKosTetapMingguan;
  }

  // Aggregate sums (exact existing formulas)
  const varCostStd = bahanCostStd + buruhCostStd + ohbCostStd;
  const varCostAct = bahanCostAct + buruhCostAct + ohbCostAct;
  const varCostDiff = varCostAct - varCostStd;

  const cmStd = revenueStd - varCostStd;
  const cmAct = revenueAct - varCostAct;
  const cmDiff = cmAct - cmStd;

  const fcDiff = fcAct - fcStd;

  const profitStd = cmStd - fcStd;
  const profitAct = cmAct - fcAct;
  const profitDiff = profitAct - profitStd;

  const revenueDiff = revenueAct - revenueStd;
  const qtyDiff = Q_act - Q_std;

  const avgPriceStd = Q_std > 0 ? revenueStd / Q_std : 0;
  const avgPriceAct = Q_act > 0 ? revenueAct / Q_act : 0;

  const printDateFormatted = formatLocalizedDate(new Date(), lang, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  // Bilingual labels strictly scoped to one language at a time
  const copy = isEn
    ? {
        docTitle: "PROFIT & LOSS STATEMENT",
        docSubtitle: "Comparison of standard cost and actual cost",
        metaCompany: "Company",
        metaDocument: "Document",
        metaDocumentVal: "Profit & Loss Statement",
        metaScope: "Report scope",
        metaWeek: "Reporting week",
        metaWeekVal: "Current Week",
        metaPrintDate: "Print date",
        metaCurrency: "Currency",
        salesQtyLabel: "Sales quantity (units)",
        colDetails: "Details",
        colStd: "Standard (target)",
        colAct: "Actual",
        colVar: "Variance",
        avgPerUnit: "Average per unit",
        legendFavorable: "Green = Favorable",
        legendUnfavorable: "Red = Unfavorable",
        legendZero: "Gray = Zero",
        breakdownTitle: "Profit Contribution Breakdown by Product",
        breakdownColProduct: "Product",
        breakdownColQty: "Actual Qty",
        breakdownColRev: "Actual Sales",
        breakdownColProfit: "Net Operating Profit",
        breakdownColPct: "Share %",
        preparedBy: "Prepared by:",
        preparedRole: `Finance Manager, ${currentSyarikat}`,
        approvedBy: "Approved by:",
        approvedRole: `Business Owner, ${currentSyarikat}`,
        sigName: "Name:",
        sigDate: "Date:",
        footerText: `Generated automatically by SMARTCOST Management System for ${currentSyarikat} © 2026. Official Financial Document.`,
      }
    : {
        docTitle: "PENYATA UNTUNG RUGI",
        docSubtitle: "Perbandingan kos piawai dan kos sebenar",
        metaCompany: "Syarikat",
        metaDocument: "Dokumen",
        metaDocumentVal: "Penyata Untung Rugi",
        metaScope: "Skop laporan",
        metaWeek: "Minggu laporan",
        metaWeekVal: "Minggu Semasa",
        metaPrintDate: "Tarikh cetakan",
        metaCurrency: "Mata wang",
        salesQtyLabel: "Kuantiti jualan (unit)",
        colDetails: "Butiran",
        colStd: "Piawai (sasaran)",
        colAct: "Sebenar",
        colVar: "Perbezaan",
        avgPerUnit: "Purata seunit",
        legendFavorable: "Hijau = Menguntungkan",
        legendUnfavorable: "Merah = Tidak menguntungkan",
        legendZero: "Kelabu = Sifar",
        breakdownTitle: "Pecahan Sumbangan Untung Mengikut Produk",
        breakdownColProduct: "Produk",
        breakdownColQty: "Kuantiti Sebenar",
        breakdownColRev: "Jualan Sebenar",
        breakdownColProfit: "Untung Bersih Operasi",
        breakdownColPct: "Sumbangan %",
        preparedBy: "Disediakan oleh:",
        preparedRole: `Pengurus Kewangan ${currentSyarikat}`,
        approvedBy: "Diluluskan oleh:",
        approvedRole: `Pemilik Perniagaan ${currentSyarikat}`,
        sigName: "Nama:",
        sigDate: "Tarikh:",
        footerText: `Dijana secara automatik oleh Sistem Pengekosan Pintar ${currentSyarikat} © 2026. Laporan Sah & Muktamad.`,
      };

  // Single structured source of truth for rows rendered across Desktop, Mobile, Print & PDF
  const statementRows: StatementRowItem[] = [
    {
      id: "net-sales",
      kind: "bar",
      label: isEn ? "NET SALES" : "JUALAN BERSIH",
      calcNote: isEn
        ? "Calculation: Selling price × units sold"
        : "Kiraan: Harga jualan × unit dijual",
      stdVal: revenueStd,
      actVal: revenueAct,
      diffVal: revenueDiff,
      isPositiveFavorable: true,
    },
    {
      id: "sec-variable",
      kind: "section",
      label: isEn ? "Less: Variable Costs" : "Tolak: Kos Berubah",
    },
    {
      id: "vc-materials",
      kind: "item",
      label: isEn ? "Direct material cost" : "Kos bahan mentah",
      calcNote: isEn
        ? "Calculation: Units sold × material cost per unit"
        : "Kiraan: Unit dijual × kos bahan seunit",
      indented: true,
      stdVal: bahanCostStd,
      actVal: bahanCostAct,
      diffVal: bahanCostAct - bahanCostStd,
      isPositiveFavorable: false,
    },
    {
      id: "vc-labor",
      kind: "item",
      label: isEn ? "Direct labor cost" : "Kos upah pekerja",
      calcNote: isEn
        ? "Calculation: Units sold × labor cost per unit"
        : "Kiraan: Unit dijual × upah seunit",
      indented: true,
      stdVal: buruhCostStd,
      actVal: buruhCostAct,
      diffVal: buruhCostAct - buruhCostStd,
      isPositiveFavorable: false,
    },
    {
      id: "vc-other",
      kind: "item",
      label: isEn ? "Other variable costs" : "Kos berubah lain",
      calcNote: isEn
        ? "Calculation: Units sold × other variable cost per unit"
        : "Kiraan: Unit dijual × kos berubah lain seunit",
      indented: true,
      stdVal: ohbCostStd,
      actVal: ohbCostAct,
      diffVal: ohbCostAct - ohbCostStd,
      isPositiveFavorable: false,
    },
    {
      id: "vc-total",
      kind: "subtotal",
      label: isEn ? "Total variable costs" : "Jumlah kos berubah",
      calcNote: isEn
        ? "Calculation: Direct materials + labor + other variable costs"
        : "Kiraan: Bahan mentah + upah + kos berubah lain",
      stdVal: varCostStd,
      actVal: varCostAct,
      diffVal: varCostDiff,
      isPositiveFavorable: false,
    },
    {
      id: "contribution-margin",
      kind: "bar",
      label: isEn ? "CONTRIBUTION MARGIN" : "MARGIN CARUMAN",
      calcNote: isEn
        ? "Calculation: Net sales - Total variable costs"
        : "Kiraan: Jualan bersih - Jumlah kos berubah",
      stdVal: cmStd,
      actVal: cmAct,
      diffVal: cmDiff,
      isPositiveFavorable: true,
    },
    {
      id: "sec-fixed",
      kind: "section",
      label: isEn ? "Less: Fixed Costs" : "Tolak: Kos Tetap",
    },
    ...listOverheadTetap.map((item) => ({
      id: `fc-item-${item.id}`,
      kind: "item" as const,
      label: item.nama,
      indented: true,
      stdVal: item.stdKosMingguan,
      actVal: item.sebenarKosJumlah,
      diffVal: item.sebenarKosJumlah - item.stdKosMingguan,
      isPositiveFavorable: false,
    })),
    {
      id: "fc-total",
      kind: "subtotal",
      label: isEn ? "Total fixed costs" : "Jumlah kos tetap",
      calcNote: isEn
        ? "Calculation: Total weekly fixed costs"
        : "Kiraan: Jumlah kos tetap mingguan",
      stdVal: fcStd,
      actVal: fcAct,
      diffVal: fcDiff,
      isPositiveFavorable: false,
    },
    {
      id: "net-operating-profit",
      kind: "bar",
      label: isEn ? "NET OPERATING PROFIT" : "UNTUNG BERSIH OPERASI",
      calcNote: isEn
        ? "Calculation: Contribution margin - Total fixed costs"
        : "Kiraan: Margin caruman - Jumlah kos tetap",
      stdVal: profitStd,
      actVal: profitAct,
      diffVal: profitDiff,
      isPositiveFavorable: true,
    },
  ];

  const buildStatementPdfBlob = async (): Promise<Blob> => {
    const element = printableRef.current;
    if (!element) {
      throw new Error(t.statement.elementUnavailable);
    }

    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }

    const safeCssText = extractSafePrintStylesForClone();
    const blockBreakOffsetsPx: number[] = [];
    let clonedTotalHeight = 1;

    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      windowWidth: 960,
      onclone: (clonedDoc, clonedEl) => {
        clonedDoc.documentElement.classList.remove("dark");
        clonedEl.classList.add("statement-force-light");

        // Strip Tailwind stylesheets (which use oklch/oklab unsupported by html2canvas 1.4.1)
        // while keeping Google Fonts <link> elements and injecting sanitized .statement-* CSS.
        clonedDoc.querySelectorAll("style").forEach((el) => el.remove());
        clonedDoc.querySelectorAll('link[rel="stylesheet"]').forEach((linkEl) => {
          const href = (linkEl as HTMLLinkElement).href || "";
          if (!href.includes("fonts.googleapis.com")) {
            linkEl.remove();
          }
        });

        const cleanStyle = clonedDoc.createElement("style");
        cleanStyle.textContent = `
          *, *::before, *::after { box-sizing: border-box; }
          html, body {
            margin: 0;
            padding: 0;
            background: #ffffff;
            color: #0f172a;
            font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          ${safeCssText}
        `;
        clonedDoc.head.appendChild(cleanStyle);

        // Record vertical bottom coordinates of every atomic block inside clonedEl
        // so multi-page PDF pagination never slices across a row or signature box.
        const rootRect = clonedEl.getBoundingClientRect();
        clonedTotalHeight = clonedEl.scrollHeight || rootRect.height || 1;
        clonedEl.querySelectorAll("[data-pdf-block]").forEach((node) => {
          const r = node.getBoundingClientRect();
          const relBottom = r.bottom - rootRect.top;
          if (relBottom > 0 && relBottom <= clonedTotalHeight) {
            blockBreakOffsetsPx.push(relBottom);
          }
        });
      },
    });

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    // Strict A4 portrait (210mm x 297mm) with 15mm margins -> 180mm x 267mm content area
    const marginMm = 15;
    const contentWidthMm = 180;
    const contentHeightMm = 267;
    const maxSliceCanvasPx = Math.floor((canvas.width * contentHeightMm) / contentWidthMm);
    const scaleFactor = canvas.height / (clonedTotalHeight || canvas.height / 2);

    // Map DOM block boundaries to canvas pixel Y positions
    const uniqueBreaks = Array.from(
      new Set(
        blockBreakOffsetsPx
          .map((y) => Math.round(y * scaleFactor))
          .filter((y) => y > 0 && y < canvas.height)
      )
    ).sort((a, b) => a - b);

    let sliceStart = 0;
    let pageIndex = 0;

    while (sliceStart < canvas.height) {
      let sliceEnd = Math.min(sliceStart + maxSliceCanvasPx, canvas.height);

      if (sliceEnd < canvas.height) {
        const candidate = uniqueBreaks
          .filter((y) => y <= sliceEnd && y > sliceStart + Math.floor(maxSliceCanvasPx * 0.35))
          .pop();
        if (candidate) {
          sliceEnd = candidate;
        }
      }

      const sliceHeight = sliceEnd - sliceStart;
      if (sliceHeight <= 0) break;

      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeight;
      const ctx = pageCanvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(
          canvas,
          0,
          sliceStart,
          canvas.width,
          sliceHeight,
          0,
          0,
          canvas.width,
          sliceHeight
        );
      }

      const sliceImg = pageCanvas.toDataURL("image/png");
      const sliceHeightMm = (sliceHeight * contentWidthMm) / canvas.width;

      if (pageIndex > 0) {
        pdf.addPage();
      }
      pdf.addImage(sliceImg, "PNG", marginMm, marginMm, contentWidthMm, sliceHeightMm);

      sliceStart = sliceEnd;
      pageIndex += 1;
    }

    return pdf.output("blob");
  };

  const downloadPDF = async () => {
    if (!printableRef.current) return;
    setDownloading(true);
    setPdfError(null);

    try {
      const blob = await buildStatementPdfBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeName = currentSyarikat.toLowerCase().replace(/[^a-z0-9]/g, "_");
      link.href = url;
      link.download = `${t.statement.pdfFilenamePrefix}_${safeName}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error("Failed to generate PDF:", err);
      setPdfError(
        isEn
          ? "Failed to generate PDF report. Please try again."
          : "Gagal menjana penyata PDF. Sila cuba lagi."
      );
    } finally {
      setDownloading(false);
    }
  };

  const printStatement = async () => {
    setPdfError(null);
    let nativePrintFired = false;
    const onBeforePrint = () => {
      nativePrintFired = true;
    };
    window.addEventListener("beforeprint", onBeforePrint, { once: true });

    try {
      window.print();
    } catch {
      // Blocked in restricted sandbox
    }

    // If running inside an iframe where window.print() is blocked (no beforeprint event),
    // automatically generate an A4 PDF preview from the exact same component.
    setTimeout(async () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      const inIframe = (() => {
        try {
          return window.self !== window.top;
        } catch {
          return true;
        }
      })();
      if (!nativePrintFired && inIframe) {
        setPrintingFallback(true);
        try {
          const blob = await buildStatementPdfBlob();
          const url = URL.createObjectURL(blob);
          setPrintPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
        } catch (err) {
          console.error("Print preview fallback failed:", err);
          setPdfError(
            isEn
              ? "Print preview could not open in this frame. Use Download PDF."
              : "Pratonton cetakan tidak disokong dalam bingkai ini. Sila guna Muat Turun PDF."
          );
        } finally {
          setPrintingFallback(false);
        }
      }
    }, 350);
  };

  const closePrintPreview = () => {
    setPrintPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  return (
    <div className="space-y-5 sm:space-y-6 animate-fadeIn">
      {pdfError && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl text-rose-800 dark:text-rose-200 text-xs font-semibold flex items-center justify-between print:hidden">
          <span>{pdfError}</span>
          <button
            onClick={() => setPdfError(null)}
            className="text-rose-600 dark:text-rose-300 hover:text-rose-900 font-bold ml-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Action Header Bar (Screen Only) */}
      <div className="bg-white dark:bg-[#132238] rounded-2xl p-5 sm:p-6 border border-slate-200 dark:border-[#243a5e] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <FileText className="w-6 h-6 text-[#061830] dark:text-sky-400" />
            {t.statement.title}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t.statement.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto shrink-0">
          <button
            onClick={downloadPDF}
            disabled={downloading}
            className="px-3.5 sm:px-4 py-2 sm:py-2.5 bg-[#061830] hover:bg-[#0B3C7A] disabled:opacity-60 text-white font-semibold text-xs rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            {downloading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                {isEn ? "GENERATING PDF..." : "MENJANA PDF..."}
              </>
            ) : (
              <>
                <FileDown className="w-4 h-4" />
                {isEn ? "DOWNLOAD PDF" : "MUAT TURUN PDF"}
              </>
            )}
          </button>

          <button
            onClick={printStatement}
            disabled={printingFallback}
            className="px-3.5 sm:px-4 py-2 sm:py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-[#182a44] dark:hover:bg-[#1e3554] text-slate-800 dark:text-slate-100 font-semibold text-xs rounded-xl border border-slate-200 dark:border-[#243a5e] transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            {printingFallback ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                {isEn ? "PREPARING PRINT..." : "MENYEDIA CETAKAN..."}
              </>
            ) : (
              <>
                <Printer className="w-4 h-4" />
                {isEn ? "PRINT STATEMENT" : "CETAK PENYATA"}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Selector Mode Tab Bar (Screen Only) */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1.5 scrollbar-none flex-nowrap sm:flex-wrap max-w-full border-b border-slate-200 dark:border-[#243a5e] print:hidden">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mr-1 shrink-0">
          {isEn ? "Report View:" : "Papar Laporan:"}
        </span>
        <button
          onClick={() => setSelectedViewId("consolidated")}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold tracking-tight transition-all duration-200 flex items-center gap-2 cursor-pointer border shrink-0 whitespace-nowrap ${
            selectedViewId === "consolidated"
              ? "bg-[#061830] text-white border-[#061830] shadow-xs"
              : "bg-white dark:bg-[#132238] hover:bg-slate-50 dark:hover:bg-[#182a44] text-slate-700 dark:text-slate-200 border-slate-200 dark:border-[#243a5e]"
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          {config.namaSyarikat || "SCHOOL ENTERPRISE"} ({isEn ? "Consolidated" : "Disatukan"})
        </button>
        {templates.map((tpl) => {
          const isSelected = selectedViewId === tpl.id;
          return (
            <button
              key={tpl.id}
              onClick={() => setSelectedViewId(tpl.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold tracking-tight transition-all duration-200 flex items-center gap-2 cursor-pointer border shrink-0 whitespace-nowrap ${
                isSelected
                  ? "bg-[#061830] text-white border-[#061830] shadow-xs"
                  : "bg-white dark:bg-[#132238] hover:bg-slate-50 dark:hover:bg-[#182a44] text-slate-700 dark:text-slate-200 border-slate-200 dark:border-[#243a5e]"
              }`}
            >
              <Soup className="w-3.5 h-3.5" />
              {tpl.namaProduk}
            </button>
          );
        })}
      </div>

      {/* Inline Iframe-Safe Print / PDF Preview Modal */}
      {printPreviewUrl && (
        <div className="bg-white dark:bg-[#132238] rounded-2xl border border-slate-200 dark:border-[#243a5e] shadow-lg overflow-hidden print:hidden">
          <div className="px-4 py-3 bg-[#061830] text-white flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs font-bold">
              {isEn ? "Print Preview (A4 Portrait)" : "Pratonton Cetakan / PDF (A4)"}
            </span>
            <div className="flex items-center gap-2">
              <a
                href={printPreviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 bg-white text-[#061830] hover:bg-slate-100 rounded-lg text-xs font-bold inline-flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {isEn ? "Open PDF in New Tab" : "Buka PDF dalam Tab Baharu"}
              </a>
              <button
                onClick={downloadPDF}
                className="px-3 py-1.5 bg-white/15 hover:bg-white/25 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <FileDown className="w-3.5 h-3.5" />
                {isEn ? "Download" : "Muat Turun"}
              </button>
              <button
                onClick={closePrintPreview}
                aria-label={isEn ? "Close preview" : "Tutup pratonton"}
                className="p-1.5 hover:bg-white/15 rounded-lg text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <iframe
            src={printPreviewUrl}
            title={copy.docTitle}
            className="w-full h-[540px] bg-slate-100 border-0"
          />
        </div>
      )}

      {/* Single Source of Truth Printable Statement Component (Screen, Mobile, Print & PDF) */}
      <div
        ref={printableRef}
        id="printable-statement"
        className="statement-paper"
      >
        {/* Document Header */}
        <header className="statement-header" data-pdf-block="header">
          <h1 className="statement-title">{copy.docTitle}</h1>
          <p className="statement-subtitle">{copy.docSubtitle}</p>
        </header>

        {/* 2-Column Metadata Grid */}
        <section className="statement-meta-grid" data-pdf-block="metadata">
          <div className="statement-meta-item">
            <span className="statement-meta-label">{copy.metaCompany}</span>
            <span className="statement-meta-value">{currentSyarikat}</span>
          </div>
          <div className="statement-meta-item">
            <span className="statement-meta-label">{copy.metaDocument}</span>
            <span className="statement-meta-value">{copy.metaDocumentVal}</span>
          </div>
          <div className="statement-meta-item">
            <span className="statement-meta-label">{copy.metaScope}</span>
            <span className="statement-meta-value">{currentProduk}</span>
          </div>
          <div className="statement-meta-item">
            <span className="statement-meta-label">{copy.metaWeek}</span>
            <span className="statement-meta-value">{copy.metaWeekVal}</span>
          </div>
          <div className="statement-meta-item">
            <span className="statement-meta-label">{copy.metaPrintDate}</span>
            <span className="statement-meta-value">{printDateFormatted}</span>
          </div>
          <div className="statement-meta-item">
            <span className="statement-meta-label">{copy.metaCurrency}</span>
            <span className="statement-meta-value">{currency}</span>
          </div>
        </section>

        {/* Sales Volume Strip Above Table (Strictly in Units, Never RM) */}
        <section className="statement-volume-strip" data-pdf-block="volume-strip">
          <span className="statement-volume-label">{copy.salesQtyLabel}</span>
          <div className="statement-volume-values">
            <span className="statement-volume-metric">
              <span className="statement-volume-metric-label">{copy.colStd}:</span>
              <span className="statement-volume-metric-val">{formatUnits(Q_std)}</span>
            </span>
            <span className="statement-volume-metric">
              <span className="statement-volume-metric-label">{copy.colAct}:</span>
              <span className="statement-volume-metric-val">{formatUnits(Q_act)}</span>
            </span>
            <span className="statement-volume-metric">
              <span className="statement-volume-metric-label">{copy.colVar}:</span>
              <span
                className={`statement-volume-metric-val ${getVarianceClass(qtyDiff, true)}`}
              >
                {formatUnitDiff(qtyDiff)}
              </span>
            </span>
          </div>
        </section>

        {/* Financial Table (4 Columns Desktop/Print/PDF + Stacked Blocks on <640px) */}
        <section className="statement-table-wrap">
          <table className="statement-desktop-table">
            <colgroup>
              <col style={{ width: "46%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "18%" }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>{copy.colDetails}</th>
                <th style={{ textAlign: "right" }}>
                  {copy.colStd}
                  <span className="statement-th-sub">
                    {copy.avgPerUnit}: {f(avgPriceStd)}
                  </span>
                </th>
                <th style={{ textAlign: "right" }}>
                  {copy.colAct}
                  <span className="statement-th-sub">
                    {copy.avgPerUnit}: {f(avgPriceAct)}
                  </span>
                </th>
                <th style={{ textAlign: "right" }}>{copy.colVar}</th>
              </tr>
            </thead>
            <tbody>
              {statementRows.map((row) => {
                if (row.kind === "section") {
                  return (
                    <tr
                      key={row.id}
                      className="statement-row statement-row-section"
                      data-pdf-block={row.id}
                    >
                      <td colSpan={4}>{row.label}</td>
                    </tr>
                  );
                }

                const rowClass =
                  row.kind === "bar"
                    ? "statement-row statement-row-bar"
                    : row.kind === "subtotal"
                    ? "statement-row statement-row-subtotal"
                    : "statement-row";

                const diffClass = getVarianceClass(
                  row.diffVal ?? 0,
                  Boolean(row.isPositiveFavorable)
                );

                return (
                  <tr key={row.id} className={rowClass} data-pdf-block={row.id}>
                    <td className={row.indented ? "statement-item-indented" : undefined}>
                      <span className="statement-item-name">{row.label}</span>
                      {row.calcNote && (
                        <span className="statement-calc-note">{row.calcNote}</span>
                      )}
                    </td>
                    <td className="statement-num">{f(row.stdVal ?? 0)}</td>
                    <td className="statement-num">{f(row.actVal ?? 0)}</td>
                    <td className={`statement-num ${diffClass}`}>{fDiff(row.diffVal ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Mobile Stacked Layout (< 640px) — Zero Horizontal Scroll */}
          <div className="statement-mobile-blocks">
            <div className="statement-mobile-avg-bar">
              <div>
                <div style={{ fontWeight: 700 }}>{copy.colStd}</div>
                <div className="statement-th-sub">
                  {copy.avgPerUnit}: {f(avgPriceStd)}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 700 }}>{copy.colAct}</div>
                <div className="statement-th-sub">
                  {copy.avgPerUnit}: {f(avgPriceAct)}
                </div>
              </div>
            </div>

            {statementRows.map((row) => {
              if (row.kind === "section") {
                return (
                  <div key={`m-${row.id}`} className="statement-mobile-block-section">
                    {row.label}
                  </div>
                );
              }

              const blockClass =
                row.kind === "bar"
                  ? "statement-mobile-block-bar"
                  : row.kind === "subtotal"
                  ? "statement-mobile-block statement-mobile-block-subtotal"
                  : "statement-mobile-block";

              const diffClass = getVarianceClass(
                row.diffVal ?? 0,
                Boolean(row.isPositiveFavorable)
              );

              return (
                <div key={`m-${row.id}`} className={blockClass}>
                  <div>
                    <span
                      className="statement-item-name"
                      style={{
                        fontWeight: row.kind === "bar" || row.kind === "subtotal" ? 700 : 600,
                        fontSize: row.kind === "bar" ? "13.5px" : "13px",
                      }}
                    >
                      {row.label}
                    </span>
                    {row.calcNote && (
                      <span className="statement-calc-note">{row.calcNote}</span>
                    )}
                  </div>

                  <div className="statement-mobile-vals">
                    <div className="statement-mobile-val-col">
                      <span className="statement-mobile-val-label">{copy.colStd}</span>
                      <span className="statement-mobile-val-num">{f(row.stdVal ?? 0)}</span>
                    </div>
                    <div className="statement-mobile-val-col">
                      <span className="statement-mobile-val-label">{copy.colAct}</span>
                      <span className="statement-mobile-val-num">{f(row.actVal ?? 0)}</span>
                    </div>
                    <div className="statement-mobile-val-col" style={{ textAlign: "right" }}>
                      <span className="statement-mobile-val-label">{copy.colVar}</span>
                      <span className={`statement-mobile-val-num ${diffClass}`}>
                        {fDiff(row.diffVal ?? 0)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Variance Color Legend */}
          <div className="statement-legend" data-pdf-block="legend">
            <span className="statement-legend-item">
              <span
                className="statement-legend-swatch"
                style={{ backgroundColor: "#16a34a" }}
              />
              {copy.legendFavorable}
            </span>
            <span className="statement-legend-item">
              <span
                className="statement-legend-swatch"
                style={{ backgroundColor: "#dc2626" }}
              />
              {copy.legendUnfavorable}
            </span>
            <span className="statement-legend-item">
              <span
                className="statement-legend-swatch"
                style={{ backgroundColor: "#64748b" }}
              />
              {copy.legendZero}
            </span>
          </div>
        </section>

        {/* Breakdown Table for Multiple Products when in Consolidated View */}
        {isConsolidated && templates.length > 1 && (
          <section className="statement-breakdown-section" data-pdf-block="breakdown">
            <h3 className="statement-breakdown-heading">{copy.breakdownTitle}</h3>

            <table className="statement-desktop-table">
              <colgroup>
                <col style={{ width: "30%" }} />
                <col style={{ width: "17%" }} />
                <col style={{ width: "19%" }} />
                <col style={{ width: "20%" }} />
                <col style={{ width: "14%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>{copy.breakdownColProduct}</th>
                  <th style={{ textAlign: "right" }}>{copy.breakdownColQty}</th>
                  <th style={{ textAlign: "right" }}>{copy.breakdownColRev}</th>
                  <th style={{ textAlign: "right" }}>{copy.breakdownColProfit}</th>
                  <th style={{ textAlign: "right" }}>{copy.breakdownColPct}</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((tpl) => {
                  const tplAct = kiraRingkasanKosSebenar(
                    tpl.konfigurasi,
                    tpl.bahanMentah,
                    tpl.buruhLangsung,
                    tpl.overheadBerubah,
                    tpl.overheadTetap
                  );
                  const pct =
                    Math.abs(profitAct) > 0.0001
                      ? (tplAct.untungBersihMingguan / profitAct) * 100
                      : 0;
                  const tplRev =
                    tpl.konfigurasi.hargaJualanSebenar *
                    tpl.konfigurasi.kuantitiSebenarDijual;
                  const profitClass = getVarianceClass(tplAct.untungBersihMingguan, true);

                  return (
                    <tr key={tpl.id} className="statement-row">
                      <td style={{ fontWeight: 600 }}>{tpl.namaProduk}</td>
                      <td className="statement-num">
                        {formatUnits(tpl.konfigurasi.kuantitiSebenarDijual)}
                      </td>
                      <td className="statement-num">{f(tplRev)}</td>
                      <td className={`statement-num ${profitClass}`}>
                        {f(tplAct.untungBersihMingguan)}
                      </td>
                      <td className="statement-num">{pct.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Mobile Stacked Breakdown (< 640px) */}
            <div className="statement-breakdown-mobile">
              {templates.map((tpl) => {
                const tplAct = kiraRingkasanKosSebenar(
                  tpl.konfigurasi,
                  tpl.bahanMentah,
                  tpl.buruhLangsung,
                  tpl.overheadBerubah,
                  tpl.overheadTetap
                );
                const pct =
                  Math.abs(profitAct) > 0.0001
                    ? (tplAct.untungBersihMingguan / profitAct) * 100
                    : 0;
                const tplRev =
                  tpl.konfigurasi.hargaJualanSebenar *
                  tpl.konfigurasi.kuantitiSebenarDijual;
                const profitClass = getVarianceClass(tplAct.untungBersihMingguan, true);

                return (
                  <div key={`m-brk-${tpl.id}`} className="statement-mobile-block">
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        gap: "8px",
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: "13px" }}>
                        {tpl.namaProduk}
                      </span>
                      <span style={{ fontSize: "11.5px", fontWeight: 600 }}>
                        {formatUnits(tpl.konfigurasi.kuantitiSebenarDijual)} ({pct.toFixed(1)}%)
                      </span>
                    </div>
                    <div
                      className="statement-mobile-vals"
                      style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
                    >
                      <div className="statement-mobile-val-col">
                        <span className="statement-mobile-val-label">
                          {copy.breakdownColRev}
                        </span>
                        <span className="statement-mobile-val-num">{f(tplRev)}</span>
                      </div>
                      <div className="statement-mobile-val-col" style={{ textAlign: "right" }}>
                        <span className="statement-mobile-val-label">
                          {copy.breakdownColProfit}
                        </span>
                        <span className={`statement-mobile-val-num ${profitClass}`}>
                          {f(tplAct.untungBersihMingguan)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Signature Boxes */}
        <section className="statement-signatures" data-pdf-block="signatures">
          <div className="statement-signature-box">
            <div className="statement-signature-title">{copy.preparedBy}</div>
            <div className="statement-signature-line" />
            <div className="statement-signature-role">{copy.preparedRole}</div>
            <div className="statement-signature-field">{copy.sigName} __________________________</div>
            <div className="statement-signature-field">{copy.sigDate} __________________________</div>
          </div>

          <div className="statement-signature-box">
            <div className="statement-signature-title">{copy.approvedBy}</div>
            <div className="statement-signature-line" />
            <div className="statement-signature-role">{copy.approvedRole}</div>
            <div className="statement-signature-field">{copy.sigName} __________________________</div>
            <div className="statement-signature-field">{copy.sigDate} __________________________</div>
          </div>
        </section>

        {/* Official Document Footer */}
        <footer className="statement-footer" data-pdf-block="footer">
          {copy.footerText}
        </footer>
      </div>
    </div>
  );
}
