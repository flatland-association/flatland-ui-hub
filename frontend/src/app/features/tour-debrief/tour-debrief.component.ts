import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Output, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AgentDTO } from '../../core/models';
import { DecisionAction } from '../../core/decision-log';
import { OperatorModelService } from '../../core/operator-model.service';
import { REFLECTION_CASE_LABELS, ReflectionCaseType } from '../../core/reflection-moments';
import { SessionStore } from '../../core/session.store';
import { ShiftIntervention, ShiftKpis, buildShiftReview, interventionsFrom } from '../../core/shift-review';
import { LanguageService } from '../../core/i18n/language.service';
import { ShiftRecord, TourContextService } from '../../core/demo/tour-context.service';
import { ApiService } from '../../core/api.service';
import { SandboxOutcome } from '../../core/demo/sandbox-replay';
import { TourGuideService } from '../../core/demo/tour-guide.service';
import { SandboxCase, SandboxVariant } from '../../core/demo/sandbox-outcomes';
import { SANDBOX_OUTCOMES } from '../../core/demo/sandbox-outcomes.generated';
import { TrainIdentityService } from '../../core/train-identity.service';
import { LearningRecordsComponent } from '../learning-records/learning-records.component';
import { SandboxReplayComponent } from '../sandbox-replay/sandbox-replay.component';
import { RuleBuilderComponent } from '../rule-builder/rule-builder.component';

/** The sections that are steps of the tour guide (thesis flow 7-9). */
type GuideSection = 'shift-summary' | 'event-simulation' | 'ai-learns';
type DebriefSection = GuideSection | 'rule' | 'compare';

/** Titles live in i18n as `tourUi.debrief.section.<id>`. */
const SECTIONS: ReadonlyArray<{ id: GuideSection; n: number }> = [
  { id: 'shift-summary', n: 7 },
  { id: 'event-simulation', n: 8 },
  { id: 'ai-learns', n: 9 },
];

/** After a later shift of a multi-shift tour: this shift next to the earlier ones. */
const COMPARE: { id: DebriefSection; n: number | string } = { id: 'compare', n: 10 };

/** With the playable sandbox: turn the insight into a rule and check it (WP3),
 *  right after the sandbox it is checked against. */
const RULE: { id: DebriefSection; n: number | string } = { id: 'rule', n: '8b' };

/** A decision as the comparison lists it, and the measure it amounts to. */
const MEASURE_OF_ACTION: Record<string, string> = {
  hold: 'hold',
  reroute: 'reroute',
  proceed: 'proceed',
  accept: 'ai',
};

/**
 * Tour debrief — the learning loop after the shift (thesis flow steps 7-9):
 * shift summary, event simulation in the sandbox, what the AI learned.
 *
 * Shown in place of the Director review when the running tour asks for it
 * (`TourBriefing.debrief`). Built on the same pure builder as the Director
 * review (`buildShiftReview`), with the human's per-train interventions in place
 * of Director's goal choices.
 */
@Component({
  selector: 'app-tour-debrief',
  standalone: true,
  imports: [LearningRecordsComponent, SandboxReplayComponent, RuleBuilderComponent, TranslocoPipe],
  templateUrl: './tour-debrief.component.html',
  styleUrl: './tour-debrief.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class TourDebriefComponent {
  @Output() finish = new EventEmitter<void>();

  readonly store = inject(SessionStore);
  readonly guide = inject(TourGuideService);
  private readonly tourContext = inject(TourContextService);
  /** The Event Simulation is played from a checkpoint (advanced tour), not precomputed. */
  readonly liveSandbox = this.tourContext.liveSandbox;
  private readonly identity = inject(TrainIdentityService);
  private readonly model = inject(OperatorModelService);
  private readonly i18n = inject(LanguageService);

  /** Step 7's closing question, asked once for the whole shift rather than per
   *  decision: right after a decision there is rarely an insight yet. Kept for
   *  the interview; not stored with the run. */
  readonly insight = signal('');

  /** Restricted to the briefing's `debriefSections` when it sets one — see
   *  TourBriefing.debriefSections (a survey-based experiment stops after the
   *  shift summary, skipping the sandbox and the learning card). */
  readonly sections = computed(() => {
    const only = this.tourContext.debriefSections();
    const base: { id: DebriefSection; n: number | string }[] = only ? SECTIONS.filter((s) => only.includes(s.id)) : [...SECTIONS];
    if (this.liveSandbox()) {
      const at = base.findIndex((s) => s.id === 'event-simulation');
      if (at >= 0) base.splice(at + 1, 0, RULE);
    }
    return this.tourContext.shiftHistory().length > 0 ? [...base, COMPARE] : base;
  });

  private readonly api = inject(ApiService);
  /** A tour with several shifts keeps each one for the comparison. */
  private readonly multiShift = computed(() => this.store.demoSequence().length > 1);
  /** The run as played to the end of the episode, as the sandbox reports it. */
  readonly played = signal<SandboxOutcome | null>(null);

  /** This shift, as it will go into the tour's shift history. */
  readonly currentShift = computed<ShiftRecord>(() => {
    const decisions = this.interventions().map((i) => ({
      handle: i.handle,
      action: i.action,
      simStep: i.step,
      decisionTimeMs: this.store.decisionLog().find((e) => e.seq === i.seq)?.decisionTimeMs ?? null,
    }));
    const since = this.tourContext.shiftStartedAt();
    const rules = [
      ...this.store
        .decisionLog()
        .filter((e) => e.hypothesisResponse === 'yes' && e.preferenceHypothesis)
        .map((e) => e.preferenceHypothesis as string),
      // Rules formulated in this debrief (WP3).
      ...this.store.learningRecords().filter((r) => r.rule && r.createdAt >= since).map((r) => r.hypothesis),
    ];
    const sid = this.store.session()?.id;
    const shown = this.tourContext.ruleShown();
    const ruleApplied =
      shown && shown.sessionId === sid
        ? {
            hypothesis: shown.hypothesis,
            followed: decisions.length > 0 && MEASURE_OF_ACTION[decisions[0].action] === shown.measure,
          }
        : null;
    return { leg: this.store.demoStepIndex(), sessionId: sid ?? null, played: this.played(), decisions, rules, ruleApplied };
  });

  /** Earlier shifts first, this one last. */
  readonly compareShifts = computed<ShiftRecord[]>(() => [...this.tourContext.shiftHistory(), this.currentShift()]);
  readonly active = signal<DebriefSection>('shift-summary');
  readonly activeIndex = computed(() => this.sections().findIndex((s) => s.id === this.active()));
  readonly nextSection = computed(() => this.sections()[this.activeIndex() + 1] ?? null);

  constructor() {
    this.model.loadProfile().subscribe({ error: () => void 0 });
    const sid = this.store.session()?.id;
    if (sid && this.multiShift()) {
      this.api.getSandbox(sid).subscribe({ next: (s) => this.played.set(s.played), error: () => void 0 });
    }
  }

  private isMalfunctioning(a: AgentDTO): boolean {
    return !!a.is_malfunctioning || (a.malfunction_remaining ?? 0) > 0;
  }

  readonly kpis = computed<ShiftKpis>(() => {
    const agents = this.store.agents();
    return {
      total: agents.length,
      arrived: agents.filter((a) => String(a.state).toUpperCase() === 'DONE').length,
      delayed: agents.filter((a) => (a.delay ?? 0) > 0).length,
      malfunctions: agents.filter((a) => this.isMalfunctioning(a)).length,
      totalDelay: agents.reduce((sum, a) => sum + Math.max(0, a.delay ?? 0), 0),
    };
  });

  readonly review = computed(() =>
    buildShiftReview({
      kpis: this.kpis(),
      ai: null,
      decisionLog: this.store.decisionLog(),
      learningRecords: this.tourContext.cardsInView(),
    }),
  );

  readonly interventions = computed(() => interventionsFrom(this.store.decisionLog()));
  readonly systemHolds = computed(
    () => this.store.decisionLog().filter((e) => e.accountableOwner === 'system').length,
  );

  /** This shift's cards; earlier visitors' stay out of the debrief. */
  readonly cards = this.tourContext.cardsInView;

  readonly valueProfile = computed(() => this.model.profile()?.valueProfile ?? null);

  readonly sandbox = SANDBOX_OUTCOMES;

  /**
   * Which sandbox variant the interviewee actually played, read from what
   * happened rather than from the last button pressed. A hold that was never
   * released is "hold without release"; a hold followed by a release is "hold,
   * then release". Both start as a 'hold' in the log, so the last action alone
   * cannot tell them apart — it marked "hold, then release" for a train that
   * was still standing when the shift ended.
   */
  private playedVariantOn(handle: number): string | null {
    const own = this.interventions()
      .filter((i) => i.handle === handle)
      .map((i) => i.action);
    if (own.length === 0) return null;
    const last = own[own.length - 1];
    if (last === 'reroute') return 'reroute';
    if (last === 'hold') return 'hold-no-release';
    if (last === 'proceed') return own.includes('hold') ? 'hold-release' : 'proceed';
    return null;
  }

  /** The guided reflection answers of an intervention, as short lines. */
  reflectionLines(i: ShiftIntervention): string[] {
    const r = i.reflection;
    if (!r) return [];
    const lines: string[] = [];
    if (r['gut']) {
      lines.push(this.i18n.t('tourUi.debrief.reflection.gut', { v: this.i18n.t(`reflectionPrompt.gut.${r['gut']}`) }));
    }
    if (r['missing']) {
      const items = r['missing'].split(',').map((id) => this.i18n.t(`reflectionPrompt.missing.${id}`));
      lines.push(this.i18n.t('tourUi.debrief.reflection.missing', { v: items.join(', ') }));
    }
    if (r['tradeoff']) {
      lines.push(this.i18n.t('tourUi.debrief.reflection.tradeoff', { v: r['tradeoff'] }));
    }
    return lines;
  }

  isUserChoice(sandboxCase: SandboxCase, variant: SandboxVariant): boolean {
    return (
      sandboxCase.kind === 'experienced' &&
      variant.id === this.playedVariantOn(sandboxCase.decisionHandle)
    );
  }

  readonly saveState = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');

  savePreferences(): void {
    if (this.saveState() === 'saving' || this.saveState() === 'saved') return;
    this.saveState.set('saving');
    this.model.endSession().subscribe({
      next: () => this.saveState.set('saved'),
      error: () => this.saveState.set('error'),
    });
  }

  /** Only while the episode could still go on; a debrief must not be a trap. */
  readonly canReopen = computed(() => !this.store.episodeDone() && this.store.shiftEnded());

  reopenShift(): void {
    this.store.reopenShift();
  }

  select(id: DebriefSection): void {
    this.active.set(id);
  }

  next(): void {
    const active = this.active();
    if (active !== 'compare' && active !== 'rule') this.guide.markDone(active);
    const next = this.nextSection();
    if (next) {
      this.active.set(next.id);
    } else {
      if (this.multiShift()) this.tourContext.recordShift(this.currentShift());
      this.finish.emit();
    }
  }

  /** Ticked in the guide; the comparison is not a guide step. */
  isDone(id: DebriefSection): boolean {
    return id !== 'compare' && id !== 'rule' && this.guide.done().has(id);
  }

  measureLabel(action: string): string {
    return this.i18n.t(`impact.rule.measure.${MEASURE_OF_ACTION[action] ?? 'proceed'}`);
  }

  seconds(ms: number | null): string {
    return ms == null ? '—' : String(Math.round(ms / 1000));
  }

  back(): void {
    const previous = this.sections()[this.activeIndex() - 1];
    if (previous) this.active.set(previous.id);
  }

  trainName(handle: number): string {
    return this.identity.nameFor(handle);
  }

  /** Replace the sandbox texts' `{T<handle>}` placeholders with shared train names. */
  fill(text: string): string {
    return text.replace(/\{T(\d+)\}/g, (_, handle: string) => this.trainName(Number(handle)));
  }

  /** Sandbox copy is generated in German (`sandbox-outcomes.generated.ts`);
   *  translations are keyed by case/variant id, the generated text is the
   *  fallback, so a regenerated case without keys still reads. */
  caseText(c: SandboxCase, field: 'title' | 'situation'): string {
    return this.fill(this.i18n.t(`tourUi.debrief.sandbox.${c.id}.${field}`, undefined, c[field]));
  }

  variantText(c: SandboxCase, v: SandboxVariant, field: 'label' | 'description'): string {
    return this.fill(this.i18n.t(`tourUi.debrief.sandbox.${c.id}.variants.${v.id}.${field}`, undefined, v[field]));
  }

  actionLabel(action: DecisionAction): string {
    return this.i18n.t(`tourUi.debrief.action.${action}`, undefined, action);
  }

  responseLabel(response: 'yes' | 'once' | 'no' | null): string | null {
    return response ? this.i18n.t(`tourUi.debrief.response.${response}`) : null;
  }

  caseLabel(caseType: ReflectionCaseType): string {
    return this.i18n.t(`tourUi.debrief.case.${caseType}`, undefined, REFLECTION_CASE_LABELS[caseType]);
  }
}
