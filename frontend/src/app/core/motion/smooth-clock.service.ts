import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { SessionStore } from '../session.store';
import { SmoothMotionService } from './smooth-motion.service';
import { StepCadence } from './step-cadence';
import { StepClock } from './step-clock';

/**
 * The simulation step as a continuous number for displays that draw time
 * (the Zug-Weg-Diagramm's now-line). Same rules as the gliding trains: it
 * follows the measured step cadence while the run plays and shows the exact
 * step when paused. Text labels keep whole steps.
 */
@Injectable({ providedIn: 'root' })
export class SmoothClockService {
  private readonly store = inject(SessionStore);
  private readonly smoothMotion = inject(SmoothMotionService);
  private readonly clock = new StepClock();
  private readonly cadence = new StepCadence();
  private readonly frameNow = signal(0);
  private frame: number | null = null;

  constructor() {
    effect(() => {
      const step = this.store.elapsedSteps();
      const playing = this.store.playing();
      const speed = this.store.playSpeed();
      const smooth = this.smoothMotion.enabled();
      untracked(() => this.onStep(step, playing, speed, smooth));
    });
  }

  /** The step to draw now; fractional while the run plays. */
  displayStep(): number {
    return this.clock.at(this.frameNow());
  }

  private onStep(step: number, playing: boolean, stepsPerSecond: number, smooth: boolean): void {
    const now = performance.now();
    this.cadence.observe(step, now, playing, 1000 / Math.max(0.1, stepsPerSecond));
    const hidden = typeof document !== 'undefined' && document.hidden;
    this.clock.update(step, now, Math.max(80, this.cadence.intervalMs()), !smooth || !playing || hidden);
    this.frameNow.set(now);
    if (this.frame !== null) return;
    const tick = () => {
      const t = performance.now();
      this.frameNow.set(t);
      this.frame = this.clock.moving(t) ? requestAnimationFrame(tick) : null;
    };
    this.frame = requestAnimationFrame(tick);
  }
}
