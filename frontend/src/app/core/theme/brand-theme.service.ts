import { Injectable, signal } from '@angular/core';

/**
 * The three Lyne themes. They differ only in the primary (accent) colour and,
 * for `safety`, the brand colour; styles.scss maps each onto those tokens.
 * docs/plans/colour-independence-plan.md, step 1.
 */
export type BrandTheme = 'off-brand' | 'standard' | 'safety';

export const BRAND_THEMES: readonly BrandTheme[] = ['off-brand', 'standard', 'safety'];

/** Neutral by default: the accent is royal blue and red keeps its meaning. */
export const DEFAULT_BRAND_THEME: BrandTheme = 'off-brand';

const STORAGE_KEY = 'flatland.brandTheme';

/** The theme a visitor chose last time, else the default. */
export function initialBrandTheme(): BrandTheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (BRAND_THEMES as readonly string[]).includes(stored)) return stored as BrandTheme;
  } catch {
    // localStorage may be unavailable (private mode, embedded preview).
  }
  return DEFAULT_BRAND_THEME;
}

/** Writes the theme onto <html>, where styles.scss reads it. */
export function applyBrandTheme(theme: BrandTheme): void {
  document.documentElement.dataset['brandTheme'] = theme;
}

/**
 * The app's Lyne theme, as a signal. A presentation preference per browser,
 * like the language — not part of the session or the interaction mode.
 */
@Injectable({ providedIn: 'root' })
export class BrandThemeService {
  readonly themes = BRAND_THEMES;

  readonly theme = signal<BrandTheme>(initialBrandTheme());

  setTheme(theme: BrandTheme): void {
    if (!BRAND_THEMES.includes(theme)) return;
    this.theme.set(theme);
    applyBrandTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Not persisting is acceptable; the choice still applies to this visit.
    }
  }
}
