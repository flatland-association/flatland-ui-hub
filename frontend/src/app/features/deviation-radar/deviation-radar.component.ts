import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AgentColorService } from '../../core/agent-color.service';
import { SessionStore } from '../../core/session.store';
import { CurrentDelayService } from '../../core/timetable/current-delay.service';
import { DelayHistoryService, DelayTrend } from '../../core/timetable/delay-history.service';
import { TrainIdentityService } from '../../core/train-identity.service';

/**
 * Deviation Radar — active trains sorted by their delay now, with a trend and a
 * sparkline. Left zone: it reads and selects, it never acts. The "late"
 * threshold is a panel setting, not a control in the widget.
 * Spec: docs/plans/widget-deviation-radar.md.
 */
type Filter = 'all' | 'late' | 'growing';

interface RadarRow {
  handle: number;
  name: string;
  color: string;
  minutes: number;
  trend: DelayTrend;
  late: boolean;
  spark: string;
}

const SPARK_W = 60;
const SPARK_H = 16;

@Component({
  selector: 'app-deviation-radar',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './deviation-radar.component.html',
  styleUrl: './deviation-radar.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class DeviationRadarComponent {
  @Input() embedded = false;
  /** Minutes from which a train counts as late (panel setting). */
  @Input() set thresholdMinutes(v: number | null | undefined) {
    this.threshold.set(typeof v === 'number' && v >= 0 ? v : 3);
  }

  readonly store = inject(SessionStore);
  private readonly delays = inject(CurrentDelayService);
  private readonly history = inject(DelayHistoryService);
  private readonly colors = inject(AgentColorService);
  private readonly identity = inject(TrainIdentityService);

  readonly threshold = signal(3);
  readonly filter = signal<Filter>('all');
  readonly filters: Filter[] = ['all', 'late', 'growing'];

  /** The single place this widget branches on mode: framing only. */
  readonly modeBehavior = computed<{ introKey: string }>(() => {
    switch (this.store.interactionMode()) {
      case 'recommendation':
        return { introKey: 'devRadar.intro.recommendation' };
      case 'co-learning':
        return { introKey: 'devRadar.intro.coLearning' };
      case 'director':
        return { introKey: 'devRadar.intro.director' };
    }
  });

  readonly rows = computed<RadarRow[]>(() => {
    const minutes = this.delays.minutes();
    const trends = this.history.trends();
    const hist = this.history.history();
    const limit = this.threshold();
    const rows: RadarRow[] = [];
    for (const a of this.store.agents()) {
      if ((a.state ?? '').includes('DONE')) continue;
      const m = minutes.get(a.handle);
      if (m == null) continue;
      rows.push({
        handle: a.handle,
        name: this.identity.nameFor(a.handle),
        color: this.colors.getColor(a.handle),
        minutes: m,
        trend: trends.get(a.handle) ?? 'stable',
        late: m >= limit && m > 0,
        spark: sparkline((hist.get(a.handle) ?? []).map((s) => s.minutes)),
      });
    }
    return rows.sort((x, y) => y.minutes - x.minutes || x.handle - y.handle);
  });

  readonly visible = computed(() => {
    const f = this.filter();
    return this.rows().filter((r) => f === 'all' || (f === 'late' ? r.late : r.trend === 'growing'));
  });

  readonly calm = computed(() => this.rows().length > 0 && !this.rows().some((r) => r.trend === 'growing'));
  readonly lateCount = computed(() => this.rows().filter((r) => r.late).length);

  setFilter(f: Filter): void {
    this.filter.set(f);
  }

  isSelected(handle: number): boolean {
    return this.store.selectedHandles().has(handle);
  }

  select(handle: number): void {
    this.store.toggleAgentSelection(handle);
  }
}

/** SVG polyline points for the delay samples; '' when there is nothing to draw. */
export function sparkline(values: number[]): string {
  if (values.length < 2) return '';
  const max = Math.max(1, ...values);
  const dx = SPARK_W / (values.length - 1);
  return values
    .map((v, i) => `${(i * dx).toFixed(1)},${(SPARK_H - (v / max) * (SPARK_H - 2) - 1).toFixed(1)}`)
    .join(' ');
}
