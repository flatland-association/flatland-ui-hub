/**
 * Built-in runtime layouts, shipped with the repo.
 *
 * Until now a layout was either the one hardcoded default or something a user
 * had saved into `localStorage` from the Layout Designer. That makes a layout
 * we actually want to study unreviewable: it lives in one browser, nobody can
 * diff it, and clearing site data loses it. A preset is the same data structure
 * as a saved design, but versioned here — so a layout can be proposed, reviewed
 * and changed like any other piece of the product.
 *
 * Presets are offered alongside saved designs in the session dialog. They are
 * *offered*, never auto-applied: mode-scoped layouts (a layout resolving from
 * `interactionMode`) are a separate, unbuilt step — see
 * docs/plans/mode-scoped-layouts-plan.md.
 *
 * **Known gap, inherited:** the saved-layout runtime path does not consult
 * `panel-mode-availability`. So a preset naming a mode-restricted panel (the
 * reflection is `['co-learning']`) will render it in any mode. That is the same
 * bypass the mode-scoped-layouts plan describes in its §1, not something these
 * presets introduce — but it means a preset's *name* currently carries its
 * intended mode, and nothing enforces it. Choose the matching mode when using
 * one until the resolver exists.
 */

export interface LayoutPresetPanel {
  id: string;
  type: string;
  title: string;
  expanded: boolean;
  collapsible: boolean;
  minHeight: number;
  settings?: Record<string, unknown>;
}

export interface LayoutPresetColumn {
  id: string;
  rowId: string;
  name: string;
  /** Percent of the row. */
  width: number;
  role: 'sidebar' | 'main' | 'custom';
  /**
   * Which zone of the three-zone contract this column is
   * (docs/plans/mode-layouts-three-zones.md §1). Declared, not guessed: `role`
   * cannot carry it, because left and right are both `'sidebar'`, and the
   * name-sniffing fallback in `AppComponent.toRuntimeZone()` reads a column
   * called "Entscheidung" as `left`. Without this field a zone-derived rule —
   * the read-only left column — is simply inert in a preset, since the panel
   * objects a design renders carry no zone at all.
   *
   * Optional for backwards compatibility with designs saved before it existed;
   * absent falls back to the sniffing path.
   */
  zone?: 'left' | 'center' | 'right';
  panels: LayoutPresetPanel[];
}

export interface LayoutPreset {
  id: string;
  name: string;
  /** One sentence on what the layout is for, shown as the option's subtitle. */
  purpose: string;
  layout: { columns: LayoutPresetColumn[] };
}

/**
 * Co-Learning, User Study 2 — the layout proposed in the dispatcher review of
 * 2026-08-24 (docs/reading/2026-08-24-dispatcher-review-study2.md).
 *
 * Its point is **subtraction**: "Es braucht nicht alle Informationen, die das
 * Tool bietet." Agent Inspector, Impact, Scenario and Recommendations are all
 * absent — not because they are wrong, but because a study participant should
 * face one decision surface, not seven. What remains is the situation (left),
 * the network (centre) and the decision plus its reflection (right).
 */
const COLEARNING_STUDY2: LayoutPreset = {
  id: 'preset-colearning-study2',
  name: 'Co-Learning · User Study 2',
  purpose: 'Reduzierter Aufbau aus dem Dispatcher-Review: Lage, Streckenspiegel/ZWL, Entscheidung mit Reflexion.',
  layout: {
    columns: [
      {
        id: 'preset-s2-left',
        zone: 'left',
        rowId: 'preset-s2-row',
        name: 'Lage',
        width: 22,
        role: 'sidebar',
        panels: [
          {
            id: 'preset-s2-situation',
            type: 'situation-summary',
            title: 'Situation Summary',
            expanded: true,
            collapsible: true,
            minHeight: 120,
          },
          {
            id: 'preset-s2-notifications',
            type: 'notifications',
            title: 'Notifications',
            expanded: true,
            collapsible: true,
            minHeight: 160,
          },
          {
            id: 'preset-s2-trains',
            type: 'agents',
            title: 'Züge',
            expanded: true,
            collapsible: true,
            minHeight: 200,
          },
        ],
      },
      {
        id: 'preset-s2-center',
        zone: 'center',
        rowId: 'preset-s2-row',
        name: 'Netz',
        width: 50,
        role: 'main',
        panels: [
          {
            id: 'preset-s2-views',
            type: 'view-tabs',
            title: 'Streckenspiegel & ZWL',
            expanded: true,
            collapsible: false,
            minHeight: 520,
            // The review asked for the ZWL back as a peer of the network view,
            // not as a layer toggle — so both are tabs of one centre container.
            settings: { tabs: ['flatland-map', 'zug-weg-diagramm'] },
          },
        ],
      },
      {
        id: 'preset-s2-right',
        zone: 'right',
        rowId: 'preset-s2-row',
        name: 'Entscheidung',
        width: 28,
        role: 'sidebar',
        panels: [
          {
            id: 'preset-s2-whatif',
            type: 'whatif-compare',
            title: 'What-if Compare',
            expanded: true,
            collapsible: true,
            minHeight: 260,
          },
          {
            id: 'preset-s2-reflection',
            type: 'co-learning-reflection',
            title: 'Reflection',
            expanded: true,
            collapsible: true,
            minHeight: 220,
          },
        ],
      },
    ],
  },
};

/**
 * Recommendation, User Study 2 — the same reduction as the Co-Learning preset,
 * asked for in the same review ("die gleichen Kommentare bezüglich Ansicht").
 *
 * Only the right-hand column differs: Recommendation's one decision surface is
 * the ranked recommendation, where Co-Learning's is the what-if plus its
 * reflection. Everything else is deliberately identical, so a study can compare
 * the two conditions without the layout itself being a variable.
 *
 * **This preset does not isolate the modes.** The cross-mode Co-Learning
 * surfaces (`co-learning-effect`, `learning-records`, the confirmed-preference
 * line) render *inside* the recommendations panel, so no layout can remove
 * them — see docs/reading/2026-08-24-dispatcher-review-study2.md §6.
 */
const RECOMMENDATION_STUDY2: LayoutPreset = {
  id: 'preset-recommendation-study2',
  name: 'Recommendation · User Study 2',
  purpose: 'Gleicher reduzierter Aufbau wie Co-Learning, rechts die Empfehlung statt What-if und Reflexion.',
  layout: {
    columns: [
      {
        id: 'preset-r2-left',
        zone: 'left',
        rowId: 'preset-r2-row',
        name: 'Lage',
        width: 22,
        role: 'sidebar',
        panels: [
          {
            id: 'preset-r2-situation',
            type: 'situation-summary',
            title: 'Situation Summary',
            expanded: true,
            collapsible: true,
            minHeight: 120,
          },
          {
            id: 'preset-r2-notifications',
            type: 'notifications',
            title: 'Notifications',
            expanded: true,
            collapsible: true,
            minHeight: 160,
          },
          {
            id: 'preset-r2-trains',
            type: 'agents',
            title: 'Züge',
            expanded: true,
            collapsible: true,
            minHeight: 200,
          },
        ],
      },
      {
        id: 'preset-r2-center',
        zone: 'center',
        rowId: 'preset-r2-row',
        name: 'Netz',
        width: 50,
        role: 'main',
        panels: [
          {
            id: 'preset-r2-views',
            type: 'view-tabs',
            title: 'Streckenspiegel & ZWL',
            expanded: true,
            collapsible: false,
            minHeight: 520,
            settings: { tabs: ['flatland-map', 'zug-weg-diagramm'] },
          },
        ],
      },
      {
        id: 'preset-r2-right',
        zone: 'right',
        rowId: 'preset-r2-row',
        name: 'Entscheidung',
        width: 28,
        role: 'sidebar',
        panels: [
          {
            id: 'preset-r2-recommendations',
            type: 'recommendations',
            title: 'Empfehlung',
            expanded: true,
            collapsible: true,
            minHeight: 300,
          },
        ],
      },
    ],
  },
};

/**
 * Combined Actions — demo (widget E1, docs/plans/widget-e1-combined-actions.md).
 *
 * The situation and the timetable on the left, the network and the ZWL big in
 * the middle, and the coordinated actions down the right — next to the two views
 * they change. Point at an action and the map marks who is released in what
 * order while the ZWL shifts their lines in time.
 *
 * The centre is `view-tabs` rather than a bare map on purpose: an action's
 * *timing* consequence is only visible in the ZWL, its *ordering* consequence
 * only on the map, and neither alone answers the question.
 *
 * The right column is 32 %, not the 26 % it started at: below that the train
 * sequence gets under ~200 px, four chips wrap onto a second line, and the panel
 * can no longer fit its column without scrolling.
 */
const COMBINED_ACTIONS_DEMO: LayoutPreset = {
  id: 'preset-combined-actions-demo',
  name: 'Combined Actions · Demo',
  purpose: 'Lage und Fahrplan links, Netz/ZWL gross in der Mitte, rechts die kombinierten Aktionen zum Umsortieren.',
  layout: {
    columns: [
      {
        id: 'preset-ca-context',
        zone: 'left',
        rowId: 'preset-ca-row',
        name: 'Lage',
        // Left and right are deliberately equal: they carry the same weight in
        // the task (what is going on ↔ what to do about it), and an asymmetric
        // pair read as an accident rather than as a hierarchy.
        width: 24,
        role: 'sidebar',
        panels: [
          {
            id: 'preset-ca-situation',
            type: 'situation-summary',
            title: 'Situation Summary',
            expanded: true,
            collapsible: true,
            minHeight: 110,
          },
          {
            id: 'preset-ca-notifications',
            type: 'notifications',
            title: 'Notifications',
            expanded: true,
            collapsible: true,
            minHeight: 140,
          },
        ],
      },
      {
        id: 'preset-ca-network',
        zone: 'center',
        rowId: 'preset-ca-row',
        name: 'Netz & ZWL',
        // The centre is the widest thing on the screen by a clear margin: the
        // Streckenspiegel and the ZWL are what the operator actually reads, and
        // at 44 % both were cramped.
        width: 52,
        role: 'main',
        panels: [
          {
            id: 'preset-ca-views',
            type: 'view-tabs',
            title: 'Streckenspiegel & ZWL',
            expanded: true,
            collapsible: false,
            minHeight: 520,
            settings: { tabs: ['flatland-map', 'zug-weg-diagramm'] },
          },
          {
            // Context, not events: the timetable says what each train is
            // *supposed* to do, which is the frame you read the network view
            // against — so it belongs under it, not in the event column.
            id: 'preset-ca-timetable',
            type: 'timetable',
            title: 'Fahrplan',
            expanded: true,
            collapsible: true,
            minHeight: 180,
          },
        ],
      },
      {
        id: 'preset-ca-actions',
        zone: 'right',
        rowId: 'preset-ca-row',
        name: 'Kombinierte Aktionen',
        width: 24,
        role: 'sidebar',
        panels: [
          {
            id: 'preset-ca-combined',
            type: 'combined-actions',
            title: 'Combined Actions',
            expanded: true,
            collapsible: true,
            minHeight: 420,
          },
        ],
      },
    ],
  },
};

/**
 * Combined Actions · Package variant — the second answer to the same problem.
 *
 * Roman's variant is not a different *mode*, it is a different interface to the
 * same decision, so it gets a layout rather than a fourth `InteractionMode`.
 * The reading order is its argument: what is wrong on the left, the network in
 * the middle, the one action that answers it on the right — the dispatcher
 * reads left to right, from problem to remedy, instead of meeting three options
 * before knowing what they are for.
 *
 * The left column is wider than the demo preset's 24 %: the problem overview is
 * prose-shaped, and below ~28 % its sentences wrapped every three words.
 */
const COMBINED_ACTIONS_PACKAGE: LayoutPreset = {
  id: 'preset-combined-actions-package',
  name: 'Combined Actions · Package variant',
  purpose: 'Problem links, Netz/ZWL in der Mitte, rechts ein einzelnes Aktionspaket zum Umsortieren und Bestätigen.',
  layout: {
    columns: [
      {
        id: 'preset-cap-problem',
        zone: 'left',
        rowId: 'preset-cap-row',
        name: 'Problem',
        width: 28,
        role: 'sidebar',
        panels: [
          {
            id: 'preset-cap-overview',
            type: 'problem-overview',
            title: 'Problem Overview',
            expanded: true,
            collapsible: true,
            minHeight: 200,
          },
          {
            id: 'preset-cap-situation',
            type: 'situation-summary',
            title: 'Situation Summary',
            expanded: true,
            collapsible: true,
            minHeight: 110,
          },
        ],
      },
      {
        id: 'preset-cap-network',
        zone: 'center',
        rowId: 'preset-cap-row',
        name: 'Netz & ZWL',
        width: 44,
        role: 'main',
        panels: [
          {
            id: 'preset-cap-views',
            type: 'view-tabs',
            title: 'Streckenspiegel & ZWL',
            expanded: true,
            collapsible: true,
            minHeight: 320,
          },
        ],
      },
      {
        id: 'preset-cap-action',
        zone: 'right',
        rowId: 'preset-cap-row',
        name: 'Aktion',
        width: 28,
        role: 'sidebar',
        panels: [
          {
            id: 'preset-cap-package',
            type: 'combined-actions-package',
            title: 'Combined Actions',
            expanded: true,
            collapsible: true,
            minHeight: 420,
          },
        ],
      },
    ],
  },
};

/**
 * Guide Mode — the layout line, as a collection you can switch between.
 *
 * The three-zone contract (docs/plans/mode-layouts-three-zones.md) arrives in
 * generations, and comparing them is the point: a study or a demo should be able
 * to put the original next to what we changed, not just assert an improvement.
 *
 * - **V1 — the original** is *not* in this list, deliberately. It is the
 *   hardcoded `three-col` default ("Default Layout ✓ hardcoded" in the session
 *   dialog), and only it carries the per-mode right column, the reflection slot
 *   and the Director surfaces, because those live in `AppComponent`'s template
 *   rather than in any design. Re-creating it here would look identical and
 *   quietly lose the mode behaviour — the bypass this file's header warns about.
 * - **V2 — Guide Mode · Light** is below: the contract as far as it goes without
 *   any new widget. Left is status and events and, since P0, is read-only by
 *   zone; the centre is the three situation views as tabs; the right is one
 *   decision column.
 * - **V3 — the target** needs widgets that do not exist yet (`decision-tabs`,
 *   the "Was ändert sich" companion, the Fahrplan Δ column) and the mode-scoped
 *   resolver, so that a per-mode right column stops being a naming convention.
 *   It goes here when those land; until then this comment is the placeholder,
 *   not a broken preset.
 *
 * **Why this one is mode-neutral.** Every panel it names is available in all
 * three modes. That is a constraint, not a preference: the saved-layout path
 * does not consult `panel-mode-availability`, so a preset naming
 * `recommendations` would surface it in Co-Learning and Director too. The
 * mode-specific right column is exactly what V3 needs the resolver for.
 */
const GUIDE_MODE_LIGHT: LayoutPreset = {
  id: 'preset-guide-mode-light',
  name: 'Guide Mode · Light',
  purpose: 'Drei Zonen: links Status ohne Aktionen, Mitte Streckenplan/ZWL/Fahrplan, rechts die Entscheidungsspalte.',
  layout: {
    columns: [
      {
        id: 'preset-gml-left',
        zone: 'left',
        rowId: 'preset-gml-row',
        name: 'Lage',
        width: 22,
        role: 'sidebar',
        panels: [
          {
            id: 'preset-gml-situation',
            type: 'situation-summary',
            title: 'Situation',
            expanded: true,
            collapsible: true,
            minHeight: 120,
          },
          {
            id: 'preset-gml-notifications',
            type: 'notifications',
            title: 'Ereignisse',
            expanded: true,
            collapsible: true,
            minHeight: 160,
          },
          {
            // Renders read-only here: the zone rule strips the dispatch buttons
            // and points at the Agent Inspector on the right. Selecting a train
            // still works — view yes, act no.
            id: 'preset-gml-trains',
            type: 'agents',
            title: 'Züge',
            expanded: true,
            collapsible: true,
            minHeight: 200,
          },
        ],
      },
      {
        id: 'preset-gml-center',
        zone: 'center',
        rowId: 'preset-gml-row',
        name: 'Netz',
        width: 52,
        role: 'main',
        panels: [
          {
            // The three situation views as one tabbed surface: where the trains
            // are, how the plan runs over time, and what the plan says.
            id: 'preset-gml-views',
            type: 'view-tabs',
            title: 'Streckenplan · ZWL · Fahrplan',
            expanded: true,
            collapsible: false,
            minHeight: 520,
            settings: { tabs: ['flatland-map', 'zug-weg-diagramm', 'timetable'] },
          },
        ],
      },
      {
        id: 'preset-gml-right',
        zone: 'right',
        rowId: 'preset-gml-row',
        name: 'Entscheidung',
        width: 26,
        role: 'sidebar',
        panels: [
          {
            id: 'preset-gml-impact',
            type: 'impact',
            title: 'Folgen',
            expanded: true,
            collapsible: true,
            minHeight: 180,
          },
          {
            id: 'preset-gml-whatif',
            type: 'whatif-compare',
            title: 'What-if Compare',
            expanded: true,
            collapsible: true,
            minHeight: 240,
          },
          {
            // The action the left column gave up. Without it the zone rule would
            // take a capability away instead of moving it.
            id: 'preset-gml-inspector',
            type: 'agent-inspector',
            title: 'Zug-Detail',
            expanded: true,
            collapsible: true,
            minHeight: 200,
          },
          {
            id: 'preset-gml-log',
            type: 'decision-log',
            title: 'Entscheidungsprotokoll',
            expanded: false,
            collapsible: true,
            minHeight: 160,
          },
        ],
      },
    ],
  },
};

/**
 * Co-Learning expert interviews (tour `co-learning-interview`). The study
 * layout plus the Fahrplan as a third centre tab and the Impact panel on the
 * right, because the interviews walk through every Co-Learning module, and
 * Impact is where the analysis and the neutral options live.
 */
const COLEARNING_INTERVIEW: LayoutPreset = {
  id: 'preset-colearning-interview',
  name: 'Co-Learning · Interview',
  purpose: 'Für die Experteninterviews: Lage links, Streckenspiegel/ZWL/Fahrplan in der Mitte, alle Co-Learning-Module rechts.',
  layout: {
    columns: [
      {
        id: 'preset-ci-left',
        zone: 'left',
        rowId: 'preset-ci-row',
        name: 'Lage',
        width: 20,
        role: 'sidebar',
        panels: [
          { id: 'preset-ci-situation', type: 'situation-summary', title: 'Situation Summary', expanded: true, collapsible: true, minHeight: 120 },
          { id: 'preset-ci-notifications', type: 'notifications', title: 'Notifications', expanded: true, collapsible: true, minHeight: 160 },
          // Instead of the train list, which the Fahrplan already shows: every
          // decision as it happens, the same entries the shift summary recounts.
          { id: 'preset-ci-decisions', type: 'decision-log', title: 'Entscheidungsprotokoll', expanded: true, collapsible: true, minHeight: 200 },
        ],
      },
      {
        id: 'preset-ci-center',
        zone: 'center',
        rowId: 'preset-ci-row',
        name: 'Netz',
        width: 50,
        role: 'main',
        panels: [
          {
            id: 'preset-ci-views',
            type: 'view-tabs',
            title: 'Streckenspiegel & ZWL',
            expanded: true,
            collapsible: false,
            minHeight: 520,
            // Low enough that the Fahrplan below is on screen too on a laptop.
            settings: { tabs: ['flatland-map', 'zug-weg-diagramm'], minBodyHeight: 340 },
          },
          // Open below the network views rather than a third tab: the timetable
          // is the overview that stays in sight while the map or ZWL is read.
          { id: 'preset-ci-timetable', type: 'timetable', title: 'Fahrplan', expanded: true, collapsible: true, minHeight: 160 },
        ],
      },
      {
        id: 'preset-ci-right',
        zone: 'right',
        rowId: 'preset-ci-row',
        name: 'Co-Learning',
        width: 30,
        role: 'sidebar',
        panels: [
          // Assessment only here (see TourBriefing.assessmentOnly): the options
          // are one panel down, in Plan / KI / Mensch.
          { id: 'preset-ci-impact', type: 'impact', title: 'Lage: Risiko & Auswirkung', expanded: true, collapsible: true, minHeight: 180 },
          { id: 'preset-ci-whatif', type: 'proposal-compare', title: 'Plan / KI / Mensch', expanded: true, collapsible: true, minHeight: 260 },
          // No reflection panel: the tour asks for the reason in a dialog
          // (`reasonDialog`) and shows the learning cards in the debrief.
        ],
      },
    ],
  },
};

/**
 * Olten · Zug-Weg — a Recommendation-mode layout for exploring the
 * Zug-Weg-Diagramm on a real network (tour "Olten: explore the Zug-Weg-Diagramm").
 *
 * Keeps the three-zone contract (left: what happens · centre: where and when ·
 * right: what to do), with the centre split in two: Olten's network is portrait,
 * so the track map takes a narrow column of its own and the diagram, with the
 * timetable below it, the wide one. All three views stay open at once, so a
 * train picked in one is followed in the others — the exploring loop the tour
 * is about. Rows span the full width in this layout model, which is why the
 * timetable sits under the diagram rather than under both views.
 */
const OLTEN_ZUG_WEG: LayoutPreset = {
  id: 'preset-olten-zug-weg',
  name: 'Olten · Zug-Weg',
  purpose: 'Events left, track map and Zug-Weg-Diagramm with timetable in the centre, Combined Actions and train control right.',
  layout: {
    columns: [
      {
        id: 'preset-oz-left',
        zone: 'left',
        rowId: 'preset-oz-row',
        name: 'Lage',
        width: 16,
        role: 'sidebar',
        panels: [
          { id: 'preset-oz-notifications', type: 'notifications', title: 'Notifications', expanded: true, collapsible: true, minHeight: 320 },
        ],
      },
      {
        id: 'preset-oz-map',
        zone: 'center',
        rowId: 'preset-oz-row',
        name: 'Netz',
        width: 22,
        role: 'main',
        panels: [
          { id: 'preset-oz-trackmap', type: 'flatland-map', title: 'Streckenspiegel', expanded: true, collapsible: false, minHeight: 640 },
        ],
      },
      {
        id: 'preset-oz-zwd',
        zone: 'center',
        rowId: 'preset-oz-row',
        name: 'Zug-Weg',
        width: 38,
        role: 'main',
        panels: [
          // Decision pills on: steering from the diagram is what this tour is for.
          { id: 'preset-oz-zugweg', type: 'zug-weg-diagramm', title: 'Zug-Weg-Diagramm', expanded: true, collapsible: false, minHeight: 440, settings: { decisionPills: true } },
          { id: 'preset-oz-timetable', type: 'timetable', title: 'Timetable', expanded: true, collapsible: true, minHeight: 200 },
        ],
      },
      {
        id: 'preset-oz-right',
        zone: 'right',
        rowId: 'preset-oz-row',
        name: 'Entscheidung',
        width: 24,
        role: 'sidebar',
        panels: [
          // Combined Actions rather than the policy-level recommendations
          // panel: it answers the contention on the section (the tour's
          // breakdown), ranked with confidence in Recommendation mode, and it is
          // fed by the same fast forecast branch as the diagram.
          // Strategies source: keep / switch policy / PP re-plan, simulated.
          { id: 'preset-oz-combined', type: 'combined-actions', title: 'Combined Actions', expanded: true, collapsible: true, minHeight: 300, settings: { packageSource: 'strategies' } },
          { id: 'preset-oz-inspector', type: 'agent-inspector', title: 'Zug-Detail', expanded: true, collapsible: true, minHeight: 260 },
        ],
      },
    ],
  },
};

/**
 * Zug-Weg · corridor — the Walensee twin of `preset-olten-zug-weg`, for a long,
 * flat corridor (191 × 9 cells): the track map runs full width on top of the
 * centre, the Zug-Weg-Diagramm and the timetable below it. Same zones and the
 * same right column: Combined Actions with simulated strategies (keep / switch
 * policy / PP re-plan) and the train detail; decision pills on.
 */
const ZUG_WEG_CORRIDOR: LayoutPreset = {
  id: 'preset-zug-weg-corridor',
  name: 'Zug-Weg · Korridor',
  purpose: 'Events left; track map, Zug-Weg-Diagramm and timetable stacked in the centre; simulated strategies and train control right.',
  layout: {
    columns: [
      {
        id: 'preset-zc-left',
        zone: 'left',
        rowId: 'preset-zc-row',
        name: 'Lage',
        width: 17,
        role: 'sidebar',
        panels: [
          { id: 'preset-zc-notifications', type: 'notifications', title: 'Notifications', expanded: true, collapsible: true, minHeight: 320 },
        ],
      },
      {
        id: 'preset-zc-center',
        zone: 'center',
        rowId: 'preset-zc-row',
        name: 'Netz',
        width: 57,
        role: 'main',
        panels: [
          { id: 'preset-zc-trackmap', type: 'flatland-map', title: 'Streckenspiegel', expanded: true, collapsible: false, minHeight: 200 },
          { id: 'preset-zc-zugweg', type: 'zug-weg-diagramm', title: 'Zug-Weg-Diagramm', expanded: true, collapsible: false, minHeight: 420, settings: { decisionPills: true } },
          { id: 'preset-zc-timetable', type: 'timetable', title: 'Timetable', expanded: true, collapsible: true, minHeight: 160 },
        ],
      },
      {
        id: 'preset-zc-right',
        zone: 'right',
        rowId: 'preset-zc-row',
        name: 'Entscheidung',
        width: 26,
        role: 'sidebar',
        panels: [
          { id: 'preset-zc-combined', type: 'combined-actions', title: 'Combined Actions', expanded: true, collapsible: true, minHeight: 300, settings: { packageSource: 'strategies' } },
          { id: 'preset-zc-inspector', type: 'agent-inspector', title: 'Zug-Detail', expanded: true, collapsible: true, minHeight: 240 },
        ],
      },
    ],
  },
};

/**
 * User Study 3 — the successor conditions of Study 2, side by side with them
 * (docs/plans/tours-experiments-cleanup.md §3). One fixed scenario (the Walensee
 * corridor with E1 broken down in Weesen), so the centre is laid out for a long
 * corridor: track map on top, Zug-Weg-Diagramm below, as in
 * `preset-zug-weg-corridor`. Left and centre are identical in both conditions;
 * only the right column — the decision surface — differs, as in Study 2.
 */
function study3(
  prefix: string,
  id: string,
  name: string,
  purpose: string,
  right: LayoutPresetPanel[],
): LayoutPreset {
  return {
    id,
    name,
    purpose,
    layout: {
      columns: [
        {
          id: `${prefix}-left`, zone: 'left', rowId: `${prefix}-row`, name: 'Lage', width: 20, role: 'sidebar',
          panels: [
            { id: `${prefix}-situation`, type: 'situation-summary', title: 'Situation Summary', expanded: true, collapsible: true, minHeight: 120 },
            { id: `${prefix}-notifications`, type: 'notifications', title: 'Notifications', expanded: true, collapsible: true, minHeight: 200 },
          ],
        },
        {
          id: `${prefix}-center`, zone: 'center', rowId: `${prefix}-row`, name: 'Netz', width: 52, role: 'main',
          panels: [
            { id: `${prefix}-trackmap`, type: 'flatland-map', title: 'Streckenspiegel', expanded: true, collapsible: false, minHeight: 200 },
            { id: `${prefix}-zugweg`, type: 'zug-weg-diagramm', title: 'Zug-Weg-Diagramm', expanded: true, collapsible: false, minHeight: 420 },
          ],
        },
        { id: `${prefix}-right`, zone: 'right', rowId: `${prefix}-row`, name: 'Entscheidung', width: 28, role: 'sidebar', panels: right },
      ],
    },
  };
}

const RECOMMENDATION_STUDY3 = study3(
  'preset-r3',
  'preset-recommendation-study3',
  'Recommendation · User Study 3',
  'Lage links, Streckenspiegel und Zug-Weg-Diagramm in der Mitte, rechts die simulierten Strategien mit Empfehlung.',
  [
    { id: 'preset-r3-combined', type: 'combined-actions', title: 'Combined Actions', expanded: true, collapsible: true, minHeight: 300, settings: { packageSource: 'strategies' } },
    { id: 'preset-r3-inspector', type: 'agent-inspector', title: 'Zug-Detail', expanded: true, collapsible: true, minHeight: 200 },
  ],
);

const COLEARNING_STUDY3 = study3(
  'preset-c3',
  'preset-colearning-study3',
  'Co-Learning · User Study 3',
  'Gleicher Aufbau wie Recommendation · Study 3, rechts Plan/KI/Mensch, Auswirkung und Reflexion.',
  [
    { id: 'preset-c3-proposals', type: 'proposal-compare', title: 'Plan / KI / Mensch', expanded: true, collapsible: true, minHeight: 260 },
    { id: 'preset-c3-impact', type: 'impact', title: 'Impact', expanded: true, collapsible: true, minHeight: 160 },
    { id: 'preset-c3-reflection', type: 'co-learning-reflection', title: 'Co-Learning Reflection', expanded: false, collapsible: true, minHeight: 200 },
  ],
);

/**
 * Director · three zones (docs/plans/mode-layouts-three-zones.md §3–§5.3), built
 * on the PF–CH corridor: left what the system does, centre the graphic overview,
 * right the choice. Until now Director rendered with no left column at all, the
 * A/B/C tiles above the map and the AI feed in the right column.
 *
 * - Left, read-only: situation, the AI-activity feed — what the autonomous plan
 *   decided and when it re-planned — and events. `goal-achievement`, which §3
 *   puts here too, is still a placeholder panel ("ready for runtime data") and
 *   stays out until it reads the run.
 * - Centre: the track map (with the contention anchor and the option bars) over
 *   the Zug-Weg-Diagramm; on a corridor the time–distance view is the right
 *   instrument (§4).
 * - Right: the objective (A/B/C), its forecast, and reflection collapsed. 32 %
 *   rather than 26 %, the fallback §5.3 names so the tiles stay readable stacked.
 *
 * The Director bar (directive, run state, end of shift) is chrome and renders
 * above any designed layout.
 */
const DIRECTOR_THREE_ZONES: LayoutPreset = {
  id: 'preset-director-three-zones',
  name: 'Director · Drei Zonen',
  purpose: 'Links was das System tut, in der Mitte Streckenspiegel und Zug-Weg-Diagramm, rechts die Wahl des Ziels.',
  layout: {
    columns: [
      {
        id: 'preset-d3-left', zone: 'left', rowId: 'preset-d3-row', name: 'Was das System tut', width: 22, role: 'sidebar',
        panels: [
          { id: 'preset-d3-situation', type: 'situation-summary', title: 'Situation Summary', expanded: true, collapsible: true, minHeight: 120 },
          { id: 'preset-d3-activity', type: 'ai-activity', title: 'AI Activity', expanded: true, collapsible: true, minHeight: 260 },
          { id: 'preset-d3-notifications', type: 'notifications', title: 'Notifications', expanded: true, collapsible: true, minHeight: 140 },
        ],
      },
      {
        id: 'preset-d3-center', zone: 'center', rowId: 'preset-d3-row', name: 'Überblick', width: 46, role: 'main',
        panels: [
          { id: 'preset-d3-trackmap', type: 'flatland-map', title: 'Streckenspiegel', expanded: true, collapsible: false, minHeight: 240 },
          { id: 'preset-d3-zugweg', type: 'zug-weg-diagramm', title: 'Zug-Weg-Diagramm', expanded: true, collapsible: false, minHeight: 380 },
        ],
      },
      {
        id: 'preset-d3-right', zone: 'right', rowId: 'preset-d3-row', name: 'Auswahl', width: 32, role: 'sidebar',
        panels: [
          { id: 'preset-d3-options', type: 'strategy-options', title: 'Strategy Options (A/B/C)', expanded: true, collapsible: false, minHeight: 320 },
          { id: 'preset-d3-forecast', type: 'strategy-forecast', title: 'Strategy Impact Forecast', expanded: true, collapsible: true, minHeight: 200 },
          { id: 'preset-d3-reflection', type: 'strategy-reflection', title: 'Strategy Reflection', expanded: false, collapsible: true, minHeight: 160 },
        ],
      },
    ],
  },
};

export const LAYOUT_PRESETS: readonly LayoutPreset[] = [
  GUIDE_MODE_LIGHT,
  COLEARNING_STUDY2,
  COLEARNING_INTERVIEW,
  RECOMMENDATION_STUDY2,
  RECOMMENDATION_STUDY3,
  COLEARNING_STUDY3,
  COMBINED_ACTIONS_DEMO,
  COMBINED_ACTIONS_PACKAGE,
  OLTEN_ZUG_WEG,
  ZUG_WEG_CORRIDOR,
  DIRECTOR_THREE_ZONES,
];
