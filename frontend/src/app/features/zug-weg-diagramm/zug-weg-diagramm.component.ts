import { TranslocoPipe } from '@jsverse/transloco';
import {
  Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, Input, OnDestroy, AfterViewInit,
  computed, effect, inject, signal, untracked, viewChild,
} from '@angular/core';
import { SessionStore } from '../../core/session.store';
import { ApiService } from '../../core/api.service';
import { AgentColorService } from '../../core/agent-color.service';
import { TrainIdentityService } from '../../core/train-identity.service';
import { MINUTES_PER_STEP } from '../../core/combined-actions/combined-actions-preview';
import {
  buildCorridorAxis, contentionBand, delayMarks, sectionName, type ContentionBand, type CorridorAxis, type DelayMark, type LinePoint,
} from './zug-weg-axis';

/** Past steps kept on screen left of the now-line. */
const PAST_WINDOW_STEPS = 80;
/** Minimum future span right of the now-line, when the forecast is shorter. */
const MIN_FUTURE_STEPS = 20;
interface Gutters { left: number; right: number; top: number; bottom: number }
/** Time down, places across (SBB): minutes on the left; the slanted place
 *  names sit in a separate sticky header (`HEADER_H`) above the scrolling plot. */
const GUTTERS_TIME_VERTICAL: Gutters = { left: 44, right: 24, top: 10, bottom: 10 };
const HEADER_H = 84;
/** With time vertical the plot keeps at least this much time axis and scrolls
 *  rather than squeezing 100 steps into a short panel. */
const MIN_TIME_AXIS_PX = 300;
/** Time across, places down (classic Marey): names on the left, minutes below. */
const GUTTERS_TIME_HORIZONTAL: Gutters = { left: 150, right: 16, top: 12, bottom: 26 };
/** Station names above the plot are slanted so neighbours don't collide. */
const STATION_LABEL_ANGLE = -45;

type Orientation = 'time-vertical' | 'time-horizontal';
const ORIENTATION_KEY = 'zwd.orientation';

function readOrientation(): Orientation {
  try {
    return localStorage.getItem(ORIENTATION_KEY) === 'time-horizontal' ? 'time-horizontal' : 'time-vertical';
  } catch {
    return 'time-vertical';
  }
}

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
  labelX: number;
  labelY: number;
  labelAnchor: 'start' | 'end';
}

interface PlacedDelay extends DelayMark {
  key: string;
  x: number;
  y: number;
  color: string;
  label: string;
  title: string;
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
 * Zug-Weg-Diagramm (catalog B4, absorbs B2) — the time-distance diagram along a
 * named corridor, with the forecast contentions on it.
 *
 * Unlike the shipped `marey` widget, the axis is the corridor itself (the
 * scene's stations, see `zug-weg-axis.ts`), so selecting a different train
 * never changes it. Lines: executed history solid, the baseline forecast
 * dashed. Contentions come from the existing `GET /hmi/contentions` forecast
 * (store.contentions) — the backend `conflict_detector` run on a no-override
 * branch — drawn as ribbons over the contended stretch and time.
 *
 * v1 is behaviourally identical in all three modes (spec §3, deliberate cut).
 */
@Component({
  selector: 'app-zug-weg-diagramm',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './zug-weg-diagramm.component.html',
  styleUrls: ['./zug-weg-diagramm.component.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class ZugWegDiagrammComponent implements AfterViewInit, OnDestroy {
  @Input() embedded = false;

  private readonly store = inject(SessionStore);
  private readonly colors = inject(AgentColorService);
  private readonly identity = inject(TrainIdentityService);
  private readonly api = inject(ApiService);

  private readonly host = viewChild<ElementRef<HTMLElement>>('plot');
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  /** Keep the now-line on screen while the plot scrolls (time vertical): only
   *  when it has left the visible part, so a reader scrolling back in time is
   *  not yanked away on every step. */
  private readonly followNow = effect(() => {
    const y = this.nowLine().y1;
    const el = this.scroller()?.nativeElement;
    if (!el || !this.timeVertical()) return;
    untracked(() => {
      // The sticky header sits above the plot in the scroller's content and
      // covers its top HEADER_H pixels of the viewport.
      const contentY = HEADER_H + y;
      const visibleTop = el.scrollTop + HEADER_H;
      const visibleBottom = el.scrollTop + el.clientHeight - 16;
      if (contentY < visibleTop || contentY > visibleBottom) {
        el.scrollTop = Math.max(0, y - (el.clientHeight - HEADER_H) / 3);
      }
    });
  });
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

  readonly axis = computed<CorridorAxis | null>(() => buildCorridorAxis(this.store.geography()));

  readonly now = computed(() => this.store.state()?.elapsed_steps ?? 0);

  /** The timetable per handle (`GET /hmi/plan`), loaded once per session: it
   *  is the baseline and does not move, not even after an accepted replan. */
  readonly plan = signal<Map<number, LinePoint[]>>(new Map());
  private planSession: string | null = null;
  private readonly planLoad = effect(() => {
    const sid = this.store.session()?.id ?? null;
    untracked(() => {
      if (sid === this.planSession) return;
      this.planSession = sid;
      this.plan.set(new Map());
      if (!sid) return;
      this.api.getPlan(sid).subscribe({
        next: (resp) => {
          if (this.planSession !== sid) return;
          const m = new Map<number, LinePoint[]>();
          for (const [h, run] of Object.entries(resp.trainruns ?? {})) {
            m.set(Number(h), run.map((e) => ({ step: e.step, col: e.col })));
          }
          this.plan.set(m);
        },
        error: () => {},
      });
    });
  });

  /** Layer toggles (legend), presentation only. */
  readonly showPlan = signal(true);
  readonly showDelays = signal(true);
  readonly hasPlan = computed(() => this.plan().size > 0);

  /** Keep the conflict picture current during play: the store refreshes
   *  contentions only after discrete actions (step buttons, policy change),
   *  so a playing session would otherwise show a stale — usually empty —
   *  forecast. Throttled; the backend memoises per step. */
  private lastContentionStep = -Infinity;
  private readonly contentionRefresh = effect(() => {
    const now = this.now();
    const sid = this.store.session()?.id;
    if (!sid) return;
    untracked(() => {
      if (now < this.lastContentionStep || now - this.lastContentionStep >= CONTENTION_REFRESH_STEPS) {
        this.lastContentionStep = now;
        this.store.refreshContentions();
      }
    });
  });

  private readonly baselineForecast = computed(() => {
    const all = this.store.scenarios();
    return all.find((s) => s.isBaseline) ?? all[0] ?? null;
  });

  /** Per handle: executed points (dwells expanded to their end step) and the
   *  baseline forecast beyond now. Column only — rows are parallel tracks. */
  private readonly points = computed(() => {
    const now = this.now();
    const out = new Map<number, { past: LinePoint[]; forecast: LinePoint[] }>();
    for (const [h, traj] of this.store.trajectories()) {
      const past: LinePoint[] = [];
      for (const p of traj) {
        if (!p.position || p.step > now) continue;
        const col = Number(p.position[1]);
        past.push({ step: p.step, col });
        const end = Math.min(p.endStep ?? p.step, now);
        if (end > p.step) past.push({ step: end, col });
      }
      past.sort((a, b) => a.step - b.step);
      out.set(h, { past, forecast: [] });
    }
    const fc = this.baselineForecast()?.trajectories ?? {};
    for (const [key, traj] of Object.entries(fc)) {
      const h = Number(key);
      const entry = out.get(h) ?? { past: [], forecast: [] };
      entry.forecast = traj
        .filter((p) => p.step > now)
        .map((p) => ({ step: p.step, col: Number(p.col) }))
        .sort((a, b) => a.step - b.step);
      out.set(h, entry);
    }
    return out;
  });

  readonly bands = computed<ContentionBand[]>(() => {
    const axis = this.axis();
    if (!axis) return [];
    return this.store.contentions()
      .map((g) => contentionBand(g, axis))
      .filter((b): b is ContentionBand => !!b);
  });

  // ── scales ────────────────────────────────────────────────────

  readonly colDomain = computed<[number, number]>(() => {
    const axis = this.axis();
    if (!axis || axis.ticks.length === 0) return [0, 1];
    const first = axis.ticks[0].col;
    const last = axis.ticks[axis.ticks.length - 1].col;
    if (this.wholeLine()) return [first, last];

    // Where the traffic runs, widened to the named place on either side.
    let lo = Infinity;
    let hi = -Infinity;
    for (const { past, forecast } of this.points().values()) {
      for (const p of past) { lo = Math.min(lo, p.col); hi = Math.max(hi, p.col); }
      for (const p of forecast) { lo = Math.min(lo, p.col); hi = Math.max(hi, p.col); }
    }
    for (const b of this.bands()) { lo = Math.min(lo, b.fromCol); hi = Math.max(hi, b.toCol); }
    if (!isFinite(lo)) return [first, last];
    const before = [...axis.ticks].reverse().find((t) => t.col < lo)?.col ?? first;
    const after = axis.ticks.find((t) => t.col > hi)?.col ?? last;
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
      for (const run of this.plan().values()) {
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

  readonly gutter = computed(() => (this.timeVertical() ? GUTTERS_TIME_VERTICAL : GUTTERS_TIME_HORIZONTAL));
  readonly plotX0 = computed(() => this.gutter().left);
  readonly plotY0 = computed(() => this.gutter().top);
  readonly plotW = computed(() => Math.max(10, this.width() - this.gutter().left - this.gutter().right));
  /** SVG height: the panel's, or taller when time runs vertically and the
   *  panel is short — the plot area then scrolls. */
  readonly svgH = computed(() => {
    const g = this.gutter();
    return this.timeVertical()
      ? Math.max(this.height() - HEADER_H, g.top + g.bottom + MIN_TIME_AXIS_PX)
      : this.height();
  });
  readonly plotH = computed(() => Math.max(10, this.svgH() - this.gutter().top - this.gutter().bottom));

  /** Pixel position along the time axis (down, or right). */
  private timePos(step: number): number {
    const [a, b] = this.stepDomain();
    const f = (step - a) / Math.max(1, b - a);
    return this.timeVertical() ? this.plotY0() + f * this.plotH() : this.plotX0() + f * this.plotW();
  }

  /** Pixel position along the corridor — west first (left, or top), the
   *  reading order of the scene. */
  private placePos(col: number): number {
    const [a, b] = this.colDomain();
    const f = (col - a) / Math.max(1, b - a);
    return this.timeVertical() ? this.plotX0() + f * this.plotW() : this.plotY0() + f * this.plotH();
  }

  /** Screen point of (step, column). */
  private pt(step: number, col: number): [number, number] {
    return this.timeVertical()
      ? [this.placePos(col), this.timePos(step)]
      : [this.timePos(step), this.placePos(col)];
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
    const [lo, hi] = this.colDomain();
    const tv = this.timeVertical();
    const ticks = (this.axis()?.ticks ?? [])
      .filter((t) => t.col >= lo && t.col <= hi)
      .map((t) => {
        const pos = this.placePos(t.col);
        const lx = tv ? pos : this.plotX0() - 8;
        const ly = tv ? HEADER_H - 6 : pos + 4;
        return {
          ...t,
          pos,
          ...this.across(pos, false),
          lx,
          ly,
          transform: tv ? `rotate(${STATION_LABEL_ANGLE} ${lx} ${ly})` : null,
          anchor: tv ? 'start' : 'end',
          showLabel: false,
        };
      });
    const placed: number[] = [];
    for (const t of [...ticks].sort((a, b) => Number(b.major) - Number(a.major))) {
      if (placed.every((p) => Math.abs(p - t.pos) >= LABEL_MIN_GAP)) {
        t.showLabel = true;
        placed.push(t.pos);
      }
    }
    return ticks;
  });

  readonly singleTrackRect = computed(() => {
    const st = this.axis()?.singleTrack;
    if (!st) return null;
    const [lo, hi] = this.colDomain();
    if (st.toCol < lo || st.fromCol > hi) return null;
    const p1 = this.placePos(Math.max(st.fromCol, lo));
    const p2 = this.placePos(Math.min(st.toCol, hi));
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
        label: `${s * MINUTES_PER_STEP}′`,
      });
    }
    return out;
  });

  readonly nowLine = computed(() => {
    const pos = this.timePos(this.now());
    const l = this.across(pos, true);
    return this.timeVertical()
      ? { ...l, lx: this.plotX0() + 3, ly: pos - 3 }
      : { ...l, lx: pos + 3, ly: this.plotY0() + 10 };
  });

  private pathD(pts: LinePoint[]): string {
    return pts.map((p, i) => {
      const [x, y] = this.pt(p.step, p.col);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  }

  readonly lines = computed<TrainLine[]>(() => {
    const out: TrainLine[] = [];
    const right = this.plotX0() + this.plotW();
    const bottom = this.plotY0() + this.plotH();
    for (const [handle, { past, forecast }] of this.points()) {
      if (past.length === 0 && forecast.length === 0) continue;
      const lastPast = past[past.length - 1];
      // The forecast continues from the last executed point, so the two read as
      // one line that changes style at the now-line.
      const fc = lastPast && forecast.length > 0 ? [lastPast, ...forecast] : forecast;
      const labelAt = fc[fc.length - 1] ?? lastPast;
      const planRun = this.plan().get(handle) ?? [];
      const [ex, ey] = this.pt(labelAt.step, labelAt.col);
      // Near the right/bottom edge the name goes inside the plot, not off it.
      const nearRight = ex > right - 70;
      const nearBottom = ey > bottom - 14;
      out.push({
        handle,
        name: this.identity.nameFor(handle),
        color: this.colors.getColorSolid(handle),
        pastD: this.pathD(past),
        forecastD: this.pathD(fc),
        planD: planRun.length > 1 ? this.pathD(planRun) : '',
        labelX: nearRight ? ex - 4 : ex + 4,
        labelAnchor: nearRight ? 'end' : 'start',
        labelY: this.timeVertical() && !nearBottom ? ey + 12 : ey - 4,
      });
    }
    return out.sort((a, b) => a.handle - b.handle);
  });

  readonly placedBands = computed<PlacedBand[]>(() => {
    const [c0, c1] = this.colDomain();
    const [s0, s1] = this.stepDomain();
    const now = this.now();
    return this.bands().map((b) => {
      const offView = b.toCol < c0 || b.fromCol > c1 || b.toStep < s0 || b.fromStep > s1;
      const clipped = offView || b.fromCol < c0 || b.toCol > c1 || b.fromStep < s0 || b.toStep > s1;
      // A one-cell window still needs a visible band: pad by half a cell.
      const [xa, ya] = this.pt(Math.max(b.fromStep, s0), Math.max(b.fromCol, c0) - 0.5);
      const [xb, yb] = this.pt(Math.min(b.toStep, s1), Math.min(b.toCol, c1) + 0.5);
      return {
        ...b,
        x: Math.min(xa, xb),
        y: Math.min(ya, yb),
        w: Math.max(3, Math.abs(xb - xa)),
        h: Math.max(3, Math.abs(yb - ya)),
        names: b.handles.map((h) => this.identity.nameFor(h)).join(' × '),
        inMin: Math.max(0, (b.fromStep - now) * MINUTES_PER_STEP),
        clipped,
        offView,
      };
    });
  });

  readonly delays = computed<DelayMark[]>(() => {
    const axis = this.axis();
    const plan = this.plan();
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
    const [c0, c1] = this.colDomain();
    const [s0, s1] = this.stepDomain();
    return this.delays()
      .filter((d) => d.col >= c0 && d.col <= c1 && d.step >= s0 && d.step <= s1)
      .map((d) => {
        const [x, y] = this.pt(d.step, d.col);
        const deltaMin = d.delta * MINUTES_PER_STEP;
        const delayMin = d.delay * MINUTES_PER_STEP;
        const axis = this.axis();
        const place = (axis && (d.live ? sectionName(axis, d.col, d.col) : axis.ticks.find((t) => t.col === d.col)?.name)) ?? '';
        return {
          ...d,
          key: `${d.handle}:${d.live ? 'live' : d.col}`,
          x,
          y,
          color: this.colors.getColorSolid(d.handle),
          label: `${deltaMin > 0 ? '+' : '−'}${Math.abs(deltaMin)}′`,
          title: `${this.identity.nameFor(d.handle)} · ${place} · ${delayMin > 0 ? '+' : ''}${delayMin}′`,
        };
      });
  });

  toggleLayer(layer: 'plan' | 'delays'): void {
    (layer === 'plan' ? this.showPlan : this.showDelays).update((v) => !v);
  }

  readonly hasAxis = computed(() => !!this.axis());
  /** Named, but a network rather than one line (Olten): different empty state. */
  readonly isNetwork = computed(() => this.store.geography()?.layout === 'network');

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
