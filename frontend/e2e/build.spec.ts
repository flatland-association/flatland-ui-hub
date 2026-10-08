// Build door (plan §2.2): each interaction mode × {guided demo, random, each
// backend scenario preset} in the default layout, plus every LAYOUT_PRESETS
// entry once on the guided demo (support/matrix.ts).
//
// Driven by clicks: the Build door has no deep link. The start screen has no
// mode picker, so the mode is chosen the way a user does it, on the mode tabs
// once the session runs.
import { expect, test, type Guard } from './support/fixtures';
import type { WelcomePage, WorkingScreen } from './support/pages';
import { BUILD_CASES, LAYOUT_CASES, isSlowMode, type BuildCase } from './support/matrix';
import { SYSTEM_LAYOUT_OPTION } from './support/panel-expectations';
import { expectSetupRuns } from './support/setup-check';

// KNOWN BUG 7 (docs/plans/e2e-playwright.md#known-bugs): `build · director ·
// {olten, olten-dense, olten-disrupted, olten-partially-closed,
// ecml2026-scene1-level0} · default layout` fail red until it is fixed. The
// planner exceeds its encoder caps there and its fallback finds no plan
// ("unroutable"), so no train moves under the Director. The failing check is
// `expectDirectorPlan` in support/pages.ts; the fix belongs in
// GoalDirectedPolicy._plan, backend/app/policies/goal_directed_policy.py
// These tests are not marked as expected failures.

test.describe('Build door', () => {
  for (const c of [...BUILD_CASES, ...LAYOUT_CASES]) {
    test(c.name, { tag: isSlowMode(c.mode) ? ['@slow'] : [] }, async ({ welcome, work, guard }) => {
      if (isSlowMode(c.mode)) test.slow();
      await runBuildCase(c, welcome, work, guard);
    });
  }
});

async function runBuildCase(c: BuildCase, welcome: WelcomePage, work: WorkingScreen, guard: Guard): Promise<void> {
  await welcome.goto();
  await welcome.openDoor('build');
  await welcome.selectLayout(c.layout === 'system' ? SYSTEM_LAYOUT_OPTION : c.layout);
  await welcome.selectNetwork(c.network);
  const created = await welcome.pressStart(c.name);
  expect(created.ok(), `${c.name}: POST /session`).toBe(true);
  await work.expectStarted(c.name);
  // Every session starts in Recommendation, the store's default mode.
  if (c.mode !== 'recommendation') await work.switchMode(c.mode);
  await expectSetupRuns(work, guard, { name: c.name, layout: c.layout, mode: c.mode });
}
