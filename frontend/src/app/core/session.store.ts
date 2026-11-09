import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService, DirectorDivergence, DirectorStrategy } from './api.service';
import {
  VISUAL_ENCODING_PRESETS,
  VisualEncoding,
  VisualEncodingPresetId,
  loadVisualEncoding,
  matchingPresetId,
  saveVisualEncoding,
} from './visual-encoding';
import {
  DECISION_LOG_CAP,
  DecisionAction,
  DecisionLogEntry,
  DecisionOwner,
  DecisionValueAxis,
  actionLabelFor,
  CoordinatedDecision,
} from './decision-log';
import type { ActionOrigin } from './dispatch/train-action.service';
import {
  AppNotification,
  ContentionGroup,
  ContentionsResponse,
  ImpactItem,
  InteractionMode,
  KpiPriorities,
  KpiWeights,
  LayerVisibility,
  Recommendation,
  ScenarioOption,
  WhatIfTrajById,
} from './events/event-types';
import {
  overriddenLayers,
  resolveLayerVisibility,
} from './layout/layer-mode-defaults';
import { ForecastSignals } from './strategy-forecast';
import { WebSocketService } from './websocket.service';
import { LanguageService } from './i18n/language.service';
import { UiConfigService } from './config/ui-config.service';
import {
  LearningRecord,
  LearningStore,
  RationaleContext,
  buildPreferenceHypothesis,
  strategyLabelForAction,
  LONG_BLOCK_STEPS,
} from './learning-store.service';
import { AgentDTO, PolicyInfo, PolicyName, RailTile, RouteAxisResponse, SceneGeography, SessionInfo, SessionState, StationRef } from './models';
import { CombinedActionPreview } from './combined-actions/combined-actions-preview';
import type { ProposalOption, ProposalsResult } from './events/event-types';
import { PLAY_SPEED_DEFAULT_BASE, PLAY_SPEED_DEFAULT_LEVEL, clampPlaySpeedLevel, playSpeedBaseFor, playSpeedForLevel } from './play-speed';

/**
 * One human intervention captured while in Co-Learning mode (WP 3.3).
 * This is the raw material a future feedback/learning loop would consume;
 * for now it powers the in-session intervention count and the reflection panel.
 *
 * The optional rationale fields (Workstream B Tier 1, deck slides 5 & 7) are
 * filled in AFTER the override, when the operator answers the "why?" prompt and
 * confirms the preference hypothesis. They are absent on entries the operator
 * never annotated — hence optional and backward-compatible.
 */
export interface CoLearningEntry {
  /** Simulation step at which the human intervened. */
  step: number;
  /** Agent the human acted on. */
  handle: number;
  /** Action the human chose (Flatland action id). */
  humanAction: number;
  /** Top AI recommendation title at that moment, if any. */
  aiSuggestion: string | null;
  timestamp: number;
  /** Chosen "why" (structured reason chips, joined) + optional note.
   *  Set by the rationale-capture prompt after the override. */
  rationale?: string;
  /** Generated "when {context}, prefer {choice}" hypothesis string. */
  preferenceHypothesis?: string;
  /** Operator's confirmation of the hypothesis. 'once' = a one-off, explicitly
   *  NOT promoted to a persistent preference (overfitting guard). */
  hypothesisResponse?: 'yes' | 'once' | 'no';
}

/** The answers of a reflection typed but not sent yet (D30). */
export interface ReflectionDraft {
  factors: string[];
  gut: string | null;
  missing: string[];
  tradeoff: string;
}

/**
 * What «Handlungsoptionen» showed for a decision when its course was taken,
 * shown again, read-only, in the decision's reflection
 * (docs/plans/reflection-inline.md §4.8, D26). In memory only, not exported;
 * `result` without the map trajectories.
 */
export interface ProposalSnapshot {
  handle: number;
  result: ProposalsResult;
  applied: 'plan' | 'ai' | 'human';
  option: ProposalOption | null;
}

/**
 * Workstream B Tier 1 — an override awaiting its "why?" (deck slide 7). Set in
 * `setOverride` when a human overrode a recommendation (or any intervention in
 * Co-Learning), consumed by the rationale-capture UI, cleared on submit/dismiss.
 *
 * Carries the handles needed to patch the matching `CoLearningEntry` (by
 * timestamp) and `DecisionLogEntry` (by seq) once the operator answers, so the
 * rationale lands on the exact entry it explains.
 */
export interface PendingRationale {
  handle: number;
  action: number;
  mode: InteractionMode;
  aiSuggestion: string | null;
  simStep: number;
  timestamp: number;
  /** Situation snapshot for the hypothesis template. */
  context: RationaleContext;
  /** DecisionLogEntry seq to patch on submit. */
  decisionSeq: number;
  /** CoLearningEntry timestamp to patch on submit (Co-Learning mode only). */
  coLearningTimestamp: number | null;
}

export interface TrajectoryPoint {
  /** First simulation step at this compressed trajectory cell/run. */
  step: number;
  /** Last simulation step still at this same cell/run. */
  endStep?: number;
  /** Number of raw time steps represented by this compressed point. */
  durationSteps?: number;
  /** Backwards-compatible alias used by some UI code. */
  dwellSteps?: number;
  position: [number, number] | null;
  direction: number | null;
  state: string;
}

/** The run a new session belongs to: a guided condition or a tour. The backend
 *  files the session's study data under that run's folder
 *  (docs/plans/experiment-logging-frontend-and-replay.md §4.2). */
export interface SessionRunRef {
  kind: 'condition' | 'tour';
  /** Condition id or tour id. */
  id: string;
  runId: string;
  /** Run start, epoch ms. */
  runStartedAt: number;
}

@Injectable({ providedIn: 'root' })
export class SessionStore {
  private api = inject(ApiService);
  private uiConfig = inject(UiConfigService);

  /**
   * The "which scenario loaded" lines below, gated at the source rather than
   * where they render (docs/plans/configurable-ui-plan.md §1.1 item 9).
   * `message` is a shared channel — it also carries "Episode finished. Use
   * Reset to start again." and backend-supplied text — so hiding the rendered
   * line would swallow run-state feedback the dispatcher needs. Setting `null`
   * is what the other call sites already do when there is nothing to say.
   */
  private sessionInfo(text: string): string | null {
    return this.uiConfig.isHidden('control.sessionInfo') ? null : text;
  }
  private ws = inject(WebSocketService);
  private learning = inject(LearningStore);
  /** Malfunction type labels are shown in the viewer's language. */
  private i18n = inject(LanguageService);

  readonly session = signal<SessionInfo | null>(null);
  readonly state = signal<SessionState | null>(null);
  /** A recorded session is being replayed (`ReplayService`, docs/plans/experiment-logging-frontend-and-replay.md §9.2):
   *  the screen is read-only, nothing reaches the backend and nothing is logged. */
  readonly replayActive = signal(false);
  // Single-selection: at most one agent at a time.
  readonly selectedHandle = signal<number | null>(null);
  readonly enabledScenarioPolicyIds = signal<string[]>([]);
  readonly enabledControlPolicyIds = signal<string[]>([]);

  /** When user hovers a scenario card, store its id here so the Marey
   *  can swap its forecast preview. null = use the active baseline. */
  readonly previewScenarioId = signal<string | null>(null);

  /** What-if Compare map preview: the two branch forecast paths the map
   *  draws when the operator picks an action. baseline = AI course (yellow),
   *  branch = human "My plan" (blue). Set on choose(); cleared on commit /
   *  leave / destroy (same discipline as previewScenarioId). Distinct from
   *  previewScenarioId so the two overlays never collide. */
  readonly whatIfPreview = signal<{
    baseline: WhatIfTrajById;
    branch: WhatIfTrajById;
    handles: number[];
  } | null>(null);

  /**
   * Combined Actions (widget E1) consequence overlay: the action version the
   * operator is currently looking at, expressed per *train handle* so the map
   * and the Marey can draw it.
   *
   * Reordering a dispatch priority list changes timing, not topology — so the
   * Marey shifts the affected trains' future lines along the time axis, and the
   * map marks which trains the action moves and in what order they are
   * released. Set by the Combined Actions panel; cleared when it is destroyed,
   * the same discipline as `previewScenarioId` and `whatIfPreview`.
   *
   * ⚠ The figures behind it are the widget's deterministic **mock** predictor,
   * not simulation output — see docs/plans/widget-e1-combined-actions.md §8.
   */
  readonly combinedActionPreview = signal<CombinedActionPreview | null>(null);

  /** Trains an action package is currently holding the operator's attention on.
   *
   *  The package variant of Combined Actions marks *which* trains an action
   *  takes hold of rather than a full consequence preview: its conflict window
   *  is a fixture, so drawing a rerouted path would be a claim it cannot make.
   *  Kept beside `combinedActionPreview` rather than folded into it — the two
   *  variants say different things, and collapsing them would force one to
   *  pretend to the other's precision. */
  readonly combinedActionHandles = signal<ReadonlySet<number>>(new Set());

  setCombinedActionPreview(preview: CombinedActionPreview | null): void {
    this.combinedActionPreview.set(preview);
  }

  /** Director plan map overlay: the committed plan's per-train cell
   *  paths (planned entry step per cell, so the map clips to the
   *  future). Kept fresh by the Director Weights panel — its poll, and
   *  instantly after a slider settles or a re-plan. Drawn only while
   *  `directorPlanHover` is true (mouse on the panel), so it cannot
   *  collide with the scenario or what-if overlays. */
  readonly directorPlanPaths = signal<
    Record<string, Array<{ step: number; row: number; col: number }>> | null
  >(null);
  readonly directorPlanHover = signal<boolean>(false);

  /** Strategy look-ahead: the per-train paths of a strategy focus the operator
   *  is *considering* but has not committed. Set by the strategy tiles, it
   *  takes precedence over `directorPlanPaths` on the map and is drawn on its
   *  own (no hover needed) — the whole point is to study the reroute a focus
   *  would cause before choosing it. `directorPreviewStrategyId` names the
   *  tile that owns the overlay so it can render as pinned. */
  readonly directorPreviewPaths = signal<
    Record<string, Array<{ step: number; row: number; col: number }>> | null
  >(null);
  readonly directorPreviewStrategyId = signal<string | null>(null);
  /** True when the overlay shows the plan that is actually *driving* (right after
   *  a focus was committed) rather than a hypothetical look-ahead. Same drawing,
   *  opposite meaning — so the map legend must not call it "Vorausschau". */
  readonly directorPreviewIsCommitted = signal<boolean>(false);
  /**
   * The overlay shows *all* of an option's routes because that option deviates
   * from the running plan nowhere.
   *
   * Without this the tile could only disable its map button, which read as
   * broken — most of all on tile A, whose plan often equals the one already
   * driving. Showing the routes is still useful ("where is everyone headed?"),
   * it just must not be labelled a look-ahead at a change that does not exist.
   */
  readonly directorPreviewIsFullPlan = signal<boolean>(false);

  /** Which strategy focus the impact forecast should describe, published by the
   *  strategy tiles for the forecast strip below the map. Null = no focus picked
   *  yet, and the forecast says so instead of projecting a policy that is not
   *  the one driving. */
  readonly directorFocusOutlook = signal<{
    subject: string;
    signals: ForecastSignals;
  } | null>(null);

  /**
   * When the autonomous plan makes its next committed decision — the operator's
   * actual deadline in Director mode.
   *
   * Director has no artificial countdown: nothing expires, the AI simply keeps
   * driving. But it is not open-ended either, and with no indication at all the
   * question "how long do I have?" had no answer on screen. The plan's next
   * scheduled decision is that answer, and it is diegetic rather than invented.
   * Published by the activity feed, which polls the plan anyway.
   */
  readonly directorNextDecision = signal<{
    step: number;
    inSteps: number;
    handle: number | null;
  } | null>(null);

  /** How much the autonomous planner did on its own this shift — published by
   *  the activity feed, read by the shift review. */
  readonly directorAiWorkload = signal<{ decisions: number; replans: number } | null>(null);

  /**
   * The operator declared the shift over ("Schicht beenden").
   *
   * Without this the review was unreachable in practice: `episodeDone` only
   * turns true when the episode really runs out (400 steps by default), which
   * nobody sits through in a demo — so the closing evaluation, the place where
   * preferences are confirmed and saved, was written but never seen. A shift
   * ends when the person on duty says it does, and it can be re-opened, so this
   * is a view state and not a point of no return.
   */
  readonly shiftEnded = signal<boolean>(false);

  /** Whether to show the closing review instead of the decision surfaces. */
  readonly shiftReviewOpen = computed(() => this.episodeDone() || this.shiftEnded());

  /** Declare the shift over: stop the run and switch to the review. */
  endShift(): void {
    if (this.playing()) this.pause();
    this.shiftEnded.set(true);
  }

  /** Back to the running shift (only meaningful while the episode still runs). */
  reopenShift(): void {
    this.shiftEnded.set(false);
  }

  /**
   * What the previewed option changes, as the map draws it: a branch mark per
   * rerouted train and a wait mark per hold. Replaces drawing full planned
   * routes, which was unreadable — the deviating stretches run 19–96 cells, so
   * every option looked like the same bundle of long dashed lines.
   */
  readonly directorPreviewDivergence = signal<DirectorDivergence | null>(null);

  /**
   * The three planned strategy options as `/director/strategies` returned them.
   *
   * In the store rather than inside `strategy-options` because two surfaces need
   * them at different granularity: the panel shows one tile per option, the map
   * draws all three at once as the option bars. Written by the panel, which owns
   * the request and its retry and staleness rules; everyone else reads.
   */
  readonly directorStrategies = signal<DirectorStrategy[]>([]);

  /** Which train's deviating stretch to draw in full — set by pointing at its
   *  branch mark. Only one at a time, on purpose. */
  readonly directorHoverHandle = signal<number | null>(null);

  // Backwards-compat: components that still call .has(h) on a Set.
  readonly selectedHandles = computed<Set<number>>(() => {
    const h = this.selectedHandle();
    return h == null ? new Set<number>() : new Set([h]);
  });

  /** Agent handles highlighted because the user hovers an agent-related
   *  notification. This is intentionally separate from selection. */
  readonly notificationHoverHandles = signal<Set<number>>(new Set<number>());

  setNotificationHoverAgents(handles: number[]): void {
    const clean = handles
      .map((h) => Number(h))
      .filter((h) => Number.isFinite(h));
    this.notificationHoverHandles.set(new Set(clean));
  }

  clearNotificationHoverAgents(): void {
    this.notificationHoverHandles.set(new Set<number>());
  }

  /** Cross-view agent hover, used by map/panel/Marey agent hover.
   *  It intentionally shares the same highlight set as notification hover:
   *  hover source differs, visual linked-agent highlight is the same.
   */
  setAgentHoverAgents(handles: number[]): void {
    this.setNotificationHoverAgents(handles);
  }

  setAgentHoverAgent(handle: number): void {
    this.setNotificationHoverAgents([handle]);
  }

  clearAgentHoverAgents(): void {
    this.clearNotificationHoverAgents();
  }
  // 'Active' = explicit selection; when Marey is visible, fall back to
  // the first agent so the inspector can show a default context.
  readonly activeHandle = computed<number | null>(() => {
    const selected = this.selectedHandle();
    if (selected != null) return selected;
    if (!this.showMarey()) return null;
    const ags = this.agents();
    return ags.length > 0 ? ags[0].handle : null;
  });
  readonly loading = signal(false);
  /** When a multi-step request is in flight, this holds the elapsed_steps
   *  value the backend should reach. UI can derive 'steps left' as
   *  (targetStep() - state().elapsed_steps). Reset to null on response. */
  readonly targetStep = signal<number | null>(null);
  private _pollHandle: ReturnType<typeof setInterval> | null = null;
  readonly error = signal<string | null>(null);
  /** The run stopped on a run error: the server's play loop raised and sent a
   *  WebSocket `error`. Apart from `error`, which HTTP and forecast failures
   *  set too without stopping the run. Not resumed: the toolbar says so and the
   *  leg records it (docs/plans/toolbar-under-guide.md D7, D12). */
  readonly runError = signal<{ message: string; simStep: number; at: number } | null>(null);
  readonly message = signal<string | null>(null);

  readonly playing = signal(false);
  /** Play tempo as an abstract level 1–5 (2 = normal), shared by the
   *  toolbar slider and every automatic Play (tour autostart, dialogs). */
  readonly playSpeedLevel = signal(PLAY_SPEED_DEFAULT_LEVEL);
  /** Steps per second at «normal»: the session's scenario pace, else the default.
   *  Set per session in `newSession`. */
  readonly playSpeedBase = signal(PLAY_SPEED_DEFAULT_BASE);
  /** Steps per second the backend play loop aims for at the current level. */
  readonly playSpeed = computed(() => playSpeedForLevel(this.playSpeedLevel(), this.playSpeedBase()));
  readonly panResetTrigger = signal(0);
  readonly wsConnected = computed(() => this.ws.connected());

  readonly showMap = signal(true);
  readonly showMarey = signal(false);
  /** The centre tab on screen, by its view type (`zug-weg-diagramm` for
   *  the ZWL, `flatland-map`, …), set by the view tabs; null without them.
   *  `showMap` / `showMarey` cannot tell the ZWL from the map. */
  readonly centerView = signal<string | null>(null);

  readonly trajectories = signal<Map<number, TrajectoryPoint[]>>(new Map());

  readonly agents = computed<AgentDTO[]>(() => this.state()?.agents ?? []);

  /** Shared station registry: one entry per distinct stop cell used by the
   *  trains (each train's origin + target), with a stable "S{n}" label ordered
   *  by position. Single source of truth for BOTH the map station layer and the
   *  timetable tile, so labels line up across the two. Derived frontend-side —
   *  no backend change. (Intermediate stops will join once waypoints are
   *  serialized; a real all-cities layer needs city_positions from the env.) */
  readonly stations = computed<StationRef[]>(() => {
    const cells = new Map<string, { row: number; col: number }>();
    for (const a of this.agents()) {
      // Prefer the full ordered stop list (incl. ECML intermediate stops); fall
      // back to just origin + target when stops are not in the payload.
      const positions = a.stops && a.stops.length
        ? a.stops.map((s) => s.cell)
        : [a.initial_position, a.target];
      for (const pos of positions) {
        if (!pos) continue;
        const row = Number(pos[0]);
        const col = Number(pos[1]);
        cells.set(`${row},${col}`, { row, col });
      }
    }
    return [...cells.values()]
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .map((cell, i) => ({
        id: `${cell.row},${cell.col}`,
        // The scene's own name where it has one (Ziegelbrücke); a generated
        // network has none and keeps the positional "S{n}".
        label: this.stationNameAt(cell.row, cell.col) ?? `S${i + 1}`,
        row: cell.row,
        col: cell.col,
      }));
  });

  /** The scene's geography — station and place names — or null for a
   *  generated network (loaded per session, see the constructor). */
  readonly geography = signal<SceneGeography | null>(null);

  /** The section the ZWL draws, as two station references (a
   *  geography code, or "row,col" where a network names nothing) — shared so
   *  the widget's pickers and the track map's "from here / to here" stay in
   *  sync. Either end may still be empty ('') while the other is being chosen.
   *  Tied to the session it was chosen in; null = the scene's whole corridor.
   *  View only. */
  readonly zwlRoute = signal<{ sessionId: string; from: string; to: string } | null>(null);

  /** The chosen route when both ends are set, differ and belong to this session. */
  readonly zwlRouteComplete = computed(() => {
    const r = this.zwlRoute();
    return r && r.sessionId === this.session()?.id && r.from && r.to && r.from !== r.to ? r : null;
  });

  /** `GET /hmi/route-axis` for the complete route: the response, 'none' when
   *  `to` cannot be reached from `from`, null while loading or without a route.
   *  Loaded here rather than in the widget so the track map can highlight the
   *  same cells without asking twice. */
  readonly zwlRouteAxis = signal<RouteAxisResponse | 'none' | null>(null);
  private _zwlRouteKey: string | null = null;

  /** Set one end of the ZWL section (widget picker or track map), keeping the other. */
  setZwlEnd(end: 'from' | 'to', ref: string): void {
    const sid = this.session()?.id;
    if (!sid) return;
    const cur = this.zwlRoute();
    const base = cur && cur.sessionId === sid ? cur : { sessionId: sid, from: '', to: '' };
    this.zwlRoute.set({ ...base, [end]: ref });
  }
  private _geographySession: string | null = null;

  /** Name of the platform at a cell, when the scene names one. */
  stationNameAt(row: number, col: number): string | null {
    const g = this.geography();
    if (!g) return null;
    return g.stations.find((s) => s.cell[0] === row && s.cell[1] === col)?.name ?? null;
  }

  /**
   * Where a cell lies along the line: at a place, or between two, and whether
   * that stretch is the single-track section. Null without a scene geography
   * or outside the named places. Uses the column only — the scenes are
   * corridors, rows are parallel tracks.
   */
  sectionForCell(cell: [number, number] | null | undefined): { from: string; to: string | null; singleTrack: boolean } | null {
    const g = this.geography();
    if (!g || !cell || g.locations.length === 0) return null;
    const col = Number(cell[1]);
    const locs = [...g.locations].sort((a, b) => a.col - b.col);
    const exact = locs.find((l) => l.col === col);
    if (exact) return { from: exact.name, to: null, singleTrack: false };
    let prev: (typeof locs)[number] | null = null;
    let next: (typeof locs)[number] | null = null;
    for (const l of locs) {
      if (l.col < col) prev = l;
      else if (l.col > col && !next) next = l;
    }
    if (!prev || !next) return null;
    const st = g.single_track;
    const singleTrack = st.length === 2 && st.includes(prev.code) && st.includes(next.code);
    return { from: prev.name, to: next.name, singleTrack };
  }

  /** Shared label lookup used by the map and the timetable so a stop resolves to
   *  the same "S{n}" in both. Returns null for cells that are not a known stop. */
  stationLabelForCell(pos: [number, number] | null | undefined): string | null {
    if (!pos) return null;
    const key = `${Number(pos[0])},${Number(pos[1])}`;
    return (
      this.stations().find((s) => s.id === key)?.label ??
      // A train standing at a named platform that is nobody's stop still stands somewhere.
      this.stationNameAt(Number(pos[0]), Number(pos[1]))
    );
  }

  // ── Policies (loaded once at app start) ───────────────────────
  private readonly _policies = signal<PolicyInfo[]>([]);
  readonly availablePolicies = computed<PolicyInfo[]>(() => this._policies());
  readonly defaultPolicy = computed<PolicyName>(() => {
    const def = this._policies().find((p) => p.is_default);
    const first = this._policies()[0];
    return (def?.id ?? first?.id ?? 'deadlock_avoidance') as PolicyName;
  });

  setEnabledScenarioPolicyIds(ids: string[]): void {
    this.enabledScenarioPolicyIds.set([...ids]);
  }

  setEnabledControlPolicyIds(ids: string[]): void {
    this.enabledControlPolicyIds.set([...ids]);
  }

  loadPolicies(): void {
    this.api.listPolicies().subscribe({
      next: (list) => {
        this._policies.set(list);
        if (list.length === 0) return;

        if (this.enabledControlPolicyIds().length === 0) {
          this.enabledControlPolicyIds.set(list.filter((p) => p.show_in_ui).map((p) => p.id));
        }
        if (this.enabledScenarioPolicyIds().length === 0) {
          this.enabledScenarioPolicyIds.set(list.filter((p) => p.supports_scenarios).map((p) => p.id));
        }
        // Which policy a session runs when nobody picks one. The backend's
        // own `is_default` decides, except where a deployment's allowlist
        // (docs/plans/configurable-ui-plan.md §4.3c) excludes it — then the
        // first allowed policy is the default instead. That is what makes a
        // one-entry allowlist a complete instruction: it both hides the
        // selector and names what runs, with no separate "default" setting.
        const allowlist = this.uiConfig.policyAllowlist();
        const allowed = allowlist === null ? list : list.filter((p) => allowlist.includes(p.id));
        const choosable = allowed.length > 0 ? allowed : list;
        const current = this._activePolicy();
        if (!choosable.some((p) => p.id === current)) {
          const def = choosable.find((p) => p.is_default) ?? choosable[0];
          this._activePolicy.set(def.id as PolicyName);
        }
      },
      error: (err) => console.warn('Failed to load policies', err),
    });
  }
  readonly elapsedSteps = computed(() => this.state()?.elapsed_steps ?? 0);
  readonly maxSteps = computed(() => this.state()?.max_episode_steps ?? 0);
  readonly width = computed(() => this.state()?.width ?? 0);
  readonly height = computed(() => this.state()?.height ?? 0);
  readonly railGrid = computed<number[][]>(() => this.state()?.rail_grid ?? []);
  readonly railTiles = computed<RailTile[]>(() => this.state()?.rail_tiles ?? []);
  readonly episodeDone = computed(() => this.state()?.episode_done ?? false);


  // === HMI-Architektur (Phase A) ===
  readonly simulationTime = signal<number>(0);
  /**
   * The layers the operator has explicitly toggled — only those, not the whole
   * set. Everything untouched comes from the mode's defaults, so switching mode
   * changes the baseline while an explicit choice survives it. See
   * `core/layout/layer-mode-defaults.ts` for what each mode starts with and why.
   */
  readonly layerChoices = signal<Partial<LayerVisibility>>({});

  /** Mode defaults with the operator's choices on top. Read-only by design: one
   *  writer (`setLayerVisible`) instead of a signal every surface could set. */
  readonly layerVisibility = computed<LayerVisibility>(() =>
    resolveLayerVisibility(this.interactionMode(), this.layerChoices()),
  );

  /** Layers currently held against the mode's default, for the reset affordance. */
  readonly overriddenLayers = computed<Array<keyof LayerVisibility>>(() =>
    overriddenLayers(this.interactionMode(), this.layerChoices()),
  );

  setLayerVisible(layer: keyof LayerVisibility, visible: boolean): void {
    this.layerChoices.update((chosen) => ({ ...chosen, [layer]: visible }));
  }

  /** Drop every explicit choice, back to what the current mode opens with. */
  resetLayersToModeDefaults(): void {
    this.layerChoices.set({});
  }
  readonly kpiPriorities = signal<KpiPriorities>({
    time: 1,
    energy: 0.5,
    platformRouting: 0.5,
    trainRouting: 0.5,
  });

  /**
   * Visual-Encoding Registry (v1 — authorship only). Sibling to
   * `layerVisibility`, but persisted to localStorage (pre-session, locked
   * during a run via the Session Settings UI). Seam-first: no tile renders
   * authorship yet (B1 what-if will be the first consumer). See
   * `visual-encoding.ts` + the `visual-encoding-registry` memory.
   */
  readonly visualEncoding = signal<VisualEncoding>(loadVisualEncoding());

  /** Preset id matching the current encoding (for the settings radio). */
  readonly visualEncodingPreset = computed<VisualEncodingPresetId>(() =>
    matchingPresetId(this.visualEncoding()),
  );

  /** Apply a named preset. Callers (Session Settings) gate this to pre-session. */
  setVisualEncodingPreset(presetId: VisualEncodingPresetId): void {
    const preset = VISUAL_ENCODING_PRESETS.find((p) => p.id === presetId);
    if (preset) this.visualEncoding.set(preset.encoding);
  }

  /**
   * Decision Log (Tile A2, Capitalization kind). Owned, timestamped record of
   * every decision in a session — human / ai / system. Reuses existing capture
   * choke-points (setOverride / clearOverride / systemHold) in all modes; the
   * coLearningFeedback signal (Co-Learning only) is left untouched so the
   * reflection panel is unaffected. See `core/decision-log.ts` +
   * `docs/plans/tile-a2-decision-log.md`.
   */
  readonly decisionLog = signal<DecisionLogEntry[]>([]);

  /** Per-handle decision-window open time (ms), for decisionTimeMs. */
  private readonly _decisionWindowStart = signal<Record<number, number>>({});

  /** Open the decision window for a handle (idempotent). Called by the
   *  impact panel when a conflict engages. */
  openDecisionWindow(handle: number): void {
    this._decisionWindowStart.update((m) =>
      m[handle] ? m : { ...m, [handle]: Date.now() },
    );
  }

  /** Close the window for a handle; return dwell ms, or null if none was open. */
  private _closeDecisionWindow(handle: number): number | null {
    const start = this._decisionWindowStart()[handle];
    if (start == null) return null;
    this._decisionWindowStart.update((m) => {
      const next = { ...m };
      delete next[handle];
      return next;
    });
    return Date.now() - start;
  }

  /** Append a decision entry (auto-assigns seq, trims to the rolling cap). */
  /** Returns the assigned sequence number so callers (e.g. setOverride) can
   *  later patch the entry — Workstream B annotates the rationale AFTER the
   *  operator answers the "why?" prompt, not at append time. */
  private _appendDecision(entry: Omit<DecisionLogEntry, 'seq'>): number {
    let seq = 0;
    let trimmed = false;
    this.decisionLog.update((list) => {
      seq = list.length ? list[list.length - 1].seq + 1 : 1;
      const next = [...list, { ...entry, seq }];
      trimmed = next.length > DECISION_LOG_CAP;
      return trimmed ? next.slice(next.length - DECISION_LOG_CAP) : next;
    });
    if (trimmed) this._forgetBefore(this.decisionLog()[0].seq);
    return seq;
  }

  /** The decided options and drafts of entries cut from the log go with them
   *  (D26, D30). */
  private _forgetBefore(firstSeq: number): void {
    for (const seq of this._reflectionDrafts.keys()) if (seq < firstSeq) this._reflectionDrafts.delete(seq);
    if ([...this.proposalSnapshots().keys()].some((seq) => seq < firstSeq)) {
      this.proposalSnapshots.update((m) => new Map([...m].filter(([seq]) => seq >= firstSeq)));
    }
  }

  /** Clear the log (e.g. on session reset). */
  clearDecisionLog(): void {
    this.decisionLog.set([]);
    // A reflection patches its decision: with the decisions gone, nothing is
    // left to ask (docs/plans/reflection-inline.md §4.1). Every reset clears
    // the log, so this also starts a new leg without open reflections.
    this.openReflections.set([]);
    this._closed.clear();
    this._shownSeq.set(null);
    this._refusedSeqs.set(new Set());
    this.proposalSnapshots.set(new Map());
    this._reflectionDrafts.clear();
  }

  /** The decided options per decision (`decisionSeq`), for its reflection (D26). */
  readonly proposalSnapshots = signal<Map<number, ProposalSnapshot>>(new Map());

  /** File what «Handlungsoptionen» showed under the newest decision taken
   *  there for that train; nothing when there is none. */
  keepProposalSnapshot(snapshot: ProposalSnapshot): void {
    const entry = [...this.decisionLog()].reverse().find((e) => e.handle === snapshot.handle && e.origin === 'proposals');
    if (!entry) return;
    const result = {
      ...snapshot.result,
      variants: snapshot.result.variants.map(({ trajectories, ...v }) => v),
      ai_alternatives: [],
    };
    this.proposalSnapshots.update((m) => new Map(m).set(entry.seq, { ...snapshot, result }));
  }

  /**
   * Log a decision that is not an override: keeping the timetable, or accepting
   * the AI's replan. Both are decisions the operator is accountable for, so they
   * belong in the log and deserve the same "why?" prompt as a hold — otherwise
   * the two courses the operator can choose would leave no trace at all.
   */
  recordProposalChoice(handle: number, action: DecisionAction): void {
    const now = Date.now();
    const simStep = this.elapsedSteps();
    const decisionSeq = this._appendDecision({
      t: now,
      simStep,
      mode: this.interactionMode(),
      handle,
      accountableOwner: 'human',
      action,
      aiSuggestion: null,
      decisionTimeMs: this._closeDecisionWindow(handle),
      origin: 'proposals',
    });
    if (this.interactionMode() === 'director') return;
    this._askReflection({
      handle,
      // No Flatland action stands for "keep the plan" or "run the AI's plan";
      // the label carries the meaning and the context keeps the situation.
      action: 2,
      mode: this.interactionMode(),
      aiSuggestion: null,
      simStep,
      timestamp: now,
      // The label lives on the decision-log entry (`action`); the context stays
      // the situation snapshot the hypothesis template expects.
      context: this._snapshotRationaleContext(handle, null),
      decisionSeq,
      coLearningTimestamp: null,
    });
  }

  /**
   * Single consumption surface for the KPI filter. Raw slider values are
   * normalised to weights that sum to 1 (or fall back to an equal split when
   * every slider is at 0). Any view that wants to reflect KPI priorities
   * (scenario ranking, Marey emphasis, recommendation scoring) should read
   * this — NOT kpiPriorities directly. The concrete semantics (how each
   * weight maps onto backend scoring) are intentionally left open for now;
   * this just guarantees the wiring exists and is well-defined.
   */
  readonly kpiWeights = computed<KpiWeights>(() => {
    const p = this.kpiPriorities();
    const keys: (keyof KpiPriorities)[] = ['time', 'energy', 'platformRouting', 'trainRouting'];
    const sum = keys.reduce((acc, k) => acc + Math.max(0, p[k]), 0);
    if (sum <= 0) {
      const equal = 1 / keys.length;
      return { time: equal, energy: equal, platformRouting: equal, trainRouting: equal };
    }
    return {
      time: Math.max(0, p.time) / sum,
      energy: Math.max(0, p.energy) / sum,
      platformRouting: Math.max(0, p.platformRouting) / sum,
      trainRouting: Math.max(0, p.trainRouting) / sum,
    };
  });

  /**
   * Active human-AI collaboration mode (WP 3.1 / 3.3 / 3.4). For now this only
   * holds UI state; mode-specific behaviour is wired up in a later step.
   */
  readonly interactionMode = signal<InteractionMode>('recommendation');

  /** Which post-session survey parts are active (configured in Settings).
   *  Default: all parts (see DEFAULT_SURVEY_PARTS). */
  readonly enabledSurveyParts = signal<string[]>([
    'mode', 'nasa-tlx', 'trust', 'understanding', 'ueq-s', 'open',
  ]);

  setEnabledSurveyParts(ids: string[]): void {
    this.enabledSurveyParts.set([...ids]);
  }

  /**
   * Flatland has no malfunction *type* (a malfunction is just "train stuck for N
   * steps"). When this is off we label it honestly as "Train breakdown". When on
   * (demo/study), we assign a synthetic operational type from the AI4REALNET
   * taxonomy deterministically per train, clearly marked "(demo)". A real backend
   * `malfunction_type` (if added later) always wins over both.
   */
  readonly demoMalfunctionTypes = signal<boolean>(false);

  setDemoMalfunctionTypes(on: boolean): void {
    this.demoMalfunctionTypes.set(on);
  }

  /** How many Co-Learning reflection questions to show per incident.
   *  Samira's storyboard: 2 of 5. Configurable in Settings. */
  readonly reflectionQuestionLimit = signal<number>(2);

  setReflectionQuestionLimit(n: number): void {
    this.reflectionQuestionLimit.set(Math.max(1, Math.min(5, Math.floor(n || 1))));
  }

  /** Decision time budget (seconds) before the system applies the recommended
   *  option itself (Recommendation & Co-Learning). Configurable in Settings. */
  readonly decisionCountdownSeconds = signal<number>(10);

  setDecisionCountdownSeconds(n: number): void {
    this.decisionCountdownSeconds.set(Math.max(3, Math.min(60, Math.floor(n || 10))));
  }

  /** How long an AI recommendation shows a countdown before it reads as
   *  "stale". 0 = no countdown: the recommendation stays as long as it
   *  makes sense (i.e. until the backend stops surfacing it, or the human
   *  acts on it). This countdown is a presentation cue only — it does not
   *  auto-apply anything (that's decisionCountdownSeconds). */
  readonly recommendationDurationSeconds = signal<number>(0);

  setRecommendationDurationSeconds(n: number): void {
    const v = Math.floor(n || 0);
    // 0 means "no countdown"; otherwise clamp to a sane [5, 120] window.
    this.recommendationDurationSeconds.set(v <= 0 ? 0 : Math.max(5, Math.min(120, v)));
  }

  /** Whether a new conflict auto-pauses the run (and starts the decision
   *  countdown) in Recommendation & Co-Learning. When off, conflicts still
   *  surface in the impact panel but the simulation keeps running — the
   *  human acts when they want, without being interrupted. Default on. */
  readonly autoPauseOnConflict = signal<boolean>(true);

  setAutoPauseOnConflict(on: boolean): void {
    this.autoPauseOnConflict.set(!!on);
  }

  /** Synthetic operational malfunction types (AI4REALNET D4.1 taxonomy A). */
  private static readonly DEMO_MALFUNCTION_TYPES = [
    'trackBlockage',
    'switchFailure',
    'signalFailure',
    'powerFailure',
  ];

  /** Label for a malfunctioning train's disruption type (see demoMalfunctionTypes). */
  malfunctionTypeLabel(agent: AgentDTO): string {
    const real = (agent as any)?.malfunction_type;
    if (typeof real === 'string' && real) return real;
    if (!this.demoMalfunctionTypes()) return this.i18n.t('malfunction.breakdown');
    const types = SessionStore.DEMO_MALFUNCTION_TYPES;
    const idx = ((agent.handle % types.length) + types.length) % types.length;
    return this.i18n.t('malfunction.demo', { type: this.i18n.t(`malfunction.types.${types[idx]}`) });
  }

  /** True when this train is disrupted, by whichever field the backend used. */
  isMalfunctioning(agent: AgentDTO): boolean {
    return !!agent.is_malfunctioning
      || (agent.malfunction_remaining ?? 0) > 0
      || String(agent.state ?? '').toUpperCase().includes('MALFUNCTION');
  }

  /**
   * Trains a conflict actually involves: everyone the impact analysis names
   * (blocked or blocking) plus everyone currently disrupted.
   *
   * Lives here rather than in a panel because more than one surface needs the
   * same answer — the roster's "nur Konflikte" filter and the disposition
   * table's. Two copies of the definition would be two definitions.
   */
  readonly conflictHandles = computed<ReadonlySet<number>>(() => {
    const handles = new Set<number>();
    for (const item of this.impact()) {
      handles.add(item.handle);
      handles.add(item.blocked_by);
    }
    for (const a of this.agents()) {
      if (this.isMalfunctioning(a)) handles.add(a.handle);
    }
    return handles;
  });

  /** True while the AI drives the simulation autonomously (Director / WP 3.4). */
  readonly aiInControl = computed(() => this.interactionMode() === 'director');
  /** True in Co-Learning mode (WP 3.3), where human interventions are logged. */
  readonly isCoLearning = computed(() => this.interactionMode() === 'co-learning');

  /**
   * How action/policy options are framed across the whole UI:
   *  - 'recommended' (Recommendation / WP 3.1): AI ranks + badges a best option.
   *  - 'neutral'     (Co-Learning / WP 3.3): options shown as equal choices.
   *  - 'none'        (Director / WP 3.4): the human isn't prompted with options.
   * Every options surface (recommendations-panel, scenario-panel, …) reads THIS
   * — there is no parallel flag.
   */
  readonly optionPresentation = computed<'recommended' | 'neutral' | 'none'>(() => {
    switch (this.interactionMode()) {
      case 'recommendation':
        return 'recommended';
      case 'co-learning':
        return 'neutral';
      case 'director':
        return 'none';
    }
  });

  /** Human interventions recorded during the current Co-Learning session. */
  readonly coLearningFeedback = signal<CoLearningEntry[]>([]);
  readonly interventionCount = computed(() => this.coLearningFeedback().length);

  /** Workstream B Tier 1: an override awaiting its "why?" (deck slide 7).
   *  Non-null right after a human override that overrode a recommendation (or
   *  any Co-Learning intervention); the rationale-capture UI reads this.
   *  Mode-agnostic store, mode-specific capture surface
   *  (docs/plans/colearning-across-modes.md §2). The one reflection *shown*,
   *  derived from `openReflections`, which holds every decision still without
   *  one (docs/plans/reflection-inline.md §4.1). */
  readonly pendingRationale = computed<PendingRationale | null>(() => {
    const seq = this._shownSeq();
    return seq == null ? null : (this.openReflections().find((r) => r.decisionSeq === seq) ?? null);
  });

  /**
   * Director's own capture surface, the "Tier 2" the override prompt above
   * defers to (see `setOverride`: the per-train "why?" is deliberately
   * suppressed in Director).
   *
   * Director asks the human exactly one question — which objective should the
   * plan pursue — so that is where its preference evidence comes from. It is a
   * *better* signal than an override rationale: the axis is stated rather than
   * inferred, the alternatives were on screen, and their costs were quantified.
   * Without this the operator model gets nothing at all in Director, and the
   * "what the AI learned about you" panel stays permanently empty.
   */
  readonly pendingStrategyReflection = signal<{
    decisionSeq: number;
    timestamp: number;
    /** Focus title as shown on the tile, e.g. "Anschlüsse halten". */
    title: string;
    ident: string;
    axis: DecisionValueAxis;
    /** What it gave up, e.g. "−31 Pünktlichkeit". Null when nothing regressed. */
    tradedAway: string | null;
    hypothesis: string;
  } | null>(null);

  /**
   * Log a committed strategy focus and open its reflection prompt.
   * Returns the decision-log sequence number.
   */
  recordStrategyChoice(choice: {
    title: string;
    ident: string;
    axis: DecisionValueAxis;
    tradedAway: string | null;
    hypothesis: string;
  }): number {
    const now = Date.now();
    const seq = this._appendDecision({
      t: now,
      simStep: this.elapsedSteps(),
      mode: this.interactionMode(),
      // Not about a single train: the objective governs the whole plan. -1 keeps
      // the schema intact without pretending a handle was involved.
      handle: -1,
      accountableOwner: 'human',
      action: 'strategy',
      aiSuggestion: null,
      decisionTimeMs: null,
      valueAxis: choice.axis,
      tradedAway: choice.tradedAway ?? undefined,
    });
    this.pendingStrategyReflection.set({
      decisionSeq: seq,
      timestamp: now,
      title: choice.title,
      ident: choice.ident,
      axis: choice.axis,
      tradedAway: choice.tradedAway,
      hypothesis: choice.hypothesis,
    });
    return seq;
  }

  /**
   * Answer the strategy reflection. 'yes' promotes the hypothesis to a rule the
   * AI may apply; 'once' is the overfitting guard and explicitly must not;
   * 'no' records nothing beyond the decision itself.
   */
  answerStrategyReflection(response: 'yes' | 'once' | 'no', reason?: string): void {
    const pending = this.pendingStrategyReflection();
    if (!pending) return;

    // The stated situation is the condition half of the preference ("learn the
    // condition, not the option"). Without one, the choice itself is still
    // recorded — just as weaker evidence.
    const rationale = reason
      ? `Strategie: ${pending.title}; ${reason}`
      : `Strategie: ${pending.title}`;

    this.decisionLog.update((list) =>
      list.map((e) =>
        e.seq === pending.decisionSeq
          ? {
              ...e,
              rationale,
              preferenceHypothesis: pending.hypothesis,
              hypothesisResponse: response,
            }
          : e,
      ),
    );

    if (response === 'yes' || response === 'once') {
      this.learning.addRecord({
        id: `lr_strategy_${pending.timestamp}`,
        createdAt: pending.timestamp,
        mode: this.interactionMode(),
        handle: -1,
        action: 0,
        strategyLabel: pending.title,
        rationale:
          reason ??
          (pending.tradedAway
            ? `Ziel gewählt, Preis: ${pending.tradedAway}`
            : 'Ziel gewählt'),
        hypothesis: pending.hypothesis,
        response,
        once: response === 'once',
        context: {
          connectionCritical: pending.axis === 'connection',
          lowDelay: pending.axis === 'punctuality',
          lowRipple: pending.axis === 'stability',
          aiSuggestion: null,
          simStep: this.elapsedSteps(),
          hasScenario: true,
          scenarioTitle: pending.title,
        },
      });
    }

    this.pendingStrategyReflection.set(null);
  }

  /** Dismiss without answering. The choice itself stays logged. */
  dismissStrategyReflection(): void {
    this.pendingStrategyReflection.set(null);
  }

  /** Confirmed learning records (deck slide 5) — proxied from LearningStore so
   *  panels can read them through the store they already inject. */
  readonly learningRecords = computed(() => this.learning.visibleRecords());
  readonly confirmedPreferenceCount = computed(() => this.learning.confirmedCount());

  /**
   * "Things have calmed down": the lull in which Co-Learning reflection should
   * become available (Hamouche et al., Kolb phase 2). Calm = a started session
   * that is currently paused with no agent in malfunction. A pause counts as
   * calm; the very start (no steps yet) does not.
   */
  readonly isCalm = computed(() => {
    if (!this.session()) return false;
    if (this.playing()) return false;
    if (this.elapsedSteps() === 0) return false;
    const anyMalfunction = this.agents().some(
      (a) => !!a.is_malfunctioning
        || (a.malfunction_remaining ?? 0) > 0
        || String(a.state ?? '').toUpperCase().includes('MALFUNCTION'),
    );
    return !anyMalfunction;
  });

  /** Co-Learning: the human explicitly asked to reflect *now* (also mid-run).
   *  The reflection panel shows when this is set (or at episode end). Reflection
   *  is intentional, not an auto-popup on every calm moment. */
  readonly reflectionRequested = signal<boolean>(false);
  toggleReflectionRequested(): void {
    this.reflectionRequested.update((v) => !v);
  }

  /**
   * Switch collaboration mode and apply its immediate behaviour:
   *  - Director: hand control to the AI by starting auto-play.
   *  - leaving Director: pause so the human regains step-by-step control.
   */
  // ── Guided demo flow (sequential modes on the SAME environment) ──────
  readonly demoActive = signal(false);
  /** The running tour's mode sequence. A signal, not a constant: which modes a
   *  guided run walks through is a property of the chosen Tour
   *  (core/demo/tours.ts), not of the store. Defaults to the original
   *  three-mode walk so anything starting a demo without naming a tour behaves
   *  as before. */
  readonly demoSequence = signal<InteractionMode[]>(['recommendation', 'co-learning', 'director']);
  /** Whether each leg of the running tour ends with the survey. */
  readonly demoSurveyEnabled = signal(true);
  readonly demoStepIndex = signal(0);
  /** Current demo phase (mode) or null when no demo is running. */
  readonly demoPhase = computed<InteractionMode | null>(() =>
    this.demoActive() ? this.demoSequence()[this.demoStepIndex()] : null,
  );
  readonly demoIsLast = computed(() => this.demoStepIndex() >= this.demoSequence().length - 1);

  /** True while the intro/explainer screen for the current demo mode is showing,
   *  before the human has chosen to start that mode's scenario. */
  readonly demoIntroPending = signal(false);

  /** Begin a guided tour at its first mode (caller creates the session).
   *  Pass the tour's sequence and survey setting; omitting them keeps the
   *  original three-mode walk. */
  startDemo(modes?: InteractionMode[], surveyAfterEachMode = true): void {
    if (modes?.length) this.demoSequence.set([...modes]);
    this.demoSurveyEnabled.set(surveyAfterEachMode);
    this.demoStepIndex.set(0);
    this.demoActive.set(true);
    this.demoIntroPending.set(true);
    this.setInteractionMode(this.demoSequence()[0]);
  }

  /** Advance to the next demo mode; returns false when the demo is finished. */
  advanceDemo(): boolean {
    if (this.demoIsLast()) {
      this.demoActive.set(false);
      return false;
    }
    this.demoStepIndex.update((i) => i + 1);
    this.demoIntroPending.set(true);
    this.setInteractionMode(this.demoSequence()[this.demoStepIndex()]);
    return true;
  }

  /** Human clicked "Start scenario" on the mode-intro screen. */
  dismissDemoIntro(): void {
    this.demoIntroPending.set(false);
  }

  stopDemo(): void {
    this.demoActive.set(false);
    this.demoStepIndex.set(0);
    this.demoIntroPending.set(false);
  }

  /** The policy that was active before Director mode took over, so
   *  leaving the mode can hand the trains back to it. */
  private _policyBeforeDirector: PolicyName | null = null;

  /** Elapsed step the next session should open on; see
   *  `_autoAdvanceToOpeningState`. Set by `newSession`, consumed once. */
  private _openAtStep = 0;

  setInteractionMode(mode: InteractionMode): void {
    const prev = this.interactionMode();
    if (mode === prev) return;
    this.interactionMode.set(mode);

    if (!this.session()) return;

    // Director (WP 3.4) no longer auto-plays on entering: the human first sets
    // a high-level directive (KPI weights + policy) and then explicitly starts
    // the autonomous run via the directive card. Leaving Director hands control
    // back to the human, so a running autonomous loop is paused.
    if (prev === 'director' && this.playing()) {
      this.pause();
    }

    // Director mode drives the trains with its own planner: entering
    // selects the goal_directed policy for the session, leaving restores
    // whatever was active before. If the user hand-picked a different
    // policy *while in* Director, that choice wins — no restore over it.
    if (mode === 'director' && this.activePolicy() !== 'goal_directed') {
      this._policyBeforeDirector = this.activePolicy();
      this._applySessionPolicy('goal_directed');
    } else if (prev === 'director') {
      const before = this._policyBeforeDirector;
      this._policyBeforeDirector = null;
      if (before && this.activePolicy() === 'goal_directed') {
        this._applySessionPolicy(before);
      }
    }
  }

  /** Switch the session's policy backend-first, mirroring the toolbar's
   *  own flow: the local signal follows only when the backend accepted. */
  private _applySessionPolicy(policy: PolicyName): void {
    const sess = this.session();
    if (!sess) return;
    // Set locally first. A fresh session starts advancing at once
    // (`_autoAdvanceToOpeningState`), and every step request carries the
    // active policy; waiting for the server's answer let the first steps of a
    // Director session run under the previous policy or not, by timing — so the
    // same scenario started from different states (and missed the precomputed
    // start, step0_cache.py). Reverted if the server refuses.
    const before = this.activePolicy();
    this.setActivePolicy(policy);
    this.api.setPolicy(sess.id, policy).subscribe({
      error: (e) => {
        this.setActivePolicy(before);
        this.error.set(`Set policy failed: ${e?.message ?? e}`);
      },
    });
  }

  /** Top AI recommendation title right now, used to annotate Co-Learning logs. */
  private _currentTopRecommendation(): string | null {
    const recs = this.recommendations();
    return recs.length > 0 ? recs[0].title : null;
  }

  /** Snapshot the situation at override time for the preference hypothesis
   *  (deck slide 5: "learn the condition, not the option"). Derives the three
   *  Phase-2 trade-off proxies (connection/delay/ripple) from the top
   *  recommendation's backing scenario — the same heuristic the strategy cards
   *  use. `hasScenario` flags whether the booleans are real or defaulted, so the
   *  hypothesis template can stay honest when no scenario is on the table. */
  /**
   * Where the "why?" context comes from. 'scenario' (the default) derives it
   * from the scenario panel's KPI deltas; 'impact' takes the impact analysis'
   * facts about the decided train. Set by the running tour
   * (`TourBriefing.learningContext`), so experiments keep the default.
   */
  readonly rationaleContextSource = signal<'scenario' | 'impact'>('scenario');

  private _snapshotRationaleContext(handle: number, aiSuggestion: string | null): RationaleContext {
    if (this.rationaleContextSource() === 'impact') {
      const live = this.impact().find((i) => i.handle === handle);
      const seen = live ? { item: live, step: this.elapsedSteps() } : this._lastImpact.get(handle);
      if (seen) {
        // A held train waits where it was; the block keeps counting down.
        const clearsInSteps = Math.max(0, seen.item.clears_in_steps - (this.elapsedSteps() - seen.step));
        return {
          connectionCritical: false,
          lowDelay: clearsInSteps < LONG_BLOCK_STEPS,
          lowRipple: true,
          aiSuggestion,
          simStep: this.elapsedSteps(),
          hasScenario: true,
          impact: {
            etaSteps: seen.item.eta_steps,
            clearsInSteps,
            canReroute: seen.item.can_reroute,
            blockedBy: seen.item.blocked_by,
          },
        };
      }
    }
    const recs = this.recommendations();
    const scenarios = this.scenarios();
    const topRec = recs.length > 0 ? recs[0] : null;
    const scenario = topRec?.scenarioId
      ? scenarios.find((s) => s.id === topRec.scenarioId)
      : scenarios.find((s) => s.isBaseline) ?? scenarios[0] ?? null;

    const simStep = this.elapsedSteps();
    if (!scenario) {
      return {
        connectionCritical: false,
        lowDelay: false,
        lowRipple: false,
        aiSuggestion,
        simStep,
        hasScenario: false,
      };
    }

    const d = scenario.kpiDeltas?.meanDelay;
    const done = scenario.kpiDeltas?.done;
    const dl = scenario.kpiDeltas?.deadlocks;

    const delayValue = d == null ? '—' : `${d > 0 ? '+' : ''}${Math.round(d)}`;
    const connectionValue = done == null ? '—' : done > 0 ? 'Better' : done === 0 ? 'Stable' : 'Reduced';
    const rippleValue = dl == null ? '—' : dl <= 0 ? 'Low' : dl <= 1 ? 'Medium' : 'High';

    return {
      connectionCritical: done != null && done < 0,            // 'Reduced' → at risk
      lowDelay: d != null && d <= 0,                            // no added delay
      lowRipple: dl != null && dl <= 0,                         // no added deadlocks
      delayValue,
      connectionValue,
      rippleValue,
      aiSuggestion,
      simStep,
      hasScenario: true,
      scenarioTitle: scenario.title ?? null,
    };
  }

  /**
   * What was decided, in words, in the operator's language. A choice in
   * «Handlungsoptionen» stores a placeholder action, so the logged choice
   * names it (docs/plans/reflection-inline.md D8). One lookup for every prompt
   * and for the record, so they cannot name different courses.
   */
  rationaleLabel(pending: PendingRationale): string {
    const logged = this.decisionLog().find((e) => e.seq === pending.decisionSeq)?.action;
    return strategyLabelForAction(pending.action, (key, params, fallback) => this.i18n.t(key, params, fallback), logged);
  }

  /** Submit the rationale for the pending override: patch the matching
   *  CoLearningEntry (Co-Learning only) and DecisionLogEntry with the why +
   *  hypothesis + response, add a LearningRecord (confirmed → persisted; one-off
   *  → in-memory only), and clear the prompt. 'no' records nothing. */
  submitRationale(payload: {
    rationale: string;
    response: 'yes' | 'once' | 'no';
    /** The value axis the chosen reason chips stand for, if any. Stated by the
     *  capture surface because the rationale text itself is translated. */
    valueAxis?: DecisionValueAxis | null;
    /** Answers to guided reflection questions, when the capture surface asks them. */
    reflection?: Record<string, string>;
  }): void {
    const pending = this.pendingRationale();
    if (!pending) return;

    // In the operator's language: shown on the prompt, then kept on the record.
    const t = (key: string, params?: Record<string, string>, fallback?: string) =>
      this.i18n.t(key, params, fallback);
    const logged = this.decisionLog().find((e) => e.seq === pending.decisionSeq)?.action;
    const strategyLabel = this.rationaleLabel(pending);
    const hypothesis = buildPreferenceHypothesis(pending.context, strategyLabel, t);

    // Patch the CoLearningEntry this override produced (Co-Learning mode only).
    if (pending.coLearningTimestamp != null) {
      this.coLearningFeedback.update((list) =>
        list.map((e) =>
          e.timestamp === pending.coLearningTimestamp
            ? {
                ...e,
                rationale: payload.rationale,
                preferenceHypothesis: hypothesis,
                hypothesisResponse: payload.response,
              }
            : e,
        ),
      );
    }

    // Patch the DecisionLogEntry this override produced (all modes).
    this.decisionLog.update((list) =>
      list.map((e) =>
        e.seq === pending.decisionSeq
          ? {
              ...e,
              rationale: payload.rationale,
              // Stated axis beats inferring one from translated text.
              valueAxis: payload.valueAxis ?? e.valueAxis,
              preferenceHypothesis: hypothesis,
              hypothesisResponse: payload.response,
              ...(payload.reflection && Object.keys(payload.reflection).length > 0
                ? { reflection: payload.reflection }
                : {}),
              // Without the pause a reflection may come much later (§4.1, D7).
              reflectedAt: Date.now(),
              reflectedAtStep: this.elapsedSteps(),
            }
          : e,
      ),
    );

    // 'no' = hypothesis rejected → no Learning Record (deck slide 7).
    if (payload.response === 'yes' || payload.response === 'once') {
      const record: LearningRecord = {
        id: `lr_${pending.timestamp}_${pending.handle}`,
        createdAt: pending.timestamp,
        mode: pending.mode,
        handle: pending.handle,
        action: pending.action,
        strategyLabel,
        decision: logged,
        rationale: payload.rationale,
        hypothesis,
        response: payload.response,
        once: payload.response === 'once',
        context: pending.context,
      };
      this.learning.addRecord(record);
    }

    // Answered: off the list; a decision that waited meanwhile is next.
    this._closed.delete(pending.decisionSeq);
    this.openReflections.update((list) => list.filter((r) => r.decisionSeq !== pending.decisionSeq));
    this._reflectionDrafts.delete(pending.decisionSeq);
    this._shownSeq.set(this._nextWaiting());
  }

  /** What was typed in an open reflection and not sent yet, per decision, so
   *  showing it again starts from there (docs/plans/reflection-inline.md
   *  §4.8, D30). In memory only, not exported. */
  private readonly _reflectionDrafts = new Map<number, ReflectionDraft>();

  keepReflectionDraft(seq: number, draft: ReflectionDraft): void {
    this._reflectionDrafts.set(seq, draft);
  }

  reflectionDraft(seq: number): ReflectionDraft | null {
    return this._reflectionDrafts.get(seq) ?? null;
  }

  /** Dismiss the "why?" prompt without recording (e.g. user closes it). The
   *  override itself stays logged and its reflection stays open. */
  dismissRationale(): void {
    const shown = this._shownSeq();
    if (shown != null && !this.queueReflections()) {
      // No tour asks for it again: the decision goes, as before the reflection
      // moved into the decision panel, and is settled as a passive accept.
      this.openReflections.update((list) => list.filter((r) => r.decisionSeq !== shown));
      this._reflectionDrafts.delete(shown);
      this._shownSeq.set(null);
      return;
    }
    if (shown != null) this._closed.add(shown);
    this._shownSeq.set(this._nextWaiting());
  }

  /** Close the shown reflection for another item below the decision log (a
   *  past decision, D29), without showing the next one. It stays open, with
   *  what was typed (D30), and comes back on request, as after ×. */
  setAsideRationale(): void {
    const shown = this._shownSeq();
    if (shown == null) return;
    this._closed.add(shown);
    this._shownSeq.set(null);
  }

  /**
   * Every decision still waiting for its reflection, in decision order
   * (docs/plans/reflection-inline.md §4.1, D3). `pendingRationale` is the one
   * shown. A decision taken while another is shown waits here, so a new
   * decision never replaces what the operator is typing; it is shown once that
   * one is answered or closed. Reopening another one does replace it
   * (`reopenRationale`). Without the pause for a reflection, decisions
   * overlap.
   */
  readonly openReflections = signal<PendingRationale[]>([]);
  /**
   * Keep every open reflection and ask for each (a tour with `reasonDialog`;
   * set by the app from the tour, the store does not read it). Off, the prompt
   * asks about the latest decision only: a new one replaces it and × drops it,
   * as before the reflection moved into the decision panel
   * (docs/plans/reflection-inline.md §4.1).
   */
  readonly queueReflections = signal(false);
  /**
   * The layout has a panel that can show a "why?", expanded or collapsed. Set
   * by the app from the layout; the store does not read layouts. Without one a
   * decision asks nothing and is logged without a reason, like an AI decision
   * (docs/plans/reflection-inline.md D16). On by default, so a session without
   * an app (tests, replay) asks as before.
   */
  readonly reflectionPlaceInLayout = signal(true);
  /** Which open reflection the prompt shows; `pendingRationale` is derived from
   *  it and the list, so an answered or cleared one cannot stay shown. */
  private readonly _shownSeq = signal<number | null>(null);
  /** Decisions whose reflection was closed unanswered: not shown again on
   *  their own, only on request (the log, the guide). */
  private readonly _closed = new Set<number>();
  readonly openReflectionSeqs = computed(() => new Set(this.openReflections().map((r) => r.decisionSeq)));
  readonly canReopenRationale = computed(
    () => this.openReflections().length > 0 && this.pendingRationale() === null,
  );

  /**
   * Show an open reflection again: the given decision's, else the newest. The
   * one shown before is replaced; what was typed in either is kept as a draft
   * (`keepReflectionDraft`, D30).
   */
  reopenRationale(seq?: number): void {
    const open = this.openReflections();
    const target = seq == null ? open[open.length - 1] : open.find((r) => r.decisionSeq === seq);
    if (!target) return;
    this._closed.delete(target.decisionSeq);
    this._shownSeq.set(target.decisionSeq);
  }

  /** The decisions still open at the last refused finish. */
  private readonly _refusedSeqs = signal<ReadonlySet<number>>(new Set());
  /** How many of them are still open: counts down as they are answered and
   *  is 0 when none was refused or all are answered since; a decision taken
   *  after the refusal does not count. Shows the toolbar's message (§4.4, D6). */
  readonly reflectionsMissing = computed(() => {
    const refused = this._refusedSeqs();
    return refused.size === 0 ? 0 : this.openReflections().filter((r) => refused.has(r.decisionSeq)).length;
  });

  /**
   * Refuse to finish while reflections are open. The caller decides whether
   * the tour requires them (`TourBriefing.reasonDialog`); the store does not
   * read the tour. Returns true when finishing has to wait.
   */
  refuseFinishForOpenReflections(): boolean {
    const open = this.openReflections();
    if (open.length === 0) return false;
    this._refusedSeqs.set(new Set(open.map((r) => r.decisionSeq)));
    return true;
  }

  /** The oldest open reflection not closed by the operator, if any. */
  private _nextWaiting(): number | null {
    return this.openReflections().find((r) => !this._closed.has(r.decisionSeq))?.decisionSeq ?? null;
  }

  /** A decision asks for its reflection: it joins the open ones and is shown
   *  unless another is shown already. */
  private _askReflection(r: PendingRationale): void {
    if (!this.reflectionPlaceInLayout()) return;
    if (!this.queueReflections()) {
      this._closed.clear();
      // The one shown before is dropped, and with it what was typed (D30).
      this._reflectionDrafts.clear();
      this.openReflections.set([r]);
      this._shownSeq.set(r.decisionSeq);
      return;
    }
    this.openReflections.update((list) => [...list, r]);
    if (this.pendingRationale() === null) this._shownSeq.set(r.decisionSeq);
  }

  readonly notifications = signal<AppNotification[]>([]);
  readonly scenarios = signal<ScenarioOption[]>([]);
  readonly recommendations = signal<Recommendation[]>([]);
  /** Phase-1 impact analysis: trains affected by a malfunction. */
  readonly impact = signal<ImpactItem[]>([]);

  /** The last impact entry seen per train and the step it was seen at. A train
   *  the system holds drops out of the live list (it no longer runs into the
   *  block), but the "why?" prompt still needs what the analysis said about it. */
  private readonly _lastImpact = new Map<number, { item: ImpactItem; step: number }>();

  /** Live conflict forecast for the Combined Actions panel (widget E1): the
   *  multi-agent contentions ahead, most-urgent first. Empty when the network
   *  runs to plan — the panel keeps its empty state rather than synthesising a
   *  package. Refreshed alongside the other HMI forecasts. */
  readonly contentions = signal<ContentionGroup[]>([]);

  /** The forecast budget the contentions endpoint ran with, in simulation steps
   *  — how far it looked ahead. A **compute budget**, not a reliability statement
   *  (the strategy-forecast panel's load-shrinking `horizonMinutes` is that;
   *  spec §8). The Combined Actions panel states this in minutes via the shared
   *  `MINUTES_PER_STEP` convention. */
  readonly contentionHorizonSteps = signal<number>(0);
  readonly focusedElement = signal<{ kind: 'train' | 'switch' | 'signal'; id: string } | null>(null);

  constructor() {
    effect(() => {
      const items = this.impact();
      const step = untracked(() => this.elapsedSteps());
      for (const item of items) this._lastImpact.set(item.handle, { item, step });
    });
    effect(() => {
      // A new session starts without history.
      this.session()?.id;
      untracked(() => this._lastImpact.clear());
    });
    effect(() => {
      const r = this.zwlRouteComplete();
      const key = r ? `${r.sessionId}|${r.from}|${r.to}` : null;
      untracked(() => {
        if (key === this._zwlRouteKey) return;
        this._zwlRouteKey = key;
        this.zwlRouteAxis.set(null);
        if (!r) return;
        this.api.getRouteAxis(r.sessionId, r.from, r.to).subscribe({
          next: (resp) => {
            if (this._zwlRouteKey === key) this.zwlRouteAxis.set(resp.length == null ? 'none' : resp);
          },
          error: () => {
            if (this._zwlRouteKey === key) this.zwlRouteAxis.set('none');
          },
        });
      });
    });

    // Station and place names come with the scene; fetch them once per session.
    effect(() => {
      const id = this.session()?.id ?? null;
      untracked(() => {
        if (id === this._geographySession) return;
        this._geographySession = id;
        this.geography.set(null);
        if (!id) return;
        this.api.getGeography(id).subscribe({
          next: (g) => {
            if (this._geographySession === id) this.geography.set(g);
          },
          error: () => {},
        });
      });
    });

    effect(() => {
      const msg = this.ws.lastMessage();
      if (!msg) return;

      // untracked() verhindert dass Set-Calls hier eine Loop triggern
      untracked(() => {
        if (msg.type === 'state' && msg.state) {
          this.state.set(msg.state);
          this._recordTrajectory(msg.state);
          this.loading.set(false);
        } else if (msg.type === 'episode_done') {
          this.playing.set(false);
          this.message.set('Episode finished. Use Reset to start again.');
        } else if (msg.type === 'error') {
          this.error.set(msg.message ?? 'Unknown WebSocket error');
          this.playing.set(false);
          this.runError.set({ message: msg.message ?? '', simStep: this.elapsedSteps(), at: Date.now() });
        }
      });
    });

    // Persist the Visual-Encoding registry to localStorage on every change.
    // `loadVisualEncoding()` ran at signal init; this keeps storage in sync.
    effect(() => saveVisualEncoding(this.visualEncoding()));

    // Apply severity/positive as `:root` CSS custom-property overrides so a
    // chosen preset actually re-colours the app (malfunction indicator,
    // impact/left-sidebar severity, scenario/impact "recommended"), not just
    // the Session Settings preview. Session Settings only allows editing this
    // while no session is active (radios disabled via `sessionActive()`), so
    // a change can only happen before the next "New session"/"Restart run" —
    // this effect firing immediately on change already satisfies "takes
    // effect at the next run start" without extra gating. Authorship has no
    // consumer yet (seam-first, unchanged from before).
    effect(() => {
      const ve = this.visualEncoding();
      if (typeof document === 'undefined') return;
      const root = document.documentElement.style;
      root.setProperty('--app-severity-warn', ve.severity.warn);
      root.setProperty('--app-severity-error', ve.severity.error);
      root.setProperty('--app-positive', ve.positive);
    });
  }

  private _trajectoryPosition(a: AgentDTO): [number, number] | null {
    // Actual in-map position wins.
    if (a.position != null) return a.position;

    // READY_TO_DEPART has no position yet, but visually belongs to its
    // initial position. Duplicate suppression records it at most once.
    if (a.state === 'READY_TO_DEPART') return a.initial_position;

    // WAITING/DONE-without-position/etc. must not create artificial
    // repeated cells in the Marey topology.
    return null;
  }

  private _sameTrajectoryPosition(
    a: [number, number] | null,
    b: [number, number] | null,
  ): boolean {
    if (a == null || b == null) return a == null && b == null;
    return a[0] === b[0] && a[1] === b[1];
  }

  private _recordTrajectory(state: SessionState) {
    const map = this.trajectories();
    const newMap = new Map(map);
    let changed = false;

    const normalizeRun = (
      pt: TrajectoryPoint,
      endStep: number,
      direction: number | null,
      agentState: string,
    ): TrajectoryPoint => {
      const safeEnd = Math.max(pt.endStep ?? pt.step, endStep);
      const duration = Math.max(1, safeEnd - pt.step + 1);

      return {
        ...pt,
        endStep: safeEnd,
        durationSteps: duration,
        dwellSteps: duration,
        direction,
        state: agentState,
      };
    };

    for (const a of state.agents) {
      const list = newMap.get(a.handle) ?? [];
      const lastPt = list.length > 0 ? list[list.length - 1] : null;
      const pos = this._trajectoryPosition(a);

      // No meaningful position: do not append synthetic path cells.
      if (pos == null) {
        continue;
      }

      // Same backend step can arrive more than once via polling/ws.
      // Update the last run metadata for this exact step instead of appending.
      if (lastPt && state.elapsed_steps <= (lastPt.endStep ?? lastPt.step)) {
        const updated = normalizeRun(lastPt, state.elapsed_steps, a.direction, a.state);

        if (
          !this._sameTrajectoryPosition(lastPt.position, pos) ||
          lastPt.direction !== updated.direction ||
          lastPt.state !== updated.state ||
          lastPt.endStep !== updated.endStep ||
          lastPt.durationSteps !== updated.durationSteps ||
          lastPt.dwellSteps !== updated.dwellSteps
        ) {
          newMap.set(a.handle, [...list.slice(0, -1), { ...updated, position: pos }]);
          changed = true;
        }
        continue;
      }

      // Consecutive compression:
      // If agent stays in the same cell because of speed < 1, STOPPED,
      // MALFUNCTION, MALFUNCTION_OFF_MAP, etc., keep exactly one trajectory
      // cell and extend its endStep/duration.
      //
      // Important:
      // Later returning to the same cell creates a NEW run because only the
      // immediately previous point is compared.
      if (lastPt && this._sameTrajectoryPosition(lastPt.position, pos)) {
        const updated = normalizeRun(lastPt, state.elapsed_steps, a.direction, a.state);

        if (
          lastPt.direction !== updated.direction ||
          lastPt.state !== updated.state ||
          lastPt.endStep !== updated.endStep ||
          lastPt.durationSteps !== updated.durationSteps ||
          lastPt.dwellSteps !== updated.dwellSteps
        ) {
          newMap.set(a.handle, [...list.slice(0, -1), updated]);
          changed = true;
        }
        continue;
      }

      // New cell/run starts here.
      newMap.set(a.handle, [
        ...list,
        {
          step: state.elapsed_steps,
          endStep: state.elapsed_steps,
          durationSteps: 1,
          dwellSteps: 1,
          position: pos,
          direction: a.direction,
          state: a.state,
        },
      ]);
      changed = true;
    }

    if (changed) {
      this.trajectories.set(newMap);
    }
  }


  private _resetTrajectories() {
    this.trajectories.set(new Map());
  }

  toggleMap() {
    this.showMap.update((v) => !v);
    if (!this.showMap() && !this.showMarey()) this.showMarey.set(true);
  }

  toggleMarey() {
    this.showMarey.update((v) => !v);
    if (!this.showMap() && !this.showMarey()) this.showMap.set(true);
  }

  private _isAnyAgentMoving(st: SessionState | null): boolean {
    if (!st || st.agents.length === 0) return false;
    return st.agents.some((a) => a.state === 'MOVING');
  }

  /**
   * Step a fresh session up to the state it should open on: the first agent
   * moving, and at least `openAtStep` elapsed steps.
   *
   * The second condition exists for the Director. Its strategy options are a
   * re-plan of a plan that is already running, so at a cold start they have
   * nothing to differ from: measured on `pf-ch-wn-wal-long-approach`, planning
   * fresh at step 21 gives all three options the plan the Director just
   * committed, i.e. three tiles reading "changes nothing". Driven from step 1,
   * the same scenario has the three options differ pairwise from step 8 on and
   * none of them empty from step 20 on. A tour that is about choosing between
   * them therefore has to open past that point (`Tour.openAtStep`).
   *
   * Consumed once — a later session without an opening step starts at 0 again.
   */
  private _autoAdvanceToOpeningState(maxSteps: number = 300): void {
    const s = this.session();
    if (!s) return;
    const policy = this.activePolicy() || this.defaultPolicy();
    const openAt = this._openAtStep;
    this._openAtStep = 0;
    let stepped = 0;

    const run = () => {
      const st = this.state();
      if (!st) {
        this.loading.set(false);
        return;
      }
      const started = this._isAnyAgentMoving(st);
      const atOpening = st.elapsed_steps >= openAt;
      if ((started && atOpening) || st.episode_done || stepped >= maxSteps) {
        this.loading.set(false);
        this.refreshForecasts();
        return;
      }

      this.loading.set(true);
      this.api.step(s.id, policy, 1).subscribe({
        next: () => {
          stepped += 1;
          this.api.getState(s.id).subscribe({
            next: (nextState) => {
              this.state.set(nextState);
              this._recordTrajectory(nextState);
              run();
            },
            error: (e) => {
              this.error.set(`State failed: ${e.message}`);
              this.loading.set(false);
            },
          });
        },
        error: (e) => {
          this.error.set(`Auto-step failed: ${e.message}`);
          this.loading.set(false);
        },
      });
    };

    run();
  }

  newSession(opts: { width?: number; height?: number; agents?: number; maxSteps?: number; seed?: number; maxNumCities?: number; maxRailsBetweenCities?: number; maxRailPairsInCity?: number; latestDepartureMax?: number; speedProfile?: string; lineLength?: number; malfunctionRate?: number; malfunctionMinDuration?: number; malfunctionMaxDuration?: number; scenarioPolicyIds?: string[]; policyControlIds?: string[]; infrastructureScene?: unknown; scenarioPresetId?: string; disturbanceIds?: string[]; openAtStep?: number; playSpeedLevel?: number; secondsPerStep?: number | null; pinnedPolicy?: PolicyName; run?: SessionRunRef } = {}) {
    this.loading.set(true);
    this._openAtStep = Math.max(0, Math.floor(opts.openAtStep ?? 0));
    // Set here, not via setPlaySpeedLevel after createSession resolves: that call
    // takes the policy to restart playback under, but nothing is playing yet at
    // session start, and the policy this early is still the previous session's —
    // the Director's switch to `goal_directed` below hasn't happened yet either.
    if (opts.playSpeedLevel != null) this.playSpeedLevel.set(clampPlaySpeedLevel(opts.playSpeedLevel));
    // Every session sets it: one without a scenario pace goes back to the default.
    this.playSpeedBase.set(playSpeedBaseFor(opts.secondsPerStep));
    this.error.set(null);
    this.runError.set(null);
    this.message.set(null);
    this._stopPlayingOnServer();
    this.playing.set(false);
    this._resetTrajectories();
    this.coLearningFeedback.set([]);
    this.pendingStrategyReflection.set(null);
    this.impact.set([]);
    this.contentions.set([]);
    this.contentionForecast.set(null);
    this.contentionHorizonSteps.set(0);
    this.clearDecisionLog();
    this.reflectionRequested.set(false);
    // A new session is a new shift; an ended one must not carry over (a tour's
    // second shift would otherwise open straight on the debrief).
    this.shiftEnded.set(false);
    // Train handles belong to a session: a selection carried over would point
    // the panels at a train of another episode.
    this.selectedHandle.set(null);
    const payload: any = {};
    if (opts.width != null) payload.width = opts.width;
    if (opts.height != null) payload.height = opts.height;
    if (opts.agents != null) payload.number_of_agents = opts.agents;
    if (opts.maxSteps != null) payload.max_episode_steps = opts.maxSteps;
    if (opts.seed != null) payload.seed = opts.seed;
    if (opts.maxNumCities != null) payload.max_num_cities = opts.maxNumCities;
    if (opts.maxRailsBetweenCities != null) payload.max_rails_between_cities = opts.maxRailsBetweenCities;
    if (opts.maxRailPairsInCity != null) payload.max_rail_pairs_in_city = opts.maxRailPairsInCity;
    if (opts.latestDepartureMax != null) payload.latest_departure_max = opts.latestDepartureMax;
    if (opts.speedProfile != null) payload.speed_profile = opts.speedProfile;
    if (opts.lineLength != null) payload.line_length = opts.lineLength;
    if (opts.malfunctionRate != null) payload.malfunction_rate = opts.malfunctionRate;
    if (opts.malfunctionMinDuration != null) payload.malfunction_min_duration = opts.malfunctionMinDuration;
    if (opts.malfunctionMaxDuration != null) payload.malfunction_max_duration = opts.malfunctionMaxDuration;
    if (opts.scenarioPolicyIds != null) payload.enabled_scenario_policy_ids = opts.scenarioPolicyIds;
    if (opts.policyControlIds != null) payload.enabled_policy_ids = opts.policyControlIds;
    if (opts.infrastructureScene != null) payload.infrastructure_scene = opts.infrastructureScene;
    if (opts.scenarioPresetId != null) payload.scenario_preset_id = opts.scenarioPresetId;
    if (opts.disturbanceIds?.length) payload.disturbance_ids = opts.disturbanceIds;
    if (opts.run) {
      payload.run = { kind: opts.run.kind, id: opts.run.id, run_id: opts.run.runId, run_started_at: opts.run.runStartedAt };
    }
    const requestedScene = payload.infrastructure_scene as { id?: string; name?: string; cells?: unknown[]; agents?: unknown[] } | undefined;
    this.message.set(this.sessionInfo(opts.scenarioPresetId
      ? `Loading prebuilt scenario: ${opts.scenarioPresetId}`
      : requestedScene
      ? `Creating session from infrastructure: ${requestedScene.name || requestedScene.id || 'selected scene'} · sending ${requestedScene.cells?.length ?? 0} cells · ${requestedScene.agents?.length ?? 0} trains`
      : 'Creating session from random infrastructure'));
    // Only the latest request's session is taken: a guided run that resumes
    // after a submitted questionnaire asks for two in a row, and the first,
    // answered late, would put the store on the wrong leg's scenario. The
    // superseded session stays idle on the server.
    const request = ++this._createRequest;
    this.api.createSession(payload).subscribe({
      next: (s) => {
        if (request !== this._createRequest) return;
        this.session.set(s);
        const disturbed = s.disturbance_ids?.length
          ? ` · ${s.disturbance_ids.length} disturbance${s.disturbance_ids.length > 1 ? 's' : ''}`
          : '';
        this.message.set(this.sessionInfo(s.scenario_preset_id
          ? `Loaded scenario preset: ${s.scenario_preset_id} · ${s.width} × ${s.height} · ${s.num_agents} trains`
            + (s.has_plan ? ' · running the premade plan' : '') + disturbed
          : s.infrastructure_scene_id
          ? `Loaded infrastructure scene: ${s.infrastructure_scene_id}`
          : 'Loaded random infrastructure'));
        if (opts.scenarioPolicyIds != null) {
          this.setEnabledScenarioPolicyIds(opts.scenarioPolicyIds);
        }
        if (opts.policyControlIds != null) {
          this.setEnabledControlPolicyIds(opts.policyControlIds);
        }
        // A planned scenario chooses its own policy: selecting it means "run
        // this plan", so the backend already put the session on the plan
        // policy and the signal only has to follow. Nothing to POST back.
        // The plan policy is hidden in the global /policies listing (it is
        // meaningless without a plan), so it also has to be added to the
        // session's control policies — otherwise the toolbar dropdown would
        // fall back to showing the first entry and claim the wrong driver.
        //
        // Director mode is the exception, and it has to be: there the AI
        // dispatches, and a session left on the premade plan never gives the
        // Director a plan of its own. Measured on `pf-ch-wn-wal-conflict`
        // through the Director-only tour: `/director/strategies` answered
        // `available: false` with "No committed plan yet — step under
        // 'goal_directed' first" for the whole run, so the strategy tiles had
        // nothing to show. The plan policy is registered in the dropdown
        // either way, so handing the trains back to the plan stays one click.
        if (s.has_plan && s.active_policy) {
          const policy = s.active_policy as PolicyName;
          if (!this.enabledControlPolicyIds().includes(policy)) {
            this.setEnabledControlPolicyIds([policy, ...this.enabledControlPolicyIds()]);
          }
          if (this.interactionMode() === 'director') {
            this._policyBeforeDirector = policy;
            this._applySessionPolicy('goal_directed');
          } else if (!opts.pinnedPolicy) {
            // A study condition that pins a policy runs it on every leg, a
            // planned one included; the plan stays one click away.
            this.setActivePolicy(policy);
          }
        } else if (this.interactionMode() === 'director'
            && this.activePolicy() !== 'goal_directed') {
          // A session born while Director mode is active runs under the
          // Director's planner from its first step — same coupling as
          // switching into the mode with a session already open.
          this._policyBeforeDirector = this.activePolicy();
          this._applySessionPolicy('goal_directed');
        }
        this.ws.connect(s.id);
        this.refreshState(true);
      },
      error: (e) => {
        if (request !== this._createRequest) return;
        this.error.set(`Create failed: ${e.message}`);
        this.loading.set(false);
      },
    });
  }
  private _createRequest = 0;

  /** One replayed state, handled as a live one: the map, and the Marey trajectories. */
  applyReplayState(state: SessionState): void {
    this.state.set(state);
    this._recordTrajectory(state);
    this.loading.set(false);
  }

  refreshState(autoAdvanceFirstAgent: boolean = false) {
    const s = this.session();
    if (!s) return;
    this.api.getState(s.id).subscribe({
      next: (st) => {
        this.state.set(st);
        if (autoAdvanceFirstAgent && st.infrastructure_scene_id && st.infrastructure_scene_diagnostics) {
          this.message.set(this.sessionInfo(this.formatInfrastructureLoadMessage(st)));
        }
        this._recordTrajectory(st);
        if (autoAdvanceFirstAgent) {
          this._autoAdvanceToOpeningState();
        } else {
          this.loading.set(false);
        }
      },
      error: (e) => {
        this.error.set(`State failed: ${e.message}`);
        this.loading.set(false);
      },
    });
  }

  private formatInfrastructureLoadMessage(st: SessionState): string {
    const diagnostics = st.infrastructure_scene_diagnostics;
    if (!diagnostics) {
      return `Loaded infrastructure scene: ${st.infrastructure_scene_id}`;
    }

    const mismatches = diagnostics.mismatched_cell_count ? ` · mismatches ${diagnostics.mismatched_cell_count}` : '';
    const unknown = diagnostics.unknown_tile_count ? ` · unknown tiles ${diagnostics.unknown_tile_count}` : '';
    return `Loaded infrastructure scene: ${st.infrastructure_scene_id} · cells ${diagnostics.rail_cell_count}/${diagnostics.scene_cell_count} · switches ${diagnostics.rail_switch_tile_count}/${diagnostics.scene_switch_count} · trains ${diagnostics.routable_agent_count}/${diagnostics.scene_agent_count}${mismatches}${unknown}`;
  }

  step(policy: PolicyName, n_steps: number = 1) {
    this._stepWithPolicy(policy, n_steps, true);
  }

  private _stepWithPolicy(policy: PolicyName, n_steps: number, canRecover: boolean) {
    const s = this.session();
    if (!s) return;
    if (this.episodeDone()) {
      this.message.set('Episode finished. Use Reset to start again.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    // Multi-step: remember the target so the toolbar can show 'N left'.
    const currentElapsed = this.state()?.elapsed_steps ?? 0;
    this.targetStep.set(currentElapsed + n_steps);
    this._stopPolling();
    this._stepSequential(s.id, policy, n_steps, canRecover);
  }

  private _stepSequential(sessionId: string, policy: PolicyName, remaining: number, canRecover: boolean): void {
    if (remaining <= 0) {
      this.targetStep.set(null);
      this.loading.set(false);
      this.refreshForecasts();
      return;
    }

    this.api.step(sessionId, policy, 1).subscribe({
      next: (res) => {
        if (res.message) this.message.set(res.message);
        this.api.getState(sessionId).subscribe({
          next: (st) => {
            this.state.set(st);
            this._recordTrajectory(st);
            if (st.episode_done) {
              this.targetStep.set(null);
              this.loading.set(false);
              this.refreshForecasts();
              return;
            }
            this._stepSequential(sessionId, policy, remaining - 1, false);
          },
          error: (e) => {
            this.error.set(`State failed: ${e.message}`);
            this.targetStep.set(null);
            this.loading.set(false);
          },
        });
      },
      error: (e) => {
        if (canRecover && this._isPolicyNotEnabledError(e)) {
          this._recoverPolicyAndRetryStep(sessionId, remaining);
          return;
        }
        this.error.set(`Step failed: ${e.message}`);
        this.targetStep.set(null);
        this.loading.set(false);
      },
    });
  }

  private _stopPolling(): void {
    if (this._pollHandle !== null) {
      clearInterval(this._pollHandle);
      this._pollHandle = null;
    }
  }

  /** The session being left stops on the server too: otherwise its play loop
   *  runs on unseen (e.g. every earlier leg of a guided condition, plan
   *  experiment-scenario-import.md §8), and the pause writes its trajectory
   *  to disk. Fire and forget, so a late answer cannot touch the next
   *  session's `playing`. */
  private _stopPlayingOnServer(): void {
    const s = this.session();
    if (s && this.playing()) this.api.pause(s.id).subscribe({ error: () => undefined });
  }

  /** End the current session and return to the welcome screen — without a full
   *  page reload. Tears down polling + WebSocket and clears session-derived
   *  state so `session()` becomes null (which shows the welcome view). */
  endSession(): void {
    this._stopPolling();
    this.ws.disconnect();
    this._stopPlayingOnServer();
    this.playing.set(false);
    this.loading.set(false);
    this.error.set(null);
    this.runError.set(null);
    this.message.set(null);
    this.targetStep.set(null);
    this.session.set(null);
    this.state.set(null);
    this.selectedHandle.set(null);
    this._resetTrajectories();
    this.impact.set([]);
    this.contentions.set([]);
    this.contentionForecast.set(null);
    this.contentionHorizonSteps.set(0);
    this.clearDecisionLog();
    this.scenarios.set([]);
    this.recommendations.set([]);
    this.notifications.set([]);
    this.coLearningFeedback.set([]);
    this.reflectionRequested.set(false);
    this.pendingStrategyReflection.set(null);
    this.previewScenarioId.set(null);
    this.whatIfPreview.set(null);
    this.directorPlanPaths.set(null);
    this.directorPlanHover.set(false);
    this.directorPreviewPaths.set(null);
    this.directorPreviewStrategyId.set(null);
    this.directorPreviewIsCommitted.set(false);
    this.directorPreviewIsFullPlan.set(false);
    this.directorFocusOutlook.set(null);
    this.directorNextDecision.set(null);
    this.directorAiWorkload.set(null);
    this.directorPreviewDivergence.set(null);
    this.directorHoverHandle.set(null);
    this.shiftEnded.set(false);
  }

  reset() {
    const s = this.session();
    if (!s) return;
    this.panResetTrigger.update((v) => v + 1);
    this.shiftEnded.set(false);
    this.loading.set(true);
    this.error.set(null);
    this.message.set(null);
    this.playing.set(false);
    this._resetTrajectories();
    this.coLearningFeedback.set([]);
    this.pendingStrategyReflection.set(null);
    this.impact.set([]);
    this.contentions.set([]);
    this.contentionForecast.set(null);
    this.contentionHorizonSteps.set(0);
    this.clearDecisionLog();
    this.reflectionRequested.set(false);
    this.api.reset(s.id).subscribe({
      next: () => this.refreshState(true),
      error: (e) => {
        this.error.set(`Reset failed: ${e.message}`);
        this.loading.set(false);
      },
    });
  }

  play(policy: PolicyName, speed: number = this.playSpeed()) {
    this._playWithPolicy(policy, speed, true);
  }

  /** Set the tempo level; while playing, the running loop picks it up. */
  setPlaySpeedLevel(level: number, policy: PolicyName) {
    this.playSpeedLevel.set(clampPlaySpeedLevel(level));
    if (this.playing()) this.play(policy);
  }

  private _playWithPolicy(policy: PolicyName, speed: number, canRecover: boolean) {
    const s = this.session();
    if (!s) return;
    if (this.episodeDone()) {
      this.message.set('Episode finished. Use Reset before Play.');
      return;
    }
    this.api.play(s.id, { speed, policy }).subscribe({
      next: () => {
        this.playing.set(true);
        this.error.set(null);
      },
      error: (e) => {
        if (canRecover && this._isPolicyNotEnabledError(e)) {
          this._recoverPolicyAndRetryPlay(s.id, speed);
          return;
        }
        this.error.set(`Play failed: ${e.message}`);
      },
    });
  }

  pause() {
    const s = this.session();
    if (!s) return;
    this.api.pause(s.id).subscribe({
      next: () => this.playing.set(false),
      error: (e) => this.error.set(`Pause failed: ${e.message}`),
    });
  }

  togglePlay(policy: PolicyName, speed: number = this.playSpeed()) {
    if (this.playing()) this.pause();
    else this.play(policy, speed);
  }

  toggleAgentSelection(handle: number) {
    // Single-select: clicking the same agent again deselects it,
    // clicking another swaps the selection.
    this.selectedHandle.set(
      this.selectedHandle() === handle ? null : handle,
    );
  }

  clearSelection() {
    this.selectedHandle.set(null);
  }

  // ========== Decision Override (T6) ==========

  readonly showDecisions = signal(true);
  readonly decisionVisible = signal<Set<number>>(new Set());

  isDecisionVisibleFor(handle: number): boolean {
    const perAgent = this.decisionVisible();
    if (perAgent.size === 0) return this.showDecisions();
    return perAgent.has(handle);
  }

  toggleDecisionFor(handle: number) {
    const cur = new Set(this.decisionVisible());
    if (cur.has(handle)) cur.delete(handle);
    else cur.add(handle);
    this.decisionVisible.set(cur);
  }

  toggleAllDecisions() {
    this.showDecisions.update((v) => !v);
    this.decisionVisible.set(new Set());
  }

  private _setLocalOverride(handle: number, action: number | null): void {
    this.state.update((st) => {
      if (!st) return st;

      return {
        ...st,
        agents: st.agents.map((a) =>
          a.handle === handle
            ? { ...a, override_action: action as any }
            : a,
        ),
      };
    });
  }

  /** Apply an override to one train.
   *
   *  Widgets should not call this directly — `TrainActionService` is the doorway
   *  (core/dispatch/train-action.service.ts). It carries the toggle rule and the
   *  `origin`, so acting is a visible dependency rather than a side effect of
   *  having the store injected for reading. */
  setOverride(
    handle: number,
    action: number,
    owner: DecisionOwner = 'human',
    origin?: ActionOrigin,
  ) {
    const s = this.session();
    if (!s) return;

    // Optimistic UI update: button reacts immediately.
    this._setLocalOverride(handle, action);

    const aiSuggestion = this._currentTopRecommendation();
    const simStep = this.elapsedSteps();
    const mode = this.interactionMode();
    const now = Date.now();

    // Co-Learning (WP 3.3): capture the human intervention so it can feed
    // the reflection panel (and, later, an actual learning loop).
    let coLearningTimestamp: number | null = null;
    if (this.isCoLearning()) {
      coLearningTimestamp = now;
      this.coLearningFeedback.update((list) => [
        ...list,
        {
          step: simStep,
          handle,
          humanAction: action,
          aiSuggestion,
          timestamp: now,
        },
      ]);
    }

    // Decision Log (Tile A2): capture every override in ALL modes (not just
    // Co-Learning). `owner` distinguishes a human click from the AI auto-decide
    // (countdown expiry). systemHold is logged separately (owner 'system').
    const decisionSeq = this._appendDecision({
      t: now,
      simStep,
      mode,
      handle,
      accountableOwner: owner,
      action: actionLabelFor(action),
      aiSuggestion,
      decisionTimeMs: owner === 'human' ? this._closeDecisionWindow(handle) : null,
      origin,
    });

    // Workstream B Tier 1 (deck slide 7): after a human override that deviated
    // from an AI suggestion (or any Co-Learning intervention), surface the
    // "why?" prompt. Suppressed for AI/system owners, in Director mode (its
    // sparser signal economy has its own, separate capture — Tier 2), and for
    // bare human clicks with no AI context to deviate from. The capture UI is
    // mode-specific; the pending state here is mode-agnostic.
    if (owner === 'human' && mode !== 'director' && (aiSuggestion != null || this.isCoLearning())) {
      this._askReflection({
        handle,
        action,
        mode,
        aiSuggestion,
        simStep,
        timestamp: now,
        context: this._snapshotRationaleContext(handle, aiSuggestion),
        decisionSeq,
        coLearningTimestamp,
      });
    }

    this.api.setOverride(s.id, handle, action as any).subscribe({
      next: () => {
        // Backend remains source of truth, but do not wait for it to make
        // the button look active.
        this.refreshState();
        this.refreshForecasts();
      },
      error: (e) => {
        this.error.set(`Set override failed: ${e.message}`);
        // Re-sync from backend if request failed.
        this.refreshState();
      },
    });
  }

  /** Localized blocking: the SYSTEM holds an affected train (STOP) while the
   *  rest of the network keeps running, until the human decides. Unlike
   *  setOverride this is NOT logged as a human intervention — it's the safe
   *  default that creates the decision moment, not the human's choice. */
  /**
   * Record a coordinated multi-train action — the public seam the Combined
   * Actions surfaces write through.
   *
   * `_appendDecision` stays private: every other decision in the log comes from
   * a store-owned choke-point (setOverride / clearOverride / systemHold), and
   * opening the raw append to components would let any surface write any shape.
   * This seam takes the coordinated shape and fills the schema fields itself,
   * so the two variants cannot drift apart in how they record the same kind of
   * decision.
   *
   * `handle: -1` follows the convention `action: 'strategy'` set: not about one
   * train, and the schema is not made to pretend otherwise.
   */
  recordCoordinatedAction(decision: CoordinatedDecision, decisionTimeMs: number | null = null): number {
    const modified =
      decision.appliedOrder.length !== decision.aiOrder.length ||
      decision.appliedOrder.some((train, i) => train !== decision.aiOrder[i]);
    return this._appendDecision({
      t: Date.now(),
      simStep: this.elapsedSteps(),
      mode: this.interactionMode(),
      handle: -1,
      accountableOwner: 'human',
      // The two values the schema reserved for accept-vs-override and never
      // wired: taking the AI's order is an acceptance, changing it is not.
      action: modified ? 'override' : 'accept',
      aiSuggestion: decision.label,
      decisionTimeMs,
      coordinated: decision,
    });
  }

  systemHold(handle: number) {
    const s = this.session();
    if (!s) return;
    this._setLocalOverride(handle, 4); // STOP_MOVING
    // Decision Log: a system safe-default hold is NOT a human intervention
    // (per the comment above) — tagged 'system' so the strip never lets an
    // operator mistake it for their own decision.
    this._appendDecision({
      t: Date.now(),
      simStep: this.elapsedSteps(),
      mode: this.interactionMode(),
      handle,
      accountableOwner: 'system',
      action: 'hold',
      aiSuggestion: null,
      decisionTimeMs: null,
    });
    this.api.setOverride(s.id, handle, 4 as any).subscribe({
      next: () => this.refreshState(),
      error: () => {},
    });
  }

  /** Release the standing override. Same note as `setOverride`: go through
   *  `TrainActionService`. */
  clearOverride(handle: number, owner: DecisionOwner = 'human', origin?: ActionOrigin) {
    const s = this.session();
    if (!s) return;

    // Optimistic UI update: release/clear reacts immediately.
    this._setLocalOverride(handle, null);

    // Decision Log (Tile A2): releasing a hold = the human decided to let the
    // train proceed. Logged as 'proceed' (owner 'human' by default).
    this._appendDecision({
      t: Date.now(),
      simStep: this.elapsedSteps(),
      mode: this.interactionMode(),
      handle,
      accountableOwner: owner,
      action: 'proceed',
      aiSuggestion: this._currentTopRecommendation(),
      decisionTimeMs: owner === 'human' ? this._closeDecisionWindow(handle) : null,
      origin,
    });

    this.api.clearOverride(s.id, handle).subscribe({
      next: () => {
        this.refreshState();
        this.refreshForecasts();
      },
      error: (e) => {
        this.error.set(`Clear override failed: ${e.message}`);
        this.refreshState();
      },
    });
  }

  /** Only the contentions forecast — cheap (memoised per step on the backend)
   *  and independent of the scenario rollouts, so a view that must keep its
   *  conflict picture current while the simulation plays (ZWL)
   *  can refresh it without triggering the heavier `refreshForecasts`. */
  refreshContentions(withTrajectories = false): void {
    const s = this.session();
    if (!s) return;
    this.api.getContentions(s.id, withTrajectories).subscribe({
      next: (resp) => {
        if (this.session()?.id !== s.id) return;
        this.contentions.set(resp.groups);
        this.contentionHorizonSteps.set(resp.horizonSteps);
        if (resp.trajectories) {
          this.contentionForecast.set({ step: this.state()?.elapsed_steps ?? 0, trajectories: resp.trajectories });
        }
      },
      error: () => {},
    });
  }

  /** The contentions branch's forecast course (asked for by the
   *  ZWL): cheap enough to refresh during play, unlike the
   *  scenario rollouts, and the same run the contentions come from. */
  readonly contentionForecast = signal<{ step: number; trajectories: NonNullable<ContentionsResponse['trajectories']> } | null>(null);

  refreshForecasts(): void {
    const s = this.session();
    if (!s) return;
    const kpi = this.kpiPriorities();
    this.api.getScenarios(s.id, kpi).subscribe({
      next: (scenarios) => this.scenarios.set(scenarios),
      error: () => {},
    });
    this.api.getRecommendations(s.id, kpi).subscribe({
      next: (recs) => this.recommendations.set(recs),
      error: () => {},
    });
    this.api.getImpact(s.id).subscribe({
      next: (items) => this.impact.set(items),
      error: () => {},
    });
    this.refreshContentions();
  }

  // ── Active policy (synced with backend session.policy) ────────
  private readonly _activePolicy = signal<PolicyName>('deadlock_avoidance');
  readonly activePolicy = computed<PolicyName>(() => this._activePolicy());

  setActivePolicy(policy: PolicyName): void {
    this._activePolicy.set(policy);
  }

  private _isPolicyNotEnabledError(err: any): boolean {
    const msg = String(err?.error?.detail ?? err?.message ?? '').toLowerCase();
    return msg.includes('not enabled');
  }

  private _recoverPolicyAndRetryStep(sessionId: string, n_steps: number): void {
    this.api.getScenarioPolicies(sessionId).subscribe({
      next: (cfg) => {
        const fallback = cfg.enabled_ids?.[0] as PolicyName | undefined;
        if (!fallback) {
          this.error.set('Step failed: no enabled policy available');
          this._stopPolling();
          this.targetStep.set(null);
          this.loading.set(false);
          return;
        }
        this.setActivePolicy(fallback);
        this._stepWithPolicy(fallback, n_steps, false);
      },
      error: () => {
        this.error.set('Step failed: unable to resolve enabled policies');
        this._stopPolling();
        this.targetStep.set(null);
        this.loading.set(false);
      },
    });
  }

  private _recoverPolicyAndRetryPlay(sessionId: string, speed: number): void {
    this.api.getScenarioPolicies(sessionId).subscribe({
      next: (cfg) => {
        const fallback = cfg.enabled_ids?.[0] as PolicyName | undefined;
        if (!fallback) {
          this.error.set('Play failed: no enabled policy available');
          return;
        }
        this.setActivePolicy(fallback);
        this._playWithPolicy(fallback, speed, false);
      },
      error: () => {
        this.error.set('Play failed: unable to resolve enabled policies');
      },
    });
  }

}
