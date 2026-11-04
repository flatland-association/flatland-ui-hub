import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AppNotification } from '../../core/events/event-types';
import { NotificationPollingService } from '../../core/notification-polling.service';
import { TrainIdentityService } from '../../core/train-identity.service';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { NotificationsPanelComponent } from './notifications-panel.component';

/** #150 item 1: a card about a train is titled with the train. */
describe('NotificationsPanelComponent — card wording', () => {
  let panel: NotificationsPanelComponent;
  let train: string;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NotificationsPanelComponent],
      providers: [
        ...provideTranslocoTesting(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NotificationPollingService, useValue: { acquire: () => () => undefined } },
      ],
    });
    panel = TestBed.createComponent(NotificationsPanelComponent).componentInstance;
    train = TestBed.inject(TrainIdentityService).nameFor(2);
  });

  afterEach(() => TestBed.resetTestingModule());

  const about = (code: string, params: Record<string, string | number>): AppNotification => ({
    id: 'n', kind: 'warning', title: 'Override active', message: 'Train 2: operator override STOP pending.',
    timestamp: 1, relatedElement: { kind: 'train', id: '2' }, code, params,
  });

  it('titles a stop override with the train and leaves it out of the message', () => {
    const card = panel.cardOf(about('train.overridePending', { train: 2, direction: 'stop' }));
    expect(card).toEqual({ title: train, message: 'Override STOP pending.', related: null });
  });

  it('keeps the kind in the message of a malfunction', () => {
    const card = panel.cardOf(about('train.malfunction', { train: 2, steps: 9 }));
    expect(card).toEqual({ title: train, message: 'Malfunction, 9 steps remaining.', related: null });
  });

  // A scripted disturbance has no short wording: its authored label stays the title.
  it('keeps title, message and the train line without a short wording', () => {
    const n: AppNotification = {
      id: 'd', kind: 'error', title: 'Blocked', message: 'A train stops.', timestamp: 1,
      relatedElement: { kind: 'train', id: '2' }, code: 'disturbance.event', params: { type: 'warning' },
    };
    expect(panel.cardOf(n)).toEqual({ title: 'Blocked', message: 'A train stops.', related: train });
  });

  it('keeps a card without a train as it is', () => {
    const n: AppNotification = {
      id: 'e', kind: 'info', title: 'Episode finished', message: '…', timestamp: 1, code: 'episode.finished', params: {},
    };
    expect(panel.cardOf(n)).toEqual({ title: 'Episode finished', message: 'All agents have reached their target.', related: null });
  });
});
