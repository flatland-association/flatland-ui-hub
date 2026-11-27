import { Injectable, Pipe, PipeTransform, computed, inject, signal } from '@angular/core';
import { UiConfigService } from '../config/ui-config.service';

/**
 * Times on screen in simulation steps or in minutes
 * (docs/plans/plan-b-round2-colearning.md, item 2).
 *
 * One step is shown as one minute: there is no conversion, only the words
 * change (`MINUTES_PER_STEP` is 1). Each text with a step unit has a sibling
 * key with the minute wording, `<key>Min`; `timeKey()` picks it.
 */
export type TimeUnit = 'steps' | 'minutes';

/** The keys with a minute sibling (`<key>Min`). time-unit.service.spec.ts
 *  checks that each sibling exists in en, de and fr. */
export const MINUTE_KEYS: ReadonlySet<string> = new Set([
  'zwd.timeUnit',
  'zwd.conflicts.inMin',
  'zwd.delaySteps',
  'map.predicted',
  'map.holdMark',
  'map.contentionDetail',
  'map.problem.malfunctionLeft',
  'lanes.inSteps',
  'proposals.step',
  'proposals.stepOnPlan',
  'proposals.stepVsPlan',
  'proposals.course.wait',
  'proposals.course.waitOne',
  'proposals.course.branch',
  'proposals.axis.unit',
  'proposals.compareNote',
  'impact.steps',
  'impact.bufferNone',
  'notifications.train.malfunction.message',
  'notifications.train.malfunction.short',
  'log.decidedAt',
  'footer.step',
  'toolbar.stepsRemaining',
  'hypothesis.impact.blockLong',
  'hypothesis.impact.blockShort',
  'situation.step',
  // The Schichtbilanz (docs/plans/plan-b-round2-experiments.md item 4).
  'tourUi.guide.step',
  'tourUi.debrief.kpi.totalDelay',
]);

/** The key to translate for `key` in `unit`. */
export function timeKey(key: string, unit: TimeUnit): string {
  return unit === 'minutes' && MINUTE_KEYS.has(key) ? `${key}Min` : key;
}

const STORAGE_KEY = 'flatland.timeUnit';

@Injectable({ providedIn: 'root' })
export class TimeUnitService {
  private readonly uiConfig = inject(UiConfigService);

  /** The viewer's choice in Settings, remembered in this browser; steps by default. */
  readonly preference = signal<TimeUnit>(TimeUnitService.read());

  /** What the screen shows: the layout's fixed unit (`UiConfig.timeUnit`), else the preference. */
  readonly unit = computed<TimeUnit>(() => this.uiConfig.timeUnit() ?? this.preference());

  /** The key to translate for `key` in the current unit. */
  key(key: string): string {
    return timeKey(key, this.unit());
  }

  setPreference(unit: TimeUnit): void {
    this.preference.set(unit);
    try {
      localStorage.setItem(STORAGE_KEY, unit);
    } catch {
      // Not persisting is fine; the choice holds for this visit.
    }
  }

  private static read(): TimeUnit {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'minutes' ? 'minutes' : 'steps';
    } catch {
      return 'steps';
    }
  }
}

/** `'key' | timeKey | transloco` — the minute sibling when the screen shows
 *  minutes. Impure, so it follows a change of unit; it only looks a key up in
 *  a set. Code needs no pipe: `LanguageService.t()` maps the key itself. */
@Pipe({ name: 'timeKey', standalone: true, pure: false })
export class TimeKeyPipe implements PipeTransform {
  private readonly time = inject(TimeUnitService);
  transform(key: string): string {
    return this.time.key(key);
  }
}
