// =============================================================================
// Transfer UI
//
// Owns the transfer list DOM, including the full lifecycle of the object URLs
// held by Save controls: allocation and revocation live together here so a
// removal path can't drop an item without freeing its blob.
//
// What "Save all" covers is read off the list rather than tracked alongside it:
// an item carries the `saved` class once its bytes have been handed to the
// browser, and only items holding retained bytes have an entry to pack. A
// restored receipt has neither, so it is excluded without a special case.
// =============================================================================

import { MAX_HISTORY, SAVE_ALL_REVOKE_MS } from "./constants";
import { elements } from "./dom";
import { formatSize } from "./format";
import { showError } from "./toast";
import { buildZip, type ZipEntry } from "./zip";

// Bytes behind each item's Save control, for packing a batch into one archive.
// Weakly held so an item leaving the DOM takes its entry with it — the anchor's
// object URL is what keeps the blob alive, and revokeDownloadUrls frees that.
const savableEntries = new WeakMap<HTMLElement, ZipEntry>();

// Filename offered for a batch. Repeated batches collide, which the browser
// resolves by suffixing — preferable to a timestamp the user did not ask for.
const ARCHIVE_NAME = "frop-files.zip";

export function addTransferItem(
  name: string,
  size: number,
  direction: "send" | "receive",
): HTMLElement {
  const item = document.createElement("div");
  item.className = "transfer-item";
  item.dataset.direction = direction;

  const head = document.createElement("div");
  head.className = "transfer-head";

  const nameEl = document.createElement("span");
  nameEl.className = "transfer-name";
  nameEl.textContent = name;

  const metaEl = document.createElement("span");
  metaEl.className = "transfer-meta";
  metaEl.textContent = formatSize(size);

  head.append(nameEl, metaEl);

  const track = document.createElement("div");
  track.className = "progress-track";
  const fill = document.createElement("div");
  fill.className = "progress-fill";
  track.appendChild(fill);

  item.append(head, track);

  elements.transferList.appendChild(item);
  trimTransferList();
  return item;
}

export function updateProgress(
  element: HTMLElement,
  received: number,
  total: number,
): void {
  const pct = total > 0 ? Math.min(100, (received / total) * 100) : 0;
  element.querySelector<HTMLElement>(".progress-fill")!.style.width = `${pct}%`;
  element.querySelector<HTMLElement>(".transfer-meta")!.textContent =
    `${formatSize(received)} / ${formatSize(total)}`;
}

export function markComplete(element: HTMLElement, total: number): void {
  element.classList.add("done");
  element.querySelector<HTMLElement>(".progress-fill")!.style.width = "100%";
  element.querySelector<HTMLElement>(".transfer-meta")!.textContent =
    formatSize(total);
}

export function markCancelled(element: HTMLElement): void {
  element.classList.add("cancelled");
  element.querySelector<HTMLElement>(".transfer-meta")!.textContent =
    "cancelled";
}

export function markFailed(element: HTMLElement): void {
  element.classList.add("cancelled");
  element.querySelector<HTMLElement>(".transfer-meta")!.textContent =
    "failed — connection lost";
}

// Attach a Save control to a completed incoming transfer. The download fires
// from the user's tap (the gesture mobile browsers require) rather than
// programmatically. The blob URL stays live for the item's lifetime so the
// user can save (and re-save) whenever they choose.
export function addDownloadButton(
  element: HTMLElement,
  file: ZipEntry,
): void {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement("a");
  a.className = "transfer-download";
  a.href = url;
  // A path can't survive this attribute — browsers strip the separators — so a
  // single save lands flat under the basename. Save all keeps the tree.
  a.download = basename(file.name);
  a.textContent = "Save";
  a.addEventListener("click", () => {
    markSaved(element);
    refreshSaveAll();
  });
  element.appendChild(a);
  savableEntries.set(element, file);
  refreshSaveAll();
}

function basename(name: string): string {
  return name.slice(name.lastIndexOf("/") + 1);
}

// Saved is a state, not an end: the control stays live so a cancelled or
// misplaced download can be retried, and only its label says so.
//
// Mutates one item and nothing else — callers refresh the batch control once
// they have finished marking, so a batch costs one recount rather than one each.
function markSaved(element: HTMLElement): void {
  element.classList.add("saved");
  const a = element.querySelector<HTMLAnchorElement>(".transfer-download");
  if (a) {
    a.textContent = "Save again";
  }
}

// =============================================================================
// Save all
//
// Zips whatever hasn't been saved yet into one download. Zipping rather than
// clicking each anchor in turn is what makes this work at all on mobile (one
// gesture, one download) and what preserves the directory paths a folder
// transfer arrives with.
// =============================================================================

// Items still holding bytes nobody has saved, paired with those bytes. The
// join happens here so the DOM and the byte store are consulted exactly once.
// Hydrated items are excluded for free: they carry no entry, only a receipt.
function unsavedItems(): { el: HTMLElement; entry: ZipEntry }[] {
  const rows = elements.transferList.querySelectorAll<HTMLElement>(
    ":scope > .transfer-item:not(.saved)",
  );
  return [...rows].flatMap((el) => {
    const entry = savableEntries.get(el);
    return entry ? [{ el, entry }] : [];
  });
}

// Reflects the current unsaved count in the control, hiding it when there is
// nothing to batch — one unsaved file is already one tap on its own Save.
function refreshSaveAll(): void {
  const count = unsavedItems().length;
  elements.saveAllBtn.hidden = count < 2;
  elements.saveAllBtn.textContent = `Save all (${count})`;
}

export function saveAll(): void {
  const items = unsavedItems();
  if (items.length === 0) return;

  let zip: Blob;
  try {
    zip = buildZip(items.map((i) => i.entry));
  } catch (err) {
    console.error("[UI] Failed to build archive:", err);
    showError("Too much to zip at once — save these individually.");
    return;
  }

  const url = URL.createObjectURL(zip);
  const a = document.createElement("a");
  a.href = url;
  a.download = ARCHIVE_NAME;
  // Connected to the document for the click: a detached anchor's download is
  // not honored across browsers, and a click that quietly does nothing here
  // would still mark every item saved.
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Unlike the per-item URLs, this one is single-use: nothing in the DOM offers
  // it again, so it would pin the whole archive for the tab's life. The delay
  // outlives the synchronous start of the download the click just began.
  setTimeout(() => URL.revokeObjectURL(url), SAVE_ALL_REVOKE_MS);

  // The click is as much confirmation as the browser gives — a cancelled save
  // dialog looks identical — so treat these as saved and leave them re-savable.
  for (const { el } of items) {
    markSaved(el);
  }
  refreshSaveAll();
}

// Drop the oldest entries once a list exceeds the cap. Which end is oldest
// depends on how the list grows: transfers append (oldest first), clips prepend
// (oldest last). Trimming the wrong end would evict the item just added, so each
// list gets a named wrapper rather than exposing the choice to callers.
function trimList(
  list: HTMLElement,
  oldest: "first" | "last",
  max = MAX_HISTORY,
): void {
  while (list.children.length > max) {
    const stale = oldest === "first" ? list.firstElementChild : list.lastElementChild;
    if (stale instanceof HTMLElement) revokeDownloadUrls(stale);
    stale?.remove();
  }
}

// Eviction can drop an unsaved item, so the batch count follows the trim.
function trimTransferList(): void {
  trimList(elements.transferList, "first");
  refreshSaveAll();
}

export function trimClipboardList(): void {
  trimList(elements.clipboardList, "last");
}

export function clearTransferList(): void {
  revokeDownloadUrls(elements.transferList);
  elements.transferList.replaceChildren();
  refreshSaveAll();
}

// Free any object URLs held by Save controls within a subtree before it leaves
// the DOM. Each pins its blob (up to LARGE_FILE_THRESHOLD) in memory until
// revoked, so dropping an item without this leaks that blob for the tab's life.
function revokeDownloadUrls(root: HTMLElement): void {
  for (const a of root.querySelectorAll<HTMLAnchorElement>(".transfer-download")) {
    URL.revokeObjectURL(a.href);
  }
}
