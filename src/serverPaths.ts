/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Runtime-safe project path resolution for both TypeScript dev/test execution (`tsx server.ts`)
 * and compiled CommonJS production execution (`node dist/server.cjs`) on Cloud Run.
 */

import fs from "fs";
import path from "path";

function findRootFrom(startDir: string | undefined): string | null {
  if (!startDir) return null;
  let dir = path.resolve(startDir);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function resolveProjectRoot(): string {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "package.json"))) {
    return cwd;
  }

  if (typeof __dirname !== "undefined") {
    const fromDirname = findRootFrom(__dirname);
    if (fromDirname) return fromDirname;
  }

  if (process.argv[1]) {
    const fromArgv = findRootFrom(path.dirname(path.resolve(process.argv[1])));
    if (fromArgv) return fromArgv;
  }

  if (typeof __dirname !== "undefined") {
    const base = path.basename(__dirname);
    if (base === "dist" || base === "src") {
      return path.resolve(__dirname, "..");
    }
    return __dirname;
  }

  return cwd;
}

export const PROJECT_ROOT = resolveProjectRoot();
export const DATA_DIR = path.join(PROJECT_ROOT, "data");
export const DIST_DIR = path.join(PROJECT_ROOT, "dist");
export const BACKUP_DIR = path.join(DATA_DIR, "backups");
