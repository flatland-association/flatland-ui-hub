import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { SessionStore } from '../session.store';
import { ProposalOption } from '../events/event-types';
import { PanelFrameService } from '../layout/panel-frame';
import { ReplayService } from '../replay/replay.service';
import type { DrawnRoute } from '../routing/route-drawing';

/**
 * The option the operator is looking at for one train, shared by the surfaces
 * that let them pick it: the Plan / KI / Mensch panel and the option strip at the
 * selected train on the map.
 *
 * Picking is a question ("what would this do?"), not a decision: the panel
 * simulates it, and committing stays in the panel, where the comparison is.
 *
 * Keyed by handle, so selecting another train drops the choice without either
 * surface having to clear it.
 *
 * New options open «Handlungsoptionen» again after a choice closed it: another
 * train is selected, from any surface, or a train is newly affected. Here and
 * not in the panel, which a closed frame drops (docs/plans/reflection-inline.md
 * §4.8, D25); created at startup (`app.config.ts`) for that reason.
 */
@Injectable({ providedIn: 'root' })
export class ProposalChoiceService {
  private readonly store = inject(SessionStore);
  private readonly choice = signal<{ handle: number; option: ProposalOption } | null>(null);
  private readonly frames = inject(PanelFrameService);
  private readonly replay = inject(ReplayService);

  constructor() {
    let lastHandle: number | null = null;
    effect(() => {
      const handle = this.store.selectedHandle();
      untracked(() => {
        if (handle != null && handle !== lastHandle) this.openPanel();
        lastHandle = handle;
      });
    });
    // Route mode belongs to one train: selecting another ends it.
    effect(() => {
      const handle = this.store.selectedHandle();
      untracked(() => {
        const drawing = this.store.routeDrawing();
        if (drawing && drawing.handle !== handle) this.store.routeDrawing.set(null);
      });
    });
    let affected = new Set<number>();
    effect(() => {
      const now = new Set(this.store.impact().map((i) => i.handle));
      untracked(() => {
        if ([...now].some((h) => !affected.has(h))) this.openPanel();
        affected = now;
      });
    });
  }

  /** Not in a replay, which restores the recorded state itself. */
  private openPanel(): void {
    if (!this.replay.active()) this.frames.setExpanded('proposal-compare', true);
  }

  /** The option picked for the currently selected train, if any. */
  readonly current = computed(() => {
    const handle = this.store.selectedHandle();
    const choice = this.choice();
    return choice && choice.handle === handle ? choice.option : null;
  });

  /** Pick `option` for `handle`, selecting the train if it is not yet. The
   *  comparison is in the panel, so it opens, also for the train still
   *  selected after a course was taken (the map's «… · im Panel vergleichen»). */
  choose(handle: number, option: ProposalOption): void {
    if (option === 'reroute' && !this.rerouteAvailable(handle)) return;
    if (this.store.selectedHandle() !== handle) this.store.selectedHandle.set(handle);
    this.choice.set({ handle, option });
    // «Umleiten» is drawn: the map goes into route mode for this train, and the
    // Mensch course waits for the drawn route (docs/plans/set-route-on-map.md).
    this.store.routeDrawing.set(option === 'reroute' ? { handle, nodes: [], via: null } : null);
    this.openPanel();
  }

  /** Leave route mode without a route (Esc); the option stays picked. */
  cancelRouteDrawing(): void {
    this.store.routeDrawing.set(null);
  }

  /** The via cells drawn for the selected train, once the drag ended. */
  readonly drawnVia = computed(() => {
    const drawing = this.store.routeDrawing();
    return drawing && drawing.handle === this.store.selectedHandle() ? drawing.via : null;
  });

  /** The finished drawing for the selected train, as the backend takes it:
   *  the via cells and the cell and heading the drawing began at. */
  readonly drawnRoute = computed<DrawnRoute | null>(() => {
    const via = this.drawnVia();
    const start = this.store.routeDrawing()?.nodes[0];
    return via && start ? { via, start } : null;
  });

  /**
   * A route can always be drawn (set-route-on-map, Q-5): for a train on the
   * map or waiting at its origin, not only around a block. Not for a train that
   * has arrived.
   */
  rerouteAvailable(handle: number | null): boolean {
    if (handle == null) return false;
    return this.store.agents().find((a) => a.handle === handle)?.state !== 'DONE';
  }
}
