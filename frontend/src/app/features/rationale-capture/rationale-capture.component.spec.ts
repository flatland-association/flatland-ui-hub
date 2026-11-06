import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
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

