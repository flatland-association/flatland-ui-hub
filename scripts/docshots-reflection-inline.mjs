// Screenshots for #160 (docs/plans/reflection-inline/), on the Plan B condition
// `plan-b-p01` with the Plan B deployment config, leg 1: every UI element the
// plan changes, before or after.
//   <prefix>-1-dialog.png        the working screen with the reflection open
//                                 after a decision in «Plan / KI / Mensch»,
//   <prefix>-2-dialog-text.png   the reflection itself (the two sentences #160 drops),
//   <prefix>-3-panel.png         the decision panel and its title,
//   <prefix>-4-log.png           the decision log, opened, with that decision,
//   <prefix>-5-guide.png         the guide with its "Reflexion öffnen" after closing the reflection,
//   <prefix>-6-finish.png        the finish button, with the reflection left unanswered.
// Prints whether the run was paused while the reflection was open.
// Run once on `main` with prefix `before`, once on the branch with `after`.
//
// Run:
//   UI_CONFIG=frontend/public/ui-configs/plan-b.json ./start-demo.sh   # production build on :8000
//   npm i --prefix /tmp/pptr puppeteer-core
//   NODE_PATH=/tmp/pptr/node_modules CHROME=/usr/bin/chromium node scripts/docshots-reflection-inline.mjs docs/plans/reflection-inline before
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
const shot = async (sel, name, pad = 8, maxH = 900) => {
  const el = await page.$(sel);
  if (!el) { console.log(`${prefix}: no ${sel}, ${name} skipped`); return; }
  const b = await el.boundingBox();
  await page.screenshot({ path: `${out}/${prefix}-${name}.png`, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + 2 * pad, height: Math.min(maxH, b.height + 2 * pad) } });
};
// The sim clock as the page shows it: "Schritt: 7 / 180" in the footer.
const clock = () => page.evaluate(() => document.body.innerText.match(/Schritt:\s*(\d+)\s*\/\s*\d+/)?.[1] ?? null);

await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('flatland_lang', 'de'); });
await page.goto(`${BASE}/#/experiment/plan-b-p01`, { waitUntil: 'networkidle2' });
await page.reload({ waitUntil: 'networkidle2' });
await wait(2000);
await click('sbb-button.welcome-start');
await wait(5000);
if (await page.$('.briefing-actions sbb-button')) { await click('.briefing-actions sbb-button'); await wait(1500); }
await page.waitForSelector('app-mode-intro sbb-button', { timeout: 30000 });
await click('app-mode-intro sbb-button');
await wait(8000);

// A decision: pick the first train in the Fahrplan, let the panel compute the
// three courses, take the plan.
await click('app-timetable tr.tt-row');
await page.waitForSelector('app-proposal-compare .pc-take', { timeout: 60000 });
await wait(1000);
await shot('app-panel-shell[data-panel-type="proposal-compare"]', '3-panel', 8, 470);
await click('app-proposal-compare .pc-take');
await wait(3000);

const dialog = await page.$('app-tour-reason-dialog .reason-dialog');
const inline = await page.$('app-proposal-compare app-reflection-prompt');
console.log(`${prefix}: reflection as dialog=${!!dialog}, in the panel=${!!inline}`);
const t0 = await clock();
await wait(4000);
const t1 = await clock();
console.log(`${prefix}: clock while the reflection is open: ${t0} -> ${t1} (${t0 === t1 ? 'paused' : 'running'})`);
await page.screenshot({ path: `${out}/${prefix}-1-dialog.png` });
await shot(dialog ? 'app-tour-reason-dialog .reason-dialog' : 'app-panel-shell[data-panel-type="proposal-compare"]', '2-dialog-text');

// Close it unanswered: the guide offers to reopen it (before), the log names it (after).
await page.evaluate(() => document.querySelector('app-reflection-prompt .rp-close')?.click());
await wait(1500);
await shot('app-tour-guide', '5-guide', 4, 200);

// The decision log's entries are collapsed by default under Plan B: open them
// with the toggle in its head (#150).
const logShell = 'app-panel-shell[data-panel-type="decision-log"]';
await page.evaluate((sel) => document.querySelector(`${sel} .dl-toggle`)?.click(), logShell);
await wait(1500);
console.log(`${prefix}: decision log entries shown after the toggle: ${!!(await page.$(`${logShell} .dl-list`))}`);
await shot(logShell, '4-log');

// The finish button with the reflection still open.
await shot('app-toolbar', '6-finish', 4, 120);
await browser.close();
