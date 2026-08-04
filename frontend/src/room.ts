// =============================================================================
// Room Actions
// =============================================================================

import { COPY_FEEDBACK_MS } from "./constants";
import { clearClipboardList } from "./clipboard";
import { elements } from "./dom";
import { clearStoredHistory } from "./history";
import { close } from "./socket";
import { state } from "./state";
import { showError } from "./toast";
import { resetTransferState } from "./transfer";
import { clearTransferList } from "./ui";
import { setPeerConnected, setSessionTokenInUrl, showView } from "./views";
import { openSocket, resetReconnect } from "./ws";

const CODE_LENGTH = 6;

let copyHintResetTimer: number | null = null;

function renderRoomCode(code: string): void {
  const el = elements.roomCodeDisplay;
  el.replaceChildren(
    ...code.split("").map((ch) => {
      const span = document.createElement("span");
      span.textContent = ch;
      return span;
    }),
  );
  el.onclick = () => copyRoomCode(code);
  el.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      copyRoomCode(code);
    }
  };
}

async function copyRoomCode(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    return; // user-select: all already lets the user Ctrl+C manually
  }
  const el = elements.roomCodeDisplay;
  el.classList.add("copied");
  elements.codeHint.textContent = "Copied.";
  if (copyHintResetTimer !== null) clearTimeout(copyHintResetTimer);
  copyHintResetTimer = window.setTimeout(() => {
    el.classList.remove("copied");
    elements.codeHint.textContent = "Click to copy.";
  }, COPY_FEEDBACK_MS);
}

function connectAndJoin(): void {
  openSocket({ type: "join", code: state.roomCode! });
}

export async function createRoom(): Promise<void> {
  try {
    // Call REST API to create room
    const response = await fetch("/api/room", { method: "POST" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    state.roomCode = data.code;
    console.log("[Room] Created with code:", state.roomCode);

    renderRoomCode(data.code);
    showView("waiting");
    connectAndJoin();
  } catch (error) {
    console.error("[Room] Failed to create:", error);
  }
}

export function joinRoom(code: string): void {
  if (!code || code.length !== CODE_LENGTH) {
    console.error("[Room] Invalid code:", code);
    showError("Codes are six characters.");
    elements.codeInput.focus();
    return;
  }

  state.roomCode = code.toUpperCase();
  console.log("[Room] Joining:", state.roomCode);
  connectAndJoin();
}

export function cancelRoom(): void {
  console.log("[Room] Cancelling...");
  close();
  state.roomCode = null;
  showView("landing");
}

export function backToLanding(): void {
  clearStoredHistory(state.sessionToken);
  resetReconnect();
  state.roomCode = null;
  state.sessionToken = null;
  close();
  resetTransferState();
  clearTransferList();
  clearClipboardList();
  setPeerConnected(true);
  setSessionTokenInUrl(null);
  showView("landing");
}
