import { Component, DestroyRef, ElementRef, afterRenderEffect, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ExperimentRunService } from '../../core/demo/experiment-run.service';
import { TourContextService } from '../../core/demo/tour-context.service';
import { TourGuideService } from '../../core/demo/tour-guide.service';

type StepState = 'done' | 'current' | 'todo';

/** Two lines from the current leg's box down to the guide strip's top corners, in host px. */
interface Connector {
  width: number;
  height: number;
  left: [number, number, number, number];
  right: [number, number, number, number];
}

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
  host: { '[class.is-connected]': 'connected()' },
})
export class ExperimentProgressComponent {
  readonly run = inject(ExperimentRunService);
  private readonly tour = inject(TourContextService);
  private readonly guide = inject(TourGuideService);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  /**
   * While a leg runs, the guide strip below is that leg's subtree
   * (experiment-workflow §5.5): it mirrors the leg's box, and two lines join
   * the box's bottom corners to the strip's top corners.
   */
  readonly connected = computed(() => this.run.phase() === 'running' && this.guide.active());
  readonly connector = signal<Connector | null>(null);

  constructor() {
    const resize = new ResizeObserver(() => this.measure());
    resize.observe(this.host.nativeElement);
    inject(DestroyRef).onDestroy(() => resize.disconnect());
    afterRenderEffect(() => {
      this.legs();
      this.connected();
      this.measure();
    });
  }

  private measure(): void {
    const host = this.host.nativeElement;
    const leg = host.querySelector<HTMLElement>('.xp__legs > .xp__step.is-current');
    if (!this.connected() || !leg) {
      this.connector.set(null);
      return;
    }
    const h = host.getBoundingClientRect();
    const b = leg.getBoundingClientRect();
    // The leg's outline is 2px outside its box and pill-shaped: start where its
    // bottom edge runs straight; end where the strip's rounded top edge does.
    const inset = Math.min(b.height / 2, 10);
    const y = b.bottom - h.top + 1;
    const end = h.height + 1;
    this.connector.set({
      width: h.width,
      height: h.height + 2,
      left: [b.left - h.left + inset, y, 10, end],
      right: [b.right - h.left - inset, y, h.width - 10, end],
    });
  }

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
