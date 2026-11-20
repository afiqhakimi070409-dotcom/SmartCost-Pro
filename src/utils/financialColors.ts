/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Standard Financial Colors for SmartCost:
 * - GREEN (#16A34A): Profit, positive net/gross profit, favorable variances, positive growth
 * - AMBER (#D97706): Moderate performance, zero profit / break-even, warning indicators, neutral
 * - RED (#DC2626): Financial losses, negative profit, negative margin, unfavorable variances
 * - NEUTRAL NAVY (#061830): Primary dark card background (School Enterprise card, etc.)
 * - NEUTRAL BORDER (#0B3C7A): Subtle dark blue card borders
 */
export const FINANCIAL_COLORS = {
  GREEN: "#16A34A",
  AMBER: "#D97706",
  RED: "#DC2626",
  NEUTRAL_NAVY: "#061830",
  NEUTRAL_BORDER: "#0B3C7A",
} as const;

export type FinancialStatusType = "profit" | "moderate" | "loss";

export interface FinancialStatus {
  status: FinancialStatusType;
  colorHex: string;
  textColorClass: string;
  bgColorClass: string;
  borderColorClass: string;
  badgeBgClass: string;
  badgeTextClass: string;
  labelEn: string;
  labelMs: string;
}

/**
 * Evaluates profit status dynamically:
 * - > 0: Profit (Green #16A34A)
 * - = 0: Break-Even / Neutral (Amber #D97706)
 * - < 0: Loss (Red #DC2626)
 */
export function getProfitStatus(profit: number): FinancialStatus {
  if (profit > 0.0001) {
    return {
      status: "profit",
      colorHex: FINANCIAL_COLORS.GREEN,
      textColorClass: "text-[#16A34A] dark:text-[#16A34A]",
      bgColorClass: "bg-[#16A34A]/10",
      borderColorClass: "border-[#16A34A]/30",
      badgeBgClass: "bg-emerald-50 dark:bg-emerald-950/40",
      badgeTextClass: "text-[#16A34A] dark:text-emerald-400",
      labelEn: "Profit",
      labelMs: "Untung",
    };
  } else if (Math.abs(profit) <= 0.0001) {
    return {
      status: "moderate",
      colorHex: FINANCIAL_COLORS.AMBER,
      textColorClass: "text-[#D97706] dark:text-[#D97706]",
      bgColorClass: "bg-[#D97706]/10",
      borderColorClass: "border-[#D97706]/30",
      badgeBgClass: "bg-amber-50 dark:bg-amber-950/40",
      badgeTextClass: "text-[#D97706] dark:text-amber-400",
      labelEn: "Break-Even",
      labelMs: "Pulang Modal",
    };
  } else {
    return {
      status: "loss",
      colorHex: FINANCIAL_COLORS.RED,
      textColorClass: "text-[#DC2626] dark:text-[#DC2626]",
      bgColorClass: "bg-[#DC2626]/10",
      borderColorClass: "border-[#DC2626]/30",
      badgeBgClass: "bg-rose-50 dark:bg-rose-950/40",
      badgeTextClass: "text-[#DC2626] dark:text-rose-400",
      labelEn: "Loss",
      labelMs: "Rugi",
    };
  }
}

/**
 * Evaluates cost variance dynamically:
 * In cost accounting:
 * - Actual < Standard: Favorable (Green #16A34A) - saved money
 * - Actual = Standard: Neutral / On Budget (Amber #D97706)
 * - Actual > Standard: Unfavorable (Red #DC2626) - over budget
 */
export function getVarianceStatus(actualCost: number, standardCost: number): FinancialStatus {
  const diff = actualCost - standardCost;
  if (diff < -0.0001) {
    // Actual cost lower than standard -> Favorable
    return {
      status: "profit",
      colorHex: FINANCIAL_COLORS.GREEN,
      textColorClass: "text-[#16A34A] dark:text-[#16A34A]",
      bgColorClass: "bg-[#16A34A]/10",
      borderColorClass: "border-[#16A34A]/30",
      badgeBgClass: "bg-emerald-50 dark:bg-emerald-950/40",
      badgeTextClass: "text-[#16A34A] dark:text-emerald-400",
      labelEn: "Favorable Variance",
      labelMs: "Menguntungkan",
    };
  } else if (Math.abs(diff) <= 0.0001) {
    return {
      status: "moderate",
      colorHex: FINANCIAL_COLORS.AMBER,
      textColorClass: "text-[#D97706] dark:text-[#D97706]",
      bgColorClass: "bg-[#D97706]/10",
      borderColorClass: "border-[#D97706]/30",
      badgeBgClass: "bg-amber-50 dark:bg-amber-950/40",
      badgeTextClass: "text-[#D97706] dark:text-amber-400",
      labelEn: "Moderate Performance",
      labelMs: "Prestasi Sederhana",
    };
  } else {
    // Actual cost higher than standard -> Unfavorable
    return {
      status: "loss",
      colorHex: FINANCIAL_COLORS.RED,
      textColorClass: "text-[#DC2626] dark:text-[#DC2626]",
      bgColorClass: "bg-[#DC2626]/10",
      borderColorClass: "border-[#DC2626]/30",
      badgeBgClass: "bg-rose-50 dark:bg-rose-950/40",
      badgeTextClass: "text-[#DC2626] dark:text-rose-400",
      labelEn: "Unfavorable Variance",
      labelMs: "Tidak Menguntungkan",
    };
  }
}

/**
 * Evaluates margin percentage status dynamically:
 * - > 0%: Green (#16A34A)
 * - = 0%: Amber (#D97706)
 * - < 0%: Red (#DC2626)
 */
export function getMarginStatus(marginPercentage: number): FinancialStatus {
  if (marginPercentage > 0.0001) {
    return {
      status: "profit",
      colorHex: FINANCIAL_COLORS.GREEN,
      textColorClass: "text-[#16A34A] dark:text-[#16A34A]",
      bgColorClass: "bg-[#16A34A]/10",
      borderColorClass: "border-[#16A34A]/30",
      badgeBgClass: "bg-emerald-50 dark:bg-emerald-950/40",
      badgeTextClass: "text-[#16A34A] dark:text-emerald-400",
      labelEn: "Healthy Margin",
      labelMs: "Margin Sihat",
    };
  } else if (Math.abs(marginPercentage) <= 0.0001) {
    return {
      status: "moderate",
      colorHex: FINANCIAL_COLORS.AMBER,
      textColorClass: "text-[#D97706] dark:text-[#D97706]",
      bgColorClass: "bg-[#D97706]/10",
      borderColorClass: "border-[#D97706]/30",
      badgeBgClass: "bg-amber-50 dark:bg-amber-950/40",
      badgeTextClass: "text-[#D97706] dark:text-amber-400",
      labelEn: "Zero Margin",
      labelMs: "Margin Sifar",
    };
  } else {
    return {
      status: "loss",
      colorHex: FINANCIAL_COLORS.RED,
      textColorClass: "text-[#DC2626] dark:text-[#DC2626]",
      bgColorClass: "bg-[#DC2626]/10",
      borderColorClass: "border-[#DC2626]/30",
      badgeBgClass: "bg-rose-50 dark:bg-rose-950/40",
      badgeTextClass: "text-[#DC2626] dark:text-rose-400",
      labelEn: "Negative Margin",
      labelMs: "Margin Negatif",
    };
  }
}

/**
 * Generic financial color retriever:
 */
export function getFinancialColor(
  type: "profit" | "cost" | "variance" | "margin",
  value: number,
  baseline: number = 0
): FinancialStatus {
  switch (type) {
    case "profit":
      return getProfitStatus(value);
    case "variance":
      return getVarianceStatus(value, baseline);
    case "margin":
      return getMarginStatus(value);
    case "cost":
      return getVarianceStatus(value, baseline);
    default:
      return getProfitStatus(value);
  }
}

/**
 * Standard Malaysian Ringgit (MYR) Currency Formatter.
 * Prefix: "RM"
 * Comma separator for thousands and millions.
 * Always 2 decimal places.
 * Example:
 * - 4483 -> "RM 4,483.00"
 * - 25000.5 -> "RM 25,000.50"
 * - 2000000 -> "RM 2,000,000.00"
 * - -621855 -> "-RM 621,855.00"
 * - 0 -> "RM 0.00"
 */
export function formatCurrencyRM(val: number | string, currency = "RM"): string {
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num) || !isFinite(num)) {
    return `${currency} 0.00`;
  }
  const isNegative = num < -0.00001;
  const absNum = Math.abs(num);
  const formatted = absNum.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return isNegative ? `-${currency} ${formatted}` : `${currency} ${formatted}`;
}

/**
 * Standard Percentage Formatter.
 * Example:
 * - 15 -> "15.00%"
 * - -12.5 -> "-12.50%"
 * - 0 -> "0.00%"
 */
export function formatPercentage(val: number | string, decimals = 2): string {
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num) || !isFinite(num)) {
    return `0.${"0".repeat(decimals)}%`;
  }
  return `${num.toFixed(decimals)}%`;
}

/**
 * Standard Quantity Formatter with thousands separators.
 * If number is an integer, avoids unnecessary trailing decimals.
 * If number has fractional part, displays up to 2 decimal places.
 * Example:
 * - 1250, "units" -> "1,250 units"
 * - 10.5, "kg" -> "10.50 kg"
 * - 2.5, "L" -> "2.50 L"
 * - 8, "hours" -> "8.00 hours"
 */
export function formatQuantity(val: number | string, unit?: string, forceDecimals = false): string {
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num) || !isFinite(num)) {
    return unit ? `0 ${unit}` : "0";
  }

  let formatted: string;
  if (forceDecimals || Math.floor(num) !== num) {
    formatted = num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } else {
    formatted = num.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  return unit ? `${formatted} ${unit}` : formatted;
}
