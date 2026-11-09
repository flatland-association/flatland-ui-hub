import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { UiConfigService } from '../../core/config/ui-config.service';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { DecisionLogPanelComponent, scrollIntoPanel } from './decision-log-panel.component';
import { SessionStore } from '../../core/session.store';
import { SessionInfo } from '../../core/models';
import { provideTourContextStub } from '../../testing/tour-context-stub';

/**
 * `collapsedByDefault` seeds the panel's own `collapsed` signal, so it has to
 * be applied *before* the component is created — which is how it runs in the
 * app too (the config arrives with the layout, the panel is built after).
 */
function createWith(config: Parameters<UiConfigService['apply']>[0]) {
  TestBed.configureTestingModule({
    imports: [DecisionLogPanelComponent],
    providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
  });
  TestBed.inject(UiConfigService).apply(config);
  const fixture = TestBed.createComponent(DecisionLogPanelComponent);
  fixture.componentInstance.embedded = true;
  fixture.detectChanges();
  return fixture;
}

describe('DecisionLogPanelComponent — collapsed by default', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts open when nothing is configured', () => {
    const fixture = createWith({});
    expect(fixture.componentInstance.collapsed()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.dl-summary')).toBeTruthy();
  });

  it('starts closed when the id is listed under collapsedByDefault', () => {
    const fixture = createWith({ collapsedByDefault: ['widget.decision-log'] });
    expect(fixture.componentInstance.collapsed()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.dl-summary')).toBeFalsy();
  });

  // The point of collapsing rather than hiding: the participant still sees
  // that decisions are being recorded (§1.1 item 2).
  it('keeps its header and entry count visible while collapsed', () => {
    const fixture = createWith({ collapsedByDefault: ['widget.decision-log'] });
    expect(fixture.nativeElement.querySelector('.dl-panel-head')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.dl-count')).toBeTruthy();
  });

  // #150: before the head had a toggle, nothing in the page called
  // toggleCollapsed(), so a log that started collapsed stayed closed.
  it('is a default, not a lock — the participant can open it from the head', () => {
    const fixture = createWith({ collapsedByDefault: ['widget.decision-log'] });
    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('.dl-panel-head .dl-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('data-log')).toBe('log.showEntries');
    toggle.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.collapsed()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.dl-summary')).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('data-log')).toBe('log.hideEntries');
  });

  it('can be closed again when it starts open', () => {
    const fixture = createWith({});
    fixture.nativeElement.querySelector('.dl-toggle').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.collapsed()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.dl-summary')).toBeFalsy();
  });
});

describe('DecisionLogPanelComponent — export and clear buttons', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows them when nothing is configured', () => {
    const fixture = createWith({});
    expect(fixture.nativeElement.querySelector('.dl-actions')).toBeTruthy();
  });

  // #150 item 2d: Plan B hides them; the entries and the toggle stay.
  it('hides them under widget.decision-log.actions', () => {
    const fixture = createWith({ hidden: ['widget.decision-log.actions'] });
    expect(fixture.nativeElement.querySelector('.dl-actions')).toBeFalsy();
    expect(fixture.nativeElement.querySelector('.dl-summary')).toBeTruthy();
  });
});

/** Reflections in the log (docs/plans/reflection-inline.md §4.3): marked where
 *  the tour asks for them, reopened from the entry, highlighted on request. */
describe('DecisionLogPanelComponent — open reflections', () => {
  let store: SessionStore;

  function create(reasonDialog: boolean, config: Parameters<UiConfigService['apply']>[0] = {}) {
    TestBed.configureTestingModule({
      imports: [DecisionLogPanelComponent],
      providers: [
        ...provideTranslocoTesting(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTourContextStub(reasonDialog),
      ],
    });
    TestBed.inject(UiConfigService).apply(config);
    store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
    store.queueReflections.set(reasonDialog);
    const fixture = TestBed.createComponent(DecisionLogPanelComponent);
    fixture.componentInstance.embedded = true;
    fixture.detectChanges();
    return fixture;
  }
  const q = (f: ReturnType<typeof create>, sel: string) => f.nativeElement.querySelector(sel);

  afterEach(() => TestBed.resetTestingModule());

  it('counts open reflections next to the toggle, also while collapsed', () => {
    const fixture = create(true, { collapsedByDefault: ['widget.decision-log'] });
    store.recordProposalChoice(0, 'proceed');
    fixture.detectChanges();
    expect(q(fixture, '.dl-panel-head .dl-open-count')).toBeTruthy();
    expect(q(fixture, '.dl-panel-head .dl-show-open').getAttribute('data-log')).toBe('log.showOpenReflections');
    expect(q(fixture, '.dl-toggle .dl-show-open')).toBeNull();
  });

  it('offers an open reflection back from its entry, and marks an answered one', () => {
    const fixture = create(true);
    store.recordProposalChoice(0, 'proceed');
    store.dismissRationale();
    fixture.detectChanges();
    const reflect: HTMLButtonElement = q(fixture, '.dl-entry .dl-reflect');
    expect(reflect.getAttribute('data-log')).toBe('log.reflectionOpen');
    reflect.click();
    expect(store.pendingRationale()?.handle).toBe(0);
    store.submitRationale({ rationale: 'x', response: 'yes' });
    fixture.detectChanges();
    expect(q(fixture, '.dl-entry .dl-reflect')).toBeNull();
    expect(q(fixture, '.dl-entry .dl-reflected')).toBeTruthy();
  });

  it('opens the entries and highlights the open ones on «Offene Reflexionen anzeigen»', () => {
    const fixture = create(true, { collapsedByDefault: ['widget.decision-log'] });
    store.recordProposalChoice(0, 'proceed');
    fixture.detectChanges();
    q(fixture, '.dl-show-open').click();
    TestBed.tick();
    fixture.detectChanges();
    expect(fixture.componentInstance.collapsed()).toBeFalse();
    expect(q(fixture, '.dl-entry.dl-entry--missing')).toBeTruthy();
  });

  it('does the same after a refused finish', () => {
    const fixture = create(true, { collapsedByDefault: ['widget.decision-log'] });
    store.recordProposalChoice(0, 'proceed');
    store.refuseFinishForOpenReflections();
    TestBed.tick();
    fixture.detectChanges();
    expect(q(fixture, '.dl-entry.dl-entry--missing')).toBeTruthy();
  });

  it('marks nothing in a tour that does not ask for reflections', () => {
    const fixture = create(false);
    store.recordProposalChoice(0, 'proceed');
    fixture.detectChanges();
    expect(q(fixture, '.dl-open-count')).toBeNull();
    expect(q(fixture, '.dl-reflect')).toBeNull();
  });
});

/** The reflection is asked below the entries, without pausing the run
 *  (docs/plans/reflection-inline.md §4.2, D20). */
describe('DecisionLogPanelComponent — the reflection', () => {
  let store: SessionStore;

  function create(reasonDialog: boolean) {
    TestBed.configureTestingModule({
      imports: [DecisionLogPanelComponent],
      providers: [
        ...provideTranslocoTesting(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTourContextStub(reasonDialog),
      ],
    });
    store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
    store.queueReflections.set(reasonDialog);
    const fixture = TestBed.createComponent(DecisionLogPanelComponent);
    fixture.componentInstance.embedded = true;
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('shows the open reflection below the entries, with its heading, and leaves the run playing', () => {
    const fixture = create(true);
    store.playing.set(true);
    store.recordProposalChoice(0, 'proceed');
    fixture.detectChanges();
    const section: HTMLElement = fixture.nativeElement.querySelector('.dl-reflection');
    expect(section).toBeTruthy();
    expect(section.querySelector('app-reflection-prompt .rp')).toBeTruthy();
    const list: HTMLElement = fixture.nativeElement.querySelector('.dl-list');
    expect(list.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(store.playing()).toBeTrue();
  });

  it('shows one at a time: a second decision only raises the open count', () => {
    const fixture = create(true);
    store.recordProposalChoice(0, 'proceed');
    store.recordProposalChoice(1, 'proceed');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.dl-reflection').length).toBe(1);
    expect(fixture.componentInstance.openCount()).toBe(2);
  });

  it('stays while the entries are hidden', () => {
    const fixture = create(true);
    store.recordProposalChoice(0, 'proceed');
    fixture.componentInstance.toggleCollapsed();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dl-list')).toBeNull();
    expect(fixture.nativeElement.querySelector('.dl-reflection')).toBeTruthy();
  });

  it('is gone once answered', () => {
    const fixture = create(true);
    store.recordProposalChoice(0, 'proceed');
    store.submitRationale({ rationale: '', response: 'no' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dl-reflection')).toBeNull();
  });

  it('is not shown in a tour that does not ask for reasons', () => {
    const fixture = create(false);
    store.recordProposalChoice(0, 'proceed');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dl-reflection')).toBeNull();
  });
});

/** A new reflection is brought into view inside its panel only
 *  (docs/plans/reflection-inline.md §4.2). */
describe('scrollIntoPanel', () => {
  let column: HTMLElement;

  afterEach(() => column.remove());

  it('scrolls the panel body to the reflection, and not the column around it', () => {
    column = document.createElement('div');
    column.style.cssText = 'height: 100px; overflow: auto';
    column.innerHTML = `
      <div class="layout-panel-shell__body--scroll" style="height: 150px; overflow: auto">
        <div style="height: 400px"></div>
        <section class="dl-reflection" style="height: 20px"></section>
      </div>
      <div style="height: 400px"></div>`;
    document.body.appendChild(column);
    const body = column.querySelector<HTMLElement>('.layout-panel-shell__body--scroll')!;
    scrollIntoPanel(column.querySelector<HTMLElement>('.dl-reflection')!);
    expect(body.scrollTop).toBeGreaterThan(0);
    expect(column.scrollTop).toBe(0);
  });

  it('leaves a reflection that is already in view where it is', () => {
    column = document.createElement('div');
    column.innerHTML = `
      <div class="layout-panel-shell__body--scroll" style="height: 150px; overflow: auto">
        <section class="dl-reflection" style="height: 20px"></section>
        <div style="height: 400px"></div>
      </div>`;
    document.body.appendChild(column);
    const body = column.querySelector<HTMLElement>('.layout-panel-shell__body--scroll')!;
    scrollIntoPanel(column.querySelector<HTMLElement>('.dl-reflection')!);
    expect(body.scrollTop).toBe(0);
  });
});
