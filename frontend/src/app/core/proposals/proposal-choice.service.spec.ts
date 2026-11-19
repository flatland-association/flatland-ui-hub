import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ImpactItem } from '../events/event-types';
import { PanelFrameService } from '../layout/panel-frame';
import { ReplayService } from '../replay/replay.service';
import { SessionStore } from '../session.store';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { ProposalChoiceService } from './proposal-choice.service';

/** New options open «Handlungsoptionen» again, from outside the panel, which a
 *  closed frame does not render (docs/plans/reflection-inline.md §4.8, D25). */
describe('ProposalChoiceService — opening «Handlungsoptionen»', () => {
  let setExpanded: jasmine.Spy;
  let store: SessionStore;

  function create(replaying = false) {
    TestBed.configureTestingModule({
      providers: [
        ...provideTranslocoTesting(),
        provideHttpClient(),
        provideHttpClientTesting(),
        ...(replaying ? [{ provide: ReplayService, useValue: { active: () => true } }] : []),
      ],
    });
    setExpanded = spyOn(TestBed.inject(PanelFrameService), 'setExpanded');
    store = TestBed.inject(SessionStore);
    TestBed.inject(ProposalChoiceService);
    TestBed.tick();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('opens it when another train is selected', () => {
    create();
    store.selectedHandle.set(0);
    TestBed.tick();
    store.selectedHandle.set(1);
    TestBed.tick();
    expect(setExpanded.calls.allArgs()).toEqual([['proposal-compare', true], ['proposal-compare', true]]);
  });

  it('opens it when a train is newly affected, not when one leaves', () => {
    create();
    store.impact.set([{ handle: 2 } as ImpactItem]);
    TestBed.tick();
    expect(setExpanded).toHaveBeenCalledOnceWith('proposal-compare', true);
    setExpanded.calls.reset();
    store.impact.set([]);
    TestBed.tick();
    expect(setExpanded).not.toHaveBeenCalled();
  });

  it('opens it when an option is picked for the train still selected', () => {
    create();
    store.selectedHandle.set(0);
    TestBed.tick();
    setExpanded.calls.reset(); // a course was taken: the panel closed itself
    TestBed.inject(ProposalChoiceService).choose(0, 'hold');
    expect(setExpanded).toHaveBeenCalledOnceWith('proposal-compare', true);
  });

  it('leaves it alone in a replay', () => {
    create(true);
    store.selectedHandle.set(0);
    store.impact.set([{ handle: 2 } as ImpactItem]);
    TestBed.tick();
    expect(setExpanded).not.toHaveBeenCalled();
  });
});

/** «Umleiten» is drawn on the map (docs/plans/set-route-on-map.md §4.3). */
describe('ProposalChoiceService — route mode', () => {
  let store: SessionStore;
  let choice: ProposalChoiceService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(SessionStore);
    choice = TestBed.inject(ProposalChoiceService);
    TestBed.tick();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('starts route mode for «Umleiten» and ends it for another option', () => {
    choice.choose(1, 'reroute');
    expect(store.routeDrawing()).toEqual({ handle: 1, nodes: [], via: null });
    choice.choose(1, 'hold');
    expect(store.routeDrawing()).toBeNull();
  });

  it('gives the via cells only for the selected train, and drops route mode with another selection', () => {
    choice.choose(1, 'reroute');
    store.routeDrawing.set({ handle: 1, nodes: [], via: [[1, 14]] });
    expect(choice.drawnVia()).toEqual([[1, 14]]);
    store.selectedHandle.set(0);
    TestBed.tick();
    expect(store.routeDrawing()).toBeNull();
    expect(choice.drawnVia()).toBeNull();
  });

  it('gives the drawn route with the cell and heading the drawing began at', () => {
    choice.choose(1, 'reroute');
    expect(choice.drawnRoute()).toBeNull(); // nothing drawn yet
    store.routeDrawing.set({ handle: 1, nodes: [[2, 21, 3], [2, 20, 3]], via: [[1, 14]] });
    expect(choice.drawnRoute()).toEqual({ via: [[1, 14]], start: [2, 21, 3] });
  });

  it('lets a route be drawn without a block, not for a train that arrived', () => {
    store.state.set({ agents: [{ handle: 1, state: 'DONE' }] } as never);
    expect(choice.rerouteAvailable(0)).toBeTrue();
    expect(choice.rerouteAvailable(1)).toBeFalse();
    expect(choice.rerouteAvailable(null)).toBeFalse();
  });
});
