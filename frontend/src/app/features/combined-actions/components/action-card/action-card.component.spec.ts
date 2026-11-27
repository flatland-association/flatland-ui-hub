import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActionCardComponent } from './action-card.component';
import { DispatcherActivityService } from '../../../../core/dispatcher-activity.service';
import { LanguageService } from '../../../../core/i18n/language.service';
import { ImpactPredictionService } from '../../../../core/combined-actions/impact-prediction.service';

describe('ActionCard acknowledgement', () => {
  let card: ActionCardComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [
      { provide: DispatcherActivityService, useValue: { activity: signal({ stage: 'observing' }), store: { dispatcher: signal(null) } } },
      { provide: LanguageService, useValue: { t: (key: string) => key } },
      { provide: ImpactPredictionService, useValue: { predictNow: () => null } },
    ] });
    card = TestBed.runInInjectionContext(() => new ActionCardComponent());
    card.pkg = { id: 'A', label: 'Keep course', aiOrder: ['IC_703'], recommended: false, rationale: '' };
    card.ngOnInit();
  });

  afterEach(() => card.ngOnDestroy());

  it('keeps a rejected backend request out of Applied and the selection log', async () => {
    let reject!: (reason: Error) => void;
    card.applyAction = () => new Promise<boolean>((_resolve, fail) => { reject = fail; });
    const selected = spyOn(card.applyRequested, 'emit');
    const pending = card.apply();
    expect(card.applying()).toBeTrue();
    expect(card.applied()).toBeNull();
    expect(selected).not.toHaveBeenCalled();

    reject(new Error('409: dispatcher owns role'));
    await pending;
    expect(card.applying()).toBeFalse();
    expect(card.applied()).toBeNull();
    expect(selected).not.toHaveBeenCalled();
  });

  it('waits for acceptance and rejects duplicate clicks without emitting a second legacy selection', async () => {
    let accept!: (accepted: boolean) => void;
    const request = jasmine.createSpy('request').and.callFake(() => new Promise<boolean>(resolve => { accept = resolve; }));
    card.applyAction = request;
    const selected = spyOn(card.applyRequested, 'emit');
    const pending = card.apply();
    await card.apply();
    expect(request).toHaveBeenCalledTimes(1);
    expect(selected).not.toHaveBeenCalled();

    accept(true);
    await pending;
    expect(selected).not.toHaveBeenCalled();
    expect(card.applied()).toBe('AI proposal');
  });

  it('does not confirm a declined acknowledgement or an ownership-blocked action', async () => {
    const request = jasmine.createSpy('request').and.resolveTo(false);
    card.applyAction = request;
    const selected = spyOn(card.applyRequested, 'emit');
    card.blocked = true;
    await card.apply();
    expect(request).not.toHaveBeenCalled();
    card.blocked = false;
    await card.apply();
    expect(request).toHaveBeenCalledTimes(1);
    expect(selected).not.toHaveBeenCalled();
    expect(card.applied()).toBeNull();
  });

  it('preserves immediate selection for packages without a backend action', () => {
    const selected = spyOn(card.applyRequested, 'emit');
    void card.apply();
    expect(selected).toHaveBeenCalledTimes(1);
    expect(card.applied()).toBe('AI proposal');
  });

  it('does not confirm on a card removed while its request is pending', async () => {
    let accept!: (accepted: boolean) => void;
    card.applyAction = () => new Promise<boolean>(resolve => { accept = resolve; });
    const selected = spyOn(card.applyRequested, 'emit');
    const pending = card.apply();
    card.ngOnDestroy();
    accept(true);
    await pending;
    expect(selected).not.toHaveBeenCalled();
    expect(card.applied()).toBeNull();
  });
});
