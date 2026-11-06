// Screenshots for #168 (docs/plans/zwl-default/), on the Plan B condition
// `plan-b-p01` with the Plan B deployment config, leg 1 just after its start:
//   <prefix>-1-screen.png      the working screen,
//   <prefix>-2-centre-top.png  the centre panel's top: title (or none) and tabs,
//   <prefix>-3-after-click.png the working screen after a click on the
//                              centre panel's top edge, where the header is.
// Run once on `main` with prefix `before`, once on the branch with `after`.
// Prints the tabs (the active one starred), whether the panel has a title,
// and whether the click collapsed it.
//
// Run:
//   UI_CONFIG=frontend/public/ui-configs/plan-b.json ./start-demo.sh   # production build on :8000
//   npm i --prefix /tmp/pptr puppeteer-core
//   NODE_PATH=/tmp/pptr/node_modules CHROME=/usr/bin/chromium node scripts/docshots-zwl-default.mjs docs/plans/zwl-default after
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
const CENTRE = 'app-panel-shell[data-panel-type="view-tabs"]';
const state = () => page.evaluate((sel) => {
  const s = document.querySelector(sel);
  return {
    title: s.querySelector('.layout-panel-shell__title')?.textContent.trim() ?? null,
    tabs: [...s.querySelectorAll('.view-tabs__tab')].map((t) => t.textContent.trim() + (t.classList.contains('on') ? '*' : '')),
    tabFontSize: getComputedStyle(s.querySelector('.view-tabs__tab') ?? s).fontSize,
    contentShown: !!s.querySelector('app-view-tabs'),
  };
}, CENTRE);

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

console.log(`${prefix}:`, JSON.stringify(await state()));
await page.screenshot({ path: `${out}/${prefix}-1-screen.png` });
const box = await (await page.$(CENTRE)).boundingBox();
await page.screenshot({ path: `${out}/${prefix}-2-centre-top.png`, clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: 130 } });
// Where the header is (or was): the panel's top edge, right of the tabs.
await page.mouse.click(box.x + box.width - 40, box.y + 20);
await wait(1500);
console.log(`${prefix} after a click on the top edge:`, JSON.stringify(await state()));
await page.screenshot({ path: `${out}/${prefix}-3-after-click.png` });
await browser.close();
