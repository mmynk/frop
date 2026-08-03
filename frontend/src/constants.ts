// =============================================================================
// Constants
// =============================================================================

export const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB - efficient for all file sizes
export const MAX_BUFFER_SIZE = 8 * 1024 * 1024; // 8 MB - pause sending when buffer exceeds this (2x chunk size)
export const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024; // 100 MB - use streaming for files larger than this
export const MAX_CLIPBOARD_SIZE = 1024 * 1024; // 1 MB - max clipboard text size

// Error code to user-friendly message mapping
export const ERROR_MESSAGES: Record<string, string> = {
  "room not found": "No room with that code.",
  "room full": "That room already has two people.",
  "session expired": "Session ended. Start a new room.",
  "invalid request": "Something went sideways. Try again.",
};
