/**
 * How long a simulation step actually takes to arrive while the run plays
 * (docs/plans/smooth-playback.md). The tempo setting says "3 steps per
 * second", but steps come over the WebSocket with some jitter and the backend
 * may be slower than asked. A glide that lasts exactly the measured gap ends
 * as the next step arrives, so the train runs through the cells without
 * stopping — and without being drawn ahead of the simulation.
 */
export class StepCadence {
  private lastAt: number | null = null;
  private lastStep: number | null = null;
  private nominalMs = 0;
  private measuredMs: number | null = null;

  /**
   * Record a step arriving at `now`. Only a single step forward during play
   * counts as a sample; anything else (pause, jump, reset, new tempo) starts
   * the measurement over.
   */
  observe(step: number, now: number, playing: boolean, nominalMs: number): void {
    if (nominalMs !== this.nominalMs) {
      this.nominalMs = nominalMs;
      this.measuredMs = null;
    }
    if (!playing) {
      this.lastAt = null;
      this.lastStep = null;
      return;
    }
    if (this.lastStep === step) return;
    if (this.lastAt !== null && this.lastStep !== null && step === this.lastStep + 1) {
      const gap = now - this.lastAt;
      // Smooth out jitter; one late step must not stretch every glide after it.
      this.measuredMs = this.measuredMs === null ? gap : this.measuredMs * 0.7 + gap * 0.3;
    } else {
      this.measuredMs = null;
    }
    this.lastAt = now;
    this.lastStep = step;
  }

  /** The glide duration for the next step: measured, kept near the tempo setting. */
  intervalMs(): number {
    const nominal = this.nominalMs;
    if (this.measuredMs === null) return nominal;
    return Math.min(nominal * 1.5, Math.max(nominal * 0.5, this.measuredMs));
  }
}
