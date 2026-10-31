import { DestroyRef, EffectRef, Injectable, Injector, WritableSignal, effect, inject, untracked } from '@angular/core';
import { InteractionLogService } from './interaction-log.service';

/** Fast changes (wheel zoom, drag-pan) settle into one event after this quiet time. */
export const UI_STATE_QUIET_MS = 300;

/** One writable signal, or several logged together as one object (a viewport). */
export type UiStateSource = WritableSignal<unknown> | Record<string, WritableSignal<unknown>>;

interface Entry {
  read: () => unknown;
  write: (value: unknown) => void;
  watch: EffectRef;
  timer: ReturnType<typeof setTimeout> | null;
  last: string;
}

/**
 * UI state that a faithful replay needs and that clicks don't capture: panel
 * collapse, the map and Marey viewports
 * (docs/plans/experiment-logging-frontend-and-replay.md §5.3, pattern P8).
 *
 * A component registers a writable signal under a stable key, one line:
 * `uiState.register('panel.decision-log.collapsed', this.collapsed, this.destroyRef)`.
 * A viewport registers its signals together:
 * `uiState.register('map.viewport', { zoom: this.zoom, panX: this.panX, panY: this.panY }, …)`.
 * Each settled change becomes one `ui_state {key, value}` context event;
 * every registered key is snapshotted when a session starts, and a key
 * registered during a session logs its value at once, so defaults are in the
 * record without a click. Replay writes values back with `apply()`; a
 * key whose component is not on screen yet gets its value when it registers.
 */
@Injectable({ providedIn: 'root' })
export class UiStateRegistry {
  private readonly log = inject(InteractionLogService);
  private readonly injector = inject(Injector);
  private readonly _entries = new Map<string, Entry>();
  private readonly _pending = new Map<string, unknown>();

  constructor() {
    let lastSid: string | null = null;
    effect(() => {
      const sid = this.log.header()?.sessionId ?? null;
      untracked(() => {
        if (sid === lastSid) return;
        lastSid = sid;
        if (sid) for (const [key, e] of this._entries) this.log.noteUiState(key, e.read());
      });
    });
  }

  /**
   * Watch `source` under `key` until `destroyRef` fires (pass the component's)
   * or the returned function is called. A later registration of the same key
   * replaces the earlier one.
   */
  register(key: string, source: UiStateSource, destroyRef?: DestroyRef): () => void {
    this._remove(key);
    const { read, write } = accessors(source);
    if (this._pending.has(key)) {
      const pending = this._pending.get(key);
      this._pending.delete(key);
      write(pending);
    }
    const entry: Entry = {
      read,
      write,
      timer: null,
      last: JSON.stringify(untracked(read) ?? null),
      watch: effect(
        () => {
          const value = read();
          untracked(() => this._changed(key, entry, value));
        },
        { injector: this.injector },
      ),
    };
    this._entries.set(key, entry);
    // A component that appears during a session (most do: panels mount after
    // the session starts) records its starting value, like the snapshot.
    if (this.log.header()) this.log.noteUiState(key, entry.read());
    const unregister = () => {
      if (this._entries.get(key) === entry) this._remove(key);
    };
    destroyRef?.onDestroy(unregister);
    return unregister;
  }

  /** Set a key's value (replay). Applied on registration if its component isn't there yet. */
  apply(key: string, value: unknown): void {
    const entry = this._entries.get(key);
    if (entry) {
      entry.last = JSON.stringify(value ?? null);
      entry.write(value);
    } else {
      this._pending.set(key, value);
    }
  }

  /** The keys currently registered (tests, replay). */
  keys(): string[] {
    return [...this._entries.keys()];
  }

  private _changed(key: string, entry: Entry, value: unknown): void {
    const json = JSON.stringify(value ?? null);
    if (json === entry.last) return;
    if (entry.timer != null) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      const settled = untracked(entry.read);
      const settledJson = JSON.stringify(settled ?? null);
      if (settledJson === entry.last) return;
      entry.last = settledJson;
      this.log.noteUiState(key, settled);
    }, UI_STATE_QUIET_MS);
  }

  private _remove(key: string): void {
    const entry = this._entries.get(key);
    if (!entry) return;
    entry.watch.destroy();
    if (entry.timer != null) clearTimeout(entry.timer);
    this._entries.delete(key);
  }
}

function accessors(source: UiStateSource): Pick<Entry, 'read' | 'write'> {
  if (typeof source === 'function') return { read: () => source(), write: (v) => source.set(v) };
  const parts = Object.entries(source);
  return {
    read: () => Object.fromEntries(parts.map(([k, s]) => [k, s()])),
    write: (v) => {
      const value = (v ?? {}) as Record<string, unknown>;
      for (const [k, s] of parts) if (k in value) s.set(value[k]);
    },
  };
}
