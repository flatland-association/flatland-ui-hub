// Screenshots for docs/plans/reflection-question-order.md (#182), on the
// Plan B condition `plan-b-p01` with the Plan B deployment config, leg 1:
// the reflection after two decisions on different trains, and the order of
// its guided questions.
//   <prefix>-1-first-decision.png    the reflection after the first decision
//   <prefix>-2-second-decision.png   the reflection after the second decision
// Prints the question labels of each, and whether the orders are the same.
// Run on `main` with prefix `before` (an order drawn per decision), on the
// branch with `after` (the default order), and on the branch with a
// `reflectionPromptQuestionOrder` in the served ui-config.json and prefix
// `after-config`.
//
// Run:
//   UI_CONFIG=frontend/public/ui-configs/plan-b.json ./start-demo.sh   # production build on :8000
//   npm i --prefix /tmp/pptr puppeteer-core
//   NODE_PATH=/tmp/pptr/node_modules node scripts/docshots-reflection-question-order.mjs docs/plans/reflection-question-order after
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
const REFLECTION = 'app-decision-log-panel .dl-reflection';
// The reflection's questions, from the first (the factors) to the last: the
// decided options above them are the same before and after.
const shot = async (sel, name, pad = 8) => {
  await page.evaluate((sel) => document.querySelector(`${sel} .rp-q`)?.scrollIntoView({ block: 'start', behavior: 'instant' }), sel);
  await wait(800);
  const box = await page.evaluate((sel) => {
    const qs = [...document.querySelectorAll(`${sel} .rp-q`)];
    if (qs.length === 0) return null;
    const r = qs.map((q) => q.getBoundingClientRect());
    const top = Math.min(...r.map((b) => b.top));
    // The clip is in page coordinates, the rectangles in viewport ones.
    return { x: Math.min(...r.map((b) => b.left)) + window.scrollX, y: top + window.scrollY, left: Math.min(...r.map((b) => b.left)), top, width: Math.max(...r.map((b) => b.right)) - Math.min(...r.map((b) => b.left)), height: Math.max(...r.map((b) => b.bottom)) - top };
  }, sel);
  if (!box) { console.log(`${prefix}: no questions in ${sel}, ${name} skipped`); return; }
  // Without captureBeyondViewport: the capture would re-lay out the page and
  // reset the panel's scroll, showing its top instead of the questions.
  // The padded box, cut to the viewport on every side (viewport coordinates;
  // the page itself does not scroll here, the panel does).
  const vp = page.viewport();
  const left = Math.max(0, box.left - pad), top = Math.max(0, box.top - pad);
  const right = Math.min(vp.width, box.left + box.width + pad), bottom = Math.min(vp.height, box.top + box.height + pad);
  if (right <= left || bottom <= top) { console.log(`${prefix}: questions outside the viewport, ${name} skipped`); return; }
  await page.screenshot({ path: `${out}/${prefix}-${name}.png`, captureBeyondViewport: false, clip: { x: left + (box.x - box.left), y: top + (box.y - box.top), width: right - left, height: bottom - top } });
};
// The guided questions as shown, without the factors question that always comes first.
const questions = () => page.evaluate(() =>
  [...document.querySelectorAll('app-reflection-prompt .rp-q > .rp-q-label')].slice(1).map((l) => l.textContent.trim()));

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

// A decision per train: pick a row of the Fahrplan, wait for the panel's
// courses, take the first. A train without courses is skipped.
const orders = [];
const names = ['1-first-decision', '2-second-decision'];
let row = 0;
while (orders.length < names.length) {
  const rows = await page.$$('app-timetable tr.tt-row');
  if (row >= rows.length) throw new Error(`only ${orders.length} decisions possible`);
  await page.evaluate((i) => document.querySelectorAll('app-timetable tr.tt-row')[i]?.click(), row++);
  try {
    await page.waitForSelector('app-proposal-compare .pc-take', { timeout: 45000 });
  } catch {
    continue;
  }
  await wait(1000);
  await click('app-proposal-compare .pc-take');
  await page.waitForSelector(`${REFLECTION} app-reflection-prompt`, { timeout: 20000 });
  await wait(1500);
  const order = await questions();
  orders.push(order);
  console.log(`${prefix}: decision ${orders.length} (Fahrplan row ${row}): ${order.join(' | ')}`);
  await shot(REFLECTION, names[orders.length - 1]);
  // Close it unanswered, so the next decision's reflection is the one shown.
  await page.evaluate(() => document.querySelector('app-reflection-prompt .rp-close')?.click());
  await wait(1500);
}
console.log(`${prefix}: same order after both decisions: ${JSON.stringify(orders[0]) === JSON.stringify(orders[1])}`);
await browser.close();
