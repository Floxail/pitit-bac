// Light/dark theme handling.
//
// The theme is stored as a `data-theme` attribute on <html>, driving the
// CSS custom properties and dark overrides (see assets/theme-dark.sass).
// The user's explicit choice is persisted; otherwise we follow the system
// preference, live.

const STORAGE_KEY = "pb-theme";

export function stored_theme() {
  try {
    let theme = localStorage.getItem(STORAGE_KEY);
    return theme === "dark" || theme === "light" ? theme : null;
  } catch {
    return null;
  }
}

export function system_theme() {
  return window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function initial_theme() {
  return stored_theme() || system_theme();
}

export function apply_theme(theme) {
  document.documentElement.dataset.theme = theme;
}

export function persist_theme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {} // eslint-disable-line no-empty
}

/**
 * Follows the system preference as long as the user has not made an
 * explicit choice.
 */
export function watch_system_theme(callback) {
  if (!window.matchMedia) return;

  let query = window.matchMedia("(prefers-color-scheme: dark)");
  let listener = event => {
    if (!stored_theme()) callback(event.matches ? "dark" : "light");
  };

  if (query.addEventListener) query.addEventListener("change", listener);
  else if (query.addListener) query.addListener(listener);
}
