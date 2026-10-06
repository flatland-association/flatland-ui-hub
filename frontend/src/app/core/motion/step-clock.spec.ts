import { StepClock } from './step-clock';

describe('StepClock', () => {
  it('glides linearly to the newest step and never passes it', () => {
    const c = new StepClock();
    c.update(0, 0, 0, true);
    c.update(1, 1000, 2000, false);
    expect(c.at(1000)).toBe(0);
    expect(c.at(2000)).toBeCloseTo(0.5);
    expect(c.at(3000)).toBe(1);
    expect(c.at(9000)).toBe(1);
    expect(c.moving(2000)).toBe(true);
    expect(c.moving(3000)).toBe(false);
  });

  it('chains glides from where it is drawn', () => {
    const c = new StepClock();
    c.update(0, 0, 0, true);
    c.update(1, 0, 1000, false);
    c.update(2, 500, 1000, false);
    expect(c.at(500)).toBeCloseTo(0.5);
    expect(c.at(1500)).toBe(2);
  });

  it('snaps when paused, and on a jump of more than one step', () => {
    const c = new StepClock();
    c.update(0, 0, 0, true);
    c.update(1, 0, 1000, false);
    c.update(1, 100, 1000, true);
    expect(c.at(100)).toBe(1);
    c.update(11, 200, 1000, false);
    expect(c.at(200)).toBe(11);
    expect(c.moving(200)).toBe(false);
  });

  it('shows the first observed step at once instead of gliding up from 0', () => {
    const c = new StepClock();
    c.update(100, 0, 1000, false);
    expect(c.at(0)).toBe(100);
    expect(c.moving(0)).toBe(false);
  });
});
