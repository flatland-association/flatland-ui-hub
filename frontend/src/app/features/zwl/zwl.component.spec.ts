import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SessionStore } from '../../core/session.store';
import { AgentColorService } from '../../core/agent-color.service';
import { TrainIdentityService } from '../../core/train-identity.service';
import type { ContentionGroup } from '../../core/events/event-types';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { ZwlComponent } from './zwl.component';

/**
 * Following the now-line with time running down
 * (docs/plans/plan-b-small-changes.md, item 1, findings F-1, F-2, F-5).
 * The geometry is stubbed: a fake scroller, a fixed time window and a
 * now-line at a chosen height, so the scroll logic runs without a scenario.
 */
describe('ZwlComponent — following the now-line', () => {
  let c: ZwlComponent;
  let fixture: ComponentFixture<ZwlComponent>;
  let store: SessionStore;
  let el: { scrollTop: number; scrollHeight: number; clientHeight: number };
  let domain: WritableSignal<[number, number]>;
  let nowY: WritableSignal<number>;

  /** Private members the tests drive or read. */
  const priv = () => c as unknown as { stepPx(): number; nowScrollTop(y: number): number };
  const tick = () => TestBed.tick();

  beforeEach(() => {
    spyOn(window, 'requestAnimationFrame').and.callFake((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    TestBed.configureTestingModule({
      imports: [ZwlComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(SessionStore);
    store.session.set({ id: 's1' } as never);
    fixture = TestBed.createComponent(ZwlComponent);
    c = fixture.componentInstance;
    el = { scrollTop: 0, scrollHeight: 5000, clientHeight: 300 };
    domain = signal<[number, number]>([0, 200]);
    nowY = signal(500);
    const stub = c as unknown as Record<string, unknown>;
    stub['scroller'] = () => ({ nativeElement: el });
    stub['stepDomain'] = domain;
    stub['nowLine'] = () => ({ y1: nowY() });
    c.orientation.set('time-vertical');
    fixture.detectChanges();
    tick();
  });

  it('keeps the now-line NOW_PAST_STEPS steps below the top', () => {
    expect(el.scrollTop).toBe(priv().nowScrollTop(500));
    nowY.set(600);
    tick();
    expect(el.scrollTop).toBe(priv().nowScrollTop(600));
    expect(c.detached()).toBeFalse();
  });

  it('does not detach on a scroll the browser makes on its own (F-5)', () => {
    el.scrollTop = 0; // e.g. clamped after the diagram got shorter
    c.onScroll();
    expect(c.detached()).toBeFalse();
  });

  it('detaches on a scroll by hand, and follows again near the now-line or on "Zu jetzt"', () => {
    const place = el.scrollTop;
    c.markHandScroll();
    el.scrollTop = place - 10 * priv().stepPx();
    c.onScroll();
    expect(c.detached()).toBeTrue();

    nowY.set(700);
    tick();
    expect(el.scrollTop).withContext('a detached view does not follow').toBe(place - 10 * priv().stepPx());

    el.scrollTop = priv().nowScrollTop(700) + priv().stepPx();
    c.onScroll();
    expect(c.detached()).withContext('back within two steps').toBeFalse();

    c.markHandScroll();
    el.scrollTop = 0;
    c.onScroll();
    expect(c.detached()).toBeTrue();
    c.followNowAgain();
    tick();
    expect(c.detached()).toBeFalse();
    expect(el.scrollTop).toBe(priv().nowScrollTop(700));
  });

  it('counts the furthest reachable place as the now-line\'s near the end of the axis', () => {
    el.scrollHeight = el.clientHeight + 100; // the follow target is out of reach
    c.markHandScroll();
    el.scrollTop = 100;
    c.onScroll();
    expect(c.detached()).toBeFalse();
  });

  it('keeps a detached view on the same steps while the time window slides (F-1)', () => {
    c.markHandScroll();
    el.scrollTop = 100;
    c.onScroll();
    expect(c.detached()).toBeTrue();
    const before = el.scrollTop;
    domain.set([3, 200]);
    tick();
    expect(el.scrollTop).toBeCloseTo(before - 3 * priv().stepPx(), 0);
  });

  it('follows again on a new session or orientation (F-5)', () => {
    c.markHandScroll();
    el.scrollTop = 0;
    c.onScroll();
    expect(c.detached()).toBeTrue();
    store.session.set({ id: 's2' } as never);
    tick();
    expect(c.detached()).toBeFalse();

    c.markHandScroll();
    el.scrollTop = 0;
    c.onScroll();
    expect(c.detached()).toBeTrue();
    c.orientation.set('time-horizontal');
    tick();
    expect(c.detached()).toBeFalse();
  });

  it('keeps the time unit clear of the first tick label with time running across (F-10)', () => {
    c.orientation.set('time-horizontal');
    const firstTick = c.timeTicks()[0];
    // The first tick's label is centred on it; a number of up to four digits
    // reaches about 13 px to its left.
    expect(c.timeUnitLabel().x).toBeLessThanOrEqual(firstTick.lx - 14);
    expect(c.timeUnitLabel().y).toBe(firstTick.ly);
  });

  it('writes the time unit in the sticky header, where it does not scroll away (F-2)', () => {
    expect(c.timeUnitLabel().y).toBeGreaterThan(0);
    expect(c.timeUnitLabel().y).toBeLessThan(c.headerH);
  });

  it('keeps origin vertical even when the ordinary diagram is horizontal', () => {
    c.orientation.set('time-horizontal');
    expect(c.timeVertical()).toBeFalse();
    fixture.componentRef.setInput('origin', true);
    fixture.detectChanges();
    expect(c.timeVertical()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.zwd--origin')).not.toBeNull();
  });

  it('uses scenario categories only in origin, keeping missing names neutral', () => {
    const identity = TestBed.inject(TrainIdentityService);
    const colors = TestBed.inject(AgentColorService);
    spyOn(identity, 'scenarioNameFor').and.callFake((handle) => handle === 0 ? 'G4' : null);
    const stub = c as unknown as Record<string, unknown>;
    stub['points'] = () => new Map([
      [0, { past: [{ step: 0, pos: 1 }], forecast: [] }],
      [1, { past: [{ step: 0, pos: 2 }], forecast: [] }],
    ]);
    stub['planOnAxis'] = () => new Map();
    expect(c.lines().map((line) => line.color)).toEqual([
      colors.getColorSolid(0), colors.getColorSolid(1),
    ]);
    fixture.componentRef.setInput('origin', true);
    fixture.detectChanges();
    expect(c.lines().map((line) => line.color)).toEqual([
      colors.getScenarioCategoryColor('freight'), colors.getScenarioCategoryColor('unknown'),
    ]);
    expect(fixture.nativeElement.querySelector('.zwd__category-hint')).not.toBeNull();
    fixture.componentRef.setInput('extended', true);
    fixture.detectChanges();
    expect(c.lines()[0].color).toBe(colors.getScenarioCategoryColor('freight'));
  });

  it('reports an unavailable conflict forecast instead of a clear forecast', () => {
    fixture.componentRef.setInput('origin', true);
    fixture.detectChanges();
    expect(c.conflictForecastAvailable()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.zwd__none').textContent)
      .toContain('Conflict forecast unavailable.');
    store.contentionHorizonSteps.set(50);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.zwd__none').textContent)
      .toContain('No conflicts forecast');
  });

  it('keeps origin train actions mode-aware', () => {
    fixture.componentRef.setInput('origin', true);
    fixture.componentRef.setInput('decisionPills', true);
    store.interactionMode.set('recommendation');
    expect(c.pillBehavior()).toEqual({ show: true, markRecommended: true });
    store.interactionMode.set('co-learning');
    expect(c.pillBehavior()).toEqual({ show: true, markRecommended: false });
    store.interactionMode.set('director');
    expect(c.pillBehavior()).toEqual({ show: false, markRecommended: false });
  });

  it('shows the selected train status without guessing the reason for a stop', () => {
    fixture.componentRef.setInput('origin', true);
    store.state.set({
      elapsed_steps: 0,
      agents: [{ handle: 1, state: 'STOPPED', is_malfunctioning: false, malfunction_remaining: 0 }],
    } as never);
    store.selectedHandle.set(1);
    fixture.detectChanges();
    expect(c.selectedTrain()?.status).toBe('stopped');
    expect(fixture.nativeElement.querySelector('.zwd__origin-context').textContent).toContain('Stopped');
  });

  it('selects a conflict, shows missing measures distinctly from zero, and selects a train', () => {
    fixture.componentRef.setInput('origin', true);
    fixture.componentRef.setInput('extended', true);
    store.geography.set({
      layout: 'corridor', stations: [{ code: 'A', name: 'A', cell: [1, 1] }],
      locations: [], single_track: [],
    } as never);
    const group: ContentionGroup = {
      kind: 'blocked', step: 12, position: [1, 1], handles: [1, 2],
      perHandle: [{
        agentHandle: 1,
        baselineOrder: { value: 12, unavailable_reason: null },
        headway: { value: null, unavailable_reason: 'no_window' },
        entryDelay: { value: 0, unavailable_reason: null },
        slack: { value: null, unavailable_reason: 'no_waypoints' },
      }],
    };
    store.contentions.set([group]);
    fixture.detectChanges();
    const chip = fixture.nativeElement.querySelector('.zwd__chip') as HTMLButtonElement;
    chip.click();
    fixture.detectChanges();
    expect(store.selectedContention()).toBe(group);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    const detail = fixture.nativeElement.querySelector('.zwd__detail') as HTMLElement;
    expect(detail.textContent).toContain('First entry (step): 12');
    expect(detail.textContent).toContain('Occupancy (steps): Unavailable');
    expect(detail.textContent).toContain('Current overdue time (steps): 0');
    (detail.querySelector('button') as HTMLButtonElement).click();
    expect(store.selectedHandle()).toBe(1);
    chip.click();
    expect(store.selectedContention()).toBeNull();
  });

  it('still offers conflict details when no diagram axis is available', () => {
    fixture.componentRef.setInput('origin', true);
    fixture.componentRef.setInput('extended', true);
    store.contentions.set([{ kind: 'blocked', step: 12, position: null, handles: [1, 2] }]);
    fixture.detectChanges();
    const chip = fixture.nativeElement.querySelector('.zwd__chip') as HTMLButtonElement;
    expect(chip).not.toBeNull();
    chip.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.zwd__detail').textContent).toContain('Location unavailable');
  });
});
