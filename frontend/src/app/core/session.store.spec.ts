import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslocoTesting } from '../testing/transloco-testing';
import { SessionInfo } from './models';
import { SessionStore } from './session.store';
import { WebSocketService } from './websocket.service';

/** A run error: the server's play loop raised and sent a WebSocket `error`
 *  (docs/plans/toolbar-under-guide.md D7, D12). */
describe('SessionStore — run errors', () => {
  let store: SessionStore;
  let ws: WebSocketService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(SessionStore);
    ws = TestBed.inject(WebSocketService);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.playing.set(true);
  });

  it('stops the run and remembers the error, apart from other failures', () => {
    store.error.set('Forecast failed');
    TestBed.tick();
    expect(store.runError()).toBeNull();

    ws.lastMessage.set({ type: 'error', message: 'policy raised' } as never);
    TestBed.tick();
    expect(store.playing()).toBeFalse();
    expect(store.runError()?.message).toBe('policy raised');
    expect(store.runError()?.simStep).toBe(0);
  });

  it('forgets it when the session ends', () => {
    ws.lastMessage.set({ type: 'error', message: 'x' } as never);
    TestBed.tick();
    store.endSession();
    expect(store.runError()).toBeNull();
  });
});

/** Open reflections without the pause (docs/plans/reflection-inline.md §4.1):
 *  decisions overlap, so none may be lost or replace the one being typed. */
describe('SessionStore — open reflections', () => {
  let store: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
    store.queueReflections.set(true);
  });

  const decide = (handle: number) => store.recordProposalChoice(handle, 'proceed');
  const seqs = () => store.openReflections().map((r) => r.handle);

  it('shows the first decision and lets a second one wait', () => {
    decide(0);
    decide(1);
    expect(seqs()).toEqual([0, 1]);
    expect(store.pendingRationale()?.handle).toBe(0);
  });

  it('shows the waiting one once the shown one is answered, and stamps the answer', () => {
    decide(0);
    decide(1);
    const first = store.pendingRationale()!.decisionSeq;
    store.submitRationale({ rationale: 'x', response: 'yes' });
    expect(seqs()).toEqual([1]);
    expect(store.pendingRationale()?.handle).toBe(1);
    const entry = store.decisionLog().find((e) => e.seq === first)!;
    expect(entry.reflectedAt).toEqual(jasmine.any(Number));
    expect(entry.reflectedAtStep).toBe(0);
  });

  it('counts a bare «Nein» as answered (Q2)', () => {
    decide(0);
    store.submitRationale({ rationale: '', response: 'no' });
    expect(store.openReflections()).toEqual([]);
  });

  it('keeps a closed reflection open and offers it back by decision', () => {
    decide(0);
    const seq = store.pendingRationale()!.decisionSeq;
    store.dismissRationale();
    expect(store.pendingRationale()).toBeNull();
    expect(store.canReopenRationale()).toBeTrue();
    expect(store.openReflectionSeqs().has(seq)).toBeTrue();
    store.reopenRationale(seq);
    expect(store.pendingRationale()?.decisionSeq).toBe(seq);
  });

  it('shows a waiting decision when the shown one is closed, but not the closed one again', () => {
    decide(0);
    decide(1);
    store.dismissRationale();
    expect(store.pendingRationale()?.handle).toBe(1);
    store.dismissRationale();
    expect(store.pendingRationale()).toBeNull();
    store.reopenRationale();
    expect(store.pendingRationale()?.handle).toBe(1);
  });

  it('refuses to finish while reflections are open, and forgets the refusal once they are answered', () => {
    expect(store.refuseFinishForOpenReflections()).toBeFalse();
    decide(0);
    expect(store.refuseFinishForOpenReflections()).toBeTrue();
    expect(store.reflectionsMissing()).toBe(1);
    store.submitRationale({ rationale: 'x', response: 'once' });
    TestBed.tick();
    expect(store.reflectionsMissing()).toBe(0);
  });

  it('starts a new leg without open reflections', () => {
    decide(0);
    store.refuseFinishForOpenReflections();
    store.clearDecisionLog();
    expect(store.openReflections()).toEqual([]);
    expect(store.pendingRationale()).toBeNull();
    expect(store.reflectionsMissing()).toBe(0);
  });

  // docs/plans/reflection-inline.md D16: no panel in the layout can show it.
  it('asks nothing where no place can show it, but still logs the decision', () => {
    store.reflectionPlaceInLayout.set(false);
    decide(0);
    expect(store.openReflections()).toEqual([]);
    expect(store.pendingRationale()).toBeNull();
    expect(store.decisionLog().length).toBe(1);
  });

  it('asks nothing in Director', () => {
    store.interactionMode.set('director');
    decide(0);
    expect(store.openReflections()).toEqual([]);
  });
});

/** Outside a tour that asks for reasons the prompt asks about the latest
 *  decision only, as before #160 (docs/plans/reflection-inline.md finding 4). */
describe('SessionStore — reflections without a queue', () => {
  let store: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
  });

  const decide = (handle: number) => store.recordProposalChoice(handle, 'proceed');

  it('asks about the latest decision: a new one replaces the shown one', () => {
    decide(0);
    decide(1);
    expect(store.pendingRationale()?.handle).toBe(1);
    expect(store.openReflections().map((r) => r.handle)).toEqual([1]);
  });

  it('drops a closed prompt, so nothing stays open', () => {
    decide(0);
    store.dismissRationale();
    expect(store.pendingRationale()).toBeNull();
    expect(store.openReflections()).toEqual([]);
    expect(store.canReopenRationale()).toBeFalse();
  });

  it('derives the shown reflection from the list: an emptied log shows none', () => {
    decide(0);
    store.clearDecisionLog();
    expect(store.pendingRationale()).toBeNull();
  });
});
