// Page objects: one class per screen, wrapping its `data-testid` locators.
//
// Every locator is a test id. Visible labels change with the language, and
// `getByRole` does not see SBB Lyne buttons (Lyne sets the role through
// ElementInternals), so neither is used.
import { expect, type Locator, type Page, type Response } from '@playwright/test';

import type { InteractionMode } from './app-data';
import { expectedPanels, type LayoutRef } from './panel-expectations';

export type Door = 'introduction' | 'build' | 'experiments';

/** How long a step may take to show up after play. Director plans first (~1 min). */
export const STEP_TIMEOUT = { default: 30_000, director: 150_000 };
/** Session creation plus the auto-advance to the opening step. */
export const START_TIMEOUT = 90_000;
/** `POST /session` must answer within this. A cold corridor load measured ~30 s. */
export const CREATE_TIMEOUT = 60_000;

function isCreateSession(res: Response): boolean {
  return res.request().method() === 'POST' && new URL(res.url()).pathname === '/session';
}

/** Turns a bare waitForResponse timeout into a failure that names the setup. */
function sessionCreated(page: Page, setup: string): Promise<Response> {
  return page.waitForResponse(isCreateSession, { timeout: CREATE_TIMEOUT }).catch((err: Error) => {
    throw new Error(
      `${setup}: Start created no session — no POST /session within ${CREATE_TIMEOUT / 1000} s ` +
        `(${err.message.split('\n')[0]})`,
    );
  });
}

export class WelcomePage {
  readonly root: Locator;
  readonly start: Locator;

  constructor(private readonly page: Page) {
    this.root = page.getByTestId('welcome');
    this.start = page.getByTestId('welcome-start');
  }

  /**
   * Load the start screen, optionally on a deep link (`#/tour/…`, `#/experiment/…`),
   * and wait for the backend scenario presets. Start resolves a preset network
   * against that list; pressed before it arrives, a tour or experiment on a
   * preset does not start (see the Stage 2 report in the plan's Decisions log).
   */
  async goto(hash = ''): Promise<void> {
    const presets = this.page.waitForResponse(
      (res) => new URL(res.url()).pathname === '/session/scenario-presets' && res.ok(),
    );
    await this.page.goto(`/${hash}`);
    await presets;
  }

  async expectShown(): Promise<void> {
    await expect(this.root).toBeVisible();
    await expect(this.start).toBeVisible();
  }

  async openDoor(door: Door): Promise<void> {
    await this.page.getByTestId(`welcome-door-${door}`).click();
  }

  async selectTour(id: string): Promise<void> {
    await this.page.getByTestId('welcome-tour-select').selectOption(id);
  }

  async selectLiveVariant(seed: number): Promise<void> {
    await this.page.getByTestId('welcome-tour-variant').selectOption('live');
    await this.page.getByTestId('welcome-tour-seed').fill(String(seed));
  }

  async selectLayout(id: string): Promise<void> {
    await this.page.getByTestId('welcome-layout-select').selectOption(id);
  }

  async selectNetwork(id: string): Promise<void> {
    await this.page.getByTestId('welcome-network-select').selectOption(id);
  }

  async selectExperimentKind(kind: 'condition' | 'tour'): Promise<void> {
    await this.page.getByTestId(`welcome-experiment-kind-${kind}`).check();
  }

  async selectExperimentTour(id: string): Promise<void> {
    await this.page.getByTestId('welcome-experiment-tour-select').selectOption(id);
  }

  async selectCondition(layoutId: string): Promise<void> {
    await this.page.getByTestId('welcome-condition-select').selectOption(layoutId);
  }

  async selectExperimentScenario(id: string): Promise<void> {
    await this.page.getByTestId('welcome-experiment-scenario-select').selectOption(id);
  }

  async fillParticipant(id: string): Promise<void> {
    const field = this.page.getByTestId('welcome-participant');
    await field.fill(id);
    // The app stores the id on `change`, which fires on blur.
    await field.blur();
  }

  /**
   * The disturbance list is one template rendered in both the Build and the
   * Experiments door, so the checkbox is looked up inside the door's content.
   */
  async tickDisturbance(door: 'build' | 'experiments', id: string): Promise<void> {
    await this.page.getByTestId(`welcome-door-content-${door}`).getByTestId(`welcome-disturbance-${id}`).check();
  }

  /** Press Start and wait for `POST /session`; returns its response. */
  async pressStart(setup: string): Promise<Response> {
    const created = sessionCreated(this.page, setup);
    await this.start.click();
    return created;
  }

  /**
   * For `…/start` deep links, where the app presses Start itself once the
   * presets have loaded. Call before `goto`, await after it.
   */
  waitForAutoStart(setup: string): Promise<Response> {
    return sessionCreated(this.page, setup);
  }
}

/** The tour's opening briefing (when it has one) and the per-mode intro. */
export class TourIntro {
  readonly opening: Locator;
  readonly modeIntro: Locator;

  constructor(private readonly page: Page) {
    this.opening = page.getByTestId('tour-briefing-opening');
    this.modeIntro = page.getByTestId('mode-intro');
  }

  /** Pass the opening briefing if the tour has one; ends on the mode intro. */
  async passOpening(): Promise<void> {
    await expect(this.opening.or(this.modeIntro)).toBeVisible({ timeout: START_TIMEOUT });
    if (await this.opening.isVisible()) {
      await this.page.getByTestId('tour-briefing-proceed').click();
    }
    await expect(this.modeIntro).toBeVisible();
  }

  /** "Start scenario" on the mode intro: leads into the run. */
  async startScenario(): Promise<void> {
    await this.page.getByTestId('mode-intro-start').click();
    await expect(this.modeIntro).toHaveCount(0);
  }
}

/** The running session: mode tabs, panels, run controls and the status bar. */
export class WorkingScreen {
  readonly step: Locator;
  readonly ws: Locator;
  readonly loading: Locator;
  /** The experiment's "finish & questionnaire" in the status bar. */
  readonly finishExperiment: Locator;

  constructor(private readonly page: Page) {
    this.finishExperiment = page.getByTestId('run-finish-experiment');
    this.step = page.getByTestId('status-step');
    this.ws = page.getByTestId('status-ws');
    this.loading = page.getByTestId('status-loading');
  }

  panel(type: string): Locator {
    return this.page.getByTestId(`panel-${type}`);
  }

  /** The session exists and the WebSocket is connected. */
  async expectStarted(setup: string): Promise<void> {
    await expect(this.step, `${setup}: step counter in the status bar`).toBeVisible({ timeout: START_TIMEOUT });
    // The socket opens right after `POST /session`; seconds, not minutes.
    await expect(this.ws, `${setup}: WebSocket status`).toHaveClass(/\bconnected\b/, { timeout: 30_000 });
  }

  async switchMode(mode: InteractionMode): Promise<void> {
    await this.page.getByTestId(`mode-tab-${mode}`).click();
  }

  async expectMode(setup: string, mode: InteractionMode): Promise<void> {
    await expect(this.page.getByTestId(`mode-tab-${mode}`), `${setup}: active mode tab`).toHaveAttribute(
      'aria-selected',
      'true',
    );
  }

  /** The mode-restricted panels match `panel-mode-matrix.md` for this layout and mode. */
  async expectPanels(setup: string, layout: LayoutRef, mode: InteractionMode): Promise<void> {
    const { visible, absent } = expectedPanels(layout, mode);
    for (const type of visible) {
      await expect(this.panel(type).first(), `${setup}: panel "${type}" must show in ${mode}`).toBeVisible();
    }
    for (const type of absent) {
      await expect(this.panel(type), `${setup}: panel "${type}" must not exist in ${mode}`).toHaveCount(0);
    }
  }

  async currentStep(): Promise<number> {
    return Number(await this.step.textContent());
  }

  /**
   * Press play (the Director's own start button in Director) and wait until
   * the step counter moves past where it stood. Waits for the session's own
   * opening auto-advance to finish first, so the increase is the play's.
   */
  async playAndExpectSteps(setup: string, mode: InteractionMode): Promise<void> {
    await expect(this.loading, `${setup}: session settles before play`).toHaveCount(0, { timeout: START_TIMEOUT });
    const before = await this.currentStep();
    const pause = this.page.getByTestId('run-pause');
    if ((await pause.count()) === 0) {
      await this.page.getByTestId(mode === 'director' ? 'director-start' : 'run-play').click();
    }
    await expect
      .poll(() => this.currentStep(), {
        message: `${setup}: step counter must rise above ${before} after play`,
        timeout: mode === 'director' ? STEP_TIMEOUT.director : STEP_TIMEOUT.default,
      })
      .toBeGreaterThan(before);
  }

  /** The tour toolbar's "finish mode" button; with the survey on, it opens the survey. */
  async finishTourMode(): Promise<void> {
    await this.page.getByTestId('run-finish-mode').click();
  }

  survey(): Locator {
    return this.page.getByTestId('survey');
  }
}
