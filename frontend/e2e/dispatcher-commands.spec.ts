import { writeFile } from 'node:fs/promises';
import { expect, test } from './support/fixtures';
import { STEP_TIMEOUT, type WelcomePage, type WorkingScreen } from './support/pages';

/** Native text insertion exercises the field Wispr can target; no speech app is mocked. */
async function launchTeam(welcome: WelcomePage, work: WorkingScreen) {
  await welcome.goto();
  expect((await welcome.startPreparedDispatcherDemo('team')).ok()).toBe(true);
  await work.expectStarted('dispatcher text commands');
  return work.teamProposal();
}

test('dispatcher text commands · opt in, cancel, clear and persist across reload', async ({ page, welcome, work, guard }) => {
  await launchTeam(welcome, work);
  await work.expectDispatcherCommandEntry(false);
  await work.openSessionSettings();
  await work.selectSessionSettingsTab('basic');
  await work.expectDispatcherCommandsDraft(false);
  await work.setDispatcherCommandsDraft(true);
  await work.cancelSessionSettings();
  await work.expectDispatcherCommandEntry(false);
  await work.openSessionSettings();
  await work.selectSessionSettingsTab('basic');
  await work.expectDispatcherCommandsDraft(false);
  await work.setDispatcherCommandsDraft(true);
  await work.applySessionSettings();
  await work.expectDispatcherCommandEntry(true);
  await work.fillDispatcherCommand('approve');
  await work.configureDispatcherCommands(false);
  await work.expectDispatcherCommandEntry(false);
  await work.configureDispatcherCommands(true);
  await work.expectDispatcherCommandEntry(true);
  await expect(work.dispatcherCommandInput).toHaveValue('');
  await work.pauseSyntheticPlayback();
  await page.reload();
  await welcome.expectShown();
  await work.openSessionSettings();
  await work.selectSessionSettingsTab('basic');
  await work.expectDispatcherCommandsDraft(true);
  await work.cancelSessionSettings();
  expect((await welcome.startPreparedDispatcherDemo('team')).ok()).toBe(true);
  await work.expectStarted('persisted dispatcher text commands');
  await work.teamProposal();
  await work.expectDispatcherCommandEntry(true);
  await expect(work.dispatcherCommandInput).toHaveValue('');
  await work.pauseSyntheticPlayback();
  await work.configureDispatcherCommands(false);
  await page.reload();
  await welcome.expectShown();
  await work.openSessionSettings();
  await work.selectSessionSettingsTab('basic');
  await work.expectDispatcherCommandsDraft(false);
  await work.cancelSessionSettings();
  guard.expectClean('dispatcher text command preference');
});

test('dispatcher text commands · typing and invalid text do nothing, explicit commands use real controls', async ({ page, welcome, work, guard }) => {
  const proposal = await launchTeam(welcome, work);
  await work.configureDispatcherCommands(true);
  const before = work.dispatcherControlRequestCount();
  await work.fillDispatcherCommand('pause');
  await work.expectTeamConsentHeld(proposal);
  await work.expectSyntheticPlayback();
  expect(work.dispatcherControlRequestCount()).toBe(before);
  for (const text of ['do not pause', 'please reverse these trains']) {
    await work.fillDispatcherCommand(text);
    await work.submitDispatcherCommand();
    await work.expectDispatcherCommandFeedback('unknown');
    expect(work.dispatcherControlRequestCount()).toBe(before);
    await work.expectSyntheticPlayback();
    expect((await work.dispatcherState()).metrics.executed).toBe(0);
  }
  await work.fillDispatcherCommand('  PaUsE. ');
  await work.submitDispatcherCommandAndWait('pause');
  await work.expectDispatcherCommandFeedback('submitted');
  await work.expectDispatcherPausedStepFrozen();
  await work.fillDispatcherCommand('resume');
  await work.submitDispatcherCommandAndWait('play', 'enter');
  await work.expectDispatcherCommandFeedback('submitted');
  await work.expectSyntheticPlayback();
  await work.expectTeamConsentHeld(proposal);
  const heldStep = await work.dispatcherLiveStep();
  await work.fillDispatcherCommand('decline proposal');
  const declined = await work.submitDispatcherCommandAndWait('dispatcher/decision');
  expect(declined.request().postDataJSON()).toEqual({ ...proposal, decision: 'decline' });
  await work.expectDispatcherCommandFeedback('submitted');
  await work.expectNoTeamProposal();
  await work.expectDispatcherLiveStepAfter(heldStep);
  await work.fillDispatcherCommand('take over');
  const ownership = await work.submitDispatcherCommandAndWait('dispatcher/ownership', 'enter');
  expect(ownership.request().postDataJSON()).toEqual({ owner: 'human' });
  await work.expectDispatcherCommandFeedback('submitted');
  await work.expectDispatcherLiveState('human');
  expect(work.dispatcherControlRequestCount()).toBe(before + 4);
  const result = await work.dispatcherState();
  expect(result.owner).toBe('human');
  expect(result.metrics.declined).toBe(1);
  expect(result.metrics.executed).toBe(0);
  await page.screenshot({ path: test.info().outputPath('dispatcher-text-controls.png'), fullPage: true });
  guard.expectClean('dispatcher explicit text controls');
});

test('dispatcher text commands · approve while paused never implies Play and executes the bound proposal once', async ({ page, welcome, work, guard }) => {
  const proposal = await launchTeam(welcome, work);
  await work.configureDispatcherCommands(true);
  await work.pauseSyntheticPlayback();
  const before = work.dispatcherControlRequestCount();
  await work.fillDispatcherCommand('approve proposal.');
  await work.expectDispatcherPausedStepFrozen();
  expect(work.dispatcherControlRequestCount()).toBe(before);
  expect((await work.dispatcherState()).metrics.executed).toBe(0);
  const approved = await work.submitDispatcherCommandAndWait('dispatcher/decision', 'enter');
  expect(approved.request().postDataJSON()).toEqual({ ...proposal, decision: 'approve' });
  expect((await approved.json()).approved_command_id).toBe(proposal.command_id);
  await work.expectDispatcherCommandFeedback('submitted');
  await work.expectTeamProposal(proposal, 'approved');
  await work.expectDispatcherPausedStepFrozen();
  expect(work.dispatcherControlRequestCount()).toBe(before + 1);
  expect((await work.dispatcherState()).metrics.executed).toBe(0);
  await page.screenshot({ path: test.info().outputPath('dispatcher-text-approved-paused.png'), fullPage: true });
  await work.fillDispatcherCommand('resume');
  await work.submitDispatcherCommandAndWait('play');
  await expect.poll(async () => (await work.dispatcherState()).metrics.executed,
    { timeout: STEP_TIMEOUT.default }).toBe(1);
  const executed = await work.dispatcherLiveStep();
  await work.expectDispatcherLiveStepAfter(executed);
  await work.fillDispatcherCommand('pause');
  await work.submitDispatcherCommandAndWait('pause');
  await work.expectDispatcherPausedStepFrozen();
  const result = await work.dispatcherState();
  const executions = result.events.filter((event: any) => event.kind === 'result'
    && event.decision.command_id === proposal.command_id && event.result.status === 'executed');
  expect(executions).toHaveLength(1);
  expect(executions[0].source).toBe('digital_shift_partner');
  expect(result.metrics.executed).toBe(1);
  await work.openDispatcherMonitor();
  await writeFile(test.info().outputPath('dispatcher-text-export.json'), JSON.stringify(await work.exportDispatcher(), null, 2));
  await work.closeDispatcherMonitor();
  guard.expectClean('dispatcher text approval');
});

test('dispatcher text commands · old approval text cannot retarget a replacement proposal', async ({ welcome, work, guard }) => {
  const old = await launchTeam(welcome, work);
  await work.configureDispatcherCommands(true);
  await work.pauseSyntheticPlayback();
  await work.fillDispatcherCommand('approve');
  await work.takeOverDispatcher();
  await work.expectDispatcherLiveState('human');
  await work.delegateDispatcher();
  await work.startSyntheticPlayback();
  const fresh = await work.teamProposal();
  expect(fresh.command_id).not.toBe(old.command_id);
  expect(fresh.generation).toBeGreaterThan(old.generation);
  await work.pauseSyntheticPlayback();
  await expect(work.dispatcherCommandInput).toHaveValue('approve');
  const before = work.dispatcherControlRequestCount();
  // Enter refocuses the nonempty field; that must keep its original binding.
  await work.submitDispatcherCommand('enter');
  await work.expectDispatcherCommandFeedback('stale');
  expect(work.dispatcherControlRequestCount()).toBe(before);
  await work.expectTeamProposal(fresh, 'awaiting_approval');
  const rejected = await work.dispatcherState();
  expect(rejected.pending.command_id).toBe(fresh.command_id);
  expect(rejected.awaiting_approval).toBe(true);
  expect(rejected.approved_command_id).toBeNull();
  expect(rejected.metrics.executed).toBe(0);
  expect(rejected.metrics.cancelled).toBe(1);
  await work.fillDispatcherCommand('');
  await work.fillDispatcherCommand('approve');
  const approved = await work.submitDispatcherCommandAndWait('dispatcher/decision');
  expect(approved.request().postDataJSON()).toEqual({ ...fresh, decision: 'approve' });
  await work.expectTeamProposal(fresh, 'approved');
  await work.expectDispatcherPausedStepFrozen();
  expect((await work.dispatcherState()).metrics.executed).toBe(0);
  guard.expectClean('dispatcher stale text context');
});
