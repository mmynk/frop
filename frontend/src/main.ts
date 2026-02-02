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
  type: "join" | "reconnect" | "connected" | "failed" | "peer_disconnected";
  code?: string;
  sessionToken?: string;
}

// =============================================================================
// State
// =============================================================================

const state: AppState = {
  view: "landing",
  roomCode: null,
  sessionToken: null,
  ws: null,
};

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
  reconnectBtn: document.getElementById("reconnect")!,
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

  ws.onopen = () => {
    console.log("[WS] Connected");
  };

  ws.onmessage = (event) => {
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
      showView("connected");
      break;

    case "failed":
      console.error("[WS] Operation failed");
      // TODO: Show error to user
      if (state.view === "waiting") {
        showView("landing");
      }
      break;

    case "peer_disconnected":
      console.log("[WS] Peer disconnected");
      showView("disconnected");
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
    // TODO: Show error to user
  }
}

function joinRoom(code: string): void {
  if (!code || code.length !== 6) {
    console.error("[Room] Invalid code:", code);
    // TODO: Show validation error
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

function reconnect(): void {
  if (!state.sessionToken) {
    console.error("[Room] No session token for reconnect");
    showView("landing");
    return;
  }

  console.log("[Room] Reconnecting with token...");
  const ws = connectWebSocket();
  ws.onopen = () => {
    sendMessage({ type: "reconnect", sessionToken: state.sessionToken! });
  };
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
  elements.reconnectBtn.addEventListener("click", reconnect);
  elements.backToLandingBtn.addEventListener("click", backToLanding);

  // Connected view - file handling (placeholder for Milestone 2)
  elements.selectFilesBtn.addEventListener("click", () => {
    elements.fileInput.click();
  });

  elements.selectFolderBtn.addEventListener("click", () => {
    elements.folderInput.click();
  });
}

// =============================================================================
// Init
// =============================================================================

function init(): void {
  console.log("[Frop] Initializing...");
  setupEventListeners();
  showView("landing");
  console.log("[Frop] Ready!");
}

init();
