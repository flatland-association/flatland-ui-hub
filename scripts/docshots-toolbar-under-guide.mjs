// Screenshots for #167 (docs/plans/toolbar-under-guide/), one per requirement,
// all on the Plan B condition `plan-b-p01` with the Plan B deployment config:
//   1. the toolbar under the guide strip,
//   2. the toolbar row: no step buttons,
//   3. the working screen without Play/Pause and speed.
// Prints the toolbar's click ids, whether it sits below the guide, and that
// the run advances without Play. Then walks the run to its end without
// screenshots: the menu's restart entry, the run going on through the
// conflict, no run-error notice, leg 2, the Schichtbilanz and the end screen.
// Run it on an idle machine: under load the backend's play loop slows down
// and the conflict may not come within the wait.
//
// Run:
//   UI_CONFIG=frontend/public/ui-configs/plan-b.json ./start-demo.sh   # production build on :8000
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

await startExperiment('plan-b-p01');
console.log('Plan B:', JSON.stringify(await state()));
await crop('1-toolbar-unter-leitfaden', ['app-experiment-progress', 'app-tour-guide', 'app-toolbar']);
await crop('2-keine-schritt-buttons', ['app-toolbar'], 0);
await page.screenshot({ path: `${out}/3-plan-b-ohne-play-und-tempo.png` });
// The run goes on without Play: the step counter in the footer moves.
const stepNow = () => page.evaluate(() => document.querySelector('footer, .app-footer, app-status-bar')?.innerText.match(/Schritt:\s*(\d+)/)?.[1]);
const s0 = await stepNow();
await wait(5000);
console.log('B step:', s0, '->', await stepNow());

// The rest of the run, checked, not photographed
// (docs/plans/toolbar-under-guide.md §6, F8).
const footer = () => page.evaluate(() => document.querySelector('footer, .app-footer, app-status-bar')?.innerText.replace(/\s+/g, ' ') ?? '');
const restart = await page.evaluate(() => {
  const b = [...document.querySelectorAll('sbb-menu-button')].find((e) => /Durchlauf neu starten|Restart run/.test(e.textContent ?? ''));
  return b ? getComputedStyle(b.parentElement).display !== 'none' : false;
});
console.log('menu restart reachable:', restart);
// A conflict holds the affected trains (Co-Learning), the world keeps running.
let conflict = false;
for (let i = 0; i < 90 && !conflict; i++) {
  await wait(1000);
  conflict = await page.evaluate(() => !!document.querySelector('app-impact-panel')?.textContent?.match(/Zug|IC_|RE_|ICE_/) && !/kein Zug betroffen/i.test(document.querySelector('app-impact-panel')?.textContent ?? ''));
}
const f1 = await footer(); await wait(4000); const f2 = await footer();
console.log('conflict:', conflict, '| running before/after:', /Läuft/.test(f1), /Läuft/.test(f2), '|', f1.match(/Schritt: \d+/)?.[0], '->', f2.match(/Schritt: \d+/)?.[0]);
console.log('run error notice:', !!(await page.$('app-toolbar .run-error')));
// Leg 1 → its questionnaire → leg 2 → Schichtbilanz → final questionnaire → end.
await click('app-toolbar sbb-secondary-button', 'Szenario abschliessen'); await wait(1500);
await click('app-survey sbb-button', 'Submit'); await wait(5000);
await click('app-mode-intro sbb-button'); await wait(6000);
console.log('leg 2:', JSON.stringify(await state()));
await click('app-toolbar sbb-secondary-button', 'Szenario abschliessen'); await wait(1500);
await click('app-survey sbb-button', 'Submit'); await wait(3000);
console.log('Schichtbilanz:', !!(await page.$('app-tour-debrief')));
await click('app-tour-debrief sbb-button'); await wait(1500);
await click('app-survey sbb-button', 'Submit'); await wait(3000);
console.log('end screen:', (await page.$eval('.experiment-done', (e) => e.textContent.trim().replace(/\s+/g, ' ')).catch(() => null)));
await browser.close();
