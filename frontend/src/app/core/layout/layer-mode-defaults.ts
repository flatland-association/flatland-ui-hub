import { InteractionMode, LayerVisibility } from '../events/event-types';

/**
 * Which map/diagram layers a mode starts with, and how an operator's own choice
 * overrides it.
 *
 * Sibling to `PANEL_MODE_AVAILABILITY`: that map says which panel *types* a mode
 * offers, this one says how the shared view layers are set when it opens. Until
 * now there were no per-mode defaults at all — Director opened with exactly the
 * Recommendation picture, including a dashed decision line, a pulsing marker and
 * up to three action pills per train, which is the altitude that mode explicitly
 * takes off the operator's hands.
 *
 * Two things this deliberately does not do. It does not write to the store from
 * an effect — the defaults are a pure function of the mode, resolved on read, so
 * there is one writer (the operator) instead of two racing ones. And it does not
 * forget an explicit choice on a mode switch: a layer the operator has toggled
 * stays where they put it until they reset it.
 */

/** The layers as they were before modes had a say; also Recommendation's set. */
export const LAYER_BASE_DEFAULTS: LayerVisibility = {
  grid: true,
  nextDecisions: true,
  agentTrajectory: true,
  trajectoryCellInfo: true,
  switches: false,
  signals: false,
  stations: true,
  contentions: true,
};

/**
 * Per-mode departures from the base, and only those.
 *
 * Director turns off two layers:
 *
 * - `nextDecisions` — the per-train decision line, marker and action pills. In
 *   Director the operator's lever is the objective (`strategy-options`), not the
 *   individual dispatch decision; the same reasoning already made Combined
 *   Actions read-only there. Note this also removes the Marey's `decisionGlyph`,
 *   which mirrors the map visual off the same key — the same concept in two
 *   places, so one switch governing both is right.
 * - `agentTrajectory` — a second animated dashed line per train, on top of the
 *   option overlay that is the point of the mode.
 *
 * `grid` and `trajectoryCellInfo` stay on although the map would be calmer
 * without them: the Marey reads both (`showGrid`, its tooltip gate), and a
 * time–distance diagram without gridlines is worse, not simpler. `stations` stays
 * on because Director names places by station — the conflict anchor's label comes
 * from the backend's `location.name`.
 */
export const LAYER_MODE_OVERRIDES: Partial<Record<InteractionMode, Partial<LayerVisibility>>> = {
  director: {
    nextDecisions: false,
    agentTrajectory: false,
  },
};

/** The layer set a mode opens with, before any operator choice. */
export function layerDefaultsFor(mode: InteractionMode): LayerVisibility {
  return { ...LAYER_BASE_DEFAULTS, ...(LAYER_MODE_OVERRIDES[mode] ?? {}) };
}

/** The mode's defaults with the operator's explicit toggles on top. */
export function resolveLayerVisibility(
  mode: InteractionMode,
  chosen: Partial<LayerVisibility>,
): LayerVisibility {
  return { ...layerDefaultsFor(mode), ...chosen };
}

/**
 * Which layers the operator currently holds against the mode's default.
 *
 * Only the ones that actually differ: toggling a layer off and on again leaves a
 * recorded choice that equals the default, and reporting that as "overridden"
 * would light up a reset affordance with nothing to reset.
 */
export function overriddenLayers(
  mode: InteractionMode,
  chosen: Partial<LayerVisibility>,
): Array<keyof LayerVisibility> {
  const defaults = layerDefaultsFor(mode);
  return (Object.keys(chosen) as Array<keyof LayerVisibility>).filter(
    (key) => chosen[key] !== undefined && chosen[key] !== defaults[key],
  );
}
