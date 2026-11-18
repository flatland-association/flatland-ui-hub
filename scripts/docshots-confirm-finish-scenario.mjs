// Screenshots for #180 (docs/plans/confirm-finish-scenario/), on the Plan B
// condition `plan-b-p01` with the Plan B deployment config, German UI:
//   1-<prefix>-finish-button.png  leg 1 running: the finish button,
//   1-<prefix>-dialog.png         after its click: the dialog, the simulation paused,
//   2-<prefix>-finish.png         after "Ja" (before: after the click): leg 2's intro card,
//   3-<prefix>-back.png           after "Zurück": leg 1 again, playing.
// The number is the row of the plan's §4.2.
// Run once on `main` with prefix `before` (only the finish button and what its
// click does), once on the branch with `after`. Prints what it read from the page.
//
// Run:
//   UI_CONFIG=frontend/public/ui-configs/plan-b.json ./start-demo.sh   # production build on :8000
//   npm i --prefix /tmp/pptr puppeteer-core
//   NODE_PATH=/tmp/pptr/node_modules node scripts/docshots-confirm-finish-scenario.mjs docs/plans/confirm-finish-scenario after
//
// Env: BASE (default http://127.0.0.1:8000), CHROME (Chrome/Chromium binary).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const [out = 'docshots', prefix = 'after'] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://127.0.0.1:8000';
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=de-CH'], defaultViewport: { width: 1600, height: 1000 } });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (sel, label) => {
  const ok = await page.evaluate((sel, label) => {
    const el = [...document.querySelectorAll(sel)].find((e) => !label || e.textContent.includes(label));
    if (!el) return false; el.click(); return true;
  }, sel, label);
  if (!ok) throw new Error(`no ${sel} ${label ?? ''}`);
};
const shot = (n, name) => page.screenshot({ path: `${out}/${n}-${prefix}-${name}.png` });
const read = async (label) => console.log(prefix, label, JSON.stringify(await page.evaluate(() => ({
  dialog: document.querySelector('sbb-dialog')?.isOpen ?? null,
  step: document.querySelector('footer.footer')?.textContent.match(/Schritt:\s*(\d+)/)?.[1] ?? null,
  leg: [...document.querySelectorAll('app-experiment-progress .xp__step.is-current')].map((e) => e.textContent.trim()).join('|'),
  intro: document.querySelector('app-mode-intro h2, app-mode-intro sbb-title')?.textContent.trim() ?? null,
}))));

// German UI, a clean slate.
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('flatland.lang', 'de'); });
await page.goto(`${BASE}/#/experiment/plan-b-p01`, { waitUntil: 'networkidle2' });
await page.reload({ waitUntil: 'networkidle2' });
await wait(2000);
await click('sbb-button.welcome-start');
await wait(5000);
await click('.briefing-actions sbb-button');
await page.waitForSelector('app-mode-intro sbb-button', { timeout: 30000 });
await click('app-mode-intro sbb-button');
await wait(8000);
await read('leg 1 running');
await shot(1, 'finish-button');

await click('app-toolbar sbb-secondary-button', 'Szenario abschliessen');
await wait(1500);
await read('after the finish click');
if (await page.evaluate(() => document.querySelector('sbb-dialog')?.isOpen === true)) {
  await shot(1, 'dialog');
  await wait(2000);
  await read('2 s later, still asking (the step stays)');
  await click('sbb-dialog sbb-secondary-button', 'Zurück');
  await wait(3000);
  await read('after Zurück');
  await shot(3, 'back');
  await click('app-toolbar sbb-secondary-button', 'Szenario abschliessen');
  await wait(1500);
  await click('sbb-dialog sbb-button', 'Ja');
  await wait(4000);
}
await read('after the finish');
await shot(2, 'finish');
// The leg's record (the persisted run state holds the run record's `legs`).
console.log(prefix, 'leg 1 record:', await page.evaluate(() => {
  const leg = JSON.parse(localStorage.getItem('flatland_experiment_run_v1') ?? '{}').shiftHistory?.[0];
  return JSON.stringify({ finishReason: leg?.finishReason, finishConfirm: leg?.finishConfirm });
}));

await page.evaluate(() => localStorage.removeItem('flatland_experiment_run_v1'));
await browser.close();
