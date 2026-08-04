// =============================================================================
// Transfer UI
//
// Owns the transfer list DOM, including the full lifecycle of the object URLs
// held by Save controls: allocation and revocation live together here so a
// removal path can't drop an item without freeing its blob.
// =============================================================================

import { MAX_HISTORY } from "./constants";
import { elements } from "./dom";
import { formatSize } from "./format";

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
  trimList(elements.transferList);
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

// Attach a Save control to a completed incoming transfer. The download fires
// from the user's tap (the gesture mobile browsers require) rather than
// programmatically. The blob URL stays live for the item's lifetime so the
// user can save (and re-save) whenever they choose.
export function addDownloadButton(
  element: HTMLElement,
  blob: Blob,
  name: string,
): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.className = "transfer-download";
  a.href = url;
  a.download = name;
  a.textContent = "Save";
  a.addEventListener("click", () => {
    element.classList.add("saved");
  });
  element.appendChild(a);
}

export function trimList(list: HTMLElement, max = MAX_HISTORY): void {
  while (list.children.length > max) {
    const last = list.lastElementChild;
    if (last instanceof HTMLElement) revokeDownloadUrls(last);
    last?.remove();
  }
}

export function clearTransferList(): void {
  revokeDownloadUrls(elements.transferList);
  elements.transferList.replaceChildren();
}

// Free any object URLs held by Save controls within a subtree before it leaves
// the DOM. Each pins its blob (up to LARGE_FILE_THRESHOLD) in memory until
// revoked, so dropping an item without this leaks that blob for the tab's life.
function revokeDownloadUrls(root: HTMLElement): void {
  for (const a of root.querySelectorAll<HTMLAnchorElement>(".transfer-download")) {
    URL.revokeObjectURL(a.href);
  }
}
