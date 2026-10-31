import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageService } from '../../core/i18n/language.service';
import { ReplayService } from '../../core/replay/replay.service';
import { STUDY_CONDITIONS, conditionId } from '../../core/demo/study-conditions';

/**
 * "REPLAY" with the recorded date and time and the replayed experiment, top
 * right, as on television
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
      @if (experiment(); as name) {
        <span class="replay-badge__experiment">{{ name }}</span>
      }
    </div>
  `,
  styleUrl: './replay-badge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReplayBadgeComponent {
  private readonly replay = inject(ReplayService);
  private readonly i18n = inject(LanguageService);

  /** Date with the year and time with seconds of the moment shown, in the viewer's language.
   *  Two digits throughout and tabular figures, so the badge keeps its width while the time runs. */
  readonly recordedTime = computed(() =>
    new Date(this.replay.time()).toLocaleString(this.i18n.lang(), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  );

  /** The replayed experiment, by its name for participants where the condition still exists;
   *  the same for the whole replay, so the badge does not change between legs and screens. */
  readonly experiment = computed(() => {
    const h = this.replay.legs()[0]?.header;
    if (!h) return null;
    const condition = h.conditionId ? STUDY_CONDITIONS.find((c) => conditionId(c) === h.conditionId) : undefined;
    if (condition?.labelKey) return this.i18n.t(condition.labelKey, undefined, condition.label);
    return h.conditionLabel ?? h.tourId ?? h.conditionId ?? null;
  });
}
