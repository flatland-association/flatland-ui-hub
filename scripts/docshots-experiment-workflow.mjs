// Screenshots for PR #156 (docs/plans/experiment-workflow/), one per #131 requirement.
//
// Walks the two-scenario guided experiment `colearning-experiment-2x`
// (frontend/src/app/core/demo/study-conditions.ts, briefing in
// core/demo/tour-briefings.ts) in the German UI.
//
// Run:
//   ./start-demo.sh                                  # production build on :8000
//   npm i --prefix /tmp/pptr puppeteer-core
//   NODE_PATH=/tmp/pptr/node_modules \
//   CHROME=/usr/bin/chromium node scripts/docshots-experiment-workflow.mjs \
//     /tmp/docshots /tmp/docshots-downloads
//
// Env: BASE (default http://127.0.0.1:8000), CHROME (Chrome/Chromium binary).
// To explore by hand instead: open http://localhost:8000/#/experiment/colearning-experiment-2x
// (or :4200 with `npm run start`), language Deutsch, then "Experiment starten".
import { createRequire } from 'node:module';
import fs from 'node:fs';
const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const [out = 'docshots', dl = 'docshots-downloads'] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://127.0.0.1:8000';
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(dl, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=de-CH'], defaultViewport: { width: 1600, height: 1000 } });
const page = await browser.newPage();
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
const errs = [];
page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim().replace(/\s+/g, ' ')));
const click = async (sel, label) => {
  const ok = await page.evaluate((sel, label) => {
    const el = [...document.querySelectorAll(sel)].find((e) => !label || e.textContent.includes(label));
    if (!el) return false; el.click(); return true;
  }, sel, label);
  if (!ok) throw new Error(`no ${sel} ${label ?? ''}`);
};
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
/** Crop to the union of the given elements' boxes, padded. */
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

// German UI, a clean slate.
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('flatland_lang', 'de'); });

// 1. The experimenter picks the experiment by name.
await page.goto(`${BASE}/#/experiment/colearning-experiment-2x`, { waitUntil: 'networkidle2' });
await page.reload({ waitUntil: 'networkidle2' });
await wait(2000);
console.log('lang:', await page.evaluate(() => document.documentElement.lang), 'summary:', await text('.welcome-summary'));
await crop('1-experimente-auswahl', ['sbb-selection-expansion-panel:has(sbb-radio-button-panel[value="experiments"])', '.welcome-summary', 'sbb-button.welcome-start']);

// 2. Global briefing with a screenshot.
await click('sbb-button.welcome-start');
await wait(5000);
await shot('2-briefing-mit-bild');

// 3. Per-scenario intro card, "(1/2)".
await click('.briefing-actions sbb-button');
await wait(1500);
console.log('intro 1:', await text('.intro-step'));
await shot('3-szenario-intro-1-von-2');

// 4. Scenario 1 running: stepper, guide strip, finish button.
await click('app-mode-intro sbb-button');
await wait(8000);
await shot('4-szenario-1-arbeitsansicht');
console.log('stepper:', await text('app-experiment-progress'));
await crop('5-fortschritt-und-abschliessen', ['app-experiment-progress', 'app-toolbar']);

// 6. "Szenario abschliessen" → short questionnaire after the scenario.
await click('app-toolbar sbb-secondary-button', 'Szenario abschliessen');
await wait(1500);
await shot('6-kurzfragebogen-nach-szenario');
await click('app-survey sbb-button', 'Submit');
await wait(5000);

// 7. Next scenario's own intro card, "(2/2)".
console.log('intro 2:', await text('.intro-step'));
await shot('7-szenario-intro-2-von-2');
await click('app-mode-intro sbb-button');
await wait(6000);
console.log('guide 2:', (await text('.tour-guide__groups')).join(' '));
await crop('8-szenario-2-fortschritt-tourleiste', ['app-experiment-progress', 'app-tour-guide']);

// 9. After the last scenario: Schichtbilanz over all scenarios.
await click('app-toolbar sbb-secondary-button', 'Szenario abschliessen');
await wait(1000);
await click('app-survey sbb-button', 'Submit');
await wait(3000);
console.log('legs table:', (await text('.db-legs tr')).join(' | '));
await shot('9-schichtbilanz-alle-szenarien');

// 10. Final questionnaire.
await click('app-tour-debrief sbb-button');
await wait(1500);
await shot('10-schlussfragebogen');

// 11. Done, record saved automatically.
await click('app-survey sbb-button', 'Submit');
await wait(3000);
console.log('done:', await text('.experiment-done'));
await shot('11-abschluss-gespeichert');

// 12. Resume after a reload in scenario 2.
await page.evaluate(() => localStorage.removeItem('flatland_experiment_run_v1'));
await page.goto(`${BASE}/#/experiment/colearning-experiment-2x`, { waitUntil: 'networkidle2' });
await page.reload({ waitUntil: 'networkidle2' });
await wait(2000);
await click('sbb-button.welcome-start');
await wait(5000);
await click('.briefing-actions sbb-button');
await wait(1000);
await click('app-mode-intro sbb-button');
await wait(3000);
await click('app-toolbar sbb-secondary-button', 'Szenario abschliessen');
await wait(800);
await click('app-survey sbb-button', 'Submit');
await wait(4000);
await page.reload({ waitUntil: 'networkidle2' });
await wait(2500);
console.log('resume:', await text('.welcome-resume'));
await crop('12-fortsetzen-nach-reload', ['.welcome-resume']);
await page.evaluate(() => localStorage.removeItem('flatland_experiment_run_v1'));

// 13. One-scenario guided experiment (the former tour), "(1/1)".
await page.goto(`${BASE}/#/experiment/colearning-experiment`, { waitUntil: 'networkidle2' });
await page.reload({ waitUntil: 'networkidle2' });
await wait(2000);
await click('sbb-button.welcome-start');
await wait(5000);
if (await page.$('.briefing-actions sbb-button')) { await click('.briefing-actions sbb-button'); await wait(1500); }
await click('app-mode-intro sbb-button');
await wait(7000);
console.log('n1 stepper:', await text('app-experiment-progress'));
await shot('13-ein-szenario-experiment');
await page.evaluate(() => localStorage.removeItem('flatland_experiment_run_v1'));

// 14. Plain study condition: unchanged, no stepper.
await page.goto(`${BASE}/#/experiment/preset-colearning-study3/start`, { waitUntil: 'networkidle2' });
await wait(8000);
console.log('plain stepper:', !!(await page.$('app-experiment-progress')), 'guide:', !!(await page.$('app-tour-guide')));
await shot('14-studienbedingung-unveraendert');

await wait(1000);
console.log('downloads:', fs.readdirSync(dl).join(', '));
console.log(errs.join('\n'));
await browser.close();
