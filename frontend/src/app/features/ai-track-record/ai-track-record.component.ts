import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, computed, effect, inject, signal, untracked } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ApiService } from '../../core/api.service';
import { LabOutcome, LabReview } from '../../core/models';
import { SessionStore } from '../../core/session.store';

/**
 * AI Track Record (catalog A3, first cut) — the MARL lab review.
 * Spec: docs/plans/widget-a3-ai-track-record.md; plan: docs/plans/marl-lab-plan.md, step 4.
 *
 * How the human and the learned policy worked together in this session: how
 * often the human stepped in, how often they agreed with the AI, and the run
 * "with you" against "AI alone" (forked at the first intervention) and against
 * the checkpoint this one was trained from. The numbers are the same in every
 * mode; only the framing follows the mode's authority.
 *
 * The counts are cheap and follow the step. The outcomes fork and roll the env
 * to the episode end (seconds on Olten), so they run on request and once when
 * the episode ends.
 */
type Framing = 'followed' | 'same' | 'tookOver';

@Component({
  selector: 'app-ai-track-record',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './ai-track-record.component.html',
  styleUrl: './ai-track-record.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class AiTrackRecordComponent {
  @Input() embedded = false;

  readonly store = inject(SessionStore);
  private readonly api = inject(ApiService);

  /** The single place this widget branches on mode. */
  readonly modeBehavior = computed<{ framing: Framing; summaryKey: string }>(() => {
    switch (this.store.interactionMode()) {
      case 'recommendation':
        return { framing: 'followed', summaryKey: 'lab.review.summary.recommendation' };
      case 'co-learning':
        return { framing: 'same', summaryKey: 'lab.review.summary.coLearning' };
      case 'director':
        return { framing: 'tookOver', summaryKey: 'lab.review.summary.director' };
    }
  });

  readonly review = signal<LabReview | null>(null);
  readonly outcomes = signal<LabOutcome[] | null>(null);
  readonly outcomesLoading = signal(false);
  readonly outcomeError = signal<string | null>(null);

  /** Shown at all: a learned policy drives, or one did and left interventions. */
  readonly relevant = computed(() => this.store.activePolicyIsLearned() || (this.review()?.interventions ?? 0) > 0);

  readonly agreementPercent = computed(() => Math.round((this.review()?.agreementRate ?? 0) * 100));

  private countsKey: string | null = null;
  private countsInFlight = false;
  private outcomesForSession: string | null = null;

  constructor() {
    effect(() => {
      const sid = this.store.session()?.id ?? null;
      const key = sid ? `${sid}|${this.store.elapsedSteps()}|${this.store.activePolicy()}` : null;
      untracked(() => this.loadCounts(key));
    });
    // A new session or a reset drops the old comparison.
    effect(() => {
      const sid = this.store.session()?.id ?? null;
      const step = this.store.elapsedSteps();
      untracked(() => {
        if (sid !== this.outcomesForSession || step === 0) {
          this.outcomes.set(null);
          this.outcomeError.set(null);
          this.outcomesForSession = sid;
        }
      });
    });
    // Compare once, when the run is over.
    effect(() => {
      const done = this.store.episodeDone();
      untracked(() => {
        if (done && this.relevant() && !this.outcomes() && !this.outcomesLoading()) this.compare();
      });
    });
  }

  private loadCounts(key: string | null): void {
    this.countsKey = key;
    if (!key || this.countsInFlight) return;
    const sid = key.split('|')[0];
    this.countsInFlight = true;
    this.api.getLabReview(sid, false).subscribe({
      next: (r) => this.finishCounts(key, r),
      error: () => this.finishCounts(key, null),
    });
  }

  private finishCounts(key: string, review: LabReview | null): void {
    this.countsInFlight = false;
    if (review) this.review.set(review);
    if (this.countsKey && this.countsKey !== key) this.loadCounts(this.countsKey);
  }

  /** Fork and roll the three outcomes to the episode end. */
  compare(): void {
    const sid = this.store.session()?.id;
    if (!sid || this.outcomesLoading()) return;
    this.outcomesLoading.set(true);
    this.outcomeError.set(null);
    this.api.getLabReview(sid, true).subscribe({
      next: (r) => {
        this.review.set(r);
        this.outcomes.set(r.outcomes);
        this.outcomeError.set(r.outcomeError ?? null);
        this.outcomesLoading.set(false);
      },
      error: () => {
        this.outcomeError.set('request');
        this.outcomesLoading.set(false);
      },
    });
  }

  outcomeLabelKey(o: LabOutcome): string {
    switch (o.id) {
      case 'with-you':
        return 'lab.review.outcome.withYou';
      case 'ai-alone':
        return 'lab.review.outcome.aiAlone';
      case 'previous-checkpoint':
        return 'lab.review.outcome.previous';
    }
  }

  /** The row with the most arrivals, then the least lateness, is marked. */
  readonly bestOutcomeId = computed<string | null>(() => {
    const rows = this.outcomes();
    if (!rows || rows.length < 2) return null;
    const best = [...rows].sort((a, b) => b.arrived - a.arrived || a.lateness - b.lateness)[0];
    const tied = rows.filter((r) => r.arrived === best.arrived && r.lateness === best.lateness);
    return tied.length > 1 ? null : best.id;
  });
}
