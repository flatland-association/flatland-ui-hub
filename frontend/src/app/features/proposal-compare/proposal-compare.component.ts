import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, HostBinding, Input, OnDestroy, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageService } from '../../core/i18n/language.service';
import { ProposalSnapshot, SessionStore } from '../../core/session.store';
import { UiConfigService } from '../../core/config/ui-config.service';
import { TrainIdentityService } from '../../core/train-identity.service';
import { TrainActionService } from '../../core/dispatch/train-action.service';
import { ApiService } from '../../core/api.service';
import { AgentColorService } from '../../core/agent-color.service';
import { REROUTE_ACTION } from '../../core/models';
import { ProposalOption, ProposalsResult, ProposalVariant } from '../../core/events/event-types';
import { ProposalChoiceService } from '../../core/proposals/proposal-choice.service';
import { PanelFrameService } from '../../core/layout/panel-frame';
import { ReplayService } from '../../core/replay/replay.service';

/** One option the operator can put next to the plan and the AI. */
interface OptionChoice {
  option: ProposalOption;
  label: string;
  hint: string;
}

/** One bar in the comparison: a course's value on one axis. `value` is null when
 *  the number would not be comparable — a lateness sum over the trains that did
 *  arrive looks *better* the more trains a course strands. */
interface ComparisonBar {
  id: string;
  label: string;
  value: number | null;
  /** Share of the widest bar on this axis, so the axes stay comparable within
   *  themselves rather than against each other. */
  pct: number;
}

interface ComparisonAxis {
  id: 'lateness' | 'time';
  label: string;
  unit: string;
  bars: ComparisonBar[];
}

/** Translation keys for the three course names. */
const VARIANT_LABEL: Record<string, string> = { plan: 'proposals.plan', ai: 'proposals.ai', human: 'proposals.human' };

/**
 * Widget B1, second cut — **Handlungsoptionen** (formerly «Handlungsvergleich», «Plan / KI / Mensch»).
 *
 * Three courses for the selected train, each simulated to the same horizon by
 * `GET /session/{id}/proposals` (docs/plans/proposal-agents-roadmap.md, 2b):
 *
 *  - **Plan** (neutral grey): the timetable plan running on — nobody's proposal.
 *  - **KI** (yellow): a Prioritized Planning replan of every train. The order the
 *    trains take the single-track section is the decision, so the further orders
 *    come along as ranked alternatives.
 *  - **Mensch** (blue): the operator's option — hold, hold until clear, proceed,
 *    reroute — on top of the plan.
 *
 * Colours follow the A3S/TraceRL convention (human blue, AI yellow); the plan is
 * the third course and stays neutral.
 *
 * Separate from `whatif-compare` on purpose: that widget is what the User Study 2
 * conditions show, and this one is the interview layout's surface. They share the
 * backend's branch simulation, not their framing.
 *
 * Reading only — nothing is committed until "Übernehmen".
 *
 * The reflection a decision here asks for is answered in the decision log,
 * not in this panel (docs/plans/reflection-inline.md §4.2, D20). Once a course
 * is taken the panel closes; `ProposalChoiceService` opens it again when new
 * options come up (§4.8, D25).
 */
@Component({
  selector: 'app-proposal-compare',
  standalone: true,
  imports: [TranslocoPipe, CommonModule],
  templateUrl: './proposal-compare.component.html',
  styleUrl: './proposal-compare.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class ProposalCompareComponent implements OnDestroy {
  @Input() embedded = false;
  /** A decided choice, shown read-only: what the panel showed when the course
   *  was taken, without anything to pick or take (§4.8, D26). */
  readonly decided = input<ProposalSnapshot | null>(null);

  @HostBinding('class.embedded')
  get embeddedClass(): boolean {
    return this.embedded;
  }

  store = inject(SessionStore);
  private readonly uiConfig = inject(UiConfigService);

  private readonly i18n = inject(LanguageService);
  private api = inject(ApiService);
  private trainActions = inject(TrainActionService);
  private colors = inject(AgentColorService);
  private identity = inject(TrainIdentityService);
  /** The picked option lives here, so the map's option strip can pick it too. */
  private choice = inject(ProposalChoiceService);
  /** Closes this panel's frame after a choice (D25). */
  private readonly frames = inject(PanelFrameService);
  private readonly replay = inject(ReplayService);

  /** Flatland action ints behind the committable options. */
  private static readonly STOP = 4;

  readonly optionChoices: OptionChoice[] = [
    // label / hint are translation keys, resolved in the template.
    { option: 'hold', label: 'proposals.option.hold', hint: 'proposals.option.holdHint' },
    { option: 'hold_until_clear', label: 'proposals.option.holdUntilClear', hint: 'proposals.option.holdUntilClearHint' },
    { option: 'proceed', label: 'proposals.option.proceed', hint: 'proposals.option.proceedHint' },
    { option: 'reroute', label: 'proposals.option.reroute', hint: 'proposals.option.rerouteHint' },
  ];

  readonly chosenOption = computed(() => (this.decided() ? this.decided()!.option : this.choice.current()));
  private readonly liveResult = signal<ProposalsResult | null>(null);
  /** The courses shown: the decided ones, or the live ones. */
  readonly result = computed(() => this.decided()?.result ?? this.liveResult());
  readonly loading = signal(false);
  readonly failed = signal<string | null>(null);
  readonly committed = signal(false);
  /** Alternatives are the detail: shown on request, not by default. */
  readonly showAlternatives = signal(false);
  /** Ignore a previous train/option/session's slower forecast response. */
  private loadGeneration = 0;
  /** Seconds the last request took: part of the next one's lead (3 before the first). */
  private lastComputeSeconds = 3;
  /** A KI course taken for a step ahead and waiting for it: that step. */
  readonly pendingActivation = signal<number | null>(null);
  /** The AI course shown replaced one that no longer fit when it was taken. */
  readonly aiRefreshed = signal(false);
  /** A KI course taken for a step ahead no longer fit when the step came. */
  readonly courseRejected = signal(false);

  /**
   * While the run plays, the AI courses are computed for the step the
   * participant can still take them at: now plus the computing time plus the
   * reaction allowance (#230). Paused: for now.
   */
  private leadSteps(): number {
    if (!this.store.playing() || this.replay.active()) return 0;
    return Math.ceil((this.lastComputeSeconds + this.store.proposalReactionSeconds()) * this.store.playSpeed());
  }

  /** Whole seconds since the last step while the run plays: a 1 s clock,
   *  restarted on each step and stopped while paused (Q-5). */
  private readonly secondsSinceStep = signal(0);

  /** Seconds until step `at` while the run plays, counted down every second
   *  but never ahead of the step the run is on; null when paused. */
  private secondsUntil(at: number): number | null {
    const speed = this.store.playing() ? this.store.playSpeed() : 0;
    if (speed <= 0) return null;
    const steps = at - this.store.elapsedSteps();
    const counted = Math.round(steps / speed - this.secondsSinceStep());
    return Math.max(0, counted, Math.round((steps - 1) / speed));
  }

  /** Seconds the shown AI course can still be taken in; null without a lead. */
  readonly aiSecondsLeft = computed(() => {
    const at = this.result()?.ai_activation_step;
    if (at == null || this.decided()) return null;
    return this.secondsUntil(at);
  });

  /** Seconds until a taken AI course takes over; null when none is waiting. */
  readonly pendingSecondsLeft = computed(() => {
    const at = this.pendingActivation();
    return at == null ? null : this.secondsUntil(at);
  });

  readonly targetHandle = computed(() => (this.decided() ? this.decided()!.handle : this.store.selectedHandle()));

  constructor() {
    effect((onCleanup) => {
      this.store.elapsedSteps();
      if (!this.store.playing()) return;
      untracked(() => this.secondsSinceStep.set(0));
      const timer = setInterval(() => this.secondsSinceStep.update((n) => n + 1), 1000);
      onCleanup(() => clearInterval(timer));
    });

    // One effect for both ways in: a different train (from anywhere) or a
    // different option (from this panel or the map). A different train is a
    // different question, so the old answer goes; a different option only asks
    // again for the same train.
    let lastHandle: number | null | undefined;
    let lastSessionId: string | undefined;
    effect(() => {
      const handle = this.targetHandle();
      const option = this.chosenOption();
      const sessionId = this.store.session()?.id;
      this.choice.drawnVia(); // a route drawn for «Umleiten» asks again
      if (this.decided()) return;
      untracked(() => {
        if (handle !== lastHandle || sessionId !== lastSessionId) {
          lastHandle = handle;
          lastSessionId = sessionId;
          ++this.loadGeneration;
          this.showAlternatives.set(false);
          this.liveResult.set(null);
          this.store.whatIfPreview.set(null);
          this.appliedVariant.set(null);
          this.pendingActivation.set(null);
          this.aiRefreshed.set(false);
          this.courseRejected.set(false);
        } else if (this.appliedVariant() === 'human') {
          // The confirmation belonged to the option that was taken, not this one.
          this.appliedVariant.set(null);
        }
        this.applying.set(null);
        this.committed.set(false);
        if (handle != null) this.load(option);
      });
    });

    // An AI course computed with a lead can be taken exactly until its step.
    // Once that has passed, ask again by itself instead of offering a course
    // that has run out (#230).
    effect(() => {
      const at = this.liveResult()?.ai_activation_step;
      const now = this.store.elapsedSteps();
      if (at == null || now <= at) return;
      untracked(() => {
        if (this.decided() || this.loading() || this.applying() !== null
          || this.appliedVariant() === 'ai' || this.pendingActivation() !== null) return;
        if (this.targetHandle() != null) this.load(this.chosenOption());
      });
    });

    // A taken AI course waiting for its step: when the backend has dealt with
    // it, close the frame as for any course taken, or say that it no longer
    // fitted and ask for a new one. Cancelled by another decision or a reset:
    // ask again, without a message (the participant made that decision).
    effect(() => {
      const state = this.store.state();
      untracked(() => {
        const at = this.pendingActivation();
        const outcome = state?.course_activation;
        if (at == null || !state || state.pending_course || outcome?.activation_step !== at) return;
        this.pendingActivation.set(null);
        if (outcome.outcome === 'rejected' || outcome.outcome === 'cancelled') {
          this.appliedVariant.set(null);
          this.courseRejected.set(outcome.outcome === 'rejected');
          this.load(this.chosenOption());
        } else {
          this.closeFrame();
        }
      });
    });
  }

  /** The choice is made: close the frame, except in a replay, which restores
   *  the recorded state itself (D25). */
  private closeFrame(): void {
    if (!this.replay.active()) this.frames.setExpanded('proposal-compare', false);
  }

  /** The variants with the given id prefix, in the response's order. */
  private variant(id: string): ProposalVariant | null {
    return this.result()?.variants.find((v) => v.id === id) ?? null;
  }

  readonly plan = computed(() => this.variant('plan'));
  readonly ai = computed(() => this.variant('ai'));
  readonly human = computed(() => this.variant('human'));
  readonly alternatives = computed(() => this.result()?.ai_alternatives ?? []);

  /** Ask the backend for the three courses. `option` null = plan and AI only. */
  load(option: ProposalOption | null): void {
    const sess = this.store.session();
    const handle = this.targetHandle();
    if (!sess || handle == null) return;
    const generation = ++this.loadGeneration;

    this.loading.set(true);
    this.failed.set(null);
    this.committed.set(false);
    // The human course answers the option asked last. Keep plan and AI while
    // the new one is worked out, but never the previous option's numbers under
    // the new option's name — the column says it is being computed instead, and
    // stays empty if the backend refuses the option.
    this.liveResult.update((r) => (r ? { ...r, variants: r.variants.filter((v) => v.id !== 'human') } : r));

    // «Umleiten» is drawn on the map: until the drag ended, plan and AI only.
    const route = option === 'reroute' ? this.choice.drawnRoute() : null;
    const asked = option === 'reroute' && !route ? undefined : (option ?? undefined);
    const started = Date.now();
    this.api.getProposals(sess.id, handle, asked, route ?? undefined, this.leadSteps()).subscribe({
      next: (r) => {
        this.lastComputeSeconds = Math.max(1, (Date.now() - started) / 1000);
        if (generation !== this.loadGeneration || this.store.session()?.id !== sess.id || this.targetHandle() !== handle) return;
        this.liveResult.set(r);
        this.loading.set(false);
        this.drawPreview(r, handle);
      },
      error: (err) => {
        if (generation !== this.loadGeneration || this.store.session()?.id !== sess.id || this.targetHandle() !== handle) return;
        // The backend refuses an option it cannot offer (409: no reroute here,
        // or, for a drawn route, the train has already left it; 400 for a drawn
        // route: no way through the drawn cells). Its sentence is English; the
        // operator gets the same answer in their language.
        this.failed.set(
          err?.status === 409
            ? this.i18n.t(route ? 'proposals.drawnRouteLeft' : 'proposals.noReroute')
            : err?.status === 400 && route
              ? this.i18n.t('proposals.noDrawnRoute')
              : (err?.error?.detail ?? this.i18n.t('proposals.computeFailed')),
        );
        this.loading.set(false);
        this.store.whatIfPreview.set(null);
      },
    });
  }

  /** Route mode is on for the shown train and nothing is drawn yet: the panel says how to draw. */
  readonly awaitingRoute = computed(
    () => !this.decided() && this.chosenOption() === 'reroute' && this.store.routeDrawing()?.handle === this.targetHandle() && !this.choice.drawnVia(),
  );

  /** Pick an option → simulate it next to the plan and the AI. */
  choose(option: ProposalOption): void {
    const handle = this.targetHandle();
    if (handle != null) this.choice.choose(handle, option);
  }

  /** Inspect another executable AI course; acceptance remains a separate click. */
  selectAlternative(course: ProposalVariant): void {
    const r = this.liveResult();
    const previous = this.ai();
    const handle = this.targetHandle();
    if (!r || !previous || handle == null || this.decided() || this.loading() || this.applying()) return;
    if (!r.ai_alternatives.some((v) => v === course)) return;
    const next: ProposalsResult = {
      ...r,
      variants: r.variants.map((v) => v.id === 'ai' ? { ...course, id: 'ai' } : v),
      ai_alternatives: r.ai_alternatives.map((v) => v === course ? { ...previous, id: course.id } : v),
      ai_matches_plan: course.matches_plan ?? false,
    };
    this.liveResult.set(next);
    this.drawPreview(next, handle);
  }

  /**
   * Two paths on the map, which is what the overlay holds: the operator's course
   * in blue against the AI's in yellow once an option is picked, and the AI's
   * against the plan before that.
   */
  private drawPreview(r: ProposalsResult, handle: number): void {
    const human = r.variants.find((v) => v.id === 'human')?.trajectories;
    const ai = r.variants.find((v) => v.id === 'ai')?.trajectories;
    const plan = r.variants.find((v) => v.id === 'plan')?.trajectories;
    const yellow = ai ?? plan;
    const blue = human ?? plan;
    if (!yellow || !blue || yellow === blue) {
      this.store.whatIfPreview.set(null);
      return;
    }
    this.store.whatIfPreview.set({ baseline: yellow, branch: blue, handles: [handle] });
  }

  /**
   * Take one of the three courses for real.
   *
   * All three are decisions, so all three are offered — keeping the plan is a
   * choice, not the absence of one. The human's option goes through the dispatch
   * seam (which logs it and asks why); plan and AI go to the backend, because
   * accepting the replan means the session runs on it from here, and are logged
   * the same way afterwards.
   */
  take(variant: 'plan' | 'ai' | 'human'): void {
    const sess = this.store.session();
    const handle = this.targetHandle();
    if (!sess || handle == null || this.loading() || this.applying() !== null) return;

    if (variant === 'human') {
      this.commit();
      return;
    }

    const priority = variant === 'ai' ? this.ai()?.priority : undefined;
    const course = variant === 'ai' ? this.ai() : null;
    if (variant === 'ai' && !course) return;
    // What the panel shows now, at the click: the answer may come after
    // another train was selected (finding 29).
    const shown = this.shownOptions();
    this.applying.set(variant);
    this.pendingActivation.set(null);
    this.courseRejected.set(false);
    this.api.applyProposal(sess.id, {
      variant, handle, priority,
      ...(course?.preview_token ? {
        preview_token: course.preview_token,
        candidate_id: course.candidate_id,
        source_step: this.result()?.source_step ?? this.result()?.step,
      } : {}),
    }).subscribe({
      next: (r) => {
        if (this.store.session()?.id !== sess.id) return;
        // 'accept' is the log's word for taking an AI proposal; keeping the
        // timetable is the train proceeding as planned.
        this.store.recordProposalChoice(handle, variant === 'ai' ? 'accept' : 'proceed');
        this.keepSnapshot(handle, variant, shown);
        this.store.refreshState();
        if (this.targetHandle() === handle) {
          this.applying.set(null);
          this.appliedVariant.set(variant);
          this.aiRefreshed.set(false);
          this.store.whatIfPreview.set(null);
          // Taken for a step ahead: the frame stays open and says when it takes
          // over; it closes then (the effect on `course_activation`).
          if (variant === 'ai' && r.pending && r.activation_step != null) this.pendingActivation.set(r.activation_step);
          else this.closeFrame();
        }
      },
      error: (err) => {
        if (this.store.session()?.id !== sess.id || this.targetHandle() !== handle) return;
        this.applying.set(null);
        if (variant === 'ai' && err?.status === 409) {
          // The course no longer fits where the trains are: compute a new one
          // right away and say so, rather than leave the participant an error.
          this.aiRefreshed.set(true);
          this.load(this.chosenOption());
        } else {
          this.failed.set(err?.error?.detail ?? this.i18n.t('proposals.applyFailed'));
        }
      },
    });
  }

  /** Which variant is being applied right now, and which one was taken. */
  readonly applying = signal<'plan' | 'ai' | 'human' | null>(null);
  readonly appliedVariant = signal<'plan' | 'ai' | 'human' | null>(null);

  /** Take the chosen option for real. Logged through the dispatch seam. */
  commit(): void {
    const handle = this.targetHandle();
    const option = this.chosenOption();
    if (handle == null || option == null) return;

    if (option === 'proceed') {
      this.trainActions.clear(handle, 'proposals');
    } else if (option === 'reroute') {
      const route = this.choice.drawnRoute();
      if (!route) return; // nothing drawn yet: the course is not shown either
      this.trainActions.set(handle, REROUTE_ACTION, 'proposals', 'human', route);
      this.choice.cancelRouteDrawing();
    } else {
      // Both hold options stop the train. The timed release exists in the
      // simulated variant only, so in the live run the operator releases it.
      this.trainActions.set(handle, ProposalCompareComponent.STOP, 'proposals');
    }
    this.committed.set(true);
    this.appliedVariant.set('human');
    this.keepSnapshot(handle, 'human', this.shownOptions());
    this.store.whatIfPreview.set(null);
    this.closeFrame();
  }

  /** The courses and the option the panel shows right now. */
  private shownOptions(): { result: ProposalsResult | null; option: ProposalOption | null } {
    return { result: this.liveResult(), option: this.chosenOption() };
  }

  /** What the panel showed for this choice, for its reflection (D26). */
  private keepSnapshot(
    handle: number,
    applied: 'plan' | 'ai' | 'human',
    { result, option }: { result: ProposalsResult | null; option: ProposalOption | null },
  ): void {
    if (result) this.store.keepProposalSnapshot({ handle, result, applied, option });
  }

  /** The course taken: the decided one, or the one taken here. */
  readonly shownApplied = computed(() => this.decided()?.applied ?? this.appliedVariant());

  ngOnDestroy(): void {
    ++this.loadGeneration;
    // A read-only copy never drew the map preview, so it leaves the live one.
    if (!this.decided()) this.store.whatIfPreview.set(null);
  }

  // ── Presentation helpers ──────────────────────────────────────────────

  targetColor(): string {
    const handle = this.targetHandle();
    return handle == null ? 'transparent' : this.colors.getColor(handle, 'default');
  }

  targetLabel(): string {
    const handle = this.targetHandle();
    return handle == null ? '' : this.identity.nameFor(handle);
  }

  /** The translation key of an option's label, for text that names it. */
  optionLabelKey(option: ProposalOption): string {
    return this.optionChoices.find((c) => c.option === option)?.label ?? option;
  }

  isChosen(option: ProposalOption): boolean {
    return this.chosenOption() === option;
  }

  /**
   * Offer only what this train actually has. While the impact analysis lists the
   * train it also says whether a reroute exists; without a branch ahead the
   * backend refuses that option, and the assessment panel already says so —
   * an enabled button that always fails would contradict it.
   */
  readonly rerouteAvailable = computed(() => this.choice.rerouteAvailable(this.targetHandle()));

  isDisabled(option: ProposalOption): boolean {
    return option === 'reroute' && !this.rerouteAvailable();
  }

  /** "Hält bis frei" as the human column's heading, not the raw option id. */
  humanLabel(): string {
    const option = this.chosenOption();
    const key = this.optionChoices.find((c) => c.option === option)?.label ?? 'proposals.humanSub';
    return this.i18n.t(key);
  }

  /** Arrival as a sentence: the step and how far off the plan it is. */
  arrivalText(v: ProposalVariant): string {
    const arrival = v.train.arrival_step;
    if (arrival == null) return this.i18n.t('proposals.notArriving');
    const delay = v.train.delay_vs_plan;
    if (delay == null) return this.i18n.t('proposals.step', { n: arrival });
    if (delay === 0) return this.i18n.t('proposals.stepOnPlan', { n: arrival });
    return this.i18n.t('proposals.stepVsPlan', { n: arrival, delta: this.signed(delay) });
  }

  /** The order the AI would send the trains through, in train names. */
  priorityText(v: ProposalVariant): string {
    return (v.priority ?? []).map((h) => this.identity.nameFor(h)).join(' → ');
  }

  courseText(v: ProposalVariant): string {
    const change = v.intervention;
    if (!change) return this.priorityText(v);
    if (change.kind === 'wait') {
      return this.i18n.t(change.wait_steps === 1 ? 'proposals.course.waitOne' : 'proposals.course.wait',
        { step: change.step, n: change.wait_steps });
    }
    if (change.kind === 'branch') {
      const direction = change.action === 1 ? 'proposals.course.left'
        : change.action === 3 ? 'proposals.course.right' : 'proposals.course.forward';
      return this.i18n.t('proposals.course.branch', { step: change.step, direction: this.i18n.t(direction) });
    }
    return this.i18n.t('proposals.course.rl');
  }

  signed(value: number): string {
    return value > 0 ? `+${value}` : `${value}`;
  }

  /**
   * The courses side by side on the two numbers this simulation can honestly
   * carry: summed lateness against the timetable, and summed time the trains
   * are still in the network (the closest thing here to resource use — longer
   * occupancy, more energy). Connections are deliberately absent: the corridor
   * models no intermediate calls, so the figure would be the same everywhere.
   *
   * Lower is better on both, and the bars are scaled per axis.
   */
  readonly comparison = computed<ComparisonAxis[] | null>(() => {
    const courses = [this.plan(), this.ai(), this.human()].filter(
      (v): v is ProposalVariant => !!v?.metrics,
    );
    if (courses.length < 2) return null;

    const axis = (
      id: ComparisonAxis['id'],
      label: string,
      unit: string,
      pick: (v: ProposalVariant) => number,
      /** True where a stranded train makes this axis' number meaningless. */
      voidedByStranded = false,
    ): ComparisonAxis => {
      const values = courses.map((v) =>
        voidedByStranded && v.metrics!.not_arrived > 0 ? null : Math.max(0, pick(v)),
      );
      const max = Math.max(1, ...values.filter((x): x is number => x !== null));
      return {
        id,
        label,
        unit,
        bars: courses.map((v, i) => ({
          id: v.id,
          label: VARIANT_LABEL[v.id] ? this.i18n.t(VARIANT_LABEL[v.id]) : v.id,
          value: values[i],
          pct: values[i] === null ? 0 : Math.round((values[i]! / max) * 100),
        })),
      };
    };

    const axes = [
      // Lateness counts only trains that arrived, so a course that strands one
      // would otherwise win this axis by leaving its worst case out of the sum.
      axis('lateness', this.i18n.t('proposals.axis.lateness'), this.i18n.t('proposals.axis.unit'), (v) => v.metrics!.lateness, true),
      // Time in the network already charges a stranded train the full horizon.
      axis('time', this.i18n.t('proposals.axis.time'), this.i18n.t('proposals.axis.unit'), (v) => v.metrics!.time_in_network),
    ].filter((a) => !this.uiConfig.isHidden(`widget.proposal-compare.axis.${a.id}`));

    return axes.length > 0 ? axes : null;
  });

  /** Says when the bars are not comparable, instead of letting them look it. */
  readonly comparisonCaveat = computed(() => {
    const stranded = [this.plan(), this.ai(), this.human()]
      .filter((v): v is ProposalVariant => !!v?.metrics)
      .filter((v) => v.metrics!.not_arrived > 0)
      .map((v) => (VARIANT_LABEL[v.id] ? this.i18n.t(VARIANT_LABEL[v.id]) : v.id));
    if (stranded.length === 0) return null;
    return stranded.length === 1
      ? this.i18n.t('proposals.strandedOne', { name: stranded[0] })
      : this.i18n.t('proposals.strandedMany', {
          names: stranded
            .map((name) => this.i18n.t('proposals.quoted', { name }))
            .join(` ${this.i18n.t('proposals.and')} `),
        });
  });

  /** Worse than the plan for this train — the template colours it, nothing more. */
  worseThanPlan(v: ProposalVariant): boolean {
    const plan = this.plan();
    if (!plan) return false;
    if (v.train.arrival_step == null) return plan.train.arrival_step != null;
    if (plan.train.arrival_step == null) return false;
    return v.train.arrival_step > plan.train.arrival_step;
  }

  betterThanPlan(v: ProposalVariant): boolean {
    const plan = this.plan();
    if (!plan || v.train.arrival_step == null || plan.train.arrival_step == null) return false;
    return v.train.arrival_step < plan.train.arrival_step;
  }
}
