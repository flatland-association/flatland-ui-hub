import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, OnInit, Output, computed, effect, inject, input, signal } from '@angular/core';
import { InteractionLogService } from '../../core/interaction-log/interaction-log.service';
import { SessionStore } from '../../core/session.store';
import { postSessionSurvey } from '../../core/survey/survey-configs';
import { SurveyContext, surveyRecord } from '../../core/survey/survey-scoring';
import { SurveyAnswers, SurveyConfig, SurveyQuestion } from '../../core/survey/survey.types';
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
  templateUrl: './survey.component.html',
  styleUrl: './survey.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class SurveyComponent implements OnInit {
  store = inject(SessionStore);
  private readonly interactionLog = inject(InteractionLogService);
  private readonly i18n = inject(LanguageService);

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

  readonly config = computed<SurveyConfig>(() => {
    const recorded = this.replayAnswers();
    const parts = this.parts();
    if (!recorded || parts) return postSessionSurvey(this.store.interactionMode(), [...(parts ?? this.store.enabledSurveyParts())]);
    const all = postSessionSurvey(this.store.interactionMode());
    return { ...all, sections: all.sections.filter((sec) => sec.questions.some((q) => q.id in recorded)) };
  });
  readonly answers = signal<SurveyAnswers>({});

  private static readonly PREFIX = 'flatland_survey_';

  constructor() {
    let lastKey: string | null = null;
    effect(() => {
      const recorded = this.replayAnswers();
      if (recorded) {
        this.answers.set(recorded as SurveyAnswers);
        return;
      }
      const key = this.storageKey();
      if (key === lastKey) return;
      lastKey = key;
      this.answers.set(key ? this.load(key) : {});
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

  private load(key: string): SurveyAnswers {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private persist(value: SurveyAnswers): void {
    const key = this.storageKey();
    if (!key) return;
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
  }

  /** Inclusive range [min..max] for likert buttons. */
  range(q: SurveyQuestion): number[] {
    const min = q.min ?? 1;
    const max = q.max ?? 7;
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }

  answered(): number {
    return Object.values(this.answers()).filter((v) => v !== '' && v != null).length;
  }

  totalQuestions(): number {
    return this.config().sections.reduce((n, s) => n + s.questions.length, 0);
  }

  submit(): void {
    // Persistence already happens on every change; submitting also hands the
    // participant's answers over as a file, so a study run leaves a record
    // outside this browser.
    const record = surveyRecord(this.config(), this.answers(), this.surveyContext());
    if (!this.embedded()) this.download(record);
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
