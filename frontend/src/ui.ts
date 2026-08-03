// =============================================================================
// Transfer UI
// =============================================================================

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
  trimList(elements.transferList, 10);
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

export function trimList(list: HTMLElement, max: number): void {
  while (list.children.length > max) {
    const last = list.lastElementChild;
    if (last instanceof HTMLElement) revokeDownloadUrls(last);
    last?.remove();
  }
}

// Free any object URLs held by Save controls within a subtree before it leaves
// the DOM. Each pins its blob (up to LARGE_FILE_THRESHOLD) in memory until
// revoked, so dropping an item without this leaks that blob for the tab's life.
export function revokeDownloadUrls(root: HTMLElement): void {
  for (const a of root.querySelectorAll<HTMLAnchorElement>(".transfer-download")) {
    URL.revokeObjectURL(a.href);
  }
}
