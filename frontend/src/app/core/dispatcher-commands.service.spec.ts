import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_DISPATCHER, DispatcherState } from './dispatcher';
import { DISPATCHER_COMMANDS_STORAGE_KEY, DispatcherCommandsService } from './dispatcher-commands.service';
import { SessionStore } from './session.store';

function actor(overrides: Partial<DispatcherState> = {}): DispatcherState {
  return {
    mode: 'recommendation', operator_type: 'human_dispatcher_team', owner: 'synthetic', profile: 'baseline',
    config: structuredClone(DEFAULT_DISPATCHER), status: 'planned', logical_time: 4, generation: 3,
    run_status: 'running', abort_reason: null, requires_approval: true, awaiting_approval: true,
    approved_command_id: null,
    pending: { command_id: 'session-1:g3-d2', generation: 3, observed_at: 4, due: 4,
      command: { kind: 'strategy', strategy: 'pp' }, reason: { rule: 'preferred_strategy', fallback: null } },
    observation: null, metrics: { executed: 0 }, events: [], ...overrides,
  };
}

function mockStore() {
  const pending = signal<string | null>(null);
  return {
    session: signal<{ id: string } | null>({ id: 'session-1' }), dispatcher: signal<DispatcherState | null>(actor()),
    dispatcherControlPending: pending, backendBusy: signal(false), loading: signal(false),
    sessionCreating: signal(false), sessionOpening: signal(false), playing: signal(false),
    episodeDone: signal(false), activePolicy: signal('goal_directed'),
    pause: jasmine.createSpy('pause').and.callFake(() => pending.set('pause')),
    play: jasmine.createSpy('play').and.callFake(() => pending.set('play')),
    dispatcherDecision: jasmine.createSpy('dispatcherDecision').and.callFake(() => pending.set('decision')),
    dispatcherOwnership: jasmine.createSpy('dispatcherOwnership').and.callFake(() => pending.set('ownership')),
  };
}

describe('DispatcherCommandsService', () => {
  let service: DispatcherCommandsService;
  let store: ReturnType<typeof mockStore>;
  const feedback = (kind: string) => ({ key: `dispatcher.commands.feedback.${kind}` });
  const type = (text: string) => { service.focus(); service.updateDraft(text); };
  const submit = (text: string) => { type(text); service.submit(); };
  const expectNoRequests = () => {
    expect(store.pause).not.toHaveBeenCalled();
    expect(store.play).not.toHaveBeenCalled();
    expect(store.dispatcherDecision).not.toHaveBeenCalled();
    expect(store.dispatcherOwnership).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    localStorage.removeItem(DISPATCHER_COMMANDS_STORAGE_KEY);
    store = mockStore();
    TestBed.configureTestingModule({ providers: [{ provide: SessionStore, useValue: store }] });
    service = TestBed.inject(DispatcherCommandsService);
    TestBed.tick();
  });
  afterEach(() => localStorage.removeItem(DISPATCHER_COMMANDS_STORAGE_KEY));

  it('defaults off and does not accept typing or dispatch commands until explicitly enabled', () => {
    expect(service.enabled()).toBeFalse();
    service.updateDraft('pause');
    service.submit();
    expect(service.draft()).toBe('');
    expect(service.feedback()).toEqual(feedback('blocked'));
    expectNoRequests();
  });

  it('persists only the explicit browser preference and restores it in a fresh service', () => {
    service.setEnabled(true);
    type('private dictated words');
    expect(localStorage.getItem(DISPATCHER_COMMANDS_STORAGE_KEY)).toBe('true');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: SessionStore, useValue: store }] });
    service = TestBed.inject(DispatcherCommandsService);
    expect(service.enabled()).toBeTrue();
    expect(service.draft()).toBe('');
    service.setEnabled(false);
    expect(localStorage.getItem(DISPATCHER_COMMANDS_STORAGE_KEY)).toBe('false');
  });

  it('keeps explicit opt-in usable when browser preference storage is unavailable', () => {
    spyOn(Storage.prototype, 'setItem').and.throwError('unavailable');
    service.setEnabled(true);
    expect(service.enabled()).toBeTrue();
    service.setEnabled(false);
    expect(service.enabled()).toBeFalse();
  });

  it('never executes on focus, typing, paste-like updates or blur-independent edits', () => {
    service.setEnabled(true);
    type('Freigeben');
    service.updateDraft('approve proposal');
    expect(service.draft()).toBe('approve proposal');
    expect(service.feedback()).toBeNull();
    expectNoRequests();
  });

  it('rejects unknown/negated commands without losing their original context', () => {
    service.setEnabled(true);
    submit('do not pause');
    expect(service.feedback()).toEqual(feedback('unknown'));
    expect(service.draft()).toBe('do not pause');
    expectNoRequests();
  });

  for (const decision of ['approve', 'decline'] as const) {
    it(`submits ${decision} for the captured proposal without playing or inventing an acknowledgement`, () => {
      service.setEnabled(true);
      submit(decision);
      expect(store.dispatcherDecision).toHaveBeenCalledOnceWith('session-1:g3-d2', 3, decision);
      expect(store.play).not.toHaveBeenCalled();
      expect(store.playing()).toBeFalse();
      expect(store.dispatcher()!.awaiting_approval).toBeTrue();
      expect(store.dispatcher()!.metrics['executed']).toBe(0);
      expect(service.feedback()).toEqual(feedback('submitted'));
      expect(service.draft()).toBe('');
      expect(service.busy()).toBeTrue();
      type(decision);
      service.submit();
      expect(service.feedback()).toEqual(feedback('blocked'));
      expect(store.dispatcherDecision).toHaveBeenCalledTimes(1);
    });
  }

  for (const replacement of [
    { command_id: 'replacement', generation: 3 }, { command_id: 'session-1:g3-d2', generation: 4 },
  ]) {
    it(`never retargets drafted consent after proposal replacement ${JSON.stringify(replacement)}`, () => {
      service.setEnabled(true);
      type('approve');
      const old = store.dispatcher()!;
      store.dispatcher.set({ ...old, generation: replacement.generation,
        pending: { ...old.pending!, ...replacement } });
      service.focus(); // Refocusing existing text must not recapture a new proposal.
      service.submit();
      expect(service.feedback()).toEqual(feedback('stale'));
      expect(service.draft()).toBe('approve');
      expectNoRequests();
      service.updateDraft('');
      type('approve');
      service.submit();
      expect(store.dispatcherDecision).toHaveBeenCalledOnceWith(replacement.command_id, replacement.generation, 'approve');
    });
  }

  it('captures absence at focus instead of approving a proposal that arrives while dictating', () => {
    store.dispatcher.set(actor({ pending: null, awaiting_approval: false }));
    service.setEnabled(true);
    service.focus();
    service.updateDraft('approve');
    store.dispatcher.set(actor());
    service.submit();
    expect(service.feedback()).toEqual(feedback('stale'));
    expectNoRequests();
  });

  it('captures the first edit even when dictation inserts text without a preceding focus callback', () => {
    service.setEnabled(true);
    service.updateDraft('approve');
    service.submit();
    expect(store.dispatcherDecision).toHaveBeenCalledOnceWith('session-1:g3-d2', 3, 'approve');
  });

  it('clears text, feedback and context on opt-out and requires new intent after re-enabling', () => {
    service.setEnabled(true);
    type('approve');
    service.setEnabled(false);
    expect(service.draft()).toBe('');
    expect(service.feedback()).toBeNull();
    store.dispatcher.set(actor({ generation: 4, pending: { ...actor().pending!, command_id: 'fresh', generation: 4 } }));
    service.setEnabled(true);
    service.submit();
    expectNoRequests();
    type('approve');
    service.submit();
    expect(store.dispatcherDecision).toHaveBeenCalledOnceWith('fresh', 4, 'approve');
  });

  it('clears on a session change without approving a new session proposal', () => {
    service.setEnabled(true);
    type('approve');
    store.session.set({ id: 'session-2' });
    store.dispatcher.set(actor());
    TestBed.tick();
    expect(service.draft()).toBe('');
    expect(service.feedback()).toBeNull();
    service.submit();
    expectNoRequests();
  });

  it('also rejects the old draft if submit races before the session-change effect runs', () => {
    service.setEnabled(true);
    type('resume');
    store.session.set({ id: 'session-2' });
    service.submit();
    expect(service.draft()).toBe('');
    expectNoRequests();
  });

  it('allows Pause during actual playback and backend computation, while preventing a second pending request', () => {
    service.setEnabled(true);
    store.playing.set(true);
    store.backendBusy.set(true);
    store.loading.set(true);
    store.sessionOpening.set(true);
    submit('Pause');
    expect(store.pause).toHaveBeenCalledTimes(1);
    type('Pause');
    service.submit();
    expect(service.feedback()).toEqual(feedback('blocked'));
    expect(store.pause).toHaveBeenCalledTimes(1);
  });

  it('treats paused Pause and already-playing Resume as no-ops', () => {
    service.setEnabled(true);
    submit('pause');
    expect(service.feedback()).toEqual(feedback('noop'));
    store.playing.set(true);
    service.updateDraft('resume');
    service.submit();
    expect(service.feedback()).toEqual(feedback('noop'));
    expectNoRequests();
  });

  it('resumes only through the existing active-policy control', () => {
    service.setEnabled(true);
    submit('Weiter');
    expect(store.play).toHaveBeenCalledOnceWith('goal_directed');
    expect(store.dispatcherDecision).not.toHaveBeenCalled();
    expect(service.feedback()).toEqual(feedback('submitted'));
  });

  for (const field of ['backendBusy', 'loading', 'episodeDone', 'sessionCreating', 'sessionOpening'] as const) {
    it(`blocks Resume while ${field}`, () => {
      service.setEnabled(true);
      store[field].set(true);
      submit('resume');
      expect(service.feedback()).toEqual(feedback('blocked'));
      expectNoRequests();
    });
  }

  for (const run_status of ['error', 'aborted', 'finished']) {
    it(`does not resume a terminal agent-owned ${run_status} run`, () => {
      service.setEnabled(true);
      store.dispatcher.set(actor({ run_status }));
      submit('resume');
      expect(service.feedback()).toEqual(feedback('blocked'));
      expectNoRequests();
    });
  }

  it('keeps the existing manual playback allowance after an aborted human-owned reset', () => {
    service.setEnabled(true);
    store.dispatcher.set(actor({ run_status: 'aborted', owner: 'human' }));
    submit('resume');
    expect(store.play).toHaveBeenCalledOnceWith('goal_directed');
  });

  it('allows a human takeover during computation without granting or resuming a proposal', () => {
    service.setEnabled(true);
    store.backendBusy.set(true);
    submit('Ich übernehme');
    expect(store.dispatcherOwnership).toHaveBeenCalledOnceWith('human');
    expect(store.dispatcherDecision).not.toHaveBeenCalled();
    expect(store.play).not.toHaveBeenCalled();
  });

  for (const overrides of [
    { mode: 'co-learning' as const, owner: 'human' as const, requires_approval: false },
    { operator_type: 'synthetic_dispatcher' }, { owner: 'human' as const }, { run_status: 'error' },
  ]) {
    it(`blocks consent outside its valid human decision role ${JSON.stringify(overrides)}`, () => {
      service.setEnabled(true);
      store.dispatcher.set(actor(overrides));
      submit('approve');
      expect(service.feedback()).toEqual(feedback('blocked'));
      expectNoRequests();
    });
  }

  it('does not submit a second consent after that proposal is already approved', () => {
    service.setEnabled(true);
    type('approve');
    store.dispatcher.set(actor({ awaiting_approval: false, approved_command_id: 'session-1:g3-d2' }));
    service.submit();
    expect(service.feedback()).toEqual(feedback('noop'));
    expectNoRequests();
  });

  it('reports blocked when declining a matching proposal that was already approved while paused', () => {
    service.setEnabled(true);
    type('Ablehnen');
    store.dispatcher.set(actor({ awaiting_approval: false, approved_command_id: 'session-1:g3-d2' }));
    service.submit();
    expect(service.feedback()).toEqual(feedback('blocked'));
    expect(service.draft()).toBe('Ablehnen');
    expect(store.playing()).toBeFalse();
    expectNoRequests();
  });

  for (const command of ['approve', 'decline']) {
    it(`blocks ${command} when a pending proposal is neither awaiting consent nor approved`, () => {
      service.setEnabled(true);
      type(command);
      store.dispatcher.set(actor({ awaiting_approval: false, approved_command_id: null }));
      service.submit();
      expect(service.feedback()).toEqual(feedback('blocked'));
      expectNoRequests();
    });
  }

  it('leaves neutral human ownership unchanged rather than re-delegating it', () => {
    service.setEnabled(true);
    store.dispatcher.set(actor({ mode: 'co-learning', owner: 'human', requires_approval: false, pending: null }));
    submit('take over');
    expect(service.feedback()).toEqual(feedback('noop'));
    expectNoRequests();
  });
});
