// Replay walk-through for #198 (docs/plans/hide-scenario-bar/, NFR-2): a replay
// shows a run with the UI restrictions it was recorded with. Two Plan B records,
// one made on `main` before this change and one made on this branch, both
// replayed on this branch:
//   replay-<label>-1-list.png       the start screen's saved-runs list with the run,
//   replay-<label>-2-start.png      the replay of scenario 2 at 0:00,
//   replay-<label>-3-running.png    the replay of scenario 2: the working screen,
//   replay-<label>-4-bars.png       the same, cropped to the bars above the map.
// The old record replays with the guide strip and the scenario names, the new one
// without them, as each participant saw it.
//
// One browser profile (PROFILE) keeps the records in the browser's storage across
// builds, on the same origin. Steps:
//   1. serve the production build of `main` with ui-configs/plan-b.json, then
//      node scripts/docshots-hide-scenario-bar-replay.mjs record plan-b-p01
//   2. serve the build of this branch with the same config, then
//      node scripts/docshots-hide-scenario-bar-replay.mjs record plan-b-p02
//      node scripts/docshots-hide-scenario-bar-replay.mjs replay docs/plans/hide-scenario-bar
// `record` runs scenarios 1 and 2 of the condition and leaves the run;
// `replay` takes the runs of participant 01 (label `old`) and 02 (label `new`).
// NODE_PATH must hold puppeteer-core.
//
// Env: BASE (default http://127.0.0.1:8000), CHROME (Chrome/Chromium binary),
// PROFILE (browser profile dir, default ./tmp/replay-profile; delete it to start over).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const [cmd = 'replay', arg = 'docs/plans/hide-scenario-bar'] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://127.0.0.1:8000';
const PROFILE = process.env.PROFILE ?? 'tmp/replay-profile';
const W = 1600, H = 1000;
const RUN_KEY = 'flatland_experiment_run_v1';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/chromium', userDataDir: PROFILE,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=de-CH'], defaultViewport: { width: W, height: H },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim().replace(/\s+/g, ' ')));
const click = async (sel, label) => {
  const ok = await page.evaluate((sel, label) => {
    const el = [...document.querySelectorAll(sel)].find((e) => !label || e.textContent.includes(label));
    if (!el) return false; el.click(); return true;
  }, sel, label);
  if (!ok) throw new Error(`no ${sel} ${label ?? ''}`);
};
/** Crop to the union of the given elements' boxes, padded. */
const crop = async (path, sels, pad = 8) => {
  const box = await page.evaluate((sels) => {
    const rs = sels.flatMap((s) => [...document.querySelectorAll(s)]).map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height);
    if (!rs.length) return null;
    const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
    return { x, y, w: Math.max(...rs.map((r) => r.right)) - x, h: Math.max(...rs.map((r) => r.bottom)) - y };
  }, sels);
  if (!box) throw new Error(`no box for ${sels}`);
  const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
  await page.screenshot({ path, clip: { x, y, width: Math.min(W - x, box.w + 2 * pad), height: Math.min(H - y, box.h + 2 * pad) } });
};
/** What the page shows: the stepper, the guide strip, the finish button, the footer. */
const report = async (label) => {
  const guide = await page.$eval('app-tour-guide', (e) => getComputedStyle(e).display !== 'none').catch(() => false);
  console.log(`${label}: legs: ${(await text('.xp__legs > .xp__step')).join(' ─ ')} | guide strip: ${guide ? 'shown' : 'hidden'}`
    + ` | finish: ${(await text('app-toolbar sbb-secondary-button')).filter((t) => t.includes('→')).join(' / ')}`);
};
const home = async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await page.evaluate((k) => { localStorage.removeItem(k); localStorage.setItem('flatland.lang', 'de'); }, RUN_KEY);
};

if (cmd === 'record') {
  // German UI; any run left over from an earlier call is dropped, the saved records stay.
  await home();
  await page.goto(`${BASE}/#/experiment/${arg}`, { waitUntil: 'networkidle2' });
  await page.reload({ waitUntil: 'networkidle2' });
  await wait(2000);
  await click('sbb-button.welcome-start');
  await wait(5000);
  await click('.briefing-actions sbb-button');
  for (let k = 1; k <= 2; k++) {
    await page.waitForSelector('app-mode-intro sbb-button', { timeout: 30000 });
    await wait(1000);
    await click('app-mode-intro sbb-button');
    await wait(10000);
    await report(`record ${arg} scenario ${k}`);
    await click('app-toolbar sbb-secondary-button', 'Szenario abschliessen');
    await wait(4000);
  }
  await page.evaluate((k) => localStorage.removeItem(k), RUN_KEY);
} else if (cmd === 'replay') {
  fs.mkdirSync(arg, { recursive: true });
  for (const [label, participant] of [['old', '01'], ['new', '02']]) {
    await home();
    await page.reload({ waitUntil: 'networkidle2' });
    await wait(2000);
    // The list sits in the «Experimente» panel of the start screen.
    await click('sbb-radio-button-panel[value="experiments"]');
    await wait(1000);
    await page.evaluate(() => { const d = document.querySelector('details.saved-runs'); if (d) d.open = true; });
    await wait(500);
    // The newest run of the participant (the list's title names the condition).
    const idx = await page.$$eval('.saved-runs__run', (runs, p) => runs.findIndex((r) => r.querySelector('.saved-runs__title')?.textContent.includes(`p${p}`)
      || r.querySelector('.saved-runs__title')?.textContent.includes(` ${p}`)), participant);
    if (idx < 0) throw new Error(`no saved run of participant ${participant}: ${(await text('.saved-runs__title')).join(' | ')}`);
    const run = (await page.$$('.saved-runs__run'))[idx];
    await run.evaluate((r) => r.scrollIntoView({ block: 'center' }));
    await wait(300);
    console.log(`replay ${label}: run ${(await run.evaluate((r) => r.textContent.trim().replace(/\s+/g, ' ')))}`);
    await page.screenshot({ path: `${arg}/replay-${label}-1-list.png` });
    // Scenario 2's replay button.
    const buttons = await run.$$('.saved-runs__legs [data-log="savedRuns.replay"]');
    if (buttons.length < 2) throw new Error(`run of participant ${participant} has ${buttons.length} replayable scenarios`);
    await buttons[1].evaluate((b) => b.click());
    await page.waitForSelector('app-replay-controls', { timeout: 30000 });
    await page.evaluate(() => [...document.querySelectorAll('app-replay-controls sbb-secondary-button')].find((b) => b.getAttribute('icon-name') === 'pause-small')?.click());
    await wait(2500);
    await page.screenshot({ path: `${arg}/replay-${label}-2-start.png` });
    // Seek to the middle of the scenario: the working screen.
    await page.$eval('.replay-controls__slider', (s) => {
      s.value = String(Math.round((+s.min + +s.max) / 2));
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await wait(3000);
    await report(`replay ${label}`);
    await page.screenshot({ path: `${arg}/replay-${label}-3-running.png` });
    await crop(`${arg}/replay-${label}-4-bars.png`, ['app-experiment-progress', 'app-tour-guide', 'app-toolbar']);
  }
} else {
  throw new Error(`unknown command ${cmd}: record <condition> | replay <out dir>`);
}
await browser.close();
