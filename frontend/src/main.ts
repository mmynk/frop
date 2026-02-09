// =============================================================================
// Types
// =============================================================================

type View = "landing" | "waiting" | "connected" | "disconnected";

interface AppState {
  view: View;
  roomCode: string | null;
  sessionToken: string | null;
  ws: WebSocket | null;
}

// WebSocket message types (matches backend models/ws.go)
interface WsMessage {
  type:
    | "join"
    | "reconnect"
    | "connected"
    | "failed"
    | "peer_disconnected"
    | "file_start"
    | "file_end"
    | "file_cancel"
    | "clipboard";
  code?: string;
  sessionToken?: string;
  name?: string;
  size?: number;
  reason?: string;
  content?: string; // for "clipboard"
  error?: string; // error code: "room full", "room not found", etc.
  message?: string; // human-readable message from server
}

interface IncomingTransfer {
  name: string;
  size: number;
  received: number;
  chunks: Uint8Array[];
  element: HTMLElement;
  // For streaming large files
  writable?: FileSystemWritableFileStream;
}

// =============================================================================
// Constants
// =============================================================================

const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB - efficient for all file sizes
const MAX_BUFFER_SIZE = 8 * 1024 * 1024; // 8 MB - pause sending when buffer exceeds this (2x chunk size)
const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024; // 100 MB - use streaming for files larger than this
const MAX_CLIPBOARD_SIZE = 1024 * 1024; // 1 MB - max clipboard text size

// Error code to user-friendly message mapping
const ERROR_MESSAGES: Record<string, string> = {
  "room not found": "Room not found. Check the code and try again.",
  "room full": "Room is full. Only 2 people can connect.",
  "session expired": "Session expired. Please start over.",
  "invalid request": "Something went wrong. Please try again.",
};

// =============================================================================
// State
// =============================================================================

const state: AppState = {
  view: "landing",
  roomCode: null,
  sessionToken: null,
  ws: null,
};

// Transfer state
let sendQueue: File[] = [];
let isSending = false;
let incomingTransfer: IncomingTransfer | null = null;

// Cancel state
const cancelledOutgoing = new Set<string>(); // Files cancelled by sender (us)
let currentOutgoingSend: { name: string; element: HTMLElement } | null = null;

// =============================================================================
// DOM Elements
// =============================================================================

const elements = {
  // Views
  landing: document.getElementById("landing")!,
  waiting: document.getElementById("waiting")!,
  connected: document.getElementById("connected")!,
  disconnected: document.getElementById("disconnected")!,

  // Toast
  toastContainer: document.getElementById("toastContainer")!,

  // Landing
  createRoomBtn: document.getElementById("createRoom")!,
  codeInput: document.getElementById("codeInput") as HTMLInputElement,
  joinRoomBtn: document.getElementById("joinRoom")!,

  // Waiting
  roomCodeDisplay: document.getElementById("roomCode")!,
  cancelRoomBtn: document.getElementById("cancelRoom")!,

  // Connected
  dropzone: document.getElementById("dropzone")!,
  fileInput: document.getElementById("fileInput") as HTMLInputElement,
  folderInput: document.getElementById("folderInput") as HTMLInputElement,
  selectFilesBtn: document.getElementById("selectFiles")!,
  selectFolderBtn: document.getElementById("selectFolder")!,
  sendClipboardBtn: document.getElementById("sendClipboard")!,
  transferList: document.getElementById("transferList")!,
  clipboardList: document.getElementById("clipboardList")!,

  // Disconnected
  backToLandingBtn: document.getElementById("backToLanding")!,
};

// =============================================================================
// View Management
// =============================================================================

function showView(view: View): void {
  // Hide all views
  elements.landing.classList.remove("active");
  elements.waiting.classList.remove("active");
  elements.connected.classList.remove("active");
  elements.disconnected.classList.remove("active");

  // Show requested view
  const viewElement = elements[view];
  viewElement.classList.add("active");

  state.view = view;
  console.log(`[View] Switched to: ${view}`);
}

// =============================================================================
// Toast Notifications
// =============================================================================

function getErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? code ?? "An error occurred.";
}

function showError(message: string): void {
  console.error(`[Toast] ${message}`);

  const toast = document.createElement("div");
  toast.className = "toast error";
  toast.textContent = message;

  elements.toastContainer.appendChild(toast);

  // Trigger reflow for animation
  toast.offsetHeight;
  toast.classList.add("visible");

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    toast.classList.remove("visible");
    toast.addEventListener("transitionend", () => toast.remove());
  }, 4000);
}

// =============================================================================
// WebSocket Client
// =============================================================================

function getWsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function connectWebSocket(): WebSocket {
  const ws = new WebSocket(getWsUrl());
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    console.log("[WS] Connected");
  };

  ws.onmessage = async (event) => {
    if (event.data instanceof ArrayBuffer) {
      await handleBinaryChunk(event.data);
      return;
    }

    console.log("[WS] Message:", event.data);
    const msg: WsMessage = JSON.parse(event.data);
    await handleWsMessage(msg);
  };

  ws.onerror = (error) => {
    console.error("[WS] Error:", error);
  };

  ws.onclose = () => {
    console.log("[WS] Disconnected");
    state.ws = null;

    // If we were connected, show disconnected view
    if (state.view === "connected" || state.view === "waiting") {
      showView("disconnected");
    }
  };

  state.ws = ws;
  return ws;
}

function sendMessage(msg: WsMessage): void {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    console.error("[WS] Cannot send - not connected");
    return;
  }
  console.log("[WS] Sending:", msg);
  state.ws.send(JSON.stringify(msg));
}

async function handleWsMessage(msg: WsMessage): Promise<void> {
  switch (msg.type) {
    case "connected":
      console.log("[WS] Paired with peer! Token:", msg.sessionToken);
      state.sessionToken = msg.sessionToken ?? null;

      // Update browser URL with session token for easy reconnection
      if (state.sessionToken) {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set("s", state.sessionToken);
        window.history.replaceState({}, "", newUrl.toString());
        console.log("[URL] Updated with session token");
      }

      showView("connected");
      break;

    case "failed":
      console.error("[WS] Operation failed:", msg.error);

      // Show user-friendly error message
      showError(getErrorMessage(msg.error ?? ""));

      // Clear session token from state and URL
      state.sessionToken = null;
      const urlWithoutToken = new URL(window.location.href);
      urlWithoutToken.searchParams.delete("s");
      window.history.replaceState({}, "", urlWithoutToken.toString());

      showView("landing");
      break;

    case "peer_disconnected":
      console.log("[WS] Peer disconnected");
      showView("disconnected");
      break;

    case "file_start":
      await handleFileStart(msg);
      break;

    case "file_end":
      await handleFileEnd();
      break;

    case "file_cancel":
      await handleFileCancel(msg);
      break;

    case "clipboard":
      handleClipboardReceived(msg);
      break;

    default:
      console.warn("[WS] Unknown message type:", msg.type);
  }
}

// =============================================================================
// Room Actions
// =============================================================================

async function createRoom(): Promise<void> {
  try {
    // Call REST API to create room
    const response = await fetch("/api/room", { method: "POST" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    state.roomCode = data.code;
    console.log("[Room] Created with code:", state.roomCode);

    // Display code and switch view
    elements.roomCodeDisplay.textContent = state.roomCode;
    showView("waiting");

    // Connect WebSocket and join room
    const ws = connectWebSocket();
    ws.onopen = () => {
      console.log("[WS] Connected, joining room...");
      sendMessage({ type: "join", code: state.roomCode! });
    };
  } catch (error) {
    console.error("[Room] Failed to create:", error);
  }
}

function joinRoom(code: string): void {
  if (!code || code.length !== 6) {
    console.error("[Room] Invalid code:", code);
    showError("Please enter a 6-character room code.");
    elements.codeInput.focus();
    return;
  }

  state.roomCode = code.toUpperCase();
  console.log("[Room] Joining:", state.roomCode);

  // Connect WebSocket and join
  const ws = connectWebSocket();
  ws.onopen = () => {
    console.log("[WS] Connected, joining room...");
    sendMessage({ type: "join", code: state.roomCode! });
  };
}

function cancelRoom(): void {
  console.log("[Room] Cancelling...");
  if (state.ws) {
    state.ws.close();
  }
  state.roomCode = null;
  showView("landing");
}

function backToLanding(): void {
  state.roomCode = null;
  state.sessionToken = null;
  if (state.ws) {
    state.ws.close();
  }
  showView("landing");
}

// =============================================================================
// File Transfer - Sending
// =============================================================================

/**
 * Wait for the WebSocket send buffer to drain below the threshold.
 * This implements backpressure to prevent memory bloat on large transfers.
 */
function waitForBuffer(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.bufferedAmount < MAX_BUFFER_SIZE) {
      resolve();
      return;
    }

    // Poll every 10ms until buffer drains
    const checkBuffer = () => {
      if (ws.bufferedAmount < MAX_BUFFER_SIZE) {
        resolve();
      } else {
        setTimeout(checkBuffer, 10);
      }
    };
    checkBuffer();
  });
}

function queueFiles(files: FileList): void {
  sendQueue.push(...Array.from(files));
  if (!isSending) {
    drainSendQueue();
  }
}

async function drainSendQueue(): Promise<void> {
  isSending = true;
  while (sendQueue.length > 0) {
    const file = sendQueue.shift()!;
    await sendFile(file);
  }
  isSending = false;
}

async function sendFile(file: File): Promise<void> {
  const name = file.webkitRelativePath || file.name;
  console.log(`[Transfer] Sending: ${name} (${file.size} bytes)`);

  sendMessage({ type: "file_start", name, size: file.size });
  const element = addTransferItem(name, file.size, "send");
  currentOutgoingSend = { name, element };

  let offset = 0;
  let cancelled = false;

  while (offset < file.size) {
    // Check if this transfer was cancelled
    if (cancelledOutgoing.has(name)) {
      console.log(`[Transfer] Cancelled by sender: ${name}`);
      cancelledOutgoing.delete(name);
      cancelled = true;
      break;
    }

    // Wait for buffer to drain before sending next chunk (backpressure)
    await waitForBuffer(state.ws!);

    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const slice = file.slice(offset, end);
    const buffer = await slice.arrayBuffer();
    state.ws!.send(buffer);
    offset = end;
    updateProgress(element, offset, file.size);
  }

  currentOutgoingSend = null;

  if (cancelled) {
    sendMessage({ type: "file_cancel", name, reason: "user_cancelled" });
    markCancelled(element);
  } else {
    sendMessage({ type: "file_end", name });
    markComplete(element);
    console.log(`[Transfer] Sent: ${name}`);
  }
}

// =============================================================================
// File Transfer - Receiving
// =============================================================================

async function handleFileStart(msg: WsMessage): Promise<void> {
  console.log(`[Transfer] Receiving: ${msg.name} (${msg.size} bytes)`);
  const element = addTransferItem(msg.name!, msg.size!, "receive");

  // For large files, try to use streaming with File System Access API
  let writable: FileSystemWritableFileStream | undefined;
  if (
    msg.size! > LARGE_FILE_THRESHOLD &&
    "showSaveFilePicker" in window
  ) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: msg.name,
      });
      writable = await handle.createWritable();
      console.log(`[Transfer] Using streaming download for large file`);
    } catch (err) {
      console.warn(`[Transfer] Could not use streaming download:`, err);
      // Fall back to memory accumulation
    }
  }

  incomingTransfer = {
    name: msg.name!,
    size: msg.size!,
    received: 0,
    chunks: writable ? [] : [], // Still need chunks array for non-streaming
    element,
    writable,
  };
}

async function handleBinaryChunk(data: ArrayBuffer): Promise<void> {
  if (!incomingTransfer) {
    console.warn("[Transfer] Received binary chunk with no active transfer");
    return;
  }

  // If we have a writable stream, write directly to disk
  if (incomingTransfer.writable) {
    try {
      await incomingTransfer.writable.write(data);
    } catch (err) {
      console.error(`[Transfer] Failed to write chunk to disk:`, err);
      // Fall back to memory accumulation
      incomingTransfer.chunks.push(new Uint8Array(data));
    }
  } else {
    // Accumulate in memory for smaller files or when streaming not available
    incomingTransfer.chunks.push(new Uint8Array(data));
  }

  incomingTransfer.received += data.byteLength;
  updateProgress(
    incomingTransfer.element,
    incomingTransfer.received,
    incomingTransfer.size,
  );
}

async function handleFileEnd(): Promise<void> {
  if (!incomingTransfer) {
    console.warn("[Transfer] Received file_end with no active transfer");
    return;
  }

  console.log(
    `[Transfer] Complete: ${incomingTransfer.name} (${incomingTransfer.received} bytes)`,
  );

  // If we were streaming to disk, close the stream
  if (incomingTransfer.writable) {
    try {
      await incomingTransfer.writable.close();
      console.log(`[Transfer] Streaming download complete`);
    } catch (err) {
      console.error(`[Transfer] Failed to close writable stream:`, err);
    }
  } else {
    // Traditional blob download for smaller files
    const blob = new Blob(incomingTransfer.chunks);
    downloadBlob(blob, incomingTransfer.name);
  }

  markComplete(incomingTransfer.element);
  incomingTransfer = null;
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// =============================================================================
// File Transfer - Cancel
// =============================================================================

async function handleFileCancel(msg: WsMessage): Promise<void> {
  console.log(`[Transfer] Peer cancelled: ${msg.name} (${msg.reason})`);

  // Check if this cancels our outgoing send (peer rejected it)
  if (currentOutgoingSend && currentOutgoingSend.name === msg.name) {
    cancelledOutgoing.add(msg.name!);
    return; // The send loop will handle cleanup
  }

  // Otherwise it cancels our incoming transfer (peer stopped sending)
  if (incomingTransfer && incomingTransfer.name === msg.name) {
    // Close writable stream if open
    if (incomingTransfer.writable) {
      try {
        await incomingTransfer.writable.abort();
      } catch (err) {
        console.warn(`[Transfer] Failed to abort writable stream:`, err);
      }
    }

    markCancelled(incomingTransfer.element);
    incomingTransfer = null;
  }
}

function cancelOutgoingTransfer(): void {
  if (!currentOutgoingSend) {
    console.warn("[Transfer] No outgoing transfer to cancel");
    return;
  }
  console.log(`[Transfer] Cancelling outgoing: ${currentOutgoingSend.name}`);
  cancelledOutgoing.add(currentOutgoingSend.name);
}

function cancelIncomingTransfer(): void {
  if (!incomingTransfer) {
    console.warn("[Transfer] No incoming transfer to cancel");
    return;
  }
  const name = incomingTransfer.name;
  console.log(`[Transfer] Rejecting incoming: ${name}`);

  // Send cancel to peer so they stop sending
  sendMessage({ type: "file_cancel", name, reason: "user_rejected" });

  // Close writable stream if open
  if (incomingTransfer.writable) {
    incomingTransfer.writable.abort().catch(() => {});
  }

  markCancelled(incomingTransfer.element);
  incomingTransfer = null;
}

// =============================================================================
// Clipboard Sharing
// =============================================================================

async function sendClipboard(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) {
      console.log("[Clipboard] Nothing to send (empty)");
      return;
    }

    if (text.length > MAX_CLIPBOARD_SIZE) {
      console.warn(`[Clipboard] Too large: ${text.length} bytes (max ${MAX_CLIPBOARD_SIZE})`);
      showError(`Clipboard too large (${formatSize(text.length)}). Max is 1 MB.`);
      return;
    }

    console.log(`[Clipboard] Sending ${text.length} chars`);
    sendMessage({ type: "clipboard", content: text });

    // Show confirmation in transfer list
    addClipboardSentNotification(text);
  } catch (err) {
    console.error("[Clipboard] Failed to read:", err);
    showError("Could not access clipboard. Please allow clipboard permissions.");
  }
}

function handleClipboardReceived(msg: WsMessage): void {
  const content = msg.content ?? "";
  console.log(`[Clipboard] Received ${content.length} chars`);
  addClipboardReceivedNotification(content);
}

function addClipboardSentNotification(content: string): void {
  const item = document.createElement("div");
  item.className = "clipboard-item sent";
  item.innerHTML = `
    <div class="clipboard-header">
      <span class="clipboard-label">↑ Clipboard sent</span>
    </div>
    <div class="clipboard-content">${escapeHtml(truncateText(content, 100))}</div>
  `;
  elements.clipboardList.prepend(item);

  // Auto-remove after 5 seconds
  setTimeout(() => item.remove(), 5000);
}

function addClipboardReceivedNotification(content: string): void {
  const item = document.createElement("div");
  item.className = "clipboard-item received";
  item.innerHTML = `
    <div class="clipboard-header">
      <span class="clipboard-label">↓ Clipboard received</span>
      <button class="copy-btn">Copy</button>
    </div>
    <div class="clipboard-content">${escapeHtml(truncateText(content, 200))}</div>
  `;

  const copyBtn = item.querySelector<HTMLButtonElement>(".copy-btn")!;
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(content);
      copyBtn.textContent = "Copied!";
      copyBtn.disabled = true;
      setTimeout(() => item.remove(), 1500);
    } catch (err) {
      console.error("[Clipboard] Failed to copy:", err);
      copyBtn.textContent = "Failed";
    }
  });

  elements.clipboardList.prepend(item);
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
}

function isInputFocused(): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLElement && active.isContentEditable)
  );
}

// =============================================================================
// Transfer UI
// =============================================================================

function addTransferItem(
  name: string,
  size: number,
  direction: "send" | "receive",
): HTMLElement {
  const item = document.createElement("div");
  item.className = "transfer-item";
  item.dataset.direction = direction;
  const arrow = direction === "send" ? "↑" : "↓";
  item.innerHTML = `
    <div class="transfer-header">
      <div class="name">${arrow} ${escapeHtml(name)}</div>
      <button class="cancel-btn" title="Cancel transfer">×</button>
    </div>
    <div class="meta">
      <span>${formatSize(size)}</span>
      <span class="percent">0%</span>
    </div>
    <div class="progress-bar"><div class="fill" style="width: 0%"></div></div>
  `;

  // Wire up cancel button
  const cancelBtn = item.querySelector<HTMLButtonElement>(".cancel-btn")!;
  cancelBtn.addEventListener("click", () => {
    if (direction === "send") {
      cancelOutgoingTransfer();
    } else {
      cancelIncomingTransfer();
    }
  });

  elements.transferList.appendChild(item);
  return item;
}

function updateProgress(
  element: HTMLElement,
  received: number,
  total: number,
): void {
  const pct = Math.min(100, Math.round((received / total) * 100));
  element.querySelector<HTMLElement>(".fill")!.style.width = `${pct}%`;
  element.querySelector(".percent")!.textContent = `${pct}%`;
}

function markComplete(element: HTMLElement): void {
  element.classList.add("complete");
  element.querySelector<HTMLElement>(".fill")!.style.width = "100%";
  element.querySelector(".percent")!.textContent = "Done";
  // Hide cancel button
  const cancelBtn = element.querySelector<HTMLElement>(".cancel-btn");
  if (cancelBtn) cancelBtn.style.display = "none";
}

function markCancelled(element: HTMLElement): void {
  element.classList.add("cancelled");
  element.querySelector(".percent")!.textContent = "Cancelled";
  // Hide cancel button
  const cancelBtn = element.querySelector<HTMLElement>(".cancel-btn");
  if (cancelBtn) cancelBtn.style.display = "none";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// =============================================================================
// Event Listeners
// =============================================================================

function setupEventListeners(): void {
  // Landing view
  elements.createRoomBtn.addEventListener("click", createRoom);

  elements.joinRoomBtn.addEventListener("click", () => {
    joinRoom(elements.codeInput.value);
  });

  elements.codeInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      joinRoom(elements.codeInput.value);
    }
  });

  // Auto-uppercase code input
  elements.codeInput.addEventListener("input", () => {
    elements.codeInput.value = elements.codeInput.value.toUpperCase();
  });

  // Waiting view
  elements.cancelRoomBtn.addEventListener("click", cancelRoom);

  // Disconnected view
  elements.backToLandingBtn.addEventListener("click", backToLanding);

  // Connected view - file inputs
  elements.selectFilesBtn.addEventListener("click", () => {
    elements.fileInput.click();
  });

  elements.selectFolderBtn.addEventListener("click", () => {
    elements.folderInput.click();
  });

  elements.fileInput.addEventListener("change", () => {
    if (elements.fileInput.files?.length) {
      queueFiles(elements.fileInput.files);
      elements.fileInput.value = "";
    }
  });

  elements.folderInput.addEventListener("change", () => {
    if (elements.folderInput.files?.length) {
      queueFiles(elements.folderInput.files);
      elements.folderInput.value = "";
    }
  });

  // Clipboard
  elements.sendClipboardBtn.addEventListener("click", sendClipboard);

  // Ctrl+V to send clipboard when connected
  document.addEventListener("keydown", (e) => {
    if (
      state.view === "connected" &&
      e.ctrlKey &&
      e.key === "v" &&
      !isInputFocused()
    ) {
      e.preventDefault();
      sendClipboard();
    }
  });

  // Drag and drop
  elements.dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    elements.dropzone.classList.add("dragover");
  });

  elements.dropzone.addEventListener("dragleave", () => {
    elements.dropzone.classList.remove("dragover");
  });

  elements.dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    elements.dropzone.classList.remove("dragover");
    if (e.dataTransfer?.files.length) {
      queueFiles(e.dataTransfer.files);
    }
  });
}

// =============================================================================
// Init
// =============================================================================

function init(): void {
  console.log("[Frop] Initializing...");
  setupEventListeners();

  // Check for session token in URL parameter
  const urlParams = new URLSearchParams(window.location.search);
  const sessionToken = urlParams.get("s");

  if (sessionToken && sessionToken.trim()) {
    // Auto-reconnect with session token from URL
    console.log("[Frop] Found session token in URL, auto-reconnecting...");
    state.sessionToken = sessionToken.trim();
    showView("waiting"); // Show waiting view as visual feedback

    const ws = connectWebSocket();
    ws.onopen = () => {
      console.log("[WS] Connected, sending reconnect message...");
      sendMessage({ type: "reconnect", sessionToken: state.sessionToken! });
    };
  } else {
    // Normal flow: show landing page
    showView("landing");
  }

  console.log("[Frop] Ready!");
}

init();
