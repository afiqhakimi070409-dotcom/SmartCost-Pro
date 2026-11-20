/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface BahanMentah {
  id: string;
  nama: string;
  unit: string;               // Unit kuantiti standard (cth: kg, g, L, ml, unit, keping)
  stdKuantitiPerUnit: number; // Kuantiti standard per unit (cth: 0.1 kg, 500 g)
  stdHargaPerUnit: number;    // Harga standard seunit (cth: RM 4.50/kg, RM 8.00/L)
  hargaUnit?: string;         // Unit harga jika berbeza dengan unit penggunaan (cth: harga per "kg" bagi penggunaan dalam "g")
  sebenarUnit?: string;       // Unit kuantiti sebenar (lalai: sama dengan unit standard)
  sebenarKuantitiJumlah: number; // Jumlah kuantiti sebenar digunakan (cth: 1 kg, 500 g)
  sebenarHargaPerUnit: number;   // Harga sebenar seunit
  sebenarHargaUnit?: string;  // Unit harga sebenar jika berbeza
}

export interface BuruhLangsung {
  id: string;
  nama: string;
  stdJamPerUnit: number;      // Jam/minit standard per unit (cth: 0.05 jam, atau 30 minit)
  stdKadarPerJam: number;     // Kadar standard sejam (cth: RM 12.00/jam)
  unitMasa?: "jam" | "minit"; // Unit masa standard (lalai: "jam")
  sebenarUnitMasa?: "jam" | "minit"; // Unit masa sebenar (lalai: "jam")
  sebenarJamJumlah: number;   // Jumlah masa sebenar bekerja (cth: 8 jam, 9 jam, atau 30 minit)
  sebenarKadarPerJam: number;  // Kadar sebenar dibayar sejam (cth: RM 13.00/jam)
}

export interface OverheadBerubah {
  id: string;
  nama: string;
  stdKosPerUnit: number;      // Kos standard per unit (cth: RM 0.40)
  sebenarKosJumlah: number;   // Jumlah kos sebenar minggu ini (cth: RM 1,000.00)
}

export interface OverheadTetap {
  id: string;
  nama: string;
  stdKosMingguan: number;      // Anggaran kos tetap standard seminggu (cth: RM 300.00)
  sebenarKosJumlah: number;   // Jumlah kos tetap sebenar seminggu (cth: RM 310.00)
}

export type Language = "en" | "ms";
export type ThemeMode = "light" | "dark";

export interface GeneralSetupConfig {
  companyName: string;
  addressLine1: string;
  addressLine2: string;
  addressLine3: string;
  addressLine4?: string;
  businessRegNo: string;
  regNoType?: string; // e.g. "V" or "Old" or "New"
  phone1: string;
  phone2?: string;
  fax?: string;
  bankAccount?: string;
  email?: string;
  postcode?: string;
  city?: string;
  state?: string;
  country?: string;
  bankName?: string;
  bankAccountNo?: string;
  bankAccountHolder?: string;
  website?: string;
  logoUrl?: string;
  
  // This Year Accounting Period
  accountingPeriodFrom: string; // "01/01/2025"
  accountingPeriodTo: string;   // "31/12/2025"
  actualStartDate: string;      // "31/12/2024"
  defaultCurrency: string;      // "MYR"
  taxCountry: string;           // "Malaysia"
  
  // GST
  gstEnabled?: boolean;
  gstStartDate?: string;
  gstTaxablePeriodMonths?: number; // 3
  gstTaxRegNo?: string;
  gstTaxDescription?: string;     // "GST 0%"
  
  // SST
  sstEnabled?: boolean;
  sstStartDate?: string;
  sstTaxablePeriodMonths?: number; // 2
  sstSalesTaxRegNo?: string;
  sstServiceTaxRegNo?: string;
}

export interface KonfigurasiSistem {
  namaSyarikat: string;
  namaProduk: string;
  unitProduk?: string; // Unit output produk (cth: batang, unit, pinggan, cucuk, cawan, pek, bungkus)
  unitPengeluaran?: string; // Unit pengeluaran (cth: bekas, kg, liter, set, pek, batang)
  unitJualan?: string; // Unit jualan transaksi (cth: 1 bekas, 1 kotak, 1 pek)
  kuantitiPengeluaranPiawai?: number; // Kuantiti pengeluaran kelompok piawai (cth: 20 bekas)
  kuantitiPengeluaranSebenar?: number; // Kuantiti pengeluaran kelompok sebenar (cth: 20 bekas)
  hargaJualanStandard: number;
  hargaJualanSebenar: number;
  sasaranKuantitiStandard: number; // Sasaran jualan/pengeluaran standard mingguan
  kuantitiSebenarDijual: number;    // Pengeluaran/jualan sebenar mingguan
  currency: string;
  language?: Language;             // "en" (default) atau "ms"
  theme?: ThemeMode;               // "light" | "dark"
  usernameLogMasuk: string;
  kataLaluanLogMasuk: string;
  generalSetup?: GeneralSetupConfig;
}

export type UserRole = 
  | "developer"  // Pembangun Sistem (Developer / Superuser)
  | "admin"      // Pentadbir Sistem (Admin)
  | "kerani"     // Kerani / Pembantu Pentadbiran
  | "pengurus"   // Pengurus (Manager)
  | "penyelia"   // Penyelia (Supervisor)
  | "staf"       // Staf / Eksekutif
  | "auditor";   // Auditor / Tetamu

export interface RoleDefinition {
  key: UserRole;
  title: string;
  badgeColor: string;
  accessLevel: string;
  visibility: string;
  editRights: string;
  canEditDailyData: boolean;
  canEditSettings: boolean;
  canApproveTasks: boolean;
  canExportReports: boolean;
  canManageDatabase: boolean;
  canAccessDifferentDatabases?: boolean;
  canAccessDeveloperTools?: boolean;
  allowedTabs: string[];
}

export const ROLE_DEFINITIONS: Record<UserRole, RoleDefinition> = {
  developer: {
    key: "developer",
    title: "System Developer",
    badgeColor: "bg-slate-950 text-cyan-300 border-cyan-500 font-mono shadow-xs",
    accessLevel: "Isolated Sandbox (Zero Interference)",
    visibility: "Developer Sandbox Workspace (Not tied to live company databases)",
    editRights: "Test modules & code in Sandbox, with root permission to manage and purge databases",
    canEditDailyData: true,
    canEditSettings: true,
    canApproveTasks: true,
    canExportReports: true,
    canManageDatabase: true,
    canAccessDifferentDatabases: true,
    canAccessDeveloperTools: true,
    allowedTabs: ["dashboard", "standard", "sebenar", "varians", "bep", "chart", "statement", "mrcost", "settings", "developer"],
  },
  admin: {
    key: "admin",
    title: "System Administrator (Admin)",
    badgeColor: "bg-purple-100 text-purple-800 border-purple-300",
    accessLevel: "Edit Own Company System",
    visibility: "Full system & settings restricted to own business only",
    editRights: "Full access to edit system and manage menus (Restricted strictly to own company)",
    canEditDailyData: true,
    canEditSettings: true,
    canApproveTasks: true,
    canExportReports: true,
    canManageDatabase: true,
    canAccessDifferentDatabases: false,
    canAccessDeveloperTools: false,
    allowedTabs: ["dashboard", "standard", "sebenar", "varians", "bep", "chart", "statement", "mrcost", "settings"],
  },
  kerani: {
    key: "kerani",
    title: "Clerk / Admin Assistant",
    badgeColor: "bg-blue-100 text-blue-800 border-blue-300",
    accessLevel: "Edit Transactions",
    visibility: "Transaction modules & daily production worksheets",
    editRights: "Can edit daily transactions and enter actual costs",
    canEditDailyData: true,
    canEditSettings: false,
    canApproveTasks: false,
    canExportReports: true,
    canManageDatabase: false,
    allowedTabs: ["dashboard", "standard", "sebenar", "varians", "bep", "chart", "statement", "mrcost"],
  },
  pengurus: {
    key: "pengurus",
    title: "Manager",
    badgeColor: "bg-emerald-100 text-emerald-800 border-emerald-300",
    accessLevel: "Read-Only (Executive)",
    visibility: "Analytical charts, financial statements, business settings & dashboard",
    editRights: "Review analytical charts, financial statements, and executive dashboards (Read-only)",
    canEditDailyData: false,
    canEditSettings: false,
    canApproveTasks: true,
    canExportReports: true,
    canManageDatabase: false,
    allowedTabs: ["dashboard", "chart", "statement"],
  },
  penyelia: {
    key: "penyelia",
    title: "Supervisor",
    badgeColor: "bg-amber-100 text-amber-800 border-amber-300",
    accessLevel: "Read-Only (Operational)",
    visibility: "Operational modules & daily production reports",
    editRights: "Review daily production worksheets and cost variances (Read-only)",
    canEditDailyData: false,
    canEditSettings: false,
    canApproveTasks: true,
    canExportReports: true,
    canManageDatabase: false,
    allowedTabs: ["dashboard", "standard", "sebenar", "varians", "bep", "chart", "statement", "mrcost"],
  },
  staf: {
    key: "staf",
    title: "Staff / Executive",
    badgeColor: "bg-cyan-100 text-cyan-800 border-cyan-300",
    accessLevel: "Read-Only",
    visibility: "Dashboard, standard sheet & actual sheet",
    editRights: "View daily data only without editing permissions",
    canEditDailyData: false,
    canEditSettings: false,
    canApproveTasks: false,
    canExportReports: false,
    canManageDatabase: false,
    allowedTabs: ["dashboard", "standard", "sebenar"],
  },
  auditor: {
    key: "auditor",
    title: "Auditor / Guest",
    badgeColor: "bg-rose-100 text-rose-800 border-rose-300",
    accessLevel: "Read-Only (Audit)",
    visibility: "Financial statements & main dashboard",
    editRights: "Audit review of cost statements and summaries (Read-only)",
    canEditDailyData: false,
    canEditSettings: false,
    canApproveTasks: false,
    canExportReports: true,
    canManageDatabase: false,
    allowedTabs: ["dashboard", "statement"],
  },
};

export const getActiveRoleDefinitions = (): Record<UserRole, RoleDefinition> => {
  try {
    const saved = localStorage.getItem("pengekosan_custom_role_permissions");
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...ROLE_DEFINITIONS, ...parsed };
    }
  } catch (e) {
    console.error("Gagal membaca tetapan peranan tersuai:", e);
  }
  return ROLE_DEFINITIONS;
};

export const saveActiveRoleDefinitions = (defs: Record<UserRole, RoleDefinition>): void => {
  try {
    localStorage.setItem("pengekosan_custom_role_permissions", JSON.stringify(defs));
  } catch (e) {
    console.error("Gagal menyimpan tetapan peranan tersuai:", e);
  }
};

export interface RegisteredUser {
  id: string;
  fullName: string;
  username: string;
  email?: string;
  password: string;
  role: UserRole;
  companyName?: string;
  companyId?: string;
  dbKey?: string;
  registeredAt: string;
}

export interface RegisteredCompany {
  id: string; // unique company slug or ID e.g. "syarikat_bina_jaya_172000"
  name: string;
  ownerUsername: string;
  dbKey: string; // localStorage key e.g. "pengekosan_company_db_syarikat_bina_jaya_172000"
  createdAt: string;
}

export interface CompanyDatabaseFile {
  version: string;
  companyId: string;
  companyName: string;
  createdAt: string;
  updatedAt: string;
  templates: any[];
  activeProductId: string;
  config: KonfigurasiSistem;
  bahanMentah: BahanMentah[];
  buruhLangsung: BuruhLangsung[];
  overheadBerubah: OverheadBerubah[];
  overheadTetap: OverheadTetap[];
}

export interface VariansBahan {
  nama: string;
  variansHarga: number;       // (AP - SP) * AQ
  variansPenggunaan: number;  // (AQ - (SQ per unit * SQ total_actual_units)) * SP
  variansJumlah: number;      // Varians Harga + Varians Penggunaan
  keadaanHarga: "F" | "U";    // Favorable (Memuaskan) atau Unfavorable (Tidak Memuaskan)
  keadaanPenggunaan: "F" | "U";
  keadaanJumlah: "F" | "U";
}

export interface VariansBuruh {
  nama: string;
  variansKadar: number;       // (AR - SR) * AH
  variansKecekapan: number;   // (AH - (SH per unit * SQ total_actual_units)) * SR
  variansJumlah: number;      // Varians Kadar + Varians Kecekapan
  keadaanKadar: "F" | "U";
  keadaanKecekapan: "F" | "U";
  keadaanJumlah: "F" | "U";
}

export interface VariansOverhead {
  nama: string;
  variansSimbahan: number; // Perbezaan kos berubah
  keadaan: "F" | "U";
}
