import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { SessionStore } from '../session.store';
import { OperatorModelService } from '../operator-model.service';
import { Lang, LanguageService } from '../i18n/language.service';
import { InteractionMode } from '../events/event-types';
import { ModeIntro } from './mode-intro-configs';
import { TourBriefing } from './tour-briefings';
import { SandboxOutcome } from './sandbox-replay';

/** One finished shift of a multi-shift tour (advanced Co-Learning, WP4). */
export interface ShiftRecord {
  /** 0-based leg of the tour. */
  leg: number;
  /** The shift's session — its sandbox checkpoints stay playable for the rule check. */
  sessionId: string | null;
  /** The run as played, to the end of the episode (`GET /sandbox`), or null
   *  when the sandbox could not be read. */
  played: SandboxOutcome | null;
  /** The person's decisions on single trains, in order. */
  decisions: { handle: number; action: string; simStep: number; decisionTimeMs: number | null }[];
  /** Hypotheses confirmed as rules in this shift. */
  rules: string[];
  /** A rule from an earlier shift that fitted this shift's situation, and
   *  whether the person then decided as it says. */
  ruleApplied: { hypothesis: string; followed: boolean } | null;
}

/**
 * The running tour's briefing, for surfaces outside the tour pages: the mode
 * intro, the Co-Learning module badges on panels, the map fit. Everything here
 * is gated on `demoActive`, so experiments and free sessions never see it.
 */
@Injectable({ providedIn: 'root' })
export class TourContextService {
  private readonly store = inject(SessionStore);
  private readonly _briefing = signal<TourBriefing | null>(null);

  private readonly _tourFocusCols = signal<[number, number] | null>(null);
  /** An experiment condition's range — experiments are not tours, so this one
   *  is not gated on `demoActive`; it is set per experiment and cleared after. */
  private readonly _experimentFocusCols = signal<[number, number] | null>(null);

  readonly briefing = computed(() => (this.store.demoActive() ? this._briefing() : null));
  /** The briefing's range where it has one, else the tour's. A tour can pin a long
   *  corridor without carrying a whole briefing just to say where to look. */
  readonly mapFocusCols = computed(() =>
    this.briefing()?.mapFocusCols
    ?? (this.store.demoActive() ? this._tourFocusCols() : null)
    ?? this._experimentFocusCols(),
  );
  readonly hasDebrief = computed(() => !!this.briefing()?.debrief);
  /** null means all three debrief sections — see TourBriefing.debriefSections. */
  readonly debriefSections = computed(() => this.briefing()?.debriefSections ?? null);
  /** The debrief's Event Simulation is played from a checkpoint, not precomputed. */
  readonly liveSandbox = computed(() => this.briefing()?.sandbox === 'live');
  readonly reasonDialog = computed(() => !!this.briefing()?.reasonDialog);
  /** Impact panel shows the assessment only; the options live in the proposals panel. */
  readonly assessmentOnly = computed(() => !!this.briefing()?.assessmentOnly);
  /** Name the trains on the map and enlarge their click targets. */
  readonly mapTrainLabels = computed(() => !!this.briefing()?.mapTrainLabels);
  /** Starting the scenario from the mode intro also starts the run. */
  readonly autoStart = computed(() => !!this.briefing()?.autoStart);

  private readonly operatorModel = inject(OperatorModelService);
  private operatorIdBeforeTour: string | null = null;
  private readonly language = inject(LanguageService);
  private langBeforeTour: Lang | null = null;

  /**
   * The tour's closing page is open. It shows after the demo has ended, so the
   * gated `briefing` is already null there; the tour's language has to hold
   * until that page is left, or the page would sit in a shell of another language.
   */
  readonly closingOpen = signal(false);

  constructor() {
    // A tour may open the Zug-Weg-Diagramm on a given section; set it for each
    // session the tour creates (one per mode), leaving later changes alone.
    let routedSession: string | null = null;
    effect(() => {
      const route = this.briefing()?.zugWegRoute;
      const sid = this.store.session()?.id ?? null;
      untracked(() => {
        if (!route || !sid || sid === routedSession) return;
        routedSession = sid;
        this.store.zugWegRoute.set({ sessionId: sid, from: route.from, to: route.to });
      });
    });

    effect(() => {
      this.store.session()?.id;
      untracked(() => this.shiftStartedAt.set(Date.now()));
    });

    // The "why?" context of the running tour; experiments keep the default.
    effect(() => {
      const source = this.briefing()?.learningContext ?? 'scenario';
      untracked(() => this.store.rationaleContextSource.set(source));
    });

    // The operator model keys preferences by operator id, not by session. A tour
    // that asks for it runs under its own id and hands the previous one back
    // when the tour ends.
    effect(() => {
      const fresh = !!this.briefing()?.freshOperatorProfile;
      untracked(() => {
        if (fresh && this.operatorIdBeforeTour === null) {
          this.operatorIdBeforeTour = this.operatorModel.operatorId();
          this.operatorModel.operatorId.set(`interview-${Date.now()}`);
        } else if (!fresh && this.operatorIdBeforeTour !== null) {
          this.operatorModel.operatorId.set(this.operatorIdBeforeTour);
          this.operatorIdBeforeTour = null;
        }
      });
    });

    // Same swap for the app language: a tour that names one runs in it, and the
    // operator's own choice comes back afterwards.
    effect(() => {
      const wanted =
        (this.briefing() ?? (this.closingOpen() ? this._briefing() : null))?.language ?? null;
      untracked(() => {
        if (wanted && this.langBeforeTour === null) {
          this.langBeforeTour = this.language.lang();
          if (this.langBeforeTour !== wanted) this.language.setLang(wanted);
        } else if (!wanted && this.langBeforeTour !== null) {
          if (this.language.lang() !== this.langBeforeTour) this.language.setLang(this.langBeforeTour);
          this.langBeforeTour = null;
        }
      });
    });
  }

  set(briefing: TourBriefing | undefined, tourFocusCols?: [number, number]): void {
    this._briefing.set(briefing ?? null);
    this._tourFocusCols.set(tourFocusCols ?? null);
    this.runStartedAt.set(Date.now());
    this.shiftHistory.set([]);
    this.ruleShown.set(null);
  }

  /**
   * When this tour run started. Learning records persist in the browser, so a
   * rule from an earlier visitor must not count as one this person confirmed
   * (`matchingRule` only looks at records made since).
   */
  readonly runStartedAt = signal(0);
  /** When the current session (the current shift) started. */
  readonly shiftStartedAt = signal(0);

  /** An experiment condition is running (set by the app, like its map focus). */
  readonly experimentActive = signal(false);

  /**
   * The learning cards to show. Confirmed cards persist in the browser, so in a
   * tour or an experiment — where the next person sits at the same machine —
   * only the cards of the current session count; earlier visitors' cards stay
   * stored but out of sight. A free session shows all of them: there they are
   * the operator's own rules.
   */
  readonly cardsInView = computed(() => {
    const all = this.store.learningRecords();
    if (!this.store.demoActive() && !this.experimentActive()) return all;
    const since = this.shiftStartedAt();
    return all.filter((r) => r.createdAt >= since);
  });

  /** The finished shifts of this tour run, for the shift 1 ↔ 2 comparison. */
  readonly shiftHistory = signal<ShiftRecord[]>([]);

  /** The rule from an earlier shift that the impact analysis showed in the
   *  current session, with the measure it names (`rule-match.ts`). */
  readonly ruleShown = signal<{ sessionId: string; hypothesis: string; measure: string } | null>(null);

  recordShift(shift: ShiftRecord): void {
    this.shiftHistory.update((list) => [...list, shift]);
  }

  clear(): void {
    this._briefing.set(null);
    this._tourFocusCols.set(null);
    this._experimentFocusCols.set(null);
  }

  setExperimentFocus(cols: [number, number] | null): void {
    this._experimentFocusCols.set(cols);
  }

  modeIntroFor(mode: InteractionMode): ModeIntro | null {
    const leg = this.briefing()?.legIntros?.[this.store.demoStepIndex()];
    if (leg?.mode === mode) return leg;
    return this.briefing()?.modeIntros?.[mode] ?? null;
  }

  /** Module name when this panel type is one of the tour's highlighted modules. */
  moduleFor(panelType: string | undefined): string | null {
    if (!panelType) return null;
    return this.briefing()?.moduleBadges?.[panelType] ?? null;
  }
}
