// =============================================================================
// Application state
// =============================================================================

import type { View } from "./types";

interface AppState {
  view: View;
  roomCode: string | null;
  sessionToken: string | null;
  ws: WebSocket | null;
}

export const state: AppState = {
  view: "landing",
  roomCode: null,
  sessionToken: null,
  ws: null,
};
