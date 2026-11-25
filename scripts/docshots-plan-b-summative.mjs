// After screenshots for docs/plans/plan-b-control-group.md (S-5): the summative
// template `plan-b-summative-colearning-p01`, with the Plan B deployment config.
//   <prefix>-1-opening.png       the briefing's opening (D-20)
//   <prefix>-2-progress.png      the progress bar: two scenarios, no tutorial,
//                                the Schichtbilanz before the questionnaire
//   <prefix>-3-footer.png        the footer without the mode name (D-14)
//   <prefix>-4-schichtbilanz.png the Schichtbilanz: the KPI table and the
//                                reflection overview (§4.5, D-15, D-18, D-21)
// In scenario 1 a train with courses is picked in the Fahrplan, "Halten" chosen,
// the Mensch course taken and its reflection answered, so the overview has a decision with its
// reflection and the disturbance messages open at it; scenario 2 is finished
// at once.
//
// Run:
//   UI_CONFIG=frontend/public/ui-configs/plan-b.json ./start-demo.sh   # production build on :8000
//   npm i --prefix /tmp/pptr puppeteer-core
//   NODE_PATH=/tmp/pptr/node_modules node scripts/docshots-plan-b-summative.mjs docs/plans/plan-b-control-group after
//
// Env: BASE (default http://127.0.0.1:8000), CHROME (Chrome/Chromium binary).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const [out = 'docshots', prefix = 'after'] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://127.0.0.1:8000';
const CONDITION = 'plan-b-summative-colearning-p01';
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
  const box = el && (await el.boundingBox());
  await page.screenshot({ path: `${out}/${prefix}-${name}.png`, ...(box ? { clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + 2 * pad, height: box.height + 2 * pad } } : {}) });
};
const finishLeg = async () => {
  await click('app-toolbar sbb-secondary-button', 'Szenario abschliessen');
  await wait(1500);
  if (await page.evaluate(() => document.querySelector('sbb-dialog')?.isOpen === true)) await click('sbb-dialog sbb-button', 'Ja');
  await wait(2500);
};

// German UI, a clean slate.
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('flatland.lang', 'de'); });
await page.goto(`${BASE}/#/experiment/${CONDITION}`, { waitUntil: 'networkidle2' });
await page.reload({ waitUntil: 'networkidle2' });
await wait(2000);
await click('sbb-button.welcome-start');
await wait(5000);
await shot('1-opening');
if (await page.$('.briefing-actions sbb-button')) { await click('.briefing-actions sbb-button'); await wait(1500); }

// Scenario 1: start it, pick a train with courses, take a course, answer the reflection.
await page.waitForSelector('app-mode-intro sbb-button', { timeout: 60000 });
await click('app-mode-intro sbb-button');
await wait(8000);
await shot('2-progress', 'app-experiment-progress', 0);
await shot('3-footer', '.footer-demo-progress', 4);
let row = 0;
for (;;) {
  const rows = await page.$$('app-timetable tr.tt-row');
  if (row >= rows.length) { console.log(`${prefix}: no train with courses`); break; }
  await page.evaluate((i) => document.querySelectorAll('app-timetable tr.tt-row')[i]?.click(), row++);
  try { await page.waitForSelector('app-proposal-compare .pc-take', { timeout: 45000 }); break; } catch { /* next train */ }
}
await wait(1000);
// "Halten", then the Mensch course: a decision of the participant's own, which asks for its reflection.
await click('[data-panel-type="proposal-compare"] .pc-option', 'Halten');
await page.waitForFunction(() => !!document.querySelector('[data-panel-type="proposal-compare"] .pc-course--human:not(.pc-course--empty)'), { timeout: 120000 }).catch(() => console.log(`${prefix}: no Mensch course`));
await wait(1000);
await click('[data-log="proposals.takeHuman"]');
await page.waitForSelector('app-decision-log-panel app-reflection-prompt .rp-chip', { timeout: 20000 }).catch(() => console.log(`${prefix}: no reflection`));
await wait(800);
await page.evaluate(() => {
  const p = document.querySelector('app-decision-log-panel app-reflection-prompt');
  if (!p) return;
  const groups = [...p.querySelectorAll('.rp-chips')];
  for (const g of groups) g.querySelector('.rp-chip')?.click();
  const text = p.querySelector('.rp-text');
  if (text) { text.value = 'Ein Zug wartet kurz, die anderen bleiben pünktlich'; text.dispatchEvent(new Event('input', { bubbles: true })); }
});
await wait(500);
await click('app-decision-log-panel [data-log="rationale.yes"]');
await wait(1500);
await finishLeg();

// Scenario 2: finish at once, then the Schichtbilanz.
await page.waitForSelector('app-mode-intro sbb-button', { timeout: 60000 });
await click('app-mode-intro sbb-button');
await wait(5000);
await finishLeg();
await page.waitForSelector('app-tour-debrief', { timeout: 60000 });
await wait(2000);
await page.setViewport({ width: 1600, height: 1400 });
await wait(1000);
await shot('4-schichtbilanz', 'app-tour-debrief', 0);
console.log(`${prefix}:`, JSON.stringify(await page.evaluate(() => ({
  progress: [...document.querySelectorAll('app-experiment-progress .xp__step')].map((s) => s.textContent.trim()),
  footer: document.querySelector('.footer-demo-progress')?.textContent.trim().replace(/\s+/g, ' ') ?? null,
  overview: [...document.querySelectorAll('app-reflection-overview tbody tr')].map((r) => r.textContent.trim().replace(/\s+/g, ' ')),
  button: document.querySelector('app-tour-debrief .db-actions sbb-button')?.textContent.trim() ?? null,
  back: !!document.querySelector('app-tour-debrief .db-link'),
}))));
await browser.close();
