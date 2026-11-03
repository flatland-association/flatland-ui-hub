// Screenshots for #167 (docs/plans/toolbar-under-guide/), one per requirement.
//
// A. `colearning-experiment` (not Plan B): the toolbar under the guide strip,
//    Play and speed, no step buttons (paused, where they used to appear).
// B. `plan-b-p01`: no Play/Pause, no speed, only "Szenario abschliessen".
// Prints the toolbar's click ids and whether it sits below the guide.
//
// Run:
//   ./start-demo.sh                                  # production build on :8000
//   npm i --prefix /tmp/pptr puppeteer-core
//   NODE_PATH=/tmp/pptr/node_modules \
//   CHROME=/usr/bin/chromium node scripts/docshots-toolbar-under-guide.mjs /tmp/docshots
//
// Env: BASE (default http://127.0.0.1:8000), CHROME (Chrome/Chromium binary).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const [out = 'docshots'] = process.argv.slice(2);
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
const crop = async (name, sels, pad = 12) => {
  const box = await page.evaluate((sels) => {
    const rs = sels.flatMap((s) => [...document.querySelectorAll(s)]).map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height);
    if (!rs.length) return null;
    const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
    return { x, y, w: Math.max(...rs.map((r) => r.right)) - x, h: Math.max(...rs.map((r) => r.bottom)) - y };
  }, sels);
  if (!box) throw new Error(`no box for ${sels}`);
  const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
  await page.screenshot({ path: `${out}/${name}.png`, clip: { x, y, width: Math.min(1600 - x, box.w + 2 * pad), height: box.h + 2 * pad } });
};
const state = () => page.evaluate(() => {
  const tb = document.querySelector('app-toolbar');
  const guide = document.querySelector('app-tour-guide');
  const ids = tb ? [...tb.querySelectorAll('[data-log]')].map((e) => e.getAttribute('data-log')) : [];
  const btns = tb ? [...tb.querySelectorAll('sbb-button, sbb-secondary-button')].map((e) => e.textContent.trim().replace(/\s+/g, ' ')) : [];
  const below = tb && guide ? tb.getBoundingClientRect().top >= guide.getBoundingClientRect().bottom - 1 : null;
  return { toolbars: document.querySelectorAll('app-toolbar').length, ids, btns, toolbarBelowGuide: below };
});
const startExperiment = async (id) => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('flatland_lang', 'de'); });
  await page.goto(`${BASE}/#/experiment/${id}`, { waitUntil: 'networkidle2' });
  await page.reload({ waitUntil: 'networkidle2' });
  await wait(2000);
  await click('sbb-button.welcome-start');
  await wait(5000);
  if (await page.$('.briefing-actions sbb-button')) { await click('.briefing-actions sbb-button'); await wait(1500); }
  await click('app-mode-intro sbb-button');
  await wait(6000);
};

// A. Guided experiment, not Plan B: toolbar under the guide, Play + speed, no step buttons.
await startExperiment('colearning-experiment');
console.log('A playing:', JSON.stringify(await state()));
// Paused, where the step buttons used to appear.
if ((await state()).ids.includes('toolbar.pause')) { await click('app-toolbar sbb-button', 'Pause'); await wait(1500); }
console.log('A paused:', JSON.stringify(await state()));
await crop('1-toolbar-unter-leitfaden', ['app-tour-guide', 'app-toolbar']);
await crop('2-keine-schritt-buttons', ['app-toolbar']);

// B. Plan B: no Play/Pause, no speed, only the finish button.
await startExperiment('plan-b-p01');
console.log('B:', JSON.stringify(await state()));
await crop('3-plan-b-ohne-play-und-tempo', ['app-experiment-progress', 'app-tour-guide', 'app-toolbar']);
// The run goes on without Play: the step counter in the footer moves.
const stepNow = () => page.evaluate(() => document.querySelector('footer, .app-footer, app-status-bar')?.innerText.match(/Schritt:\s*(\d+)/)?.[1]);
const s0 = await stepNow();
await wait(5000);
console.log('B step:', s0, '->', await stepNow());
await browser.close();
