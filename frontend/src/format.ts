// =============================================================================
// Formatting helpers
// =============================================================================

import { MAX_CLIPBOARD_SIZE } from "./constants";

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
}

export function clipboardTooBigMessage(size: number): string {
  return `Clipboard is too big (${formatSize(size)}). ${formatSize(MAX_CLIPBOARD_SIZE)} max.`;
}
