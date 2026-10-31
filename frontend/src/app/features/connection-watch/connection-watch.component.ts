import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AgentColorService } from '../../core/agent-color.service';
import { MINUTES_PER_STEP } from '../../core/combined-actions/combined-actions-preview';
import { AgentDTO, SceneGeography } from '../../core/models';
import { SessionStore } from '../../core/session.store';
import { PlannedCell } from '../../core/timetable/current-delay';
import { CurrentDelayService } from '../../core/timetable/current-delay.service';
import { TrainIdentityService } from '../../core/train-identity.service';
import { atStation } from '../../core/timetable/station-cell';

/**
 * Connection Watch — connections derived from the baseline timetable: a feeder
 * arriving at a station shortly before another train departs from it. Shows the
 * reserve left with the delays now. Neutral in every mode; no hold advice.
 * The scenario format has no connection data yet, so pairs are derived and
 * labelled as such. Spec: docs/plans/widget-connection-watch.md.
 */

/** Largest planned gap (steps) between arrival and departure that counts as a connection. */
export const CONNECTION_WINDOW = 15;
/** Minimum transfer time (steps) for a connection to count as safe. */
export const MIN_TRANSFER = 2;

export type ConnectionStatus = 'ok' | 'tight' | 'broken';

export interface Connection {
  station: string;
  feeder: number;
  departing: number;
  /** Planned gap in steps. */
  gap: number;
  /** Reserve now in steps: gap − feeder delay + departing delay. */
  reserve: number;
  status: ConnectionStatus;
}

@Component({
  selector: 'app-connection-watch',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './connection-watch.component.html',
  styleUrl: './connection-watch.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class ConnectionWatchComponent {
  @Input() embedded = false;

  readonly store = inject(SessionStore);
  private readonly delays = inject(CurrentDelayService);
  private readonly colors = inject(AgentColorService);
  private readonly identity = inject(TrainIdentityService);
  readonly minutesPerStep = MINUTES_PER_STEP;

  readonly modeBehavior = computed<{ introKey: string }>(() => {
    switch (this.store.interactionMode()) {
      case 'recommendation':
        return { introKey: 'conn.intro.recommendation' };
      case 'co-learning':
        return { introKey: 'conn.intro.coLearning' };
      case 'director':
        return { introKey: 'conn.intro.director' };
    }
  });

  readonly connections = computed<Connection[]>(() => {
    const steps = new Map<number, number>();
    for (const [h, m] of this.delays.minutes()) steps.set(h, Math.round(m / MINUTES_PER_STEP));
    return deriveConnections(this.store.agents(), this.delays.plan(), this.store.geography(), steps);
  });

  readonly hasPlan = computed(() => this.delays.plan().size > 0);

  name(handle: number): string {
    return this.identity.nameFor(handle);
  }

  color(handle: number): string {
    return this.colors.getColor(handle);
  }

  select(handle: number): void {
    this.store.toggleAgentSelection(handle);
  }
}

type StationOf = (cell: [number, number] | null | undefined) => string | null;

function stationLookup(geo: SceneGeography | null): StationOf {
  const byCell = new Map<string, string>();
  for (const s of geo?.stations ?? []) byCell.set(`${s.cell[0]},${s.cell[1]}`, s.name);
  return (cell) => (cell ? byCell.get(`${cell[0]},${cell[1]}`) ?? null : null);
}

function stopCells(a: AgentDTO): [number, number][] {
  const cells = (a.stops ?? []).map((s) => s.cell).filter((c): c is [number, number] => !!c);
  if (cells.length >= 2) return cells;
  return [a.initial_position, a.target].filter((c): c is [number, number] => !!c);
}

function firstStepAt(run: PlannedCell[], cell: [number, number]): number | null {
  return run.find((c) => atStation(c.row, c.col, cell[0], cell[1]))?.step ?? null;
}

function lastStepAt(run: PlannedCell[], cell: [number, number]): number | null {
  for (let i = run.length - 1; i >= 0; i--) {
    if (atStation(run[i].row, run[i].col, cell[0], cell[1])) return run[i].step;
  }
  return null;
}

/** Feeder arrivals and departures at the same station, within CONNECTION_WINDOW. */
export function deriveConnections(
  agents: AgentDTO[],
  plan: Map<number, PlannedCell[]>,
  geo: SceneGeography | null,
  delaySteps: Map<number, number>,
): Connection[] {
  const stationOf = stationLookup(geo);
  const arrivals: { handle: number; station: string; step: number }[] = [];
  const departures: { handle: number; station: string; step: number }[] = [];
  for (const a of agents) {
    const run = plan.get(a.handle);
    if (!run) continue;
    const stops = stopCells(a);
    stops.forEach((cell, i) => {
      const station = stationOf(cell);
      if (!station) return;
      if (i > 0) {
        const step = firstStepAt(run, cell);
        if (step != null) arrivals.push({ handle: a.handle, station, step });
      }
      if (i < stops.length - 1) {
        const step = lastStepAt(run, cell);
        if (step != null) departures.push({ handle: a.handle, station, step });
      }
    });
  }
  const done = new Set(agents.filter((a) => (a.state ?? '').includes('DONE')).map((a) => a.handle));
  const out: Connection[] = [];
  for (const arr of arrivals) {
    for (const dep of departures) {
      if (dep.handle === arr.handle || dep.station !== arr.station || done.has(dep.handle)) continue;
      const gap = dep.step - arr.step;
      if (gap <= 0 || gap > CONNECTION_WINDOW) continue;
      const reserve = gap - (delaySteps.get(arr.handle) ?? 0) + (delaySteps.get(dep.handle) ?? 0);
      const status: ConnectionStatus = reserve < 0 ? 'broken' : reserve < MIN_TRANSFER ? 'tight' : 'ok';
      out.push({ station: arr.station, feeder: arr.handle, departing: dep.handle, gap, reserve, status });
    }
  }
  return out.sort((x, y) => x.reserve - y.reserve);
}
