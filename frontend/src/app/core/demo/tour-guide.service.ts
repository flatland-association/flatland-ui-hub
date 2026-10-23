import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ONLINE_POLICY_ID, OnlineLearningService } from '../online-learning.service';
import { SessionStore } from '../session.store';
import { TourContextService } from './tour-context.service';
import { GuideStepId, TourGuideStep } from './tour-briefings';

/**
 * Progress through the running tour's guide (`TourBriefing.guide`).
 *
 * A step is ticked when the run shows it actually happened, read from the same
 * signals the panels use, and a tick is never taken back. Steps marked
 * `afterEpisode` are not ticked here. The current step drives the hint and the
 * panel highlight.
 */
@Injectable({ providedIn: 'root' })
export class TourGuideService {
  private readonly store = inject(SessionStore);
  private readonly tour = inject(TourContextService);
  private readonly learning = inject(OnlineLearningService);
  private readonly _done = signal<ReadonlySet<GuideStepId>>(new Set());
  /** Step at which the session first ran under the online policy. */
  private readonly _onlineSince = signal<number | null>(null);

  readonly steps = computed<TourGuideStep[]>(() => this.tour.briefing()?.guide ?? []);
  readonly active = computed(() => this.steps().length > 0);
  readonly done = this._done.asReadonly();

  /** First step not yet experienced. During the run, steps that belong after the
   *  episode are skipped; once the shift is over they are next in line. */
  readonly current = computed<TourGuideStep | null>(() => {
    const afterShift = this.store.shiftReviewOpen();
    return this.steps().find((s) => (afterShift || !s.afterEpisode) && !this._done().has(s.id)) ?? null;
  });

  /** Every step that happens during the run is done. */
  readonly liveDone = computed(
    () => this.active() && this.steps().filter((s) => !s.afterEpisode).every((s) => this._done().has(s.id)),
  );

  /** For steps the run cannot observe on its own (the debrief sections). */
  markDone(id: GuideStepId): void {
    if (this._done().has(id)) return;
    this._done.set(new Set([...this._done(), id]));
  }

  readonly highlightPanelType = computed(() => this.current()?.panelType ?? null);

  private readonly reached = computed<Set<GuideStepId>>(() => {
    const reached = new Set<GuideStepId>();
    const malfunction = this.store
      .agents()
      .some((a) => !!a.is_malfunctioning || (a.malfunction_remaining ?? 0) > 0);
    const impact = this.store.impact().length > 0;
    if (malfunction || impact) reached.add('detect');
    if (impact) {
      reached.add('assess');
      reached.add('alternatives');
    }
    const human = this.store.decisionLog().filter((e) => e.accountableOwner === 'human');
    if (human.length > 0) reached.add('decide');
    const step = this.store.elapsedSteps();
    if (human.some((e) => step > e.simStep)) reached.add('execute');
    if (human.some((e) => !!e.rationale)) reached.add('reflect');
    // Only a card from this shift: confirmed cards persist in the browser, and
    // one from an earlier shift (or visitor) must not tick the step in advance.
    const since = this.tour.shiftStartedAt();
    if (this.store.learningRecords().some((r) => r.createdAt >= since)) reached.add('ai-learns');

    // Online learning steps, read from the learner's status.
    const online = this.learning.status();
    if (online?.alive) reached.add('learn-start');
    if (online?.alive && (online.stable_version ?? 0) >= 1) reached.add('learn-update');
    const onlineSince = this._onlineSince();
    if (onlineSince != null) {
      reached.add('learn-drive');
      if (step >= onlineSince + 20) reached.add('learn-watch');
      if ((online?.buffers?.['user_interaction_buffer'] ?? 0) > 0 || human.some((e) => e.simStep >= onlineSince)) {
        reached.add('learn-intervene');
      }
    }
    return reached;
  });

  constructor() {
    effect(() => {
      this.store.session()?.id;
      this.tour.briefing();
      untracked(() => {
        this._done.set(new Set());
        this._onlineSince.set(null);
      });
    });

    // A tour with online-learning steps keeps the learner's status fresh.
    let release: (() => void) | null = null;
    effect(() => {
      const wantsLearner = this.steps().some((s) => s.id.startsWith('learn-'));
      untracked(() => {
        if (wantsLearner && !release) release = this.learning.use();
        if (!wantsLearner && release) {
          release();
          release = null;
        }
      });
    });

    effect(() => {
      const online = this.store.activePolicy() === ONLINE_POLICY_ID;
      const step = this.store.elapsedSteps();
      untracked(() => {
        if (online && this._onlineSince() == null) this._onlineSince.set(step);
      });
    });

    effect(() => {
      if (!this.active()) return;
      const reached = this.reached();
      untracked(() => {
        const done = this._done();
        if ([...reached].every((id) => done.has(id))) return;
        this._done.set(new Set([...done, ...reached]));
      });
    });
  }
}
