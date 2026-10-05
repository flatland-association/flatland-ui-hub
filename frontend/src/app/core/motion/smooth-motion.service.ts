import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'flatland.smoothMotion';

/**
 * Whether trains glide between simulation steps (on by default) — a per-viewer
 * preference, remembered in this browser. Off draws them exactly as before:
 * at each step's cell. See core/motion/motion-tween.ts.
 */
@Injectable({ providedIn: 'root' })
export class SmoothMotionService {
  readonly enabled = signal<boolean>(SmoothMotionService.read());

  toggle(): void {
    this.set(!this.enabled());
  }

  set(on: boolean): void {
    this.enabled.set(on);
    try {
      localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    } catch {
      // Not persisting is fine; the choice holds for this visit.
    }
  }

  private static read(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) !== '0';
    } catch {
      return true;
    }
  }
}
