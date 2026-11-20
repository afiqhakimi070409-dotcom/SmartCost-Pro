/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

/**
 * Common keyboard event handler for form input fields to advance to the next field on Enter.
 *
 * Rules:
 * - Enter advances focus to the next logical input field in the document or container.
 * - Enter does NOT submit the form unexpectedly, clear inputs, or trigger delete/cancel buttons.
 * - Shift+Enter can move focus backward if applicable.
 * - When an optional onEnterAction is provided (e.g. for quick item add), it will be executed if defined.
 */
export function handleInputEnterKey(
  e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  onEnterAction?: () => void
) {
  if (e.key !== "Enter") return;

  // In a textarea, let Enter create a new line unless Ctrl/Cmd is pressed
  if (e.currentTarget.tagName.toLowerCase() === "textarea" && !e.ctrlKey && !e.metaKey) {
    return;
  }

  // Prevent default form submission or undesired button clicks
  e.preventDefault();

  if (onEnterAction) {
    onEnterAction();
    return;
  }

  // Move focus to the next eligible form input
  moveToNextInput(e.currentTarget);
}

/**
 * Finds all visible, enabled interactive form controls and focuses the next one.
 */
export function moveToNextInput(currentElement: HTMLElement) {
  // Try to find the closest form or container
  const container = currentElement.closest("form") || currentElement.closest("[data-form-container]") || document.body;
  if (!container) return;

  const selector = 'input:not([type="hidden"]):not([disabled]):not([readonly]), select:not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly]), button[type="submit"]:not([disabled])';
  const focusables = Array.from(container.querySelectorAll<HTMLElement>(selector)).filter((el) => {
    // Check element visibility
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
  });

  const currentIndex = focusables.indexOf(currentElement);
  if (currentIndex >= 0 && currentIndex < focusables.length - 1) {
    const nextElement = focusables[currentIndex + 1];
    nextElement.focus();
    if (nextElement instanceof HTMLInputElement && (nextElement.type === "text" || nextElement.type === "number")) {
      nextElement.select();
    }
  }
}
