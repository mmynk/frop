// =============================================================================
// Toast Notifications
// =============================================================================

import { ERROR_MESSAGES } from "./constants";
import { elements } from "./dom";

// Falls back for both unmapped codes and the empty string, so a server failure
// that carries no error code still surfaces a readable toast.
export function getErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] || "Something went sideways.";
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
