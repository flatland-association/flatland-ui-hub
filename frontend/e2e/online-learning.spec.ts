import { expect, test } from './support/fixtures';

const DEFAULT_SOURCES = {
  policy_predictions: true,
  user_interactions: true,
  counterfactual_evaluations: true,
  distillation_targets: true,
  experience_samples: true,
};
const DEFAULT_COMPARISON_POLICIES = ['deadlock_avoidance', 'shortest_path', 'learned_ppo'];

test('Learning Monitor worker controls follow backend state', async ({ page, welcome, work }) => {
  const currentScenario = 'gen:30x30:3:107';
  const status: Record<string, unknown> = {
    state: 'idle',
    alive: false,
    available: true,
    run_id: 'mock-online-run',
    stable_version: 0,
    scenario: currentScenario,
    learning_settings: {
      scenarios: [currentScenario, 'pf-ch-wn-wal-long-approach'],
      learning_sources: DEFAULT_SOURCES,
      comparison_policies: DEFAULT_COMPARISON_POLICIES,
    },
  };
  const actions: string[] = [];
  const transitions: Record<string, Record<string, unknown>> = {
    start: { state: 'running', alive: true },
    pause: { state: 'paused', alive: true },
    resume: { state: 'running', alive: true },
    stop: { state: 'stopped', alive: false },
  };

  await page.route('**/lab/online/status', (route) => route.fulfill({ json: status }));
  for (const action of Object.keys(transitions)) {
    await page.route(`**/lab/online/${action}`, async (route) => {
      actions.push(action);
      Object.assign(status, transitions[action]);
      const key = action === 'stop' ? 'stopped' : action === 'start' ? 'started' : 'sent';
      await route.fulfill({ json: { [key]: true } });
    });
  }

  await welcome.goto();
  await welcome.openDoor('build');
  const created = await welcome.pressStart('build · Learning Monitor controls');
  expect(created.ok(), 'build · Learning Monitor controls: session created').toBe(true);
  await work.expectStarted('build · Learning Monitor controls');
  await work.openPanel('online-learning');

  await expect(work.startLearningButton).toBeVisible();
  await work.startLearningButton.click();
  await expect(work.pauseLearningButton).toBeVisible();
  await expect(work.stopLearningButton).toBeVisible();
  await expect(work.currentTrainingScenario).toContainText(currentScenario);
  await work.trainingScenarioPool.click();
  await expect(work.trainingScenarioEntries).toHaveCount(2);

  await work.pauseLearningButton.click();
  await expect(work.resumeLearningButton).toBeVisible();
  await work.resumeLearningButton.click();
  await expect(work.pauseLearningButton).toBeVisible();
  await work.stopLearningButton.click();

  await expect(work.startLearningButton).toBeVisible();
  await expect(work.pauseLearningButton).toHaveCount(0);
  await expect(work.resumeLearningButton).toHaveCount(0);
  await expect(work.stopLearningButton).toHaveCount(0);
  expect(actions).toEqual(['start', 'pause', 'resume', 'stop']);
});

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
