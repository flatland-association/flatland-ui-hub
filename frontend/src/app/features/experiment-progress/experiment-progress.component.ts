import { Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ExperimentRunService } from '../../core/demo/experiment-run.service';
import { TourContextService } from '../../core/demo/tour-context.service';

type StepState = 'done' | 'current' | 'todo';

interface LegStep {
  label: string;
  state: StepState;
  /** The leg questionnaire after this leg, when the condition has one. */
  survey: StepState | null;
}

/**
 * The stepper of a guided condition with more than one leg
 * (docs/plans/experiment-workflow.md §5.4): briefing, the legs as one bracketed
 * loop with their questionnaires, the Schichtbilanz, the final questionnaire,
 * the end — and how many legs are left before the Schichtbilanz.
 */
@Component({
  selector: 'app-experiment-progress',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './experiment-progress.component.html',
  styleUrl: './experiment-progress.component.scss',
})
export class ExperimentProgressComponent {
  readonly run = inject(ExperimentRunService);
  private readonly tour = inject(TourContextService);

  readonly hasBriefing = computed(() => !!this.tour.briefing()?.opening);

  readonly briefingState = computed<StepState>(() => (this.run.phase() === 'briefing' ? 'current' : 'done'));

  readonly legs = computed<LegStep[]>(() => {
    const phase = this.run.phase();
    const at = this.run.legIndex();
    const pastLegs = phase === 'review' || phase === 'finalSurvey' || phase === 'done';
    return this.run.legs().map((_, i) => {
      const state: StepState =
        pastLegs || i < at || (i === at && phase === 'legSurvey') ? 'done' : i === at && phase === 'running' ? 'current' : 'todo';
      const survey: StepState | null = !this.run.hasLegSurvey()
        ? null
        : pastLegs || i < at ? 'done' : i === at && phase === 'legSurvey' ? 'current' : 'todo';
      return { label: this.run.legLabel(i), state, survey };
    });
  });

  readonly reviewState = computed<StepState>(() => {
    const phase = this.run.phase();
    return phase === 'review' ? 'current' : phase === 'finalSurvey' || phase === 'done' ? 'done' : 'todo';
  });

  readonly surveyState = computed<StepState>(() => {
    const phase = this.run.phase();
    return phase === 'finalSurvey' ? 'current' : phase === 'done' ? 'done' : 'todo';
  });

  /** Shown while legs remain before the Schichtbilanz. */
  readonly legsLeft = computed(() => {
    const phase = this.run.phase();
    return phase === 'running' || phase === 'legSurvey' || phase === 'briefing' ? this.run.legsLeft() : null;
  });
}
