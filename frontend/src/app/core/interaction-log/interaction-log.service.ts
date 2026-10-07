import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { backendHttpBase } from '../backend-origin';
import { BuildInfoService } from '../build-info.service';
import { DecisionLogEntry } from '../decision-log';
import { LearningStore } from '../learning-store.service';
import { SessionInfo, SessionState } from '../models';
import { SessionStore } from '../session.store';
import {
  ContextEvent,
  ContextEventType,
  EMPTY_RUN_CONTEXT,
  RECORD_CONTEXT_CAP,
  RunContext,
  SESSION_RECORD_SCHEMA,
  SESSION_RECORD_VERSION,
  SavedRecordSummary,
  SessionHeader,
  SessionOutcome,
  SessionRecord,
  SinkStatus,
  SurveySubmission,
  mergeDecisions,
  orderedDecisions,
  recordFileName,
} from './session-record';

interface Watcher {
  resync(): void;
}

/** How soon an autosave reaches the server: `now`, throttled (`later`), or as a keepalive on page exit. */
type MirrorTiming = 'now' | 'later' | 'unload';

/** A debounced autosave reaches the server at most this often. */
const MIRROR_THROTTLE_MS = 10_000;
/** Browsers cap keepalive request bodies at 64 KiB. */
const KEEPALIVE_MAX_BYTES = 60_000;

/**
 * Interaction logging (docs/plans/interaction-logging-plan.md, P1–P4).
 *
 * Assembles one record per session from state that already exists — the
 * decision log, the session settings, the survey and reflection answers in
 * `localStorage`, the learning records — and adds the two things nothing held
 * before: a header naming participant and condition, and a context stream of
 * the independent variables that change while a session runs (mode, policy,
 * KPI weights, play/pause, layout).
 *
 * Capture is by observing store signals, not by new calls at the store's choke
 * points, so no behaviour changes. Logging is best-effort: storage failures
 * never reach the UI.
 *
 * When the backend sink is enabled (`/study/status`), every autosave is also
 * mirrored to the server (P4). `localStorage` stays the source of truth.
 */
@Injectable({ providedIn: 'root' })
export class InteractionLogService {
  private readonly store = inject(SessionStore);
  private readonly learning = inject(LearningStore);
  private readonly buildInfo = inject(BuildInfoService);

  static readonly PARTICIPANT_KEY = 'flatland_study_participant_v1';
  static readonly RUN_INDEX_KEY = 'flatland_study_run_index_v1';
  static readonly RECORD_PREFIX = 'flatland_session_record_';
  static readonly RECORD_INDEX_KEY = 'flatland_session_record_index_v1';
  static readonly SETTINGS_KEY = 'flatland_ui_session_settings_v1';
  static readonly SURVEY_PREFIX = 'flatland_survey_';
  static readonly REFLECTION_PREFIX = 'flatland_colearning_reflection_';

  /** Pseudonymous participant id, remembered across runs in this browser. */
  readonly participantId = signal<string>(readString(InteractionLogService.PARTICIPANT_KEY));

  /** Header of the session being logged; null before the first session. */
  readonly header = signal<SessionHeader | null>(null);
  readonly contextEvents = signal<ContextEvent[]>([]);
  /** Records autosaved in this browser, newest first. */
  readonly savedRecords = signal<SavedRecordSummary[]>(this._readIndex());
  /** The last autosave did not fit (quota); export and clear saved records. */
  readonly autosaveFailed = signal(false);
  /** Server copy of the current record (plan §4.6). */
  readonly sinkStatus = signal<SinkStatus>('off');
  readonly backendVersion = signal<string | null>(null);

  private readonly _apiBase = backendHttpBase();
  private _sinkEnabled = false;
  private _mirrorPending: SessionRecord | null = null;
  private _mirrorInFlight = false;
  private _mirrorTimer: ReturnType<typeof setTimeout> | null = null;

  private _runContext: RunContext = { ...EMPTY_RUN_CONTEXT };
  private _decisions = new Map<string, DecisionLogEntry>();
  private _contextDropped = 0;
  private _outcome: SessionOutcome | null = null;
  private _surveySubmittedAt: Record<string, number> = {};
  private _currentLayoutId: string | null = null;
  private readonly _watchers: Watcher[] = [];
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;
  private _kpiTimer: ReturnType<typeof setTimeout> | null = null;
  private _kpiFrom: unknown = null;

  constructor() {
    effect(() => {
      const session = this.store.session();
      untracked(() => this._onSession(session));
    });
    effect(() => {
      const log = this.store.decisionLog();
      untracked(() => {
        if (!this._isLive() || log.length === 0) return;
        this._decisions = mergeDecisions(this._decisions, log);
        this._scheduleSave();
      });
    });
    effect(() => {
      const state = this.store.state();
      untracked(() => {
        if (state && this._isLive()) this._outcome = outcomeOf(state);
      });
    });

    this._watch(() => this.store.interactionMode(), (from, to) => this._emit('mode_change', { from, to }));
    this._watch(() => this.store.activePolicy(), (from, to) => this._emit('policy_change', { from, to }));
    this._watch(() => this.store.playing(), (_from, on) => {
      this._emit(on ? 'play' : 'pause');
      // Director: starting the run is handing over a directive (policy + KPI weights).
      if (on && this.store.interactionMode() === 'director') {
        this._emit('directive_start', {
          policy: this.store.activePolicy(),
          kpiPriorities: { ...this.store.kpiPriorities() },
          resumed: this.store.elapsedSteps() > 0,
        });
      }
    });
    // Only a manual step sets a target; play runs without one.
    this._watch(() => this.store.targetStep(), (from, to) => {
      if (from != null || to == null) return;
      const at = this.store.elapsedSteps();
      this._emit('step', { from: at, to, n: to - at });
    });
    this._watch(() => this.store.playSpeedLevel(), (from, to) => this._emit('speed_change', { from, to }));
    this._watch(() => this.store.reflectionRequested(), (_from, open) => this._emit(open ? 'reflection_open' : 'reflection_close'));
    this._watch(() => this.store.episodeDone(), (_from, done) => {
      if (!done) return;
      this._emit('episode_done');
      this.autosave();
    });
    this._watch(() => this.store.shiftEnded(), (_from, ended) => {
      if (!ended) return;
      this._emit('shift_end');
      this.autosave();
    });
    // A slider emits on every tick; one event per settled change is the signal.
    this._watch(
      () => ({ ...this.store.kpiPriorities() }),
      (from, to) => {
        if (this._kpiTimer == null) this._kpiFrom = from;
        else clearTimeout(this._kpiTimer);
        this._kpiTimer = setTimeout(() => {
          this._kpiTimer = null;
          this._emit('kpi_change', { from: this._kpiFrom, to });
        }, 800);
      },
      (a, b) => JSON.stringify(a) === JSON.stringify(b),
    );

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.autosave('unload'));
    }
    void this._loadSinkStatus();
  }

  // ── Inputs from the start screen and the surveys ─────────────────────────

  setParticipantId(id: string): void {
    const value = String(id ?? '').trim();
    this.participantId.set(value);
    writeString(InteractionLogService.PARTICIPANT_KEY, value);
  }

  /** What the start screen is about to launch; read when the session arrives. */
  setRunContext(ctx: Partial<RunContext>): void {
    this._runContext = { ...this._runContext, ...ctx };
    if (ctx.layoutId !== undefined) this._currentLayoutId = ctx.layoutId;
  }

  /** The runtime layout changed (start screen or mid-session). */
  noteLayout(layoutId: string | null): void {
    const prev = this._currentLayoutId;
    this._runContext = { ...this._runContext, layoutId };
    this._currentLayoutId = layoutId;
    if (prev !== layoutId && this._isLive()) this._emit('layout_change', { from: prev, to: layoutId });
  }

  noteSurveyOpened(surveyId: string): void {
    this._emit('survey_open', { surveyId });
  }

  noteSurveySubmitted(surveyId: string): void {
    if (!this._isLive()) return;
    this._surveySubmittedAt = { ...this._surveySubmittedAt, [surveyId]: Date.now() };
    this._emit('survey_submit', { surveyId });
    this.autosave();
  }

  // ── Record assembly, autosave, export ────────────────────────────────────

  /** The current session's complete record, assembled now; null without a session. */
  buildRecord(): SessionRecord | null {
    const header = this.header();
    if (!header) return null;
    const { decisions, dropped } = orderedDecisions(this._decisions);
    const until = header.endedAt ?? Date.now();
    return {
      schema: SESSION_RECORD_SCHEMA,
      version: SESSION_RECORD_VERSION,
      exportedAt: new Date().toISOString(),
      header: { ...header, backendVersion: header.backendVersion ?? this.backendVersion() },
      decisions,
      decisionsDropped: dropped,
      context: this.contextEvents(),
      contextDropped: this._contextDropped,
      surveys: this._collectSurveys(header.sessionId),
      reflection: readJson<Record<string, string>>(InteractionLogService.REFLECTION_PREFIX + header.sessionId),
      learning: this.learning.records().filter((r) => r.createdAt >= header.startedAt && r.createdAt <= until),
      outcome: this._outcome,
    };
  }

  /** Write the current record to `localStorage` now, and mirror it to the server. Best-effort. */
  autosave(mirror: MirrorTiming = 'now'): void {
    if (this._saveTimer != null) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    const record = this.buildRecord();
    if (!record) return;
    this._write(record);
    // Mirrored even when the local write failed: then the server is the only copy.
    this._mirror(record, mirror);
  }

  /** Download the current session's record as one JSON file (plan §4.5). */
  exportCurrent(): void {
    const record = this.buildRecord();
    if (!record) return;
    this._write(record);
    this._mirror(record, 'now');
    downloadJson(recordFileName(record.header), record);
  }

  /** Download every autosaved record as one bundle — the recovery path for a forgotten export. */
  exportAllSaved(): void {
    this.autosave();
    const records = this.savedRecords()
      .map((s) => readJson<SessionRecord>(InteractionLogService.RECORD_PREFIX + s.sessionId))
      .filter((r): r is SessionRecord => r != null);
    if (records.length === 0) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadJson(`flatland-session-records-${stamp}.json`, {
      schema: `${SESSION_RECORD_SCHEMA}-bundle`,
      version: SESSION_RECORD_VERSION,
      exportedAt: new Date().toISOString(),
      records,
    });
  }

  /** Remove every autosaved record from this browser (not the running session's state). */
  clearSaved(): void {
    for (const s of this.savedRecords()) removeKey(InteractionLogService.RECORD_PREFIX + s.sessionId);
    removeKey(InteractionLogService.RECORD_INDEX_KEY);
    this.savedRecords.set([]);
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /** A header exists and belongs to the session the store currently runs. */
  private _isLive(): boolean {
    const header = this.header();
    return !!header && header.endedAt == null && this.store.session()?.id === header.sessionId;
  }

  private _onSession(session: SessionInfo | null): void {
    const header = this.header();
    if (header && header.endedAt == null && header.sessionId !== session?.id) {
      this._emit('session_end', { reason: session ? 'new_session' : 'closed' }, true);
      this.header.set({ ...header, endedAt: Date.now() });
      this.autosave();
    }
    if (session && this.header()?.sessionId !== session.id) this._start(session);
  }

  private _start(session: SessionInfo): void {
    const participantId = this.participantId() || null;
    const ctx = this._runContext;
    this._decisions = new Map();
    this._contextDropped = 0;
    this._outcome = null;
    this._surveySubmittedAt = {};
    this.contextEvents.set([]);
    this.header.set({
      sessionId: session.id,
      participantId,
      conditionId: ctx.conditionId,
      conditionLabel: ctx.conditionLabel,
      runIndex: this._nextRunIndex(participantId),
      startedAt: Date.now(),
      endedAt: null,
      mode: this.store.interactionMode(),
      config: readJson<Record<string, unknown>>(InteractionLogService.SETTINGS_KEY),
      activePolicy: this.store.activePolicy(),
      layoutId: this._currentLayoutId,
      tourId: ctx.tourId,
      scenarioId: session.setup_id ?? session.network_id ?? ctx.scenarioId,
      disruptionIds: [...(session.disruption_ids ?? [])],
      liveSeed: session.live_seed ?? null,
      grid: { width: session.width, height: session.height, numAgents: session.num_agents },
      appVersion: this.buildInfo.info()?.commit ?? null,
      backendVersion: this.backendVersion(),
    });
    // The values the header just captured are the baseline, not changes.
    for (const w of this._watchers) w.resync();
    this._emit('session_start');
    this.autosave();
  }

  private _watch<T>(read: () => T, onChange: (from: T, to: T) => void, equal: (a: T, b: T) => boolean = Object.is): void {
    let prev = untracked(read);
    this._watchers.push({ resync: () => { prev = untracked(read); } });
    effect(() => {
      const next = read();
      untracked(() => {
        if (equal(prev, next)) return;
        const from = prev;
        prev = next;
        if (this._isLive()) onChange(from, next);
      });
    });
  }

  private _emit(type: ContextEventType, payload?: Record<string, unknown>, force = false): void {
    const header = this.header();
    if (!header || (!force && !this._isLive())) return;
    this.contextEvents.update((list) => {
      const seq = list.length ? list[list.length - 1].seq + 1 : 1;
      const event: ContextEvent = {
        seq,
        t: Date.now(),
        simStep: this.store.elapsedSteps(),
        mode: this.store.interactionMode(),
        type,
        ...(payload ? { payload } : {}),
      };
      const next = [...list, event];
      if (next.length <= RECORD_CONTEXT_CAP) return next;
      this._contextDropped += next.length - RECORD_CONTEXT_CAP;
      return next.slice(next.length - RECORD_CONTEXT_CAP);
    });
    this._scheduleSave();
  }

  private _scheduleSave(): void {
    if (this._saveTimer != null) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.autosave('later');
    }, 1500);
  }

  private async _loadSinkStatus(): Promise<void> {
    try {
      const res = await fetch(`${this._apiBase}/study/status`, { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as { sinkEnabled?: unknown; backendVersion?: unknown };
      if (typeof body.backendVersion === 'string') this.backendVersion.set(body.backendVersion);
      this._sinkEnabled = body.sinkEnabled === true;
      // A session may already be running: bring its server copy up to date.
      if (this._sinkEnabled && this.header()) this.autosave();
    } catch {
      // No backend, no sink: the record stays in this browser.
    }
  }

  /**
   * Send the record to the server. One request at a time, always the newest
   * record, so a slow response can never overwrite a later state with an
   * earlier one.
   */
  private _mirror(record: SessionRecord, timing: MirrorTiming): void {
    if (!this._sinkEnabled) return;
    this._mirrorPending = record;
    if (timing === 'unload') {
      this._flushMirror(true);
    } else if (timing === 'now') {
      this._flushMirror(false);
    } else if (this._mirrorTimer == null) {
      this._mirrorTimer = setTimeout(() => this._flushMirror(false), MIRROR_THROTTLE_MS);
    }
  }

  private _flushMirror(unload: boolean): void {
    if (this._mirrorTimer != null) {
      clearTimeout(this._mirrorTimer);
      this._mirrorTimer = null;
    }
    const record = this._mirrorPending;
    if (!record || (this._mirrorInFlight && !unload)) return;
    this._mirrorPending = null;
    const body = JSON.stringify(record);
    const url = `${this._apiBase}/study/records/${encodeURIComponent(record.header.sessionId)}`;
    this._mirrorInFlight = true;
    this.sinkStatus.set('pending');
    fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: unload && body.length < KEEPALIVE_MAX_BYTES,
    })
      .then((res) => this.sinkStatus.set(res.ok ? 'ok' : 'failed'))
      .catch(() => this.sinkStatus.set('failed'))
      .finally(() => {
        this._mirrorInFlight = false;
        if (this._mirrorPending) this._flushMirror(false);
      });
  }

  private _collectSurveys(sessionId: string): SurveySubmission[] {
    const prefix = `${InteractionLogService.SURVEY_PREFIX}${sessionId}_`;
    const out: SurveySubmission[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(prefix)) continue;
        const surveyId = key.slice(prefix.length);
        out.push({
          surveyId,
          answers: readJson<Record<string, unknown>>(key) ?? {},
          submittedAt: this._surveySubmittedAt[surveyId] ?? null,
        });
      }
    } catch {
      // localStorage unavailable.
    }
    return out.sort((a, b) => a.surveyId.localeCompare(b.surveyId));
  }

  private _nextRunIndex(participantId: string | null): number {
    const counts = readJson<Record<string, number>>(InteractionLogService.RUN_INDEX_KEY) ?? {};
    const key = participantId ?? '';
    const next = (Number(counts[key]) || 0) + 1;
    writeString(InteractionLogService.RUN_INDEX_KEY, JSON.stringify({ ...counts, [key]: next }));
    return next;
  }

  /**
   * Write one record. A full quota is reported, never resolved by evicting
   * older records: those may be another participant's unexported data.
   */
  private _write(record: SessionRecord): void {
    const sid = record.header.sessionId;
    try {
      localStorage.setItem(InteractionLogService.RECORD_PREFIX + sid, JSON.stringify(record));
      this.autosaveFailed.set(false);
    } catch {
      this.autosaveFailed.set(true);
      return;
    }
    const summary: SavedRecordSummary = {
      sessionId: sid,
      participantId: record.header.participantId,
      conditionId: record.header.conditionId,
      startedAt: record.header.startedAt,
    };
    const index = [summary, ...this.savedRecords().filter((s) => s.sessionId !== sid)]
      .sort((a, b) => b.startedAt - a.startedAt);
    this.savedRecords.set(index);
    writeString(InteractionLogService.RECORD_INDEX_KEY, JSON.stringify(index));
  }

  private _readIndex(): SavedRecordSummary[] {
    const index = readJson<SavedRecordSummary[]>(InteractionLogService.RECORD_INDEX_KEY);
    return Array.isArray(index) ? index : [];
  }
}

function outcomeOf(state: SessionState): SessionOutcome {
  const agents = state.agents ?? [];
  return {
    elapsedSteps: state.elapsed_steps ?? 0,
    maxSteps: state.max_episode_steps ?? 0,
    episodeDone: !!state.episode_done,
    trains: agents.length,
    arrived: agents.filter((a) => String(a.state).toUpperCase() === 'DONE').length,
    totalDelay: agents.reduce((sum, a) => sum + Math.max(0, Number(a.delay) || 0), 0),
  };
}

function readString(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Quota or private mode: logging must never break the UI.
  }
}

function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // localStorage unavailable.
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function downloadJson(fileName: string, data: unknown): void {
  try {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    // No download in this environment; the autosave still holds the record.
  }
}
