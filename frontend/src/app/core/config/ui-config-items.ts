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
 *  One id per region, not per element inside it: `control.mapNavigation`
 *  already covers two overlays, and the same grain applies to the mode tab
 *  strip and the menu's area links. */
const CONTROL_IDS: UiConfigItem[] = [
  { id: 'control.contrast', label: 'Colours / high-contrast setting (Session Settings)', supports: ['hidden'] },
  { id: 'control.mapNavigation', label: 'Map pan + zoom control overlay', supports: ['hidden'] },
  { id: 'control.endShift', label: 'End shift button', supports: ['hidden'] },
  { id: 'control.modeTabs', label: 'Interaction mode tabs (Recommendation / Co-Learning / Director)', supports: ['hidden'] },
  { id: 'control.sessionInfo', label: 'Session status line ("Loaded scenario preset: …")', supports: ['hidden'] },
  { id: 'control.menuAreas', label: 'Menu "Bereiche" links (Layout Designer, galleries, Contribute)', supports: ['hidden'] },
];

/** The two figures inside the `proposal-compare` ("Plan / KI / Mensch")
 *  comparison section — finer-grained than hiding the whole widget. */
const AXIS_IDS: UiConfigItem[] = [
  { id: 'widget.proposal-compare.axis.lateness', label: 'Comparison: delay vs. timetable (Plan/KI/Mensch)', supports: ['hidden'] },
  { id: 'widget.proposal-compare.axis.time', label: 'Comparison: time in network (Plan/KI/Mensch)', supports: ['hidden'] },
];

/** Every id a deployment config (§4.2) may target. */
export const UI_CONFIG_ITEMS: UiConfigItem[] = [...WIDGET_IDS, ...CONTROL_IDS, ...AXIS_IDS];
