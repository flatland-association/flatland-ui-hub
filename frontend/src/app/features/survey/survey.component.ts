import { Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, EventEmitter, OnInit, Output, computed, effect, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ExperimentRunService } from '../../core/demo/experiment-run.service';
import { InteractionLogService } from '../../core/interaction-log/interaction-log.service';
import { SessionStore } from '../../core/session.store';
import { postSessionSurvey } from '../../core/survey/survey-configs';
import { SurveyContext, surveyRecord } from '../../core/survey/survey-scoring';
import { SurveyAnswers, SurveyConfig, SurveyQuestion, SurveySection } from '../../core/survey/survey.types';
import { LanguageService } from '../../core/i18n/language.service';

/**
 * Config-driven post-session survey, rendered in SBB-Lyne style. The survey for
 * the current interaction mode comes from survey-configs.ts; answers are kept in
 * localStorage per session+survey, and submitting downloads them as one JSON
 * record with scores and context (survey-scoring.ts) — central persistence
 * comes with the backend.
 */
@Component({
  selector: 'app-survey',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './survey.component.html',
  styleUrl: './survey.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class SurveyComponent implements OnInit {
  store = inject(SessionStore);
  private readonly interactionLog = inject(InteractionLogService);
  private readonly experimentRun = inject(ExperimentRunService);
  private readonly i18n = inject(LanguageService);
  private readonly host = inject(ElementRef<HTMLElement>);

  @Output() closed = new EventEmitter<void>();
  /** The answers with their scores, on submit (a guided condition's run keeps them). */
  @Output() submitted = new EventEmitter<{ surveyId: string; answers: Record<string, unknown>; scores: Record<string, Record<string, number | null>>; submittedAt: string }>();

  /** Where the run came from (experiment condition, tour, scenario), saved with the answers. */
  readonly context = input<Partial<SurveyContext> | null>(null);
  /** A fixed instrument set, e.g. an experiment's; else the parts chosen in Settings. */
  readonly parts = input<readonly string[] | null>(null);
  /** Part of a guided condition: the run saves one file with every
   *  questionnaire, so this one is not downloaded on its own. */
  readonly embedded = input(false);
  /** A replay: the recorded final answers, shown read-only; without `parts`,
   *  only the sections they belong to. Nothing is stored or logged. */
  readonly replayAnswers = input<Record<string, unknown> | null>(null);
  /** Asked after one scenario of a guided condition, not at the end. */
  readonly afterLeg = input(false);

  readonly config = computed<SurveyConfig>(() => {
    const recorded = this.replayAnswers();
    const parts = this.parts();
    if (!recorded || parts) return postSessionSurvey(this.store.interactionMode(), [...(parts ?? this.store.enabledSurveyParts())], this.afterLeg());
    const all = postSessionSurvey(this.store.interactionMode(), undefined, this.afterLeg());
    return { ...all, sections: all.sections.filter((sec) => sec.questions.some((q) => q.id in recorded)) };
  });
  readonly answers = signal<SurveyAnswers>({});
  /** What a number field shows: the answers as they were when its page opened.
   *  Bound to `answers` instead, every keystroke would write the parsed number
   *  back, and a lagging update turns a half-typed "12." into "12" with the
   *  caret in front, so "12.5" became "512" (plan §3.10). */
  readonly fieldValues = signal<SurveyAnswers>({});

  // ── Pages (a `paged` survey, plan experiment-scenario-import.md §3.10) ──
  /** Shown one page at a time; a replay shows every page, one under the other. */
  readonly paged = computed(() => !!this.config().paged && !this.replayAnswers());
  readonly pages = computed<SurveySection[][]>(() => {
    const sections = this.config().sections;
    if (!this.paged()) return [sections];
    const numbers = [...new Set(sections.map((s) => s.page ?? 1))].sort((a, b) => a - b);
    return numbers.map((n) => sections.filter((s) => (s.page ?? 1) === n));
  });
  readonly pageIndex = signal(0);
  readonly pageSections = computed(() => this.pages()[Math.min(this.pageIndex(), this.pages().length - 1)] ?? []);
  readonly isLastPage = computed(() => this.pageIndex() >= this.pages().length - 1);
  /** Items left open when the participant tried to go on, marked until answered. */
  readonly missing = signal<ReadonlySet<string>>(new Set());
  readonly closable = computed(() => this.config().closable !== false && !this.replayAnswers());

  private static readonly PREFIX = 'flatland_survey_';

  constructor() {
    let lastKey: string | null = null;
    effect(() => {
      const recorded = this.replayAnswers();
      if (recorded) {
        this.answers.set(recorded as SurveyAnswers);
        this.fieldValues.set(recorded as SurveyAnswers);
        return;
      }
      const key = this.storageKey();
      const draft = this.draftKey();
      if (`${key}|${draft}` === lastKey) return;
      lastKey = `${key}|${draft}`;
      // The run's draft first: a resume opens the questionnaire on a fresh
      // session, and answers typed before a session existed are only there.
      const answers = { ...(draft ? this.load(draft) : {}), ...(key ? this.load(key) : {}) };
      this.answers.set(answers);
      this.fieldValues.set(answers);
      if (key && draft && Object.keys(answers).length) this.write(key, answers);
    });
  }

  ngOnInit(): void {
    if (this.replayAnswers()) return;
    this.interactionLog.noteSurveyOpened(this.config().id);
  }

  private storageKey(): string | null {
    const sid = this.store.session()?.id;
    return sid ? SurveyComponent.PREFIX + sid + '_' + this.config().id : null;
  }

  /** A guided run's questionnaire, by run, phase and leg (the same survey can
   *  follow every leg): kept across a resume, which opens it on a fresh
   *  session (finding 18 of docs/plans/experiment-scenario-import.md). Not
   *  read by the session record, which collects the session's own key. */
  private draftKey(): string | null {
    const run = this.experimentRun;
    const runId = run.active() ? run.experimentRunId() : null;
    if (!runId) return null;
    const where = run.phase() === 'finalSurvey' ? 'final' : `leg${run.legIndex()}`;
    return `${SurveyComponent.PREFIX}draft_${runId}_${where}_${this.config().id}`;
  }

  private load(key: string): SurveyAnswers {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private persist(value: SurveyAnswers): void {
    for (const key of [this.storageKey(), this.draftKey()]) if (key) this.write(key, value);
  }

  private write(key: string, value: SurveyAnswers): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* localStorage may be unavailable */
    }
  }

  setAnswer(id: string, value: string | number): void {
    if (this.replayAnswers()) return;
    this.answers.update((a) => {
      const next = { ...a, [id]: value };
      this.persist(next);
      return next;
    });
    if (this.missing().has(id) && this.isAnswered(this.question(id))) {
      const next = new Set(this.missing());
      next.delete(id);
      this.missing.set(next);
    }
  }

  /** A number field: empty clears the answer, so a required item stays open. */
  setNumber(id: string, raw: string): void {
    this.setAnswer(id, raw.trim() === '' ? '' : Number(raw));
  }

  /** The percent box: whole numbers 0..100. */
  setPercent(id: string, raw: string): void {
    if (raw.trim() === '') return this.setAnswer(id, '');
    const v = Math.round(Number(raw));
    if (Number.isFinite(v)) this.setAnswer(id, Math.min(100, Math.max(0, v)));
  }

  private question(id: string): SurveyQuestion | undefined {
    for (const s of this.config().sections) for (const q of s.questions) if (q.id === id) return q;
    return undefined;
  }

  /** Answered, and for a number within its range. */
  isAnswered(q: SurveyQuestion | undefined): boolean {
    if (!q) return false;
    const v = this.answers()[q.id];
    if (v === '' || v == null) return false;
    if (q.type === 'number') return typeof v === 'number' && Number.isFinite(v) && (q.min == null || v >= q.min) && (q.max == null || v <= q.max);
    return true;
  }

  private openItems(sections: SurveySection[]): string[] {
    return sections.flatMap((s) => s.questions).filter((q) => !this.isAnswered(q)).map((q) => q.id);
  }

  /** Values of a matrix section's columns. */
  matrixValues(section: SurveySection): number[] {
    const min = section.questions[0]?.min ?? 1;
    return (section.scale ?? []).map((_, i) => min + i);
  }

  back(): void {
    if (this.pageIndex() === 0) return;
    this.goTo(this.pageIndex() - 1);
  }

  next(): void {
    if (this.config().requireAll) {
      const open = this.openItems(this.pageSections());
      if (open.length) return this.markOpen(open);
    }
    this.goTo(this.pageIndex() + 1);
  }

  private goTo(index: number): void {
    this.pageIndex.set(index);
    this.fieldValues.set(this.answers());
    this.missing.set(new Set());
    this.interactionLog.noteSurveyPage(this.config().id, index + 1);
    queueMicrotask(() => this.host.nativeElement.querySelector('.survey-body')?.scrollTo({ top: 0 }));
  }

  private markOpen(ids: string[]): void {
    this.missing.set(new Set(ids));
    queueMicrotask(() =>
      this.host.nativeElement.querySelector(`[data-q="${CSS.escape(ids[0])}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    );
  }

  /** Inclusive range [min..max] for likert buttons. */
  range(q: SurveyQuestion): number[] {
    const min = q.min ?? 1;
    const max = q.max ?? 7;
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }

  answered(): number {
    return this.config().sections.flatMap((s) => s.questions).filter((q) => this.isAnswered(q)).length;
  }

  totalQuestions(): number {
    return this.config().sections.reduce((n, s) => n + s.questions.length, 0);
  }

  submit(): void {
    if (this.config().requireAll) {
      // Every page, not only this one: the first page with an open item opens.
      const at = this.pages().findIndex((p) => this.openItems(p).length > 0);
      if (at >= 0) {
        if (at !== this.pageIndex()) this.goTo(at);
        this.markOpen(this.openItems(this.pages()[at]));
        return;
      }
    }
    // Persistence already happens on every change; submitting also hands the
    // participant's answers over as a file, so a study run leaves a record
    // outside this browser.
    const record = surveyRecord(this.config(), this.answers(), this.surveyContext());
    if (!this.embedded()) this.download(record);
    // Submitted: the session's record holds the answers, the draft goes.
    const draft = this.draftKey();
    if (draft) {
      try {
        localStorage.removeItem(draft);
      } catch {
        /* localStorage may be unavailable */
      }
    }
    this.submitted.emit({ surveyId: record.surveyId, answers: record.answers, scores: record.scores, submittedAt: record.submittedAt });
    this.interactionLog.noteSurveySubmitted(this.config().id, this.i18n.lang());
    this.closed.emit();
  }

  private surveyContext(): SurveyContext {
    return {
      sessionId: this.store.session()?.id ?? null,
      mode: this.store.interactionMode(),
      elapsedSteps: this.store.elapsedSteps(),
      ...(this.context() ?? {}),
    };
  }

  private download(record: ReturnType<typeof surveyRecord>): void {
    const ctx = record.context;
    const stamp = record.submittedAt.replace(/[:.]/g, '-');
    const name = `survey_${ctx.conditionId ?? ctx.tourId ?? ctx.mode}_${ctx.sessionId ?? 'nosession'}_${stamp}.json`;
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* No download in this environment; the answers stay in localStorage. */
    }
  }

  cancel(): void {
    this.closed.emit();
  }
}
