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
  "room not found": "No room with that code.",
  "room full": "That room already has two people.",
  "session expired": "Session ended. Start a new room.",
  "invalid request": "Something went sideways. Try again.",
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

interface ClipRecord {
  sent: boolean;
  content: string;
}

interface FileRecord {
  name: string;
  size: number;
  status: "done" | "cancelled";
  direction: "send" | "receive";
}

interface HistoryRecord {
  clips: ClipRecord[];
  files: FileRecord[];
}

const HISTORY_KEY_PREFIX = "frop_history_";
const MAX_HISTORY = 10; // matches the live DOM trim
let historyHydrated = false;

function historyKey(): string | null {
  return state.sessionToken ? HISTORY_KEY_PREFIX + state.sessionToken : null;
}

function loadHistory(): HistoryRecord {
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

function clearStoredHistory(token: string | null): void {
  if (!token) return;
  try {
    sessionStorage.removeItem(HISTORY_KEY_PREFIX + token);
  } catch {
    // ignore
  }
}

function recordClip(sent: boolean, content: string): void {
  const h = loadHistory();
  h.clips.push({ sent, content });
  if (h.clips.length > MAX_HISTORY) h.clips = h.clips.slice(-MAX_HISTORY);
  saveHistory(h);
}

function recordFile(rec: FileRecord): void {
  const h = loadHistory();
  h.files.push(rec);
  if (h.files.length > MAX_HISTORY) h.files = h.files.slice(-MAX_HISTORY);
  saveHistory(h);
}

// Rehydrate the lists from storage exactly once per page load. `connected`
// can arrive more than once (a peer reconnecting re-notifies both sides); the
// guard keeps those later notifications from duplicating the live DOM.
function hydrateHistory(): void {
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
  codeHint: document.getElementById("codeHint")!,
  cancelRoomBtn: document.getElementById("cancelRoom")!,

  // Connected
  statusDot: document.getElementById("statusDot")!,
  statusText: document.getElementById("statusText")!,
  dropzone: document.getElementById("dropzone")!,
  disconnectedBanner: document.getElementById("disconnectedBanner")!,
  startOverFromConnectedBtn: document.getElementById("startOverFromConnected")!,
  fileInput: document.getElementById("fileInput") as HTMLInputElement,
  folderInput: document.getElementById("folderInput") as HTMLInputElement,
  selectFilesBtn: document.getElementById("selectFiles")!,
  selectFolderBtn: document.getElementById("selectFolder")!,
  sendClipboardBtn: document.getElementById("sendClipboard")!,
  transferList: document.getElementById("transferList")!,
  clipboardList: document.getElementById("clipboardList")!,
  statusRight: document.getElementById("statusRight")!,

  // Disconnected
  backToLandingBtn: document.getElementById("backToLanding")!,

  // Header
  themeToggle: document.getElementById("themeToggle")!,
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

  if (view === "connected") {
    startUptime();
  } else {
    stopUptime();
  }

  state.view = view;
  console.log(`[View] Switched to: ${view}`);
}

function setPeerConnected(connected: boolean): void {
  elements.statusDot.classList.toggle("disconnected", !connected);
  elements.statusDot.classList.remove("reconnecting");
  elements.statusText.textContent = connected ? "Connected." : "Disconnected.";
  elements.dropzone.hidden = !connected;
  elements.disconnectedBanner.hidden = connected;
  // Freeze the uptime when the peer is gone. showView("connected") restarts
  // it on the next pairing.
  if (!connected) {
    stopUptime();
  }
}

// Our own socket dropped but the session may still be alive: show a transient
// "Reconnecting" state instead of the terminal disconnected banner. The
// dropzone stays hidden (can't send while offline) but no "Start over" prompt.
function setReconnecting(): void {
  elements.statusDot.classList.remove("disconnected");
  elements.statusDot.classList.add("reconnecting");
  elements.statusText.textContent = "Reconnecting…";
  elements.dropzone.hidden = true;
  elements.disconnectedBanner.hidden = true;
  stopUptime();
}

// After pairing, preserve history by marking the connected view disconnected
// in place. Before pairing, there's nothing to preserve — use the dedicated view.
function handleDisconnect(): void {
  if (state.view === "connected") {
    setPeerConnected(false);
  } else if (state.view === "waiting") {
    showView("disconnected");
  }
}

function setSessionTokenInUrl(token: string | null): void {
  const url = new URL(window.location.href);
  if (token) {
    url.searchParams.set("s", token);
  } else {
    url.searchParams.delete("s");
  }
  window.history.replaceState({}, "", url.toString());
}

// =============================================================================
// Connected — uptime timer
// =============================================================================

let connectedAt: number | null = null;
let uptimeInterval: number | null = null;

function updateUptime(): void {
  if (connectedAt === null) return;
  const secs = Math.floor((Date.now() - connectedAt) / 1000);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  const code = state.roomCode ?? "------";
  elements.statusRight.textContent = `${code} · ${mm}:${ss}`;
}

function startUptime(): void {
  connectedAt = Date.now();
  updateUptime();
  if (uptimeInterval !== null) {
    clearInterval(uptimeInterval);
  }
  uptimeInterval = window.setInterval(updateUptime, 1000);
}

function stopUptime(): void {
  if (uptimeInterval !== null) {
    clearInterval(uptimeInterval);
    uptimeInterval = null;
  }
  connectedAt = null;
  elements.statusRight.textContent = "";
}

// =============================================================================
// Toast Notifications
// =============================================================================

function getErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? code ?? "Something went sideways.";
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
    // A live drop while paired (screen lock, backgrounded tab, network blip)
    // is recoverable: the session survives server-side for its lifespan, so
    // retry with the token instead of stranding the user on a dead view.
    if (state.sessionToken && state.view === "connected") {
      setReconnecting();
      scheduleReconnect();
    } else {
      handleDisconnect();
    }
  };

  state.ws = ws;
  return ws;
}

// =============================================================================
// Reconnection
//
// When our own socket drops mid-session we reconnect by session token rather
// than making the user re-pair. Backoff covers transient foreground blips;
// mobile browsers freeze timers while backgrounded, so the practical trigger
// for "came back to the app" is the visibilitychange/online listeners, which
// reset the backoff and retry at once.
// =============================================================================

const MAX_RECONNECT_ATTEMPTS = 6;
const MAX_RECONNECT_DELAY = 15000; // 15s ceiling on backoff
let reconnectAttempts = 0;
let reconnectTimer: number | null = null;

function scheduleReconnect(): void {
  if (!state.sessionToken || state.ws || reconnectTimer !== null) return;
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    // Give up the automatic loop and surface the banner so the user can act.
    // A later visibilitychange/online resets the counter and tries again.
    handleDisconnect();
    return;
  }
  const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY);
  reconnectAttempts++;
  console.log(`[WS] Reconnect attempt ${reconnectAttempts} in ${delay}ms`);
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    attemptReconnect();
  }, delay);
}

function attemptReconnect(): void {
  if (!state.sessionToken || state.ws) return;
  const ws = connectWebSocket();
  ws.onopen = () => {
    console.log("[WS] Reconnecting with session token...");
    sendMessage({ type: "reconnect", sessionToken: state.sessionToken! });
  };
}

// Fired when the tab regains focus or the network returns — skip the backoff
// wait and try immediately, since these are the moments a drop is recoverable.
function reconnectNow(): void {
  if (!state.sessionToken || state.ws) return;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  attemptReconnect();
}

function resetReconnect(): void {
  reconnectAttempts = 0;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
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
      resetReconnect();

      if (state.sessionToken) {
        setSessionTokenInUrl(state.sessionToken);
      }

      // Restore any history saved under this session before the refresh.
      hydrateHistory();

      setPeerConnected(true);
      showView("connected");
      break;

    case "failed":
      console.error("[WS] Operation failed:", msg.error);
      showError(getErrorMessage(msg.error ?? ""));

      state.sessionToken = null;
      resetReconnect();
      setSessionTokenInUrl(null);

      showView("landing");
      break;

    case "peer_disconnected":
      console.log("[WS] Peer disconnected");
      handleDisconnect();
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

let copyHintResetTimer: number | null = null;

function renderRoomCode(code: string): void {
  const el = elements.roomCodeDisplay;
  el.replaceChildren(
    ...code.split("").map((ch) => {
      const span = document.createElement("span");
      span.textContent = ch;
      return span;
    }),
  );
  el.onclick = () => copyRoomCode(code);
  el.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      copyRoomCode(code);
    }
  };
}

async function copyRoomCode(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    return; // user-select: all already lets the user Ctrl+C manually
  }
  const el = elements.roomCodeDisplay;
  el.classList.add("copied");
  elements.codeHint.textContent = "Copied.";
  if (copyHintResetTimer !== null) clearTimeout(copyHintResetTimer);
  copyHintResetTimer = window.setTimeout(() => {
    el.classList.remove("copied");
    elements.codeHint.textContent = "Click to copy.";
  }, 1200);
}

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

    renderRoomCode(data.code);
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
    showError("Codes are six characters.");
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
  clearStoredHistory(state.sessionToken);
  resetReconnect();
  state.roomCode = null;
  state.sessionToken = null;
  if (state.ws) {
    state.ws.close();
  }
  // Drop in-flight transfer state so a late file_end can't trigger a phantom
  // download or write into a list we just cleared.
  incomingTransfer = null;
  sendQueue = [];
  revokeDownloadUrls(elements.transferList);
  elements.transferList.innerHTML = "";
  elements.clipboardList.innerHTML = "";
  setPeerConnected(true);
  setSessionTokenInUrl(null);
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

function queueFiles(files: FileList | File[]): void {
  sendQueue.push(...Array.from(files));
  if (!isSending) {
    drainSendQueue();
  }
}

// =============================================================================
// Drag-and-Drop Folder Support
// =============================================================================

/**
 * Convert a FileSystemFileEntry to a File object with a custom relative path.
 * The webkitRelativePath property is read-only, so we create a new File with
 * the path stored in the name for sendFile() to use.
 */
function getFileFromEntry(
  fileEntry: FileSystemFileEntry,
  relativePath: string
): Promise<File> {
  return new Promise((resolve, reject) => {
    fileEntry.file(
      (file) => {
        // Create a new File with webkitRelativePath-like behavior
        // We'll store the relative path and handle it in sendFile
        const fileWithPath = new File([file], file.name, { type: file.type });
        // Attach the relative path as a custom property
        (fileWithPath as any)._relativePath = relativePath;
        resolve(fileWithPath);
      },
      reject
    );
  });
}

/**
 * Recursively read all files from a directory entry.
 * The FileSystemDirectoryReader.readEntries() returns results in batches,
 * so we must call it repeatedly until it returns an empty array.
 */
async function readDirectoryEntries(
  dirEntry: FileSystemDirectoryEntry,
  basePath: string
): Promise<File[]> {
  const files: File[] = [];
  const reader = dirEntry.createReader();

  // readEntries returns batches - must call until empty
  const readBatch = (): Promise<FileSystemEntry[]> => {
    return new Promise((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
  };

  let batch: FileSystemEntry[];
  do {
    batch = await readBatch();
    for (const entry of batch) {
      const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;
      if (entry.isFile) {
        const file = await getFileFromEntry(entry as FileSystemFileEntry, entryPath);
        files.push(file);
      } else if (entry.isDirectory) {
        const subFiles = await readDirectoryEntries(
          entry as FileSystemDirectoryEntry,
          entryPath
        );
        files.push(...subFiles);
      }
    }
  } while (batch.length > 0);

  return files;
}

/**
 * Process dropped items, handling both files and folders.
 * Uses webkitGetAsEntry() to detect directories and traverse them.
 */
async function processDroppedItems(dataTransfer: DataTransfer): Promise<File[]> {
  const files: File[] = [];
  const items = dataTransfer.items;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== "file") continue;

    const entry = item.webkitGetAsEntry();
    if (!entry) {
      // Fallback: if webkitGetAsEntry not supported, use regular file
      const file = item.getAsFile();
      if (file) files.push(file);
      continue;
    }

    if (entry.isDirectory) {
      // Recursively traverse directory
      const dirFiles = await readDirectoryEntries(
        entry as FileSystemDirectoryEntry,
        entry.name
      );
      files.push(...dirFiles);
    } else if (entry.isFile) {
      // Single file - get it normally
      const file = await getFileFromEntry(entry as FileSystemFileEntry, entry.name);
      files.push(file);
    }
  }

  return files;
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
  // Use webkitRelativePath (from folder input), _relativePath (from drag-drop), or just name
  const name = file.webkitRelativePath || (file as any)._relativePath || file.name;
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
    recordFile({ name, size: file.size, status: "cancelled", direction: "send" });
  } else {
    sendMessage({ type: "file_end", name });
    markComplete(element, file.size);
    recordFile({ name, size: file.size, status: "done", direction: "send" });
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

  // If we were streaming to disk, the file is already written — the user
  // picked its location up front, so nothing more to offer.
  if (incomingTransfer.writable) {
    try {
      await incomingTransfer.writable.close();
      console.log(`[Transfer] Streaming download complete`);
    } catch (err) {
      console.error(`[Transfer] Failed to close writable stream:`, err);
    }
  } else {
    // Offer the file behind a tap rather than auto-downloading: iOS Safari
    // silently drops programmatic downloads that lack a user gesture (and
    // collapses rapid back-to-back ones), so a second file would never save.
    const blob = new Blob(incomingTransfer.chunks);
    addDownloadButton(incomingTransfer.element, blob, incomingTransfer.name);
  }

  markComplete(incomingTransfer.element, incomingTransfer.size);
  recordFile({
    name: incomingTransfer.name,
    size: incomingTransfer.size,
    status: "done",
    direction: "receive",
  });
  incomingTransfer = null;
}

// Attach a Save control to a completed incoming transfer. The download fires
// from the user's tap (the gesture mobile browsers require) rather than
// programmatically. The blob URL stays live for the item's lifetime so the
// user can save (and re-save) whenever they choose.
function addDownloadButton(
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
    recordFile({
      name: incomingTransfer.name,
      size: incomingTransfer.size,
      status: "cancelled",
      direction: "receive",
    });
    incomingTransfer = null;
  }
}

// =============================================================================
// Clipboard Paste (Images)
// =============================================================================

function handlePasteEvent(e: ClipboardEvent): void {
  if (state.view !== "connected" || !state.ws) return;
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
      showError(clipboardTooBigMessage(text.length));
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

function showClipboardFallback(): void {
  const overlay = document.createElement("div");
  overlay.className = "clipboard-modal-overlay";

  const modal = document.createElement("div");
  modal.className = "clipboard-modal";
  modal.innerHTML = `
    <p class="clipboard-modal-title">Paste it here.</p>
    <textarea class="clipboard-modal-textarea" placeholder="Ctrl+V or ⌘V" rows="4"></textarea>
    <p class="clipboard-modal-hint">Ctrl+Enter to send.</p>
    <div class="clipboard-modal-actions">
      <button class="btn clipboard-modal-cancel">Cancel</button>
      <button class="btn primary clipboard-modal-send">Send</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const textarea = modal.querySelector<HTMLTextAreaElement>(".clipboard-modal-textarea")!;
  const cancelBtn = modal.querySelector<HTMLButtonElement>(".clipboard-modal-cancel")!;
  const sendBtn = modal.querySelector<HTMLButtonElement>(".clipboard-modal-send")!;

  setTimeout(() => textarea.focus(), 50);

  function close(): void {
    overlay.remove();
  }

  function submit(): void {
    const text = textarea.value;
    if (!text) return;

    if (text.length > MAX_CLIPBOARD_SIZE) {
      showError(clipboardTooBigMessage(text.length));
      return;
    }

    sendMessage({ type: "clipboard", content: text });
    addClipboardSentNotification(text);
    close();
  }

  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  sendBtn.addEventListener("click", submit);
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
  });
}

function handleClipboardReceived(msg: WsMessage): void {
  const content = msg.content ?? "";
  console.log(`[Clipboard] Received ${content.length} chars`);
  addClipboardReceivedNotification(content);
}

function addClipboardSentNotification(content: string, persist = true): void {
  const item = buildClipItem("clipboard sent", "just now", content, 100);
  item.classList.add("sent");
  elements.clipboardList.prepend(item);
  trimList(elements.clipboardList, 10);
  if (persist) recordClip(true, content);
}

function addClipboardReceivedNotification(content: string, persist = true): void {
  const item = buildClipItem("clipboard received", "just now", content, 200);
  elements.clipboardList.prepend(item);
  trimList(elements.clipboardList, 10);
  if (persist) recordClip(false, content);
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
    }, 1200),
  );
}

function showCopyFallback(content: string): void {
  const overlay = document.createElement("div");
  overlay.className = "clipboard-modal-overlay";

  const modal = document.createElement("div");
  modal.className = "clipboard-modal";
  modal.innerHTML = `
    <p class="clipboard-modal-title">Copy it here.</p>
    <textarea class="clipboard-modal-textarea" readonly rows="4"></textarea>
    <p class="clipboard-modal-hint">Select all, then Ctrl+C or ⌘C.</p>
    <div class="clipboard-modal-actions">
      <button class="btn clipboard-modal-cancel">Close</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const textarea = modal.querySelector<HTMLTextAreaElement>(".clipboard-modal-textarea")!;
  const closeBtn = modal.querySelector<HTMLButtonElement>(".clipboard-modal-cancel")!;
  textarea.value = content;

  setTimeout(() => {
    textarea.focus();
    textarea.select();
  }, 50);

  function close(): void {
    overlay.remove();
  }

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
}

function trimList(list: HTMLElement, max: number): void {
  while (list.children.length > max) {
    const last = list.lastElementChild;
    if (last instanceof HTMLElement) revokeDownloadUrls(last);
    last?.remove();
  }
}

// Free any object URLs held by Save controls within a subtree before it leaves
// the DOM. Each pins its blob (up to LARGE_FILE_THRESHOLD) in memory until
// revoked, so dropping an item without this leaks that blob for the tab's life.
function revokeDownloadUrls(root: HTMLElement): void {
  for (const a of root.querySelectorAll<HTMLAnchorElement>(".transfer-download")) {
    URL.revokeObjectURL(a.href);
  }
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

function updateProgress(
  element: HTMLElement,
  received: number,
  total: number,
): void {
  const pct = total > 0 ? Math.min(100, (received / total) * 100) : 0;
  element.querySelector<HTMLElement>(".progress-fill")!.style.width = `${pct}%`;
  element.querySelector<HTMLElement>(".transfer-meta")!.textContent =
    `${formatSize(received)} / ${formatSize(total)}`;
}

function markComplete(element: HTMLElement, total: number): void {
  element.classList.add("done");
  element.querySelector<HTMLElement>(".progress-fill")!.style.width = "100%";
  element.querySelector<HTMLElement>(".transfer-meta")!.textContent =
    formatSize(total);
}

function markCancelled(element: HTMLElement): void {
  element.classList.add("cancelled");
  element.querySelector<HTMLElement>(".transfer-meta")!.textContent =
    "cancelled";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clipboardTooBigMessage(size: number): string {
  return `Clipboard is too big (${formatSize(size)}). ${formatSize(MAX_CLIPBOARD_SIZE)} max.`;
}

// =============================================================================
// Event Listeners
// =============================================================================

function setupEventListeners(): void {
  // Header
  elements.themeToggle.addEventListener("click", cycleTheme);

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
  elements.startOverFromConnectedBtn.addEventListener("click", backToLanding);

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

  // Paste event to send images from clipboard when connected
  document.addEventListener("paste", handlePasteEvent);

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

  // Reconnect eagerly when the app comes back to the foreground or the network
  // returns — mobile browsers freeze the backoff timer while backgrounded, so
  // these events are the real trigger for recovering a dropped session.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reconnectNow();
  });
  window.addEventListener("online", reconnectNow);

  // Drag and drop
  elements.dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    elements.dropzone.classList.add("dragover");
  });

  elements.dropzone.addEventListener("dragleave", () => {
    elements.dropzone.classList.remove("dragover");
  });

  elements.dropzone.addEventListener("drop", async (e) => {
    e.preventDefault();
    elements.dropzone.classList.remove("dragover");
    if (e.dataTransfer) {
      // Use webkitGetAsEntry API to handle folders properly
      const files = await processDroppedItems(e.dataTransfer);
      if (files.length > 0) {
        queueFiles(files);
      }
    }
  });
}

// =============================================================================
// Init
// =============================================================================

// =============================================================================
// Theme system
// =============================================================================

type ThemeMode = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "frop-theme";
const THEMES: { mode: ThemeMode; label: string }[] = [
  { mode: "system", label: "◐ SYS" },
  { mode: "light", label: "☀ LIGHT" },
  { mode: "dark", label: "☾ DARK" },
];

let currentTheme: ThemeMode = "system";

function readStoredTheme(): ThemeMode {
  const raw = localStorage.getItem(THEME_STORAGE_KEY);
  return THEMES.find((t) => t.mode === raw)?.mode ?? "system";
}

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(mode: ThemeMode): void {
  document.documentElement.setAttribute("data-theme", resolveTheme(mode));
  elements.themeToggle.textContent =
    THEMES.find((t) => t.mode === mode)!.label;
}

function cycleTheme(): void {
  const i = THEMES.findIndex((t) => t.mode === currentTheme);
  currentTheme = THEMES[(i + 1) % THEMES.length].mode;
  localStorage.setItem(THEME_STORAGE_KEY, currentTheme);
  applyTheme(currentTheme);
}

function initTheme(): void {
  currentTheme = readStoredTheme();
  applyTheme(currentTheme);
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (currentTheme === "system") applyTheme("system");
    });
}

function init(): void {
  console.log("[Frop] Initializing...");
  initTheme();
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
    elements.codeInput.focus();
  }

  console.log("[Frop] Ready!");
}

init();
