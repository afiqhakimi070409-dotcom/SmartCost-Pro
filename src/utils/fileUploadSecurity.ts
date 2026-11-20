/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client-Side File Upload Security Helper
 * - Enforces strict file extensions, MIME allowlists, size ceilings, and real file magic-bytes
 * - Explicitly blocks SVG/HTML/script files in logo uploads (stored XSS defense)
 * - Strips prototype pollution keys (__proto__, constructor, prototype) from imported JSON backups
 */

export const MAX_LOGO_UPLOAD_BYTES = 2 * 1024 * 1024; // 2MB
export const MAX_BACKUP_JSON_BYTES = 10 * 1024 * 1024; // 10MB

const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const ALLOWED_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx < 0) return "";
  return fileName.slice(idx + 1).toLowerCase().trim();
}

export async function validateAndReadImageFile(
  file: File,
  lang: "ms" | "en" = "ms"
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  if (!file) {
    return { ok: false, error: lang === "en" ? "No image file selected." : "Tiada fail imej dipilih." };
  }

  const ext = getExtension(file.name);
  const mime = (file.type || "").toLowerCase();

  if (ext === "svg" || mime.includes("svg") || ext === "html" || ext === "htm" || mime.includes("html")) {
    return {
      ok: false,
      error:
        lang === "en"
          ? "SVG and HTML files are blocked for security. Please upload a PNG, JPEG, or WEBP image."
          : "Fail SVG dan HTML disekat atas faktor keselamatan. Sila muat naik imej PNG, JPEG atau WEBP sahaja.",
    };
  }

  if (!ALLOWED_IMAGE_EXTENSIONS.has(ext) || (mime && !ALLOWED_IMAGE_MIME_TYPES.has(mime))) {
    return {
      ok: false,
      error:
        lang === "en"
          ? "Invalid image format. Only PNG, JPG, and WEBP images are allowed."
          : "Format imej tidak sah. Hanya fail PNG, JPG dan WEBP dibenarkan.",
    };
  }

  if (file.size <= 0 || file.size > MAX_LOGO_UPLOAD_BYTES) {
    return {
      ok: false,
      error:
        lang === "en"
          ? "Image size must be greater than 0 and under 2MB."
          : "Saiz fail logo mestilah lebih daripada 0 dan tidak melebihi 2MB.",
    };
  }

  const headerBuf = await file.slice(0, 12).arrayBuffer();
  const bytes = new Uint8Array(headerBuf);
  if (bytes.length < 12) {
    return {
      ok: false,
      error: lang === "en" ? "Corrupted or empty image file." : "Fail imej rosak atau kosong.",
    };
  }

  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;

  if (!isPng && !isJpeg && !isWebp) {
    return {
      ok: false,
      error:
        lang === "en"
          ? "Invalid file signature. The file content does not match a genuine PNG, JPEG, or WEBP image."
          : "Tandatangan fail tidak sah. Kandungan fail bukan imej PNG, JPEG atau WEBP yang sebenar.",
    };
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(file);
  });

  if (!/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(dataUrl)) {
    return {
      ok: false,
      error: lang === "en" ? "Unsupported image encoding." : "Pengekodan imej tidak disokong.",
    };
  }

  return { ok: true, dataUrl };
}

export function sanitizeParsedJson<T>(val: T, depth = 0): T {
  if (depth > 14 || val === null || typeof val !== "object") return val;
  if (Array.isArray(val)) {
    return val.map((item) => sanitizeParsedJson(item, depth + 1)) as unknown as T;
  }
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(k)) continue;
    clean[k] = sanitizeParsedJson(v, depth + 1);
  }
  return clean as T;
}

export async function validateAndReadJsonFile(
  file: File,
  lang: "ms" | "en" = "ms"
): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  if (!file) {
    return { ok: false, error: lang === "en" ? "No file selected." : "Tiada fail dipilih." };
  }

  const ext = getExtension(file.name);
  const mime = (file.type || "").toLowerCase();
  if (ext !== "json" || (mime && mime !== "application/json" && mime !== "text/json" && mime !== "text/plain")) {
    return {
      ok: false,
      error:
        lang === "en"
          ? "Only valid .json backup files are permitted."
          : "Hanya fail sandaran berformat .json yang sah dibenarkan.",
    };
  }

  if (file.size <= 0 || file.size > MAX_BACKUP_JSON_BYTES) {
    return {
      ok: false,
      error:
        lang === "en"
          ? "JSON backup file size must not exceed 10MB."
          : "Saiz fail sandaran JSON tidak boleh melebihi 10MB.",
    };
  }

  try {
    const rawText = await file.text();
    if (/"(?:__proto__|constructor|prototype)"\s*:/.test(rawText)) {
      return {
        ok: false,
        error:
          lang === "en"
            ? "Security check failed: backup file contains forbidden prototype keys."
            : "Semakan keselamatan gagal: fail sandaran mengandungi kunci struktur yang disekat.",
      };
    }

    const parsed = JSON.parse(rawText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error: lang === "en" ? "Invalid JSON root object." : "Struktur asas objek JSON tidak sah.",
      };
    }
    return { ok: true, data: sanitizeParsedJson(parsed) };
  } catch {
    return {
      ok: false,
      error:
        lang === "en"
          ? "Failed to parse JSON file. The file is corrupted or not a valid JSON document."
          : "Gagal membaca fail JSON. Fail ini rosak atau bukan format JSON yang sah.",
    };
  }
}
