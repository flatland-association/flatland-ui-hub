import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { SessionStore } from '../session.store';
import { ProposalOption } from '../events/event-types';
import { PanelFrameService } from '../layout/panel-frame';
import { ReplayService } from '../replay/replay.service';

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
    this.openPanel();
  }

  /**
   * While the impact analysis lists the train it also says whether a reroute
   * exists. Without an entry the backend decides, and explains a refusal.
   */
  rerouteAvailable(handle: number | null): boolean {
    const item = this.store.impact().find((i) => i.handle === handle);
    return item ? item.can_reroute : true;
  }
}
