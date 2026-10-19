import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject } from '@angular/core';
import { SessionStore } from '../../core/session.store';
import { AgentDTO } from '../../core/models';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * Goal-achievement panel — the human's primary supervisory surface in Director
 * mode (WP 3.4). Instead of per-incident prompts, it shows live global KPIs
 * against simple directive targets, so the "director" supervises goal
 * achievement (RP2 Part B: objective is system-wide).
 */
@Component({
  imports: [TranslocoPipe],
  selector: 'app-goal-achievement',
  standalone: true,
  templateUrl: './goal-achievement.component.html',
  styleUrl: './goal-achievement.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class GoalAchievementComponent {
  store = inject(SessionStore);

  /** Simple, legible targets. Kept here so they're easy to tweak later. */
  readonly meanDelayTarget = 5;

  private isMalfunctioning(a: AgentDTO): boolean {
    return !!a.is_malfunctioning
      || (a.malfunction_remaining ?? 0) > 0
      || String(a.state ?? '').toUpperCase().includes('MALFUNCTION');
  }

  readonly total = computed(() => this.store.agents().length);
  readonly arrived = computed(() => this.store.agents().filter((a) => String(a.state).toUpperCase() === 'DONE').length);
  readonly arrivedPct = computed(() => {
    const t = this.total();
    return t === 0 ? 0 : Math.round((this.arrived() / t) * 100);
  });
  readonly totalDelay = computed(() => this.store.agents().reduce((s, a) => s + Math.max(0, a.delay ?? 0), 0));
  readonly meanDelay = computed(() => {
    const t = this.total();
    return t === 0 ? 0 : Math.round((this.totalDelay() / t) * 10) / 10;
  });
  readonly onTimePct = computed(() => {
    const t = this.total();
    if (t === 0) return 0;
    const onTime = this.store.agents().filter((a) => (a.delay ?? 0) <= 0).length;
    return Math.round((onTime / t) * 100);
  });
  readonly malfunctions = computed(() => this.store.agents().filter((a) => this.isMalfunctioning(a)).length);

  // Target pass/fail flags.
  readonly arrivedOk = computed(() => this.arrivedPct() === 100);
  readonly delayOk = computed(() => this.meanDelay() <= this.meanDelayTarget);
  readonly malfunctionOk = computed(() => this.malfunctions() === 0);
}
