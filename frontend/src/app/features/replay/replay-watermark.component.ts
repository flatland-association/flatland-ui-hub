import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** Enough tiles to cover a large screen at the watermark's angle. */
const TILES = Array.from({ length: 48 }, (_, i) => i);

/**
 * A veil over the whole screen with "REPLAY" written across it, as on a print
 * preview, so a replay is never mistaken for a live session
 * (docs/plans/experiment-logging-frontend-and-replay.md §9.2). It takes no
 * clicks and sits under the replay badge and controls.
 */
@Component({
  selector: 'app-replay-watermark',
  standalone: true,
  imports: [TranslocoPipe],
  template: `
    <div class="replay-watermark" aria-hidden="true">
      @for (tile of tiles; track tile) {
        <span class="replay-watermark__text">{{ 'replay.badge' | transloco }}</span>
      }
    </div>
  `,
  styleUrl: './replay-watermark.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReplayWatermarkComponent {
  readonly tiles = TILES;
}
