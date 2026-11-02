import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { InteractionMode } from '../../core/events/event-types';
import { SessionStore } from '../../core/session.store';
import { TrainIdentityService } from '../../core/train-identity.service';

/**
 * Autonomy Map (catalog D1, display half) — per kind of decision, who decides
 * right now. The level is derived from the mode and the settings, the same rule
 * the impact panel and the Director apply; this widget only makes it visible.
 * The runtime dial stays a flagged extension.
 * Spec: docs/plans/widget-autonomy-map.md.
 */
export type AutonomyLevel = 'human' | 'confirm' | 'prewarn' | 'ai' | 'na';

export type DecisionType = 'conflict' | 'routine' | 'strategy' | 'fixed';

export interface AllocationRow {
  type: DecisionType;
  level: AutonomyLevel;
  /** i18n key of the sentence that says *why* this level applies. */
  noteKey: string;
}

export const LEVEL_SCALE: Exclude<AutonomyLevel, 'na'>[] = ['human', 'confirm', 'prewarn', 'ai'];

export function allocationRows(mode: InteractionMode, autoPause: boolean): AllocationRow[] {
  let conflict: AllocationRow;
  if (mode === 'director') {
    conflict = { type: 'conflict', level: 'ai', noteKey: 'autonomyMap.note.conflictDirector' };
  } else if (!autoPause) {
    conflict = { type: 'conflict', level: 'ai', noteKey: 'autonomyMap.note.conflictNoPause' };
  } else if (mode === 'co-learning') {
    conflict = { type: 'conflict', level: 'human', noteKey: 'autonomyMap.note.conflictHold' };
  } else {
    conflict = { type: 'conflict', level: 'prewarn', noteKey: 'autonomyMap.note.conflictCountdown' };
  }
  return [
    conflict,
    { type: 'routine', level: 'ai', noteKey: 'autonomyMap.note.routine' },
    mode === 'director'
      ? { type: 'strategy', level: 'human', noteKey: 'autonomyMap.note.strategyDirector' }
      : { type: 'strategy', level: 'na', noteKey: 'autonomyMap.note.strategyNa' },
    { type: 'fixed', level: 'human', noteKey: 'autonomyMap.note.fixed' },
  ];
}

@Component({
  selector: 'app-autonomy-map',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './autonomy-map.component.html',
  styleUrl: './autonomy-map.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class AutonomyMapComponent {
  @Input() embedded = false;

  readonly store = inject(SessionStore);
  private readonly identity = inject(TrainIdentityService);

  readonly scale = LEVEL_SCALE;

  readonly rows = computed(() =>
    allocationRows(this.store.interactionMode(), this.store.autoPauseOnConflict()),
  );

  readonly countdown = computed(() => this.store.decisionCountdownSeconds());

  /** Trains the operator has fixed by hand (an override is set). */
  readonly fixed = computed(() =>
    this.store
      .agents()
      .filter((a) => a.override_action != null)
      .map((a) => ({ handle: a.handle, name: this.identity.nameFor(a.handle) })),
  );

  /** The record beside the rule: who actually decided this session. */
  readonly record = computed(() => {
    const counts = { human: 0, ai: 0, system: 0 };
    for (const e of this.store.decisionLog()) counts[e.accountableOwner]++;
    return counts;
  });

  isSelected(handle: number): boolean {
    return this.store.selectedHandles().has(handle);
  }

  select(handle: number): void {
    this.store.toggleAgentSelection(handle);
  }
}
