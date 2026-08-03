// =============================================================================
// View Management
// =============================================================================

import { elements } from "./dom";
import { state } from "./state";
import type { View } from "./types";

export function showView(view: View): void {
  // Hide all views
  elements.landing.classList.remove("active");
  elements.waiting.classList.remove("active");
  elements.connected.classList.remove("active");
  elements.disconnected.classList.remove("active");

  // Show requested view
  const viewElement = elements[view];
  viewElement.classList.add("active");

  if (view === "connected") {
    startUptime();
  } else {
    stopUptime();
  }

  state.view = view;
  console.log(`[View] Switched to: ${view}`);
}

export function setPeerConnected(connected: boolean): void {
  elements.statusDot.classList.toggle("disconnected", !connected);
  elements.statusDot.classList.remove("reconnecting");
  elements.statusText.textContent = connected ? "Connected." : "Disconnected.";
  elements.dropzone.hidden = !connected;
  elements.disconnectedBanner.hidden = connected;
  // Freeze the uptime when the peer is gone. showView("connected") restarts
  // it on the next pairing.
  if (!connected) {
    stopUptime();
  }
}

// Our own socket dropped but the session may still be alive: show a transient
// "Reconnecting" state instead of the terminal disconnected banner. The
// dropzone stays hidden (can't send while offline) but no "Start over" prompt.
export function setReconnecting(): void {
  elements.statusDot.classList.remove("disconnected");
  elements.statusDot.classList.add("reconnecting");
  elements.statusText.textContent = "Reconnecting…";
  elements.dropzone.hidden = true;
  elements.disconnectedBanner.hidden = true;
  stopUptime();
}

// After pairing, preserve history by marking the connected view disconnected
// in place. Before pairing, there's nothing to preserve — use the dedicated view.
export function handleDisconnect(): void {
  if (state.view === "connected") {
    setPeerConnected(false);
  } else if (state.view === "waiting") {
    showView("disconnected");
  }
}

export function setSessionTokenInUrl(token: string | null): void {
  const url = new URL(window.location.href);
  if (token) {
    url.searchParams.set("s", token);
  } else {
    url.searchParams.delete("s");
  }
  window.history.replaceState({}, "", url.toString());
}

// =============================================================================
// Connected — uptime timer
// =============================================================================

let connectedAt: number | null = null;
let uptimeInterval: number | null = null;

function updateUptime(): void {
  if (connectedAt === null) return;
  const secs = Math.floor((Date.now() - connectedAt) / 1000);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  const code = state.roomCode ?? "------";
  elements.statusRight.textContent = `${code} · ${mm}:${ss}`;
}

function startUptime(): void {
  connectedAt = Date.now();
  updateUptime();
  if (uptimeInterval !== null) {
    clearInterval(uptimeInterval);
  }
  uptimeInterval = window.setInterval(updateUptime, 1000);
}

function stopUptime(): void {
  if (uptimeInterval !== null) {
    clearInterval(uptimeInterval);
    uptimeInterval = null;
  }
  connectedAt = null;
  elements.statusRight.textContent = "";
}
