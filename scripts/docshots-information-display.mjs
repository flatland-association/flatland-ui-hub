// Screenshots for docs/plans/information-display.md (#150): the Ereignisse
// cards and the decision log, on Plan B and on a default condition.
//
// Needs the backend on :8000 serving a production build (backend/static).
// Usage: node scripts/docshots-information-display.mjs <out-dir> <before|after> [condition]
//   condition defaults to plan-b-p01; colearning-experiment is the default-layout run.
import { createRequire } from 'node:module';
const puppeteer = createRequire(import.meta.url)('puppeteer-core');

const [out, label, cond = 'plan-b-p01'] = process.argv.slice(2);
const B = 'http://127.0.0.1:8000';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=de-CH'],
  defaultViewport: { width: 1600, height: 1800 },
});
const page = await browser.newPage();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (sel) => {
  if (!(await page.evaluate((s) => { const e = document.querySelector(s); e?.click(); return !!e; }, sel))) throw new Error(`no ${sel}`);
};
// Clip by the bounding rect: an element screenshot cuts off panels taller than the viewport.
const shot = async (sel, name) => {
  const r = await page.evaluate((s) => {
    const b = document.querySelector(s)?.getBoundingClientRect();
    return b && { x: b.left, y: b.top + window.scrollY, width: b.width, height: b.height };
  }, sel);
  if (!r) return console.log('missing', sel);
  await page.screenshot({ path: `${out}/${cond}-${name}-${label}.png`, clip: r, captureBeyondViewport: true });
  console.log('shot', `${cond}-${name}-${label}`);
};
const LOG = 'app-panel-shell[data-panel-type="decision-log"]';

await page.goto(`${B}/`, { waitUntil: 'networkidle2' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('flatland_lang', 'de'); });
await page.goto(`${B}/#/experiment/${cond}`, { waitUntil: 'networkidle2' });
await page.reload({ waitUntil: 'networkidle2' });
await wait(2000);
await click('sbb-button.welcome-start');
await wait(5000);
if (await page.$('.briefing-actions sbb-button')) { await click('.briefing-actions sbb-button'); await wait(1500); }
await page.waitForSelector('app-mode-intro sbb-button', { timeout: 30000 });
await click('app-mode-intro sbb-button');
await wait(4000);
// Runs with autoStart are already playing, and the button can go away meanwhile.
await page.evaluate(() => document.querySelector('app-toolbar [data-log="toolbar.play"]')?.click());

// Until the system holds the affected train: its override card is the one #150 shows.
for (let i = 0; i < 120; i++) {
  const n = await page.evaluate(() => document.querySelectorAll('app-notifications-panel li.notif').length);
  if (n >= 3) break;
  await wait(1000);
}
await wait(1500);
console.log('cards:', await page.evaluate(() =>
  [...document.querySelectorAll('app-notifications-panel li.notif .content')].map((c) => c.innerText.replace(/\s+/g, ' '))));
await shot('app-panel-shell[data-panel-type="notifications"]', 'ereignisse');
await shot(LOG, 'decision-log');
if (await page.$('app-decision-log-panel .dl-toggle[aria-expanded="false"]')) {
  await click('app-decision-log-panel .dl-toggle');
  await wait(500);
  await shot(LOG, 'decision-log-opened');
}
await browser.close();
