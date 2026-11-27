import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AgentColorService } from '../../core/agent-color.service';
import { MINUTES_PER_STEP } from '../../core/combined-actions/combined-actions-preview';
import { SessionStore } from '../../core/session.store';
import { PlannedCell } from '../../core/timetable/current-delay';
import { CurrentDelayService } from '../../core/timetable/current-delay.service';
import { atStation } from '../../core/timetable/station-cell';
import { TrainIdentityService } from '../../core/train-identity.service';

/**
 * Track Occupancy — per station track: which train stands there now and which
 * are due next (planned time shifted by the delay now). Centre zone; this cut
 * reads and selects. Changing a train's track needs a backend override and is
 * not offered yet. Spec: docs/plans/widget-track-occupancy.md.
 */

/** Two expected uses of one track closer than this (steps) are a clash. */
export const CLASH_WINDOW = 3;
const MAX_UPCOMING = 3;

export interface TrackVisit {
  handle: number;
  /** Expected first step on the track: planned step + delay now. */
  expected: number;
  /** Planned first step on the track. */
  planned: number;
}

interface TrainTag {
  handle: number;
  name: string;
  color: string;
  inMinutes: number;
  lateMinutes: number;
}

interface TrackRow {
  track: number | null;
  now: TrainTag | null;
  next: TrainTag[];
  clash: boolean;
}

interface StationBlock {
  name: string;
  code: string | null;
  tracks: TrackRow[];
}

@Component({
  selector: 'app-track-occupancy',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './track-occupancy.component.html',
  styleUrl: './track-occupancy.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class TrackOccupancyComponent {
  @Input() embedded = false;

  readonly store = inject(SessionStore);
  private readonly delays = inject(CurrentDelayService);
  private readonly colors = inject(AgentColorService);
  private readonly identity = inject(TrainIdentityService);

  readonly showAll = signal(false);

  readonly modeBehavior = computed<{ introKey: string; markClash: boolean }>(() => {
    switch (this.store.interactionMode()) {
      case 'recommendation':
        return { introKey: 'trackOcc.intro.recommendation', markClash: true };
      case 'co-learning':
        return { introKey: 'trackOcc.intro.coLearning', markClash: true };
      case 'director':
        return { introKey: 'trackOcc.intro.director', markClash: true };
    }
  });

  readonly stations = computed<StationBlock[]>(() => {
    const geo = this.store.geography();
    if (!geo || geo.stations.length === 0) return [];
    const plan = this.delays.plan();
    const minutes = this.delays.minutes();
    const now = this.store.elapsedSteps();
    const agents = this.store.agents();
    const active = agents.filter((a) => !(a.state ?? '').includes('DONE'));

    const byStation = new Map<string, StationBlock>();
    for (const st of geo.stations) {
      if (st.kind === 'portal') continue;
      const key = st.code ?? st.name;
      const block = byStation.get(key) ?? { name: st.name.replace(/\s+\d+$/, ''), code: st.code, tracks: [] };
      const [row, col] = st.cell;
      const standing = active.find((a) => !!a.position && atStation(a.position[0], a.position[1], row, col));
      const visits: TrackVisit[] = [];
      for (const a of active) {
        if (a === standing) continue;
        const run = plan.get(a.handle);
        if (!run) continue;
        const delaySteps = Math.round((minutes.get(a.handle) ?? 0) / MINUTES_PER_STEP);
        const v = upcomingVisit(run, row, col, now, delaySteps, a.handle);
        if (v) visits.push(v);
      }
      visits.sort((x, y) => x.expected - y.expected);
      const next = visits.slice(0, MAX_UPCOMING).map((v) => this.tag(v.handle, v.expected - now, minutes));
      block.tracks.push({
        track: st.track,
        now: standing ? this.tag(standing.handle, 0, minutes) : null,
        next,
        clash: hasClash(visits, standing != null, now),
      });
      byStation.set(key, block);
    }
    const blocks = [...byStation.values()];
    for (const b of blocks) b.tracks.sort((x, y) => (x.track ?? 0) - (y.track ?? 0));
    return this.showAll() ? blocks : blocks.filter((b) => b.tracks.some((t) => t.now || t.next.length));
  });

  readonly hasGeography = computed(() => (this.store.geography()?.stations.length ?? 0) > 0);

  private tag(handle: number, inSteps: number, minutes: Map<number, number>): TrainTag {
    return {
      handle,
      name: this.identity.nameFor(handle),
      color: this.colors.getColor(handle),
      inMinutes: Math.max(0, inSteps) * MINUTES_PER_STEP,
      lateMinutes: minutes.get(handle) ?? 0,
    };
  }

  toggleShowAll(): void {
    this.showAll.update((v) => !v);
  }

  isSelected(handle: number): boolean {
    return this.store.selectedHandles().has(handle);
  }

  select(handle: number): void {
    this.store.toggleAgentSelection(handle);
  }
}

/** The train's next planned arrival at the station track (row, col), shifted by its delay; null if none ahead. */
export function upcomingVisit(
  run: PlannedCell[],
  row: number,
  col: number,
  now: number,
  delaySteps: number,
  handle: number,
): TrackVisit | null {
  for (let i = 0; i < run.length; i++) {
    const c = run[i];
    if (!atStation(c.row, c.col, row, col)) continue;
    const prev = run[i - 1];
    if (prev && atStation(prev.row, prev.col, row, col)) continue;
    const expected = c.step + delaySteps;
    if (expected >= now) return { handle, expected, planned: c.step };
  }
  return null;
}

/** Two expected uses within CLASH_WINDOW steps, or a standing train with one due that soon. */
export function hasClash(visits: TrackVisit[], occupied: boolean, now: number): boolean {
  if (occupied && visits.some((v) => v.expected - now <= CLASH_WINDOW)) return true;
  for (let i = 1; i < visits.length; i++) {
    if (visits[i].expected - visits[i - 1].expected <= CLASH_WINDOW) return true;
  }
  return false;
}
