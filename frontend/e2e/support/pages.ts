// Page objects: one class per screen, wrapping its `data-testid` locators.
//
// Every locator is a test id. Visible labels change with the language, and
// `getByRole` does not see SBB Lyne buttons (Lyne sets the role through
// ElementInternals), so neither is used.
import { expect, type Locator, type Page, type Request, type Response } from '@playwright/test';

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
   * preset does not start: known bug 5 (docs/plans/e2e-playwright.md#known-bugs;
   * fix location `resolveWelcomeSessionOpts` in src/app/app.component.ts,
   * marked KNOWN BUG 5). Waiting is the normal user path, so no test
   * exercises that race.
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
  /** `<origin>/session/<id>` of the last session the page created, for backend checks. */
  private session: string | null = null;
  /**
   * Every `POST /session/<id>/step` the page sent, in order: how many steps it
   * asked for, and whether it has finished. The opening auto-advance steps the
   * session this way; the play loop steps it on the server, with no request.
   */
  private readonly stepRequests: { request: Request; steps: number; done: boolean }[] = [];

  constructor(private readonly page: Page) {
    this.finishExperiment = page.getByTestId('run-finish-experiment');
    this.step = page.getByTestId('status-step');
    this.ws = page.getByTestId('status-ws');
    this.loading = page.getByTestId('status-loading');
    page.on('response', async (res) => {
      if (!isCreateSession(res) || !res.ok()) return;
      const id = ((await res.json().catch(() => null)) as { id?: string } | null)?.id;
      if (id) this.session = `${new URL(res.url()).origin}/session/${id}`;
    });
    page.on('request', (req) => {
      if (req.method() !== 'POST' || !/^\/session\/[^/]+\/step$/.test(new URL(req.url()).pathname)) return;
      const body = (req.postDataJSON() ?? {}) as { n_steps?: number };
      this.stepRequests.push({ request: req, steps: body.n_steps ?? 1, done: false });
    });
    const finished = (req: Request) => {
      const entry = this.stepRequests.find((r) => r.request === req);
      if (entry) entry.done = true;
    };
    page.on('requestfinished', finished);
    page.on('requestfailed', finished);
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
   * Press play (the Director's own start button in Director) and prove that
   * the play loop stepped the session, not only the opening auto-advance.
   *
   * "Loading…" is no proof that the opening is over: it disappears between the
   * auto-advance's steps (known bug 8, docs/plans/e2e-playwright.md#known-bugs;
   * fix location `SessionStore`'s WebSocket handler and
   * `_autoAdvanceToOpeningState` in src/app/core/session.store.ts, marked
   * KNOWN BUG 8), so the auto-advance can still be stepping while play runs. The check
   * therefore works from the backend: once the server reports the play loop
   * running (`GET /session/<id>/play_status`), it reads the server's step
   * (`GET /session/<id>/state`). From then on, the steps the page itself asks
   * for (`POST /session/<id>/step`, which is how the auto-advance steps) are
   * counted, together with any still in flight at that moment. The counter
   * must rise above the server's step plus all of those, which only a step of
   * the play loop can do.
   *
   * In Director the play must also run on a plan that can drive the trains
   * (`expectDirectorPlan`).
   */
  async playAndExpectSteps(setup: string, mode: InteractionMode): Promise<void> {
    await expect(this.loading, `${setup}: session settles before play`).toHaveCount(0, { timeout: START_TIMEOUT });
    const pause = this.page.getByTestId('run-pause');
    if ((await pause.count()) === 0) {
      await this.page.getByTestId(mode === 'director' ? 'director-start' : 'run-play').click();
    }
    if (mode === 'director') await this.expectDirectorPlan(setup);
    await expect
      .poll(() => this.backendPlaying(setup), {
        message: `${setup}: the backend's play loop runs after play (GET /session/<id>/play_status)`,
        timeout: STEP_TIMEOUT.default,
      })
      .toBe(true);
    const mark = this.stepRequests.length;
    const inFlight = this.stepRequests.filter((r) => !r.done).reduce((sum, r) => sum + r.steps, 0);
    const atPlay = await this.backendStep(setup);
    const pageSteps = () => inFlight + this.stepRequests.slice(mark).reduce((sum, r) => sum + r.steps, 0);
    await expect
      .poll(async () => (await this.currentStep()) - pageSteps(), {
        message:
          `${setup}: the play loop must step the session — the step counter, minus the steps the page ` +
          `itself requested from then on (POST /step, the opening auto-advance), must rise above ${atPlay}, ` +
          `the backend's step when play was confirmed`,
        timeout: STEP_TIMEOUT.default,
      })
      .toBeGreaterThan(atPlay);
  }

  /** `playing` from `GET /session/<id>/play_status`: whether the server's play loop runs. */
  private async backendPlaying(setup: string): Promise<boolean> {
    const res = await this.page.request.get(`${this.sessionUrl(setup)}/play_status`);
    return res.ok() && ((await res.json()) as { playing?: boolean }).playing === true;
  }

  /** `elapsed_steps` from `GET /session/<id>/state`: the server's own step. */
  private async backendStep(setup: string): Promise<number> {
    const res = await this.page.request.get(`${this.sessionUrl(setup)}/state`);
    expect(res.ok(), `${setup}: GET /session/<id>/state`).toBe(true);
    return ((await res.json()) as { elapsed_steps: number }).elapsed_steps;
  }

  private sessionUrl(setup: string): string {
    if (!this.session) throw new Error(`${setup}: no session id seen (no successful POST /session)`);
    return this.session;
  }

  /**
   * Director: wait until the session has a committed plan, and check that it
   * can drive the trains. A plan with source `unroutable` has no trains to
   * drive, yet the counter still rises.
   */
  private async expectDirectorPlan(setup: string): Promise<void> {
    let source: string | null = null;
    await expect
      .poll(
        async () => {
          source = await this.directorPlanSource(setup);
          return source;
        },
        {
          // KNOWN BUG 7 and 8: on the Olten and ECML networks this can fail
          // instead of the "unroutable" check below, when play started during
          // the opening auto-advance (docs/plans/e2e-playwright.md#known-bugs).
          message:
            `${setup}: the Director commits a plan after start (GET /session/<id>/director has none after ` +
            `${STEP_TIMEOUT.director / 1000} s; on the Olten and ECML networks this is known bug 7 with bug 8, ` +
            `docs/plans/e2e-playwright.md#known-bugs)`,
          timeout: STEP_TIMEOUT.director,
        },
      )
      .not.toBeNull();
    // KNOWN BUG 7 (docs/plans/e2e-playwright.md#known-bugs): on the Olten and
    // ECML networks this fails, because the planner gives up and its fallback
    // finds no plan. Fix location: GoalDirectedPolicy._plan in
    // backend/app/policies/goal_directed_policy.py (marked KNOWN BUG 7).
    expect(
      source,
      `${setup}: the Director's plan source; "unroutable" means the planner found no plan and every train ` +
        `holds (known bug 7, docs/plans/e2e-playwright.md#known-bugs)`,
    ).not.toBe('unroutable');
  }

  /** `plan.source` from `GET /session/<id>/director`; null while there is no plan. */
  private async directorPlanSource(setup: string): Promise<string | null> {
    const res = await this.page.request.get(`${this.sessionUrl(setup)}/director`);
    if (!res.ok()) return null;
    const body = (await res.json()) as { plan?: { source?: string } | null };
    return body.plan?.source ?? null;
  }

  /** The tour toolbar's "finish mode" button; with the survey on, it opens the survey. */
  async finishTourMode(): Promise<void> {
    await this.page.getByTestId('run-finish-mode').click();
  }

  survey(): Locator {
    return this.page.getByTestId('survey');
  }
}
