// =============================================================================
// Toast Notifications
// =============================================================================

import { ERROR_MESSAGES } from "./constants";
import { elements } from "./dom";

// Prefers a friendly message, falls back to the raw code (still more use to the
// user than a generic apology), and only goes generic when there is no code at
// all — a failure the server sent without one.
export function getErrorMessage(code: string): string {
  if (!code) return "Something went sideways.";
  return ERROR_MESSAGES[code] ?? code;
}

export function showError(message: string): void {
  console.error(`[Toast] ${message}`);

  const toast = document.createElement("div");
  toast.className = "toast error";
  toast.textContent = message;

  elements.toastContainer.appendChild(toast);

  // Trigger reflow for animation
  toast.offsetHeight;
  toast.classList.add("visible");

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    toast.classList.remove("visible");
    toast.addEventListener("transitionend", () => toast.remove());
  }, 4000);
}
