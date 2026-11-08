import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PanelInstance } from '../../core/layout/models/layout.models';
import { SessionStore } from '../../core/session.store';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { ViewTabsComponent } from './view-tabs.component';

/** A centre panel as a preset places it; only the settings vary. */
function panel(settings: Record<string, unknown>): PanelInstance {
  return { id: 'p', type: 'view-tabs', title: 'Streckenspiegel & ZWL', settings } as unknown as PanelInstance;
}

// The computed state only: rendering would build the map and the ZWL.
describe('ViewTabsComponent — which tab opens, and how big the tabs are', () => {
  let cmp: ViewTabsComponent;
  let store: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ViewTabsComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    cmp = TestBed.createComponent(ViewTabsComponent).componentInstance;
    store = TestBed.inject(SessionStore);
    store.interactionMode.set('co-learning');
  });

  const active = () => cmp.active()?.type;

  it('lists the configured tabs in their order', () => {
    cmp.panel = panel({ tabs: ['zug-weg-diagramm', 'flatland-map'] });
    expect(cmp.tabs().map((t) => t.type)).toEqual(['zug-weg-diagramm', 'flatland-map']);
  });

  it("opens on the mode's view when the layout names no default", () => {
    cmp.panel = panel({ tabs: ['zug-weg-diagramm', 'flatland-map'] });
    expect(active()).toBe('flatland-map');
  });

  it("opens on the layout's default tab before the mode's view (#168)", () => {
    cmp.panel = panel({ tabs: ['flatland-map', 'zug-weg-diagramm'], defaultTab: 'zug-weg-diagramm' });
    expect(active()).toBe('zug-weg-diagramm');
  });

  it("resolves a retired type in the default, as in the tab list", () => {
    cmp.panel = panel({ tabs: ['flatland-map', 'marey'], defaultTab: 'marey' });
    expect(active()).toBe('zug-weg-diagramm');
  });

  it("ignores a default that is not one of the tabs", () => {
    cmp.panel = panel({ tabs: ['flatland-map', 'zug-weg-diagramm'], defaultTab: 'timetable' });
    expect(active()).toBe('flatland-map');
  });

  it("keeps the participant's pick over the layout's default", () => {
    cmp.panel = panel({ tabs: ['zug-weg-diagramm', 'flatland-map'], defaultTab: 'zug-weg-diagramm' });
    cmp.select('flatland-map');
    expect(active()).toBe('flatland-map');
  });

  it("returns to the layout's default after a mode switch", () => {
    TestBed.tick();
    cmp.panel = panel({ tabs: ['zug-weg-diagramm', 'flatland-map'], defaultTab: 'zug-weg-diagramm' });
    cmp.select('flatland-map');
    store.interactionMode.set('recommendation');
    TestBed.tick();
    expect(active()).toBe('zug-weg-diagramm');
  });

  it("makes the tabs bigger only with tabSize 'l'", () => {
    cmp.panel = panel({});
    expect(cmp.largeTabs()).toBeFalse();
    cmp.panel = panel({ tabSize: 'l' });
    expect(cmp.largeTabs()).toBeTrue();
    cmp.panel = panel({ tabSize: 'xl' });
    expect(cmp.largeTabs()).toBeFalse();
  });

  it("names the tab bar after the panel, whose title may be hidden", () => {
    cmp.panel = panel({});
    expect(cmp.tabBarLabel()).toBeTruthy();
  });
});
