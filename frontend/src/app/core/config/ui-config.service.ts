import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { UI_CONFIG_ITEMS, UiConfigVerb } from './ui-config-items';

interface UiConfigFile {
  hidden?: string[];
  collapsedByDefault?: string[];
  policyAllowlist?: string[];
}

const ITEMS_BY_ID = new Map(UI_CONFIG_ITEMS.map((item) => [item.id, item]));

/**
 * Loads an optional deployment config (docs/plans/configurable-ui-plan.md)
 * that hides or collapses UI items by id. No config loaded (the default) ->
 * nothing hidden, nothing collapsed, every enabled policy offered — the app
 * behaves exactly as it does without this service.
 */
@Injectable({ providedIn: 'root' })
export class UiConfigService {
  private readonly http = inject(HttpClient);

  private readonly hidden = signal<ReadonlySet<string>>(new Set());
  private readonly collapsedDefaults = signal<ReadonlySet<string>>(new Set());
  private readonly allowlist = signal<string[] | null>(null);

  /** Fetches `url` and applies it. Never rejects: a missing or malformed
   *  config warns and leaves nothing hidden rather than blocking startup. */
  async load(url: string): Promise<void> {
    let config: UiConfigFile;
    try {
      config = await firstValueFrom(this.http.get<UiConfigFile>(url));
    } catch (err) {
      console.warn(`[uiConfig] could not load "${url}":`, err);
      return;
    }
    this.hidden.set(this.resolveIds(config.hidden, 'hidden'));
    this.collapsedDefaults.set(this.resolveIds(config.collapsedByDefault, 'collapsedByDefault'));
    this.allowlist.set(config.policyAllowlist ?? null);
  }

  private resolveIds(ids: string[] | undefined, verb: UiConfigVerb): ReadonlySet<string> {
    const resolved = new Set<string>();
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
      resolved.add(id);
    }
    return resolved;
  }

  isHidden(id: string): boolean {
    return this.hidden().has(id);
  }

  isCollapsedByDefault(id: string): boolean {
    return this.collapsedDefaults().has(id);
  }

  /** The configured policy allowlist, or `null` if the config didn't set one
   *  (every policy the session enabled stays offered — today's behaviour). */
  policyAllowlist(): string[] | null {
    return this.allowlist();
  }
}
