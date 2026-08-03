// =============================================================================
// State
// =============================================================================

import type { AppState } from "./types";

export const state: AppState = {
  view: "landing",
  roomCode: null,
  sessionToken: null,
  ws: null,
};
