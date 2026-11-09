import { DirectorComparison } from '../../core/models';
import { DirectorComparisonService } from '../../core/director-comparison.service';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ApiService } from '../../core/api.service';
import { DispatcherActivityService } from '../../core/dispatcher-activity.service';
import { DispatcherCommandsService } from '../../core/dispatcher-commands.service';
import { DEFAULT_DISPATCHER, DispatcherDecision, DispatcherState } from '../../core/dispatcher';
import { DispatcherTargets } from '../../core/dispatcher-target.directive';
import { TrainIdentityService } from '../../core/train-identity.service';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { DispatcherAgentMonitorComponent } from './dispatcher-agent-monitor.component';

describe('DispatcherAgentMonitor native control clearance', () => {
  let fixture: ComponentFixture<DispatcherAgentMonitorComponent>;
  let toolbar: HTMLDivElement;
  let takeover: HTMLButtonElement;
  let target: HTMLButtonElement;
  let bubble: HTMLElement;
  let actor: WritableSignal<DispatcherState>;
  let release: (() => void)[];
  let extra: HTMLElement[];
  const targetKey = 'strategy:pp:group';

  beforeEach(() => {
    extra = [];
    const pending: DispatcherDecision = {
      command_id: 'proposal', generation: 0, observed_at: 18, due: 18,
      command: { kind: 'strategy', strategy: 'pp', handles: [0, 1], contention_id: 'group' },
      reason: { rule: 'preferred_strategy', fallback: null },
    };
    const snapshot: DispatcherState = {
      mode: 'recommendation', operator_type: 'human_dispatcher_team', owner: 'agent', profile: 'baseline',
      config: DEFAULT_DISPATCHER, status: 'planned', logical_time: 18, generation: 0, run_status: 'running',
      abort_reason: null, requires_approval: true, awaiting_approval: true, pending,
      observation: null, metrics: {}, events: [],
    };
    actor = signal(snapshot);
    TestBed.configureTestingModule({
      imports: [DispatcherAgentMonitorComponent],
      providers: [
        ...provideTranslocoTesting(),
        { provide: ApiService, useValue: {} },
        { provide: DirectorComparisonService, useValue: { enabled: signal(false), snapshot: signal(null), stage: signal('idle'), counts: signal({ reroutes: 0, holds: 0 }), forecast: signal([]) } },
        { provide: TrainIdentityService, useValue: { nameFor: (handle: number) => `Train${handle}` } },
        { provide: DispatcherCommandsService, useValue: { enabled: signal(false) } },
        { provide: DispatcherActivityService, useValue: {
          store: { dispatcher: actor, session: signal({ id: 'shift' }), dispatcherControlPending: signal(null) },
          activity: signal({ stage: 'awaiting_approval', commandId: 'proposal', targetKey,
            message: 'awaiting_approval_strategy', params: { action: 'Replan with PP' } }),
          displayAction: signal({ stage: 'observing' }),
          interactionTarget: signal({ stage: 'awaiting_approval', commandId: 'proposal', targetKey, pending: true }),
          assessment: signal(null),
          live: signal({ state: 'awaiting_approval', step: 18, seconds: 0, confirmed: true, revision: 1,
            paused: false, busy: false, controlPending: null, progress: null, planningSeconds: null }),
          proposal: signal({ pending, state: 'awaiting_approval' }), isTeam: signal(true), neutralTeam: signal(false),
          logOpen: signal(false),
        } },
      ],
    });
    toolbar = document.createElement('div');
    toolbar.style.cssText = 'position:fixed;left:0;top:80px;width:100vw;height:92px;';
    takeover = document.createElement('button');
    takeover.textContent = 'Human takes over';
    takeover.style.cssText = 'position:absolute;right:100px;top:10px;width:136px;height:30px;';
    toolbar.append(takeover);
    target = document.createElement('button');
    target.textContent = 'Apply PP';
    target.style.cssText = `position:fixed;left:${innerWidth - 70}px;top:${Math.min(420, innerHeight - 100)}px;width:48px;height:22px;`;
    document.body.append(toolbar, target);
    const targets = TestBed.inject(DispatcherTargets);
    release = [targets.register('toolbar', toolbar), targets.register(targetKey, target)];
    fixture = TestBed.createComponent(DispatcherAgentMonitorComponent);
    fixture.detectChanges();
    bubble = fixture.nativeElement.querySelector('[data-testid="dispatcher-activity"]');
  });

  afterEach(() => {
    fixture.destroy();
    release.forEach(unregister => unregister());
    toolbar.remove(); target.remove();
    extra.forEach(element => element.remove());
  });

  const position = () => {
    // Exercise the actual component's geometry against native browser rectangles.
    (fixture.componentInstance as unknown as { positionOverlay(): void }).positionOverlay();
    fixture.detectChanges();
  };

  it('keeps the native takeover button clickable with the trace-sized proposal bubble', () => {
    bubble.style.height = '304px';
    position();
    const control = takeover.getBoundingClientRect();
    const speech = bubble.getBoundingClientRect();
    expect(document.elementFromPoint(control.left + control.width / 2, control.top + control.height / 2)).toBe(takeover);
    expect(speech.top).toBeGreaterThanOrEqual(toolbar.getBoundingClientRect().bottom + 8);
    const anchor = target.getBoundingClientRect();
    const cursor = fixture.componentInstance.position();
    expect(cursor.cursor).toBeTrue();
    expect(cursor.target).toBe(targetKey);
    expect(cursor.cursorX).toBe(anchor.left + anchor.width / 2);
    expect(cursor.cursorY).toBe(anchor.top + anchor.height / 2);
  });

  it('fits expanded content below the toolbar while the bubble scrolls internally', () => {
    actor.update(current => ({ ...current, queue: Array.from({ length: 12 }, (_, index) => ({
      contention_id: index === 0 ? 'group' : `group-${index}`, handles: [0, 1],
      location: { name: `Corridor ${index}` }, forecast_step: 20 + index,
      status: index === 0 ? 'pending' : 'queued',
    })) }));
    fixture.componentInstance.activityOpen.set(true);
    fixture.detectChanges();
    position();
    const speech = bubble.getBoundingClientRect();
    expect(speech.top).toBeGreaterThanOrEqual(toolbar.getBoundingClientRect().bottom + 8);
    expect(speech.bottom).toBeLessThanOrEqual(innerHeight - 56);
    expect(getComputedStyle(bubble).overflowY).toBe('auto');
    expect(bubble.scrollHeight).toBeGreaterThan(bubble.clientHeight);
    const control = takeover.getBoundingClientRect();
    expect(document.elementFromPoint(control.left + control.width / 2, control.top + control.height / 2)).toBe(takeover);
  });

  it('shows named assessment context and forecast comparison without opening Details', () => {
    const source = fixture.componentInstance.source;
    (source.assessment as WritableSignal<ReturnType<typeof source.assessment>>).set({
      commandId: 'kept', contentionId: 'group', choice: 'maintain', action: 'Keep the current strategy', pending: false,
      stage: 'executed', handles: [0, 1], location: 'PF station', forecastStep: 18, comparison: 'better', reasonKey: 'better', count: 3,
      selectedScore: 8, otherScore: 12, otherAction: 'Replan with PP',
      comparisonMetric: 'lateness', selectedMetric: 8, otherMetric: 12,
    });
    fixture.detectChanges();
    const assessment = bubble.querySelector('[data-testid="dispatcher-assessment"]')!;
    expect(assessment.getAttribute('data-choice')).toBe('maintain');
    expect(assessment.getAttribute('data-command-id')).toBe('kept');
    expect(assessment.getAttribute('data-contention-id')).toBe('group');
    expect(assessment.getAttribute('data-stage')).toBe('executed');
    expect(assessment.querySelector('[data-testid="dispatcher-assessment-context"]')!.textContent).toContain('Train0 · Train1');
    expect(assessment.querySelector('[data-testid="dispatcher-assessment-context"]')!.textContent).toContain('PF station');
    expect(assessment.querySelector('[data-testid="dispatcher-assessment-reason"]')!.textContent).toContain('Compared 3 forecasts');
    expect(assessment.querySelector('[data-testid="dispatcher-assessment-comparison"]')!.textContent).toContain('8 vs 12');
    expect(assessment.querySelector('[data-testid="dispatcher-assessment-forecast"]')!.getAttribute('data-step')).toBe('18');
    expect(assessment.textContent).not.toContain('dispatcher.assessment.');
    expect(fixture.componentInstance.activityOpen()).toBeFalse();
  });

  it('does not reveal completed historical targets and clears expired markers from the map', () => {
    const source = fixture.componentInstance.source;
    const marker = source.interactionTarget as WritableSignal<ReturnType<typeof source.interactionTarget>>;
    marker.set({ ...marker()!, pending: false });
    const scroll = spyOn(target, 'scrollIntoView');
    position();
    expect(scroll).not.toHaveBeenCalled();
    expect(fixture.componentInstance.position().cursor).toBeTrue();
    marker.set(null);
    position();
    expect(fixture.componentInstance.position().cursor).toBeFalse();
    expect(fixture.componentInstance.position().target).toBe('map');
    expect(fixture.nativeElement.querySelector('[data-testid="dispatcher-cursor"]')).toBeNull();
  });

  it('reveals an actually pending target only once per command', () => {
    (fixture.componentInstance as unknown as { revealed: string }).revealed = '';
    const scroll = spyOn(target, 'scrollIntoView');
    position();
    position();
    expect(scroll).toHaveBeenCalledTimes(1);
  });


  it('separates checked execution from candidate forecasts without inventing a baseline delta', () => {
    const comparison = fixture.componentInstance.comparison;
    (comparison.enabled as WritableSignal<boolean>).set(true);
    (comparison.stage as WritableSignal<string>).set('alternative');
    (comparison.snapshot as WritableSignal<DirectorComparison | null>).set({
      phase: 'ready', session_id: 'shift', command_id: 'checked', generation: 0, step: 18, token: 'exact',
      validation: { accepted: true, reason: 'verified', arrived: 8, total: 8 },
      alternative: { id: 'focus_delay' } as DirectorComparison['alternative'],
    });
    (comparison.counts as WritableSignal<{ reroutes: number; holds: number }>).set({ reroutes: 2, holds: 0 });
    (comparison.forecast as WritableSignal<{ axis: 'punctuality'; before: number | null; after: number }[]>).set([
      { axis: 'punctuality', before: null, after: 91 },
    ]);
    fixture.detectChanges();
    const block = bubble.querySelector('[data-testid="dispatcher-comparison"]')!;
    expect(block.getAttribute('data-stage')).toBe('alternative');
    expect(block.getAttribute('data-command-id')).toBe('checked');
    expect(block.getAttribute('data-token')).toBe('exact');
    expect(block.querySelector('[data-testid="dispatcher-comparison-differences"]')!.textContent).toContain('Different routes: 2');
    expect(block.querySelector('[data-testid="dispatcher-comparison-validation"]')!.textContent).toContain('8 / 8 trains arrived');
    expect(block.textContent).toContain('Future scripted incidents are excluded');
    expect(block.textContent).toContain('Candidate forecast');
    expect(block.textContent).not.toContain('→');
  });

  function comparisonMap(stage: 'preparing' | 'baseline' | 'alternative' | 'committing', left = 290): HTMLElement {
    const comparison = fixture.componentInstance.comparison;
    (comparison.enabled as WritableSignal<boolean>).set(true);
    (comparison.stage as WritableSignal<string>).set(stage);
    (comparison.snapshot as WritableSignal<DirectorComparison | null>).set({
      phase: 'ready', session_id: 'shift', command_id: 'comparison', generation: 0, step: 18, token: 'exact',
    });
    const source = fixture.componentInstance.source;
    (source.live as WritableSignal<ReturnType<typeof source.live>>).update(value => ({ ...value, state: 'paused', paused: true }));
    const map = document.createElement('div');
    map.style.cssText = `position:fixed;left:${left}px;top:200px;width:572px;height:180px;`;
    document.body.append(map); extra.push(map);
    release.push(TestBed.inject(DispatcherTargets).register('map', map));
    return map;
  }

  it('keeps comparison speech in the existing left gutter without covering map geometry or the toolbar', () => {
    const map = comparisonMap('baseline');
    position();
    const speech = bubble.getBoundingClientRect();
    const geometry = map.getBoundingClientRect();
    expect(speech.left).toBe(12);
    expect(speech.width).toBe(266);
    expect(speech.right).toBeLessThanOrEqual(geometry.left - 12);
    expect(speech.top).toBeGreaterThanOrEqual(toolbar.getBoundingClientRect().bottom + 8);
    expect(document.elementFromPoint(geometry.left + geometry.width / 2, geometry.top + 80)).toBe(map);
    expect(fixture.componentInstance.position().cursor).toBeFalse();
  });

  for (const stage of ['alternative', 'committing'] as const) {
    it(`reveals the real pending native control once while comparison ${stage} holds simulation time`, () => {
      const map = comparisonMap(stage);
      const source = fixture.componentInstance.source;
      const nativeKey = 'director:5:2:2';
      (source.interactionTarget as WritableSignal<ReturnType<typeof source.interactionTarget>>).set({
        ...source.interactionTarget()!, commandId: 'comparison', targetKey: nativeKey, pending: true,
      });
      release.push(TestBed.inject(DispatcherTargets).register(nativeKey, target));
      const panel = document.createElement('div');
      panel.style.cssText = `position:fixed;left:${innerWidth - 310}px;top:190px;width:300px;height:${Math.max(96, Math.min(220, innerHeight - 260))}px;overflow:auto;`;
      target.style.cssText = 'position:absolute;left:20px;top:600px;width:140px;height:32px;';
      target.disabled = true;
      panel.append(target); document.body.append(panel); extra.push(panel);
      const scroll = spyOn(target, 'scrollIntoView').and.callThrough();
      position(); position();
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(panel.scrollTop).toBeGreaterThan(0);
      const control = target.getBoundingClientRect();
      const cursor = fixture.componentInstance.position();
      expect(control.top).toBeGreaterThanOrEqual(panel.getBoundingClientRect().top);
      expect(control.bottom).toBeLessThanOrEqual(panel.getBoundingClientRect().bottom);
      expect(cursor.cursor).toBeTrue();
      expect(cursor.target).toBe(nativeKey);
      expect(cursor.cursorX).toBe(control.left + control.width / 2);
      expect(cursor.cursorY).toBe(control.top + control.height / 2);
      expect(bubble.getBoundingClientRect().right).toBeLessThanOrEqual(map.getBoundingClientRect().left - 12);
    });
  }

  it('uses ordinary bubble geometry when comparison has no readable left gutter', () => {
    comparisonMap('baseline', 110);
    position();
    expect(fixture.componentInstance.position().width).toBe(350);
  });

  it('retains ordinary bubble width even when a left map gutter is available', () => {
    const map = document.createElement('div');
    map.style.cssText = 'position:fixed;left:290px;top:200px;width:572px;height:180px;';
    document.body.append(map); extra.push(map);
    release.push(TestBed.inject(DispatcherTargets).register('map', map));
    position();
    expect(fixture.componentInstance.position().width).toBe(350);
  });

  for (const example of [
    { stage: 'preparing', state: 'planning', title: 'Checking one alternative' },
    { stage: 'baseline', state: 'observing', title: 'Current plan on the map' },
    { stage: 'alternative', state: 'observing', title: 'Alternative on the map' },
    { stage: 'committing', state: 'acting', title: 'Adopting the checked plan' },
  ] as const) {
    it(`shows the real ${example.stage} workflow in the main status and portrait while simulation is held`, () => {
      comparisonMap(example.stage);
      fixture.detectChanges();
      const header = bubble.querySelector('[data-testid="dispatcher-live-state"]')!;
      expect(header.textContent).toBe(example.title);
      expect(header.getAttribute('data-state')).toBe(example.state);
      expect(bubble.querySelector('[data-testid="dispatcher-avatar"]')!.getAttribute('data-state')).toBe(example.state);
      expect(bubble.querySelector('[data-testid="dispatcher-comparison-held"]')!.textContent).toContain('simulation is held');
      expect(bubble.querySelector('[data-testid="dispatcher-comparison"]')!.textContent).not.toContain(example.title);
      expect(bubble.textContent!.split(example.title).length - 1).toBe(1);
      expect(fixture.componentInstance.live().state).toBe('paused');
    });
  }

  for (const stage of ['waiting', 'unavailable', 'cancelled'] as const) {
    it(`preserves physical status when comparison is ${stage}`, () => {
      comparisonMap('baseline');
      (fixture.componentInstance.comparison.stage as WritableSignal<string>).set(stage);
      fixture.detectChanges();
      expect(bubble.querySelector('[data-testid="dispatcher-live-state"]')!.textContent).toBe('Paused');
      expect(bubble.querySelector('[data-testid="dispatcher-avatar"]')!.getAttribute('data-state')).toBe('paused');
    });
  }

  it('preserves the ordinary paused header when no comparison is active', () => {
    const source = fixture.componentInstance.source;
    (source.live as WritableSignal<ReturnType<typeof source.live>>).update(value => ({ ...value, state: 'paused', paused: true }));
    fixture.detectChanges();
    expect(bubble.querySelector('[data-testid="dispatcher-live-state"]')!.textContent).toBe('Paused');
    expect(bubble.querySelector('[data-testid="dispatcher-live-message"]')!.textContent).toBe('The simulation is paused.');
  });

  it('does not hide a connection loss behind comparison preparation', () => {
    comparisonMap('preparing');
    const source = fixture.componentInstance.source;
    (source.live as WritableSignal<ReturnType<typeof source.live>>).update(value => ({ ...value, state: 'offline' }));
    fixture.detectChanges();
    expect(bubble.querySelector('[data-testid="dispatcher-live-state"]')!.textContent).toBe('Connection lost');
    expect(bubble.querySelector('[data-testid="dispatcher-avatar"]')!.getAttribute('data-state')).toBe('offline');
  });

});
