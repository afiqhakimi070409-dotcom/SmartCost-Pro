/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Secret Developer Keyboard Shortcut Matcher (ALT + D & configurable alternative CTRL + SHIFT + D).
 * Prevents accidental activation inside editable fields or on key repeat / IME composition.
 */

export interface AlternativeShortcutConfig {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  key: string;
}

export function parseAlternativeShortcut(raw?: string): AlternativeShortcutConfig {
  const defaultSpec: AlternativeShortcutConfig = {
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
    metaKey: false,
    key: "d",
  };

  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return defaultSpec;
  }

  const tokens = raw
    .split("+")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  if (tokens.length === 0) return defaultSpec;

  const keyToken = tokens[tokens.length - 1];
  if (!keyToken || keyToken.length !== 1 || !/^[a-z0-9]$/.test(keyToken)) {
    return defaultSpec;
  }

  const modifiers = new Set(tokens.slice(0, -1));
  const ctrlKey = modifiers.has("ctrl") || modifiers.has("control");
  const shiftKey = modifiers.has("shift");
  const altKey = modifiers.has("alt") || modifiers.has("option");
  const metaKey = modifiers.has("meta") || modifiers.has("cmd") || modifiers.has("command");

  // Require at least one non-trivial modifier combination so single keys cannot trigger
  if (!ctrlKey && !altKey && !metaKey) {
    return defaultSpec;
  }

  return {
    ctrlKey,
    shiftKey,
    altKey,
    metaKey,
    key: keyToken,
  };
}

export function getConfiguredAlternativeShortcut(): AlternativeShortcutConfig {
  const envShortcut =
    typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_DEV_ALT_SHORTCUT
      ? String((import.meta as any).env.VITE_DEV_ALT_SHORTCUT)
      : undefined;
  return parseAlternativeShortcut(envShortcut);
}

export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") {
    return false;
  }
  const el = target as HTMLElement;
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (el.isContentEditable) {
    return true;
  }
  if (typeof el.closest === "function") {
    if (el.closest('[contenteditable="true"], [contenteditable=""], [role="textbox"], input, textarea, select')) {
      return true;
    }
  }
  return false;
}

function matchesKeyChar(e: KeyboardEvent, expectedChar: string): boolean {
  const lowerExpected = expectedChar.toLowerCase();
  const keyLower = (e.key || "").toLowerCase();
  const codeMatch = e.code === `Key${lowerExpected.toUpperCase()}` || e.code === `Digit${lowerExpected}`;
  return keyLower === lowerExpected || codeMatch;
}

export function isDeveloperShortcutEvent(
  e: KeyboardEvent,
  altShortcutConfig: AlternativeShortcutConfig = getConfiguredAlternativeShortcut()
): boolean {
  if (e.repeat || e.isComposing) return false;
  if (isEditableEventTarget(e.target)) return false;

  // Primary shortcut: ALT + D (avoid conflicts with Ctrl+Alt+D / Meta+Alt+D / Alt+Shift+D)
  const isPrimaryAltD =
    e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.shiftKey &&
    matchesKeyChar(e, "d");

  if (isPrimaryAltD) return true;

  // Configurable fallback shortcut: default CTRL + SHIFT + D
  const isAlternativeMatch =
    e.ctrlKey === altShortcutConfig.ctrlKey &&
    e.shiftKey === altShortcutConfig.shiftKey &&
    e.altKey === altShortcutConfig.altKey &&
    e.metaKey === altShortcutConfig.metaKey &&
    matchesKeyChar(e, altShortcutConfig.key);

  return isAlternativeMatch;
}
