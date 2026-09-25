import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Output, computed, effect, inject, input, signal } from '@angular/core';
import { SessionStore } from '../../core/session.store';
import { postSessionSurvey } from '../../core/survey/survey-configs';
import { SurveyContext, surveyRecord } from '../../core/survey/survey-scoring';
import { SurveyAnswers, SurveyConfig, SurveyQuestion } from '../../core/survey/survey.types';

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
export class SurveyComponent {
  store = inject(SessionStore);

  @Output() closed = new EventEmitter<void>();

  /** Where the run came from (experiment condition, tour, scenario), saved with the answers. */
  readonly context = input<Partial<SurveyContext> | null>(null);
  /** A fixed instrument set, e.g. an experiment's; else the parts chosen in Settings. */
  readonly parts = input<readonly string[] | null>(null);

  readonly config = computed<SurveyConfig>(() =>
    postSessionSurvey(this.store.interactionMode(), [...(this.parts() ?? this.store.enabledSurveyParts())]),
  );
  readonly answers = signal<SurveyAnswers>({});

  private static readonly PREFIX = 'flatland_survey_';

  constructor() {
    let lastKey: string | null = null;
    effect(() => {
      const key = this.storageKey();
      if (key === lastKey) return;
      lastKey = key;
      this.answers.set(key ? this.load(key) : {});
    });
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
    this.download();
    this.closed.emit();
  }

  private download(): void {
    const ctx: SurveyContext = {
      sessionId: this.store.session()?.id ?? null,
      mode: this.store.interactionMode(),
      elapsedSteps: this.store.elapsedSteps(),
      ...(this.context() ?? {}),
    };
    const record = surveyRecord(this.config(), this.answers(), ctx);
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
