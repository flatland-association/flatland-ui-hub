import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageService } from '../../core/i18n/language.service';
import { ReplayService } from '../../core/replay/replay.service';

/**
 * "REPLAY" with the recorded time and the leg, top right, as on television
 * (docs/plans/experiment-logging-frontend-and-replay.md §9.2), modelled on
 * flatland-hmi's `replay-badge`. Shown only while a replay runs; it takes no
 * clicks.
 */
@Component({
  selector: 'app-replay-badge',
  standalone: true,
  imports: [TranslocoPipe],
  template: `
    <div class="replay-badge" role="status" data-test="replay-badge">
      <span class="replay-badge__mark" aria-hidden="true"></span>
      <strong>{{ 'replay.badge' | transloco }}</strong>
      <span class="replay-badge__time">{{ recordedTime() }}</span>
      @if (legLabel(); as label) {
        <span class="replay-badge__leg">{{ label }}</span>
      }
      @if (screenKey(); as key) {
        <span class="replay-badge__screen">· {{ key | transloco }}</span>
      }
    </div>
  `,
  styleUrl: './replay-badge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReplayBadgeComponent {
  private readonly replay = inject(ReplayService);
  private readonly i18n = inject(LanguageService);

  /** Date and time with seconds of the moment shown, in the viewer's language. */
  readonly recordedTime = computed(() =>
    new Date(this.replay.time()).toLocaleString(this.i18n.lang(), {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  );

  /** Screens the replay names rather than draws (questionnaire, help, an intro, …); none on the working screen. */
  readonly screenKey = computed(() => {
    const view = this.replay.view()?.view;
    return view && SCREENS.has(view) ? `replay.screen.${view}` : null;
  });

  /** The condition and, in a run of several legs, which one. */
  readonly legLabel = computed(() => {
    const leg = this.replay.leg();
    if (!leg) return null;
    const parts = [leg.header.conditionLabel ?? leg.header.tourId ?? leg.header.conditionId].filter(Boolean);
    const total = this.replay.legs().length;
    // An intro names its leg: the next leg's intro is logged at the end of the previous record.
    const named = this.replay.view()?.detail?.['leg'];
    const n = this.replay.view()?.view === 'mode_intro' && typeof named === 'number' ? named + 1 : this.replay.legIndex() + 1;
    if (total > 1) parts.push(this.i18n.t('replay.leg', { n: Math.min(n, total), total }));
    return parts.join(' · ') || null;
  });
}

/** `view_enter` views with a `replay.screen.*` label. `session` is the working screen itself. */
const SCREENS = new Set(['experiment', 'resume_prompt', 'tour_opening', 'mode_intro', 'reflection', 'survey', 'shift_review', 'help', 'settings', 'demo_complete', 'hidden', 'start']);

