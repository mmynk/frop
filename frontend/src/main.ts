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
    | "file_end";
  code?: string;
  sessionToken?: string;
  name?: string;
  size?: number;
}

interface IncomingTransfer {
  name: string;
  size: number;
  received: number;
  chunks: Uint8Array[];
  element: HTMLElement;
}

// =============================================================================
// Constants
// =============================================================================

const CHUNK_SIZE = 256 * 1024; // 256 KB

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

// =============================================================================
// DOM Elements
// =============================================================================

const elements = {
  // Views
  landing: document.getElementById("landing")!,
  waiting: document.getElementById("waiting")!,
  connected: document.getElementById("connected")!,
  disconnected: document.getElementById("disconnected")!,

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
  transferList: document.getElementById("transferList")!,

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

  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      handleBinaryChunk(event.data);
      return;
    }

    console.log("[WS] Message:", event.data);
    const msg: WsMessage = JSON.parse(event.data);
    handleWsMessage(msg);
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

function handleWsMessage(msg: WsMessage): void {
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
      console.error("[WS] Operation failed");

      // Clear session token from state and URL
      state.sessionToken = null;
      const urlWithoutToken = new URL(window.location.href);
      urlWithoutToken.searchParams.delete("s");
      window.history.replaceState({}, "", urlWithoutToken.toString());

      console.log("[Room] Session expired or invalid - returning to landing");
      showView("landing");
      break;

    case "peer_disconnected":
      console.log("[WS] Peer disconnected");
      showView("disconnected");
      break;

    case "file_start":
      handleFileStart(msg);
      break;

    case "file_end":
      handleFileEnd();
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

  let offset = 0;
  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const slice = file.slice(offset, end);
    const buffer = await slice.arrayBuffer();
    state.ws!.send(buffer);
    offset = end;
    updateProgress(element, offset, file.size);
  }

  sendMessage({ type: "file_end", name });
  markComplete(element);
  console.log(`[Transfer] Sent: ${name}`);
}

// =============================================================================
// File Transfer - Receiving
// =============================================================================

function handleFileStart(msg: WsMessage): void {
  console.log(`[Transfer] Receiving: ${msg.name} (${msg.size} bytes)`);
  const element = addTransferItem(msg.name!, msg.size!, "receive");
  incomingTransfer = {
    name: msg.name!,
    size: msg.size!,
    received: 0,
    chunks: [],
    element,
  };
}

function handleBinaryChunk(data: ArrayBuffer): void {
  if (!incomingTransfer) {
    console.warn("[Transfer] Received binary chunk with no active transfer");
    return;
  }

  incomingTransfer.chunks.push(new Uint8Array(data));
  incomingTransfer.received += data.byteLength;
  updateProgress(
    incomingTransfer.element,
    incomingTransfer.received,
    incomingTransfer.size,
  );
}

function handleFileEnd(): void {
  if (!incomingTransfer) {
    console.warn("[Transfer] Received file_end with no active transfer");
    return;
  }

  console.log(
    `[Transfer] Complete: ${incomingTransfer.name} (${incomingTransfer.received} bytes)`,
  );
  const blob = new Blob(incomingTransfer.chunks);
  downloadBlob(blob, incomingTransfer.name);
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
// Transfer UI
// =============================================================================

function addTransferItem(
  name: string,
  size: number,
  direction: "send" | "receive",
): HTMLElement {
  const item = document.createElement("div");
  item.className = "transfer-item";
  const arrow = direction === "send" ? "↑" : "↓";
  item.innerHTML = `
    <div class="name">${arrow} ${escapeHtml(name)}</div>
    <div class="meta">
      <span>${formatSize(size)}</span>
      <span class="percent">0%</span>
    </div>
    <div class="progress-bar"><div class="fill" style="width: 0%"></div></div>
  `;
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
