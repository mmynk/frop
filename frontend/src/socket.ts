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
  const ws = new WebSocket(getWsUrl());
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    console.log("[WS] Connected");
    if (firstMessage) {
      sendMessage(firstMessage);
    }
  };

  ws.onmessage = onMessage;

  ws.onerror = (error) => {
    console.error("[WS] Error:", error);
  };

  ws.onclose = () => {
    console.log("[WS] Disconnected");
    state.ws = null;
    onClose();
  };

  state.ws = ws;
}

export function isConnected(): boolean {
  return state.ws !== null;
}

export function close(): void {
  state.ws?.close();
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
 */
export async function sendBinary(buffer: ArrayBuffer): Promise<void> {
  const ws = state.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error("[WS] Cannot send chunk - not connected");
    return;
  }
  await waitForBuffer(ws);
  ws.send(buffer);
}

function waitForBuffer(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    // bufferedAmount has no change event, so polling is the only option.
    const checkBuffer = () => {
      if (ws.bufferedAmount < MAX_BUFFER_SIZE) {
        resolve();
      } else {
        setTimeout(checkBuffer, 10);
      }
    };
    checkBuffer();
  });
}
