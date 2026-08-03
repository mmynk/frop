// =============================================================================
// Theme system
// =============================================================================

import { elements } from "./dom";

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

export function cycleTheme(): void {
  const i = THEMES.findIndex((t) => t.mode === currentTheme);
  currentTheme = THEMES[(i + 1) % THEMES.length].mode;
  localStorage.setItem(THEME_STORAGE_KEY, currentTheme);
  applyTheme(currentTheme);
}

export function initTheme(): void {
  currentTheme = readStoredTheme();
  applyTheme(currentTheme);
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (currentTheme === "system") applyTheme("system");
    });
}
