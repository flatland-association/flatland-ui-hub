/**
 * Loads the code of every panel that the templates render inside `@defer`.
 *
 * The panels are lazy chunks so that the start screen does not ship them (the
 * initial-bundle budget in angular.json). In every deployment the backend
 * serves those chunks too, and while it plans (Director), trains (MARL lab) or
 * forecasts it answers no other request. A chunk first requested at that
 * moment arrives only when the work is done, and its panel stays empty until
 * then. So the chunks are fetched while the start screen is idle, and
 * `ApiService.createSession` waits for this before it creates a session.
 *
 * Keep the list in step with the `@defer` blocks in `app.component.html` and
 * `panel-plugin-host.component.html`. A component that is missing here still
 * renders. It only loads later.
 */
let preload: Promise<void> | undefined;

export function preloadDeferredPanels(): Promise<void> {
  preload ??= Promise.all([
    import('../features/notifications-panel/notifications-panel.component'),
    import('../features/triaged-events/triaged-events.component'),
    import('../features/agents-panel/agents-panel.component'),
    import('../features/agents-table/agents-table.component'),
    import('../features/co-learning-reflection/co-learning-reflection.component'),
    import('../features/timetable/timetable.component'),
    import('../features/view-tabs/view-tabs.component'),
    import('../features/kpi-filter/kpi-filter.component'),
    import('../features/director-weights/director-weights.component'),
    import('../features/strategy-options/strategy-options.component'),
    import('../features/strategy-forecast/strategy-forecast.component'),
    import('../features/strategy-reflection/strategy-reflection.component'),
    import('../features/ai-activity/ai-activity.component'),
    import('../features/co-learning-effect/co-learning-effect.component'),
    import('../features/shift-review/shift-review.component'),
    import('../features/scenario-panel/scenario-panel.component'),
    import('../features/recommendations-panel/recommendations-panel.component'),
    import('../features/recommendations-classic/recommendations-classic.component'),
    import('../features/impact-panel/impact-panel.component'),
    import('../features/whatif-compare/whatif-compare.component'),
    import('../features/proposal-compare/proposal-compare.component'),
    import('../features/reflection-prompt/reflection-prompt.component'),
    import('../features/risk-uncertainty/risk-uncertainty-panel.component'),
    import('../features/zug-weg-diagramm/zug-weg-diagramm.component'),
    import('../features/director-divergence/director-divergence.component'),
    import('../features/decision-log/decision-log-panel.component'),
    import('../features/ai-track-record/ai-track-record.component'),
    import('../features/deviation-radar/deviation-radar.component'),
    import('../features/track-occupancy/track-occupancy.component'),
    import('../features/connection-watch/connection-watch.component'),
    import('../features/staged-dispositions/staged-dispositions.component'),
    import('../features/online-learning/online-learning.component'),
    import('../features/flatland-map/flatland-map.component'),
    import('../features/situation-summary/situation-summary.component'),
    import('../features/combined-actions/combined-actions.component'),
    import('../features/combined-actions-package/combined-actions.component'),
    import('../features/combined-actions-package/problem-overview.component'),
    import('../features/agent-inspector/agent-inspector.component'),
    import('../shared/layout/panels/goal-achievement-panel/goal-achievement-panel.component'),
    import('../features/tour-debrief/tour-debrief.component'),
    import('../features/help-about/help-about.component'),
    import('../features/survey/survey.component'),
  ]).then(
    () => undefined,
    // A chunk that fails to load (e.g. a redeploy replaced it) must not stop
    // a session from starting: the `@defer` block retries on its own.
    (err) => console.warn('Preloading the panel chunks failed', err),
  );
  return preload;
}
