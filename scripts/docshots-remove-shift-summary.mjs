// Screenshots for #174 (docs/plans/remove-shift-summary/), on the Plan B
// condition `plan-b-p01` with the Plan B deployment config, German UI. One
// picture per element the plan changes:
//   <prefix>-1-picker.png         start screen: the condition's summary and meta line,
//   <prefix>-2-briefing.png       the briefing's opening page (lead, "Ablauf"),
//   <prefix>-3-leg1-progress.png  leg 1: stepper, "noch 1 Szenario …", finish button,
//   <prefix>-4-leg2-progress.png  leg 2: stepper, "letztes Szenario …", finish button,
//   <prefix>-5-leg2-survey.png    leg 2's short questionnaire (NASA-TLX),
//   <prefix>-6-after-last-leg.png after leg 2's questionnaire: what comes next,
//   <prefix>-7-next-progress.png  the stepper and finish button at that point,
//   <prefix>-8-final-survey.png   the final questionnaire, and what is behind it.
// Run once on `main` with prefix `before`, once on the branch with `after`.
// Prints the texts read from the page.
//
// Run:
//   UI_CONFIG=frontend/public/ui-configs/plan-b.json ./start-demo.sh   # production build on :8000
//   npm i --prefix /tmp/pptr puppeteer-core
//   NODE_PATH=/tmp/pptr/node_modules CHROME=/usr/bin/chromium node scripts/docshots-remove-shift-summary.mjs docs/plans/remove-shift-summary before
//
// Env: BASE (default http://127.0.0.1:8000), CHROME (Chrome/Chromium binary),
// BRIEFING_IMAGE (optional: also write the briefing's picture of the working
// screen, 1200×750 in leg 1, e.g. frontend/public/experiments/arbeitsansicht.png).
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
const text = (sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim().replace(/\s+/g, ' ')));
const click = async (sel, label) => {
  const ok = await page.evaluate((sel, label) => {
    const el = [...document.querySelectorAll(sel)].find((e) => !label || e.textContent.includes(label));
    if (!el) return false; el.click(); return true;
  }, sel, label);
  if (!ok) throw new Error(`no ${sel} ${label ?? ''}`);
};
const shot = (name) => page.screenshot({ path: `${out}/${prefix}-${name}.png` });
/** Crop to the union of the given elements' boxes, padded. */
const crop = async (name, sels, pad = 12) => {
  const box = await page.evaluate((sels) => {
    // The start screen scrolls in its own container: bring the first one into view.
    document.querySelector(sels[0])?.scrollIntoView({ block: 'start' });
    const rs = sels.flatMap((s) => [...document.querySelectorAll(s)]).map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height);
    if (!rs.length) return null;
    const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
    return { x, y, w: Math.max(...rs.map((r) => r.right)) - x, h: Math.max(...rs.map((r) => r.bottom)) - y };
  }, sels);
  if (!box) throw new Error(`no box for ${sels}`);
  const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
  await page.screenshot({ path: `${out}/${prefix}-${name}.png`, clip: { x, y, width: Math.min(1600 - x, box.w + 2 * pad), height: Math.min(1000 - y, box.h + 2 * pad) } });
};
const finishButton = async () => (await text('app-toolbar sbb-secondary-button')).filter((t) => t.includes('→') || t.includes('Fragebogen'));
const progress = async (label) => console.log(`${prefix} ${label}: stepper:`, (await text('app-experiment-progress .xp__step')).join(' ─ '), '| count:', (await text('.xp__left')).join(''), '| finish:', (await finishButton()).join(' / '));

// German UI, a clean slate.
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('flatland.lang', 'de'); });
await page.goto(`${BASE}/#/experiment/plan-b-p01`, { waitUntil: 'networkidle2' });
await page.reload({ waitUntil: 'networkidle2' });
await wait(2000);

// 1. The picker: summary and meta line.
console.log(`${prefix} picker:`, (await text('.welcome-summary')).join(' '), '|', (await text('.welcome-layout-choice:has(select) + .welcome-tour-meta')).join(' '));
await crop('1-picker', ['.welcome-layout-choice:has(select)', '.welcome-layout-choice:has(select) + .welcome-tour-meta', '.welcome-summary', 'sbb-button.welcome-start']);

// 2. The briefing's opening page.
await click('sbb-button.welcome-start');
await wait(5000);
await shot('2-briefing');

// 3. Leg 1 running.
await click('.briefing-actions sbb-button');
await page.waitForSelector('app-mode-intro sbb-button', { timeout: 30000 });
await click('app-mode-intro sbb-button');
await wait(8000);
await progress('leg 1');
await crop('3-leg1-progress', ['app-experiment-progress', 'app-toolbar']);
if (process.env.BRIEFING_IMAGE) {
  await page.setViewport({ width: 1200, height: 750 });
  await wait(2000);
  await page.screenshot({ path: process.env.BRIEFING_IMAGE });
  await page.setViewport({ width: 1600, height: 1000 });
  await wait(1500);
}

// 4. Leg 2 running (after leg 1's short questionnaire).
await click('app-toolbar sbb-secondary-button', 'Szenario abschliessen');
await wait(1500);
await click('app-survey sbb-button', 'Submit');
await page.waitForSelector('app-mode-intro sbb-button', { timeout: 30000 });
await click('app-mode-intro sbb-button');
await wait(6000);
await progress('leg 2');
await crop('4-leg2-progress', ['app-experiment-progress', 'app-toolbar']);

// 5. Leg 2's short questionnaire.
await click('app-toolbar sbb-secondary-button', 'Szenario abschliessen');
await wait(1500);
console.log(`${prefix} leg 2 survey: sections:`, (await text('app-survey sbb-title[level="3"]')).join(' / '));
await shot('5-leg2-survey');

// 6./7. After leg 2 and its questionnaire: today the Schichtbilanz.
await click('app-survey sbb-button', 'Submit');
await wait(4000);
console.log(`${prefix} after last leg: shift screen:`, !!(await page.$('.shift-screen')), '| survey open:', !!(await page.$('app-survey')));
await shot('6-after-last-leg');
await progress('after last leg');
await crop('7-next-progress', ['app-experiment-progress', 'app-toolbar']);

// 8. The final questionnaire, and what is behind it.
if (!(await page.$('app-survey'))) {
  if (await page.$('app-tour-debrief sbb-button')) await click('app-tour-debrief sbb-button');
  else await click('app-toolbar sbb-secondary-button', 'Fragebogen');
  await wait(1500);
}
console.log(`${prefix} final survey: shift screen behind:`, !!(await page.$('.shift-screen')));
console.log(`${prefix} final survey: sections:`, (await text('app-survey sbb-title[level="3"]')).join(' / '));
await shot('8-final-survey');

await page.evaluate(() => localStorage.removeItem('flatland_experiment_run_v1'));
await browser.close();
