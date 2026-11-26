// Screenshots for docs/plans/plan-b-small-changes.md, on the uc2-1 leg of the
// test condition `plan-b-uc2` (Plan B layout, German UI):
//   1-zwl.png   the ZWL panel at about step STEP: the time unit in the header,
//               train names at the now-line, the now-line 20 steps below the top.
// Prints the step it was taken at and the texts read from the page.
//
// Run:
//   UI_CONFIG=frontend/public/ui-configs/plan-b.json ./start-demo.sh   # production build on :8000
//   NODE_PATH=<puppeteer-core>/node_modules node scripts/docshots-plan-b-small-changes.mjs docs/plans/plan-b-small-changes
//
// Env: BASE (default http://127.0.0.1:8000), CHROME (Chrome/Chromium binary),
// STEP (default 28, the step of the first shots).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const [out = 'docshots'] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://127.0.0.1:8000';
const STEP = Number(process.env.STEP ?? 28);
const W = 1600, H = 1000;
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=de-CH'], defaultViewport: { width: W, height: H } });
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
/** The step the ZWL's now-line stands at, from its time axis: the tick labels
 *  and the now-line's height. */
const step = () => page.evaluate(() => {
  const ticks = [...document.querySelectorAll('app-zwl .zwd__time:not(.zwd__time-unit)')]
    .map((t) => ({ v: Number(t.textContent), y: Number(t.getAttribute('y')) - 3 })).filter((t) => Number.isFinite(t.v));
  const now = document.querySelector('app-zwl .zwd__now');
  if (ticks.length < 2 || !now) return null;
  const [a, b] = ticks;
  const y = Number(now.getAttribute('y1'));
  return Math.round(a.v + ((y - a.y) / (b.y - a.y)) * (b.v - a.v));
});

// German UI, a clean slate.
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('flatland.lang', 'de'); });
await page.goto(`${BASE}/#/experiment/plan-b-uc2`, { waitUntil: 'networkidle2' });
await page.reload({ waitUntil: 'networkidle2' });
await wait(2000);
await click('sbb-button.welcome-start');
await wait(5000);
await click('.briefing-actions sbb-button');
await page.waitForSelector('app-mode-intro sbb-button', { timeout: 30000 });
await wait(1000);
await click('app-mode-intro sbb-button');
await page.waitForSelector('app-zwl .zwd__now', { timeout: 60000 });

// Let the run reach STEP; start it if the condition doesn't start on its own.
for (let i = 0, s = await step(); (s ?? 0) < STEP && i < 240; i++, s = await step()) {
  if (i === 10 && (s ?? 0) === 0) await page.evaluate(() => document.querySelector('[data-log="toolbar.play"], app-toolbar .play')?.click());
  await wait(500);
}
// Pause where the toolbar offers it, so the shot shows one step.
await page.evaluate(() => document.querySelector('[data-log="toolbar.pause"]')?.click());
await wait(1500);

const at = await step();
console.log(`step: ${at}`);
console.log(`time unit: ${(await text('app-zwl .zwd__header .zwd__time-unit')).join('')}`);
console.log(`names at the now-line: ${(await text('app-zwl .zwd__train-label')).join(' | ')}`);
console.log(`"Zu jetzt" shown: ${(await page.$('app-zwl .zwd__to-now')) !== null}`);
const panel = await page.$('app-view-tabs') ?? await page.$('app-zwl');
await panel.screenshot({ path: `${out}/1-zwl.png` });
console.log(`wrote ${out}/1-zwl.png`);

await page.evaluate(() => localStorage.removeItem('flatland_experiment_run_v1'));
await browser.close();
