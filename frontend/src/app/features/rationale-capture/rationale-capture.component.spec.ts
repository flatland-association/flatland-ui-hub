import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { LanguageService } from '../../core/i18n/language.service';
import { SessionInfo } from '../../core/models';
import { SessionStore } from '../../core/session.store';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { RationaleCaptureComponent } from './rationale-capture.component';

describe('rationale-capture', () => {
  let store: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RationaleCaptureComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
  });

  // Outside the reason tours a newer decision replaces the shown one
  // (docs/plans/reflection-inline.md S8).
  it('starts empty for a newer decision, and keeps the picks for the same one', () => {
    const fixture = TestBed.createComponent(RationaleCaptureComponent);
    const cmp = fixture.componentInstance;
    store.recordProposalChoice(0, 'proceed');
    fixture.detectChanges();
    cmp.toggleChip('delay');
    cmp.note.set('first train');
    fixture.detectChanges();
    expect(cmp.isSelected('delay')).withContext('same decision').toBeTrue();

    store.recordProposalChoice(1, 'proceed');
    fixture.detectChanges();
    expect(store.pendingRationale()?.handle).toBe(1);
    expect(cmp.selected().size).toBe(0);
    expect(cmp.note()).toBe('');
  });
});

// The same lookup as the reflection prompt (docs/plans/reflection-inline.md S9).
describe('rationale-capture: the decision it names', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('reads «Plan behalten» as proceeding, not as rerouting', () => {
    TestBed.configureTestingModule({
      imports: [RationaleCaptureComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    const store = TestBed.inject(SessionStore);
    const i18n = TestBed.inject(LanguageService);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
    store.recordProposalChoice(0, 'proceed');
    const capture = TestBed.createComponent(RationaleCaptureComponent).componentInstance;
    expect(capture.strategyLabel()).toBe(i18n.t('proposals.option.proceed', undefined, 'Proceed'));
    expect(capture.hypothesis()).not.toContain(i18n.t('proposals.option.reroute', undefined, 'Reroute'));
  });
});
