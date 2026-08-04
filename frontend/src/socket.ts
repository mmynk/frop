// =============================================================================
// Socket transport
//
// Owns the connection handle and every write to the peer — control frames,
// binary chunks, and backpressure. Feature modules send through here and never
// touch the socket directly, which keeps the inbound dispatcher (ws.ts) off the
// write path and out of their import graph.
// =============================================================================

import { MAX_BUFFER_SIZE } from "./constants";
import { state } from "./state";
import type { WsMessage } from "./types";

function getWsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

interface ConnectOptions {
  // Sent as soon as the socket opens. The transport owns this so callers can't
  // clobber the open handler to get their first frame out.
  firstMessage?: WsMessage;
  onMessage: (event: MessageEvent) => void;
  onClose: () => void;
}

export function connect({ firstMessage, onMessage, onClose }: ConnectOptions): void {
  // Abandon any previous socket first. Its close event arrives asynchronously,
  // and every handler below is guarded on still being the current socket, so a
  // straggler can't null out this live handle or misroute its first frame.
  close();

  const ws = new WebSocket(getWsUrl());
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    if (state.ws !== ws) return;
    console.log("[WS] Connected");
    if (firstMessage) {
      sendMessage(firstMessage);
    }
  };

  ws.onmessage = (event) => {
    if (state.ws !== ws) return;
    onMessage(event);
  };

  ws.onerror = (error) => {
    console.error("[WS] Error:", error);
  };

  ws.onclose = () => {
    if (state.ws !== ws) return;
    console.log("[WS] Disconnected");
    state.ws = null;
    onClose();
  };

  state.ws = ws;
}

export function isConnected(): boolean {
  return state.ws !== null;
}

// Deliberate teardown: drop ownership immediately rather than waiting for the
// async close event, so callers that follow up by inspecting connection state
// (or opening a fresh socket) see the disconnect right away. The abandoned
// socket's handlers are inert once state.ws no longer points at it, so no
// onClose fires — this is a close the caller asked for, not a drop to report.
export function close(): void {
  const ws = state.ws;
  if (!ws) return;
  state.ws = null;
  ws.close();
}

export function sendMessage(msg: WsMessage): void {
  const ws = state.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error("[WS] Cannot send - not connected");
    return;
  }
  console.log("[WS] Sending:", msg);
  ws.send(JSON.stringify(msg));
}

/**
 * Write one binary chunk, waiting first for the send buffer to drain below the
 * threshold. The wait is the backpressure that keeps a large transfer from
 * queueing unbounded data in memory.
 *
 * Returns false if the chunk could not be handed to a live socket, so callers
 * stop rather than run to completion reporting a transfer the peer never got.
 */
export async function sendBinary(buffer: ArrayBuffer): Promise<boolean> {
  const ws = state.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error("[WS] Cannot send chunk - not connected");
    return false;
  }
  if (!(await waitForBuffer(ws))) return false;
  ws.send(buffer);
  return true;
}

// Resolves true once the buffer has drained, false if the socket died while
// waiting. bufferedAmount is not cleared on close, so a socket that drops with
// more than the threshold still queued would otherwise never drain and the
// caller would await forever.
function waitForBuffer(ws: WebSocket): Promise<boolean> {
  return new Promise((resolve) => {
    // bufferedAmount has no change event, so polling is the only option.
    const checkBuffer = () => {
      if (ws.readyState !== WebSocket.OPEN || state.ws !== ws) {
        resolve(false);
      } else if (ws.bufferedAmount < MAX_BUFFER_SIZE) {
        resolve(true);
      } else {
        setTimeout(checkBuffer, 10);
      }
    };
    checkBuffer();
  });
}
