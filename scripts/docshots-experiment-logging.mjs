// Screenshots for the experiment-logging PR (#129, docs/experiment-logging.md):
// a walk-through from the user's side, in the German UI.
//
//  1. Session Settings → "Study logging" (off by default), switched on
//  2. the two-scenario guided experiment `colearning-experiment-2x`, played
//     briefly with clicks, a zoom, a collapsed panel and the ZWL tab
//  3. the start screen's saved runs: list, selection, downloads
//  4. importing another machine's file
//  5. replaying the run: badge, controls, screens between the legs
//
// Run (a server with the production build and the study switches on):
//   cd backend && STUDY_SINK_ENABLED=1 STUDY_TRAJECTORIES_ENABLED=1 \
//     uvicorn app.main:app --port 8000 --log-config logging.study.json
//   npm i --prefix /tmp/pptr puppeteer-core
//   NODE_PATH=/tmp/pptr/node_modules CHROME=/usr/bin/chromium \
//     node scripts/docshots-experiment-logging.mjs docs/plans/experiment-logging /tmp/docshots-dl [file-to-import.json.gz]
//
// Env: BASE (default http://127.0.0.1:8000), CHROME.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const [out = 'docshots', dl = 'docshots-downloads', importFile = null] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://127.0.0.1:8000';
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(dl, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=de-CH'],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.resolve(dl) });
const errs = [];
page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Clicks the first element matching `sel` (and containing `label`), waiting for it. */
const click = async (sel, label) => {
  await page.waitForFunction(
    (sel, label) => [...document.querySelectorAll(sel)].some((e) => !label || e.textContent.includes(label)),
    { timeout: 60000 }, sel, label ?? null,
  );
  await page.evaluate((sel, label) => {
    [...document.querySelectorAll(sel)].find((e) => !label || e.textContent.includes(label)).click();
  }, sel, label ?? null);
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
/** The start screen of the guided experiment, German, after a real reload (a hash change alone is no new document). */
const startScreen = async () => {
  await page.evaluate(() => (location.hash = '#/experiment/colearning-experiment-2x'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('sbb-button.welcome-start')?.textContent.includes('Experiment starten'), { timeout: 90000 });
  await wait(1500);
};
const answerSurvey = async () => {
  await page.evaluate(() => {
    for (const row of document.querySelectorAll('app-survey .likert-buttons')) {
      const btns = row.querySelectorAll('button');
      btns[Math.floor(btns.length / 2)]?.click();
    }
  });
  await wait(300);
  await click('app-survey sbb-button', 'Submit');
};

// A clean browser, German UI.
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  localStorage.clear();
  localStorage.setItem('flatland.lang', 'de');
  await new Promise((r) => {
    const req = indexedDB.deleteDatabase('flatland_study_streams');
    req.onsuccess = req.onerror = req.onblocked = () => r();
  });
});
await startScreen();

// 1. Session Settings → "Study logging", off by default; switch it on.
await click('#shell-menu-trigger');
await wait(800);
await click('sbb-menu-button', 'Sitzungseinstellungen');
await page.waitForSelector('[data-test="study-logging"]', { timeout: 30000 });
await wait(800);
await crop('1-einstellungen-studien-logging-aus', ['[data-test="study-logging"]']);
await page.evaluate(() => document.querySelector('[data-test="study-logging"] input[type=checkbox]').click());
await wait(500);
await crop('2-einstellungen-studien-logging-an', ['[data-test="study-logging"]']);
await click('.settings-close');
await wait(800);

// 2. The guided experiment, briefly, with some activity.
await click('sbb-button.welcome-start');
await click('.briefing-actions sbb-button');
for (let leg = 0; leg < 2; leg++) {
  await click('app-mode-intro sbb-button');
  await page.waitForSelector('app-flatland-map svg', { timeout: 60000 });
  await wait(3000);
  if (await page.$('[data-log="toolbar.play"]')) await click('[data-log="toolbar.play"]');
  for (let i = 0; i < 6; i++) {
    await page.evaluate((i) => {
      const trains = document.querySelectorAll('app-flatland-map g.agent');
      trains[i % Math.max(1, trains.length)]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const offered = ['proposals.takeAi', 'proposals.keepPlan', 'rec.accept'].map((id) => document.querySelector(`[data-log="${id}"]:not([disabled])`)).filter(Boolean);
      offered[0]?.click();
    }, i);
    await wait(2500);
  }
  if (leg === 0) {
    const box = await (await page.$('app-flatland-map svg')).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel({ deltaY: 200 });
      await wait(200);
    }
    await wait(1000);
    await page.evaluate(() => document.querySelector('[data-panel-type="situation-summary"] sbb-expansion-panel-header')?.click());
    await wait(1000);
    await page.evaluate(() => [...document.querySelectorAll('.view-tabs__tab')].find((t) => t.textContent.includes('ZWL'))?.click());
    await wait(3000);
    await crop('3-fusszeile-sitzungsdaten-exportieren', ['footer.footer']);
  }
  if (await page.$('[data-log="toolbar.pause"]')) await click('[data-log="toolbar.pause"]');
  await wait(1000);
  await click('app-toolbar sbb-secondary-button', 'Szenario abschliessen');
  await wait(1500);
  await answerSurvey();
  await wait(leg === 0 ? 5000 : 3000);
}
await click('app-tour-debrief sbb-button');
await wait(1500);
await answerSurvey();
await wait(4000);

// 3. Start screen: the saved runs, opened, the run selected.
await startScreen();
await page.evaluate(() => {
  const d = document.querySelector('details.saved-runs');
  d.open = true;
  d.scrollIntoView({ block: 'center' });
});
await wait(800);
await crop('4-gespeicherte-durchlaeufe', ['details.saved-runs']);
await page.evaluate(() => document.querySelector('.saved-runs__run input[type=checkbox]').click());
await wait(500);
await crop('5-durchlauf-ausgewaehlt', ['details.saved-runs']);
await click('[data-log="savedRuns.download"]');
await wait(3000);
await click('[data-log="savedRuns.questionnaires"]');
await wait(6000);

// 4. Import another machine's file.
if (importFile) {
  await (await page.$('.saved-runs__file')).uploadFile(importFile);
  await wait(1500);
  await crop('6-datei-importiert', ['details.saved-runs']);
}

// 5. Replay the run.
await page.evaluate(() => {
  const own = [...document.querySelectorAll('.saved-runs__run')].find((li) => !li.querySelector('.saved-runs__badge'));
  own.querySelector('[data-log="savedRuns.replayRun"]').click();
});
await wait(2500);
await shot('7-wiedergabe-start');
await crop('8-wiedergabe-badge-und-steuerung', ['app-replay-badge .replay-badge', 'app-replay-controls .replay-controls']);
const scrub = (frac) => page.evaluate((frac) => {
  const s = document.querySelector('.replay-controls__slider');
  s.value = String(+s.min + (s.max - s.min) * frac);
  s.dispatchEvent(new Event('input', { bubbles: true }));
}, frac);
/** Scrub until the badge names this screen (or the recording ends). */
const scrubTo = async (screenLabel, from, to) => {
  for (let f = from; f <= to; f += 0.01) {
    await scrub(f);
    await wait(150);
    const badge = await page.$eval('[data-test=replay-badge]', (e) => e.innerText);
    if (badge.includes(screenLabel)) return true;
  }
  return false;
};
await scrub(0.35);
await wait(2500);
await shot('9-wiedergabe-mitte-szenario-1');
if (await scrubTo('Fragebogen', 0.3, 0.7)) {
  await wait(1500);
  await shot('10-wiedergabe-fragebogen-zwischen-szenarien');
}
await scrub(1);
await wait(2500);
await shot('11-wiedergabe-ende');
await click('app-replay-controls button', 'Wiedergabe beenden');
await wait(1500);

console.log('downloads:', fs.readdirSync(dl).join(', '));
console.log(errs.join('\n'));
await browser.close();
