import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTourContextStub } from '../../testing/tour-context-stub';
import { SessionInfo } from '../../core/models';
import { SessionStore } from '../../core/session.store';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { ProposalCompareComponent } from './proposal-compare.component';
import { PanelFrameService } from '../../core/layout/panel-frame';
import { ReplayService } from '../../core/replay/replay.service';
import { ProposalChoiceService } from '../../core/proposals/proposal-choice.service';
import { proposalSnapshot } from '../../testing/proposal-snapshot';

/** The reflection is asked in the decision log, not in this panel
 *  (docs/plans/reflection-inline.md §4.2, D20). */
describe('ProposalCompareComponent — the reflection', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('is not shown here, also in a tour that asks for reasons', () => {
    TestBed.configureTestingModule({
      imports: [ProposalCompareComponent],
      providers: [
        ...provideTranslocoTesting(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTourContextStub(true),
      ],
    });
    const store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
    store.queueReflections.set(true);
    const fixture = TestBed.createComponent(ProposalCompareComponent);
    fixture.componentInstance.embedded = true;
    fixture.detectChanges();
    store.recordProposalChoice(0, 'proceed');
    fixture.detectChanges();
    expect(store.pendingRationale()).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-reflection-prompt')).toBeNull();
  });
});

/** The panel closes once a course is taken (docs/plans/reflection-inline.md
 *  §4.8, D25); opening again is `ProposalChoiceService`'s. */
describe('ProposalCompareComponent — closing its frame', () => {
  let setExpanded: jasmine.Spy;
  let store: SessionStore;

  function create(replaying = false) {
    TestBed.configureTestingModule({
      imports: [ProposalCompareComponent],
      providers: [
        ...provideTranslocoTesting(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTourContextStub(false),
        ...(replaying ? [{ provide: ReplayService, useValue: { active: () => true } }] : []),
      ],
    });
    setExpanded = spyOn(TestBed.inject(PanelFrameService), 'setExpanded');
    store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
    const fixture = TestBed.createComponent(ProposalCompareComponent);
    fixture.componentInstance.embedded = true;
    store.selectedHandle.set(0);
    fixture.detectChanges();
    TestBed.inject(ProposalChoiceService).choose(0, 'hold');
    fixture.detectChanges();
    setExpanded.calls.reset();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('closes once the participant\'s own option is taken', () => {
    create().componentInstance.commit();
    expect(setExpanded).toHaveBeenCalledOnceWith('proposal-compare', false);
  });

  it('leaves its frame alone in a replay', () => {
    create(true).componentInstance.commit();
    expect(setExpanded).not.toHaveBeenCalled();
  });

  it('keeps the options shown at the click, also when another train is selected before the answer', () => {
    const fixture = create();
    const http = TestBed.inject(HttpTestingController);
    const shown = proposalSnapshot('ai').result;
    http.match((req) => req.url.endsWith('/proposals')).forEach((req) => req.flush(shown));
    fixture.detectChanges();
    fixture.componentInstance.take('ai');
    store.selectedHandle.set(1);
    fixture.detectChanges();
    http.match((req) => req.url.endsWith('/proposals/apply')).forEach((req) => req.flush({ applied: 'ai', label: '', step: 7, policy: '' }));
    const seq = store.decisionLog().at(-1)!.seq;
    const kept = store.proposalSnapshots().get(seq);
    expect(kept?.handle).toBe(0);
    expect(kept?.result.handle).withContext("train 0's courses, not train 1's").toBe(0);
    expect(kept?.option).toBe('hold');
  });
});

/** A decided choice, read-only: the courses and the comparison, nothing to
 *  pick or take (docs/plans/reflection-inline.md §4.8, D26). */
describe('ProposalCompareComponent — decided', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows the courses and the comparison, the taken one marked, and nothing to pick or take', () => {
    TestBed.configureTestingModule({
      imports: [ProposalCompareComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting(), provideTourContextStub(true)],
    });
    const store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.selectedHandle.set(1);
    const fixture = TestBed.createComponent(ProposalCompareComponent);
    fixture.componentInstance.embedded = true;
    fixture.componentRef.setInput('decided', proposalSnapshot('plan'));
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.pc-course').length).toBe(2);
    expect(el.querySelector('.pc-compare')).toBeTruthy();
    expect(el.querySelector('.pc-course--plan .pc-taken')).toBeTruthy();
    expect(el.querySelector('.pc-options')).toBeNull();
    expect(el.querySelector('.pc-take')).toBeNull();
    expect(el.querySelector('.pc-note')).toBeNull();
    expect(el.querySelector('.pc-toggle')).withContext('no alternatives').toBeNull();
    expect(el.querySelector('.pc-course--empty')).withContext('no empty MENSCH column').toBeNull();
  });
});

/** A forecast can offer distinct complete RL courses. Inspecting one does not
 *  actuate anything; acceptance sends the exact course token the human saw. */
describe('ProposalCompareComponent — future AI courses', () => {
  function create() {
    TestBed.configureTestingModule({
      imports: [ProposalCompareComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting(), provideTourContextStub(false)],
    });
    const store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.selectedHandle.set(0);
    store.interactionMode.set('co-learning');
    const fixture = TestBed.createComponent(ProposalCompareComponent);
    fixture.componentInstance.embedded = true;
    fixture.detectChanges();
    return { fixture, store, http: TestBed.inject(HttpTestingController), component: fixture.componentInstance };
  }

  afterEach(() => TestBed.resetTestingModule());

  function courses() {
    const result = proposalSnapshot('ai').result;
    result.source_step = 7;
    Object.assign(result.variants[1], {
      source: 'uc2_rl', candidate_id: 'rl', preview_token: 'shown-rl', intervention: { kind: 'rl' },
    });
    Object.assign(result.ai_alternatives[0], {
      source: 'uc2_rl', candidate_id: 'wait-13-3', preview_token: 'shown-wait', matches_plan: false,
      intervention: { kind: 'wait', handle: 0, step: 13, wait_steps: 3 },
    });
    return result;
  }

  it('inspects an alternative without applying, then accepts that exact shown course', () => {
    const { fixture, component, http, store } = create();
    const result = courses();
    http.match((r) => r.url.endsWith('/proposals')).forEach((r) => r.flush(result));
    fixture.detectChanges();
    component.selectAlternative(component.alternatives()[0]);
    fixture.detectChanges();
    expect(component.ai()?.candidate_id).toBe('wait-13-3');
    expect(component.courseText(component.ai()!)).toBe('Wait 3 steps from step 13');
    expect(component.alternatives()[0].candidate_id).toBe('rl');
    expect(http.match((r) => r.url.endsWith('/proposals/apply')).length).toBe(0);
    component.take('ai');
    const request = http.expectOne((r) => r.url.endsWith('/proposals/apply'));
    expect(request.request.body).toEqual({
      variant: 'ai', handle: 0, priority: undefined,
      preview_token: 'shown-wait', candidate_id: 'wait-13-3', source_step: 7,
    });
    request.flush({ applied: 'ai', label: '', step: 7, policy: 'plan' });
    expect(store.proposalSnapshots().get(store.decisionLog().at(-1)!.seq)?.result.variants[1].candidate_id).toBe('wait-13-3');
  });

  /** docs/plans/plan-b-round2-colearning.md, item 3; plan-b-round2-general.md, item 7. */
  it('offers the human\'s options inside the Mensch box, without «Halten bis frei»', () => {
    const { fixture, http } = create();
    http.match((r) => r.url.endsWith('/proposals')).forEach((r) => r.flush(courses()));
    fixture.detectChanges();
    const groups = fixture.nativeElement.querySelectorAll('.pc-options') as NodeListOf<HTMLElement>;
    expect(groups.length).toBe(1);
    expect(groups[0].closest('.pc-course--human')).not.toBeNull();
    expect([...groups[0].querySelectorAll('button')].map((b) => b.textContent!.trim())).toEqual(['Hold', 'Proceed', 'Change route']);
  });

  /** docs/plans/uc2-rl-keep-human-decisions.md: uc2_rl keeps the other trains' stops. */
  for (const [keeps, text] of [
    [true, 'trains with your decision (stop, turn, reroute) keep it'],
    [false, 'The trains now run by the AI’s plan. “vs. plan”'],
  ] as const) {
    it(`says after taking the AI course whether the other trains keep their decisions (${keeps})`, () => {
      const { fixture, component, http } = create();
      http.match((r) => r.url.endsWith('/proposals')).forEach((r) => r.flush({ ...courses(), ai_keeps_overrides: keeps }));
      fixture.detectChanges();
      component.take('ai');
      http.expectOne((r) => r.url.endsWith('/proposals/apply')).flush({ applied: 'ai', label: '', step: 7, policy: 'plan' });
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(text);
    });
  }

  it('discards a stale preview on conflict without recording an accepted decision', () => {
    const { fixture, component, http, store } = create();
    http.match((r) => r.url.endsWith('/proposals')).forEach((r) => r.flush(courses()));
    fixture.detectChanges();
    const before = store.decisionLog().length;
    component.take('ai');
    http.expectOne((r) => r.url.endsWith('/proposals/apply')).flush(
      { detail: 'stale forecast' }, { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();
    expect(component.result()).toBeNull();
    expect(store.decisionLog().length).toBe(before);
    expect(fixture.nativeElement.textContent).toContain('Refresh the courses');
    expect(fixture.nativeElement.querySelector('[data-log="proposals.refreshCourses"]')).toBeTruthy();
  });

  it('keeps the newer train forecast when an earlier response arrives last', () => {
    const { fixture, component, http, store } = create();
    const older = http.match((r) => r.url.endsWith('/proposals'));
    store.selectedHandle.set(1);
    fixture.detectChanges();
    const newer = http.match((r) => r.url.endsWith('/proposals'));
    const next = { ...courses(), handle: 1 };
    newer.forEach((r) => r.flush(next));
    older.forEach((r) => r.flush(courses()));
    expect(component.result()?.handle).toBe(1);
  });

  it('does not accept or select a course while a new forecast is pending', () => {
    const { fixture, component, http } = create();
    http.match((r) => r.url.endsWith('/proposals')).forEach((r) => r.flush(courses()));
    fixture.detectChanges();
    const before = component.ai()?.candidate_id;
    component.load('hold');
    component.selectAlternative(component.alternatives()[0]);
    component.take('ai');
    expect(component.ai()?.candidate_id).toBe(before);
    expect(http.match((r) => r.url.endsWith('/proposals/apply')).length).toBe(0);
  });

  it('does not record an old session acceptance in the newly opened session', () => {
    const { fixture, component, http, store } = create();
    const frames = spyOn(TestBed.inject(PanelFrameService), 'setExpanded');
    http.match((r) => r.url.endsWith('/proposals')).forEach((r) => r.flush(courses()));
    fixture.detectChanges();
    component.take('ai');
    const accepted = http.expectOne((r) => r.url.endsWith('/proposals/apply'));
    store.session.set({ id: 'new-session' } as SessionInfo);
    fixture.detectChanges();
    const before = store.decisionLog().length;
    accepted.flush({ applied: 'ai', label: '', step: 7, policy: 'plan' });
    expect(store.decisionLog().length).toBe(before);
    expect(frames).not.toHaveBeenCalled();
    expect(component.shownApplied()).toBeNull();
  });
});
