import { Component, CUSTOM_ELEMENTS_SCHEMA, HostBinding, Input, computed, effect, inject, signal, DestroyRef } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { PanelInstance } from '../../core/layout/models/layout.models';
import { LanguageService } from '../../core/i18n/language.service';
import { SessionStore } from '../../core/session.store';
import { InteractionMode } from '../../core/events/event-types';
import { CENTER_VIEWS, CenterViewDef, centerViewByType } from './center-views';
import { UiStateRegistry } from '../../core/interaction-log/ui-state-registry.service';

/**
 * Default center view per interaction mode. Recommendation & Co-Learning work on
 * concrete trains/conflicts → the Map (Co-Learning's "my plan vs AI" compare is
 * drawn on the map, blue=you/yellow=AI). Director supervises goals at scale →
 * the Goal-Achievement dashboard. Applied only until the operator picks a tab.
 */
const MODE_DEFAULT_VIEW: Record<InteractionMode, string> = {
  recommendation: 'flatland-map',
  'co-learning': 'flatland-map',
  director: 'goal-achievement',
};

/** Panel settings this container reads, from a preset or the layout designer. */
interface ViewTabsSettings {
  /** View types shown as tabs, in this order. */
  tabs?: string[];
  /** The tab to open on until the operator picks one; ranks before the mode
   *  default (docs/plans/zwl-default.md §4.1). */
  defaultTab?: string;
  /** `'l'` for bigger tabs, e.g. where they stand in for a hidden panel title
   *  (§4.3); anything else is today's `'s'`. Named after Lyne's `size`. */
  tabSize?: 's' | 'l';
  /** Body height floor in px. */
  minBodyHeight?: number;
}

/**
 * View Tabs — a single center container that switches between the run's
 * situation views via a tab bar, instead of stacking them vertically.
 *
 * The tab set is data-driven, not hardwired: it comes from the panel's
 * `config.tabs` (a list of view types) when set, else every registered center
 * view (see center-views.ts). Rendering is generic via NgComponentOutlet, so the
 * container has no per-view code. Episodic / cross-cutting surfaces (reflection,
 * survey, chat) stay as overlays, not tabs. See docs/plans/center-view-tabs.md.
 * Source: from-scratch, deliberately.
 */
@Component({
  selector: 'app-view-tabs',
  standalone: true,
  imports: [NgComponentOutlet],
  templateUrl: './view-tabs.component.html',
  styleUrl: './view-tabs.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class ViewTabsComponent {
  private readonly store = inject(SessionStore);
  readonly i18n = inject(LanguageService);

  @Input() embedded = false;

  /** Panel context — carries `config.tabs` (selected view types) and is
   *  forwarded to views that need it (e.g. goal-achievement). */
  @Input() set panel(p: PanelInstance | null) {
    this._panel.set(p);
  }
  private readonly _panel = signal<PanelInstance | null>(null);
  private readonly _settings = computed<ViewTabsSettings>(
    () => (this._panel() as (PanelInstance & { settings?: ViewTabsSettings }) | null)?.settings ?? {},
  );

  constructor() {
    // On a mode switch, drop the manual tab pick so the mode's default view
    // (MODE_DEFAULT_VIEW) takes over. Within a mode, an explicit pick sticks.
    // Not on the first run: the pick starts empty anyway, and a replay may
    // just have set it through the UI state registry.
    let firstRun = true;
    effect(() => {
      this.store.interactionMode();
      if (firstRun) {
        firstRun = false;
        return;
      }
      this._activeType.set(null);
    });

    // A layout without view tabs has no centre tab to log.
    inject(DestroyRef).onDestroy(() => this.store.centerView.set(null));

    // Tell the store which of the two center views is on screen.
    //
    // `showMap` / `showMarey` were introduced for the `toggle-view` composite,
    // but they are read more widely than that: `activeHandle()` falls back to
    // the first agent only while the Marey is showing, and without that fallback
    // the Marey has no path axis and draws nothing at all until the operator
    // happens to select a train. A tab bar that never touched the signals
    // therefore opened an empty ZWL — see the Combined Actions preset, whose
    // consequence overlay lives in exactly that view.
    effect(() => {
      const type = this.active()?.type;
      // For the screen log, which tab this is, whichever view it shows.
      this.store.centerView.set(type ?? null);
      if (type !== 'flatland-map' && type !== 'marey') return;
      this.store.showMap.set(type === 'flatland-map');
      this.store.showMarey.set(type === 'marey');
    });
  }

  /** The tabs to show: the configured subset (from the layout designer, stored
   *  in `settings.tabs`, or `config.tabs`), else all registered center views. */
  readonly tabs = computed<CenterViewDef[]>(() => {
    const configured = this._settings().tabs ?? (this._panel()?.config?.['tabs'] as string[] | undefined);
    const types = configured && configured.length ? configured : CENTER_VIEWS.map((v) => v.type);
    // Deduplicated: a retired type resolves to its successor (`marey` → ZWL),
    // and a saved layout may list both.
    const views = types.map((t) => centerViewByType(t)).filter((v): v is CenterViewDef => !!v);
    return views.filter((v, i) => views.indexOf(v) === i);
  });

  /** Optional body height floor (px) from `settings.minBodyHeight`. Without it a
   *  map tab takes its height from the network's aspect ratio, which turns a long
   *  corridor into a hairline. */
  readonly minBodyHeight = computed<number | null>(() => this._settings().minBodyHeight ?? null);

  /** Bigger tabs (`settings.tabSize: 'l'`), as the Plan B layout asks for. */
  readonly largeTabs = computed(() => this._settings().tabSize === 'l');

  /** The panel's translated title, the tab bar's accessible name: it stays
   *  when a layout hides the visible title (`widget.view-tabs.title`). */
  readonly tabBarLabel = computed(() => {
    const p = this._panel();
    return p ? this.i18n.panelTitle(p) : null;
  });

  private readonly _activeType = signal<string | null>(null);
  private readonly _uiState = inject(UiStateRegistry).register('panel.view-tabs.tab', this._activeType, inject(DestroyRef));

  /** Active view: the operator's explicit pick if still present; else the
   *  layout's `settings.defaultTab`; else the current mode's default view
   *  (MODE_DEFAULT_VIEW); else the first tab. */
  readonly active = computed<CenterViewDef | null>(() => {
    const tabs = this.tabs();
    if (!tabs.length) return null;
    const picked = this._activeType();
    if (picked) {
      const hit = tabs.find((t) => t.type === picked);
      if (hit) return hit;
    }
    const layoutDefault = this._settings().defaultTab;
    const layoutHit = layoutDefault ? tabs.find((t) => t === centerViewByType(layoutDefault)) : undefined;
    if (layoutHit) return layoutHit;
    const modeDefault = MODE_DEFAULT_VIEW[this.store.interactionMode()];
    return tabs.find((t) => t.type === modeDefault) ?? tabs[0];
  });

  readonly activeComponent = computed(() => this.active()?.component ?? null);
  readonly activeInputs = computed<Record<string, unknown>>(() =>
    this.active()?.inputs?.({ panel: this._panel() }) ?? {},
  );

  @HostBinding('class.view-tabs--size-l')
  get largeTabsClass(): boolean {
    return this.largeTabs();
  }

  @HostBinding('class.embedded')
  get embeddedClass(): boolean {
    return this.embedded;
  }

  select(type: string): void {
    this._activeType.set(type);
  }
}
