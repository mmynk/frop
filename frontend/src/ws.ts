// =============================================================================
// Inbound message dispatch and reconnection policy
//
// Routes what arrives on the socket to the feature modules. Writes go through
// socket.ts, so nothing here sits on the send path.
// =============================================================================

import { handleClipboardReceived } from "./clipboard";
import { hydrateHistory } from "./hydrate";
import { connect } from "./socket";
import { state } from "./state";
import { getErrorMessage, showError } from "./toast";
import {
  handleBinaryChunk,
  handleFileCancel,
  handleFileEnd,
  handleFileStart,
} from "./transfer";
import {
  handleDisconnect,
  setPeerConnected,
  setReconnecting,
  setSessionTokenInUrl,
  showView,
} from "./views";
import type { WsMessage } from "./types";

// Open a socket, optionally announcing ourselves with a first control message.
export function openSocket(firstMessage?: WsMessage): void {
  connect({
    firstMessage,
    onMessage: async (event) => {
      if (event.data instanceof ArrayBuffer) {
        await handleBinaryChunk(event.data);
        return;
      }

      console.log("[WS] Message:", event.data);
      const msg: WsMessage = JSON.parse(event.data);
      await handleWsMessage(msg);
    },
    onClose: () => {
      // A live drop while paired (screen lock, backgrounded tab, network blip)
      // is recoverable: the session survives server-side for its lifespan, so
      // retry with the token instead of stranding the user on a dead view.
      if (state.sessionToken && state.view === "connected") {
        setReconnecting();
        scheduleReconnect();
      } else {
        handleDisconnect();
      }
    },
  });
}

// =============================================================================
// Reconnection
//
// When our own socket drops mid-session we reconnect by session token rather
// than making the user re-pair. Backoff covers transient foreground blips;
// mobile browsers freeze timers while backgrounded, so the practical trigger
// for "came back to the app" is the visibilitychange/online listeners, which
// reset the backoff and retry at once.
// =============================================================================

const MAX_RECONNECT_ATTEMPTS = 6;
const MAX_RECONNECT_DELAY = 15000; // 15s ceiling on backoff
let reconnectAttempts = 0;
let reconnectTimer: number | null = null;

function scheduleReconnect(): void {
  if (!state.sessionToken || state.ws || reconnectTimer !== null) return;
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    // Give up the automatic loop and surface the banner so the user can act.
    // A later visibilitychange/online resets the counter and tries again.
    handleDisconnect();
    return;
  }
  const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY);
  reconnectAttempts++;
  console.log(`[WS] Reconnect attempt ${reconnectAttempts} in ${delay}ms`);
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    attemptReconnect();
  }, delay);
}

function attemptReconnect(): void {
  if (!state.sessionToken || state.ws) return;
  console.log("[WS] Reconnecting with session token...");
  openSocket({ type: "reconnect", sessionToken: state.sessionToken });
}

// Fired when the tab regains focus or the network returns — skip the backoff
// wait and try immediately, since these are the moments a drop is recoverable.
export function reconnectNow(): void {
  if (!state.sessionToken || state.ws) return;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  attemptReconnect();
}

export function resetReconnect(): void {
  reconnectAttempts = 0;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

async function handleWsMessage(msg: WsMessage): Promise<void> {
  switch (msg.type) {
    case "connected":
      console.log("[WS] Paired with peer! Token:", msg.sessionToken);
      state.sessionToken = msg.sessionToken ?? null;
      resetReconnect();

      if (state.sessionToken) {
        setSessionTokenInUrl(state.sessionToken);
      }

      // Restore any history saved under this session before the refresh.
      hydrateHistory();

      setPeerConnected(true);
      showView("connected");
      break;

    case "failed":
      console.error("[WS] Operation failed:", msg.error);
      showError(getErrorMessage(msg.error ?? ""));

      state.sessionToken = null;
      resetReconnect();
      setSessionTokenInUrl(null);

      showView("landing");
      break;

    case "peer_disconnected":
      console.log("[WS] Peer disconnected");
      handleDisconnect();
      break;

    case "file_start":
      await handleFileStart(msg);
      break;

    case "file_end":
      await handleFileEnd();
      break;

    case "file_cancel":
      await handleFileCancel(msg);
      break;

    case "clipboard":
      handleClipboardReceived(msg);
      break;

    default:
      console.warn("[WS] Unknown message type:", msg.type);
  }
}
