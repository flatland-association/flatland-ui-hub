import { atStation } from '../../core/timetable/station-cell';
import { hasClash, upcomingVisit } from './track-occupancy.component';

describe('track occupancy helpers', () => {
  it('counts the cell before a target as arriving at the station', () => {
    expect(atStation(2, 123, 2, 124)).toBeTrue();
    expect(atStation(2, 124, 2, 124)).toBeTrue();
    expect(atStation(0, 124, 2, 124)).toBeFalse();
    expect(atStation(2, 122, 2, 124)).toBeFalse();
  });

  it('finds the next arrival shifted by the delay, and only ahead of now', () => {
    const run = [
      { step: 10, row: 2, col: 122 },
      { step: 11, row: 2, col: 123 },
    ];
    expect(upcomingVisit(run, 2, 124, 5, 3, 7)).toEqual({ handle: 7, expected: 14, planned: 11 });
    expect(upcomingVisit(run, 2, 124, 20, 3, 7)).toBeNull();
  });

  it('marks two uses of one track within the window as a clash', () => {
    const v = (expected: number) => ({ handle: expected, expected, planned: expected });
    expect(hasClash([v(10), v(12)], false, 0)).toBeTrue();
    expect(hasClash([v(10), v(20)], false, 0)).toBeFalse();
    expect(hasClash([v(2)], true, 0)).toBeTrue();
  });
});
