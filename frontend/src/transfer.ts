// =============================================================================
// File Transfer
//
// Owns the in-flight transfer state: the outgoing queue and the single active
// incoming transfer. Kept module-private so the only way to mutate it is
// through the functions here.
// =============================================================================

import {
  CHUNK_SIZE,
  LARGE_FILE_THRESHOLD,
  MAX_BUFFER_SIZE,
} from "./constants";
import { recordFile } from "./history";
import { sendMessage } from "./send";
import { state } from "./state";
import {
  addTransferItem,
  markCancelled,
  markComplete,
  updateProgress,
} from "./ui";
import type { IncomingTransfer, WsMessage } from "./types";

// Transfer state
let sendQueue: File[] = [];
let isSending = false;
let incomingTransfer: IncomingTransfer | null = null;

// Cancel state
const cancelledOutgoing = new Set<string>(); // Files cancelled by sender (us)
let currentOutgoingSend: { name: string; element: HTMLElement } | null = null;

// Drop in-flight transfer state so a late file_end can't trigger a phantom
// download or write into a list we just cleared.
export function resetTransferState(): void {
  incomingTransfer = null;
  sendQueue = [];
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

export function queueFiles(files: FileList | File[]): void {
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

export async function handleFileStart(msg: WsMessage): Promise<void> {
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

export async function handleBinaryChunk(data: ArrayBuffer): Promise<void> {
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

export async function handleFileEnd(): Promise<void> {
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

export async function handleFileCancel(msg: WsMessage): Promise<void> {
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
export async function processDroppedItems(dataTransfer: DataTransfer): Promise<File[]> {
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
