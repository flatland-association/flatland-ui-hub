import { currentDelaySteps, PlannedCell, ExecutedCell } from './current-delay';

describe('currentDelaySteps', () => {
  // Planned: depart A (0,0) at 10, B (0,1) at 11, stop at C (0,2) from 12 to 15, D (0,3) at 16.
  const plan: PlannedCell[] = [
    { step: 10, row: 0, col: 0 },
    { step: 11, row: 0, col: 1 },
    { step: 12, row: 0, col: 2 },
    { step: 16, row: 0, col: 3 },
  ];
  const at = (step: number, col: number, endStep?: number): ExecutedCell => ({ step, endStep, position: [0, col] });

  it('is on time when the train runs as planned', () => {
    expect(currentDelaySteps(plan, [at(10, 0), at(11, 1)], [0, 1], 'MOVING', 11)).toBe(0);
  });

  it('counts a late departure before the train is on the map', () => {
    expect(currentDelaySteps(plan, [], null, 'READY_TO_DEPART', 14)).toBe(4);
    expect(currentDelaySteps(plan, [], null, 'WAITING', 8)).toBe(0);
  });

  it('keeps the arrival delay while the train dwells at its stop', () => {
    // Entered C at 17 instead of 12: +5, and still +5 two steps later.
    expect(currentDelaySteps(plan, [at(15, 0), at(16, 1), at(17, 2, 19)], [0, 2], 'MOVING', 19)).toBe(5);
  });

  it('grows while a train stands beyond its planned departure', () => {
    // On time into B at 11, planned to leave at 12, still there at 20: +8.
    expect(currentDelaySteps(plan, [at(10, 0), at(11, 1, 20)], [0, 1], 'STOPPED', 20)).toBe(8);
  });

  it('does not show early running', () => {
    expect(currentDelaySteps(plan, [at(8, 0), at(9, 1)], [0, 1], 'MOVING', 9)).toBe(0);
  });

  it('has nothing to say off the planned path, after arrival, or without a timetable', () => {
    expect(currentDelaySteps(plan, [at(12, 9)], [5, 9], 'MOVING', 12)).toBeNull();
    expect(currentDelaySteps(plan, [], null, 'DONE', 30)).toBeNull();
    expect(currentDelaySteps([], [], [0, 1], 'MOVING', 30)).toBeNull();
  });
});
