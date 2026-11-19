/* Real Plan B UI proof against an already running local production build.
 * PLAYWRIGHT_PACKAGE and CHROME_BIN can point to an existing installation.
 * Usage: node browser-proof.cjs http://127.0.0.1:8130 [output-directory]
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:8130';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const output = process.argv[3] || path.join(__dirname, 'browser');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const report = { schema: 'uc2-rl-adviser-browser-proof-v1', evaluation_role: 'reused_development_demonstration',
    started_utc: new Date().toISOString(), cases: [], page_errors: [], websocket_errors: [],
    application_error_responses: [], owned_session_cleanup: [] };
  const source = process.env.APP_SOURCE_ROOT || path.resolve(__dirname, '../../..');
  report.source_commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
  const paired = JSON.parse(fs.readFileSync(path.join(__dirname, 'after-lookahead.json'), 'utf8'));
  report.model_sha256 = Object.fromEntries(Object.entries(paired.source_files).filter(([p]) => p.includes('/checkpoints/')));
  const verifyModels = () => {
    for (const [p, sha] of Object.entries(report.model_sha256))
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(source, 'backend', p))).digest('hex'), sha);
  };
  verifyModels();
  const save = () => fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(report, null, 2) + '\n');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
  const context = await browser.newContext({ viewport: { width: 2080, height: 1250 } });
  const owned = new Set();
  save();
  try {
    for (const fixture of [
      { condition: 'plan-b-uc2', preset: 'uc2-1', takeover: 16, handle: 2, stale: true, acceptAlternative: false },
      { condition: 'plan-b-p02', preset: 'tutorial', takeover: 6, handle: 1, stale: false, acceptAlternative: true },
    ]) {
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      const requests = [], previews = [], frames = [];
      page.on('pageerror', e => report.page_errors.push(String(e)));
      page.on('request', r => {
        const url = new URL(r.url());
        if (r.method() === 'POST' && url.pathname.startsWith('/session')) {
          let body; try { body = r.postDataJSON(); } catch { body = null; }
          requests.push({ path: url.pathname, body, source: 'page_click_or_page_code' });
        }
      });
      page.on('response', r => {
        if (r.status() >= 400 && new URL(r.url()).origin === new URL(base).origin)
          report.application_error_responses.push({ path: new URL(r.url()).pathname, status: r.status() });
      });
      page.on('websocket', ws => ws.on('framereceived', frame => {
        let m; try { m = JSON.parse(frame.payload); } catch { return; }
        if (m.type === 'error') report.websocket_errors.push(m);
        if (m.type === 'state') frames.push(m.state);
      }));
      const postResponse = (suffix) => page.waitForResponse(r => r.request().method() === 'POST'
        && new URL(r.url()).pathname === suffix);
      const creation = postResponse('/session');
      await page.goto(`${base}/#/experiment/${fixture.condition}/start`);
      const createdResponse = await creation;
      assert.equal(createdResponse.status(), 200);
      const created = await createdResponse.json(), sid = created.id;
      owned.add(sid);
      const creationBody = createdResponse.request().postDataJSON();
      assert.equal(creationBody.proposal_agent, 'uc2_rl');
      assert.equal(created.scenario_preset_id, fixture.preset);
      assert.equal(created.active_policy, 'deadlock_avoidance');
      const apiPost = async (suffix, body = {}) => {
        requests.push({ path: `/session/${sid}${suffix}`, body, source: 'browser_API_test_control' });
        return page.request.post(`${base}/session/${sid}${suffix}`, { data: body });
      };
      const state = async () => {
        const r = await page.request.get(`${base}/session/${sid}/state`); assert.equal(r.status(), 200); return r.json();
      };
      const advance = async target => {
        const before = await state();
        assert.ok(before.elapsed_steps <= target, 'opening passed the fixed takeover clock');
        if (before.elapsed_steps < target) {
          const r = await apiPost('/step', { policy: 'deadlock_avoidance', n_steps: target - before.elapsed_steps });
          assert.equal(r.status(), 200);
        }
        assert.equal((await state()).elapsed_steps, target);
      };
      await page.locator('app-tour-briefing sbb-button').first().click();
      await page.locator('app-mode-intro .intro-actions sbb-button').click();
      assert.equal((await apiPost('/pause')).status(), 200);
      const initialTarget = fixture.stale ? fixture.takeover - 1 : fixture.takeover;
      await advance(initialTarget);
      const proposalResponse = () => page.waitForResponse(r => r.request().method() === 'GET'
        && new URL(r.url()).pathname === `/session/${sid}/proposals`
        && new URL(r.url()).searchParams.get('handle') === String(fixture.handle));
      let pending = proposalResponse();
      await page.locator('app-timetable .tt-train-handle').filter({ hasText: new RegExp(`^#${fixture.handle}$`) }).click();
      let response = await pending;
      assert.equal(response.status(), 200);
      let preview = await response.json(); previews.push(preview);
      assert.equal(preview.ai_agent.id, 'uc2_rl');
      assert.equal(preview.source_step, initialTarget);
      await page.locator('app-proposal-compare [data-log="proposals.takeAi"]').waitFor({ state: 'visible' });
      const record = { ...fixture, session_id: sid, creation: creationBody, opening_driver: created.active_policy,
        native_horizon: (await state()).max_episode_steps, original_preview_source_step: preview.source_step };
      if (fixture.stale) {
        await advance(fixture.takeover);
        pending = postResponse(`/session/${sid}/proposals/apply`);
        await page.locator('app-proposal-compare [data-log="proposals.takeAi"]').click();
        const stale = await pending;
        assert.equal(stale.status(), 409);
        await page.locator('app-proposal-compare [data-log="proposals.refreshCourses"]').waitFor({ state: 'visible' });
        assert.equal(await page.locator('app-proposal-compare .pc-courses').count(), 0);
        assert.equal((await page.locator('app-decision-log-panel .dl-count').first().innerText()).trim(), '0');
        record.stale_rejection = { status: 409, body: stale.request().postDataJSON(),
          no_choice_recorded: true, refresh_button_visible: true };
        pending = proposalResponse();
        await page.locator('app-proposal-compare [data-log="proposals.refreshCourses"]').click();
        response = await pending; assert.equal(response.status(), 200);
        preview = await response.json(); previews.push(preview);
        assert.equal(preview.source_step, fixture.takeover);
      }
      await page.locator('app-proposal-compare .pc-toggle').click();
      const primary = preview.variants.find(v => v.id === 'ai');
      assert.ok(primary && primary.preview_token && preview.ai_alternatives.length);
      const index = fixture.acceptAlternative
        ? preview.ai_alternatives.findIndex(v => v.system.done === v.system.total) : 0;
      assert.ok(index >= 0, 'a complete non-default course is needed for exact-alternative acceptance');
      const alternative = preview.ai_alternatives[index];
      const applyCount = requests.filter(r => r.path.endsWith('/proposals/apply')).length;
      await page.locator('app-proposal-compare [data-log="proposals.inspectCourse"]').nth(index).click();
      assert.equal(requests.filter(r => r.path.endsWith('/proposals/apply')).length, applyCount);
      assert.equal((await state()).elapsed_steps, fixture.takeover);
      assert.equal((await page.request.get(`${base}/session/${sid}/play_status`)).status(), 200);
      let selected = alternative;
      if (!fixture.acceptAlternative) {
        // Restore the measured best course after proving inspection is read-only.
        await page.locator('app-proposal-compare [data-log="proposals.inspectCourse"]').nth(index).click();
        selected = primary;
      }
      assert.equal(requests.filter(r => r.path.endsWith('/proposals/apply')).length, applyCount);
      record.inspection_did_not_apply_or_advance = true;
      record.primary_candidate = primary.candidate_id;
      record.inspected_candidate = alternative.candidate_id;
      record.accepted_candidate = selected.candidate_id;
      record.accepted_non_default = selected.preview_token !== primary.preview_token;
      record.predicted = { train: selected.train, system: selected.system, metrics: selected.metrics,
        candidate_id: selected.candidate_id, intervention: selected.intervention };
      if (fixture.preset === 'uc2-1') {
        assert.equal(primary.metrics.lateness, 19);
        await page.screenshot({ path: path.join(output, '1-uc2-future-course-picker.png'), fullPage: true });
      }
      pending = postResponse(`/session/${sid}/proposals/apply`);
      await page.locator('app-proposal-compare [data-log="proposals.takeAi"]').click();
      const appliedResponse = await pending;
      assert.equal(appliedResponse.status(), 200);
      const sent = appliedResponse.request().postDataJSON(), applied = await appliedResponse.json();
      assert.equal(sent.preview_token, selected.preview_token);
      assert.equal(sent.candidate_id, selected.candidate_id);
      assert.equal(sent.source_step, fixture.takeover);
      assert.equal(sent.handle, fixture.handle);
      assert.equal(applied.policy, 'plan');
      record.acceptance = { request: sent, response: applied };
      const play = await apiPost('/play', { policy: 'deadlock_avoidance', speed: 50 });
      assert.equal(play.status(), 200);
      const begun = Date.now();
      let final;
      while (Date.now() - begun < 60000) {
        final = await state();
        if (final.episode_done) break;
        await page.waitForTimeout(100);
      }
      assert.ok(final.episode_done, 'accepted PlanPolicy course must finish under pinned DLA Play');
      assert.equal(final.agents.filter(a => a.state === 'DONE').length, selected.system.done);
      assert.equal(final.agents.find(a => a.handle === fixture.handle).arrival_time, selected.train.arrival_step);
      const lateness = final.agents.reduce((sum, a) => sum + Math.max(0, a.arrival_time - a.latest_arrival), 0);
      assert.equal(lateness, selected.metrics.lateness);
      const byHandleStep = new Map();
      for (const [handle, points] of Object.entries(selected.trajectories || {}))
        for (const point of points) byHandleStep.set(`${handle}:${point.step}`, point);
      let compared = 0;
      for (const frame of frames.filter(f => f.elapsed_steps > fixture.takeover)) {
        for (const agent of frame.agents) {
          const expected = byHandleStep.get(`${agent.handle}:${frame.elapsed_steps}`);
          if (!expected || !agent.position) continue;
          assert.deepEqual(agent.position, [expected.row, expected.col]); compared++;
        }
      }
      assert.ok(compared >= 10, 'actual Play positions must match the independently replayed preview');
      record.actual = { finish_step: final.elapsed_steps, completed: final.agents.filter(a => a.state === 'DONE').length,
        native_lateness: lateness, selected_train_arrival: final.agents.find(a => a.handle === fixture.handle).arrival_time,
        replayed_preview_positions_verified: compared, elapsed_seconds: (Date.now() - begun) / 1000 };
      record.page_requests = requests;
      assert.ok(!requests.some(r => r.path.endsWith('/policy')));
      assert.ok(requests.filter(r => /\/(step|play)$/.test(r.path)).every(r => r.body.policy === 'deadlock_avoidance'));
      if (fixture.preset === 'tutorial') await page.screenshot({ path: path.join(output, '2-tutorial-selected-course-complete.png'), fullPage: true });
      report.cases.push(record); save();
      await apiPost('/pause');
      await page.close();
      console.log(JSON.stringify({ preset: fixture.preset, candidate: selected.candidate_id, completed: record.actual.completed,
        lateness, preview_positions: compared, stale_verified: !!record.stale_rejection }));
    }
    assert.equal(report.page_errors.length, 0);
    assert.equal(report.websocket_errors.length, 0);
    assert.ok(report.application_error_responses.every(r => r.status === 409 && r.path.endsWith('/proposals/apply')));
    report.state = 'complete';
    verifyModels();
  } catch (error) {
    report.state = 'failed'; report.failure = String(error.stack || error); throw error;
  } finally {
    for (const sid of owned) {
      try {
        await context.request.post(`${base}/session/${sid}/pause`);
        const r = await context.request.delete(`${base}/session/${sid}`);
        report.owned_session_cleanup.push({ session_id: sid, status: r.status() });
      } catch (error) { report.owned_session_cleanup.push({ session_id: sid, error: String(error) }); }
    }
    await browser.close(); report.finished_utc = new Date().toISOString(); save();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
