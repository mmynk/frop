// =============================================================================
// History rehydration
//
// Replays persisted records into the live DOM. Split from the storage layer so
// persistence stays free of UI dependencies.
// =============================================================================

import {
  addClipboardReceivedNotification,
  addClipboardSentNotification,
} from "./clipboard";
import { loadHistory } from "./history";
import { state } from "./state";
import { addTransferItem, markCancelled, markComplete } from "./ui";
import type { FileRecord } from "./types";

// The session whose history is already on screen. `connected` can arrive more
// than once for one session (a peer reconnecting re-notifies both sides) and
// must not duplicate the DOM; a genuinely new session must still hydrate.
let hydratedToken: string | null = null;

export function hydrateHistory(): void {
  if (hydratedToken === state.sessionToken) return;
  hydratedToken = state.sessionToken;

  const h = loadHistory();
  // Clips are stored oldest→newest; each add prepends, so iterating in order
  // leaves the newest on top — matching live behavior.
  for (const clip of h.clips) {
    if (clip.sent) {
      addClipboardSentNotification(clip.content, false);
    } else {
      addClipboardReceivedNotification(clip.content, false);
    }
  }
  // Files are stored and appended oldest→newest.
  for (const file of h.files) {
    restoreFileReceipt(file);
  }
}

function restoreFileReceipt(rec: FileRecord): void {
  const item = addTransferItem(rec.name, rec.size, rec.direction);
  if (rec.status === "cancelled") {
    markCancelled(item);
  } else {
    markComplete(item, rec.size);
  }
}
