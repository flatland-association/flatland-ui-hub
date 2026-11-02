import { ChangeDetectionStrategy, Component, afterRenderEffect, inject, signal } from '@angular/core';
import type { PointerSample } from '../../core/interaction-log/pointer-log.service';
import type { ScreenPoint } from '../../core/replay/click-locator';
import { ReplayService } from '../../core/replay/replay.service';

/**
 * The recorded pointer as a ghost cursor over the replay
 * (docs/plans/experiment-logging-frontend-and-replay.md §5.2.1, step 30).
 * Inside a panel it is placed by its position within that panel as drawn
 * now, so it fits any window size; elsewhere by its share of the window.
 * It moves in a straight line between samples and rests where the pointer
 * rested. The real cursor is never moved.
 */
@Component({
  selector: 'app-replay-cursor',
  standalone: true,
  template: `
    @if (point(); as p) {
      <svg class="replay-cursor" data-test="replay-cursor" viewBox="0 0 16 24" aria-hidden="true"
           [style.left.px]="p.x" [style.top.px]="p.y">
        <path d="M1 1 L1 19 L5.5 14.5 L8.5 22 L11.5 20.8 L8.6 13.5 L14.5 13.5 Z" />
      </svg>
    }
  `,
  styleUrl: './replay-cursor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReplayCursorComponent {
  private readonly replay = inject(ReplayService);

  readonly point = signal<ScreenPoint | null>(null);

  constructor() {
    // After the replayed screen has rendered, so a panel is where it is drawn now.
    afterRenderEffect({
      read: () => {
        const at = this.replay.pointer();
        let next: ScreenPoint | null = null;
        if (at) {
          const a = place(at.from);
          const b = at.to ? place(at.to) : null;
          next = b ? { x: a.x + (b.x - a.x) * at.f, y: a.y + (b.y - a.y) * at.f } : a;
        }
        const prev = this.point();
        if (next?.x !== prev?.x || next?.y !== prev?.y) this.point.set(next);
      },
    });
  }
}

/** A sample's point on screen: within its panel when that panel is drawn, else by its share of the window. */
function place(s: PointerSample): ScreenPoint {
  const panel = s.panel ? document.querySelector(`[data-panel-type="${CSS.escape(s.panel)}"]`) : null;
  const box = panel?.getBoundingClientRect();
  if (box && box.width > 0 && box.height > 0 && s.px != null && s.py != null) {
    return { x: box.left + s.px * box.width, y: box.top + s.py * box.height };
  }
  return { x: (s.x ?? 0) * window.innerWidth, y: (s.y ?? 0) * window.innerHeight };
}
