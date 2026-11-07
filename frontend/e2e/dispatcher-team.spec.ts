import { writeFile } from 'node:fs/promises';
import { expect, test } from './support/fixtures';
import { DISPATCHER_TEAM_DECISIONS } from './support/matrix';
import { SYSTEM_LAYOUT, SYSTEM_LAYOUT_OPTION } from './support/panel-expectations';
import { STEP_TIMEOUT } from './support/pages';

for (const decision of DISPATCHER_TEAM_DECISIONS) {
  test(`Team dispatcher demo · recommendation · ${decision}`, async ({ page, welcome, work, guard }) => {
    await welcome.goto();
    await welcome.expectPreparedTeamDemoVisible();
    const created = await welcome.startPreparedDispatcherDemo('team');
    expect(created.ok()).toBe(true);
    const config = created.request().postDataJSON();
    expect(config.operator_type).toBe('human_dispatcher_team');
    expect(config.interaction_mode).toBe('recommendation');
    expect(config.scenario_preset_id).toBe('pf-ch-wn-wal-long-approach');
    expect(config.disturbance_ids).toEqual(['strategy-e1-breakdown-weesen']);
    await work.expectStarted(`Team dispatcher ${decision}`);
    await work.expectMode(`Team dispatcher ${decision}`, 'recommendation');
    await work.expectSyntheticPlayback();
    await work.expectDispatcherAvatar();
    const proposal = await work.teamProposal();
    await work.expectTeamConsentHeld(proposal);
    await page.screenshot({ path: test.info().outputPath('team-awaiting-consent.png'), fullPage: true });

    if (decision === 'approve') {
      await work.pauseSyntheticPlayback();
      await work.expectDispatcherLiveState('paused');
      const approved = await work.replyDispatcherProposal('approve');
      expect(approved.request().postDataJSON()).toEqual({ ...proposal, decision: 'approve' });
      const accepted = await approved.json();
      expect(accepted.approved_command_id).toBe(proposal.command_id);
      expect(accepted.awaiting_approval).toBe(false);
      await work.expectTeamProposal(proposal, 'approved');
      await work.expectDispatcherPausedStepFrozen();
      expect((await work.dispatcherState()).metrics.executed).toBe(0);
      await work.startSyntheticPlayback();
      await expect.poll(async () => (await work.dispatcherState()).metrics.executed,
        { timeout: STEP_TIMEOUT.default }).toBe(1);
      const executedAt = await work.dispatcherLiveStep();
      await work.expectDispatcherLiveStepAfter(executedAt);
      await work.pauseSyntheticPlayback();
      const result = await work.dispatcherState();
      const executions = result.events.filter((event: any) => event.kind === 'result'
        && event.decision.command_id === proposal.command_id && event.result.status === 'executed');
      expect(executions).toHaveLength(1);
      expect(executions[0].source).toBe('digital_shift_partner');
      expect(result.events.filter((event: any) => event.kind === 'human_decision'
        && event.command_id === proposal.command_id).map((event: any) => ({
          command_id: event.command_id, generation: event.generation, decision: event.decision, source: event.source,
        }))).toEqual([{ ...proposal, decision: 'approve', source: 'human' }]);
      expect(result.metrics.executed).toBe(1);
      await work.expectNoTeamProposal();
      await work.expectDispatcherActivity('executed');
      await page.screenshot({ path: test.info().outputPath('team-approved.png'), fullPage: true });
    } else if (decision === 'decline') {
      const heldStep = await work.dispatcherLiveStep();
      const declined = await work.replyDispatcherProposal('decline');
      expect(declined.request().postDataJSON()).toEqual({ ...proposal, decision: 'decline' });
      await work.expectNoTeamProposal();
      await work.expectDispatcherLiveStepAfter(heldStep);
      await work.pauseSyntheticPlayback();
      const result = await work.dispatcherState();
      expect(result.metrics.executed).toBe(0);
      expect(result.metrics.declined).toBe(1);
      expect(result.events.filter((event: any) => event.kind === 'result'
        && event.decision.command_id === proposal.command_id).map((event: any) => event.result.status)).toEqual(['declined']);
      expect(result.events.some((event: any) => event.kind === 'result'
        && event.decision.command_id === proposal.command_id && event.result.status === 'executed')).toBe(false);
      await page.screenshot({ path: test.info().outputPath('team-declined.png'), fullPage: true });
    } else {
      await work.takeOverDispatcher();
      await work.expectDispatcherLiveState('human');
      await work.expectNoTeamProposal();
      const human = await work.dispatcherState();
      expect(human.operator_type).toBe('human_dispatcher_team');
      expect(human.owner).toBe('human');
      expect(human.generation).toBeGreaterThan(proposal.generation);
      expect(human.metrics.cancelled).toBe(1);
      expect(human.metrics.executed).toBe(0);
      await work.delegateDispatcher();
      const delegated = await work.dispatcherState();
      expect(delegated.operator_type).toBe('human_dispatcher_team');
      expect(delegated.owner).toBe('agent');
      await work.startSyntheticPlayback();
      const fresh = await work.teamProposal();
      expect(fresh.command_id).not.toBe(proposal.command_id);
      expect(fresh.generation).toBeGreaterThan(proposal.generation);
      await work.expectTeamConsentHeld(fresh);
      await work.pauseSyntheticPlayback();
      expect((await work.dispatcherState()).metrics.executed).toBe(0);
      await page.screenshot({ path: test.info().outputPath('team-redelegated.png'), fullPage: true });
    }

    await work.openDispatcherMonitor();
    const exported = await work.exportDispatcher();
    expect(exported.operator_type).toBe('human_dispatcher_team');
    await writeFile(test.info().outputPath('team-export.json'), JSON.stringify(exported, null, 2));
    await work.closeDispatcherMonitor();
    guard.expectClean(`Team dispatcher ${decision}`);
  });
}

test('Team dispatcher · playback controlled by another browser and reconnect', async ({ welcome, work, guard }) => {
  await work.controlDispatcherConnection();
  await welcome.goto();
  expect((await welcome.startPreparedDispatcherDemo('team')).ok()).toBe(true);
  await work.expectStarted('Team shared playback');
  const proposal = await work.teamProposal();
  await work.controlPlaybackFromAnotherBrowser('pause');
  await work.expectDispatcherLiveState('paused');
  await work.expectDispatcherPausedStepFrozen();
  await work.controlPlaybackFromAnotherBrowser('play');
  await work.expectSyntheticPlayback();
  await work.expectTeamConsentHeld(proposal);
  await work.disconnectDispatcherUpdates();
  await work.controlPlaybackFromAnotherBrowser('pause');
  await work.reconnectDispatcherUpdates();
  await work.expectDispatcherLiveState('paused');
  await work.expectTeamProposal(proposal, 'awaiting_approval');
  await work.controlPlaybackFromAnotherBrowser('play');
  await work.expectSyntheticPlayback();
  await work.expectTeamConsentHeld(proposal);
  await work.pauseSyntheticPlayback();
  guard.expectClean('Team shared playback');
});

test('Team dispatcher · Co-Learning keeps decisions human and neutral', async ({ welcome, work, guard }) => {
  await welcome.goto();
  await welcome.openDoor('build');
  await welcome.expectDispatcherStaffingChoices();
  await welcome.selectLayout(SYSTEM_LAYOUT_OPTION);
  await welcome.selectNetwork('pf-ch-wn-wal-long-approach');
  await welcome.selectDispatcherTeam('co-learning');
  await welcome.loadDispatcherDemo();
  const created = await welcome.pressStart('Team Co-Learning');
  expect(created.ok()).toBe(true);
  const config = created.request().postDataJSON();
  expect(config.operator_type).toBe('human_dispatcher_team');
  expect(config.interaction_mode).toBe('co-learning');
  expect(config.dispatcher.profile).toBe('baseline');
  await work.expectStarted('Team Co-Learning');
  await work.expectMode('Team Co-Learning', 'co-learning');
  await work.expectPanels('Team Co-Learning', SYSTEM_LAYOUT, 'co-learning');
  await work.setSyntheticTempo(3);
  await work.startSyntheticPlayback();
  await expect.poll(async () => (await work.dispatcherState()).observation?.open_decisions ?? 0,
    { timeout: STEP_TIMEOUT.default }).toBeGreaterThan(0);
  await work.pauseSyntheticPlayback();
  await work.expectDispatcherLiveState('paused');
  await work.expectNoTeamProposal();
  const result = await work.dispatcherState();
  expect(result.operator_type).toBe('human_dispatcher_team');
  expect(result.owner).toBe('human');
  expect(result.requires_approval).toBe(false);
  expect(result.pending).toBeNull();
  expect(result.observation.neutral).toBe(true);
  expect(result.observation.allowed_commands).toEqual([]);
  expect(result.observation.preferred).toBeUndefined();
  expect(result.observation.alternatives).toBeUndefined();
  expect(result.metrics.planned).toBe(0);
  expect(result.metrics.executed).toBe(0);
  expect(result.events.some((event: any) => event.kind === 'planned' || event.kind === 'result')).toBe(false);
  guard.expectClean('Team Co-Learning');
});

test('Team dispatcher · director · consent commits native C directive', { tag: ['@slow'] }, async ({ page, welcome, work, guard }) => {
  test.slow();
  const weights = { punctuality: 2, connections: 2, stability: 5 };
  await welcome.goto();
  await welcome.openDoor('build');
  await welcome.selectLayout('preset-director-three-zones');
  await welcome.selectNetwork('pf-ch-wn-wal-long-approach');
  await welcome.selectDispatcherTeam('director');
  await welcome.setDispatcherInitialWeights(weights);
  const created = await welcome.pressStart('Team Director consent');
  expect(created.ok()).toBe(true);
  const config = created.request().postDataJSON();
  expect(config.operator_type).toBe('human_dispatcher_team');
  expect(config.interaction_mode).toBe('director');
  expect(config.dispatcher.initial).toEqual(weights);
  await work.expectStarted('Team Director consent');
  await work.expectMode('Team Director consent', 'director');
  await expect.poll(async () => (await work.dispatcherState()).awaiting_approval,
    { timeout: STEP_TIMEOUT.director }).toBe(true);
  const proposal = await work.teamProposal();
  const pending = await work.dispatcherState();
  expect(pending.pending.command.kind).toBe('directive');
  expect(pending.pending.command.weights).toEqual(weights);
  expect(pending.metrics.executed).toBe(0);
  await work.setSyntheticTempo(3);
  // Opening advance stops at consent; only explicit Play drives later pulses.
  await work.ensureSyntheticPlayback();
  await work.expectDispatcherPulseAfter(pending.logical_time);
  const awaiting = await work.dispatcherState();
  expect(awaiting.awaiting_approval).toBe(true);
  expect(awaiting.pending.command_id).toBe(proposal.command_id);
  expect(awaiting.metrics.executed).toBe(0);
  await work.pauseSyntheticPlayback();
  await work.expectDispatcherLiveState('paused');
  await page.screenshot({ path: test.info().outputPath('team-director-awaiting-consent.png'), fullPage: true });
  const approved = await work.replyDispatcherProposal('approve');
  expect(approved.request().postDataJSON()).toEqual({ ...proposal, decision: 'approve' });
  expect((await approved.json()).approved_command_id).toBe(proposal.command_id);
  await work.expectTeamProposal(proposal, 'approved');
  await work.expectDispatcherPausedStepFrozen();
  expect((await work.dispatcherState()).metrics.executed).toBe(0);
  await work.startSyntheticPlayback();
  await expect.poll(async () => (await work.dispatcherState()).metrics.executed,
    { timeout: STEP_TIMEOUT.director }).toBe(1);
  await expect.poll(async () => (await work.directorControllerState()).plan?.weights,
    { timeout: STEP_TIMEOUT.director }).toEqual([2, 2, 5]);
  expect(await work.sessionPolicy('Team Director consent')).toBe('goal_directed');
  await work.expectDirectorFocus('focus_stability');
  const confirmed = await work.dispatcherState();
  await work.expectDispatcherPulseAfter(confirmed.logical_time);
  await work.pauseSyntheticPlayback();
  const result = await work.dispatcherState();
  expect(result.events.filter((event: any) => event.kind === 'result'
    && event.decision.command_id === proposal.command_id && event.result.status === 'executed')).toHaveLength(1);
  expect(result.events.filter((event: any) => event.kind === 'directive_effective'
    && event.command_id === proposal.command_id).map((event: any) => event.weights)).toEqual([[2, 2, 5]]);
  expect(result.metrics.executed).toBe(1);
  expect(result.operator_type).toBe('human_dispatcher_team');
  await work.expectNoTeamProposal();
  await work.expectDispatcherActivity('effective');
  await work.expectDispatcherActivityWeights('2 / 2 / 5');
  await page.screenshot({ path: test.info().outputPath('team-director-confirmed.png'), fullPage: true });
  await work.openDispatcherMonitor();
  await writeFile(test.info().outputPath('team-director-export.json'), JSON.stringify(await work.exportDispatcher(), null, 2));
  await work.closeDispatcherMonitor();
  guard.expectClean('Team Director consent');
});
