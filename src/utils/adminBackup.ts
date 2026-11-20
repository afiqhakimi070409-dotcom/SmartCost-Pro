/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { KonfigurasiSistem, BahanMentah, BuruhLangsung, OverheadBerubah, OverheadTetap, UserRole } from "../types.ts";
import type { TemplatPerniagaan } from "../data/defaultTemplates.ts";
import { sanitizeParsedJson } from "./fileUploadSecurity.ts";

export const BACKUP_FORMAT_VERSION = "2.0.0";
export const BACKUP_SCHEMA_VERSION = "2026.1";

export interface BackupMetadata {
  app: string;
  backupVersion: string;
  schemaVersion: string;
  exportedAt: string;
  exportedBy: string;
  companyName: string;
  currency: string;
  totalProducts: number;
  totalRawMaterials: number;
  totalLaborItems: number;
  totalOverheadItems: number;
}

export interface SmartCostBackupPayload {
  metadata: BackupMetadata;
  company: {
    name: string;
    activeProductId: string;
    currency: string;
    config: Partial<KonfigurasiSistem>;
  };
  templates: TemplatPerniagaan[];
  activeWorksheet: {
    bahanMentah: BahanMentah[];
    buruhLangsung: BuruhLangsung[];
    overheadBerubah: OverheadBerubah[];
    overheadTetap: OverheadTetap[];
  };
}

export type ImportMode = "insert_only" | "upsert" | "validate_only";

export interface BackupValidationResult {
  valid: boolean;
  error?: string;
  metadata?: BackupMetadata;
  analysis?: {
    totalProductsInBackup: number;
    newProductsCount: number;
    existingConflictsCount: number;
    conflictingProductNames: string[];
    newProductNames: string[];
    totalMaterials: number;
    totalLabor: number;
    totalOverhead: number;
  };
  warnings: string[];
}

export interface BackupAuditLogEntry {
  id: string;
  timestamp: string;
  action: "EXPORT" | "IMPORT" | "VALIDATE";
  username: string;
  userRole: UserRole;
  companyName: string;
  mode?: ImportMode;
  recordsCount?: number;
  status: "SUCCESS" | "WARNING" | "FAILED";
  details: string;
}

/**
 * Sanitizes config object to strictly exclude passwords, tokens and secrets.
 */
export function sanitizeConfigForBackup(cfg: KonfigurasiSistem): Partial<KonfigurasiSistem> {
  const cleanRaw = sanitizeParsedJson(cfg || {}) as any;
  const {
    kataLaluanLogMasuk: _pw1,
    password: _pw2,
    passwordHash: _pw3,
    salt: _salt,
    sessionToken: _st,
    csrfToken: _ct,
    twoFactorSecretEnc: _tf1,
    twoFactorPendingSecretEnc: _tf2,
    ...safeConfig
  } = cleanRaw;
  return safeConfig;
}

/**
 * Generates an automated standardized backup filename.
 * Example: SmartCost_Backup_2026-10-10_140000.json
 */
export function generateBackupFileName(companyName: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const cleanCompany = companyName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 20);
  return `SmartCost_${cleanCompany}_Backup_${dateStr}_${timeStr}.json`;
}

/**
 * Validates the structure and integrity of an uploaded JSON backup file.
 */
export function validateBackupContent(
  rawJson: any,
  existingTemplates: TemplatPerniagaan[] = []
): BackupValidationResult {
  const warnings: string[] = [];

  if (!rawJson || typeof rawJson !== "object") {
    return {
      valid: false,
      error: "Kandungan fail tidak sah atau bukan objek JSON yang sah.",
      warnings: ["Fail kosong atau struktur fail rosak."],
    };
  }
  rawJson = sanitizeParsedJson(rawJson);

  // Check app signature
  if (rawJson.metadata?.app !== "SMARTCOST" && rawJson.app !== "SMARTCOST" && !rawJson.templates && !rawJson.pengekosan_templates) {
    return {
      valid: false,
      error: "Format fail tidak dikenali. Fail ini bukan sandaran rasmi SMARTCOST.",
      warnings: ["Tandatangan metadata SMARTCOST tidak ditemui."],
    };
  }

  // Extract templates safely
  let templatesToValidate: TemplatPerniagaan[] = [];
  if (Array.isArray(rawJson.templates)) {
    templatesToValidate = rawJson.templates;
  } else if (rawJson.data?.templates && Array.isArray(rawJson.data.templates)) {
    templatesToValidate = rawJson.data.templates;
  } else if (rawJson.pengekosan_templates && Array.isArray(rawJson.pengekosan_templates)) {
    templatesToValidate = rawJson.pengekosan_templates;
  }

  if (templatesToValidate.length === 0) {
    return {
      valid: false,
      error: "Tiada rekod produk atau templat pengekosan ditemui dalam fail sandaran ini.",
      warnings: ["Senarai templat produk kosong."],
    };
  }

  // Validate integrity of each template item
  let totalMaterials = 0;
  let totalLabor = 0;
  let totalOverhead = 0;

  for (let i = 0; i < templatesToValidate.length; i++) {
    const tpl = templatesToValidate[i];
    if (!tpl || typeof tpl !== "object") {
      return {
        valid: false,
        error: `Produk #${i + 1} tidak mempunyai struktur data objek yang sah.`,
        warnings: [`Produk #${i + 1} rosak.`],
      };
    }

    if (!tpl.id || typeof tpl.id !== "string" || !tpl.id.trim()) {
      return {
        valid: false,
        error: `Produk #${i + 1} kehilangan pengenal unik (ID). Fail sandaran tidak sah.`,
        warnings: [`Produk #${i + 1} tidak mempunyai ID unik.`],
      };
    }

    if (!tpl.namaProduk || typeof tpl.namaProduk !== "string" || !tpl.namaProduk.trim()) {
      return {
        valid: false,
        error: `Produk #${i + 1} (ID: ${tpl.id}) tidak mempunyai nama produk yang sah.`,
        warnings: [`Produk #${i + 1} tidak mempunyai nama produk.`],
      };
    }

    if (Array.isArray(tpl.bahanMentah)) {
      totalMaterials += tpl.bahanMentah.length;
    }
    if (Array.isArray(tpl.buruhLangsung)) {
      totalLabor += tpl.buruhLangsung.length;
    }
    if (Array.isArray(tpl.overheadBerubah)) {
      totalOverhead += tpl.overheadBerubah.length;
    }
    if (Array.isArray(tpl.overheadTetap)) {
      totalOverhead += tpl.overheadTetap.length;
    }
  }

  // Conflict analysis with existing records
  const existingIds = new Set(existingTemplates.map((t) => t.id));
  const existingNames = new Set(
    existingTemplates
      .map((t) => (t?.namaProduk ? String(t.namaProduk).toLowerCase().trim() : ""))
      .filter(Boolean)
  );

  const conflictingProductNames: string[] = [];
  const newProductNames: string[] = [];

  templatesToValidate.forEach((t) => {
    const tName = (t?.namaProduk ? String(t.namaProduk).toLowerCase().trim() : "");
    const isConflict = existingIds.has(t.id) || existingNames.has(tName);
    if (isConflict) {
      conflictingProductNames.push(t.namaProduk);
    } else {
      newProductNames.push(t.namaProduk);
    }
  });

  const metadata: BackupMetadata = {
    app: "SMARTCOST",
    backupVersion: rawJson.metadata?.backupVersion || BACKUP_FORMAT_VERSION,
    schemaVersion: rawJson.metadata?.schemaVersion || BACKUP_SCHEMA_VERSION,
    exportedAt: rawJson.metadata?.exportedAt || new Date().toISOString(),
    exportedBy: rawJson.metadata?.exportedBy || "Admin",
    companyName: rawJson.metadata?.companyName || rawJson.company?.name || "SMARTCOST",
    currency: rawJson.metadata?.currency || rawJson.company?.currency || "RM",
    totalProducts: templatesToValidate.length,
    totalRawMaterials: totalMaterials,
    totalLaborItems: totalLabor,
    totalOverheadItems: totalOverhead,
  };

  return {
    valid: true,
    metadata,
    analysis: {
      totalProductsInBackup: templatesToValidate.length,
      newProductsCount: newProductNames.length,
      existingConflictsCount: conflictingProductNames.length,
      conflictingProductNames,
      newProductNames,
      totalMaterials,
      totalLabor,
      totalOverhead,
    },
    warnings,
  };
}

/**
 * Executes merging/importing of backup templates into existing templates based on selected mode.
 */
export function executeTemplatesImport({
  backupTemplates,
  existingTemplates,
  mode,
}: {
  backupTemplates: TemplatPerniagaan[];
  existingTemplates: TemplatPerniagaan[];
  mode: ImportMode;
}): {
  updatedTemplates: TemplatPerniagaan[];
  addedCount: number;
  updatedCount: number;
  skippedCount: number;
} {
  if (mode === "validate_only") {
    return {
      updatedTemplates: existingTemplates,
      addedCount: 0,
      updatedCount: 0,
      skippedCount: backupTemplates.length,
    };
  }

  const existingMap = new Map<string, TemplatPerniagaan>();
  const nameToIdMap = new Map<string, string>();

  existingTemplates.forEach((t) => {
    existingMap.set(t.id, t);
    nameToIdMap.set(t.namaProduk.toLowerCase().trim(), t.id);
  });

  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  backupTemplates.forEach((bTpl) => {
    const existingById = existingMap.get(bTpl.id);
    const existingByNameId = nameToIdMap.get(bTpl.namaProduk.toLowerCase().trim());
    const matchedId = existingById ? bTpl.id : existingByNameId;

    if (matchedId) {
      if (mode === "upsert") {
        // Update existing record
        existingMap.set(matchedId, {
          ...bTpl,
          id: matchedId, // preserve canonical ID
        });
        updatedCount++;
      } else {
        // insert_only: skip existing record without altering
        skippedCount++;
      }
    } else {
      // New record
      const newId = bTpl.id || `product-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      existingMap.set(newId, {
        ...bTpl,
        id: newId,
      });
      nameToIdMap.set(bTpl.namaProduk.toLowerCase().trim(), newId);
      addedCount++;
    }
  });

  return {
    updatedTemplates: Array.from(existingMap.values()),
    addedCount,
    updatedCount,
    skippedCount,
  };
}
