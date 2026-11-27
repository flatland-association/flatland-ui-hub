import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ReflectionQuestionId, resolveReflectionQuestionOrder, REFLECTION_QUESTION_POOL } from '../reflection-questions';
import { UI_CONFIG_ALIASES, UI_CONFIG_ITEMS, UiConfigVerb } from './ui-config-items';

/**
 * What a deployment or a study condition declares as removed
 * (docs/plans/configurable-ui-plan.md §4.2). The same three keys whichever
 * route it arrives by: the deployment-wide `ui-config.json` or a
 * `LayoutPreset`'s `ui` block (§4.1).
 */
export interface UiConfig {
  hidden?: string[];
  collapsedByDefault?: string[];
  policyAllowlist?: string[];
  /** Deployment file only: fixes "Study logging" on or off for every run
   *  that does not set its own (docs/experiment-logging.md). A value, not a
   *  restriction, so it does not merge; `apply()` ignores it, because logging
   *  belongs to the run, not to the layout. */
  studyLogging?: boolean;
  /** Deployment file only: the order of the reflection prompt's guided questions
   *  (docs/plans/reflection-question-order.md). Questions not listed follow
   *  in the default order. A value, like `studyLogging`: `apply()` ignores it. */
  reflectionPromptQuestionOrder?: string[];
  /** Times in steps or minutes, fixed for the layout
   *  (docs/plans/plan-b-round2-colearning.md, item 2). A value, not a
   *  restriction: the condition's wins over the deployment's; unset, the
   *  viewer's Settings choice applies (`TimeUnitService`). */
  timeUnit?: 'steps' | 'minutes';
}

/** The `UiConfig` keys only `ui-config.json` sets; `apply()` ignores them. */
const DEPLOYMENT_ONLY = ['studyLogging', 'reflectionPromptQuestionOrder'] as const;

const ITEMS_BY_ID = new Map(UI_CONFIG_ITEMS.map((item) => [item.id, item]));

/**
 * Holds the merged UI restrictions and answers the gate points
 * (docs/plans/configurable-ui-plan.md). Nothing applied (the default) ->
 * nothing hidden, nothing collapsed, every enabled policy offered — the app
 * behaves exactly as it does without this service.
 *
 * Two inputs, both optional and both subtractive:
 *
 * - `load(url)` — the deployment file, fetched once at startup (§4.1). It is
 *   the *baseline*: it applies to every session on that installation,
 *   including the welcome screen and the other full-page surfaces, which a
 *   preset cannot reach because no preset is selected there yet.
 * - `apply(config)` — a condition's own block, applied when its layout is
 *   selected and cleared when the run ends.
 *
 * They merge by one rule, **the more restrictive wins**: union for the two id
 * arrays, intersection for `policyAllowlist`. Nothing one route hides can be
 * restored by the other, whichever declared it.
 */
@Injectable({ providedIn: 'root' })
export class UiConfigService {
  private readonly http = inject(HttpClient);

  /** The deployment file, kept separately so `apply()` can re-merge over it
   *  rather than over whatever condition ran last. */
  private baseline: UiConfig = {};

  private readonly hidden = signal<ReadonlySet<string>>(new Set());
  private readonly collapsedDefaults = signal<ReadonlySet<string>>(new Set());
  private readonly allowlist = signal<string[] | null>(null);
  private readonly _studyLogging = signal<boolean | null>(null);
  /** The deployment's "Study logging" value, or null if it sets none. */
  readonly studyLogging = this._studyLogging.asReadonly();
  private readonly _reflectionPromptQuestionOrder = signal<readonly ReflectionQuestionId[]>(REFLECTION_QUESTION_POOL);
  /** The order the reflection asks its guided questions in: the deployment's, else the default. */
  readonly reflectionPromptQuestionOrder = this._reflectionPromptQuestionOrder.asReadonly();
  private readonly _timeUnit = signal<'steps' | 'minutes' | null>(null);
  /** The time unit the layout or deployment fixes, or null to leave it to the viewer. */
  readonly timeUnit = this._timeUnit.asReadonly();

  /** Fetches the deployment file and applies it as the baseline. Never
   *  rejects: a missing or malformed file warns and leaves nothing hidden
   *  rather than blocking startup. */
  async load(url: string): Promise<void> {
    let config: UiConfig;
    try {
      config = await firstValueFrom(this.http.get<UiConfig>(url));
    } catch (err) {
      console.warn(`[uiConfig] could not load "${url}":`, err);
      return;
    }
    this.baseline = config ?? {};
    this._studyLogging.set(typeof this.baseline.studyLogging === 'boolean' ? this.baseline.studyLogging : null);
    const order = this.baseline.reflectionPromptQuestionOrder;
    this._reflectionPromptQuestionOrder.set(resolveReflectionQuestionOrder(Array.isArray(order) ? order : null));
    this.apply({});
  }

  /**
   * Applies a condition's restrictions over the deployment baseline. Call with
   * `{}` to drop the condition and fall back to the baseline alone — which is
   * what ending a run does, so one condition never leaks into the next.
   */
  apply(config: UiConfig): void {
    // Values the deployment file alone sets: a condition's block can't change
    // them, so say so rather than ignore them silently.
    for (const key of DEPLOYMENT_ONLY) {
      if (config[key] !== undefined) console.warn(`[uiConfig] "${key}" is set by the deployment file only; a condition's ui block can't change it, ignoring.`);
    }
    this.hidden.set(this.mergeIds(config, 'hidden'));
    this.collapsedDefaults.set(this.mergeIds(config, 'collapsedByDefault'));
    this.allowlist.set(mergeAllowlists(this.baseline.policyAllowlist, config.policyAllowlist));
    this._timeUnit.set(validTimeUnit(config.timeUnit) ?? validTimeUnit(this.baseline.timeUnit));
  }

  /** Union of baseline and condition, each validated against the registry. */
  private mergeIds(config: UiConfig, verb: UiConfigVerb): ReadonlySet<string> {
    return new Set([
      ...this.resolveIds(this.baseline[verb], verb),
      ...this.resolveIds(config[verb], verb),
    ]);
  }

  /** Validates ids against the registry, expanding a legacy alias
   *  (`UI_CONFIG_ALIASES`) into the ids it stands for. */
  private resolveIds(ids: string[] | undefined, verb: UiConfigVerb): string[] {
    const resolved: string[] = [];
    for (const id of (ids ?? []).flatMap((i) => UI_CONFIG_ALIASES[i] ?? [i])) {
      const item = ITEMS_BY_ID.get(id);
      if (!item) {
        console.warn(`[uiConfig] unknown id "${id}", ignoring.`);
        continue;
      }
      if (!item.supports.includes(verb)) {
        console.warn(`[uiConfig] "${id}" does not support "${verb}", ignoring.`);
        continue;
      }
      resolved.push(id);
    }
    return resolved;
  }

  isHidden(id: string): boolean {
    return this.hidden().has(id);
  }

  isCollapsedByDefault(id: string): boolean {
    return this.collapsedDefaults().has(id);
  }

  /** The merged restrictions as plain lists, sorted, for the session record (Q29). */
  snapshot(): { hidden: string[]; collapsedByDefault: string[]; policyAllowlist: string[] | null } {
    return {
      hidden: [...this.hidden()].sort(),
      collapsedByDefault: [...this.collapsedDefaults()].sort(),
      policyAllowlist: this.allowlist(),
    };
  }

  /** The merged policy allowlist, or `null` if neither route set one (every
   *  policy the session enabled stays offered — today's behaviour). A list of
   *  exactly one hides the selector and names what runs (§4.3c). */
  policyAllowlist(): string[] | null {
    return this.allowlist();
  }
}

/** Intersection, treating `undefined` as "no opinion" so one source alone
 *  decides — the more restrictive of the two always wins. */
function mergeAllowlists(base: string[] | undefined, override: string[] | undefined): string[] | null {
  if (base === undefined) return override ?? null;
  if (override === undefined) return base;
  return base.filter((id) => override.includes(id));
}

function validTimeUnit(v: unknown): 'steps' | 'minutes' | null {
  return v === 'steps' || v === 'minutes' ? v : null;
}
