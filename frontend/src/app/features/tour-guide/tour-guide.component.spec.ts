import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiConfigService } from '../../core/config/ui-config.service';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { ExperimentRunService } from '../../core/demo/experiment-run.service';
import { StudyCondition, WAL_SINGLE_TRACK } from '../../core/demo/study-conditions';
import { TourGuideComponent } from './tour-guide.component';
import { TourContextService } from '../../core/demo/tour-context.service';
import { SessionStore } from '../../core/session.store';
import { SessionInfo } from '../../core/models';

/**
 * The tour strip is where "Schicht beenden" actually lives for a Co-Learning
 * condition: `director-directive` carries the other copy, but it is
 * director-only, so a Plan B run never renders it. The strip is also app-shell
 * chrome — no layout places it — which is why hiding the button needs
 * `control.endShift` rather than anything a preset's columns could express
 * (docs/plans/configurable-ui-plan.md §1.1 item 4).
 */
describe('TourGuideComponent — the end-shift button', () => {
  let fixture: ComponentFixture<TourGuideComponent>;
  let uiConfig: UiConfigService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TourGuideComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(TourGuideComponent);
    uiConfig = TestBed.inject(UiConfigService);
  });

  const endButton = () => {
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('.tour-guide__end');
  };

  it('is offered by default', () => {
    expect(endButton()).not.toBeNull();
  });

  it('is gone once control.endShift is hidden', () => {
    uiConfig.apply({ hidden: ['control.endShift'] });
    expect(endButton()).toBeNull();
  });

  it('comes back when the restriction is dropped', () => {
    uiConfig.apply({ hidden: ['control.endShift'] });
    expect(endButton()).toBeNull();
    uiConfig.apply({});
    expect(endButton()).not.toBeNull();
  });

  it('leaves the rest of the strip alone', () => {
    uiConfig.apply({ hidden: ['control.endShift'] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tour-guide')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.tour-guide__hint')).not.toBeNull();
  });
});

/** The closing hint once every live step is done (#174, docs/plans/remove-shift-summary.md D6). */
describe('TourGuideComponent — the closing hint', () => {
  let fixture: ComponentFixture<TourGuideComponent>;
  let run: ExperimentRunService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TourGuideComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(TourGuideComponent);
    run = TestBed.inject(ExperimentRunService);
  });

  // No steps to do: the strip is past its last live step.
  const hint = () => {
    fixture.detectChanges();
    return (fixture.nativeElement.querySelector('.tour-guide__hint')?.textContent ?? '').trim();
  };
  const condition = (c: Partial<StudyCondition>): StudyCondition =>
    ({ id: 'spec', layoutId: 'preset-plan-b', mode: 'co-learning', label: 'Spec', surveyParts: [], legs: [WAL_SINGLE_TRACK], ...c });

  it('announces the Schichtbilanz outside an experiment', () => {
    expect(hint()).toContain('End the shift');
  });

  it('announces it in an experiment that has one', () => {
    run.condition.set(condition({}));
    expect(hint()).toContain('End the shift');
  });

  it('says to finish the scenario in an experiment without one', () => {
    run.condition.set(condition({ shiftSummary: false }));
    expect(hint()).toBe('All steps during the run are done. Finish the scenario when you are ready.');
  });

  it('offers no "End shift" in an experiment without one: it would open the Schichtbilanz', () => {
    run.condition.set(condition({ shiftSummary: false }));
    expect(hint()).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.tour-guide__end')).toBeNull();
    run.condition.set(condition({}));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tour-guide__end')).not.toBeNull();
  });
});

/** «Schicht beenden» waits for every open reflection in a tour that asks for
 *  them, like the toolbar's finish (docs/plans/reflection-inline.md §4.4). */
describe('TourGuideComponent — ending the shift with open reflections', () => {
  afterEach(() => TestBed.resetTestingModule());

  function create(reasonDialog: boolean) {
    TestBed.configureTestingModule({
      imports: [TourGuideComponent],
      providers: [
        ...provideTranslocoTesting(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TourContextService, useValue: { reasonDialog: () => reasonDialog } },
      ],
    });
    const store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
    store.queueReflections.set(reasonDialog);
    store.playing.set(true);
    store.recordProposalChoice(0, 'proceed');
    return { store, guide: TestBed.createComponent(TourGuideComponent).componentInstance };
  }

  it('is refused while one is open: the run goes on and the shift does not end', () => {
    const { store, guide } = create(true);
    guide.endShift();
    expect(store.shiftEnded()).toBeFalse();
    expect(store.playing()).toBeTrue();
    expect(store.reflectionsMissing()).toBe(1);
  });

  it('ends the shift once every reflection is answered', () => {
    const { store, guide } = create(true);
    store.submitRationale({ rationale: '', response: 'no' });
    guide.endShift();
    expect(store.shiftEnded()).toBeTrue();
  });

  it('is not gated in a tour that does not ask for reasons', () => {
    const { store, guide } = create(false);
    guide.endShift();
    expect(store.shiftEnded()).toBeTrue();
  });
});
