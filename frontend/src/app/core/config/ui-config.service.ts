import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { UI_CONFIG_ITEMS, UiConfigVerb } from './ui-config-items';

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
}

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
    this.apply({});
  }

  /**
   * Applies a condition's restrictions over the deployment baseline. Call with
   * `{}` to drop the condition and fall back to the baseline alone — which is
   * what ending a run does, so one condition never leaks into the next.
   */
  apply(config: UiConfig): void {
    this.hidden.set(this.mergeIds(config, 'hidden'));
    this.collapsedDefaults.set(this.mergeIds(config, 'collapsedByDefault'));
    this.allowlist.set(mergeAllowlists(this.baseline.policyAllowlist, config.policyAllowlist));
  }

  /** Union of baseline and condition, each validated against the registry. */
  private mergeIds(config: UiConfig, verb: UiConfigVerb): ReadonlySet<string> {
    return new Set([
      ...this.resolveIds(this.baseline[verb], verb),
      ...this.resolveIds(config[verb], verb),
    ]);
  }

  private resolveIds(ids: string[] | undefined, verb: UiConfigVerb): string[] {
    const resolved: string[] = [];
    for (const id of ids ?? []) {
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
