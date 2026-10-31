import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ReplayService } from '../../core/replay/replay.service';

/**
 * The replay's own controls, the only thing on screen that takes clicks while
 * a replay runs (docs/plans/experiment-logging-frontend-and-replay.md §9.2):
 * play, pause, the position in the recording, and leaving the replay.
 */
@Component({
  selector: 'app-replay-controls',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './replay-controls.component.html',
  styleUrl: './replay-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReplayControlsComponent {
  readonly replay = inject(ReplayService);

  readonly elapsed = computed(() => clock(this.replay.time() - this.replay.start()));
  readonly total = computed(() => clock(this.replay.end() - this.replay.start()));
}

/** `m:ss`, or `h:mm:ss` from an hour on. */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
