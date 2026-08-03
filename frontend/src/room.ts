// =============================================================================
// Room Actions
// =============================================================================

import { elements } from "./dom";
import { clearStoredHistory } from "./history";
import { sendMessage } from "./send";
import { state } from "./state";
import { showError } from "./toast";
import { resetTransferState } from "./transfer";
import { revokeDownloadUrls } from "./ui";
import { setPeerConnected, setSessionTokenInUrl, showView } from "./views";
import { connectWebSocket, resetReconnect } from "./ws";

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
  }, 1200);
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

    // Connect WebSocket and join room
    const ws = connectWebSocket();
    ws.onopen = () => {
      console.log("[WS] Connected, joining room...");
      sendMessage({ type: "join", code: state.roomCode! });
    };
  } catch (error) {
    console.error("[Room] Failed to create:", error);
  }
}

export function joinRoom(code: string): void {
  if (!code || code.length !== 6) {
    console.error("[Room] Invalid code:", code);
    showError("Codes are six characters.");
    elements.codeInput.focus();
    return;
  }

  state.roomCode = code.toUpperCase();
  console.log("[Room] Joining:", state.roomCode);

  // Connect WebSocket and join
  const ws = connectWebSocket();
  ws.onopen = () => {
    console.log("[WS] Connected, joining room...");
    sendMessage({ type: "join", code: state.roomCode! });
  };
}

export function cancelRoom(): void {
  console.log("[Room] Cancelling...");
  if (state.ws) {
    state.ws.close();
  }
  state.roomCode = null;
  showView("landing");
}

export function backToLanding(): void {
  clearStoredHistory(state.sessionToken);
  resetReconnect();
  state.roomCode = null;
  state.sessionToken = null;
  if (state.ws) {
    state.ws.close();
  }
  resetTransferState();
  revokeDownloadUrls(elements.transferList);
  elements.transferList.innerHTML = "";
  elements.clipboardList.innerHTML = "";
  setPeerConnected(true);
  setSessionTokenInUrl(null);
  showView("landing");
}
