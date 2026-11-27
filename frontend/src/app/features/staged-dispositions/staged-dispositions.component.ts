import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AgentColorService } from '../../core/agent-color.service';
import {
  DelayExpectation,
  StagedAction,
  StagedDisposition,
  StagedDispositionService,
  observedOutcome,
} from '../../core/dispatch/staged-disposition.service';
import { SessionStore } from '../../core/session.store';
import { TrainIdentityService } from '../../core/train-identity.service';

/**
 * Staged Dispositions — prepare a hold or release for the selected train, state
 * what you expect, release it, then compare expected and observed delay.
 * Right zone (decision). The expectation is required in Co-Learning.
 * Spec: docs/plans/widget-staged-dispositions.md.
 */
@Component({
  selector: 'app-staged-dispositions',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './staged-dispositions.component.html',
  styleUrl: './staged-dispositions.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class StagedDispositionsComponent {
  @Input() embedded = false;

  readonly store = inject(SessionStore);
  readonly staged = inject(StagedDispositionService);
  private readonly colors = inject(AgentColorService);
  private readonly identity = inject(TrainIdentityService);

  readonly expectations: DelayExpectation[] = ['less', 'same', 'more'];
  readonly actionsOffered: StagedAction[] = ['hold', 'proceed'];

  /** The single place this widget branches on mode. */
  readonly modeBehavior = computed<{ introKey: string; expectationRequired: boolean; offered: boolean }>(() => {
    switch (this.store.interactionMode()) {
      case 'recommendation':
        return { introKey: 'staged.intro.recommendation', expectationRequired: false, offered: true };
      case 'co-learning':
        return { introKey: 'staged.intro.coLearning', expectationRequired: true, offered: true };
      case 'director':
        return { introKey: 'staged.intro.director', expectationRequired: false, offered: false };
    }
  });

  readonly selected = computed(() => {
    const h = this.store.selectedHandle();
    if (h == null) return null;
    const a = this.store.agents().find((x) => x.handle === h);
    return a && !(a.state ?? '').includes('DONE') ? a : null;
  });

  readonly pending = computed(() => this.staged.entries().filter((e) => e.releasedAt == null));
  readonly released = computed(() =>
    this.staged
      .entries()
      .filter((e) => e.releasedAt != null)
      .slice()
      .reverse(),
  );

  name(handle: number): string {
    return this.identity.nameFor(handle);
  }

  color(handle: number): string {
    return this.colors.getColor(handle);
  }

  stage(action: StagedAction): void {
    const a = this.selected();
    if (a) this.staged.stage(a.handle, action);
  }

  canRelease(e: StagedDisposition): boolean {
    return !this.modeBehavior().expectationRequired || e.expectation != null;
  }

  outcome(e: StagedDisposition): DelayExpectation | null {
    return observedOutcome(e, this.store.elapsedSteps());
  }

  delta(e: StagedDisposition): number {
    return (e.delayLatest ?? 0) - (e.delayAtRelease ?? 0);
  }
}
