import { MotionTween, Point } from './motion-tween';

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
