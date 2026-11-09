import { writeFile } from 'node:fs/promises';
import { expect, test } from './support/fixtures';

test('prepared Director comparison · real map variants and exact native adoption', { tag: ['@slow'] }, async ({ page, welcome, work, guard }) => {
  test.slow();
  await work.observeDirectorComparison('commit');
  try {
    await welcome.goto();
    const created = await welcome.startPreparedDispatcherDemo('director');
    expect(created.ok()).toBe(true);
    const config = created.request().postDataJSON();
    expect(config.operator_type).toBe('synthetic_dispatcher');
    expect(config.interaction_mode).toBe('director');
    expect(config.scenario_preset_id).toBe('pf-ch-wn-wal-long-approach');
    expect(config.dispatcher.comparison).toBe(true);
    expect(config.dispatcher.switch_at).toBe(2);
    await work.expectStarted('prepared Director comparison');
    await work.expectMode('prepared Director comparison', 'director');
    await work.expectDispatcherAvatar();

    // The coordinator has shown both native variants and requested adoption,
    // but the unchanged real request is held before it reaches the backend.
    const comparison = await work.heldDirectorComparison('commit');
    expect(comparison.step).toBe(1);
    expect(comparison.current!.weights).toEqual({ punctuality: 2, connections: 2, stability: 5 });
    expect(comparison.alternative!.weights).toEqual({ punctuality: 5, connections: 2, stability: 2 });
    await work.expectDirectorComparisonMapStages(comparison);
    await work.expectDispatcherLiveState('acting');
    await work.expectNoDirectorOutcome();
    await writeFile(test.info().outputPath('director-comparison-frozen.json'), JSON.stringify(comparison, null, 2));
    await writeFile(test.info().outputPath('director-comparison-map-frames.json'), JSON.stringify(await work.directorComparisonFrames(), null, 2));
    await page.screenshot({ path: test.info().outputPath('director-comparison-before-commit.png'), fullPage: true });

    work.releaseHeldDirectorComparison('commit');
    // Hold only the subsequent real Play request, so the installed geometry
    // can be compared against the exact displayed candidate at the same step.
    await work.expectDirectorComparisonInstalled(comparison);
    await work.expectNoDirectorOutcome();
    await page.screenshot({ path: test.info().outputPath('director-comparison-installed.png'), fullPage: true });
    work.releaseHeldDirectorComparison('resume');
    await work.expectDirectorComparisonResumed(comparison);
    await work.expectDirectorOutcomeTracking(comparison);
    await work.expectDirectorComparisonFinished(comparison, () => page.screenshot({ path: test.info().outputPath('director-outcome-progress.png'), fullPage: true }));
    await page.screenshot({ path: test.info().outputPath('director-comparison-complete.png'), fullPage: true });
    await writeFile(test.info().outputPath('director-outcome-evidence.json'), JSON.stringify(await work.directorOutcomeEvidence(), null, 2));
    await work.openDispatcherMonitor();
    const exported = await work.exportDispatcher();
    expect(exported.technical_result).toBe('complete');
    expect(exported.simulation_result).toBe('all_arrived');
    expect(exported.metrics.arrived).toBe(3);
    expect(exported.metrics.total_trains).toBe(3);
    expect(exported.events.filter((event: any) => event.kind === 'result'
      && event.decision?.command_id === comparison.command_id && event.result.status === 'executed')).toHaveLength(1);
    expect(exported.events.filter((event: any) => event.kind === 'directive_effective'
      && event.command_id === comparison.command_id)).toHaveLength(1);
    await writeFile(test.info().outputPath('director-comparison-export.json'), JSON.stringify(exported, null, 2));
    await work.closeDispatcherMonitor();
    guard.expectClean('prepared Director comparison');
  } finally {
    work.releaseAllDirectorComparisonBoundaries();
  }
});

test('prepared Director comparison · takeover rejects a late genuine preparation response', { tag: ['@slow'] }, async ({ page, welcome, work, guard }) => {
  test.slow();
  await work.observeDirectorComparison('prepare-response');
  try {
    await welcome.goto();
    expect((await welcome.startPreparedDispatcherDemo('director')).ok()).toBe(true);
    await work.expectStarted('Director comparison takeover');
    const comparison = await work.heldDirectorComparison('prepare-response');
    await work.deliverStaleDirectorComparisonAfterTakeover(comparison);

    // A real human operation after delivery exercises continued ownership;
    // stale preparation cannot commit A or start playback behind the person.
    const humanWeights = { punctuality: 2, connections: 5, stability: 2 };
    expect((await work.applyDirectorFocus('focus_connections')).weights).toEqual(humanWeights);
    await work.expectDirectorFocus('focus_connections');
    await work.expectDirectorComparisonCancelled(comparison, humanWeights);
    await page.screenshot({ path: test.info().outputPath('director-comparison-cancelled.png'), fullPage: true });
    await writeFile(test.info().outputPath('director-comparison-cancelled-state.json'), JSON.stringify(await work.dispatcherState(), null, 2));
    guard.expectClean('Director comparison takeover and late response');
  } finally {
    work.releaseAllDirectorComparisonBoundaries();
  }
});
