import type { AgentDTO, SessionState } from '../models';
import type { CallEntry } from '../interaction-log/call-log.interceptor';
import type { ContextEvent, SessionRecord } from '../interaction-log/session-record';
import type { StateFrame } from '../interaction-log/state-log.service';
import { POINTER_SAMPLE_MS, type PointerSample } from '../interaction-log/pointer-log.service';

/**
 * Pure helpers for the replay (docs/plans/experiment-logging-frontend-and-replay.md
 * §9.2): what the screen showed at a recorded moment, rebuilt from a
 * session's streams. Every recorded change is "latest value wins", so the
 * state at `t` is a fold over everything up to `t`, forwards or after a jump.
 */

/** A session that can be replayed: it has train movements. */
export function isReplayable(record: SessionRecord): boolean {
  return Array.isArray(record.states) && record.states.length > 0;
}

/** First and last recorded moment of a session: its start, and its end or last event. */
export function sessionSpan(record: SessionRecord): { start: number; end: number } {
  const times = [
    record.header.startedAt,
    record.header.endedAt ?? 0,
    ...(record.context ?? []).map((e) => e.t),
    ...((record.states ?? []) as StateFrame[]).map((f) => f.t),
    ...((record.calls ?? []) as CallEntry[]).map((c) => c.t),
  ];
  return { start: record.header.startedAt, end: Math.max(...times) };
}

/** The legs of a run in replay order, and the leg on screen at `t`: the last one started by then. */
export function legAt(legs: readonly SessionRecord[], t: number): number {
  let index = 0;
  for (let i = 0; i < legs.length; i++) if (legs[i].header.startedAt <= t) index = i;
  return index;
}

/** The frames recorded up to `t`, in order. */
export function framesUpTo(record: SessionRecord, t: number): StateFrame[] {
  return ((record.states ?? []) as StateFrame[]).filter((f) => f.t <= t);
}

/**
 * One frame applied to the state before it: a frame with a map starts over
 * (first frame, scenario change), any other merges its trains in by handle.
 * Null until the first frame with a map. Fields the frames don't carry
 * (diagnostics) stay absent.
 */
export function applyFrame(state: SessionState | null, f: StateFrame): SessionState | null {
  if (!state && !f.map) return null;
  const base: SessionState = f.map
    ? { ...f.map, num_agents: 0, agents: [], elapsed_steps: 0, max_episode_steps: 0, episode_done: false }
    : state!;
  const agents = new Map<number, AgentDTO>(base.agents.map((a) => [a.handle, a]));
  for (const a of f.agents) agents.set(a.handle, a);
  const list = [...agents.values()].sort((a, b) => a.handle - b.handle);
  return {
    ...base,
    agents: list,
    num_agents: list.length,
    elapsed_steps: f.simStep,
    max_episode_steps: f.maxSteps ?? base.max_episode_steps,
    episode_done: f.episodeDone ?? base.episode_done,
  };
}

/** The train state after these frames (see `applyFrame`). */
export function stateFromFrames(frames: readonly StateFrame[]): SessionState | null {
  return frames.reduce<SessionState | null>(applyFrame, null);
}

/** The path and query of a URL, without the backend origin, so live and recorded URLs compare. */
export function callKey(method: string, url: string): string {
  let path = url;
  try {
    const u = new URL(url, 'http://replay.invalid');
    path = u.pathname + u.search;
  } catch {
    /* keep as is */
  }
  return `${method.toUpperCase()} ${path}`;
}

/**
 * The recorded answer to a request at `t`: the latest call to the same
 * method and URL at or before `t`, else the first one after it (a panel that
 * asks a moment earlier than it did live). Deduplicated responses are
 * resolved to the entry they repeat. Null if the call was never made.
 */
export function responseAt(calls: readonly CallEntry[], method: string, url: string, t: number): { status: number; body: unknown } | null {
  const key = callKey(method, url);
  let before: CallEntry | null = null;
  let after: CallEntry | null = null;
  for (const c of calls) {
    if (c.method === 'WS' || callKey(c.method, c.url) !== key) continue;
    if (c.t <= t) before = c;
    else if (!after) after = c;
  }
  const hit = before ?? after;
  if (!hit) return null;
  let body = hit.response;
  if (hit.response_same_as != null) body = calls.find((c) => c.seq === hit.response_same_as)?.response;
  return { status: hit.status, body: body ?? null };
}

/** The context events up to `t`, in order. */
export function eventsUpTo(record: SessionRecord, t: number): ContextEvent[] {
  return (record.context ?? []).filter((e) => e.t <= t);
}

/**
 * Where the recorded pointer is at `t` (plan §5.2.1): the last sample by
 * then, and the next one with the share of the way to it, so the cursor
 * moves in a straight line within a movement. Across a rest (a gap longer
 * than two sampling intervals) it holds still; after `out`, or before the
 * first sample, there is none. `samples` are in time order.
 */
export function pointerAt(samples: readonly PointerSample[], t: number): { from: PointerSample; to: PointerSample | null; f: number } | null {
  let lo = 0;
  let hi = samples.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) {
      at = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const from = samples[at];
  if (!from || from.out) return null;
  const next = samples[at + 1];
  if (!next || next.out || next.t - from.t > 2 * POINTER_SAMPLE_MS) return { from, to: null, f: 0 };
  return { from, to: next, f: (t - from.t) / (next.t - from.t) };
}
