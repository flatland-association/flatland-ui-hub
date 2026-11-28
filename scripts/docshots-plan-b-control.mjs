// Screenshots for docs/plans/plan-b-control-group.md, on the first UC2
// scenario of a Plan B condition (after the tutorial), with the Plan B
// deployment config, of what the control group changes:
//   <prefix>-1-mode-intro.png      the intro card before the scenario
//   <prefix>-2-plan-ki-mensch.png  "Plan / KI / Mensch" after "Halten" on the
//                                  selected train: option chips, Mensch course,
//                                  the comparison ("Vergleich")
//   <prefix>-3-map-options.png     the option strip at the selected train on
//                                  the Streckenspiegel ("… im Panel vergleichen")
//   <prefix>-4-reflection.png      the reflection under the decision in the
//                                  "Entscheidungsprotokoll" after taking a course
//   <prefix>-5-screen.png          the working screen at the decision
//   <prefix>-6-progress.png        the progress bar: tutorial, scenarios,
//                                  questionnaires
// Run once on `main` with condition `plan-b-p01` and prefix `before`, once on
// the branch with `plan-b-control-group-p01` and `after` (Recommendation in
// its first UC2 scenario). A step whose element is missing is reported and
// skipped, so the `after` run shows what is gone.
//
// Run:
//   UI_CONFIG=frontend/public/ui-configs/plan-b.json ./start-demo.sh   # production build on :8000
//   npm i --prefix /tmp/pptr puppeteer-core
//   NODE_PATH=/tmp/pptr/node_modules node scripts/docshots-plan-b-control.mjs docs/plans/plan-b-control-group before plan-b-p01
//
// Env: BASE (default http://127.0.0.1:8000), CHROME (Chrome/Chromium binary).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const [out = 'docshots', prefix = 'before', condition = 'plan-b-p01'] = process.argv.slice(2);
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
  if (!ok) console.log(`${prefix}: no ${sel} ${label ?? ''}`);
  return ok;
};
const shot = async (name, sel, pad = 8) => {
  const el = sel ? await page.$(sel) : null;
  if (sel && !el) { console.log(`${prefix}: ${name}: no ${sel}`); return; }
  if (el) await el.evaluate((e) => e.scrollIntoView({ block: 'nearest' }));
  // The element's box, cut to the panels it scrolls in (the decision log's
  // reflection is taller than its panel), in page coordinates.
  const box = el && (await el.evaluate((e) => {
    let { left, top, right, bottom } = e.getBoundingClientRect();
    for (let a = e.parentElement; a; a = a.parentElement) {
      if (!/(auto|scroll|hidden)/.test(getComputedStyle(a).overflowY)) continue;
      const r = a.getBoundingClientRect();
      left = Math.max(left, r.left); top = Math.max(top, r.top); right = Math.min(right, r.right); bottom = Math.min(bottom, r.bottom);
    }
    return { x: left + window.scrollX, y: top + window.scrollY, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  }));
  if (sel && (!box || box.width === 0)) { console.log(`${prefix}: ${name}: ${sel} not visible`); return; }
  await page.screenshot({ path: `${out}/${prefix}-${name}.png`, ...(box ? { clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + 2 * pad, height: box.height + 2 * pad } } : {}) });
};

// German UI, a clean slate.
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('flatland.lang', 'de'); });
await page.goto(`${BASE}/#/experiment/${condition}`, { waitUntil: 'networkidle2' });
await page.reload({ waitUntil: 'networkidle2' });
await wait(2000);
await click('sbb-button.welcome-start');
await wait(5000);
if (await page.$('.briefing-actions sbb-button')) { await click('.briefing-actions sbb-button'); await wait(1500); }

// The tutorial: start it, finish it at once ("Ja" in the dialog, #180).
await page.waitForSelector('app-mode-intro sbb-button', { timeout: 30000 });
await click('app-mode-intro sbb-button');
await wait(6000);
await click('app-toolbar sbb-secondary-button', 'Szenario abschliessen');
await wait(1500);
if (await page.evaluate(() => document.querySelector('sbb-dialog')?.isOpen === true)) await click('sbb-dialog sbb-button', 'Ja');

// The first UC2 scenario: its intro card, then start it.
await page.waitForSelector('app-mode-intro sbb-button', { timeout: 60000 });
await wait(1500);
await shot('1-mode-intro', 'app-mode-intro', 0);
await click('app-mode-intro sbb-button');
await wait(8000);
await shot('6-progress', 'app-experiment-progress', 0);

// A train with courses: pick a row of the Fahrplan, wait for the panel's
// courses. A train without courses is skipped.
await click('.view-tabs__tab', 'Streckenspiegel');
let row = 0;
for (;;) {
  const rows = await page.$$('app-timetable tr.tt-row');
  if (row >= rows.length) { console.log(`${prefix}: no train with courses`); break; }
  await page.evaluate((i) => document.querySelectorAll('app-timetable tr.tt-row')[i]?.click(), row++);
  try { await page.waitForSelector('app-proposal-compare .pc-take', { timeout: 45000 }); break; } catch { /* next train */ }
}
await wait(1000);
await click('[data-panel-type="proposal-compare"] .pc-option', 'Halten');
await page.waitForFunction(() => !!document.querySelector('[data-panel-type="proposal-compare"] .pc-course--human:not(.pc-course--empty)') || !document.querySelector('[data-panel-type="proposal-compare"] .pc-option'), { timeout: 120000 }).catch(() => console.log(`${prefix}: no Mensch course`));
await wait(1500);
await shot('5-screen');
// Taller, so the whole panel (courses and comparison) fits in the right column.
await page.setViewport({ width: 1600, height: 1600 });
await wait(1500);
await shot('2-plan-ki-mensch', '[data-panel-type="proposal-compare"]');
await shot('3-map-options', '.map-train-options', 60);
console.log(`${prefix}:`, JSON.stringify(await page.evaluate(() => ({
  intro: document.querySelector('app-mode-intro')?.innerText.slice(0, 80) ?? null,
  progress: [...document.querySelectorAll('app-experiment-progress .xp__step')].map((s) => s.textContent.trim()),
  chips: [...document.querySelectorAll('.pc-option')].map((b) => b.textContent.trim()),
  courses: [...document.querySelectorAll('.pc-course-name')].map((b) => b.textContent.trim()),
  compare: !!document.querySelector('.pc-compare'),
  mapStrip: !!document.querySelector('.map-train-options'),
}))));

// Take a course: the human's if there is one, else the AI's; the reflection
// opens under the decision in the decision log (#160).
(await click('[data-log="proposals.takeHuman"]')) || (await click('[data-log="proposals.takeAi"]'));
await page.waitForSelector('app-decision-log-panel .dl-reflection app-reflection-prompt', { timeout: 20000 }).catch(() => console.log(`${prefix}: no reflection`));
await wait(1500);
await shot('4-reflection', 'app-decision-log-panel .dl-reflection');
await browser.close();
