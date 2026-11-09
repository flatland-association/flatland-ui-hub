import { readFile } from 'node:fs/promises';
// Page objects: one class per screen, wrapping its `data-testid` locators.
//
// Every locator is a test id. Visible labels change with the language, and
// `getByRole` does not see SBB Lyne buttons (Lyne sets the role through
// ElementInternals), so neither is used.
import { expect, type Locator, type Page, type Request, type Response, type WebSocketRoute } from '@playwright/test';

import type { InteractionMode } from './app-data';
import type { DispatcherDecision, DispatcherState } from '../../src/app/core/dispatcher';
import type { DirectorComparison } from '../../src/app/core/models';
import { expectedPanels, type LayoutRef } from './panel-expectations';

export type Door = 'introduction' | 'build' | 'experiments';
export interface DispatcherProposalRef { command_id: string; generation: number; }
interface DispatcherControlReveal { target: string; commandId: string | null; stage: string | null; }
interface DispatcherCursorObservation {
  target: string | null; outcome: string | null; controlTestId: string;
  cursorRect: { x: number; y: number; width: number; height: number };
  controlRect: { x: number; y: number; width: number; height: number };
  cursorVisible: boolean; controlVisible: boolean;
  cursorInViewport: boolean; controlInViewport: boolean; pointerDistance: number;
}
interface DirectorComparisonFrame {
  stage: string | null; commandId: string | null; token: string | null;
  step: string | null; alternativeId: string | null; text: string;
  bubbleVisible: boolean; mapVisible: boolean; cellSize: number;
  speechRect: { left: number; right: number; top: number; bottom: number } | null;
  mapRect: { left: number; right: number; top: number; bottom: number } | null;
  nativeControlVisible: boolean; nativeControlUncovered: boolean;
  cursorTarget: string | null; cursorVisible: boolean; pointerDistance: number | null;
  paths: { id: string; d: string; visible: boolean; length: number }[];
  reroutes: { handle: string | null; x: number; y: number; visible: boolean }[];
  holds: { handle: string | null; steps: number; x: number; y: number; visible: boolean }[];
}
interface DirectorOutcomeFrame {
  commandId: string | null; phase: string | null; arrived: number | null; total: number | null; step: number | null;
  expectedArrived: number | null; expectedTotal: number | null;
  delay: number | null; delayDenominator: number | null; reference: string | null;
  text: string; actualText: string; visible: boolean; mapVisible: boolean; signoffVisible: boolean;
  summaryPrecedesSignoff: boolean;
  speechRect: { left: number; right: number; top: number; bottom: number } | null;
  mapRect: { left: number; right: number; top: number; bottom: number } | null;
}
interface DirectorOutcomeMeasurement {
  sessionId: string; commandId: string; arrived: number; total: number; step: number;
  delay: number | null; delayDenominator: number; reference: string | null; runStatus: string;
}

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
   * preset does not start.
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

  async selectDispatcher(profile: string, delay = 3): Promise<void> {
    await this.page.getByTestId('dispatcher-operator').selectOption('agent');
    await this.page.getByTestId('dispatcher-profile').selectOption(profile);
    if (profile === 'delayed') await this.page.getByTestId('dispatcher-delay').fill(String(delay));
  }

  async expectDispatcherStaffingChoices(): Promise<void> {
    const values = await this.page.getByTestId('dispatcher-operator').evaluate(element =>
      Array.from((element as HTMLSelectElement).options, option => option.value));
    expect(values).toEqual(['human', 'agent', 'human_dispatcher_team']);
  }

  async selectDispatcherTeam(mode: InteractionMode = 'recommendation'): Promise<void> {
    await this.page.getByTestId('dispatcher-operator').selectOption('human_dispatcher_team');
    await this.page.getByTestId('dispatcher-mode').selectOption(mode);
    if (mode === 'co-learning') await expect(this.page.getByTestId('dispatcher-profile')).toHaveCount(0);
    else await expect(this.page.getByTestId('dispatcher-profile')).toHaveValue('baseline');
  }

  async setDispatcherInitialWeights(weights: { punctuality: number; connections: number; stability: number }): Promise<void> {
    const buildPanel = this.page.locator('sbb-selection-expansion-panel')
      .filter({ has: this.page.getByTestId('welcome-door-build') });
    // Lyne keeps expansion content inert until its opening animation finishes.
    await expect(buildPanel.locator('.sbb-selection-expansion-panel__content--wrapper')).not.toHaveAttribute('inert');
    for (const [axis, weight] of Object.entries(weights)) {
      const input = this.page.getByTestId(`dispatcher-initial-${axis}`);
      await expect(input).toBeEditable();
      await input.focus();
      await expect(input).toBeFocused();
      await input.fill(String(weight));
      await expect(input).toHaveValue(String(weight));
    }
  }

  async loadDispatcherDemo(): Promise<void> {
    await this.page.getByTestId('dispatcher-demo-load').click();
    await expect(this.page.getByTestId('dispatcher-demo-active')).toBeVisible();
  }

  async startPreparedDispatcherDemo(mode: 'recommendation' | 'director' | 'team' | 'shift' | 'shift-team',
    options: { automaticPlayback?: boolean } = {}): Promise<Response> {
    const created = sessionCreated(this.page, `prepared ${mode} dispatcher`);
    // A connected socket precedes the opening steps. Existing demos assert the
    // actual automatic Play acknowledgement; the Team shift opens at consent.
    const playing = options.automaticPlayback === false ? null : this.page.waitForResponse(res => res.request().method() === 'POST'
      && /\/session\/[^/]+\/play$/.test(new URL(res.url()).pathname), { timeout: START_TIMEOUT });
    await this.page.getByTestId(`dispatcher-demo-start-${mode}`).click();
    const response = await created;
    if (playing) expect((await playing).ok(), `prepared ${mode}: automatic playback accepted`).toBe(true);
    return response;
  }

  async expectPreparedDispatcherDemosVisible(): Promise<void> {
    for (const mode of ['recommendation', 'director']) {
      await expect(this.page.getByTestId(`dispatcher-demo-start-${mode}`)).toBeInViewport({ ratio: 1 });
    }
  }

  async expectPreparedTeamDemoVisible(): Promise<void> {
    await expect(this.page.getByTestId('dispatcher-demo-start-team')).toBeInViewport({ ratio: 1 });
  }

  async expectPreparedDispatcherShiftDemosVisible(): Promise<void> {
    for (const staffing of ['shift', 'shift-team']) {
      await expect(this.page.getByTestId(`dispatcher-demo-start-${staffing}`)).toBeVisible();
    }
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
    // The global footer exposes real opening/model work while the intro stays visible.
    await expect(this.page.getByTestId('status-loading')).toHaveCount(0, { timeout: START_TIMEOUT });
    const start = this.page.getByTestId('mode-intro-start');
    await expect(start).toBeEnabled();
    await expect(start).not.toHaveAttribute('disabled');
    await start.click();
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
  private readonly dispatcherControlRequests: Request[] = [];
  private dispatcherConnection: { client: WebSocketRoute; server: WebSocketRoute } | null = null;
  private dispatcherUpdatesDisconnected = false;
  private readonly comparisonRequests: Request[] = [];
  private readonly comparisonResponses: Response[] = [];
  private comparisonPrepared: DispatcherState | null = null;
  private comparisonHeldCommit: Request | null = null;
  private comparisonHeldResume: Request | null = null;
  private releaseComparisonPreparation: (() => void) | null = null;
  private releaseComparisonCommit: (() => void) | null = null;
  private releaseComparisonResume: (() => void) | null = null;
  private readonly directorOutcomeMeasurements: DirectorOutcomeMeasurement[] = [];

  constructor(private readonly page: Page) {
    this.finishExperiment = page.getByTestId('run-finish-experiment');
    this.step = page.getByTestId('status-step');
    this.ws = page.getByTestId('status-ws');
    this.loading = page.getByTestId('status-loading');
    page.on('response', async (res) => {
      if (res.request().method() === 'POST' && /\/dispatcher\/comparison\/(?:prepare|commit)$/.test(new URL(res.url()).pathname)) {
        this.comparisonResponses.push(res);
      }
      if (!isCreateSession(res) || !res.ok()) return;
      const id = ((await res.json().catch(() => null)) as { id?: string } | null)?.id;
      if (id) this.session = `${new URL(res.url()).origin}/session/${id}`;
    });
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/dispatcher\/comparison\/(?:prepare|commit)$/.test(new URL(req.url()).pathname)) {
        this.comparisonRequests.push(req);
      }
      if (req.method() === 'POST' && /\/session\/[^/]+\/(?:play|pause|dispatcher\/(?:decision|ownership|stop))$/.test(new URL(req.url()).pathname)) {
        this.dispatcherControlRequests.push(req);
      }
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

  get dispatcherMonitor(): Locator { return this.page.getByTestId('dispatcher-overlay'); }

  async openDispatcherMonitor(): Promise<void> {
    await this.page.getByTestId('dispatcher-log-toggle').click();
  }

  async closeDispatcherMonitor(): Promise<void> {
    if (await this.page.getByTestId('dispatcher-log-toggle').getAttribute('aria-expanded') === 'true') {
      await this.page.getByTestId('dispatcher-log-close').click();
    }
  }

  async startSyntheticPlayback(): Promise<void> {
    await expect(this.loading, 'synthetic dispatcher: opening completes before Play').toHaveCount(0, { timeout: START_TIMEOUT });
    const play = this.page.getByTestId('run-play');
    await expect(play).toBeEnabled();
    await expect(play).not.toHaveAttribute('disabled');
    const accepted = this.page.waitForResponse(res => res.request().method() === 'POST'
      && /\/session\/[^/]+\/play$/.test(new URL(res.url()).pathname), { timeout: STEP_TIMEOUT.default });
    await play.click();
    expect((await accepted).ok(), 'synthetic dispatcher: playback accepted').toBe(true);
    await this.expectSyntheticPlayback();
  }

  async ensureSyntheticPlayback(): Promise<void> {
    if (await this.page.getByTestId('run-play').isVisible()) await this.startSyntheticPlayback();
    else await this.expectSyntheticPlayback();
  }

  async pauseSyntheticPlayback(): Promise<void> {
    const accepted = this.page.waitForResponse(res => res.request().method() === 'POST'
      && /\/session\/[^/]+\/pause$/.test(new URL(res.url()).pathname), { timeout: STEP_TIMEOUT.default });
    await this.page.getByTestId('run-pause').click();
    expect((await accepted).ok(), 'synthetic dispatcher: pause accepted').toBe(true);
    await expect(this.page.getByTestId('run-play')).toBeVisible();
  }

  /** Execute one real dispatcher pulse through the paused toolbar, without autoplay races. */
  async stepSyntheticPlayback(): Promise<void> {
    await expect(this.page.getByTestId('run-play')).toBeVisible();
    const step = this.page.getByTestId('run-step-1');
    await expect(step).toBeEnabled();
    await expect(step).not.toHaveAttribute('disabled');
    const accepted = this.page.waitForResponse(res => res.request().method() === 'POST'
      && /\/session\/[^/]+\/step$/.test(new URL(res.url()).pathname), { timeout: STEP_TIMEOUT.default });
    await step.click();
    const response = await accepted;
    expect(response.ok(), 'synthetic dispatcher: one paused pulse accepted').toBe(true);
    expect(response.request().postDataJSON().n_steps).toBe(1);
    await expect(this.page.getByTestId('run-play')).toBeVisible();
    await expect(this.loading).toHaveCount(0);
  }

  async setSyntheticTempo(level: number): Promise<void> {
    const speed = this.page.getByTestId('run-speed');
    await speed.press('Home');
    for (let selected = 1; selected < level; selected++) await speed.press('ArrowRight');
    await expect(speed).toHaveValue(String(level));
  }

  async takeOverDispatcher(): Promise<void> { await this.page.getByTestId('dispatcher-takeover').click(); }

  async delegateDispatcher(): Promise<void> {
    const accepted = this.page.waitForResponse(res => res.request().method() === 'POST'
      && /\/dispatcher\/ownership$/.test(new URL(res.url()).pathname), { timeout: STEP_TIMEOUT.default });
    await this.page.getByTestId('dispatcher-hand-back').click();
    expect((await accepted).ok(), 'dispatcher: delegation accepted').toBe(true);
  }

  async teamProposal(): Promise<DispatcherProposalRef> {
    await expect.poll(async () => (await this.dispatcherState()).awaiting_approval,
      { timeout: STEP_TIMEOUT.default }).toBe(true);
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-proposal')).toHaveAttribute('data-state', 'awaiting_approval');
    const snapshot = await this.dispatcherState();
    expect(snapshot.requires_approval).toBe(true);
    expect(snapshot.awaiting_approval).toBe(true);
    expect(snapshot.pending).not.toBeNull();
    const proposal = { command_id: snapshot.pending.command_id, generation: snapshot.pending.generation };
    await this.expectTeamProposal(proposal, 'awaiting_approval');
    return proposal;
  }

  async expectTeamProposal(proposal: DispatcherProposalRef, state: 'awaiting_approval' | 'approved'): Promise<void> {
    const panel = this.dispatcherMonitor.getByTestId('dispatcher-proposal');
    await expect(panel).toHaveAttribute('data-state', state);
    await expect(panel).toHaveAttribute('data-command-id', proposal.command_id);
    await expect(panel).toHaveAttribute('data-generation', String(proposal.generation));
  }

  async expectNoTeamProposal(): Promise<void> {
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-proposal')).toHaveCount(0);
  }

  /** An actual decision pulse while waiting for consent must not move trains. */
  async expectTeamConsentHeld(proposal: DispatcherProposalRef): Promise<void> {
    const before = await this.dispatcherState();
    const simulationStep = await this.backendStep('Team pending consent');
    await this.expectDispatcherPulseAfter(before.logical_time);
    const after = await this.dispatcherState();
    expect(after.awaiting_approval).toBe(true);
    expect(after.pending.command_id).toBe(proposal.command_id);
    expect(after.pending.generation).toBe(proposal.generation);
    expect(after.metrics.executed).toBe(0);
    expect(await this.backendStep('Team pending consent')).toBe(simulationStep);
  }

  async expectDispatcherPulseAfter(logicalTime: number): Promise<void> {
    await expect.poll(async () => (await this.dispatcherState()).logical_time,
      { timeout: STEP_TIMEOUT.default }).toBeGreaterThan(logicalTime);
  }

  /** A corridor pulse can run the existing full PP/CBS strategy computation. */
  async nextDispatcherShiftState(logicalTime: number): Promise<any> {
    let state: any;
    await expect.poll(async () => {
      state = await this.dispatcherState();
      return ['finished', 'error', 'aborted'].includes(state.run_status) || state.logical_time > logicalTime;
    }, { timeout: STEP_TIMEOUT.director }).toBe(true);
    return state;
  }

  async expectDispatcherDecisionEvidence(commandId: string): Promise<void> {
    const toggle = this.dispatcherMonitor.getByTestId('dispatcher-activity-toggle');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    const reason = this.dispatcherMonitor.getByTestId('dispatcher-reason');
    await expect(reason).toBeVisible();
    await expect(reason).toHaveAttribute('data-kind', 'forecast_comparison');
    await expect(reason).toHaveAttribute('data-command-id', commandId);
  }

  /** Observe real native reveals without changing their behaviour or app state. */
  async observeDispatcherControlReveals(): Promise<void> {
    await this.page.addInitScript(() => {
      const browser = window as typeof window & { dispatcherControlReveals?: DispatcherControlReveal[] };
      browser.dispatcherControlReveals = [];
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions): void {
        const target = this.getAttribute('data-dispatcher-target');
        if (target?.startsWith('strategy:') || target?.startsWith('director:')) {
          const assessment = document.querySelector('[data-testid="dispatcher-assessment"]');
          browser.dispatcherControlReveals!.push({ target,
            commandId: assessment?.getAttribute('data-command-id') ?? null,
            stage: assessment?.getAttribute('data-stage') ?? null });
        }
        original.call(this, options);
      };
    });
  }

  async expectDispatcherRevealsOnlyPending(): Promise<void> {
    const reveals = await this.page.evaluate(() =>
      (window as typeof window & { dispatcherControlReveals: DispatcherControlReveal[] }).dispatcherControlReveals);
    expect(reveals, 'dispatcher: native reveal observer was installed').toBeDefined();
    for (const reveal of reveals) {
      expect(reveal.commandId, 'dispatcher: a revealed control belongs to the shown command').toBeTruthy();
      expect(['planned', 'awaiting_approval', 'approved'],
        'dispatcher: historical accepted actions must never reveal their old control').toContain(reveal.stage);
    }
    expect(new Set(reveals.map(reveal => reveal.commandId)).size,
      'dispatcher: a pending command reveals its control at most once').toBe(reveals.length);
  }

  /** The compact bubble must explain the actual frozen offer, including its named trains. */
  async expectDispatcherAssessment(decision: DispatcherDecision, stage: string): Promise<void> {
    const assessment = this.dispatcherMonitor.getByTestId('dispatcher-assessment');
    await expect(assessment).toBeVisible();
    await expect(assessment).toHaveAttribute('data-command-id', decision.command_id);
    await expect(assessment).toHaveAttribute('data-contention-id', decision.command.contention_id!);
    await expect(assessment).toHaveAttribute('data-stage', stage);
    await expect(assessment).toHaveAttribute('data-choice', decision.command.strategy === 'keep' ? 'maintain' : 'change');
    const context = assessment.getByTestId('dispatcher-assessment-context');
    await expect(context).toBeVisible();
    const handles = decision.command.handles ?? decision.offer?.handles ?? [];
    expect(handles.length, 'dispatcher: the real corridor assessment has affected trains').toBeGreaterThan(0);
    // Separate the two rendered flex text segments: raw textContent joins the
    // last service and the location into e.g. "RB_16RG 1" without whitespace.
    const contextText = await context.evaluate(element =>
      Array.from(element.children, child => child.textContent ?? '').join(' '));
    const serviceNames = contextText.match(/\b[A-Z][A-Z0-9]*_\d+\b/g) ?? [];
    expect(serviceNames.length, 'dispatcher: every affected train has a readable service name').toBe(handles.length);
    expect(new Set(serviceNames).size, 'dispatcher: affected trains have distinct service names').toBe(handles.length);
    for (const [index, handle] of handles.entries()) {
      // A normal map marker contains only its numeric handle. The native
      // service-name title is present for problem trains; waiting/off-grid
      // trains may have no marker at all. Read that real label when it exists.
      const nativeTitles = await this.page.getByTestId(`map-agent-${handle}`).first().evaluateAll(markers =>
        markers.flatMap(marker => Array.from(marker.children)
          .filter(child => child.localName === 'title').map(title => title.textContent ?? '')));
      for (const title of nativeTitles) {
        const serviceName = title.match(/\b[A-Z][A-Z0-9]*_\d+\b/)?.[0];
        expect(serviceName, `dispatcher: native title for train ${handle} names its service`).toBeTruthy();
        expect(serviceNames[index], `dispatcher: train ${handle} has the same identity at its exact offer position`).toBe(serviceName);
      }
    }
    const location = decision.explanation?.location?.['name'] ?? decision.offer?.location?.name;
    expect(location, 'dispatcher: the real corridor assessment has a named location').toEqual(expect.any(String));
    await expect(context).toContainText(location as string);
    const offer = decision.offer!;
    expect(offer, 'dispatcher: the accepted decision retains its original offer').toBeTruthy();
    const forecast = assessment.getByTestId('dispatcher-assessment-forecast');
    await expect(forecast).toBeVisible();
    await expect(forecast).toHaveAttribute('data-step', String(offer.step));
    await expect(forecast).toContainText(String(offer.step));
    const selected = offer.strategies.find(strategy => strategy.id === decision.command.strategy)!;
    expect(selected, 'dispatcher: the selected strategy was genuinely offered').toBeTruthy();
    const alternatives = offer.strategies.filter(strategy => strategy.id !== selected.id);
    expect(alternatives.length, 'dispatcher: the full-shift assessment has other offered strategies').toBeGreaterThan(0);
    expect(alternatives.every(strategy => Number.isFinite(strategy.metrics.score))).toBe(true);
    const bestOther = [...alternatives].sort((a, b) => a.metrics.score - b.metrics.score)[0];
    const reason = assessment.getByTestId('dispatcher-assessment-reason');
    await expect(reason).toBeVisible();
    await expect(reason).toHaveAttribute('data-comparison', selected.metrics.score < bestOther.metrics.score ? 'better'
      : selected.metrics.score === bestOther.metrics.score ? 'equal' : 'worse');
    const comparison = assessment.getByTestId('dispatcher-assessment-comparison');
    await expect(comparison).toBeVisible();
    await expect(comparison).toHaveAttribute('data-selected-score', String(selected.metrics.score));
    await expect(comparison).toHaveAttribute('data-other-score', String(bestOther.metrics.score));
    const metric = await comparison.getAttribute('data-metric') as 'deadlocks' | 'notArrivedDue' | 'lateness';
    expect(['deadlocks', 'notArrivedDue', 'lateness']).toContain(metric);
    await expect(comparison).toHaveAttribute('data-selected', String(selected.metrics[metric]));
    await expect(comparison).toHaveAttribute('data-other', String(bestOther.metrics[metric]));
    await expect(comparison).toContainText(String(selected.metrics[metric]));
    await expect(comparison).toContainText(String(bestOther.metrics[metric]));
  }

  async expectDispatcherMaintaining(decision: DispatcherDecision): Promise<void> {
    expect(decision.command.strategy, 'dispatcher: maintaining is a real keep decision').toBe('keep');
    await this.expectDispatcherAssessment(decision, 'executed');
    await this.expectDispatcherKeepOnMap();
    await this.expectDispatcherCompact();
  }

  async expectDispatcherKeepOnMap(): Promise<void> {
    const assessment = this.dispatcherMonitor.getByTestId('dispatcher-assessment');
    await expect(assessment).toHaveAttribute('data-choice', 'maintain');
    await expect(assessment).toHaveAttribute('data-stage', 'executed');
    await this.expectNoDispatcherCursor();
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-activity')).toHaveAttribute('data-anchor', 'map');
    await expect(this.page.getByTestId('strategy-apply-keep')).not.toHaveAttribute('data-dispatcher-highlight', /.+/);
  }

  async expectDispatcherCompact(): Promise<void> {
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-activity-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-reason')).toHaveCount(0);
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-effect')).toHaveCount(0);
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-queue')).toBeVisible();
    await this.expectDispatcherAvatar();
  }

  async closeDispatcherDetails(): Promise<void> {
    const toggle = this.dispatcherMonitor.getByTestId('dispatcher-activity-toggle');
    if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
    await this.expectDispatcherCompact();
  }

  async expectDisplayedPolicy(policy: string): Promise<void> {
    await expect(this.page.getByTestId('run-policy')).toHaveValue(policy);
  }

  async expectDispatcherQueue(queue: { contention_id: string; status: string }[]): Promise<void> {
    const panel = this.dispatcherMonitor.getByTestId('dispatcher-queue');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-count', String(queue.length));
    const items = this.dispatcherMonitor.getByTestId('dispatcher-queue-item');
    await expect(items).toHaveCount(queue.length);
    for (const [index, entry] of queue.entries()) {
      await expect(items.nth(index)).toHaveAttribute('data-contention-id', entry.contention_id);
      await expect(items.nth(index)).toHaveAttribute('data-state', entry.status);
    }
  }

  async expectDispatcherEffect(commandId: string): Promise<void> {
    const effect = this.dispatcherMonitor.getByTestId('dispatcher-effect');
    await expect(effect).toBeVisible();
    await expect(effect).toHaveAttribute('data-command-id', commandId);
    await expect(effect).toHaveAttribute('data-causal-claim', 'false');
  }

  async expectDispatcherReferenceLabels(forecast: string, arrivals: string): Promise<void> {
    const forecastLabel = this.dispatcherMonitor.getByTestId('dispatcher-forecast-reference');
    const arrivalLabel = this.dispatcherMonitor.getByTestId('dispatcher-arrival-reference');
    await expect(forecastLabel).toBeVisible();
    await expect(forecastLabel).toHaveAttribute('data-source', forecast);
    await expect(arrivalLabel).toBeVisible();
    await expect(arrivalLabel).toHaveAttribute('data-source', arrivals);
  }

  async expectNativeStrategyOwnedByDispatcher(strategy: string): Promise<void> {
    await expect(this.page.getByTestId('strategy-takeover-required')).toBeVisible();
    const apply = this.page.getByTestId(`strategy-apply-${strategy}`);
    await expect(apply).toBeVisible();
    await expect(apply).toBeDisabled();
  }

  async replyDispatcherProposal(decision: 'approve' | 'decline'): Promise<Response> {
    const accepted = this.page.waitForResponse(res => res.request().method() === 'POST'
      && /\/dispatcher\/decision$/.test(new URL(res.url()).pathname), { timeout: STEP_TIMEOUT.default });
    await this.dispatcherMonitor.getByTestId(`dispatcher-${decision}`).click();
    const response = await accepted;
    expect(response.ok(), `Team: ${decision} accepted`).toBe(true);
    return response;
  }

  /** Another real browser controls the existing backend session, without UI state injection. */
  async controlPlaybackFromAnotherBrowser(action: 'play' | 'pause'): Promise<void> {
    const session = this.sessionUrl('shared dispatcher playback');
    const policy = await this.sessionPolicy('shared dispatcher playback');
    const browser = this.page.context().browser();
    if (!browser) throw new Error('shared dispatcher playback: browser unavailable');
    const context = await browser.newContext();
    try {
      const controller = await context.newPage();
      await controller.goto(`${session}/state`);
      const response = await controller.evaluate(async ({ session, action, policy }) => {
        const result = await fetch(`${session}/${action}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action === 'play' ? { policy, speed: 1 } : {}),
        });
        return { status: result.status, body: await result.json() };
      }, { session, action, policy });
      expect(response.status, `second browser: ${action} accepted`).toBe(200);
      expect(response.body.playing).toBe(action === 'play');
    } finally {
      await context.close();
    }
  }

  async expectDispatcherAvatar(): Promise<void> {
    const avatar = this.dispatcherMonitor.getByTestId('dispatcher-avatar');
    await expect(avatar).toHaveCount(1);
    await expect(avatar).toBeInViewport();
    await expect(this.page.getByTestId('dispatcher-monitor')).toHaveCount(0);
    await expect(this.panel('dispatcher-agent-monitor')).toHaveCount(0);
  }

  async expectDispatcherLiveState(state: string | RegExp): Promise<void> {
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-live-state')).toHaveAttribute('data-state', state);
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-avatar')).toHaveAttribute('data-state', state);
  }

  async expectDispatcherRunning(): Promise<void> {
    await this.expectDispatcherLiveState(/^(observing|planning|acting|waiting)$/);
  }

  async dispatcherLiveStep(): Promise<number> {
    const step = this.dispatcherMonitor.getByTestId('dispatcher-live-step');
    await expect(step).toHaveAttribute('data-step', /^\d+$/);
    return Number(await step.getAttribute('data-step'));
  }

  async expectDispatcherLiveStepAfter(step: number): Promise<void> {
    await expect.poll(() => this.dispatcherLiveStep(), { timeout: STEP_TIMEOUT.default }).toBeGreaterThan(step);
  }

  /** The age changes while paused; the actual simulation step must not. */
  async expectDispatcherPausedStepFrozen(): Promise<void> {
    await this.expectDispatcherLiveState('paused');
    expect(await this.backendPlaying('paused dispatcher')).toBe(false);
    const pausedStep = await this.backendStep('paused dispatcher');
    const liveStep = this.dispatcherMonitor.getByTestId('dispatcher-live-step');
    await expect(liveStep).toHaveAttribute('data-step', String(pausedStep));
    await expect(this.step).toHaveText(String(pausedStep));
    const freshness = this.dispatcherMonitor.getByTestId('dispatcher-live-freshness');
    await expect(freshness).toBeVisible();
    const age = await freshness.textContent();
    await expect(freshness).not.toHaveText(age!, { timeout: STEP_TIMEOUT.default });
    await expect(liveStep).toHaveAttribute('data-step', String(pausedStep));
    expect(await this.backendStep('paused dispatcher')).toBe(pausedStep);
  }

  async dispatcherLastAction(): Promise<string> {
    const action = this.dispatcherMonitor.getByTestId('dispatcher-last-action');
    await expect(action).toBeVisible();
    const text = await action.getByTestId('dispatcher-activity-text').textContent();
    expect(text, 'dispatcher: last action has text').toBeTruthy();
    return text!;
  }

  async expectDispatcherLastAction(action: string): Promise<void> {
    const lastAction = this.dispatcherMonitor.getByTestId('dispatcher-last-action');
    await expect(lastAction).toBeVisible();
    await expect(lastAction.getByTestId('dispatcher-activity-text')).toHaveText(action);
  }

  /** Forward real frames unchanged; retain control only over connection loss. */
  async controlDispatcherConnection(): Promise<void> {
    await this.page.routeWebSocket(/\/ws\/session\/[^/]+$/, async client => {
      if (this.dispatcherUpdatesDisconnected) {
        await client.close({ code: 1012, reason: 'Dispatcher connection unavailable' });
        return;
      }
      this.dispatcherConnection = { client, server: client.connectToServer() };
    });
  }

  async disconnectDispatcherUpdates(): Promise<void> {
    if (!this.dispatcherConnection) throw new Error('dispatcher: no routed WebSocket connection');
    this.dispatcherUpdatesDisconnected = true;
    await this.dispatcherConnection.client.close({ code: 1012, reason: 'Dispatcher connection unavailable' });
    await this.dispatcherConnection.server.close({ code: 1012, reason: 'Dispatcher connection unavailable' });
    await expect(this.ws).not.toHaveClass(/\bconnected\b/);
    await this.expectDispatcherLiveState('offline');
  }

  async reconnectDispatcherUpdates(): Promise<void> {
    this.dispatcherUpdatesDisconnected = false;
    await expect(this.ws).toHaveClass(/\bconnected\b/, { timeout: STEP_TIMEOUT.default });
  }

  async expectDispatcherTrainMark(handle: number, status: string): Promise<void> {
    const train = this.page.getByTestId(`map-agent-${handle}`).first();
    await expect(train).toHaveAttribute('data-dispatcher-action', status);
    await expect(train).toBeInViewport();
    await expect(train.getByTestId(`dispatcher-action-ring-${handle}`)).toBeInViewport();
  }

  async expectDispatcherActivity(stage: string): Promise<void> {
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-activity')).toHaveAttribute('data-outcome', stage);
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-activity-text')).toBeInViewport();
  }

  async expectDispatcherActivityWeights(weights: string): Promise<void> {
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-activity-text')).toContainText(weights);
  }

  async expectDispatcherCursorAt(testId: string, targetKey: string): Promise<void> {
    const cursor = this.page.getByTestId('dispatcher-cursor');
    const target = this.page.getByTestId(testId).first();
    let expectedTarget = targetKey;
    if (targetKey.startsWith('strategy:')) {
      const state = await this.dispatcherState();
      const command = state.pending?.command ?? state.last_result?.decision.command;
      expect(command?.kind).toBe('strategy');
      expect(command.contention_id).toEqual(expect.any(String));
      expect(command.contention_id.length).toBeGreaterThan(0);
      expectedTarget = `${targetKey}:${command.contention_id}`;
    }
    await expect(cursor).toHaveAttribute('data-target', expectedTarget);
    await expect(target).toBeInViewport();
    await expect.poll(async () => {
      const [a, b] = await Promise.all([cursor.boundingBox(), target.boundingBox()]);
      return a && b ? Math.max(Math.abs(a.x - b.x - b.width / 2), Math.abs(a.y - b.y - b.height / 2)) : Infinity;
    }).toBeLessThan(4);
    await expect(this.page.getByTestId('dispatcher-monitor')).toHaveCount(0);
  }

  async expectDirectorFocus(id: string): Promise<void> {
    await expect(this.page.getByTestId(`director-strategy-${id}`)).toHaveClass(/is-active/, { timeout: STEP_TIMEOUT.director });
  }

  /** Observe short real map stages and hold a real network boundary, never fabricate a plan. */
  async observeDirectorComparison(hold: 'commit' | 'prepare-response'): Promise<void> {
    // Observe the same genuine state frames the application receives. No
    // subscription, fabricated message or additional transport is introduced.
    this.page.on('websocket', socket => {
      if (!/^\/ws\/session\//.test(new URL(socket.url()).pathname)) return;
      socket.on('framereceived', frame => {
        let message: { type?: string; session_id?: string; state?: { dispatcher?: DispatcherState } };
        try { message = JSON.parse(frame.payload.toString()); } catch { return; }
        if (!message || typeof message !== 'object') return;
        const actor = message.state?.dispatcher;
        const comparison = actor?.comparison;
        if (message.type !== 'state' || !actor || comparison?.phase !== 'committed'
          || comparison.session_id !== message.session_id) return;
        const effect = actor.effects?.find(item => item.command_id === comparison.command_id);
        const total = actor.metrics['total_trains'];
        if (!effect || typeof total !== 'number') return;
        const next = { sessionId: comparison.session_id, commandId: comparison.command_id,
          arrived: effect.after.arrived, total, step: effect.after.simulation_steps,
          delay: effect.after.total_arrival_delay, delayDenominator: effect.after.delay_denominator,
          reference: actor.arrival_reference_source ?? null, runStatus: actor.run_status };
        if (JSON.stringify(this.directorOutcomeMeasurements.at(-1)) !== JSON.stringify(next)) {
          this.directorOutcomeMeasurements.push(next);
        }
      });
    });
    await this.page.addInitScript(() => {
      const browser = window as typeof window & {
        directorComparisonFrames?: DirectorComparisonFrame[]; directorOutcomeFrames?: DirectorOutcomeFrame[];
      };
      browser.directorComparisonFrames = [];
      browser.directorOutcomeFrames = [];
      const visible = (element: Element | null): boolean => {
        if (!element) return false;
        const box = element.getBoundingClientRect(), style = getComputedStyle(element);
        return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
          && box.left < innerWidth && box.right > 0 && box.top < innerHeight && box.bottom > 0;
      };
      const bounds = (element: Element | null) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      };
      const numberAttribute = (element: Element | null, attribute: string) => {
        const value = element?.getAttribute(attribute);
        return value == null ? null : Number(value);
      };
      const marks = (prefix: string) => Array.from(document.querySelectorAll(`[data-testid^="${prefix}"]`), element => {
        const circle = Array.from(element.children).find(child => child.localName === 'circle');
        return { handle: element.getAttribute('data-handle'), steps: Number(element.getAttribute('data-steps')),
          x: Number(circle?.getAttribute('cx')), y: Number(circle?.getAttribute('cy')), visible: visible(element) };
      });
      let frame = 0;
      const record = () => {
        frame = 0;
        const map = document.querySelector('[data-testid="flatland-map"]');
        const speech = document.querySelector('[data-testid="dispatcher-activity"]');
        const outcome = document.querySelector('[data-testid="dispatcher-outcome"]');
        if (outcome) {
          const expected = outcome.querySelector('[data-testid="dispatcher-outcome-expected"]');
          const delay = outcome.querySelector('[data-testid="dispatcher-outcome-delay"]');
          const actual = outcome.querySelector('[data-testid="dispatcher-outcome-actual"]');
          const signoff = document.querySelector('[data-testid="dispatcher-outcome-signoff"]');
          const next: DirectorOutcomeFrame = {
            commandId: outcome.getAttribute('data-command-id'), phase: outcome.getAttribute('data-phase'),
            arrived: numberAttribute(outcome, 'data-arrived'), total: numberAttribute(outcome, 'data-total'),
            step: numberAttribute(outcome, 'data-step'),
            expectedArrived: numberAttribute(expected, 'data-arrived'), expectedTotal: numberAttribute(expected, 'data-total'),
            delay: numberAttribute(delay, 'data-delay'), delayDenominator: numberAttribute(delay, 'data-denominator'),
            reference: delay?.getAttribute('data-reference') ?? null,
            text: outcome.textContent ?? '', actualText: actual?.textContent ?? '', visible: visible(outcome),
            mapVisible: visible(map), signoffVisible: visible(signoff),
            summaryPrecedesSignoff: !!actual && !!signoff && !!(actual.compareDocumentPosition(signoff) & Node.DOCUMENT_POSITION_FOLLOWING),
            speechRect: bounds(speech), mapRect: bounds(map),
          };
          if (JSON.stringify(browser.directorOutcomeFrames!.at(-1)) !== JSON.stringify(next)) {
            browser.directorOutcomeFrames!.push(next);
          }
        }
        const bubble = document.querySelector('[data-testid="dispatcher-comparison"]');
        if (!bubble) return;
        const alternativeId = bubble.getAttribute('data-alternative-id');
        const control = alternativeId ? document.querySelector(`[data-testid="director-apply-${alternativeId}"]`) : null;
        const controlRect = control?.getBoundingClientRect();
        const hit = controlRect ? document.elementFromPoint(controlRect.left + controlRect.width / 2,
          controlRect.top + controlRect.height / 2) : null;
        const cursor = document.querySelector('[data-testid="dispatcher-cursor"]');
        const cursorRect = cursor?.getBoundingClientRect();
        const next: DirectorComparisonFrame = {
          stage: bubble.getAttribute('data-stage'), commandId: bubble.getAttribute('data-command-id'),
          token: bubble.getAttribute('data-token'), step: bubble.getAttribute('data-step'),
          alternativeId: bubble.getAttribute('data-alternative-id'), text: bubble.textContent ?? '',
          bubbleVisible: visible(bubble), mapVisible: visible(map), cellSize: Number(map?.getAttribute('data-cell-size')),
          speechRect: bounds(speech), mapRect: bounds(map),
          nativeControlVisible: visible(control) && !!controlRect && controlRect.left >= 0 && controlRect.top >= 0
            && controlRect.right <= innerWidth && controlRect.bottom <= innerHeight,
          nativeControlUncovered: !!control && !!hit && (hit === control || control.contains(hit)),
          cursorTarget: cursor?.getAttribute('data-target') ?? null, cursorVisible: visible(cursor),
          pointerDistance: cursorRect && controlRect ? Math.max(
            Math.abs(cursorRect.left - controlRect.left - controlRect.width / 2),
            Math.abs(cursorRect.top - controlRect.top - controlRect.height / 2)) : null,
          paths: Array.from(document.querySelectorAll('[data-testid^="director-plan-path-"]'), element => ({
            id: element.getAttribute('data-path-id') ?? '', d: element.getAttribute('d') ?? '', visible: visible(element),
            length: element instanceof SVGPathElement ? element.getTotalLength() : 0,
          })),
          reroutes: marks('director-branch-mark-'), holds: marks('director-hold-mark-'),
        };
        if (JSON.stringify(browser.directorComparisonFrames!.at(-1)) !== JSON.stringify(next)) {
          browser.directorComparisonFrames!.push(next);
        }
      };
      new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(record); }).observe(document, {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ['data-stage', 'data-command-id', 'data-token', 'data-step', 'data-alternative-id', 'data-target',
          'data-phase', 'data-arrived', 'data-total', 'data-delay', 'data-denominator', 'data-reference', 'd', 'style'],
      });
    });
    if (hold === 'prepare-response') {
      const gate = new Promise<void>(resolve => { this.releaseComparisonPreparation = resolve; });
      await this.page.route('**/session/*/dispatcher/comparison/prepare', async route => {
        // Fetch the genuine backend response first. Ownership may change while
        // its delivery is delayed; the payload is forwarded byte-for-byte.
        const response = await route.fetch();
        expect(response.ok(), 'Director comparison: preparation accepted').toBe(true);
        this.comparisonPrepared = await response.json() as DispatcherState;
        await gate;
        await route.fulfill({ response });
      });
    } else {
      const commitGate = new Promise<void>(resolve => { this.releaseComparisonCommit = resolve; });
      const resumeGate = new Promise<void>(resolve => { this.releaseComparisonResume = resolve; });
      await this.page.route('**/session/*/dispatcher/comparison/commit', async route => {
        this.comparisonHeldCommit = route.request();
        await commitGate;
        await route.continue();
      });
      await this.page.route('**/session/*/play', async route => {
        if (this.comparisonHeldCommit) {
          this.comparisonHeldResume = route.request();
          await resumeGate;
        }
        await route.continue();
      });
    }
  }

  async heldDirectorComparison(hold: 'commit' | 'prepare-response'): Promise<DirectorComparison> {
    await expect.poll(() => hold === 'commit' ? this.comparisonHeldCommit !== null : this.comparisonPrepared !== null,
      { message: `Director comparison: the real ${hold} boundary was reached`, timeout: STEP_TIMEOUT.director }).toBe(true);
    const actor = await this.dispatcherState();
    const value = (hold === 'prepare-response' ? this.comparisonPrepared?.comparison : actor.comparison) as DirectorComparison;
    expect(value.phase).toBe('ready');
    expect(value.validation?.accepted, 'Director comparison: the actual candidate passed native validation').toBe(true);
    expect(value.token).toEqual(expect.any(String));
    expect(value.session_id).toBe(new URL(this.sessionUrl('Director comparison')).pathname.split('/').at(-1));
    expect(value.command_id).toBe(actor.pending.command_id);
    expect(value.generation).toBe(actor.generation);
    expect(actor.metrics.executed).toBe(1);
    expect(actor.metrics.effective_goal_changes).toBe(0);
    const controller = await this.directorControllerState();
    expect(controller.weights).toEqual(value.current?.weights);
    expect(controller.paths).toEqual(value.current?.paths);
    expect(await this.backendStep('Director comparison hold')).toBe(value.step);
    expect(await this.backendPlaying('Director comparison hold')).toBe(false);
    if (hold === 'commit') {
      expect(this.comparisonHeldCommit!.postDataJSON()).toEqual({ command_id: value.command_id,
        generation: value.generation, token: value.token });
    }
    return value;
  }

  async directorComparisonFrames(): Promise<DirectorComparisonFrame[]> {
    return this.page.evaluate(() =>
      (window as typeof window & { directorComparisonFrames: DirectorComparisonFrame[] }).directorComparisonFrames);
  }

  async directorOutcomeEvidence(): Promise<{ frames: DirectorOutcomeFrame[]; measurements: DirectorOutcomeMeasurement[] }> {
    return { frames: await this.page.evaluate(() =>
      (window as typeof window & { directorOutcomeFrames: DirectorOutcomeFrame[] }).directorOutcomeFrames),
    measurements: [...this.directorOutcomeMeasurements] };
  }

  async expectNoDirectorOutcome(): Promise<void> {
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-outcome')).toHaveCount(0);
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-outcome-signoff')).toHaveCount(0);
  }

  async expectDirectorOutcomeTracking(value: DirectorComparison): Promise<void> {
    const outcome = this.dispatcherMonitor.getByTestId('dispatcher-outcome');
    await expect(outcome).toBeVisible();
    await expect(outcome).toHaveAttribute('data-command-id', value.command_id);
    await expect(outcome).toHaveAttribute('data-phase', 'tracking');
    await expect(outcome).toHaveAttribute('data-arrived', '0');
    await expect(outcome).toHaveAttribute('data-total', String(value.validation!.total));
    await expect(outcome.getByTestId('dispatcher-outcome-actual')).toContainText(/\b0\b/);
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-activity-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-outcome-signoff')).toHaveCount(0);
  }

  private async expectIntermediateDirectorOutcome(value: DirectorComparison, actor: DispatcherState): Promise<void> {
    const effect = actor.effects!.find(item => item.command_id === value.command_id)!;
    const outcome = this.dispatcherMonitor.getByTestId('dispatcher-outcome');
    await expect(outcome).toBeVisible();
    await expect(outcome).toHaveAttribute('data-command-id', value.command_id);
    await expect(outcome).toHaveAttribute('data-phase', 'tracking');
    await expect(outcome).toHaveAttribute('data-arrived', String(effect.after.arrived));
    await expect(outcome).toHaveAttribute('data-total', String(actor.metrics['total_trains']));
    await expect(outcome.getByTestId('dispatcher-outcome-actual')).toContainText(String(effect.after.arrived));
    await expect(outcome.getByTestId('dispatcher-outcome-actual')).toBeInViewport();
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-activity-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-outcome-signoff')).toHaveCount(0);
  }

  private async expectFinalDirectorOutcome(value: DirectorComparison, actor: DispatcherState): Promise<void> {
    const effect = actor.effects!.find(item => item.command_id === value.command_id)!;
    const outcome = this.dispatcherMonitor.getByTestId('dispatcher-outcome');
    const expected = outcome.getByTestId('dispatcher-outcome-expected');
    const actual = outcome.getByTestId('dispatcher-outcome-actual');
    const delay = outcome.getByTestId('dispatcher-outcome-delay');
    const signoff = this.dispatcherMonitor.getByTestId('dispatcher-outcome-signoff');
    await expect(outcome).toBeVisible();
    await expect(outcome).toHaveAttribute('data-command-id', value.command_id);
    await expect(outcome).toHaveAttribute('data-phase', 'complete');
    await expect(outcome).toHaveAttribute('data-arrived', String(effect.after.arrived));
    await expect(outcome).toHaveAttribute('data-total', String(actor.metrics['total_trains']));
    await expect(outcome).toHaveAttribute('data-step', String(effect.after.simulation_steps));
    await expect(expected).toHaveAttribute('data-arrived', String(value.validation!.arrived));
    await expect(expected).toHaveAttribute('data-total', String(value.validation!.total));
    await expect(expected).toContainText(String(value.validation!.arrived));
    await expect(actual).toContainText(String(effect.after.arrived));
    await expect(actual).toBeInViewport();
    expect(effect.after.total_arrival_delay, 'Director outcome: actual native arrivals retain a measured delay').not.toBeNull();
    expect(effect.after.delay_denominator).toBe(effect.after.arrived);
    await expect(delay).toHaveAttribute('data-delay', String(effect.after.total_arrival_delay));
    await expect(delay).toHaveAttribute('data-denominator', String(effect.after.delay_denominator));
    await expect(delay).toHaveAttribute('data-reference', actor.arrival_reference_source!);
    await expect(delay).toContainText(String(effect.after.total_arrival_delay));
    await expect(signoff).toBeInViewport();
    await expect(signoff).toContainText(/Shift’s over!.*cool drinks.*exercise.*family time/s);
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-activity-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(await actual.evaluate((measured, signoffTestId) => {
      const ending = document.querySelector(`[data-testid="${signoffTestId}"]`);
      return !!ending && !!(measured.compareDocumentPosition(ending) & Node.DOCUMENT_POSITION_FOLLOWING);
    }, 'dispatcher-outcome-signoff'), 'Director outcome: observed result comes before the shift sign-off').toBe(true);

    const evidence = await this.directorOutcomeEvidence();
    const linked = evidence.frames.filter(frame => frame.commandId === value.command_id);
    const zero = linked.find(frame => frame.phase === 'tracking' && frame.arrived === 0 && frame.step! > value.step);
    const intermediate = linked.find(frame => frame.phase === 'tracking' && frame.arrived! > 0 && frame.arrived! < frame.total!);
    const complete = linked.filter(frame => frame.phase === 'complete').at(-1);
    expect(zero, 'Director outcome: actual zero arrivals were visible after adoption').toBeTruthy();
    expect(intermediate, 'Director outcome: a genuine intermediate arrival update was visible').toBeTruthy();
    expect(complete, 'Director outcome: completed native measurements were visible').toBeTruthy();
    expect(linked.indexOf(zero!)).toBeLessThan(linked.indexOf(intermediate!));
    expect(linked.indexOf(intermediate!)).toBeLessThan(linked.indexOf(complete!));
    for (const frame of [zero!, intermediate!, complete!]) {
      expect(frame.visible, 'Director outcome: measured progress is visible').toBe(true);
      expect(frame.mapVisible, `Director outcome ${frame.phase}, ${frame.arrived}/${frame.total} at step ${frame.step}: the map remains visible`).toBe(true);
      expect(frame.speechRect!.right, 'Director outcome: speech stays beside the map').toBeLessThanOrEqual(frame.mapRect!.left);
      expect(evidence.measurements.some(measurement => measurement.commandId === value.command_id
        && measurement.sessionId === value.session_id && measurement.step === frame.step
        && measurement.arrived === frame.arrived && measurement.total === frame.total),
      'Director outcome: the rendered count and step match a genuine received native state').toBe(true);
    }
    expect(complete!.summaryPrecedesSignoff).toBe(true);
    expect(complete!.signoffVisible).toBe(true);
    expect(this.comparisonRequests.filter(request => new URL(request.url()).pathname.endsWith('/comparison/prepare'))).toHaveLength(1);
    expect(this.comparisonRequests.filter(request => new URL(request.url()).pathname.endsWith('/comparison/commit'))).toHaveLength(1);
    expect(this.dispatcherControlRequests.filter(request => new URL(request.url()).pathname.endsWith('/play'))).toHaveLength(2);
  }

  async expectDirectorComparisonMapStages(value: DirectorComparison): Promise<void> {
    const frames = await this.directorComparisonFrames();
    const matching = frames.filter(frame => frame.commandId === value.command_id && frame.token === value.token
      && frame.step === String(value.step) && frame.alternativeId === value.alternative?.id);
    const baseline = matching.filter(frame => frame.stage === 'baseline' && frame.paths.length > 0).at(-1);
    const alternative = matching.filter(frame => frame.stage === 'alternative'
      && frame.reroutes.length + frame.holds.length > 0 && frame.paths.length > 0).at(-1);
    expect(baseline, 'Director comparison: a real baseline was drawn before adoption').toBeTruthy();
    expect(alternative, 'Director comparison: the real alternative was drawn before adoption').toBeTruthy();
    expect(frames.indexOf(baseline!)).toBeLessThan(frames.indexOf(alternative!));
    for (const frame of [baseline!, alternative!]) {
      expect(frame.bubbleVisible, `Director ${frame.stage}: existing bubble remains visible`).toBe(true);
      expect(frame.mapVisible, `Director ${frame.stage}: existing map remains visible`).toBe(true);
      expect(frame.speechRect, `Director ${frame.stage}: full bubble geometry was observed`).toBeTruthy();
      expect(frame.mapRect, `Director ${frame.stage}: actual map geometry was observed`).toBeTruthy();
      expect(frame.speechRect!.right, `Director ${frame.stage}: the speech bubble leaves the entire map clear`)
        .toBeLessThanOrEqual(frame.mapRect!.left);
      expect(frame.text.trim()).not.toBe('');
      expect(frame.text).not.toContain('dispatcher.comparison.');
      expect(frame.paths.every(path => path.visible && path.length > 0 && path.d.length > 0)).toBe(true);
    }
    expect(alternative!.nativeControlVisible, 'Director alternative: the actual A control is fully in the viewport').toBe(true);
    expect(alternative!.nativeControlUncovered, 'Director alternative: the native control centre is unobscured').toBe(true);
    expect(alternative!.cursorVisible, 'Director alternative: the real pending command has a visible cursor').toBe(true);
    const weights = value.alternative!.weights;
    expect(alternative!.cursorTarget).toBe(`director:${weights.punctuality}:${weights.connections}:${weights.stability}`);
    expect(alternative!.pointerDistance, 'Director alternative: cursor and native control geometry were captured together').not.toBeNull();
    expect(alternative!.pointerDistance!).toBeLessThan(4);
    const drawable = Object.entries(value.current!.paths!).filter(([, points]) => points.length >= 2).map(([handle]) => `director_line_${handle}`);
    expect(baseline!.paths.map(path => path.id).sort()).toEqual(drawable.sort());
    expect(baseline!.reroutes).toHaveLength(0);
    expect(baseline!.holds).toHaveLength(0);
    const divergence = value.alternative!.divergence!;
    expect(alternative!.reroutes.map(mark => mark.handle).sort()).toEqual(Object.keys(divergence.reroutes).sort());
    expect(alternative!.holds.map(mark => Number(mark.handle)).sort()).toEqual(divergence.holds.map(hold => hold.handle).sort());
    for (const mark of alternative!.reroutes) {
      const point = divergence.reroutes[mark.handle!].branch;
      expect(mark.visible).toBe(true);
      expect(mark.x).toBe((point.col + .5) * alternative!.cellSize);
      expect(mark.y).toBe((point.row + .5) * alternative!.cellSize);
    }
    for (const mark of alternative!.holds) {
      const hold = divergence.holds.find(item => item.handle === Number(mark.handle))!;
      expect(mark.steps).toBe(hold.steps);
      expect(mark.x).toBe((hold.col + .5) * alternative!.cellSize);
      expect(mark.y).toBe((hold.row + .5) * alternative!.cellSize);
    }
    expect(alternative!.paths.some(path => baseline!.paths.find(before => before.id === path.id)?.d !== path.d),
      'Director comparison: the existing map actually draws different geometry').toBe(true);
  }

  releaseHeldDirectorComparison(hold: 'commit' | 'prepare-response' | 'resume'): void {
    if (hold === 'commit') this.releaseComparisonCommit?.();
    if (hold === 'prepare-response') this.releaseComparisonPreparation?.();
    if (hold === 'resume') this.releaseComparisonResume?.();
  }

  releaseAllDirectorComparisonBoundaries(): void {
    this.releaseComparisonPreparation?.(); this.releaseComparisonCommit?.(); this.releaseComparisonResume?.();
  }

  async expectDirectorComparisonInstalled(value: DirectorComparison): Promise<void> {
    await expect.poll(() => this.comparisonHeldResume !== null,
      { message: 'Director comparison: adoption completed before its real Play request', timeout: STEP_TIMEOUT.director }).toBe(true);
    expect(this.comparisonHeldResume!.postDataJSON().comparison_token,
      'Director comparison: automatic Play is bound to the same revocable candidate token').toBe(value.token);
    const response = this.comparisonResponses.find(item => new URL(item.url()).pathname.endsWith('/comparison/commit'))!;
    expect(response.ok(), 'Director comparison: native adoption accepted').toBe(true);
    const accepted = await response.json() as DispatcherState;
    expect(accepted.comparison?.phase).toBe('committed');
    expect(accepted.comparison?.command_id).toBe(value.command_id);
    const controller = await this.directorControllerState();
    expect(controller.weights).toEqual(value.alternative!.weights);
    expect(controller.paths, 'Director comparison: exact displayed native paths were installed').toEqual(value.alternative!.paths);
    expect(await this.backendStep('Director comparison adoption')).toBe(value.step);
    expect(await this.backendPlaying('Director comparison adoption')).toBe(false);
    const actor = await this.dispatcherState();
    expect(actor.metrics.executed).toBe(2);
    expect(actor.events.filter((event: any) => event.kind === 'result' && event.decision?.command_id === value.command_id
      && event.result.status === 'executed')).toHaveLength(1);
    expect(this.comparisonRequests.filter(request => new URL(request.url()).pathname.endsWith('/comparison/commit'))).toHaveLength(1);
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-comparison')).toHaveAttribute('data-stage', 'committed');
  }

  async expectDirectorComparisonResumed(value: DirectorComparison): Promise<void> {
    await this.expectSyntheticPlayback();
    await expect.poll(() => this.backendStep('Director comparison resumed'), { timeout: STEP_TIMEOUT.default }).toBeGreaterThan(value.step);
    await expect.poll(async () => (await this.dispatcherState()).metrics.effective_goal_changes,
      { timeout: STEP_TIMEOUT.director }).toBe(1);
    await this.expectDirectorFocus(value.alternative!.id);
    const actor = await this.dispatcherState();
    expect(actor.events.filter((event: any) => event.kind === 'directive_effective' && event.command_id === value.command_id)).toHaveLength(1);
  }

  /** Let the real scoped Play loop complete the small demo without manual steps or another Pause. */
  async expectDirectorComparisonFinished(value: DirectorComparison, captureProgress: () => Promise<unknown>): Promise<void> {
    let actor: DispatcherState;
    let progressCaptured = false;
    await expect.poll(async () => {
      actor = await this.dispatcherState();
      const effect = actor.effects?.find(item => item.command_id === value.command_id);
      const total = actor.metrics['total_trains'];
      if (!progressCaptured && actor.run_status === 'running' && effect && typeof total === 'number'
        && effect.after.arrived > 0 && effect.after.arrived < total) {
        await this.expectIntermediateDirectorOutcome(value, actor);
        await captureProgress();
        progressCaptured = true;
      }
      return ['finished', 'error', 'aborted'].includes(actor.run_status);
    }, { message: 'Director comparison: the actual three-train run reaches its terminal outcome', timeout: STEP_TIMEOUT.director }).toBe(true);
    expect(actor!.run_status).toBe('finished');
    expect(actor!.metrics['arrived']).toBe(3);
    expect(actor!.metrics['total_trains']).toBe(3);
    expect(actor!.metrics['executed']).toBe(2);
    expect(actor!.metrics['effective_goal_changes']).toBe(1);
    expect(progressCaptured, 'Director outcome: actual intermediate progress was captured during the existing native run').toBe(true);
    await this.expectDispatcherLiveState('finished');
    await this.expectNoDispatcherCursor();
    await this.expectFinalDirectorOutcome(value, actor!);
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-activity'))
      .toContainText(/Shift’s over!.*cool drinks.*exercise.*family time/s);
    expect(await this.backendPlaying('Director comparison finished')).toBe(false);
  }

  async deliverStaleDirectorComparisonAfterTakeover(value: DirectorComparison): Promise<void> {
    const ownership = this.page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `${new URL(this.sessionUrl('Director comparison takeover')).pathname}/dispatcher/ownership`);
    await this.takeOverDispatcher();
    expect((await ownership).ok()).toBe(true);
    await this.expectDispatcherLiveState('human');
    const actor = await this.dispatcherState();
    expect(actor.owner).toBe('human');
    expect(actor.generation).toBeGreaterThan(value.generation);
    expect(actor.pending).toBeNull();
    expect(actor.comparison.phase).toBe('cancelled');
    const delivered = this.page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith('/comparison/prepare'));
    this.releaseHeldDirectorComparison('prepare-response');
    const response = await delivered;
    expect(response.ok(), 'Director comparison: unchanged late preparation response delivered').toBe(true);
    expect((await response.json()).comparison.token).toBe(value.token);
    await response.finished();
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-comparison')).toHaveCount(0);
    await this.expectDispatcherActivity('cancelled');
    await expect(this.page.getByTestId(/^director-plan-path-/)).toHaveCount(0);
    await expect(this.page.getByTestId(/^director-branch-mark-/)).toHaveCount(0);
    await expect(this.page.getByTestId(/^director-hold-mark-/)).toHaveCount(0);
  }

  async expectDirectorComparisonCancelled(value: DirectorComparison, humanWeights: { punctuality: number; connections: number; stability: number }): Promise<void> {
    await this.expectDispatcherLiveState('human');
    // Human takeover removes the comparison presentation. The cancelled
    // command remains in the existing action history and backend audit.
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-comparison')).toHaveCount(0);
    await this.expectNoDirectorOutcome();
    await this.expectDispatcherActivity('cancelled');
    await this.expectNoDispatcherCursor();
    const actor = await this.dispatcherState();
    expect(actor.owner).toBe('human');
    expect(actor.comparison.phase).toBe('cancelled');
    expect(actor.metrics.executed).toBe(1);
    expect(actor.events.some((event: any) => event.kind === 'result' && event.decision?.command_id === value.command_id
      && event.result.status === 'executed')).toBe(false);
    expect((await this.directorControllerState()).weights).toEqual(humanWeights);
    expect(await this.backendPlaying('Director comparison cancelled')).toBe(false);
    expect(this.comparisonRequests.filter(request => new URL(request.url()).pathname.endsWith('/comparison/commit'))).toHaveLength(0);
    expect(this.dispatcherControlRequests.filter(request => new URL(request.url()).pathname.endsWith('/play'))).toHaveLength(1);
  }

  /** Observe real acknowledgement frames while the human watches the native goal control. */
  async observeDirectorAcknowledgement(id: string): Promise<void> {
    await this.dispatcherMonitor.evaluate((overlay, controlTestId) => {
      const browser = window as typeof window & { dispatcherCursorObservations?: DispatcherCursorObservation[] };
      browser.dispatcherCursorObservations = [];
      const rectOf = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      const visible = (element: Element, rect: ReturnType<typeof rectOf>) => {
        const style = getComputedStyle(element);
        return element.getClientRects().length > 0 && rect.width > 0 && rect.height > 0
          && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.display !== 'none'
          && Number(style.opacity) > 0;
      };
      const inViewport = (rect: ReturnType<typeof rectOf>) => rect.x < innerWidth && rect.x + rect.width > 0
        && rect.y < innerHeight && rect.y + rect.height > 0;
      let frame = 0;
      const record = () => {
        frame = 0;
        if (!overlay.isConnected) return;
        const cursor = overlay.querySelector('[data-testid="dispatcher-cursor"]');
        if (!cursor) return;
        const control = document.querySelector(`[data-testid="${controlTestId}"]`);
        if (control) {
          const cursorRect = rectOf(cursor);
          const controlRect = rectOf(control);
          const next = { target: cursor.getAttribute('data-target'), outcome: cursor.getAttribute('data-outcome'),
            controlTestId, cursorRect, controlRect,
            cursorVisible: visible(cursor, cursorRect), controlVisible: visible(control, controlRect),
            cursorInViewport: inViewport(cursorRect), controlInViewport: inViewport(controlRect),
            pointerDistance: Math.max(Math.abs(cursorRect.x - controlRect.x - controlRect.width / 2),
              Math.abs(cursorRect.y - controlRect.y - controlRect.height / 2)) };
          if (JSON.stringify(browser.dispatcherCursorObservations!.at(-1)) !== JSON.stringify(next)) {
            browser.dispatcherCursorObservations!.push(next);
          }
        }
        // Read the actual CSS movement as it renders, without changing either
        // element. Stop as soon as the marker leaves the DOM.
        frame = requestAnimationFrame(record);
      };
      new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(record); }).observe(overlay, {
        subtree: true, childList: true, attributes: true, attributeFilter: ['data-target', 'data-outcome', 'style'],
      });
      frame = requestAnimationFrame(record);
    }, `director-apply-${id}`);
    const control = this.page.getByTestId(`director-apply-${id}`);
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeInViewport();
  }

  async expectDirectorAcknowledgement(id: string, target: string): Promise<void> {
    let observed: DispatcherCursorObservation | undefined;
    await expect.poll(async () => {
      const records = await this.page.evaluate(() =>
        (window as typeof window & { dispatcherCursorObservations: DispatcherCursorObservation[] }).dispatcherCursorObservations);
      observed = records.find(record => record.target === target && record.outcome === 'effective'
        && record.controlTestId === `director-apply-${id}` && record.cursorVisible && record.controlVisible
        && record.cursorInViewport && record.controlInViewport && record.pointerDistance < 4);
      return observed !== undefined;
    }, { message: 'Director: a real effective-goal frame points within 4 px of the visible native control centre' }).toBe(true);
    expect(observed).toMatchObject({ target, outcome: 'effective', controlTestId: `director-apply-${id}`,
      cursorVisible: true, controlVisible: true, cursorInViewport: true, controlInViewport: true });
    expect(observed!.cursorRect.width).toBeGreaterThan(0);
    expect(observed!.controlRect.width).toBeGreaterThan(0);
    expect(observed!.pointerDistance).toBeLessThan(4);
  }

  async expectDirectorGoalSettled(id: string, lastAction: string): Promise<void> {
    await this.expectNoDispatcherCursor();
    await expect(this.page.getByTestId(`director-apply-${id}`)).not.toHaveAttribute('data-dispatcher-highlight', /.+/);
    await expect(this.dispatcherMonitor.getByTestId('dispatcher-activity')).toHaveAttribute('data-anchor', 'map');
    await this.expectDispatcherLastAction(lastAction);
    await this.expectDispatcherActivity('effective');
    await this.expectDirectorFocus(id);
  }

  async directorControllerState(): Promise<any> {
    const response = await this.page.request.get(`${this.sessionUrl('Director controller')}/director`);
    expect(response.ok(), 'Director: committed controller state available').toBe(true);
    return response.json();
  }

  async applyDirectorFocus(id: string): Promise<any> {
    const accepted = this.page.waitForResponse(res => res.request().method() === 'POST'
      && /\/director\/weights$/.test(new URL(res.url()).pathname), { timeout: STEP_TIMEOUT.director });
    await this.page.getByTestId(`director-apply-${id}`).click();
    const response = await accepted;
    expect(response.ok()).toBe(true);
    return response.json();
  }

  async expectNoDispatcherCursor(): Promise<void> {
    await expect(this.page.getByTestId('dispatcher-cursor')).toHaveCount(0);
  }

  async expectDispatcherTrainVisible(handle: number): Promise<void> {
    await expect(this.page.getByTestId(`map-agent-${handle}`).first()).toBeInViewport();
  }

  async showDispatcherTrain(handle: number): Promise<void> {
    await this.page.getByTestId(`map-agent-${handle}`).first().scrollIntoViewIfNeeded();
  }

  async expectSyntheticPlayback(): Promise<void> {
    await expect(this.page.getByTestId('run-pause')).toBeVisible();
  }

  async expectSyntheticEventReached(step: number): Promise<void> {
    await expect.poll(() => this.backendStep('synthetic dispatcher'), { timeout: STEP_TIMEOUT.default }).toBeGreaterThanOrEqual(step);
  }

  async dispatcherState(): Promise<any> {
    const response = await this.page.request.get(`${this.sessionUrl('synthetic dispatcher')}/dispatcher`);
    expect(response.ok()).toBe(true);
    return response.json();
  }

  async exportDispatcher(): Promise<any> {
    const downloaded = this.page.waitForEvent('download');
    await this.dispatcherMonitor.getByTestId('dispatcher-export').click();
    const download = await downloaded;
    return JSON.parse(await readFile((await download.path())!, 'utf8'));
  }

  panel(type: string): Locator {
    return this.page.getByTestId(`panel-${type}`);
  }

  learningSource(slug: string): Locator {
    return this.page.getByTestId(`online-source-${slug}`);
  }

  learningPolicy(slug: string): Locator {
    return this.page.getByTestId(`online-policy-${slug}`);
  }

  sessionSettingsSource(slug: string): Locator {
    return this.page.getByTestId(`session-settings-source-${slug}`);
  }

  sessionSettingsPolicy(slug: string): Locator {
    return this.page.getByTestId(`session-settings-policy-${slug}`);
  }

  async openSessionSettings(): Promise<void> {
    await this.page.getByTestId('shell-menu-trigger').click();
    await this.page.getByTestId('session-settings-open').click();
  }

  async selectSessionSettingsTab(tab: string): Promise<void> {
    await this.page.getByTestId(`session-settings-tab-${tab}`).click();
  }

  async cancelSessionSettings(): Promise<void> {
    await this.page.getByTestId('session-settings-cancel').click();
  }

  async expectDispatcherCommandsDraft(enabled: boolean): Promise<void> {
    const checkbox = this.page.getByTestId('settings-dispatcher-commands');
    if (enabled) await expect(checkbox).toBeChecked();
    else await expect(checkbox).not.toBeChecked();
  }

  async setDispatcherCommandsDraft(enabled: boolean): Promise<void> {
    await this.page.getByTestId('settings-dispatcher-commands').setChecked(enabled);
    await this.expectDispatcherCommandsDraft(enabled);
  }

  async applySessionSettings(): Promise<void> {
    const apply = this.page.getByTestId('settings-apply');
    await expect(apply).toBeEnabled();
    await expect(apply).not.toHaveAttribute('disabled');
    await apply.click();
    await expect(this.page.getByTestId('session-settings-cancel')).toHaveCount(0);
  }

  async configureDispatcherCommands(enabled: boolean): Promise<void> {
    await this.openSessionSettings();
    await this.selectSessionSettingsTab('basic');
    await this.setDispatcherCommandsDraft(enabled);
    await this.applySessionSettings();
  }

  get dispatcherCommandInput(): Locator { return this.page.getByTestId('dispatcher-command-input'); }

  async expectDispatcherCommandEntry(enabled: boolean): Promise<void> {
    if (enabled) await expect(this.dispatcherCommandInput).toBeVisible();
    else await expect(this.dispatcherCommandInput).toHaveCount(0);
  }

  async fillDispatcherCommand(text: string): Promise<void> {
    const input = this.dispatcherCommandInput;
    await expect(input).toBeEditable();
    await input.focus();
    await expect(input).toBeFocused();
    await input.fill(text);
    await expect(input).toHaveValue(text);
  }

  async submitDispatcherCommand(via: 'send' | 'enter' = 'send'): Promise<void> {
    if (via === 'enter') {
      await this.dispatcherCommandInput.press('Enter');
    } else {
      const send = this.page.getByTestId('dispatcher-command-send');
      await expect(send).toBeEnabled();
      await expect(send).not.toHaveAttribute('disabled');
      await send.click();
    }
  }

  async submitDispatcherCommandAndWait(path: 'play' | 'pause' | 'dispatcher/decision' | 'dispatcher/ownership', via: 'send' | 'enter' = 'send'): Promise<Response> {
    const pathname = `${new URL(this.sessionUrl('dispatcher text command')).pathname}/${path}`;
    const accepted = this.page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === pathname, { timeout: STEP_TIMEOUT.default });
    await this.submitDispatcherCommand(via);
    const response = await accepted;
    expect(response.ok(), `dispatcher text command: ${path} accepted`).toBe(true);
    return response;
  }

  async expectDispatcherCommandFeedback(state: 'submitted' | 'unknown' | 'stale' | 'blocked' | 'noop'): Promise<void> {
    await expect(this.page.getByTestId('dispatcher-command-feedback')).toHaveAttribute('data-state', state);
  }

  dispatcherControlRequestCount(): number { return this.dispatcherControlRequests.length; }

  get resetLearningButton(): Locator {
    return this.page.getByTestId('online-reset-to-scratch');
  }

  get startLearningButton(): Locator {
    return this.page.getByTestId('online-start');
  }

  get pauseLearningButton(): Locator {
    return this.page.getByTestId('online-pause');
  }

  get resumeLearningButton(): Locator {
    return this.page.getByTestId('online-resume');
  }

  get stopLearningButton(): Locator {
    return this.page.getByTestId('online-stop');
  }

  get currentTrainingScenario(): Locator {
    return this.page.getByTestId('online-current-scenario');
  }

  get trainingScenarioPool(): Locator {
    return this.page.getByTestId('online-training-scenarios');
  }

  get trainingScenarioEntries(): Locator {
    return this.page.getByTestId('online-training-scenario-entry');
  }

  async openPanel(type: string): Promise<void> {
    const panel = this.panel(type);
    if ((await panel.getAttribute('expanded')) === null) {
      await this.page.getByTestId(`panel-header-${type}`).click();
    }
    await expect(panel).toHaveAttribute('expanded', '');
  }

  async expectAgentDecisionDisclosures(setup: string): Promise<void> {
    for (const group of ['moving', 'waiting', 'done']) {
      const toggle = this.page.getByTestId(`agent-inspector-group-${group}`);
      if ((await toggle.count()) > 0 && (await toggle.getAttribute('aria-expanded')) === 'false') {
        await toggle.click();
      }
    }

    const row = this.page.getByTestId(/^agent-inspector-decision-row-/).first();
    await expect(row, `${setup}: agent decision row`).toBeVisible();
    const rowSummary = row.getByTestId(/^agent-inspector-decision-summary-/);
    const detailsScroller = row.getByTestId(/^agent-inspector-decision-details-/);
    const expertDetails = row.getByTestId(/^agent-inspector-expert-details-/);
    const expertSummary = row.getByTestId(/^agent-inspector-expert-summary-/);
    const expertTableScroller = row.getByTestId(/^agent-inspector-expert-table-scroll-/);

    await expect(row, `${setup}: agent decision starts collapsed`).not.toHaveAttribute('open', '');
    await expect(expertDetails, `${setup}: expert values start collapsed`).not.toHaveAttribute('open', '');
    await rowSummary.click();
    await expect(row, `${setup}: decision details open`).toHaveAttribute('open', '');
    await expect(row.getByTestId(/^agent-inspector-operator-view-/), `${setup}: operator-facing details`).toBeVisible();
    await expect(row.getByTestId(/^agent-inspector-action-table-/), `${setup}: compact action table`).toBeVisible();
    await expect(expertDetails, `${setup}: expert values stay collapsed`).not.toHaveAttribute('open', '');
    await expertSummary.click();
    await expect(expertDetails, `${setup}: expert values open independently`).toHaveAttribute('open', '');
    await expect(detailsScroller, `${setup}: expanded details have a vertical scroll area`).toHaveCSS('overflow-y', 'auto');
    const detailsOverflow = await detailsScroller.evaluate((element) => element.scrollHeight > element.clientHeight);
    expect(detailsOverflow, `${setup}: long decision details scroll within their height`).toBe(true);
    await expect(expertTableScroller, `${setup}: expert table has a horizontal scroll area`).toHaveCSS('overflow-x', 'auto');
    const tableOverflow = await expertTableScroller.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(tableOverflow, `${setup}: wide expert table scrolls horizontally`).toBe(true);
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
    if ((await this.panel('agent-inspector').count()) > 0) {
      const matrix = this.panel('agent-inspector');
      const movingGroup = matrix.getByTestId('agent-inspector-group-moving');
      if ((await movingGroup.count()) > 0) {
        await expect(movingGroup, `${setup}: moving group starts expanded`).toHaveAttribute('aria-expanded', 'true');
        await expect(
          matrix.getByTestId('agent-inspector-group-waiting'),
          `${setup}: waiting group starts expanded`,
        ).toHaveAttribute('aria-expanded', 'true');
        await expect(
          matrix.getByTestId('agent-inspector-group-done'),
          `${setup}: done group starts expanded`,
        ).toHaveAttribute('aria-expanded', 'true');
      }
      const nextPanel = this.panel('agent-inspector')
        .locator('xpath=..')
        .locator('xpath=following-sibling::app-panel-shell[1]');
      await expect(
        nextPanel.getByTestId('panel-online-learning'),
        `${setup}: Learning Monitor must immediately follow Agent Inspector`,
      ).toBeVisible();
      const learningMonitor = this.panel('online-learning');
      const guideFocus = (await learningMonitor.getAttribute('class'))?.includes('layout-panel-shell--guide-focus');
      if (guideFocus) {
        await expect(learningMonitor, `${setup}: the tour opens its focused Learning Monitor`).toHaveAttribute(
          'expanded',
          '',
        );
      } else {
        await expect(learningMonitor, `${setup}: Learning Monitor starts collapsed`).not.toHaveAttribute('expanded', '');
      }
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
   * auto-advance's steps, so the auto-advance can still be stepping while play
   * runs. The check therefore works from the backend: once the server reports the play loop
   * running (`GET /session/<id>/play_status`), it reads the server's step
   * (`GET /session/<id>/state`). From then on, the steps the page itself asks
   * for (`POST /session/<id>/step`, which is how the auto-advance steps) are
   * counted, together with any still in flight at that moment. The counter
   * must rise above the server's step plus all of those, which only a step of
   * the play loop can do.
   *
   * In Director the play must also run on a plan that can drive the trains
   * (`expectDirectorPlan`), unless the setup pins its own policy.
   */
  async playAndExpectSteps(setup: string, mode: InteractionMode, pinnedPolicy?: string): Promise<void> {
    await expect(this.loading, `${setup}: session settles before play`).toHaveCount(0, { timeout: START_TIMEOUT });
    const pause = this.page.getByTestId('run-pause');
    if ((await pause.count()) === 0) {
      await this.page.getByTestId(mode === 'director' ? 'director-start' : 'run-play').click();
    }
    // A tour that pins its policy (`Tour.policy`, the MARL lab tour) runs it in
    // Director too, instead of the Director's planner: no plan to wait for.
    if (mode === 'director' && !pinnedPolicy) await this.expectDirectorPlan(setup);
    if (pinnedPolicy) {
      expect(await this.sessionPolicy(setup), `${setup}: the session runs the tour's policy`).toBe(pinnedPolicy);
    }
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
          message:
            `${setup}: the Director commits a plan after start (GET /session/<id>/director has none after ` +
            `${STEP_TIMEOUT.director / 1000} s)`,
          timeout: STEP_TIMEOUT.director,
        },
      )
      .not.toBeNull();
    // Fails on the Olten and ECML networks: the Director's planner finds no plan.
    expect(
      source,
      `${setup}: the Director's plan source; "unroutable" means the planner found no plan and every train ` +
        `holds`,
    ).not.toBe('unroutable');
  }

  /** `plan.source` from `GET /session/<id>/director`; null while there is no plan. */
  private async directorPlanSource(setup: string): Promise<string | null> {
    const res = await this.page.request.get(`${this.sessionUrl(setup)}/director`);
    if (!res.ok()) return null;
    const body = (await res.json()) as { plan?: { source?: string } | null };
    return body.plan?.source ?? null;
  }

  /** The policy the last created session runs (`GET /session/<id>/lab/review`). */
  async sessionPolicy(setup: string): Promise<string> {
    const res = await this.page.request.get(`${this.sessionUrl(setup)}/lab/review?outcomes=false`);
    expect(res.ok(), `${setup}: GET /session/<id>/lab/review`).toBe(true);
    return ((await res.json()) as { policy: string }).policy;
  }

  /** The tour toolbar's "finish mode" button; with the survey on, it opens the survey. */
  async finishTourMode(): Promise<void> {
    await this.page.getByTestId('run-finish-mode').click();
  }

  survey(): Locator {
    return this.page.getByTestId('survey');
  }
}

/**
 * The MARL lab tour (docs/plans/marl-lab-tour.md): the guide strip over three
 * runs, the train list and inspector to step in, and the debrief's training
 * section.
 */
export class LabTour {
  readonly debrief: Locator;
  readonly train: Locator;

  constructor(private readonly page: Page) {
    this.debrief = page.getByTestId('tour-debrief');
    this.train = page.getByTestId('lab-train');
  }

  guideStep(id: string): Locator {
    return this.page.getByTestId(`tour-guide-step-${id}`);
  }

  async expectStepDone(setup: string, id: string): Promise<void> {
    await expect(this.guideStep(id), `${setup}: guide step "${id}" ticked`).toHaveClass(/\bis-done\b/);
  }

  async endShift(): Promise<void> {
    await this.page.getByTestId('tour-guide-end-shift').click();
    await expect(this.debrief).toBeVisible();
  }

  async pause(): Promise<void> {
    const pause = this.page.getByTestId('run-pause');
    if (await pause.count()) await pause.click();
    await expect(this.page.getByTestId('run-play')).toBeVisible();
  }

  /**
   * Step one at a time until the inspector offers `action` for the selected
   * train (its next switch), then choose it. The tour's scenario reaches the
   * Weesen switch within a few dozen steps.
   */
  async stepIn(setup: string, handle: number, action: number, maxSteps = 60): Promise<void> {
    await this.page.getByTestId(`train-row-${handle}`).click();
    const option = this.page.getByTestId(`inspector-option-${action}`);
    const step = this.page.getByTestId('run-step-1');
    for (let i = 0; i < maxSteps && (await option.count()) === 0; i++) {
      await expect(step).toBeEnabled();
      const answered = this.page.waitForResponse((r) => /\/session\/[^/]+\/step$/.test(new URL(r.url()).pathname));
      await step.click();
      await answered;
    }
    await expect(option, `${setup}: train ${handle} reaches a switch with option ${action}`).toBeVisible();
    const accepted = this.page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith(`/agent/${handle}/override`));
    await option.click();
    const response = await accepted;
    expect(response.ok(), `${setup}: train ${handle} human override accepted before advancing`).toBe(true);
    expect(response.request().postDataJSON()).toMatchObject({ action, owner: 'human' });
    expect(await response.json()).toMatchObject({ handle, action });
  }

  /** "Step 50" until the episode ends and the debrief opens. */
  async runToEnd(setup: string): Promise<void> {
    const step = this.page.getByTestId('run-step-50');
    for (let i = 0; i < 10 && !(await this.debrief.isVisible()); i++) {
      const answered = this.page.waitForResponse((r) => /\/session\/[^/]+\/step$/.test(new URL(r.url()).pathname));
      await step.click();
      await answered;
    }
    await expect(this.debrief, `${setup}: the debrief opens at the end of the run`).toBeVisible();
  }

  /** The debrief's main button: the next section, run or overview. */
  async next(): Promise<void> {
    await this.page.getByTestId('tour-debrief-next').click();
  }

  /** Train with the preset knob and wait for the check rows. */
  async trainAndExpectCheck(setup: string): Promise<void> {
    await expect(this.page.getByTestId('lab-train-interventions'), `${setup}: the intervention is listed`).toBeVisible();
    await this.page.getByTestId('lab-train-start').click();
    await expect(this.page.getByTestId('lab-train-check'), `${setup}: the check after training`).toBeVisible({
      timeout: 60_000,
    });
  }
}
