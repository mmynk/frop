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
import { addTransferItem, markCancelled, markComplete } from "./ui";
import type { FileRecord } from "./types";

let historyHydrated = false;

// Rehydrate the lists from storage exactly once per page load. `connected`
// can arrive more than once (a peer reconnecting re-notifies both sides); the
// guard keeps those later notifications from duplicating the live DOM.
export function hydrateHistory(): void {
  if (historyHydrated) return;
  historyHydrated = true;
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
