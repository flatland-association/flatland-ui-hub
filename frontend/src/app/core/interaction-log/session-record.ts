import type { DecisionLogEntry } from '../decision-log';
import type { InteractionMode } from '../events/event-types';
import type { LearningRecord } from '../learning-store.service';

/**
 * One self-describing record per session — the study-data envelope of
 * docs/plans/interaction-logging-plan.md §4.
 *
 * The decision stream keeps its existing schema (`DecisionLogEntry`); this file
 * only adds what a comparison of modes or designs needs around it: who ran the
 * session under which condition (header), what changed while it ran (context
 * events), and what the person said afterwards (survey, reflection, learning).
 */

export const SESSION_RECORD_SCHEMA = 'flatland-session-record';
export const SESSION_RECORD_VERSION = 2;

/** Hard ceiling for the archived decision stream; beyond it the oldest go and
 *  `decisionsDropped` says how many — never a silent loss. */
export const RECORD_DECISION_CAP = 5000;
export const RECORD_CONTEXT_CAP = 5000;

/** What the start screen knows about the run that is about to start. */
export interface RunContext {
  /** Experiment condition id (the condition's layout id); null outside experiments. */
  conditionId: string | null;
  conditionLabel: string | null;
  layoutId: string | null;
  tourId: string | null;
  /** The infrastructure / preset chosen on the start screen. */
  scenarioId: string | null;
}

export const EMPTY_RUN_CONTEXT: RunContext = {
  conditionId: null,
  conditionLabel: null,
  layoutId: null,
  tourId: null,
  scenarioId: null,
};

export interface SessionHeader {
  sessionId: string;
  /** Pseudonymous participant id entered on the start screen; null if none. */
  participantId: string | null;
  conditionId: string | null;
  conditionLabel: string | null;
  /** nth session for this participant in this browser (1-based). */
  runIndex: number;
  startedAt: number;
  endedAt: number | null;
  /** Mode at start; later changes are `mode_change` context events. */
  mode: InteractionMode;
  /** The session settings as persisted on start (`flatland_ui_session_settings_v1`), verbatim. */
  config: Record<string, unknown> | null;
  activePolicy: string;
  layoutId: string | null;
  tourId: string | null;
  scenarioId: string | null;
  disruptionIds: string[];
  liveSeed: number | null;
  grid: { width: number; height: number; numAgents: number };
  /** Frontend build (commit, or 'dev'); null when the build stamp is unavailable. */
  appVersion: string | null;
  /** Backend version from `/study/status`; null when the backend did not answer. */
  backendVersion: string | null;
}

export type ContextEventType =
  | 'session_start'
  | 'session_end'
  | 'episode_done'
  | 'shift_end'
  | 'mode_change'
  | 'policy_change'
  | 'kpi_change'
  | 'play'
  | 'pause'
  | 'step'
  | 'directive_start'
  | 'speed_change'
  | 'layout_change'
  | 'survey_open'
  | 'survey_submit'
  | 'reflection_open'
  | 'reflection_close';

/** Same envelope as a decision entry, so both streams merge on one time axis. */
export interface ContextEvent {
  seq: number;
  t: number;
  simStep: number;
  mode: InteractionMode;
  type: ContextEventType;
  payload?: Record<string, unknown>;
}

export interface SurveySubmission {
  surveyId: string;
  answers: Record<string, unknown>;
  submittedAt: number | null;
}

/** End-of-run outcome, the dependent measure next to the decisions. */
export interface SessionOutcome {
  elapsedSteps: number;
  maxSteps: number;
  episodeDone: boolean;
  trains: number;
  arrived: number;
  totalDelay: number;
}

export interface SessionRecord {
  schema: typeof SESSION_RECORD_SCHEMA;
  version: typeof SESSION_RECORD_VERSION;
  exportedAt: string;
  header: SessionHeader;
  decisions: DecisionLogEntry[];
  decisionsDropped: number;
  context: ContextEvent[];
  contextDropped: number;
  surveys: SurveySubmission[];
  /** Co-Learning reflection answers (question key → answer); null if none. */
  reflection: Record<string, string> | null;
  /** Learning records created while this session ran. */
  learning: LearningRecord[];
  outcome: SessionOutcome | null;
}

/** State of the server copy (plan §4.6): `off` = the backend sink is disabled or unreachable. */
export type SinkStatus = 'off' | 'pending' | 'ok' | 'failed';

/** Summary kept in the autosave index, so saved records can be listed without parsing them. */
export interface SavedRecordSummary {
  sessionId: string;
  participantId: string | null;
  conditionId: string | null;
  startedAt: number;
}

/**
 * Stable identity of a logged decision. `seq` alone restarts at 1 when the log
 * is cleared mid-session; `t` keeps entries from different epochs apart, and
 * both stay unchanged when a rationale is patched onto an entry later.
 */
export function decisionKey(entry: Pick<DecisionLogEntry, 't' | 'seq'>): string {
  return `${entry.t}:${entry.seq}`;
}

/**
 * Fold the store's current (capped, clearable) decision log into the archive.
 * Entries are replaced by key so later rationale patches land; nothing that
 * left the store's rolling window is removed here.
 */
export function mergeDecisions(
  archive: Map<string, DecisionLogEntry>,
  entries: readonly DecisionLogEntry[],
): Map<string, DecisionLogEntry> {
  const next = new Map(archive);
  for (const e of entries) next.set(decisionKey(e), e);
  return next;
}

/** Archive in time order, trimmed to `cap` (oldest dropped). */
export function orderedDecisions(
  archive: Map<string, DecisionLogEntry>,
  cap = RECORD_DECISION_CAP,
): { decisions: DecisionLogEntry[]; dropped: number } {
  const all = [...archive.values()].sort((a, b) => a.t - b.t || a.seq - b.seq);
  const dropped = Math.max(0, all.length - cap);
  return { decisions: dropped ? all.slice(dropped) : all, dropped };
}

function filePart(value: string | null | undefined, fallback: string): string {
  const cleaned = String(value ?? '').trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

/** `flatland-<participant>-<condition>-<runIndex>-<sessionId>.json` (plan §4.5). */
export function recordFileName(header: Pick<SessionHeader, 'participantId' | 'conditionId' | 'tourId' | 'runIndex' | 'sessionId'>): string {
  const participant = filePart(header.participantId, 'anon');
  const condition = filePart(header.conditionId ?? (header.tourId ? `tour-${header.tourId}` : null), 'free');
  return `flatland-${participant}-${condition}-${header.runIndex}-${filePart(header.sessionId, 'session')}.json`;
}
