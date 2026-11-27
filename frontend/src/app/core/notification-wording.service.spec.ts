import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AppNotification } from './events/event-types';
import { NotificationWordingService } from './notification-wording.service';
import { provideTranslocoTesting } from '../testing/transloco-testing';

/** A breakdown of one step reads in the singular (docs/plans/plan-b-log-findings.md §4.5). */
describe('NotificationWordingService — steps', () => {
  afterEach(() => TestBed.resetTestingModule());

  function wording() {
    TestBed.configureTestingModule({
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    return TestBed.inject(NotificationWordingService);
  }

  const malfunction = (steps: number) => ({
    id: 'n', kind: 'error', title: 'Malfunction', message: '', timestamp: 0,
    code: 'train.malfunction', params: { train: 'S17u', steps },
  }) as unknown as AppNotification;

  it('says one step in the singular and several in the plural', () => {
    const w = wording();
    expect(w.shortMessageOf(malfunction(1))).toBe('Malfunction, 1 step remaining.');
    expect(w.shortMessageOf(malfunction(4))).toBe('Malfunction, 4 steps remaining.');
    expect(w.messageOf(malfunction(1))).toBe('S17u is malfunctioning (1 step remaining).');
  });
});
