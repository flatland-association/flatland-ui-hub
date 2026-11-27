import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { DecisionEvent } from '../../core/decision-log';
import { LanguageService } from '../../core/i18n/language.service';
import { NotificationWordingService } from '../../core/notification-wording.service';
import { OverviewDecision, OverviewLeg, reflectionLines } from '../../core/shift-review';
import { TrainIdentityService } from '../../core/train-identity.service';

/**
 * The reflection overview of the Schichtbilanz
 * (docs/plans/plan-b-control-group.md §4.5): per scenario, each decision with
 * the disturbance messages open at it, and its reason and reflection answers.
 * Szenario | Ereignisse | Entscheidungen | Reflexion. Used live by
 * `TourDebriefComponent` in an experiment and by `ReplayShiftSummaryComponent`.
 */
@Component({
  selector: 'app-reflection-overview',
  standalone: true,
  imports: [TranslocoPipe],
  template: `
    <div class="ro">
      <span class="ro__title">{{ 'experimentRun.review.overviewTitle' | transloco }}</span>
      <table class="ro__table">
        <thead>
          <tr>
            <th scope="col">{{ 'experimentRun.review.leg' | transloco }}</th>
            <th scope="col">{{ 'experimentRun.review.events' | transloco }}</th>
            <th scope="col">{{ 'experimentRun.review.decisions' | transloco }}</th>
            <th scope="col">{{ 'experimentRun.review.reflection' | transloco }}</th>
          </tr>
        </thead>
        <tbody>
          @for (leg of legs(); track $index) {
            @if (leg.decisions.length === 0) {
              <tr class="ro__leg">
                <th scope="row">{{ leg.label }}</th>
                <td>–</td>
                <td>{{ 'experimentRun.review.noDecisions' | transloco }}</td>
                <td>–</td>
              </tr>
            } @else {
              @for (d of leg.decisions; track $index; let first = $first) {
                <tr [class.ro__leg]="first">
                  @if (first) {
                    <th scope="row" [attr.rowspan]="leg.decisions.length">{{ leg.label }}</th>
                  }
                  <td>
                    <span class="ro__step">{{ 'tourUi.guide.step' | transloco: { n: d.step } }}</span>
                    @for (e of d.events; track $index) {
                      <span class="ro__line">{{ eventText(e, leg.scenarioId) }}</span>
                    } @empty {
                      <span class="ro__line">–</span>
                    }
                  </td>
                  <td><strong>{{ trainName(d.handle, leg.scenarioId) }}</strong> · {{ actionLabel(d) }}</td>
                  <td>
                    @let reflection = lines(d.reflection);
                    @if (d.reason) {
                      <span class="ro__line">{{ 'tourUi.debrief.reason' | transloco: { reason: d.reason } }}</span>
                    }
                    @for (line of reflection; track line) {
                      <span class="ro__line">{{ line }}</span>
                    }
                    @if (!d.reason && !reflection.length) {
                      <span class="ro__line">–</span>
                    }
                  </td>
                </tr>
              }
            }
          }
        </tbody>
      </table>
    </div>
  `,
  styleUrl: './reflection-overview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReflectionOverviewComponent {
  /** One entry per scenario, in run order. */
  readonly legs = input.required<OverviewLeg[]>();

  private readonly i18n = inject(LanguageService);
  private readonly identity = inject(TrainIdentityService);
  private readonly wording = inject(NotificationWordingService);

  /** As the TMS panel words it, in the viewer's language, with the trains
   *  named as in the leg's scenario. */
  eventText(e: DecisionEvent, scenarioId: string | null): string {
    return this.wording.messageOf({ id: '', kind: 'error', timestamp: 0, ...e }, (h) => this.identity.nameIn(scenarioId, h));
  }

  lines(reflection: Record<string, string> | null): string[] {
    return reflectionLines(reflection, (key, params) => this.i18n.t(key, params));
  }

  /** As the leg's scenario named it, not the session open now (an earlier
   *  leg's trains had their own names). */
  trainName(handle: number, scenarioId: string | null): string {
    return this.identity.nameIn(scenarioId, handle);
  }

  /** A course taken in the Handlungsoptionen as its button reads ("Plan
   *  behalten" is logged as `proceed`, the same word as the human's own
   *  "Weiterfahren"); any other decision by its action. */
  actionLabel(d: OverviewDecision): string {
    if (d.proposal === 'plan') return this.i18n.t('proposals.keepPlan');
    if (d.proposal === 'ai') return this.i18n.t('proposals.takeAi');
    return this.i18n.t(`tourUi.debrief.action.${d.action}`, undefined, d.action);
  }
}
