import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
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
  private readonly _done = signal<ReadonlySet<GuideStepId>>(new Set());

  readonly steps = computed<TourGuideStep[]>(() => this.tour.briefing()?.guide ?? []);
  readonly active = computed(() => this.steps().length > 0);
  readonly done = this._done.asReadonly();

  /** The guide is one flow over all legs of the tour (steps name their leg). */
  readonly crossLeg = computed(() => this.steps().some((s) => s.leg != null));
  private inLeg(s: TourGuideStep): boolean {
    return s.leg == null || s.leg === this.store.demoStepIndex();
  }

  /** First step not yet experienced. During the run, steps that belong after the
   *  episode are skipped; once the shift is over they are next in line. */
  readonly current = computed<TourGuideStep | null>(() => {
    const afterShift = this.store.shiftReviewOpen();
    return (
      this.steps().find((s) => this.inLeg(s) && (afterShift || !s.afterEpisode) && !this._done().has(s.id)) ?? null
    );
  });

  /** Every step that happens during the run (of this leg) is done. */
  readonly liveDone = computed(
    () =>
      this.active() &&
      this.steps().filter((s) => this.inLeg(s) && !s.afterEpisode).every((s) => this._done().has(s.id)),
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
    // MARL lab: the learned policy drives; the run is watched to its end, a
    // train is looked at, overruled, the outcome compared, the new model driven.
    const learned = this.store.activePolicyIsLearned();
    const over = this.store.shiftReviewOpen();
    if (learned && over) reached.add('watch-ai');
    if (learned && this.store.selectedHandle() != null) reached.add('ai-pick');
    if (learned && human.length > 0) reached.add('intervene');
    if (human.length > 0 && over) reached.add('compare');
    if (learned && over && this.store.activePolicy().startsWith('lab:')) reached.add('replay');
    return reached;
  });

  constructor() {
    // A new shift starts the guide again — unless the guide spans the legs,
    // where the next leg's session continues the same flow.
    effect(() => {
      this.store.session()?.id;
      untracked(() => {
        if (!this.crossLeg()) this._done.set(new Set());
      });
    });
    effect(() => {
      this.tour.briefing();
      untracked(() => this._done.set(new Set()));
    });

    effect(() => {
      if (!this.active()) return;
      const reached = this.reached();
      untracked(() => {
        // A step of another leg never ticks here (watching to the end in leg 2
        // is not leg 1's "watch the AI").
        const own = new Set(this.steps().filter((s) => this.inLeg(s)).map((s) => s.id));
        const fresh = [...reached].filter((id) => own.has(id));
        const done = this._done();
        if (fresh.every((id) => done.has(id))) return;
        this._done.set(new Set([...done, ...fresh]));
      });
    });
  }
}
