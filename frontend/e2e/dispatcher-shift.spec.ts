import { writeFile } from 'node:fs/promises';
import { expect, test } from './support/fixtures';
import { PREPARED_DISPATCHER_SHIFTS } from './support/matrix';

// Presentation acceptance ends after two genuine assessments. The complete
// shift below independently retains its arrival and full-audit requirements.
test('prepared dispatcher shift · synthetic assessment presentation', { tag: ['@slow'] }, async ({ page, welcome, work, guard }) => {
  test.slow();
  await work.observeDispatcherControlReveals();
  await welcome.goto();
  await welcome.expectPreparedDispatcherShiftDemosVisible();
  const created = await welcome.startPreparedDispatcherDemo('shift');
  expect(created.ok()).toBe(true);
  const config = created.request().postDataJSON();
  expect(config.operator_type).toBe('synthetic_dispatcher');
  expect(config.interaction_mode).toBe('recommendation');
  expect(config.dispatcher.profile).toBe('baseline');
  expect(config.scenario_preset_id).toBe('pf-ch-corridor-stops');
  expect(config.disturbance_ids).toEqual(['corridor-shift-incidents']);
  expect(config.seed).toBe(42);
  expect(config.malfunction_rate).toBe(0);
  expect(config.max_episode_steps).toBe(320);
  expect((await created.json()).num_agents).toBe(16);
  await work.expectStarted('dispatcher shift assessment presentation');
  await work.expectMode('dispatcher shift assessment presentation', 'recommendation');
  await work.expectDispatcherAvatar();
  await work.expectDispatcherCompact();
  await work.expectSyntheticPlayback();

  let state = await work.dispatcherState();
  while (!['finished', 'error', 'aborted'].includes(state.run_status)
    && !(state.last_result?.result.status === 'executed' && state.last_result.decision.command.strategy === 'keep')) {
    state = await work.nextDispatcherShiftState(state.logical_time);
  }
  expect(state.run_status).toBe('running');
  await work.pauseSyntheticPlayback();
  const first = await work.dispatcherState();
  expect(first.pending).toBeNull();
  await work.expectDispatcherMaintaining(first.last_result.decision);
  const firstCommand = first.last_result.decision.command_id;

  await work.startSyntheticPlayback();
  await work.expectDispatcherKeepOnMap();
  state = await work.dispatcherState();
  while (!['finished', 'error', 'aborted'].includes(state.run_status)
    && !(state.last_result?.result.status === 'executed' && state.last_result.decision.command.strategy === 'keep'
      && state.last_result.decision.command_id !== firstCommand)) {
    state = await work.nextDispatcherShiftState(state.logical_time);
  }
  expect(state.run_status).toBe('running');
  expect(state.pending).toBeNull();
  const secondCommand = state.last_result.decision.command_id;
  expect(secondCommand).not.toBe(firstCommand);
  expect(state.logical_time).toBeGreaterThan(first.logical_time);
  await work.expectSyntheticPlayback();
  await work.expectDispatcherAssessment(state.last_result.decision, 'executed');
  await work.expectDispatcherKeepOnMap();
  await page.screenshot({ path: test.info().outputPath('shift-assessment-live-keep.png'), fullPage: true });
  await work.pauseSyntheticPlayback();
  await work.expectDispatcherRevealsOnlyPending();
  await work.openDispatcherMonitor();
  const exported = await work.exportDispatcher();
  await work.closeDispatcherMonitor();
  expect(exported.technical_result).toBe('incomplete');
  expect(exported.simulation_result).toBe('unfinished');
  expect(exported.run_status).toBe('running');
  expect(exported.metrics.total_trains).toBe(16);
  expect(exported.metrics.arrived).toBeLessThan(16);
  const keeps = exported.events.filter((event: any) => event.kind === 'result'
    && event.result.status === 'executed' && event.decision.command.strategy === 'keep');
  expect(keeps.map((event: any) => event.decision.command_id)).toEqual(expect.arrayContaining([firstCommand, secondCommand]));
  await writeFile(test.info().outputPath('shift-assessment-incomplete-export.json'), JSON.stringify(exported, null, 2));
  guard.expectClean('dispatcher shift assessment presentation');
});

for (const condition of PREPARED_DISPATCHER_SHIFTS) {
  // Both recipes score full corridor PP/CBS plans, so use the existing
  // planner resource class rather than compete with fast setup cases.
  test(`prepared dispatcher shift · ${condition.operator}`, { tag: ['@slow'] }, async ({ page, welcome, work, guard }) => {
    test.slow();
    await work.observeDispatcherControlReveals();
    await welcome.goto();
    await welcome.expectPreparedDispatcherShiftDemosVisible();
    const created = await welcome.startPreparedDispatcherDemo(condition.recipe,
      { automaticPlayback: condition.operator !== 'human_dispatcher_team' });
    expect(created.ok()).toBe(true);
    const config = created.request().postDataJSON();
    expect(config.operator_type).toBe(condition.operator);
    expect(config.interaction_mode).toBe('recommendation');
    expect(config.scenario_preset_id).toBe('pf-ch-corridor-stops');
    expect(config.disturbance_ids).toEqual(['corridor-shift-incidents']);
    expect(config.seed).toBe(42);
    expect(config.malfunction_rate).toBe(0);
    expect(config.max_episode_steps).toBe(320);
    expect((await created.json()).num_agents).toBe(16);
    await work.expectStarted(`dispatcher shift ${condition.operator}`);
    await work.expectMode(`dispatcher shift ${condition.operator}`, 'recommendation');
    await work.expectDispatcherAvatar();
    await work.expectDispatcherCompact();

    if (condition.operator === 'human_dispatcher_team') {
      const first = await work.teamProposal();
      // Opening advancement deliberately stops at the first consent request.
      await work.expectDispatcherPausedStepFrozen();
      await work.startSyntheticPlayback();
      await work.expectTeamConsentHeld(first);
      await work.pauseSyntheticPlayback();
      const held = await work.dispatcherState();
      const firstContention = held.pending.command.contention_id;
      await work.expectDispatcherAssessment(held.pending, 'awaiting_approval');
      await work.expectDispatcherDecisionEvidence(first.command_id);
      await work.expectDispatcherQueue(held.queue);
      await work.expectNativeStrategyOwnedByDispatcher(held.pending.command.strategy);
      await page.screenshot({ path: test.info().outputPath('shift-team-queue.png'), fullPage: true });
      await work.closeDispatcherDetails();
      await work.expectTeamProposal(first, 'awaiting_approval');
      await page.screenshot({ path: test.info().outputPath('shift-team-compact.png'), fullPage: true });
      expect((await work.replyDispatcherProposal('approve')).request().postDataJSON())
        .toEqual({ ...first, decision: 'approve' });
      await work.expectTeamProposal(first, 'approved');
      await work.expectDispatcherAssessment(held.pending, 'approved');
      await work.expectDispatcherPausedStepFrozen();
      expect((await work.dispatcherState()).metrics.executed).toBe(0);
      // A native paused step executes exactly the approved PP command. Its
      // accepted change remains inspectable before the next autoplay pulse.
      expect(held.pending.command.strategy).toBe('pp');
      await work.stepSyntheticPlayback();
      const accepted = await work.dispatcherState();
      expect(accepted.metrics.executed).toBe(1);
      expect(accepted.pending).toBeNull();
      expect(accepted.last_result.result.status).toBe('executed');
      expect(accepted.last_result.decision.command_id).toBe(first.command_id);
      expect(accepted.last_result.decision.command.strategy).toBe('pp');
      await work.expectDispatcherAssessment(accepted.last_result.decision, 'executed');
      await work.expectDispatcherDecisionEvidence(first.command_id);
      await page.screenshot({ path: test.info().outputPath('shift-team-accepted-change.png'), fullPage: true });
      await work.closeDispatcherDetails();
      await work.startSyntheticPlayback();

      let state = await work.dispatcherState();
      while (!state.awaiting_approval && !['finished', 'error', 'aborted'].includes(state.run_status)) {
        state = await work.nextDispatcherShiftState(state.logical_time);
      }
      expect(state.run_status).toBe('running');
      expect(state.metrics.executed).toBe(1);
      const second = await work.teamProposal();
      expect(second.command_id).not.toBe(first.command_id);
      expect((await work.dispatcherState()).pending.command.contention_id).not.toBe(firstContention);
      await work.pauseSyntheticPlayback();
      expect((await work.replyDispatcherProposal('decline')).request().postDataJSON())
        .toEqual({ ...second, decision: 'decline' });
      await work.expectDispatcherPausedStepFrozen();
      const declined = await work.dispatcherState();
      expect(declined.pending).toBeNull();
      expect(declined.metrics.executed).toBe(1);
      expect(declined.metrics.declined).toBe(1);
      await work.expectDispatcherDecisionEvidence(second.command_id);
      await page.screenshot({ path: test.info().outputPath('shift-team-declined.png'), fullPage: true });
      await work.openDispatcherMonitor();
      const exported = await work.exportDispatcher();
      expect(exported.operator_type).toBe('human_dispatcher_team');
      expect(exported.technical_result).toBe('incomplete');
      expect(exported.events.filter((event: any) => event.kind === 'result'
        && event.result.status === 'executed').map((event: any) => event.decision.command_id)).toEqual([first.command_id]);
      expect(exported.events.filter((event: any) => event.kind === 'result'
        && event.result.status === 'declined').map((event: any) => event.decision.command_id)).toEqual([second.command_id]);
      await writeFile(test.info().outputPath('shift-team-export.json'), JSON.stringify(exported, null, 2));
      await work.closeDispatcherMonitor();
    } else {
      await work.expectSyntheticPlayback();
      await work.pauseSyntheticPlayback();
      const paused = await work.dispatcherState();
      expect(paused.last_result.result.status).toBe('executed');
      await work.expectDispatcherAssessment(paused.last_result.decision, 'executed');
      await work.expectDispatcherDecisionEvidence(paused.last_result.decision.command_id);
      await work.expectNativeStrategyOwnedByDispatcher(paused.last_result.decision.command.strategy);
      await page.screenshot({ path: test.info().outputPath('shift-dispatcher-evidence.png'), fullPage: true });
      await work.closeDispatcherDetails();
      await work.startSyntheticPlayback();
      let state = await work.dispatcherState();
      let maintainCommand: string | null = null;
      let reassessedMaintain = false;
      while (!['finished', 'error', 'aborted'].includes(state.run_status)) {
        state = await work.nextDispatcherShiftState(state.logical_time);
        if (!maintainCommand && state.last_result?.result.status === 'executed'
          && state.last_result.decision.command.strategy === 'keep') {
          await work.pauseSyntheticPlayback();
          const kept = await work.dispatcherState();
          expect(kept.pending).toBeNull();
          maintainCommand = kept.last_result.decision.command_id;
          await work.expectDispatcherMaintaining(kept.last_result.decision);
          await page.screenshot({ path: test.info().outputPath('shift-maintain-compact.png'), fullPage: true });
          await work.startSyntheticPlayback();
          // A genuine accepted no-op remains map-anchored during playback;
          // pausing alone must not be what removes the persistent A cursor.
          await work.expectDispatcherKeepOnMap();
          state = await work.dispatcherState();
        } else if (maintainCommand && !reassessedMaintain && state.last_result?.result.status === 'executed'
          && state.last_result.decision.command.strategy === 'keep'
          && state.last_result.decision.command_id !== maintainCommand) {
          await work.expectDispatcherKeepOnMap();
          reassessedMaintain = true;
        }
      }
      expect(state.run_status).toBe('finished');
      expect(maintainCommand, 'full shift: at least one real keep assessment was visible during playback').toBeTruthy();
      expect(reassessedMaintain, 'full shift: another accepted keep assessment stays on the map without an A click').toBe(true);
      await work.expectDispatcherLiveState('finished');
      await work.openDispatcherMonitor();
      const exported = await work.exportDispatcher();
      await work.closeDispatcherMonitor();
      expect(exported.technical_result).toBe('complete');
      expect(exported.simulation_result).toBe('all_arrived');
      expect(exported.metrics.arrived).toBe(16);
      expect(exported.metrics.total_trains).toBe(16);
      await work.expectDisplayedPolicy(exported.policy);
      expect(exported.arrival_reference.source).toBe('latest_arrival');
      // This scene uses the existing Flatland timetable deadlines. Count all
      // measured arrivals in the denominator, including on-time arrivals.
      expect(exported.metrics.delay_denominator).toBe(16);
      expect(exported.metrics.total_arrival_delay).toEqual(expect.any(Number));
      expect(exported.metrics.total_arrival_delay).toBeGreaterThanOrEqual(0);
      const executions = exported.events.filter((event: any) => event.kind === 'result' && event.result.status === 'executed');
      expect(executions.length).toBeGreaterThan(1);
      const keeps = executions.filter((event: any) => event.decision.command.strategy === 'keep');
      const replans = executions.filter((event: any) => event.decision.command.strategy === 'pp');
      expect(keeps.length, 'full shift: the dispatcher genuinely reassesses and maintains its course').toBeGreaterThan(1);
      expect(replans.length, 'full shift: genuine PP changes remain in the same audit trail').toBeGreaterThan(1);
      expect(keeps.map((event: any) => event.decision.command_id)).toContain(maintainCommand);
      expect(new Set(executions.map((event: any) => event.decision.command.contention_id)).size).toBeGreaterThan(1);
      expect(new Set(executions.map((event: any) => event.decision.command_id)).size).toBe(executions.length);
      expect(exported.metrics.executed).toBe(executions.length);
      const strategyDecisions = exported.events.filter((event: any) => event.kind === 'planned'
        && event.decision.command.kind === 'strategy').map((event: any) => event.decision);
      for (const decision of strategyDecisions) {
        expect(decision.explanation.forecast_step).toBe(decision.offer.step);
      }
      const last = executions.at(-1);
      await work.expectDispatcherDecisionEvidence(last.decision.command_id);
      await work.expectDispatcherEffect(last.decision.command_id);
      await work.expectDispatcherReferenceLabels('plan', 'latest_arrival');
      expect(exported.effects.every((effect: any) => effect.causal_claim === false)).toBe(true);
      expect(exported.effects.find((effect: any) => effect.command_id === last.decision.command_id).after.arrived).toBe(16);
      const times = exported.events.map((event: any) => event.elapsed_ms);
      expect(times.every((elapsed: unknown) => typeof elapsed === 'number' && elapsed >= 0)).toBe(true);
      expect(times).toEqual([...times].sort((a: number, b: number) => a - b));
      await writeFile(test.info().outputPath('shift-complete-export.json'), JSON.stringify(exported, null, 2));
      await page.screenshot({ path: test.info().outputPath('shift-complete.png'), fullPage: true });
      await work.closeDispatcherDetails();
      await work.expectDispatcherLiveState('finished');
      await page.screenshot({ path: test.info().outputPath('shift-complete-compact.png'), fullPage: true });
    }
    await work.expectDispatcherRevealsOnlyPending();
    guard.expectClean(`dispatcher shift ${condition.operator}`);
  });
}
