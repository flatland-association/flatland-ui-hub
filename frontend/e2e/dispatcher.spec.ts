import { expect, test } from './support/fixtures';
import { DISPATCHER_CASES, PREPARED_DISPATCHER_DEMOS } from './support/matrix';
import { SYSTEM_LAYOUT_OPTION } from './support/panel-expectations';
import { dispatcherDemoStep, runDispatcherBatch } from './support/dispatcher-batch';
import { writeFile } from 'node:fs/promises';
import { STEP_TIMEOUT } from './support/pages';

for (const mode of PREPARED_DISPATCHER_DEMOS) {
  test(`prepared dispatcher demo · ${mode}`, { tag: mode === 'director' ? ['@slow'] : [] }, async ({ page, welcome, work, guard }) => {
    if (mode === 'director') test.slow();
    await welcome.goto();
    await welcome.expectPreparedDispatcherDemosVisible();
    await page.getByTestId('tour-group-watch').scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('demo-launchers.png'), animations: 'disabled' });
    // One launch click, with no operator, layout, network or mode form edits.
    const created = await welcome.startPreparedDispatcherDemo(mode);
    expect(created.ok()).toBe(true);
    const request = created.request().postDataJSON();
    expect(request.interaction_mode).toBe(mode);
    expect(request.operator_type).toBe('synthetic_dispatcher');
    expect(request.scenario_preset_id).toBe('pf-ch-wn-wal-long-approach');
    expect(request.seed).toBe(42);
    await work.expectStarted(`prepared dispatcher ${mode}`);
    await work.expectMode(`prepared dispatcher ${mode}`, mode);
    await work.expectSyntheticPlayback();
    await work.expectDispatcherAvatar();
    if (mode === 'recommendation') {
      await expect.poll(async () => (await work.dispatcherState()).pending !== null, { timeout: STEP_TIMEOUT.default }).toBe(true);
      await work.pauseSyntheticPlayback();
      await work.expectDispatcherLiveState('paused');
      await work.expectDispatcherActivity('planned');
      await work.expectDispatcherCursorAt('strategy-apply-pp', 'strategy:pp');
      await work.expectDispatcherTrainMark(0, 'planned');
      await page.screenshot({ path: test.info().outputPath('demo-planned.png'), fullPage: true });
      const before = await work.dispatcherState();
      expect((await work.dispatcherState()).logical_time).toBe(before.logical_time);
      await work.startSyntheticPlayback();
      await expect.poll(async () => (await work.dispatcherState()).metrics.executed, { timeout: STEP_TIMEOUT.default }).toBe(1);
      await work.pauseSyntheticPlayback();
      await work.expectDispatcherLiveState('paused');
      await work.expectDispatcherActivity('executed');
      await work.expectDispatcherTrainMark(0, 'executed');
    } else {
      await work.expectDirectorFocus('focus_stability');
      await expect.poll(async () => (await work.dispatcherState()).metrics.effective_goal_changes, { timeout: STEP_TIMEOUT.director }).toBe(1);
      await work.pauseSyntheticPlayback();
      await work.expectDispatcherLiveState('paused');
      await work.expectDispatcherActivity('effective');
      await work.expectDispatcherActivityWeights('5 / 2 / 2');
      await work.expectDirectorFocus('focus_delay');
      await work.expectDispatcherCursorAt('director-apply-focus_delay', 'director:5:2:2');
      await work.expectDispatcherTrainVisible(0);
      const state = await work.dispatcherState();
      expect(state.mode).toBe('director');
      expect(state.metrics.executed).toBe(2);
      expect(state.events.filter((e: any) => e.kind === 'directive_effective').map((e: any) => e.weights)).toEqual([[2, 2, 5], [5, 2, 2]]);
    }
    await page.screenshot({ path: test.info().outputPath('demo-confirmed.png'), fullPage: true });
    await work.openDispatcherLog();
    await writeFile(test.info().outputPath('demo-export.json'), JSON.stringify(await work.exportDispatcher(), null, 2));
    await work.closeDispatcherLog();
    if (mode === 'director') {
      const lastAction = await work.dispatcherLastAction();
      await work.takeOverDispatcher();
      await work.expectDispatcherLiveState('human');
      await work.expectDispatcherLastAction(lastAction);
      await work.expectNoDispatcherCursor();
      const human = await work.applyDirectorFocus('focus_connections');
      expect(human.weights).toEqual({ punctuality: 2, connections: 5, stability: 2 });
      await work.expectDirectorFocus('focus_connections');
      const mixed = await work.dispatcherState();
      expect(mixed.operator_type).toBe('mixed');
      expect(mixed.metrics.executed).toBe(2);
    }
    guard.expectClean(`prepared dispatcher ${mode}`);
  });
}

test('prepared dispatcher demo · recommendation · live lifecycle', async ({ page, welcome, work, guard }) => {
  await work.controlDispatcherConnection();
  await welcome.goto();
  expect((await welcome.startPreparedDispatcherDemo('recommendation')).ok()).toBe(true);
  await work.expectStarted('prepared recommendation dispatcher lifecycle');
  await work.expectMode('prepared recommendation dispatcher lifecycle', 'recommendation');
  await work.expectSyntheticPlayback();
  await work.expectDispatcherAvatar();
  const openingStep = await work.dispatcherLiveStep();
  await work.expectDispatcherLiveStepAfter(openingStep);
  await work.expectDispatcherRunning();
  await page.screenshot({ path: test.info().outputPath('dispatcher-running.png'), fullPage: true });
  await expect.poll(async () => (await work.dispatcherState()).pending !== null, { timeout: STEP_TIMEOUT.default }).toBe(true);
  await work.pauseSyntheticPlayback();
  await work.expectDispatcherActivity('planned');
  await work.expectDispatcherPausedStepFrozen();
  const lastAction = await work.dispatcherLastAction();
  await work.disconnectDispatcherUpdates();
  await work.expectDispatcherAvatar();
  await work.expectDispatcherLastAction(lastAction);
  await page.screenshot({ path: test.info().outputPath('dispatcher-offline.png'), fullPage: true });
  await work.reconnectDispatcherUpdates();
  await work.expectDispatcherLiveState('paused');
  await work.expectDispatcherLastAction(lastAction);
  const pausedStep = await work.dispatcherLiveStep();
  await work.startSyntheticPlayback();
  await work.expectDispatcherRunning();
  await work.expectDispatcherLiveStepAfter(pausedStep);
  await work.pauseSyntheticPlayback();
  await work.expectDispatcherLiveState('paused');
  guard.expectClean('prepared recommendation dispatcher lifecycle');
});

for (const condition of DISPATCHER_CASES) {
  test(`synthetic dispatcher · ${condition.profile} · takeover ${condition.takeover}`, async ({ page, welcome, work, guard }) => {
    await welcome.goto();
    await welcome.openDoor('build');
    await welcome.selectLayout(SYSTEM_LAYOUT_OPTION);
    await welcome.selectNetwork('pf-ch-wn-wal-long-approach');
    await welcome.selectDispatcher(condition.profile);
    await welcome.loadDispatcherDemo();
    const created = await welcome.pressStart('synthetic dispatcher');
    expect(created.ok()).toBe(true);
    expect((await created.json()).operator_type).toBe('synthetic_dispatcher');
    await work.expectStarted('synthetic dispatcher');
    await expect(work.dispatcherOverlay).toBeVisible();
    await work.openDispatcherLog();
    // One pulse per second leaves the three-tick pending state observable.
    if (condition.profile === 'delayed') await work.setSyntheticTempo(3);
    await work.startSyntheticPlayback();
    if (condition.profile === 'delayed') {
      await work.expectSyntheticEventReached(dispatcherDemoStep());
      await expect.poll(async () => (await work.dispatcherState()).pending !== null).toBe(true);
      await work.pauseSyntheticPlayback();
      const paused = await work.dispatcherState();
      expect(paused.pending).not.toBeNull();
      await page.screenshot({ path: test.info().outputPath('dispatcher-pending-details.png'), fullPage: true });
      await work.closeDispatcherLog();
      await work.expectDispatcherTrainMark(0, 'planned');
      await page.screenshot({ path: test.info().outputPath('dispatcher-planned.png'), fullPage: true });
      await work.openDispatcherLog();
      const read1 = await work.dispatcherState();
      const read2 = await work.dispatcherState();
      expect(read1.logical_time).toBe(paused.logical_time);
      expect(read2.logical_time).toBe(paused.logical_time);
      if (condition.takeover) {
        await work.takeOverDispatcher();
        await expect.poll(async () => (await work.dispatcherState()).owner).toBe('human');
        const result = await work.exportDispatcher();
        expect(result.pending).toBeNull();
        expect(result.operator_type).toBe('mixed');
        expect(result.metrics.cancelled).toBe(1);
        expect(result.metrics.executed).toBe(0);
        await work.expectDispatcherActivity('cancelled');
        await work.closeDispatcherLog();
        await work.expectDispatcherTrainMark(0, 'cancelled');
        await page.screenshot({ path: test.info().outputPath('dispatcher-takeover.png'), fullPage: true });
        guard.expectClean('synthetic dispatcher takeover');
        return;
      }
      await work.setSyntheticTempo(4);
      await work.startSyntheticPlayback();
    }
    await expect.poll(async () => (await work.dispatcherState()).metrics.executed, { timeout: 30_000 }).toBe(1);
    await work.closeDispatcherLog();
    await work.expectDispatcherTrainMark(0, 'executed');
    await work.openDispatcherLog();
    await expect.poll(async () => (await work.dispatcherState()).run_status, { timeout: 30_000 }).toBe('finished');
    const result = await work.exportDispatcher();
    expect(result.metrics.response_ticks).toEqual([condition.profile === 'delayed' ? 3 : 0]);
    expect(result.events.some((event: any) => event.kind === 'result' && event.result.status === 'executed')).toBe(true);
    const batch = runDispatcherBatch(created.request().postDataJSON());
    expect(result.metrics).toEqual(batch.metrics);
    await writeFile(test.info().outputPath('ui-export.json'), JSON.stringify(result, null, 2));
    await writeFile(test.info().outputPath('batch-export.json'), JSON.stringify(batch, null, 2));
    await page.screenshot({ path: test.info().outputPath('dispatcher-monitor.png'), fullPage: true });
    guard.expectClean('synthetic dispatcher');
  });
}

test('prepared dispatcher demo · leaves Build on Human after a reload', async ({ page, welcome }) => {
  await welcome.goto();
  await welcome.startPreparedDispatcherDemo('recommendation');
  await page.reload();
  await welcome.openDoor('build');
  await expect(page.getByTestId('dispatcher-operator')).toHaveValue('human');
});

test('prepared dispatcher demo · starts from its link, outside any tour run', async ({ welcome }) => {
  const created = welcome.waitForAutoStart('dispatcher tour link');
  await welcome.goto('#/tour/dispatcher-recommendation/start');
  const response = await created;
  expect(response.ok()).toBe(true);
  const sent = response.request().postDataJSON();
  expect(sent.operator_type).toBe('synthetic_dispatcher');
  expect(sent.run ?? null).toBeNull();
});
