/**
 * Smooth motion between simulation steps (docs/plans/smooth-playback.md).
 *
 * The simulation advances in one-minute steps; drawing a train only at each
 * step makes it jump, and slowing the run down makes the jumps longer. This
 * glides what is *drawn* from the previous position to the newest one — it
 * never draws a train ahead of the simulation (no look-ahead buffer), and a
 * snap puts everything at the exact current state at once.
 *
 * Framework-free and keyed by a train id, on screen coordinates: it does not
 * know about cells, Flatland versions or how a position is produced. The only
 * coupling to the network model is `interpolate` — a straight line by default,
 * which is exact between neighbouring grid cells; a representation with
 * positions along graph edges can pass a function that follows the track.
 */
export interface Point {
  x: number;
  y: number;
}

/** Position between `from` (t = 0) and `to` (t = 1). */
export type Interpolate = (from: Point, to: Point, t: number) => Point;

export const straightLine: Interpolate = (from, to, t) => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
});

export interface TweenUpdate {
  /** How long the glide to the new position takes. */
  durationMs: number;
  /** Put everything at the new position at once (paused, reset, a jump of several steps). */
  snap: boolean;
  /** A move longer than this is not a step along the track but a jump — snap it. */
  maxGlide: number;
}

interface Entry {
  from: Point;
  to: Point;
  start: number;
  duration: number;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

export class MotionTween<K = number> {
  private readonly entries = new Map<K, Entry>();

  constructor(private readonly interpolate: Interpolate = straightLine) {}

  /** Record the newest positions; trains no longer present are forgotten. */
  update(targets: ReadonlyMap<K, Point>, now: number, opt: TweenUpdate): void {
    for (const key of [...this.entries.keys()]) {
      if (!targets.has(key)) this.entries.delete(key);
    }
    for (const [key, to] of targets) {
      const entry = this.entries.get(key);
      if (!entry || opt.snap || opt.durationMs <= 0) {
        this.entries.set(key, { from: to, to, start: now, duration: 0 });
        continue;
      }
      if (entry.to.x === to.x && entry.to.y === to.y) continue;
      const from = this.at(key, now) ?? to;
      if (Math.hypot(to.x - from.x, to.y - from.y) > opt.maxGlide) {
        this.entries.set(key, { from: to, to, start: now, duration: 0 });
        continue;
      }
      this.entries.set(key, { from, to, start: now, duration: opt.durationMs });
    }
  }

  /** Where to draw `key` at `now`; null for an unknown key. */
  at(key: K, now: number): Point | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.duration <= 0) return entry.to;
    const t = Math.min(1, Math.max(0, (now - entry.start) / entry.duration));
    return t >= 1 ? entry.to : this.interpolate(entry.from, entry.to, easeOut(t));
  }

  /** Whether any train is still gliding at `now` — the animation loop's stop condition. */
  moving(now: number): boolean {
    for (const entry of this.entries.values()) {
      if (entry.duration > 0 && now - entry.start < entry.duration) return true;
    }
    return false;
  }
}
