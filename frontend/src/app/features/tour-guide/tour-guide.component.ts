import { Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SessionStore } from '../../core/session.store';
import { TourContextService } from '../../core/demo/tour-context.service';
import { TourGuideService } from '../../core/demo/tour-guide.service';
import { GuideLoop, TourGuideStep } from '../../core/demo/tour-briefings';
import { ExperimentRunService } from '../../core/demo/experiment-run.service';

interface GuideGroup {
  loop: GuideLoop;
  steps: { step: TourGuideStep; n: number }[];
}

/**
 * Guide strip for a tour with `TourBriefing.guide`: the interaction flow as
 * numbered steps grouped by loop, ticking itself as the run shows each step,
 * with a one-line hint for the step that comes next.
 */
@Component({
  selector: 'app-tour-guide',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './tour-guide.component.html',
  styleUrl: './tour-guide.component.scss',
})
export class TourGuideComponent {
  readonly guide = inject(TourGuideService);
  readonly store = inject(SessionStore);
  private readonly tour = inject(TourContextService);
  private readonly run = inject(ExperimentRunService);

  /**
   * A guided condition with several legs adds an outer level, one group per
   * scenario (docs/plans/experiment-workflow.md §5.5): past legs collapsed, the
   * current one with today's groups, future ones greyed, and the steps after
   * the episode (the Schichtbilanz) once at the end.
   */
  readonly perLeg = computed(() => this.run.multiLeg());
  readonly pastLegs = computed(() => {
    if (!this.perLeg()) return [];
    const history = this.tour.shiftHistory();
    return this.run.legs().slice(0, this.run.legIndex()).map((leg, i) => ({
      label: this.run.legLabel(i),
      ticked: history.find((s) => s.legId === leg.id && s.leg === i)?.guideDone?.length ?? 0,
    }));
  });
  readonly currentLegLabel = computed(() => (this.perLeg() ? this.run.currentLegLabel() : ''));
  readonly futureLegs = computed(() =>
    this.perLeg() ? this.run.legs().slice(this.run.legIndex() + 1).map((_, i) => this.run.legLabel(this.run.legIndex() + 1 + i)) : [],
  );
  readonly closingSteps = computed(() => (this.perLeg() ? this.guide.steps().filter((s) => s.afterEpisode) : []));

  /**
   * The reason dialog is the tour's only place for step 6, so closing it
   * unanswered used to end the question for good. The strip offers it back
   * while the answer is still outstanding.
   */
  readonly canReflect = computed(
    () => this.tour.reasonDialog() && this.store.canReopenRationale(),
  );

  readonly groups = computed<GuideGroup[]>(() => {
    const groups: GuideGroup[] = [];
    this.guide.steps().forEach((step, i) => {
      if (this.perLeg() && step.afterEpisode) return;
      let group = groups[groups.length - 1];
      if (!group || group.loop !== step.loop) {
        group = { loop: step.loop, steps: [] };
        groups.push(group);
      }
      group.steps.push({ step, n: i + 1 });
    });
    return groups;
  });

  readonly currentNumber = computed(() => {
    const current = this.guide.current();
    return current ? this.guide.steps().indexOf(current) + 1 : null;
  });
}
