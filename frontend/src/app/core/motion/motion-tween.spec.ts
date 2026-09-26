import { MotionTween, Point, easeOut } from './motion-tween';
import { StepCadence } from './step-cadence';

describe('MotionTween', () => {
  const at = (x: number, y: number): Point => ({ x, y });
  const glide = { durationMs: 100, snap: false, maxGlide: 50 };

  it('starts a new train at its position, without gliding in', () => {
    const tween = new MotionTween();
    tween.update(new Map([[1, at(10, 0)]]), 0, glide);
    expect(tween.at(1, 0)).toEqual(at(10, 0));
    expect(tween.moving(0)).toBeFalse();
  });

  it('glides to the next position and rests there, never beyond it', () => {
    const tween = new MotionTween();
    tween.update(new Map([[1, at(0, 0)]]), 0, glide);
    tween.update(new Map([[1, at(20, 0)]]), 1000, glide);
    const mid = tween.at(1, 1050)!;
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(20);
    expect(tween.moving(1050)).toBeTrue();
    expect(tween.at(1, 1100)).toEqual(at(20, 0));
    expect(tween.at(1, 5000)).toEqual(at(20, 0));
    expect(tween.moving(1100)).toBeFalse();
  });

  it('snaps to the exact state on request (paused, reset)', () => {
    const tween = new MotionTween();
    tween.update(new Map([[1, at(0, 0)]]), 0, glide);
    tween.update(new Map([[1, at(20, 0)]]), 1000, glide);
    tween.update(new Map([[1, at(20, 0)]]), 1010, { ...glide, snap: true });
    expect(tween.at(1, 1010)).toEqual(at(20, 0));
  });

  it('snaps a jump longer than a step instead of sliding across the map', () => {
    const tween = new MotionTween();
    tween.update(new Map([[1, at(0, 0)]]), 0, glide);
    tween.update(new Map([[1, at(500, 0)]]), 1000, glide);
    expect(tween.at(1, 1001)).toEqual(at(500, 0));
  });

  it('continues from where it is drawn when a new step arrives mid-glide', () => {
    const tween = new MotionTween();
    tween.update(new Map([[1, at(0, 0)]]), 0, glide);
    tween.update(new Map([[1, at(20, 0)]]), 1000, glide);
    const drawn = tween.at(1, 1050)!;
    tween.update(new Map([[1, at(40, 0)]]), 1050, glide);
    expect(tween.at(1, 1050)).toEqual(drawn);
  });

  it('forgets trains that left the map', () => {
    const tween = new MotionTween();
    tween.update(new Map([[1, at(0, 0)]]), 0, glide);
    tween.update(new Map(), 10, glide);
    expect(tween.at(1, 10)).toBeNull();
  });

  it('takes the track shape from outside — the hook for graph-based networks', () => {
    const viaCorner = (f: Point, t: Point, s: number): Point =>
      s < 0.5 ? { x: f.x + (t.x - f.x) * s * 2, y: f.y } : { x: t.x, y: f.y + (t.y - f.y) * (s - 0.5) * 2 };
    const tween = new MotionTween(viaCorner);
    tween.update(new Map([[1, at(0, 0)]]), 0, glide);
    tween.update(new Map([[1, at(10, 10)]]), 0, glide);
    const p = tween.at(1, 30)!;
    expect(p.y === 0 || p.x === 10).toBeTrue();
  });
});

describe('MotionTween — continuous run', () => {
  const at = (x: number, y: number): Point => ({ x, y });
  const glide = { durationMs: 100, snap: false, maxGlide: 15 };

  it('moves at a constant speed by default, so consecutive steps chain without braking', () => {
    const tween = new MotionTween();
    tween.update(new Map([[1, at(0, 0)]]), 0, glide);
    tween.update(new Map([[1, at(10, 0)]]), 0, glide);
    expect(tween.at(1, 50)!.x).toBeCloseTo(5);
  });

  it('does not treat a one-cell step as a jump while the previous glide is still under way', () => {
    const tween = new MotionTween();
    tween.update(new Map([[1, at(0, 0)]]), 0, glide);
    tween.update(new Map([[1, at(10, 0)]]), 0, glide);
    // The next step arrives early: drawn at x=2, new target 18 away from it but one cell from the last target.
    tween.update(new Map([[1, at(20, 0)]]), 20, glide);
    expect(tween.at(1, 20)!.x).toBeCloseTo(2);
    expect(tween.moving(21)).toBeTrue();
  });

  it('can still brake into each cell with an ease-out', () => {
    const tween = new MotionTween();
    tween.update(new Map([[1, at(0, 0)]]), 0, glide);
    tween.update(new Map([[1, at(10, 0)]]), 0, { ...glide, easing: easeOut });
    expect(tween.at(1, 50)!.x).toBeGreaterThan(5);
  });
});

describe('StepCadence', () => {
  it('uses the tempo setting until steps have been measured', () => {
    const c = new StepCadence();
    c.observe(1, 0, true, 333);
    expect(c.intervalMs()).toBe(333);
  });

  it('follows the measured gap between steps, within bounds', () => {
    const c = new StepCadence();
    c.observe(1, 0, true, 300);
    c.observe(2, 400, true, 300);
    expect(c.intervalMs()).toBe(400);
    c.observe(3, 2400, true, 300);
    expect(c.intervalMs()).toBe(450);
  });

  it('starts over after a pause or a jump', () => {
    const c = new StepCadence();
    c.observe(1, 0, true, 300);
    c.observe(2, 400, true, 300);
    c.observe(2, 500, false, 300);
    c.observe(3, 5000, true, 300);
    expect(c.intervalMs()).toBe(300);
  });
});
