import { Injectable, signal } from '@angular/core';

/**
 * Light or dark rendering. `auto` follows the operating system.
 * docs/plans/colour-independence-plan.md, step 5.
 */
export type ColorScheme = 'light' | 'dark' | 'auto';

export const COLOR_SCHEMES: readonly ColorScheme[] = ['light', 'dark', 'auto'];

/** Light stays the default: dark mode is opt-in until every view has been checked. */
export const DEFAULT_COLOR_SCHEME: ColorScheme = 'light';

const STORAGE_KEY = 'flatland.colorScheme';

/** Lyne's classes set `color-scheme`, which resolves every `light-dark()` pair. */
const LYNE_CLASS: Record<ColorScheme, string> = {
  light: 'sbb-light',
  dark: 'sbb-dark',
  auto: 'sbb-light-dark',
};

/** The scheme a visitor chose last time, else the default. */
export function initialColorScheme(): ColorScheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (COLOR_SCHEMES as readonly string[]).includes(stored)) return stored as ColorScheme;
  } catch {
    // localStorage may be unavailable (private mode, embedded preview).
  }
  return DEFAULT_COLOR_SCHEME;
}

/** Puts Lyne's scheme class on <html>, replacing any earlier one. */
export function applyColorScheme(scheme: ColorScheme): void {
  const root = document.documentElement;
  root.classList.remove(...Object.values(LYNE_CLASS));
  root.classList.add(LYNE_CLASS[scheme]);
}

/**
 * The app's light/dark preference, as a signal. A presentation preference per
 * browser, like the language and the brand theme — not part of the session.
 */
@Injectable({ providedIn: 'root' })
export class ColorSchemeService {
  readonly schemes = COLOR_SCHEMES;

  readonly scheme = signal<ColorScheme>(initialColorScheme());

  setScheme(scheme: ColorScheme): void {
    if (!COLOR_SCHEMES.includes(scheme)) return;
    this.scheme.set(scheme);
    applyColorScheme(scheme);
    try {
      localStorage.setItem(STORAGE_KEY, scheme);
    } catch {
      // Not persisting is acceptable; the choice still applies to this visit.
    }
  }
}
