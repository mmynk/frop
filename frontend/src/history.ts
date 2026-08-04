// =============================================================================
// History persistence
//
// Transfer and clipboard history live in the DOM, which a page refresh wipes.
// We mirror terminal-state records into sessionStorage keyed by the session
// token so a refresh (which auto-reconnects via ?s=token) can rehydrate them.
// sessionStorage — not localStorage — because a Frop session is inherently
// ephemeral: history should die with the tab, and needs no expiry logic.
//
// Records accumulate in memory and flush on a timer: a directory send records
// once per file, and serializing the whole blob on each would put a full
// parse/stringify cycle inside the send loop.
//
// File bytes only ever stream through the relay, so a restored file is a
// read-only receipt (name/size/status), not something re-downloadable.
// =============================================================================

import { MAX_HISTORY } from "./constants";
import { state } from "./state";
import type { FileRecord, HistoryRecord } from "./types";

const HISTORY_KEY_PREFIX = "frop_history_";
const FLUSH_DELAY_MS = 250;

// In-memory mirror of the stored record, along with the token it belongs to so
// a session change can't write one session's history under another's key.
let cache: HistoryRecord | null = null;
let cacheToken: string | null = null;
let flushTimer: number | null = null;

function historyKey(token: string | null): string | null {
  return token ? HISTORY_KEY_PREFIX + token : null;
}

export function loadHistory(): HistoryRecord {
  if (cache && cacheToken === state.sessionToken) return cache;

  const empty: HistoryRecord = { clips: [], files: [] };
  const key = historyKey(state.sessionToken);
  cacheToken = state.sessionToken;

  if (!key) {
    cache = empty;
    return cache;
  }
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) {
      cache = empty;
      return cache;
    }
    const parsed = JSON.parse(raw);
    cache = {
      clips: Array.isArray(parsed?.clips) ? parsed.clips : [],
      files: Array.isArray(parsed?.files) ? parsed.files : [],
    };
  } catch {
    cache = empty;
  }
  return cache;
}

function flush(): void {
  flushTimer = null;
  const key = historyKey(cacheToken);
  if (!key || !cache) return;
  try {
    sessionStorage.setItem(key, JSON.stringify(cache));
  } catch {
    // sessionStorage unavailable (private mode) or over quota — history just
    // won't survive refresh. The live UI is unaffected.
  }
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = window.setTimeout(flush, FLUSH_DELAY_MS);
}

export function clearStoredHistory(token: string | null): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  cache = null;
  cacheToken = null;
  const key = historyKey(token);
  if (!key) return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function recordClip(sent: boolean, content: string): void {
  const h = loadHistory();
  h.clips.push({ sent, content });
  if (h.clips.length > MAX_HISTORY) h.clips = h.clips.slice(-MAX_HISTORY);
  scheduleFlush();
}

export function recordFile(rec: FileRecord): void {
  const h = loadHistory();
  h.files.push(rec);
  if (h.files.length > MAX_HISTORY) h.files = h.files.slice(-MAX_HISTORY);
  scheduleFlush();
}
