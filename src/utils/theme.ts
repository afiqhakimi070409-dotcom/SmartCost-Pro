/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SmartCost Theme System (Bright Mode & Dark Mode)
 * Provides persistent theme state, system preference detection, and DOM synchronization.
 */

export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "smartcost_theme_preference";

/**
 * Retrieves the stored theme preference or falls back to system preference.
 */
export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "dark" || saved === "light") {
      return saved;
    }
    // Check operating system / browser preference
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
  } catch (e) {
    console.warn("[Theme] Unable to read localStorage theme preference:", e);
  }
  return "light";
}

/**
 * Applies the theme to the <html> document root without page refresh.
 */
export function applyThemeToDOM(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  root.style.colorScheme = theme;
}

/**
 * Persists the theme preference and updates the DOM immediately.
 */
export function setStoredTheme(theme: ThemeMode): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (e) {
    console.warn("[Theme] Unable to write localStorage theme preference:", e);
  }
  applyThemeToDOM(theme);
}
