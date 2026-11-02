import type { SessionRecord } from './session-record';

/**
 * Saved session records grouped into runs (docs/plans/experiment-logging-frontend-and-replay.md
 * §5.6): the legs and resets of one guided condition or tour share
 * `header.experimentRunId`; a free session is a run of one.
 */
export interface SavedRun {
  /** The run id, or the session id of a free session. */
  key: string;
  kind: 'condition' | 'tour' | 'free';
  /** The condition id, `tour-<tour id>` or `free`, as in the server's run folder name. */
  what: string;
  /** The condition's label, else null. */
  label: string | null;
  startedAt: number;
  /** The last leg's end; null while it is still open. */
  endedAt: number | null;
  /** Its sessions in start order. */
  legs: SessionRecord[];
}

export function groupRuns(records: SessionRecord[]): SavedRun[] {
  const byKey = new Map<string, SessionRecord[]>();
  for (const r of records) {
    const key = r.header.experimentRunId || r.header.sessionId;
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  return [...byKey.entries()]
    .map(([key, legs]) => {
      legs.sort((a, b) => a.header.startedAt - b.header.startedAt);
      const h = legs[0].header;
      const kind: SavedRun['kind'] = !h.experimentRunId ? 'free' : h.tourId ? 'tour' : 'condition';
      const last = legs[legs.length - 1].header;
      return {
        key,
        kind,
        what: kind === 'free' ? 'free' : kind === 'tour' ? `tour-${h.tourId}` : h.conditionId ?? 'condition',
        label: kind === 'condition' ? h.conditionLabel ?? null : null,
        startedAt: h.startedAt,
        endedAt: last.endedAt ?? null,
        legs,
      };
    })
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** `2026-10-29_08-03-12Z`: UTC, no `:` (the server's folder names, app.core.study_paths). */
export function utcStamp(t: number): string {
  return new Date(t).toISOString().replace(/\.\d+Z$/, 'Z').replace('T', '_').replace(/:/g, '-');
}

function clean(value: string, fallback: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

/** A run's file name stem, like its server folder: `<start>_<what>_<run id or session id>`. */
export function runFileStem(run: SavedRun): string {
  return `${utcStamp(run.startedAt)}_${clean(run.what, 'run')}_${clean(run.key, 'run')}`;
}
