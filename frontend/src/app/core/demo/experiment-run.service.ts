import { Injectable, computed, inject, signal } from '@angular/core';
import { SessionStore } from '../session.store';
import { LanguageService } from '../i18n/language.service';
import { InteractionLogService } from '../interaction-log/interaction-log.service';
import {
  ExperimentQuestionnaire,
  buildExperimentRunRecord,
  experimentRunRecordFileName,
} from '../interaction-log/experiment-run-record';
import { interventionsFrom } from '../shift-review';
import { AgentDTO } from '../models';
import { ShiftRecord, TourContextService } from './tour-context.service';
import { TourGuideService } from './tour-guide.service';
import { ExperimentLeg, StudyCondition, conditionId } from './study-conditions';

/**
 * Where a guided condition's run stands (docs/plans/experiment-workflow.md §5).
 * The intro card of a leg is the store's `demoIntroPending`, and the leg index
 * is the store's `demoStepIndex`; this keeps only what the store does not.
 */
export type ExperimentPhase = 'briefing' | 'running' | 'legSurvey' | 'review' | 'finalSurvey' | 'done';

/** What survives a reload (§5.3). */
export interface ExperimentRunState {
  conditionId: string;
  experimentRunId: string;
  startedAt: number;
  phase: ExperimentPhase;
  legIndex: number;
  legStartedAt: number;
  shiftHistory: ShiftRecord[];
  questionnaires: ExperimentQuestionnaire[];
  resumedAt: number[];
}

export const EXPERIMENT_RUN_STORAGE_KEY = 'flatland_experiment_run_v1';

/** What a submitted questionnaire hands over (`surveyRecord()`). */
export interface SubmittedQuestionnaire {
  surveyId: string;
  answers: Record<string, unknown>;
  scores: Record<string, Record<string, number | null>>;
  submittedAt: string;
}

function isMalfunctioning(a: AgentDTO): boolean {
  return !!a.is_malfunctioning || (a.malfunction_remaining ?? 0) > 0;
}

/**
 * Runs one guided condition: one leg after the other on a fresh session each,
 * the leg questionnaires, the Schichtbilanz after the last leg, the final
 * questionnaire, and the saved record. The AppComponent starts sessions and
 * opens screens; this service decides what comes next and keeps the record.
 */
@Injectable({ providedIn: 'root' })
export class ExperimentRunService {
  private readonly store = inject(SessionStore);
  private readonly tourContext = inject(TourContextService);
  private readonly guide = inject(TourGuideService);
  private readonly interactionLog = inject(InteractionLogService);
  private readonly i18n = inject(LanguageService);

  readonly condition = signal<StudyCondition | null>(null);
  readonly phase = signal<ExperimentPhase>('running');
  readonly experimentRunId = signal<string | null>(null);
  /** A questionnaire is open for the current phase and not yet submitted. */
  readonly questionnaireOpen = signal(false);

  private startedAt = 0;
  private legStartedAt = 0;
  private questionnaires: ExperimentQuestionnaire[] = [];
  private resumedAt: number[] = [];

  readonly active = computed(() => this.condition() !== null);
  readonly legs = computed<ExperimentLeg[]>(() => this.condition()?.legs ?? []);
  readonly legCount = computed(() => this.legs().length);
  readonly legIndex = computed(() => this.store.demoStepIndex());
  readonly currentLeg = computed<ExperimentLeg | null>(() => this.legs()[this.legIndex()] ?? null);
  readonly isLast = computed(() => this.legIndex() >= this.legCount() - 1);
  /** Legs after the current one, before the Schichtbilanz. */
  readonly legsLeft = computed(() => Math.max(0, this.legCount() - this.legIndex() - 1));
  readonly hasLegSurvey = computed(() => (this.condition()?.legSurveyParts?.length ?? 0) > 0);
  /** The stepper and the guide's outer level show from two legs on. */
  readonly multiLeg = computed(() => this.legCount() > 1);

  /** The questionnaire the current phase asks for. */
  readonly surveyParts = computed<readonly string[] | null>(() => {
    const c = this.condition();
    if (!c) return null;
    return this.phase() === 'legSurvey' ? c.legSurveyParts ?? null : c.surveyParts;
  });

  legName(leg: ExperimentLeg): string {
    return this.i18n.t(leg.nameKey, undefined, leg.id);
  }

  /** "⟨name⟩ (k/N)" for the leg at `index`. */
  legLabel(index: number): string {
    const leg = this.legs()[index];
    if (!leg) return '';
    return this.i18n.t('experimentRun.legLabel', { name: this.legName(leg), k: index + 1, n: this.legCount() });
  }

  readonly currentLegLabel = computed(() => {
    this.i18n.lang();
    return this.active() ? this.legLabel(this.legIndex()) : '';
  });

  /** The condition's name for participants (footer, picker). */
  conditionName(c: StudyCondition): string {
    return c.labelKey ? this.i18n.t(c.labelKey, undefined, c.label) : c.label;
  }

  /** What the toolbar's finish button says during a run: where it leads. */
  readonly finishLabel = computed<string | null>(() => {
    this.i18n.lang();
    if (!this.active()) return null;
    switch (this.phase()) {
      case 'running':
        if (this.hasLegSurvey()) return this.i18n.t('experimentRun.finish.toQuestionnaire');
        if (this.isLast()) return this.i18n.t('experimentRun.finish.toReview');
        return this.i18n.t('experimentRun.finish.toLeg', { next: this.legLabel(this.legIndex() + 1) });
      case 'legSurvey':
        return this.i18n.t('experimentRun.finish.toQuestionnaire');
      case 'review':
        return this.i18n.t('experimentRun.finish.toFinalSurvey');
      default:
        return null;
    }
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** A new run of `condition`. `withBriefing`: its briefing has an opening page. */
  start(condition: StudyCondition, withBriefing: boolean): void {
    this.condition.set(condition);
    this.experimentRunId.set(`run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    this.startedAt = Date.now();
    this.legStartedAt = this.startedAt;
    this.questionnaires = [];
    this.resumedAt = [];
    this.questionnaireOpen.set(false);
    this.phase.set(withBriefing ? 'briefing' : 'running');
    this.persist();
  }

  /** Continue an interrupted run (§5.3): the caller starts the leg's session. */
  resume(condition: StudyCondition, state: ExperimentRunState): void {
    this.condition.set(condition);
    this.experimentRunId.set(state.experimentRunId);
    this.startedAt = state.startedAt;
    this.legStartedAt = Date.now();
    this.questionnaires = [...state.questionnaires];
    this.resumedAt = [...state.resumedAt, Date.now()];
    this.questionnaireOpen.set(false);
    // A break inside a questionnaire or the review restarts that leg's phase
    // on a fresh session; the briefing is not shown twice.
    this.phase.set(state.phase === 'briefing' ? 'running' : state.phase === 'legSurvey' ? 'legSurvey' : 'running');
    this.persist();
  }

  briefingDone(): void {
    if (this.phase() !== 'briefing') return;
    this.phase.set('running');
    this.persist();
  }

  /** A leg's session was started. */
  legStarted(): void {
    this.legStartedAt = Date.now();
    this.persist();
  }

  setPhase(phase: ExperimentPhase): void {
    this.phase.set(phase);
    this.persist();
  }

  /** Record the current leg as finished and log it. Safe to call twice. */
  finishLeg(reason: 'clicked' | 'endShift' | 'aborted'): void {
    const leg = this.currentLeg();
    if (!leg) return;
    const sessionId = this.store.session()?.id ?? null;
    const done = this.tourContext.shiftHistory().find((s) => s.sessionId === sessionId && s.finishedAt);
    if (done && reason !== 'aborted') return;
    const agents = this.store.agents();
    const decisions = interventionsFrom(this.store.decisionLog()).map((i) => ({
      handle: i.handle,
      action: i.action,
      simStep: i.step,
      decisionTimeMs: this.store.decisionLog().find((e) => e.seq === i.seq)?.decisionTimeMs ?? null,
    }));
    const finishedAt = Date.now();
    this.tourContext.recordShift({
      leg: this.legIndex(),
      sessionId,
      played: null,
      decisions,
      rules: this.store
        .decisionLog()
        .filter((e) => e.hypothesisResponse === 'yes' && e.preferenceHypothesis)
        .map((e) => e.preferenceHypothesis as string),
      ruleApplied: null,
      legId: leg.id,
      kpis: {
        total: agents.length,
        arrived: agents.filter((a) => String(a.state).toUpperCase() === 'DONE').length,
        delayed: agents.filter((a) => (a.delay ?? 0) > 0).length,
        malfunctions: agents.filter((a) => isMalfunctioning(a)).length,
        totalDelay: agents.reduce((sum, a) => sum + Math.max(0, a.delay ?? 0), 0),
      },
      interventions: decisions.length,
      finishReason: reason,
      startedAt: this.legStartedAt,
      finishedAt,
      guideDone: [...this.guide.done()],
    });
    this.interactionLog.noteLegFinished({
      legId: leg.id,
      legIndex: this.legIndex(),
      reason,
      elapsedWallMs: finishedAt - this.legStartedAt,
      elapsedSteps: this.store.elapsedSteps(),
      episodeDone: this.store.episodeDone(),
    });
    this.persist();
  }

  questionnaireOpened(): void {
    this.questionnaireOpen.set(true);
  }

  completeQuestionnaire(submitted: SubmittedQuestionnaire): void {
    this.questionnaires = [
      ...this.questionnaires,
      {
        afterLegId: this.phase() === 'legSurvey' ? this.currentLeg()?.id ?? null : null,
        surveyId: submitted.surveyId,
        answers: submitted.answers,
        scores: submitted.scores,
        submittedAt: submitted.submittedAt,
      },
    ];
    this.questionnaireOpen.set(false);
    this.persist();
  }

  /** The questionnaire of the current phase has been submitted. */
  questionnaireDone(): boolean {
    const afterLegId = this.phase() === 'legSurvey' ? this.currentLeg()?.id ?? null : null;
    if (this.phase() === 'legSurvey') return this.questionnaires.some((q) => q.afterLegId === afterLegId && q.afterLegId !== null);
    return this.questionnaires.some((q) => q.afterLegId === null);
  }

  /** Save the record (download) and end the run: 'done' shows the thank-you page. */
  finish(status: 'completed' | 'aborted' = 'completed'): void {
    const c = this.condition();
    const runId = this.experimentRunId();
    if (!c || !runId) return;
    this.interactionLog.autosave();
    const header = this.interactionLog.header();
    const record = buildExperimentRunRecord(
      {
        experimentRunId: runId,
        conditionId: conditionId(c),
        conditionLabel: c.label,
        startedAt: this.startedAt,
        endedAt: Date.now(),
        status,
        resumedAt: this.resumedAt,
        appVersion: header?.appVersion ?? null,
        backendVersion: header?.backendVersion ?? this.interactionLog.backendVersion(),
        legs: this.tourContext.shiftHistory().filter((s) => !!s.legId),
        questionnaires: this.questionnaires,
      },
      (sid) => this.interactionLog.recordFor(sid),
    );
    this.interactionLog.downloadRunRecord(experimentRunRecordFileName(record), record);
    this.clearPersisted();
    if (status === 'completed') {
      this.phase.set('done');
    } else {
      this.reset();
    }
  }

  /** The experimenter left the run: save what there is (§5.1). */
  abort(): void {
    if (!this.active() || this.phase() === 'done') {
      this.reset();
      return;
    }
    if (this.phase() === 'running' && this.store.session()) this.finishLeg('aborted');
    this.finish('aborted');
  }

  reset(): void {
    this.condition.set(null);
    this.experimentRunId.set(null);
    this.phase.set('running');
    this.questionnaireOpen.set(false);
    this.questionnaires = [];
    this.resumedAt = [];
  }

  // ── Persistence (§5.3) ───────────────────────────────────────────────────

  private persist(): void {
    const c = this.condition();
    const runId = this.experimentRunId();
    if (!c || !runId || this.phase() === 'done') return;
    const state: ExperimentRunState = {
      conditionId: conditionId(c),
      experimentRunId: runId,
      startedAt: this.startedAt,
      phase: this.phase(),
      legIndex: this.legIndex(),
      legStartedAt: this.legStartedAt,
      shiftHistory: this.tourContext.shiftHistory(),
      questionnaires: this.questionnaires,
      resumedAt: this.resumedAt,
    };
    try {
      localStorage.setItem(EXPERIMENT_RUN_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Quota or private mode: the run goes on, only a reload would lose it.
    }
  }

  /** An interrupted run in this browser, if any. */
  readPersisted(): ExperimentRunState | null {
    try {
      const raw = localStorage.getItem(EXPERIMENT_RUN_STORAGE_KEY);
      const state = raw ? (JSON.parse(raw) as ExperimentRunState) : null;
      return state && typeof state.conditionId === 'string' && typeof state.legIndex === 'number' ? state : null;
    } catch {
      return null;
    }
  }

  clearPersisted(): void {
    try {
      localStorage.removeItem(EXPERIMENT_RUN_STORAGE_KEY);
    } catch {
      // localStorage unavailable.
    }
  }
}
