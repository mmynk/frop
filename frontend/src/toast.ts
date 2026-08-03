// =============================================================================
// Toast Notifications
// =============================================================================

import { ERROR_MESSAGES } from "./constants";
import { elements } from "./dom";

export function getErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? code ?? "Something went sideways.";
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
