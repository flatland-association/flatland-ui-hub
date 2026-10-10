// The assertions every setup test makes once its session exists.
import { expect } from '@playwright/test';

import type { InteractionMode, Tour } from './app-data';
import type { Guard } from './fixtures';
import type { TourIntro, WorkingScreen } from './pages';
import type { LayoutRef } from './panel-expectations';

export interface RunningSetup {
  /** Names the setup in every failure message, e.g. `build · director · olten`. */
  name: string;
  layout: LayoutRef;
  mode: InteractionMode;
}

/** Started → right mode → runs → clean. */
export async function expectSetupRuns(work: WorkingScreen, guard: Guard, setup: RunningSetup): Promise<void> {
  await work.expectStarted(setup.name);
  await work.expectMode(setup.name, setup.mode);
  await work.expectPanels(setup.name, setup.layout, setup.mode);
  await work.playAndExpectSteps(setup.name, setup.mode);
  guard.expectClean(setup.name);
}

/**
 * From the moment `POST /session` answered: the first mode's intro, "Start
 * scenario" into the run, the run checks, and the survey when the tour has one.
 */
export async function walkTour(
  name: string,
  tour: Tour,
  pages: { intro: TourIntro; work: WorkingScreen; guard: Guard },
): Promise<void> {
  const { intro, work, guard } = pages;
  const firstMode = tour.modes[0];
  await intro.passOpening();
  await work.expectMode(name, firstMode);
  await intro.startScenario();
  await expectSetupRuns(work, guard, { name, layout: tour.layout, mode: firstMode });
  if (tour.surveyAfterEachMode) {
    await work.finishTourMode();
    await expect(work.survey(), `${name}: survey after the first mode`).toBeVisible();
  }
}

