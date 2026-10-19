import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'app-goal-achievement-panel',
  standalone: true,
  imports: [TranslocoPipe, CommonModule],
  templateUrl: './goal-achievement-panel.component.html',
  styleUrl: './goal-achievement-panel.component.scss',
})
export class GoalAchievementPanelComponent {
  @Input() panel?: any;
  @Input() zone?: string;
  @Input() embedded = true;

  get title(): string {
    return String(this.panel?.title || 'Goal Achievement');
  }

  get targetLabel(): string {
    return String(this.panel?.config?.targetLabel || 'Operational goal');
  }

  get progress(): number {
    const raw = Number(this.panel?.config?.progress ?? 0);
    if (!Number.isFinite(raw)) {
      return 0;
    }

    return Math.max(0, Math.min(100, Math.round(raw)));
  }

  get status(): 'ready' | 'progress' | 'complete' {
    if (this.progress >= 100) {
      return 'complete';
    }

    if (this.progress > 0) {
      return 'progress';
    }

    return 'ready';
  }

  get statusLabel(): string {
    if (this.status === 'complete') {
      return 'Goal reached';
    }

    if (this.status === 'progress') {
      return 'In progress';
    }

    return 'Ready';
  }
}
