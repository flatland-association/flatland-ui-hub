import { Component, Input, OnDestroy, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SessionStore } from '../../core/session.store';
import { TrainIdentityService } from '../../core/train-identity.service';
import { LanguageService } from '../../core/i18n/language.service';
import { DirectorStrategy } from '../../core/api.service';
import { FOCUS_LABEL } from '../../core/director-strategy-copy';
import { MINUTES_PER_STEP } from '../../core/combined-actions/combined-actions-preview';
import { DivergenceRow, divergenceRows, placeNear } from '../../core/director-divergence';

/**
 * "Was ändert sich" — which trains a Director option changes, and how
 * (docs/plans/widget-b6-director-divergence.md, catalog B6).
 *
 * A companion under the track map: the map shows *where* an option departs from
 * the running plan, this list says *who* and *how* — waits, and routes that
 * branch off. Read-only: the lever is the objective in `strategy-options`.
 *
 * Follows the option under "Vorschau"; otherwise the first option that changes
 * anything. The A/B/C switch here only picks which list to read — it neither
 * previews nor takes over. Pointing at a row draws that train's route on the map
 * when its option is the one previewed (`directorHoverHandle`), and otherwise
 * highlights the train only, because the route belongs to the previewed option.
 *
 * Source: from-scratch, deliberately — presentation over the backend's
 * `DirectorDivergence`, the same payload the map's branch marks and option bars
 * read.
 */
@Component({
  selector: 'app-director-divergence',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './director-divergence.component.html',
  styleUrl: './director-divergence.component.scss',
})
export class DirectorDivergenceComponent implements OnDestroy {
  readonly store = inject(SessionStore);
  private readonly identity = inject(TrainIdentityService);
  private readonly i18n = inject(LanguageService);

  @Input() embedded = false;

  /** The option picked here; null = follow the preview, else the first that changes something. */
  private readonly picked = signal<string | null>(null);

  /** Planned options only — an unplanned one has nothing to list yet. */
  readonly options = computed(() => this.store.directorStrategies().filter((s) => s.plan !== null));

  readonly shown = computed<DirectorStrategy | null>(() => {
    const options = this.options();
    const byId = (id: string | null) => (id ? options.find((s) => s.id === id) ?? null : null);
    return (
      byId(this.picked())
      ?? byId(this.store.directorPreviewStrategyId())
      ?? options.find((s) => divergenceRows(s.divergence, 0).length > 0)
      ?? options[0]
      ?? null
    );
  });

  /** Whether the shown option is the one drawn on the map — then rows draw routes. */
  readonly isOnMap = computed(() => {
    const shown = this.shown();
    return !!shown && shown.id === this.store.directorPreviewStrategyId() && !!this.store.directorPreviewDivergence();
  });

  readonly rows = computed(() => {
    const shown = this.shown();
    if (!shown) return [];
    const now = this.store.elapsedSteps();
    const geo = this.store.geography();
    return divergenceRows(shown.divergence, now).map((r) => ({
      ...r,
      name: this.identity.nameFor(r.handle),
      place: placeNear(geo, r.row, r.col),
      waitMin: r.waitSteps != null ? r.waitSteps * MINUTES_PER_STEP : null,
      inMin: r.inSteps != null ? r.inSteps * MINUTES_PER_STEP : null,
    }));
  });

  readonly planning = computed(() => this.options().length === 0);

  focusLabel(s: DirectorStrategy): string {
    return this.i18n.t(FOCUS_LABEL[s.focus]);
  }

  pick(id: string): void {
    this.picked.set(id);
  }

  onRowEnter(row: DivergenceRow): void {
    if (this.isOnMap()) this.store.directorHoverHandle.set(row.handle);
    else this.store.setAgentHoverAgent(row.handle);
  }

  onRowLeave(): void {
    this.store.directorHoverHandle.set(null);
    this.store.clearAgentHoverAgents();
  }

  trackRow(_: number, r: DivergenceRow): string {
    return `${r.kind}:${r.handle}`;
  }

  ngOnDestroy(): void {
    this.onRowLeave();
  }
}
