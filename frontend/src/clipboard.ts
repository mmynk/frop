// =============================================================================
// Clipboard Sharing
// =============================================================================

import { COPY_FEEDBACK_MS, MAX_CLIPBOARD_SIZE } from "./constants";
import { elements, isInputFocused } from "./dom";
import { formatSize, truncateText } from "./format";
import { recordClip } from "./history";
import { isConnected, sendMessage } from "./socket";
import { state } from "./state";
import { queueFiles } from "./transfer";
import { showError } from "./toast";
import { trimClipboardList } from "./ui";
import type { WsMessage } from "./types";

function tooBigMessage(size: number): string {
  return `Clipboard is too big (${formatSize(size)}). ${formatSize(MAX_CLIPBOARD_SIZE)} max.`;
}

export async function sendClipboard(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) {
      console.log("[Clipboard] Nothing to send (empty)");
      return;
    }

    if (text.length > MAX_CLIPBOARD_SIZE) {
      console.warn(`[Clipboard] Too large: ${text.length} bytes (max ${MAX_CLIPBOARD_SIZE})`);
      showError(tooBigMessage(text.length));
      return;
    }

    console.log(`[Clipboard] Sending ${text.length} chars`);
    sendMessage({ type: "clipboard", content: text });
    addClipboardSentNotification(text);
  } catch (err) {
    console.warn("[Clipboard] API unavailable or denied, showing fallback:", err);
    showClipboardFallback();
  }
}

// =============================================================================
// Modal chrome
//
// Both clipboard fallbacks share an overlay, dismissal contract, and focus
// delay; only their bodies and controls differ. The shared shell keeps those
// behaviors from drifting apart, while each caller still wires its own buttons.
// =============================================================================

const FOCUS_DELAY_MS = 50; // let the overlay paint before stealing focus

interface Modal {
  modal: HTMLElement;
  textarea: HTMLTextAreaElement;
  close: () => void;
}

function openModal(bodyHtml: string): Modal {
  const overlay = document.createElement("div");
  overlay.className = "clipboard-modal-overlay";

  const modal = document.createElement("div");
  modal.className = "clipboard-modal";
  modal.innerHTML = bodyHtml;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  const textarea = modal.querySelector<HTMLTextAreaElement>(".clipboard-modal-textarea")!;
  setTimeout(() => textarea.focus(), FOCUS_DELAY_MS);

  return { modal, textarea, close };
}

function showClipboardFallback(): void {
  const { modal, textarea, close } = openModal(`
    <p class="clipboard-modal-title">Paste it here.</p>
    <textarea class="clipboard-modal-textarea" placeholder="Ctrl+V or ⌘V" rows="4"></textarea>
    <p class="clipboard-modal-hint">Ctrl+Enter to send.</p>
    <div class="clipboard-modal-actions">
      <button class="btn clipboard-modal-cancel">Cancel</button>
      <button class="btn primary clipboard-modal-send">Send</button>
    </div>
  `);

  function submit(): void {
    const text = textarea.value;
    if (!text) return;

    if (text.length > MAX_CLIPBOARD_SIZE) {
      showError(tooBigMessage(text.length));
      return;
    }

    sendMessage({ type: "clipboard", content: text });
    addClipboardSentNotification(text);
    close();
  }

  modal.querySelector<HTMLButtonElement>(".clipboard-modal-cancel")!
    .addEventListener("click", close);
  modal.querySelector<HTMLButtonElement>(".clipboard-modal-send")!
    .addEventListener("click", submit);
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
  });
}

function showCopyFallback(content: string): void {
  const { modal, textarea, close } = openModal(`
    <p class="clipboard-modal-title">Copy it here.</p>
    <textarea class="clipboard-modal-textarea" readonly rows="4"></textarea>
    <p class="clipboard-modal-hint">Select all, then Ctrl+C or ⌘C.</p>
    <div class="clipboard-modal-actions">
      <button class="btn clipboard-modal-cancel">Close</button>
    </div>
  `);

  textarea.value = content;
  setTimeout(() => textarea.select(), FOCUS_DELAY_MS);

  modal.querySelector<HTMLButtonElement>(".clipboard-modal-cancel")!
    .addEventListener("click", close);
}

// =============================================================================
// Clip list
// =============================================================================

export function handleClipboardReceived(msg: WsMessage): void {
  const content = msg.content ?? "";
  console.log(`[Clipboard] Received ${content.length} chars`);
  addClipboardReceivedNotification(content);
}

export function addClipboardSentNotification(content: string, persist = true): void {
  const item = buildClipItem("clipboard sent", "just now", content, 100);
  item.classList.add("sent");
  elements.clipboardList.prepend(item);
  trimClipboardList();
  if (persist) recordClip(true, content);
}

export function addClipboardReceivedNotification(content: string, persist = true): void {
  const item = buildClipItem("clipboard received", "just now", content, 200);
  elements.clipboardList.prepend(item);
  trimClipboardList();
  if (persist) recordClip(false, content);
}

export function clearClipboardList(): void {
  elements.clipboardList.replaceChildren();
}

function buildClipItem(
  label: string,
  right: string,
  content: string,
  maxLen: number,
): HTMLElement {
  const item = document.createElement("div");
  item.className = "clip-item";

  const labelRow = document.createElement("div");
  labelRow.className = "clip-label";
  const left = document.createElement("span");
  left.textContent = label;
  const rightEl = document.createElement("span");
  rightEl.textContent = right;
  labelRow.append(left, rightEl);

  const text = document.createElement("div");
  text.className = "clip-text";
  text.textContent = truncateText(content, maxLen);

  const copyBtn = document.createElement("button");
  copyBtn.className = "clip-copy";
  copyBtn.type = "button";
  copyBtn.textContent = "Copy";
  copyBtn.onclick = () => copyClipContent(copyBtn, content);

  item.append(labelRow, text, copyBtn);
  return item;
}

// Each pill's Copy button resets independently — a shared timer would leave an
// earlier button stuck on "Copied" when a second is clicked within the window.
const copyResetTimers = new WeakMap<HTMLButtonElement, number>();

async function copyClipContent(
  btn: HTMLButtonElement,
  content: string,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(content);
  } catch {
    showCopyFallback(content);
    return;
  }
  btn.textContent = "Copied";
  btn.classList.add("copied");
  const existing = copyResetTimers.get(btn);
  if (existing !== undefined) clearTimeout(existing);
  copyResetTimers.set(
    btn,
    window.setTimeout(() => {
      btn.textContent = "Copy";
      btn.classList.remove("copied");
      copyResetTimers.delete(btn);
    }, COPY_FEEDBACK_MS),
  );
}

// =============================================================================
// Clipboard Paste (Images)
// =============================================================================

export function handlePasteEvent(e: ClipboardEvent): void {
  if (state.view !== "connected" || !isConnected()) return;
  if (isInputFocused()) return;

  const items = e.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (!item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (!file) continue;

    queueFiles([file]);
    break; // Only send the first image — items may include duplicate formats
  }
}
