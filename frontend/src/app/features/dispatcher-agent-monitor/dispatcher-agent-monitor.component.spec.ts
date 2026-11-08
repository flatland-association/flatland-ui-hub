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
  const targetKey = 'strategy:pp:group';

  beforeEach(() => {
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

});
