import { readFile } from 'node:fs/promises';
// Page objects: one class per screen, wrapping its `data-testid` locators.
//
// Every locator is a test id. Visible labels change with the language, and
// `getByRole` does not see SBB Lyne buttons (Lyne sets the role through
// ElementInternals), so neither is used.
import { expect, type Locator, type Page, type Request, type Response, type WebSocketRoute } from '@playwright/test';

import type { InteractionMode } from './app-data';
import { expectedPanels, type LayoutRef } from './panel-expectations';

export type Door = 'introduction' | 'build' | 'experiments';
export interface DispatcherProposalRef { command_id: string; generation: number; }

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

  async startPreparedDispatcherDemo(mode: 'recommendation' | 'director' | 'team'): Promise<Response> {
    const created = sessionCreated(this.page, `prepared ${mode} dispatcher`);
    // A connected socket precedes the opening steps. Wait for the actual
    // automatic Play acknowledgement before asserting the playback controls.
    const playing = this.page.waitForResponse(res => res.request().method() === 'POST'
      && /\/session\/[^/]+\/play$/.test(new URL(res.url()).pathname), { timeout: START_TIMEOUT });
    await this.page.getByTestId(`dispatcher-demo-start-${mode}`).click();
    const response = await created;
    expect((await playing).ok(), `prepared ${mode}: automatic playback accepted`).toBe(true);
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
  private dispatcherConnection: { client: WebSocketRoute; server: WebSocketRoute } | null = null;
  private dispatcherUpdatesDisconnected = false;

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
    await expect(cursor).toHaveAttribute('data-target', targetKey);
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
    await option.click();
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
