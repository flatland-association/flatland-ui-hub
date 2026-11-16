// Screenshots for #134 (docs/plans/plan-b-control-group/), leg 1 of a Plan B
// condition with the Plan B deployment config, of what the control group
// changes:
//   <prefix>-1-guide.png          the guide strip (step 6 "Reflexion")
//   <prefix>-2-plan-ki-mensch.png "Plan / KI / Mensch" after "Halten" on the
//                                 stopped train: option chips, Mensch course,
//                                 the comparison ("Vergleich")
//   <prefix>-3-map-options.png    the option strip at the selected train on
//                                 the Streckenspiegel ("… im Panel vergleichen")
//   <prefix>-4-reflection.png     the reflection dialog after taking a course
//   <prefix>-5-screen.png         the working screen at the decision
// Run once on `main` with condition `plan-b-p01` and prefix `before`, once on
// the branch with `plan-b-control-p01` and `after`. A step whose element is
// missing is reported and skipped, so the `after` run shows what is gone.
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
  if (el) await el.evaluate((e) => e.scrollIntoView({ block: 'start' }));
  const box = el && (await el.boundingBox());
  await page.screenshot({ path: `${out}/${prefix}-${name}.png`, ...(box ? { clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + 2 * pad, height: box.height + 2 * pad } } : {}) });
};

await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('flatland_lang', 'de'); });
await page.goto(`${BASE}/#/experiment/${condition}`, { waitUntil: 'networkidle2' });
await page.reload({ waitUntil: 'networkidle2' });
await wait(2000);
await click('sbb-button.welcome-start');
await wait(5000);
if (await page.$('.briefing-actions sbb-button')) { await click('.briefing-actions sbb-button'); await wait(1500); }
await page.waitForSelector('app-mode-intro sbb-button', { timeout: 30000 });
await click('app-mode-intro sbb-button');
await wait(3000);
await shot('1-guide', 'app-tour-guide', 0);

// The scripted breakdown: wait until the impact panel lists the stopped train.
await page.waitForSelector('[data-panel-type="impact"] .ip-item', { timeout: 600000 });
await wait(1500);
await click('[data-panel-type="impact"] .ip-item');
await click('.view-tabs__tab', 'Streckenspiegel');
await wait(1500);
await click('[data-panel-type="proposal-compare"] .pc-option', 'Halten');
await page.waitForFunction(() => !!document.querySelector('[data-panel-type="proposal-compare"] .pc-course--human:not(.pc-course--empty)') || !document.querySelector('[data-panel-type="proposal-compare"] .pc-option'), { timeout: 120000 }).catch(() => console.log(`${prefix}: no Mensch course`));
await wait(1500);
// Taller, so the whole panel (courses and comparison) fits in the right column.
await page.setViewport({ width: 1600, height: 1600 });
await wait(1500);
await shot('2-plan-ki-mensch', '[data-panel-type="proposal-compare"]');
await shot('3-map-options', '.map-train-options', 60);
await shot('5-screen');
console.log(`${prefix}:`, JSON.stringify(await page.evaluate(() => ({
  chips: [...document.querySelectorAll('.pc-option')].map((b) => b.textContent.trim()),
  courses: [...document.querySelectorAll('.pc-course-name')].map((b) => b.textContent.trim()),
  compare: !!document.querySelector('.pc-compare'),
  mapStrip: !!document.querySelector('.map-train-options'),
  guideSteps: [...document.querySelectorAll('app-tour-guide')].map((g) => g.innerText.includes('Reflexion')),
}))));

// Take a course: the human's if there is one, else the AI's.
(await click('[data-log="proposals.takeHuman"]')) || (await click('[data-log="proposals.takeAi"]'));
await page.waitForSelector('.reason-dialog', { timeout: 20000 }).catch(() => console.log(`${prefix}: no reflection dialog`));
await wait(1500);
await shot('4-reflection', '.reason-dialog');
await browser.close();
