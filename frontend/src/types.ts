// =============================================================================
// Types shared across modules
// =============================================================================

export type View = "landing" | "waiting" | "connected" | "disconnected";

// WebSocket message types (matches backend models/ws.go)
export interface WsMessage {
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

export interface IncomingTransfer {
  name: string;
  size: number;
  received: number;
  chunks: Uint8Array[];
  element: HTMLElement;
  // For streaming large files
  writable?: FileSystemWritableFileStream;
}

export interface ClipRecord {
  sent: boolean;
  content: string;
}

export interface FileRecord {
  name: string;
  size: number;
  status: "done" | "cancelled";
  direction: "send" | "receive";
}

export interface HistoryRecord {
  clips: ClipRecord[];
  files: FileRecord[];
}
