// Screenshots for #160 (docs/plans/reflection-inline/, §9 finding 3): each
// component that shows a reflection, in the setup that shows it, with the
// default deployment config (no Plan B config).
//   host-1-co-learning-reflection.png  Co-Learning study 3: the Co-Learning reflection
//                                       panel after a choice in the decision panel,
//   after-9-rationale-capture.png       the same: its short "why?" alone (§3's components table),
//   host-2-rationale-capture-rec.png    Recommendation tour `walensee-recommendation-trust`: the
//                                       "why?" prompt in the recommendations panel after accepting
//                                       a suggestion,
//   host-3-strategy-reflection.png      Director tour `corridor-director`: the strategy
//                                       reflection after applying a strategy.
// Prints, per setup, how many places show the reflection at once.
//
// Run:
//   ./start-demo.sh                                   # production build on :8000, default config
//   npm i --prefix /tmp/pptr puppeteer-core
//   NODE_PATH=/tmp/pptr/node_modules CHROME=/usr/bin/chromium node scripts/docshots-reflection-hosts.mjs docs/plans/reflection-inline
//
// Env: BASE (default http://127.0.0.1:8000), CHROME (Chrome/Chromium binary), ONLY (1, 2 or 3:
// one setup; the Director's options need a fresh server when they time out).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const [out = 'docshots'] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://127.0.0.1:8000';
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=de-CH'], defaultViewport: { width: 1600, height: 1000 } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Every element that shows a reflection, counted where it is actually rendered.
const HOSTS = 'app-reflection-prompt .rp, app-rationale-capture .rc, app-strategy-reflection .sr';

async function open(hash) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('flatland_lang', 'de'); });
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle2' });
  await page.reload({ waitUntil: 'networkidle2' });
  await wait(2000);
  const clickIf = (sel) => page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return false; el.click(); return true; }, sel);
  await clickIf('sbb-button.welcome-start');
  await wait(5000);
  for (let i = 0; i < 4; i++) {
    if (await clickIf('.briefing-actions sbb-button')) { await wait(1500); continue; }
    if (await clickIf('app-mode-intro sbb-button')) { await wait(6000); continue; }
  }
  return { page, clickIf };
}
const count = (page) => page.evaluate((sel) => document.querySelectorAll(sel).length, HOSTS);
async function shot(page, sel, name, pad = 6) {
  await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'start' }), sel);
  await wait(600);
  const el = await page.$(sel);
  if (!el) { console.log(`no ${sel}, ${name} skipped`); return; }
  const b = await el.boundingBox();
  // Inside a scrolling column the box is in viewport coordinates: clip the viewport, not the page.
  await page.screenshot({ path: `${out}/${name}.png`, captureBeyondViewport: false, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + 2 * pad, height: Math.min(900, b.height + 2 * pad) } });
}

// 1. Co-Learning study 3: pick a train by its line, take the plan.
const run = (n) => !process.env.ONLY || process.env.ONLY === String(n);
if (run(1)) {
  const { page, clickIf } = await open('#/experiment/preset-colearning-study3');
  await page.evaluate(() => document.querySelector('app-zwl g.zwd__train')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForSelector('app-proposal-compare .pc-take', { timeout: 60000 });
  await wait(1000);
  await clickIf('app-proposal-compare .pc-take');
  await wait(3000);
  const shell = 'app-panel-shell[data-panel-type="co-learning-reflection"]';
  if (!(await page.$(`${shell} app-rationale-capture .rc`))) await clickIf(`${shell} sbb-expansion-panel-header`);
  await wait(1500);
  console.log(`co-learning study 3: places showing the reflection: ${await count(page)}`);
  await shot(page, `${shell} app-co-learning-reflection`, 'host-1-co-learning-reflection');
  await shot(page, `${shell} app-rationale-capture`, 'after-9-rationale-capture', 0);
  await page.close();
}

// 2. Recommendation tour (it plays on its own): once a suggestion is on screen,
//    take an option in the impact panel, which is a human override against it.
if (run(2)) {
  const { page, clickIf } = await open('#/tour/walensee-recommendation-trust');
  await page.waitForSelector('app-recommendations-panel sbb-button[data-log="rec.accept"]', { timeout: 120000 }).catch(() => {});
  for (let i = 0; i < 60 && !(await page.$('app-impact-panel button.ip-opt:not([disabled])')); i++) {
    await clickIf('app-impact-panel li.ip-item');
    await new Promise((r) => setTimeout(r, 2000));
  }
  const took = await clickIf('app-impact-panel button.ip-opt:not([disabled])');
  await wait(3000);
  console.log(`recommendation tour: took an option=${took}, places showing the reflection: ${await count(page)}`);
  await shot(page, 'app-recommendations-panel app-rationale-capture .rc', 'host-2-rationale-capture-rec');
  await page.close();
}

// 3. Director: apply the first strategy that can be applied.
if (run(3)) {
  const { page } = await open('#/tour/corridor-director');
  // The options are computed on request, once: a second click starts over.
  await page.evaluate(() => [...document.querySelectorAll('app-strategy-options button')].find((b) => /Optionen berechnen|Compute options/.test(b.textContent))?.click());
  await page.waitForSelector('app-strategy-options .so-btn--apply:not([disabled])', { timeout: 240000 }).catch(() => {});
  const applied = await page.evaluate(() => { const b = document.querySelector('app-strategy-options .so-btn--apply:not([disabled])'); if (!b) return false; b.click(); return true; });
  await page.waitForSelector('app-strategy-reflection .sr', { timeout: 60000 }).catch(() => {});
  await wait(1500);
  console.log(`director: applied=${applied}, places showing the reflection: ${await count(page)}`);
  await shot(page, 'app-strategy-reflection .sr', 'host-3-strategy-reflection');
  await page.close();
}
await browser.close();
