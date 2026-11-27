import { TranslocoPipe } from '@jsverse/transloco';
import {
  Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, Input, OnDestroy, AfterViewInit,
  afterRenderEffect, computed, effect, inject, input, signal, untracked, viewChild,
} from '@angular/core';
import { SessionStore } from '../../core/session.store';
import { ApiService } from '../../core/api.service';
import { AgentColorService } from '../../core/agent-color.service';
import { TrainIdentityService } from '../../core/train-identity.service';
import { MINUTES_PER_STEP } from '../../core/combined-actions/combined-actions-preview';
import { CurrentDelayService } from '../../core/timetable/current-delay.service';
import { TrainActionService } from '../../core/dispatch/train-action.service';
import { SmoothClockService } from '../../core/motion/smooth-clock.service';
import { LanguageService } from '../../core/i18n/language.service';
import {
  columnAxis, contentionBand, delayMarks, onAxis, routeAxis, sectionName,
  type AxisModel, type CellPoint, type ContentionBand, type DelayMark, type LinePoint,
} from './zwl-axis';

/** Past steps kept on screen left of the now-line. */
const PAST_WINDOW_STEPS = 80;
/** Minimum future span right of the now-line, when the forecast is shorter. */
const MIN_FUTURE_STEPS = 20;
interface Gutters { left: number; right: number; top: number; bottom: number }
/** Time down, places across (SBB): minutes on the left; the slanted place
 *  names sit in a separate sticky header (`HEADER_H`) above the scrolling plot. */
const GUTTERS_TIME_VERTICAL: Gutters = { left: 44, right: 24, top: 10, bottom: 10 };
const HEADER_H = 84;
/** With time vertical the time axis has a fixed scale: the visible part of the
 *  plot shows this many steps, whatever the forecast's length, and the rest
 *  scrolls. Fitting the whole range into the panel instead squashed and
 *  stretched the diagram whenever the forecast changed
 *  (docs/plans/plan-b-small-changes.md, item 1). */
const STEPS_IN_VIEW = 60;
/** With time vertical the now-line stays this many steps below the top of the
 *  view, so most of the view shows the future, and the diagram scrolls up
 *  underneath it (docs/plans/plan-b-small-changes.md, item 1). */
const NOW_PAST_STEPS = 20;
/** Below this the panel is too short to show STEPS_IN_VIEW steps legibly. */
const MIN_TIME_VIEW_PX = 240;
/** Time across, places down (classic Marey): names on the left, minutes below. */
const GUTTERS_TIME_HORIZONTAL: Gutters = { left: 150, right: 16, top: 12, bottom: 26 };
/** Station names above the plot are slanted so neighbours don't collide. */
const STATION_LABEL_ANGLE = -45;
/** The station names' font (`.zwd__station`), for measuring how far a slanted
 *  name reaches to the right of its tick. */
const STATION_LABEL_FONT = '600 11px';

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Width of a station name in px; a rough estimate where no canvas exists. */
function stationLabelWidth(name: string): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement('canvas').getContext('2d');
      if (measureCtx) measureCtx.font = `${STATION_LABEL_FONT} ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`;
    } catch {
      measureCtx = null;
    }
  }
  return measureCtx ? measureCtx.measureText(name).width : name.length * 6.6;
}

type Orientation = 'time-vertical' | 'time-horizontal';
const ORIENTATION_KEY = 'zwd.orientation';

function readOrientation(): Orientation {
  try {
    return localStorage.getItem(ORIENTATION_KEY) === 'time-horizontal' ? 'time-horizontal' : 'time-vertical';
  } catch {
    return 'time-vertical';
  }
}

/** A contention of more trains than this is a merged chain, not one conflict. */
const BIG_GROUP_TRAINS = 4;
/** Such a ribbon is cut to this many axis cells around its first conflict point… */
const BIG_GROUP_SPAN_CELLS = 15;
/** …and to this many steps from now / from that conflict. */
const BIG_GROUP_NEAR_STEPS = 12;
/** Names listed on a ribbon or chip before "+N". */
const MAX_NAMES = 3;

/** While the simulation plays, re-ask the contentions forecast every this
 *  many steps (the store only refreshes it on discrete actions). */
const CONTENTION_REFRESH_STEPS = 3;
/** Minimum vertical distance between two station labels, px. */
const LABEL_MIN_GAP = 12;

interface TrainLine {
  handle: number;
  name: string;
  color: string;
  pastD: string;
  forecastD: string;
  /** The timetable (Soll), empty without a plan. */
  planD: string;
  /** Current delay suffix, e.g. "+5" (steps); '' when on time. */
  delay: string;
}

/** A train's name where its line crosses the now-line, just above it. */
interface NowLabel {
  x: number;
  y: number;
  anchor: 'start' | 'end';
}

interface PlacedDelay extends DelayMark {
  key: string;
  x: number;
  y: number;
  color: string;
  label: string;
  title: string;
}

interface DecisionPill {
  action: number;
  label: string;
  x: number;
  y: number;
  w: number;
  /** The override the operator has set on this train. */
  isOverride: boolean;
  /** What the running policy would play here (Recommendation mode only). */
  isRecommended: boolean;
}

interface DecisionGlyph {
  handle: number;
  name: string;
  color: string;
  /** Dotted lead from the train now to its next switch, on the axis. */
  leadD: string;
  cx: number;
  cy: number;
  kind: 'switch' | 'merge';
  pills: DecisionPill[];
}

interface PlacedBand extends ContentionBand {
  x: number;
  y: number;
  w: number;
  h: number;
  names: string;
  /** Minutes from now until the contention engages (0 once it has). */
  inMin: number;
  /** Partly or wholly outside the visible corridor/time range. */
  clipped: boolean;
  offView: boolean;
}

/**
 * ZWL (Zeit-Weg-Liniendiagramm, catalog B4, absorbs B2) — the time-distance diagram along a
 * named corridor, with the forecast contentions on it.
 *
 * Unlike the shipped `marey` widget, the axis is the corridor itself (the
 * scene's stations, see `zwl-axis.ts`), so selecting a different train
 * never changes it. Lines: executed history and the baseline forecast, both
 * solid. Contentions come from the existing `GET /hmi/contentions` forecast
 * (store.contentions) — the backend `conflict_detector` run on a no-override
 * branch — drawn as ribbons over the contended stretch and time.
 *
 * v1 is behaviourally identical in all three modes (spec §3, deliberate cut).
 */
@Component({
  selector: 'app-zwl',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './zwl.component.html',
  styleUrls: ['./zwl.component.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class ZwlComponent implements AfterViewInit, OnDestroy {
  @Input() embedded = false;
  /**
   * Decision pills: act on the selected train at its next switch, straight
   * from the diagram. A panel setting (`settings.decisionPills`, off unless a
   * layout turns it on), because acting in the diagram is powerful but pushes
   * the recommendation surfaces and the Co-Learning flow into the background
   * (spec §8.3, user decision 2026-09-25). Never in Director, whatever the
   * setting: there the AI owns actuation, as in the trains table and Combined
   * Actions.
   */
  readonly decisionPills = input(false);

  private readonly store = inject(SessionStore);
  private readonly colors = inject(AgentColorService);
  private readonly identity = inject(TrainIdentityService);
  private readonly api = inject(ApiService);
  private readonly i18n = inject(LanguageService);
  /** Acting goes through the dispatch seam, never straight to the store. */
  private readonly trainActions = inject(TrainActionService);

  private readonly host = viewChild<ElementRef<HTMLElement>>('plot');
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  /** Time vertical: the now-line stays NOW_PAST_STEPS steps below the top of
   *  the view and the diagram scrolls up underneath it, every step (and every
   *  animation frame of the smooth clock). Once the reader scrolls by hand the
   *  view stays where they put it; it follows again when they scroll the
   *  now-line back near its place or press "Zu jetzt" (`detached`). Before,
   *  the ZWL pulled the view back on each step, which read as a jump
   *  (docs/plans/plan-b-small-changes.md, item 1). Only a scroll by hand
   *  (wheel, touch, keys, the scroll bar) detaches: one the browser makes on
   *  its own, when the diagram gets shorter or the panel is resized, doesn't
   *  (F-5). */
  // After rendering, in the same frame: before it, a taller diagram isn't laid
  // out yet and the browser clips the scroll position to the old height; a
  // frame later, the diagram shows one frame at the old position (F-8).
  private readonly followNow = afterRenderEffect({
    write: () => {
      const y = this.nowLine().y1;
      this.svgH(); // the content's height changes where scrolling can reach
      const el = this.scroller()?.nativeElement;
      if (!el || !this.timeVertical() || this.detached()) return;
      untracked(() => {
        const target = this.nowScrollTop(y);
        if (Math.abs(el.scrollTop - target) < 1) return;
        el.scrollTop = target;
        this.ownScrollTop = el.scrollTop;
        this.handScroll = false;
      });
    },
  });
  /** Where this component last scrolled to, to tell its own scroll events
   *  from the reader's. */
  private ownScrollTop: number | null = null;
  /** The reader touched the scroller (wheel, touch, pointer, keys) since the
   *  view last followed: the scroll events that follow are theirs. */
  private handScroll = false;
  /** The reader scrolled away from the now-line; the view no longer follows. */
  readonly detached = signal(false);

  /** A detached view stays on the same steps. From step PAST_WINDOW_STEPS on,
   *  the time window starts later on every step and redraws the diagram one
   *  step higher, so the scroll position moves up by as much (F-1). */
  private lastDomainStart: number | null = null;
  private readonly keepDetachedView = afterRenderEffect({
    write: () => {
      const [start] = this.stepDomain();
      const prev = this.lastDomainStart;
      this.lastDomainStart = start;
      const el = this.scroller()?.nativeElement;
      if (prev === null || start === prev || !el || !this.timeVertical() || !untracked(this.detached)) return;
      untracked(() => {
        el.scrollTop = Math.max(0, el.scrollTop - (start - prev) * this.stepPx());
        this.ownScrollTop = el.scrollTop;
      });
    },
  });

  /** A new leg, session or orientation follows the now-line again (F-5). */
  private readonly resetDetached = effect(() => {
    this.orientation();
    this.store.session()?.id;
    untracked(() => {
      this.detached.set(false);
      this.handScroll = false;
    });
  });

  /** One step's height on the time axis (time vertical). */
  private stepPx(): number {
    const [a, b] = this.stepDomain();
    return this.timeAxisPx() / Math.max(1, b - a);
  }

  /** The scroll position that puts the now-line (plot y) NOW_PAST_STEPS steps
   *  below the top of the view. The sticky header covers the scroller's top
   *  HEADER_H pixels and sits above the plot in its content, so the two
   *  cancel out. */
  private nowScrollTop(y: number): number {
    return Math.max(0, Math.round(y - NOW_PAST_STEPS * this.stepPx()));
  }

  /** Wheel, touch, pointer or key on the scroller: the next scrolls are the reader's. */
  markHandScroll(): void {
    this.handScroll = true;
  }

  onScroll(): void {
    const el = this.scroller()?.nativeElement;
    if (!el || !this.timeVertical() || !this.handScroll) return;
    if (this.ownScrollTop !== null && Math.abs(el.scrollTop - this.ownScrollTop) < 1) return;
    this.ownScrollTop = null;
    // Back within two steps of its place counts as "follow again". Near the
    // end of the time axis the place may be out of reach: the furthest the
    // scroller gets counts as its place then.
    const reach = Math.max(0, el.scrollHeight - el.clientHeight);
    const off = Math.abs(el.scrollTop - Math.min(reach, this.nowScrollTop(this.nowLine().y1)));
    this.detached.set(off > 2 * this.stepPx());
  }

  followNowAgain(): void {
    this.detached.set(false);
  }
  private resizeObserver: ResizeObserver | null = null;
  readonly width = signal(800);
  readonly height = signal(360);

  /** Fit the axis to where the trains run (default) or show the whole line. */
  readonly wholeLine = signal(false);

  ngAfterViewInit(): void {
    const el = this.host()?.nativeElement;
    if (!el) return;
    this.resizeObserver = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      this.width.set(Math.max(320, Math.floor(r.width)));
      this.height.set(Math.max(200, Math.floor(r.height)));
    });
    this.resizeObserver.observe(el);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  // ── data ──────────────────────────────────────────────────────

  // ── axis: the scene's corridor (columns), or a chosen route A→B ────────

  /** The route chosen for this session when both ends are set (store signal,
   *  shared with the track map's "from here / to here"). */
  readonly route = computed(() => this.store.zwlRouteComplete());

  /** `GET /hmi/route-axis` for it — loaded by the store, so the map can
   *  highlight the same cells. */
  private readonly routeResp = computed(() => this.store.zwlRouteAxis());

  readonly axis = computed<AxisModel | null>(() => {
    const geo = this.store.geography();
    const resp = this.routeResp();
    if (this.route()) return resp && resp !== 'none' ? routeAxis(resp, geo) : null;
    return columnAxis(geo);
  });

  readonly routeUnreachable = computed(() => !!this.route() && this.routeResp() === 'none');

  /** Stations to pick from: one entry per code, portals read "towards …". */
  readonly routeOptions = computed(() => {
    const seen = new Map<string, { code: string; label: string; portal: boolean }>();
    for (const s of this.store.geography()?.stations ?? []) {
      const code = s.code ?? s.name;
      if (seen.has(code)) continue;
      const portal = s.kind === 'portal';
      seen.set(code, {
        code,
        label: portal ? this.i18n.t('zwd.route.towards', { name: s.name }) : s.name,
        portal,
      });
    }
    return [...seen.values()].sort((a, b) => Number(a.portal) - Number(b.portal) || a.label.localeCompare(b.label));
  });

  /** The pickers show the store's route, including a half-chosen one (an end
   *  picked on the track map while the other is still open). */
  private readonly rawRoute = computed(() => {
    const r = this.store.zwlRoute();
    return r && r.sessionId === this.store.session()?.id ? r : null;
  });
  readonly pickFrom = computed(() => this.rawRoute()?.from ?? '');
  readonly pickTo = computed(() => this.rawRoute()?.to ?? '');

  /** Options plus the current ends when they are cells rather than named
   *  places (picked on the map in an unnamed network). */
  readonly pickerOptions = computed(() => {
    const opts = this.routeOptions();
    const known = new Set(opts.map((o) => o.code));
    const extra = [this.pickFrom(), this.pickTo()]
      .filter((ref) => ref && !known.has(ref))
      .map((ref) => ({ code: ref, label: ref, portal: false }));
    return [...opts, ...extra];
  });

  setRouteEnd(end: 'from' | 'to', code: string): void {
    this.store.setZwlEnd(end, code);
  }

  swapRoute(): void {
    const r = this.rawRoute();
    if (!r) return;
    this.store.zwlRoute.set({ ...r, from: r.to, to: r.from });
  }

  clearRoute(): void {
    this.store.zwlRoute.set(null);
  }

  readonly now = computed(() => this.store.state()?.elapsed_steps ?? 0);
  /** Glides between steps while the run plays (smooth-playback item 2); only the now-line uses it. */
  private readonly smoothClock = inject(SmoothClockService);

  /** The timetable per handle (`GET /hmi/plan`), loaded once per session: it
   *  is the baseline and does not move, not even after an accepted replan. */
  /** The baseline timetable (Soll), shared with the track diagram's delay labels. */
  private readonly delaysNow = inject(CurrentDelayService);
  readonly plan = this.delaysNow.plan;

  /** Layer toggles (legend), presentation only. */
  readonly showPlan = signal(true);
  readonly showDelays = signal(true);
  readonly hasPlan = computed(() => this.plan().size > 0);

  /** Keep the conflict picture — and the forecast lines, which ride on the
   *  same branch — current during play: the store refreshes contentions only
   *  after discrete actions (step buttons, policy change), so a playing session
   *  would otherwise show a stale, usually empty, forecast. Throttled; the
   *  backend memoises per step. */
  private lastContentionStep = -Infinity;
  private readonly contentionRefresh = effect(() => {
    const now = this.now();
    const sid = this.store.session()?.id;
    if (!sid) return;
    untracked(() => {
      if (now < this.lastContentionStep || now - this.lastContentionStep >= CONTENTION_REFRESH_STEPS) {
        this.lastContentionStep = now;
        this.store.refreshContentions(true);
      }
    });
  });

  private readonly baselineForecast = computed(() => {
    const all = this.store.scenarios();
    return all.find((s) => s.isBaseline) ?? all[0] ?? null;
  });

  /** Per handle, as grid cells: executed points (dwells expanded to their end
   *  step) and the baseline forecast beyond now. */
  private readonly cellPoints = computed(() => {
    const now = this.now();
    const out = new Map<number, { past: CellPoint[]; forecast: CellPoint[] }>();
    for (const [h, traj] of this.store.trajectories()) {
      const past: CellPoint[] = [];
      for (const p of traj) {
        if (!p.position || p.step > now) continue;
        const [row, col] = [Number(p.position[0]), Number(p.position[1])];
        past.push({ step: p.step, row, col });
        const end = Math.min(p.endStep ?? p.step, now);
        if (end > p.step) past.push({ step: end, row, col });
      }
      past.sort((a, b) => a.step - b.step);
      out.set(h, { past, forecast: [] });
    }
    // Forecast: the contentions branch (refreshed every few steps, the run the
    // conflict ribbons come from); the scenario baseline only as a fallback —
    // on a large network it takes seconds and is not refreshed while playing.
    const branch = this.store.contentionForecast()?.trajectories;
    const fc: Record<string, { step: number; row: number; col: number }[]> =
      branch ?? this.baselineForecast()?.trajectories ?? {};
    for (const [key, traj] of Object.entries(fc)) {
      const h = Number(key);
      const entry = out.get(h) ?? { past: [], forecast: [] };
      entry.forecast = traj
        .filter((p) => p.step > now)
        .map((p) => ({ step: p.step, row: Number(p.row), col: Number(p.col) }))
        .sort((a, b) => a.step - b.step);
      out.set(h, entry);
    }
    return out;
  });

  /** The same points read on the current axis. */
  private readonly points = computed(() => {
    const axis = this.axis();
    const out = new Map<number, { past: LinePoint[]; forecast: LinePoint[] }>();
    if (!axis) return out;
    for (const [h, { past, forecast }] of this.cellPoints()) {
      out.set(h, { past: onAxis(axis, past), forecast: onAxis(axis, forecast) });
    }
    return out;
  });

  private readonly planOnAxis = computed(() => {
    const axis = this.axis();
    const out = new Map<number, LinePoint[]>();
    if (!axis) return out;
    for (const [h, run] of this.plan()) out.set(h, onAxis(axis, run));
    return out;
  });

  readonly bands = computed<ContentionBand[]>(() => {
    const axis = this.axis();
    if (!axis) return [];
    const now = this.now();
    return this.store.contentions().map((g) => {
      const band = contentionBand(g, axis);
      // The backend merges every overlapping conflict into one group, so a busy
      // corridor yields a single ribbon over the whole line and the whole
      // horizon. For such a group show only where it starts: the first stretch
      // around its first conflict point, in the near term.
      if (g.handles.length <= BIG_GROUP_TRAINS || band.fromPos == null || band.toPos == null) return band;
      const at = g.position ? axis.pos(Number(g.position[0]), Number(g.position[1])) : null;
      const centre = at ?? band.fromPos;
      return {
        ...band,
        fromPos: Math.max(band.fromPos, centre - BIG_GROUP_SPAN_CELLS),
        toPos: Math.min(band.toPos, centre + BIG_GROUP_SPAN_CELLS),
        fromStep: Math.max(band.fromStep, Math.min(g.step, now + BIG_GROUP_NEAR_STEPS)),
        toStep: Math.min(band.toStep, Math.max(g.step, now) + BIG_GROUP_NEAR_STEPS),
        merged: true,
      };
    });
  });

  // ── scales ────────────────────────────────────────────────────

  readonly posDomain = computed<[number, number]>(() => {
    const axis = this.axis();
    if (!axis || axis.ticks.length === 0) return [0, 1];
    const first = axis.ticks[0].pos;
    const last = axis.ticks[axis.ticks.length - 1].pos;
    if (this.wholeLine()) return [first, last];

    // Where the traffic runs, widened to the named place on either side.
    let lo = Infinity;
    let hi = -Infinity;
    const take = (p: LinePoint) => {
      if (p.pos == null) return;
      lo = Math.min(lo, p.pos);
      hi = Math.max(hi, p.pos);
    };
    for (const { past, forecast } of this.points().values()) {
      past.forEach(take);
      forecast.forEach(take);
    }
    for (const b of this.bands()) {
      if (b.fromPos == null || b.toPos == null) continue;
      lo = Math.min(lo, b.fromPos);
      hi = Math.max(hi, b.toPos);
    }
    if (!isFinite(lo)) return [first, last];
    const before = [...axis.ticks].reverse().find((t) => t.pos < lo)?.pos ?? first;
    const after = axis.ticks.find((t) => t.pos > hi)?.pos ?? last;
    return [Math.min(before, lo), Math.max(after, hi)];
  });

  readonly stepDomain = computed<[number, number]>(() => {
    const now = this.now();
    let end = now + MIN_FUTURE_STEPS;
    for (const { forecast } of this.points().values()) {
      const last = forecast[forecast.length - 1];
      if (last) end = Math.max(end, last.step);
    }
    for (const b of this.bands()) end = Math.max(end, b.toStep);
    if (this.showPlan()) {
      for (const run of this.planOnAxis().values()) {
        const last = run[run.length - 1];
        if (last && last.step >= now) end = Math.max(end, last.step);
      }
    }
    return [Math.max(0, now - PAST_WINDOW_STEPS), end + 2];
  });

  // ── orientation ───────────────────────────────────────────────
  // SBB convention (default): time runs down the vertical axis, the places
  // run west→east along the horizontal one. The other orientation (time
  // left→right, places top→bottom) is the classic Marey layout of the shipped
  // `marey` widget. Remembered per viewer; presentation only.

  readonly orientation = signal<Orientation>(readOrientation());
  readonly timeVertical = computed(() => this.orientation() === 'time-vertical');

  toggleOrientation(): void {
    const next: Orientation = this.timeVertical() ? 'time-horizontal' : 'time-vertical';
    this.orientation.set(next);
    try { localStorage.setItem(ORIENTATION_KEY, next); } catch { /* storage unavailable */ }
  }

  readonly gutter = computed(() => (this.timeVertical()
    ? { ...GUTTERS_TIME_VERTICAL, right: this.stationNamesRight() }
    : GUTTERS_TIME_HORIZONTAL));

  /** Time vertical: the slanted station names run up and to the right of their
   *  ticks, so the right gutter is as wide as the name nearest the right edge
   *  needs, or the header would cut it off (docs/plans/plan-b-small-changes.md,
   *  item 10). Positions map linearly onto the plot, so the gutter follows from
   *  the panel width without depending on itself. */
  readonly stationNamesRight = computed(() => {
    const base = GUTTERS_TIME_VERTICAL.right;
    const [lo, hi] = this.posDomain();
    const span = Math.max(1, hi - lo);
    const width = this.width();
    const left = GUTTERS_TIME_VERTICAL.left;
    const reach = Math.cos((STATION_LABEL_ANGLE * Math.PI) / 180);
    let right = base;
    for (const t of this.axis()?.ticks ?? []) {
      if (t.pos < lo || t.pos > hi) continue;
      const f = (t.pos - lo) / span;
      if (f <= 0) continue;
      // left + f * (width - left - right) + reach * w <= width - 2
      const need = (width - left) - (width - 2 - left - reach * stationLabelWidth(t.name)) / f;
      right = Math.max(right, Math.ceil(need));
    }
    return Math.min(right, Math.max(base, Math.floor(width / 3)));
  });
  readonly plotX0 = computed(() => this.gutter().left);
  readonly plotY0 = computed(() => this.gutter().top);
  readonly plotW = computed(() => Math.max(10, this.width() - this.gutter().left - this.gutter().right));
  /** Time vertical: the time axis's length at the fixed scale, STEPS_IN_VIEW
   *  steps per visible plot height. */
  readonly timeAxisPx = computed(() => {
    const g = this.gutter();
    const view = Math.max(MIN_TIME_VIEW_PX, this.height() - HEADER_H - g.top - g.bottom);
    const [a, b] = this.stepDomain();
    return Math.max(10, Math.round((view / STEPS_IN_VIEW) * Math.max(1, b - a)));
  });
  /** SVG height: the panel's; with time vertical as long as the time axis
   *  needs at its fixed scale, so the plot scrolls instead of squashing. */
  readonly svgH = computed(() => {
    const g = this.gutter();
    return this.timeVertical()
      ? Math.max(this.height() - HEADER_H, g.top + g.bottom + this.timeAxisPx())
      : this.height();
  });
  readonly plotH = computed(() => (this.timeVertical()
    ? this.timeAxisPx()
    : Math.max(10, this.svgH() - this.gutter().top - this.gutter().bottom)));

  /** Pixel position along the time axis (down, or right). */
  private timePos(step: number): number {
    const [a, b] = this.stepDomain();
    const f = (step - a) / Math.max(1, b - a);
    return this.timeVertical() ? this.plotY0() + f * this.plotH() : this.plotX0() + f * this.plotW();
  }

  /** Pixel position along the axis — its start first (left, or top): west
   *  for a corridor, the chosen `from` station for a route. */
  private placePos(pos: number): number {
    const [a, b] = this.posDomain();
    const f = (pos - a) / Math.max(1, b - a);
    return this.timeVertical() ? this.plotX0() + f * this.plotW() : this.plotY0() + f * this.plotH();
  }

  /** Screen point of (step, axis position). */
  private pt(step: number, pos: number): [number, number] {
    return this.timeVertical()
      ? [this.placePos(pos), this.timePos(step)]
      : [this.timePos(step), this.placePos(pos)];
  }

  // ── geometry ──────────────────────────────────────────────────

  readonly viewBox = computed(() => `0 0 ${this.width()} ${this.svgH()}`);
  readonly headerH = HEADER_H;

  /** A grid line across the plot, perpendicular to the axis it marks. */
  private across(pos: number, alongTime: boolean): { x1: number; y1: number; x2: number; y2: number } {
    // A line at a *place* runs parallel to the time axis, and vice versa.
    const vertical = this.timeVertical() ? !alongTime : alongTime;
    return vertical
      ? { x1: pos, x2: pos, y1: this.plotY0(), y2: this.plotY0() + this.plotH() }
      : { x1: this.plotX0(), x2: this.plotX0() + this.plotW(), y1: pos, y2: pos };
  }

  /** Ticks in view. Every tick keeps its grid line; a label is dropped when it
   *  would collide with one already placed — stations first, so a crowded run
   *  of track-less places (Mühlehorn … Mols) never hides a station name. With
   *  time vertical the names stand slanted above the plot. */
  readonly visibleTicks = computed(() => {
    const [lo, hi] = this.posDomain();
    const tv = this.timeVertical();
    const ticks = (this.axis()?.ticks ?? [])
      .filter((t) => t.pos >= lo && t.pos <= hi)
      .map((t) => {
        const px = this.placePos(t.pos);
        const lx = tv ? px : this.plotX0() - 8;
        const ly = tv ? HEADER_H - 6 : px + 4;
        return {
          ...t,
          px,
          ...this.across(px, false),
          lx,
          ly,
          transform: tv ? `rotate(${STATION_LABEL_ANGLE} ${lx} ${ly})` : null,
          anchor: tv ? 'start' : 'end',
          showLabel: false,
        };
      });
    const placed: number[] = [];
    for (const t of [...ticks].sort((a, b) => Number(b.major) - Number(a.major))) {
      if (placed.every((p) => Math.abs(p - t.px) >= LABEL_MIN_GAP)) {
        t.showLabel = true;
        placed.push(t.px);
      }
    }
    return ticks;
  });

  readonly singleTrackRect = computed(() => {
    const st = this.axis()?.singleTrack;
    if (!st) return null;
    const [lo, hi] = this.posDomain();
    if (st.toPos < lo || st.fromPos > hi) return null;
    const p1 = this.placePos(Math.max(st.fromPos, lo));
    const p2 = this.placePos(Math.min(st.toPos, hi));
    const len = Math.max(2, p2 - p1);
    return this.timeVertical()
      ? { x: p1, y: this.plotY0(), w: len, h: this.plotH(),
          lx: p1 + len / 2, ly: this.plotY0() + this.plotH() - 4, anchor: 'middle' }
      : { x: this.plotX0(), y: p1, w: this.plotW(), h: len,
          lx: this.plotX0() + this.plotW() - 4, ly: p1 + len / 2 + 3, anchor: 'end' };
  });

  readonly timeTicks = computed(() => {
    const [a, b] = this.stepDomain();
    const tv = this.timeVertical();
    const span = b - a;
    const every = span > 240 ? 60 : span > 120 ? 30 : span > 60 ? 10 : 5;
    const out: { key: number; x1: number; y1: number; x2: number; y2: number; lx: number; ly: number; anchor: string; label: string }[] = [];
    for (let s = Math.ceil(a / every) * every; s <= b; s += every) {
      const pos = this.timePos(s);
      out.push({
        key: s,
        ...this.across(pos, true),
        lx: tv ? this.plotX0() - 6 : pos,
        ly: tv ? pos + 3 : this.plotY0() + this.plotH() + 16,
        anchor: tv ? 'end' : 'middle',
        label: String(s * MINUTES_PER_STEP),
      });
    }
    return out;
  });

  /** The time axis's unit, written once (docs/plans/plan-b-small-changes.md,
   *  item 8). Time running down: in the sticky header, above the tick labels'
   *  column, so it doesn't scroll away with the plot (F-2). Time running
   *  across: left of the tick row, clear of the first tick's centred label
   *  (F-10). */
  readonly timeUnitLabel = computed(() => {
    const tv = this.timeVertical();
    return {
      x: this.plotX0() - (tv ? 6 : 18),
      // Time down: higher than the first station name's foot, which rises
      // to the right from the same corner.
      y: tv ? HEADER_H - 28 : this.plotY0() + this.plotH() + 16,
      text: this.i18n.t('zwd.timeUnit'),
    };
  });

  readonly nowLine = computed(() => {
    const pos = this.timePos(this.smoothClock.displayStep());
    const l = this.across(pos, true);
    return this.timeVertical()
      ? { ...l, lx: this.plotX0() + 3, ly: pos - 3 }
      : { ...l, lx: pos + 3, ly: this.plotY0() + 10 };
  });

  /** SVG path through the points; a point off the axis ends the current
   *  segment, so a train that leaves the route and comes back reads as two. */
  private pathD(pts: LinePoint[]): string {
    const out: string[] = [];
    let pen = false;
    for (const p of pts) {
      if (p.pos == null) {
        pen = false;
        continue;
      }
      const [x, y] = this.pt(p.step, p.pos);
      out.push(`${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`);
      pen = true;
    }
    return out.join(' ');
  }

  readonly lines = computed<TrainLine[]>(() => {
    const out: TrainLine[] = [];
    for (const [handle, { past, forecast }] of this.points()) {
      const lastPast = past[past.length - 1];
      // The forecast continues from the last executed point, so the two read as
      // one line that changes style at the now-line.
      const fc = lastPast && forecast.length > 0 ? [lastPast, ...forecast] : forecast;
      // A train that never touches the axis (another line of the network) is
      // not drawn at all.
      const lastOnAxis = (pts: LinePoint[]) => [...pts].reverse().find((p) => p.pos != null);
      const labelAt = lastOnAxis(fc) ?? lastOnAxis(past);
      if (!labelAt || labelAt.pos == null) continue;
      const planRun = this.planOnAxis().get(handle) ?? [];
      out.push({
        handle,
        name: this.identity.nameFor(handle),
        delay: this.delaysNow.label(handle),
        color: this.colors.getColorSolid(handle),
        pastD: this.pathD(past),
        forecastD: this.pathD(fc),
        planD: planRun.length > 1 ? this.pathD(planRun) : '',
      });
    }
    return out.sort((a, b) => a.handle - b.handle);
  });

  /** Each train's name sits where its line crosses the now-line, just above
   *  it, and moves with it (docs/plans/plan-b-small-changes.md, item 5). A
   *  train whose line doesn't reach the now-line (not departed yet, already
   *  arrived, or off this axis now) has no name. Kept apart from `lines`,
   *  which would otherwise rebuild every path on each animation frame. */
  readonly nowLabels = computed(() => {
    const out = new Map<number, NowLabel>();
    const now = this.now();
    const tv = this.timeVertical();
    const line = this.nowLine();
    const right = this.plotX0() + this.plotW();
    for (const [handle, { past, forecast }] of this.points()) {
      const last = past[past.length - 1];
      if (!last || last.pos == null) continue;
      if (forecast.length === 0 && last.step < now - 1) continue; // arrived
      const at = this.placePos(last.pos);
      if (tv) {
        const nearRight = at > right - 70;
        out.set(handle, { x: nearRight ? at - 4 : at + 4, y: line.y1 - 4, anchor: nearRight ? 'end' : 'start' });
      } else {
        out.set(handle, { x: line.x1 + 4, y: at - 4, anchor: 'start' });
      }
    }
    return out;
  });

  private bandNames(handles: number[]): string {
    const names = handles.map((h) => this.identity.nameFor(h));
    return names.length <= MAX_NAMES + 1
      ? names.join(' × ')
      : `${names.slice(0, MAX_NAMES).join(' × ')} +${names.length - MAX_NAMES}`;
  }

  readonly placedBands = computed<PlacedBand[]>(() => {
    const [c0, c1] = this.posDomain();
    const [s0, s1] = this.stepDomain();
    const now = this.now();
    return this.bands().map((b) => {
      const from = b.fromPos ?? 0;
      const to = b.toPos ?? 0;
      const offView = b.fromPos == null || to < c0 || from > c1 || b.toStep < s0 || b.fromStep > s1;
      const clipped = offView || from < c0 || to > c1 || b.fromStep < s0 || b.toStep > s1;
      // A one-cell window still needs a visible band: pad by half a cell.
      const [xa, ya] = this.pt(Math.max(b.fromStep, s0), Math.max(from, c0) - 0.5);
      const [xb, yb] = this.pt(Math.min(b.toStep, s1), Math.min(to, c1) + 0.5);
      return {
        ...b,
        x: Math.min(xa, xb),
        y: Math.min(ya, yb),
        w: Math.max(3, Math.abs(xb - xa)),
        h: Math.max(3, Math.abs(yb - ya)),
        names: this.bandNames(b.handles),
        inMin: Math.max(0, (b.fromStep - now) * MINUTES_PER_STEP),
        clipped,
        offView,
      };
    });
  });

  readonly delays = computed<DelayMark[]>(() => {
    const axis = this.axis();
    const plan = this.planOnAxis();
    if (!axis || plan.size === 0) return [];
    const out: DelayMark[] = [];
    for (const [handle, { past, forecast }] of this.points()) {
      const run = plan.get(handle);
      if (!run?.length) continue;
      out.push(...delayMarks(handle, axis, run, past, forecast, this.now()));
    }
    return out;
  });

  readonly placedDelays = computed<PlacedDelay[]>(() => {
    const [c0, c1] = this.posDomain();
    const [s0, s1] = this.stepDomain();
    return this.delays()
      .filter((d) => d.pos >= c0 && d.pos <= c1 && d.step >= s0 && d.step <= s1)
      .map((d) => {
        const [x, y] = this.pt(d.step, d.pos);
        const deltaMin = d.delta * MINUTES_PER_STEP;
        const delayMin = d.delay * MINUTES_PER_STEP;
        const axis = this.axis();
        const place = (axis && (d.live ? sectionName(axis, d.pos, d.pos) : axis.ticks.find((t) => t.code === d.place)?.name)) ?? '';
        return {
          ...d,
          key: `${d.handle}:${d.live ? 'live' : d.place}`,
          x,
          y,
          color: this.colors.getColorSolid(d.handle),
          label: `${deltaMin > 0 ? '+' : '−'}${Math.abs(deltaMin)}`,
          title: `${this.identity.nameFor(d.handle)} · ${place} · ${this.i18n.t('zwd.delaySteps', { n: `${delayMin > 0 ? '+' : ''}${delayMin}` })}`,
        };
      });
  });

  toggleLayer(layer: 'plan' | 'delays'): void {
    (layer === 'plan' ? this.showPlan : this.showDelays).update((v) => !v);
  }

  // ── decision pills (optional control layer, see `decisionPills`) ──────

  /** Mode behaviour of the pills — the one place this widget branches on mode:
   *  Recommendation marks the policy's choice, Co-Learning shows the options
   *  neutrally, Director never shows them. */
  readonly pillBehavior = computed(() => {
    const mode = this.store.interactionMode();
    return {
      show: this.decisionPills() && mode !== 'director',
      markRecommended: mode === 'recommendation',
    };
  });

  /** What the forecast has the train do at `cell`: 4 = stop, else the turn
   *  (1 left, 2 forward, 3 right) from its change of heading there. Read off
   *  the contentions branch, else the scenario baseline; null when neither
   *  reaches the cell. */
  private recommendedAt(handle: number, cell: [number, number]): number | null {
    const now = this.now();
    const branch = this.store.contentionForecast()?.trajectories?.[String(handle)];
    const traj = (branch ?? this.baselineForecast()?.trajectories?.[String(handle)] ?? [])
      .filter((p) => p.step >= now)
      .sort((a, b) => a.step - b.step) as { step: number; row: number; col: number; dir?: number }[];
    const i = traj.findIndex((p) => p.row === cell[0] && p.col === cell[1]);
    if (i < 0 || traj[i].dir == null) return null;
    // A train slower than one cell per step sits on a cell for several steps,
    // so "the next point" is the next *other* cell — reading the repeat as a
    // stop marked nothing for such trains. Staying on the switch to the end of
    // the forecast is the stop.
    const next = traj.slice(i + 1).find((p) => p.row !== cell[0] || p.col !== cell[1]);
    if (!next) return traj.length - i > 2 ? 4 : null;
    if (next.dir == null) return null;
    const delta = (next.dir - traj[i].dir! + 4) % 4;
    return delta === 0 ? 2 : delta === 1 ? 3 : delta === 3 ? 1 : null;
  }

  readonly decisionGlyph = computed<DecisionGlyph | null>(() => {
    if (!this.pillBehavior().show) return null;
    const axis = this.axis();
    const handle = this.store.selectedHandle();
    if (!axis || handle == null) return null;
    const agent = this.store.agents().find((a) => a.handle === handle);
    const nd = agent?.next_decision;
    if (!agent?.position || !nd) return null;
    const here = axis.pos(Number(agent.position[0]), Number(agent.position[1]));
    const at = axis.pos(nd.decision_position[0], nd.decision_position[1]);
    if (here == null || at == null) return null;

    // The switch lies `path.length` cells ahead: at one cell per step that is
    // when the train reaches it — so the glyph sits in the future, on the axis.
    const now = this.now();
    const [, s1] = this.stepDomain();
    const reach = Math.min(now + Math.max(1, nd.path.length), s1);
    const [ax, ay] = this.pt(now, here);
    const [cx, cy] = this.pt(reach, at);
    const recommended = this.pillBehavior().markRecommended
      ? this.recommendedAt(handle, nd.decision_position)
      : null;

    // Pills stacked beside the switch marker, inside the plot.
    const right = this.plotX0() + this.plotW();
    const pills: DecisionPill[] = [];
    let y = cy - 8;
    for (const o of nd.options) {
      const label = this.i18n.actionLabel(o);
      const w = 14 + label.length * 6.2;
      const x = cx + 10 + w > right ? cx - 10 - w : cx + 10;
      pills.push({
        action: o.action,
        label,
        x,
        y,
        w,
        isOverride: agent.override_action === o.action,
        isRecommended: recommended != null && o.action === recommended,
      });
      y += 18;
    }
    return {
      handle,
      name: this.identity.nameFor(handle),
      color: this.colors.getColorSolid(handle),
      leadD: `M${ax.toFixed(1)} ${ay.toFixed(1)} L${cx.toFixed(1)} ${cy.toFixed(1)}`,
      cx,
      cy,
      kind: nd.cell_type === 'SWITCH' ? 'switch' : 'merge',
      pills,
    };
  });

  onPillClick(handle: number, action: number): void {
    this.trainActions.toggle(handle, action, 'zug-weg');
  }

  readonly hasAxis = computed(() => !!this.axis());
  /** Named, but a network rather than one line (Olten): a route must be chosen. */
  readonly isNetwork = computed(() => this.store.geography()?.layout === 'network');
  /** The route pickers are offered wherever places are named. */
  readonly canPickRoute = computed(() => (this.store.geography()?.stations.length ?? 0) > 0);

  // ── interaction (presentation only, writes: view) ─────────────

  readonly hoveredBand = signal<string | null>(null);

  isHighlighted(handle: number): boolean {
    return this.store.notificationHoverHandles().has(handle) || this.store.selectedHandle() === handle;
  }

  onLineEnter(handle: number): void {
    this.store.setAgentHoverAgent(handle);
  }

  onBandEnter(b: PlacedBand): void {
    this.hoveredBand.set(b.key);
    this.store.setAgentHoverAgents(b.handles);
  }

  onLeave(): void {
    this.hoveredBand.set(null);
    this.store.clearAgentHoverAgents();
  }

  onLineClick(handle: number): void {
    this.store.selectedHandle.set(this.store.selectedHandle() === handle ? null : handle);
  }

  toggleWholeLine(): void {
    this.wholeLine.update((v) => !v);
  }
}
