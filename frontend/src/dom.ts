// =============================================================================
// DOM Elements
// =============================================================================

export const elements = {
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
  saveAllBtn: document.getElementById("saveAll")!,
  transferList: document.getElementById("transferList")!,
  clipboardList: document.getElementById("clipboardList")!,
  statusRight: document.getElementById("statusRight")!,

  // Disconnected
  backToLandingBtn: document.getElementById("backToLanding")!,

  // Header
  themeToggle: document.getElementById("themeToggle")!,
};

export function isInputFocused(): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLElement && active.isContentEditable)
  );
}
