/**
 * A step counter that runs continuously between simulation steps
 * (docs/plans/smooth-playback.md, item 2). The simulation reports whole
 * minutes; this one glides from the previous step to the newest over the
 * measured step interval, at constant speed, so a "now" line reads as time
 * passing. Like the trains on the map it is never ahead of the simulation —
 * while running it is up to one step behind — and it snaps to the exact step
 * when paused, reset, after a jump of more than one step, and on its first observation.
 */
export class StepClock {
  private from = 0;
  private to = 0;
  private start = 0;
  private duration = 0;
  private seen: number | null = null;

  /** Record the newest step. `snap` shows it at once (paused, smooth motion off, hidden page). */
  update(step: number, now: number, durationMs: number, snap: boolean): void {
    // The first observation is a snap: a clock created mid-run must not sweep up from 0.
    const jumped = this.seen === null || Math.abs(step - this.seen) > 1;
    this.seen = step;
    if (snap || jumped || durationMs <= 0) {
      this.from = this.to = step;
      this.duration = 0;
      this.start = now;
      return;
    }
    if (step === this.to) return;
    this.from = this.at(now);
    this.to = step;
    this.start = now;
    this.duration = durationMs;
  }

  /** The step to draw at `now`, fractional while gliding. */
  at(now: number): number {
    if (this.duration <= 0) return this.to;
    const t = Math.min(1, Math.max(0, (now - this.start) / this.duration));
    return this.from + (this.to - this.from) * t;
  }

  moving(now: number): boolean {
    return this.duration > 0 && now - this.start < this.duration;
  }
}
