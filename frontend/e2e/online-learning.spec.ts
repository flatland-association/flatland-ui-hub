import { expect, test } from './support/fixtures';

const DEFAULT_SOURCES = {
  policy_predictions: true,
  user_interactions: true,
  counterfactual_evaluations: true,
  distillation_targets: true,
  experience_samples: true,
};
const DEFAULT_COMPARISON_POLICIES = ['deadlock_avoidance', 'shortest_path', 'learned_ppo'];

test('Learning Monitor source settings persist and reset requires confirmation', async ({ page, welcome, work }) => {
  await welcome.goto();
  await welcome.openDoor('build');
  const created = await welcome.pressStart('build · Learning Monitor sources');
  expect(created.ok(), 'build · Learning Monitor sources: session created').toBe(true);
  await work.expectStarted('build · Learning Monitor sources');
  await work.openPanel('online-learning');

  const settingsUrl = new URL('/lab/online/settings', page.url()).toString();
  const statusUrl = new URL('/lab/online/status', page.url()).toString();
  const policySource = work.learningSource('policy-predictions');

  try {
    await expect(policySource).toBeChecked();
    for (const slug of [
      'user-interactions',
      'counterfactual-evaluations',
      'distillation-targets',
      'experience-samples',
    ]) {
      await expect(work.learningSource(slug)).toBeChecked();
    }

    await work.openSessionSettings();
    await work.selectSessionSettingsTab('learning');
    const shortestPath = work.sessionSettingsPolicy('shortest-path');
    await expect(shortestPath).toBeChecked();
    const policySaved = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/lab/online/settings' && response.request().method() === 'POST',
    );
    await shortestPath.uncheck();
    expect((await policySaved).ok(), 'comparison policy change is accepted by the backend').toBe(true);
    await work.cancelSessionSettings();

    await expect(work.learningPolicy('shortest-path')).not.toBeChecked();
    let status = await page.request.get(statusUrl);
    expect(status.ok(), 'saved settings are returned by status').toBe(true);
    expect((await status.json()).learning_settings.comparison_policies).not.toContain('shortest_path');

    const saved = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/lab/online/settings' && response.request().method() === 'POST',
    );
    await policySource.uncheck();
    expect((await saved).ok(), 'source change is accepted by the backend').toBe(true);
    status = await page.request.get(statusUrl);
    expect(status.ok(), 'saved settings are returned by status').toBe(true);
    expect((await status.json()).learning_settings.learning_sources.policy_predictions).toBe(false);

    let resetRequested = false;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/lab/online/reset') resetRequested = true;
    });
    page.once('dialog', (dialog) => dialog.dismiss());
    await work.resetLearningButton.click();
    expect(resetRequested, 'dismissing reset confirmation sends no reset request').toBe(false);
  } finally {
    await page.request.post(settingsUrl, {
      data: {
        learning_sources: DEFAULT_SOURCES,
        comparison_policies: DEFAULT_COMPARISON_POLICIES,
      },
    });
  }
});
