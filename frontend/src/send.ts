// =============================================================================
// Outbound control messages
//
// Kept separate from the socket lifecycle so senders (transfer, clipboard) can
// write to the peer without importing the module that dispatches inbound
// messages back to them.
// =============================================================================

import { state } from "./state";
import type { WsMessage } from "./types";

export function sendMessage(msg: WsMessage): void {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    console.error("[WS] Cannot send - not connected");
    return;
  }
  console.log("[WS] Sending:", msg);
  state.ws.send(JSON.stringify(msg));
}
