import { ChangeDetectionStrategy, Component, afterRenderEffect, inject, signal } from '@angular/core';
import { ClickLocator, ScreenPoint } from '../../core/replay/click-locator';
import { ReplayService } from '../../core/replay/replay.service';

/**
 * The replayed clicks as splashes, a ring that widens and fades where the
 * participant clicked (docs/plans/experiment-logging-frontend-and-replay.md
 * §9.2). Places come from what the click hit, not from screen coordinates,
 * which are not recorded: so they fit any window size. A click whose place
 * is not on screen is left out. Drawn over the replay; the real cursor is
 * never moved.
 */
@Component({
  selector: 'app-replay-clicks',
  standalone: true,
  template: `
    @for (s of splashes(); track s.seq) {
      <span class="replay-click" data-test="replay-click" [style.left.px]="s.x" [style.top.px]="s.y"></span>
    }
  `,
  styleUrl: './replay-clicks.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReplayClicksComponent {
  private readonly replay = inject(ReplayService);
  private readonly locator = inject(ClickLocator);

  readonly splashes = signal<(ScreenPoint & { seq: number })[]>([]);

  constructor() {
    // After the replayed screen has rendered, so the clicked element is where it was.
    afterRenderEffect({
      read: () => {
        const next = this.replay
          .recentClicks()
          .map((c) => ({ seq: c.seq, point: this.locator.locate(c) }))
          .filter((s): s is { seq: number; point: ScreenPoint } => !!s.point)
          .map((s) => ({ seq: s.seq, ...s.point }));
        const prev = this.splashes();
        if (next.length !== prev.length || next.some((s, i) => s.seq !== prev[i].seq || s.x !== prev[i].x || s.y !== prev[i].y)) {
          this.splashes.set(next);
        }
      },
    });
  }
}
