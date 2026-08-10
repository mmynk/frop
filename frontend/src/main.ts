import { handlePasteEvent, sendClipboard } from "./clipboard";
import { elements, isInputFocused } from "./dom";
import { flushPendingHistory } from "./history";
import {
  backToLanding,
  cancelRoom,
  createRoom,
  joinRoom,
} from "./room";
import { state } from "./state";
import { initTheme, cycleTheme } from "./theme";
import { processDroppedItems, queueFiles } from "./transfer";
import { saveAll } from "./ui";
import { showView } from "./views";
import { reconnectNow } from "./ws";

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

  // Connected view - batch save
  elements.saveAllBtn.addEventListener("click", saveAll);

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
    if (document.visibilityState === "visible") {
      reconnectNow();
    } else {
      // Going away: persist anything still sitting in the coalescing window.
      flushPendingHistory();
    }
  });
  window.addEventListener("online", reconnectNow);
  window.addEventListener("pagehide", flushPendingHistory);

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
    reconnectNow();
  } else {
    // Normal flow: show landing page
    showView("landing");
    elements.codeInput.focus();
  }

  console.log("[Frop] Ready!");
}

init();
