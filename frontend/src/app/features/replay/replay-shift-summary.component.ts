import { CUSTOM_ELEMENTS_SCHEMA, ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ReplayService } from '../../core/replay/replay.service';

/**
 * The Schichtbilanz of a replayed run, read-only (docs/plans/experiment-logging-frontend-and-replay.md
 * §9.3, level A1): one row per replayed leg with its trains at the leg's end
 * and its interventions, then the totals. The same columns as the live one in
 * `TourDebriefComponent`; its figures come from the recording, not from live
 * services.
 */
@Component({
  selector: 'app-replay-shift-summary',
  standalone: true,
  imports: [TranslocoPipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <section class="replay-summary" data-test="replay-shift-summary">
      <sbb-title level="2" visual-level="4">{{ 'tourUi.debrief.section.shift-summary' | transloco }}</sbb-title>
      <table class="replay-summary__table">
        <thead>
          <tr>
            <th scope="col">{{ 'experimentRun.review.leg' | transloco }}</th>
            <th scope="col">{{ 'tourUi.debrief.kpi.arrived' | transloco }}</th>
            <th scope="col">{{ 'tourUi.debrief.kpi.delayed' | transloco }}</th>
            <th scope="col">{{ 'tourUi.debrief.kpi.totalDelay' | transloco }}</th>
            <th scope="col">{{ 'tourUi.debrief.kpi.malfunctions' | transloco }}</th>
            <th scope="col">{{ 'experimentRun.review.interventions' | transloco }}</th>
          </tr>
        </thead>
        <tbody>
          @for (row of replay.legSummaries(); track $index) {
            <tr>
              <th scope="row">{{ 'replay.leg' | transloco: { n: $index + 1, total: replay.legSummaries().length } }}</th>
              @if (row.kpis; as k) {
                <td>{{ k.arrived }}/{{ k.total }}</td>
                <td>{{ k.delayed }}</td>
                <td>{{ k.totalDelay }}</td>
                <td>{{ k.malfunctions }}</td>
              } @else {
                <td>—</td><td>—</td><td>—</td><td>—</td>
              }
              <td>{{ row.interventions }}</td>
            </tr>
          }
          @if (replay.legSummaries().length > 1) {
            <tr class="replay-summary__total">
              <th scope="row">{{ 'experimentRun.review.total' | transloco }}</th>
              <td>{{ totals().arrived }}/{{ totals().total }}</td>
              <td>{{ totals().delayed }}</td>
              <td>{{ totals().totalDelay }}</td>
              <td>{{ totals().malfunctions }}</td>
              <td>{{ totals().interventions }}</td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
  styleUrl: './replay-shift-summary.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReplayShiftSummaryComponent {
  readonly replay = inject(ReplayService);

  readonly totals = computed(() =>
    this.replay.legSummaries().reduce(
      (t, r) => ({
        total: t.total + (r.kpis?.total ?? 0),
        arrived: t.arrived + (r.kpis?.arrived ?? 0),
        delayed: t.delayed + (r.kpis?.delayed ?? 0),
        totalDelay: t.totalDelay + (r.kpis?.totalDelay ?? 0),
        malfunctions: t.malfunctions + (r.kpis?.malfunctions ?? 0),
        interventions: t.interventions + r.interventions,
      }),
      { total: 0, arrived: 0, delayed: 0, totalDelay: 0, malfunctions: 0, interventions: 0 },
    ),
  );
}
