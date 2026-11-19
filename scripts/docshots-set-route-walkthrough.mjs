// Screenshots and movie frames for the technical walk-through of setting a route
// (docs/plans/set-route-on-map/walkthrough.md), in the Plan B tutorial.
//
// Cases, the same as docs/plans/set-route-on-map/walkthrough.py:
//   none  no KI course, no route: deadlock avoidance alone (BA waits at B)
//   A     no KI course; BA's route using the side track drawn at step 3
//   B     KI course `ai-2` (the first alternative: AB on the side track) taken at
//         step 2, then BA's route using the side track drawn at step 3
//   C     BA's route using the side track drawn at step 2, then the KI course for AB taken at
//         step 3: the course is simulated with BA's route, BA stays on plan
//
// The clock is the script's: the app's /play is answered in the browser and not
// started, and the script steps the session through the backend, so every
// picture is taken at the step the walk-through names.
//
// Run (production build served by the backend, e.g. on :8001):
//   NODE_PATH=<dir with puppeteer-core> CHROME=/usr/bin/chromium \
//     node scripts/docshots-set-route-walkthrough.mjs <case> <out dir>
// Frames go to <out dir>/frames-<case>/; make a movie with ffmpeg, e.g.
//   ffmpeg -framerate 2 -i <out>/frames-A/%04d.png -vf scale=960:-2 A.gif
import { createRequire } from 'node:module';
import fs from 'node:fs';

const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const [kase = 'A', out = 'walkthrough'] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://127.0.0.1:8001';
const BA = 1;
// BA's drawn route, B → side track (1,12) → A, cell by cell as `route_through` builds it.
const ROUTE = [[2, 21], [2, 20], [2, 19], [2, 18], [2, 17], [2, 16], [2, 15], [2, 14], [1, 14], [1, 13], [1, 12], [1, 11],
  [1, 10], [2, 10], [2, 9], [2, 8], [2, 7], [2, 6], [2, 5], [2, 4], [2, 3]];
// The situation panel, the map and the right-hand panels.
const CLIP = { x: 8, y: 192, width: 1584, height: 640 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = `${out}/frames-${kase}`;
fs.rmSync(frames, { recursive: true, force: true });
fs.mkdirSync(frames, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=de-CH'],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

// ── the clock ────────────────────────────────────────────────────────
let gate = false;
let sid = null;
let elapsed = 0;
await page.setRequestInterception(true);
page.on('request', (req) => {
  const m = req.url().match(/\/session\/([^/]+)\/play$/);
  if (gate && req.method() === 'POST' && m) {
    sid = m[1];
    req.respond({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ session_id: m[1], playing: true, speed: 1, policy: 'deadlock_avoidance' }) });
  } else req.continue();
});
page.on('response', async (res) => {
  if (res.request().method() === 'POST' && /\/step$/.test(res.url())) {
    try { const j = await res.json(); if (j.elapsed_steps != null) elapsed = j.elapsed_steps; } catch { /* not json */ }
  }
});
const api = async (path, init) => (await fetch(`${BASE}/session/${sid}${path}`, init)).json();
const stepTo = async (n) => {
  while (elapsed < n) {
    const j = await api('/step', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ policy: 'deadlock_avoidance' }) });
    if (j.elapsed_steps == null) throw new Error(JSON.stringify(j));
    elapsed = j.elapsed_steps;
    if (j.all_done) break;
  }
  await wait(1000);
};

// ── page helpers ─────────────────────────────────────────────────────
const click = async (sel, label) => {
  const ok = await page.evaluate((sel, label) => {
    const el = [...document.querySelectorAll(sel)].find((e) => !label || e.textContent.includes(label));
    if (!el) return false;
    el.click();
    return true;
  }, sel, label);
  if (!ok) throw new Error(`no ${sel} ${label ?? ''}`);
};
let n = 0;
const frame = async (hold = 1) => {
  for (let i = 0; i < hold; i++) await page.screenshot({ path: `${frames}/${String(n++).padStart(4, '0')}.png`, clip: CLIP });
};
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${kase}-${name}.png`, clip: CLIP });
  console.log('shot', name, 'step', elapsed);
};
const cellPoint = (row, col) => page.evaluate((row, col) => {
  const svg = document.querySelector('app-flatland-map svg');
  const p = new DOMPoint(col * 32 + 16, row * 32 + 16).matrixTransform(svg.getScreenCTM());
  return { x: p.x, y: p.y };
}, row, col);
const coursesReady = async () => {
  for (let i = 0; i < 120; i++) {
    const ready = await page.evaluate(() => !!document.querySelector('.pc-course')
      && !document.querySelector('.pc-loading, .pc-placeholder.is-busy'));
    if (ready) return;
    await wait(500);
  }
  throw new Error('courses not ready');
};
/** Click a train on the map: selects it, or deselects it when selected. */
const toggleTrain = async (handle) => {
  const p = await page.evaluate((h) => {
    const g = [...document.querySelectorAll('app-flatland-map g.agent')]
      .find((e) => e.querySelector('text')?.textContent.trim() === String(h));
    const r = g.querySelector('circle.agent-hit').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, handle);
  await page.mouse.click(p.x, p.y);
  await wait(800);
};
const toggleBA = () => toggleTrain(BA);
const draw = async () => {
  await click('.pc-option', 'Fahrweg');
  await wait(800);
  const pts = [];
  for (const [r, c] of ROUTE) pts.push(await cellPoint(r, c));
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const [i, p] of pts.entries()) {
    await page.mouse.move(p.x, p.y, { steps: 4 });
    if (i === 12) { await wait(300); await shot('2-drawing'); await frame(2); }
  }
  await page.mouse.up();
  await wait(800);
  await coursesReady();
};
const run = async (to) => {
  while (elapsed < to) {
    await stepTo(elapsed + 1);
    await frame();
    if (await page.evaluate(() => document.body.textContent.includes('2/2 angekommen'))) break;
  }
};

// ── the tutorial, German, the clock held ─────────────────────────────
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('flatland_lang', 'de'); });
await page.goto(`${BASE}/#/experiment/plan-b-p01`, { waitUntil: 'networkidle2' });
await page.reload({ waitUntil: 'networkidle2' });
await wait(2000);
await click('sbb-button.welcome-start');
await wait(4000);
await click('.briefing-actions sbb-button');
await wait(1500);
gate = true;
await click('app-mode-intro sbb-button');
await wait(3000);
await click('[data-log="views.map"]');
await wait(1000);
await frame(2);

if (kase === 'none') {
  await run(39); // step 40 ends the scenario and the app moves on
  await shot('end');
} else if (kase === 'C') {
  await stepTo(2);
  await toggleBA();
  await coursesReady();
  await draw();
  await shot('3-mensch-course');
  await frame(3);
  await click('.pc-take--human');
  await wait(1500);
  await toggleBA();
  await stepTo(3);
  await frame();
  await toggleTrain(0); // AB
  await coursesReady();
  await shot('1-ki-course');
  await frame(3);
  await click('.pc-take--ai');
  await wait(1500);
  console.log('overrides', JSON.stringify(await api('/overrides')));
  await toggleTrain(0);
  await frame();
  await run(8);
  await shot('4-step-8');
  await run(14);
  await shot('5-step-14');
  await run(39);
  await shot('6-end');
} else {
  if (kase === 'B') {
    await stepTo(2);
    await toggleBA();
    await coursesReady();
    if (kase === 'B') {
      await click('.pc-toggle');
      await wait(500);
      console.log('alternatives', await page.evaluate(() => [...document.querySelectorAll('.pc-alternative')]
        .map((li) => li.textContent.trim().replace(/\s+/g, ' '))));
      await page.evaluate(() => document.querySelector('.pc-alternative .pc-option').click());
      await wait(1500);
    }
    await shot('1-ki-course');
    await frame(3);
    await click('.pc-take--ai');
    await wait(1500);
    await toggleBA(); // deselect: the panel keeps the taken course until then
  }
  await stepTo(3);
  await frame();
  await toggleBA();
  await coursesReady();
  await draw();
  await shot('3-mensch-course');
  await frame(3);
  await click('.pc-take--human');
  await wait(1500);
  console.log('overrides', JSON.stringify(await api('/overrides')));
  await toggleBA(); // deselect, so the map shows no popover
  await frame();
  await run(8);
  await shot('4-step-8');
  await run(14);
  await shot('5-step-14');
  await run(39);
  await shot('6-end');
}
console.log('frames', n, 'errors', errs);
await browser.close();
