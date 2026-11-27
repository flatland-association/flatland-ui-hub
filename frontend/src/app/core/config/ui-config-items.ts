import { WIDGET_CATALOG } from '../widgets/widget-catalog';

/** A verb a `UiConfigItem` can be targeted with from a deployment config file. */
export type UiConfigVerb = 'hidden' | 'collapsedByDefault';

/** One id the deployment config (`docs/plans/configurable-ui-plan.md`) can
 *  target, and which verbs it supports. */
export interface UiConfigItem {
  id: string;
  label: string;
  supports: UiConfigVerb[];
}

/** `widget.<type>` for every built panel type in `WIDGET_CATALOG`, generated
 *  rather than hand-copied so the two can't drift (the widget gallery already
 *  cross-checks `WIDGET_CATALOG` the same way). Only `decision-log` has a
 *  collapsed-by-default hook today, so it's the only one offered that verb. */
const WIDGET_IDS: UiConfigItem[] = WIDGET_CATALOG.filter((w) => w.type).map((w) => ({
  id: `widget.${w.type}`,
  label: w.title,
  supports: w.type === 'decision-log' ? ['hidden', 'collapsedByDefault'] : ['hidden'],
}));

/** Chrome elements that are not panels, so nothing registers them today.
 *  One id per region, not per element inside it: the same grain applies to
 *  the mode tab strip and the menu's area links. The map's overlay controls
 *  are three regions, pan arrows, zoom buttons and rail-opacity slider, one id
 *  each, because Plan B shows zoom without pan arrows and drops the slider
 *  (docs/plans/plan-b-small-changes.md, item 2). */
const CONTROL_IDS: UiConfigItem[] = [
  { id: 'control.contrast', label: 'Colours / high-contrast setting (Session Settings)', supports: ['hidden'] },
  { id: 'control.mapPan', label: 'Map pan control overlay (arrows, reset)', supports: ['hidden'] },
  { id: 'control.mapZoom', label: 'Map zoom buttons (+ / − / %)', supports: ['hidden'] },
  { id: 'control.mapOpacity', label: 'Map rail-tile opacity slider', supports: ['hidden'] },
  { id: 'control.endShift', label: 'End shift button', supports: ['hidden'] },
  // Only with briefings that set `autoStart`: without Play nothing else starts
  // the run (docs/plans/toolbar-under-guide.md §1.1; checked for conditions in
  // study-conditions.spec.ts, not for a deployment ui-config.json).
  { id: 'control.playback', label: 'Play/Pause and simulation speed (toolbar)', supports: ['hidden'] },
  { id: 'control.modeTabs', label: 'Interaction mode tabs (Recommendation / Co-Learning / Director)', supports: ['hidden'] },
  { id: 'control.sessionInfo', label: 'Session status line ("Loaded scenario preset: …")', supports: ['hidden'] },
  { id: 'control.studyLogging', label: '"Study logging" switch (Session Settings)', supports: ['hidden'] },
  // Hide it where the layout fixes the unit (UiConfig.timeUnit), e.g. Plan B round 2.
  { id: 'control.timeUnit', label: 'Time unit: steps or minutes (Session Settings)', supports: ['hidden'] },
  { id: 'control.menuAreas', label: 'Menu "Bereiche" links (Layout Designer, galleries, Contribute)', supports: ['hidden'] },
  // The guide strip of a running leg; the toolbar then stays at the top
  // (docs/plans/hide-scenario-bar.md §4.4). The guide still ticks and logs.
  // Only where nothing needs the strip's buttons: no Schichtbilanz («Schicht
  // beenden») and a decision log («Reflexion nachtragen» for «Reflexion
  // öffnen») — checked for conditions in study-conditions.spec.ts, not for a
  // deployment ui-config.json.
  { id: 'control.guide', label: 'Guide strip: steps and hints of the running scenario', supports: ['hidden'] },
  // Not an element but its text: the scenarios stay, numbered "Szenario k/N",
  // wherever a leg is shown, and the intro card leaves out the scenario's title
  // (docs/plans/hide-scenario-bar.md §4.3).
  { id: 'control.legNames', label: 'Scenario names of an experiment: stepper, finish button, footer, intro card (numbered only)', supports: ['hidden'] },
];

/** The two figures inside the `proposal-compare` ("Plan / KI / Mensch")
 *  comparison section — finer-grained than hiding the whole widget. */
const AXIS_IDS: UiConfigItem[] = [
  { id: 'widget.proposal-compare.axis.lateness', label: 'Comparison: delay vs. timetable (Plan/KI/Mensch)', supports: ['hidden'] },
  { id: 'widget.proposal-compare.axis.time', label: 'Comparison: time in network (Plan/KI/Mensch)', supports: ['hidden'] },
  // The human's own option: the Mensch box, its option buttons and its bar in
  // the comparison. Plan B round 2's Recommendation screen hides it
  // (docs/plans/plan-b-round2-recommendation.md, item 2).
  { id: 'widget.proposal-compare.human', label: 'Plan/KI/Mensch: the human\'s own option (Mensch box and options)', supports: ['hidden'] },
];

/** Panel titles a layout can hide. Only the centre view container's so far:
 *  its tabs already name what it shows (#168, docs/plans/zwl-default.md §4.2).
 *  The panel is then framed without header, so it can no longer collapse. */
const TITLE_IDS: UiConfigItem[] = [
  { id: 'widget.view-tabs.title', label: 'Centre view panel title (the tabs take its place)', supports: ['hidden'] },
];

/** Parts of the `decision-log` panel, finer-grained than the whole widget. */
const DECISION_LOG_IDS: UiConfigItem[] = [
  { id: 'widget.decision-log.actions', label: 'Decision log: export and clear buttons', supports: ['hidden'] },
];

/** Every id a deployment config (§4.2) may target. */
export const UI_CONFIG_ITEMS: UiConfigItem[] = [...WIDGET_IDS, ...CONTROL_IDS, ...AXIS_IDS, ...TITLE_IDS, ...DECISION_LOG_IDS];

/**
 * Ids that no longer name one control but still work, so saved designs,
 * `ui-config.json` files and deep links keep their meaning (stored ids are
 * never removed, AGENTS.md). Each stands for the ids it lists, with the same
 * verb. Not offered in the registry; the schema still accepts them.
 *
 * - `control.mapNavigation`: the map's pan arrows and zoom buttons together,
 *   its meaning before they got ids of their own (plan-b-small-changes.md,
 *   item 2).
 */
export const UI_CONFIG_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'control.mapNavigation': ['control.mapPan', 'control.mapZoom'],
};
