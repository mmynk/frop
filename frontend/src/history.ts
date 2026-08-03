// =============================================================================
// History persistence
//
// Transfer and clipboard history live in the DOM, which a page refresh wipes.
// We mirror terminal-state records into sessionStorage keyed by the session
// token so a refresh (which auto-reconnects via ?s=token) can rehydrate them.
// sessionStorage — not localStorage — because a Frop session is inherently
// ephemeral: history should die with the tab, and needs no expiry logic.
//
// File bytes only ever stream through the relay, so a restored file is a
// read-only receipt (name/size/status), not something re-downloadable.
// =============================================================================

import { state } from "./state";
import type { FileRecord, HistoryRecord } from "./types";

const HISTORY_KEY_PREFIX = "frop_history_";
export const MAX_HISTORY = 10; // matches the live DOM trim

function historyKey(): string | null {
  return state.sessionToken ? HISTORY_KEY_PREFIX + state.sessionToken : null;
}

export function loadHistory(): HistoryRecord {
  const key = historyKey();
  const empty: HistoryRecord = { clips: [], files: [] };
  if (!key) return empty;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    return {
      clips: Array.isArray(parsed?.clips) ? parsed.clips : [],
      files: Array.isArray(parsed?.files) ? parsed.files : [],
    };
  } catch {
    return empty;
  }
}

function saveHistory(h: HistoryRecord): void {
  const key = historyKey();
  if (!key) return;
  try {
    sessionStorage.setItem(key, JSON.stringify(h));
  } catch {
    // sessionStorage unavailable (private mode) or over quota — history just
    // won't survive refresh. The live UI is unaffected.
  }
}

export function clearStoredHistory(token: string | null): void {
  if (!token) return;
  try {
    sessionStorage.removeItem(HISTORY_KEY_PREFIX + token);
  } catch {
    // ignore
  }
}

export function recordClip(sent: boolean, content: string): void {
  const h = loadHistory();
  h.clips.push({ sent, content });
  if (h.clips.length > MAX_HISTORY) h.clips = h.clips.slice(-MAX_HISTORY);
  saveHistory(h);
}

export function recordFile(rec: FileRecord): void {
  const h = loadHistory();
  h.files.push(rec);
  if (h.files.length > MAX_HISTORY) h.files = h.files.slice(-MAX_HISTORY);
  saveHistory(h);
}
