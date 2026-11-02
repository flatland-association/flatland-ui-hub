// A replay video for the experiment-logging PR (#129, docs/experiment-logging.md),
// in the German UI: a short run of the two-scenario guided experiment
// `plan-b-p01` (select a train, "Szenario abschliessen", one answer in the
// questionnaire; the same for the second scenario; the Schichtbilanz and one
// answer in the final questionnaire), then that run replayed and recorded.
//
// Run (a server with the production build and the study switches on, ffmpeg on the PATH):
//   cd backend && STUDY_SINK_ENABLED=1 STUDY_TRAJECTORIES_ENABLED=1 uvicorn app.main:app --port 8000 --log-config logging.study.json
//   npm i --prefix /tmp/pptr puppeteer-core
//   NODE_PATH=/tmp/pptr/node_modules CHROME=/usr/bin/chromium node scripts/replay-video-experiment-logging.mjs docs/plans/experiment-logging
//
// Writes replay.webm, replay.mp4 and replay.gif (960 px wide) to the given folder.
// Env: BASE (default http://127.0.0.1:8000), CHROME, SPEED (replay speed, default 2).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const [out = 'replay-video'] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://127.0.0.1:8000';
const SPEED = process.env.SPEED ?? '2';
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=de-CH'],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (what) => console.log(new Date().toISOString().slice(11, 19), what);

/** The centre of the first element matching `sel` (containing `label`), once it is laid out. */
const centre = async (sel, label) => {
  await page.waitForFunction(
    (sel, label) => [...document.querySelectorAll(sel)].some((e) => (!label || e.textContent.includes(label)) && e.getBoundingClientRect().width),
    { timeout: 60000 }, sel, label ?? null,
  );
  return page.evaluate((sel, label) => {
    const el = [...document.querySelectorAll(sel)].find((e) => (!label || e.textContent.includes(label)) && e.getBoundingClientRect().width);
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
  }, sel, label ?? null);
};
/** A real mouse click, after a stroke to the element as a person would move. */
const realClick = async (sel, label, dx = 0) => {
  const c = await centre(sel, label);
  await page.mouse.move(c.x + dx, c.y, { steps: 15 });
  await wait(300);
  await page.mouse.click(c.x + dx, c.y);
};
/** A real click that moves to the next screen: again if `done()` does not hold after a few seconds. */
const clickOn = async (sel, label, done) => {
  for (let i = 0; i < 3; i++) {
    await realClick(sel, label);
    try {
      await page.waitForFunction(done, { timeout: 5000 });
      return;
    } catch {
      step(`again: ${sel}`);
    }
  }
  throw new Error(`no next screen after ${sel}`);
};
/** One answer, the questionnaire's first question (a slider at 30 %, or the middle of a scale), then submit. */
const answerOne = async () => {
  await page.waitForSelector('app-survey', { timeout: 60000 });
  await wait(1200);
  const first = await page.evaluate(() => {
    const q = document.querySelector('app-survey .likert-buttons, app-survey .q-scale input[type=range]');
    return q?.matches('input') ? 'range' : q ? 'likert' : null;
  });
  if (first === 'range') {
    const c = await centre('app-survey .q-scale input[type=range]');
    await realClick('app-survey .q-scale input[type=range]', null, -c.w * 0.2);
  } else if (first === 'likert') {
    await realClick('app-survey .likert-buttons button:nth-child(5)');
  }
  await wait(1200);
  await realClick('app-survey sbb-button', 'Submit');
};

// A clean browser, German UI, the guided experiment's start screen.
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  localStorage.clear();
  localStorage.setItem('flatland.lang', 'de');
  await new Promise((r) => {
    const req = indexedDB.deleteDatabase('flatland_study_streams');
    req.onsuccess = req.onerror = req.onblocked = () => r();
  });
  location.hash = '#/experiment/plan-b-p01';
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('sbb-button.welcome-start')?.textContent.includes('Experiment starten'), { timeout: 90000 });
await wait(1500);

// The run.
step('run');
await clickOn('sbb-button.welcome-start', null, () => !document.querySelector('sbb-button.welcome-start'));
await wait(2500);
await clickOn('.briefing-actions sbb-button', null, () => !!document.querySelector('app-mode-intro'));
for (let leg = 0; leg < 2; leg++) {
  step(`scenario ${leg + 1}`);
  await page.waitForSelector('app-mode-intro', { timeout: 60000 });
  await wait(2500);
  await clickOn('app-mode-intro sbb-button', null, () => !document.querySelector('app-mode-intro'));
  await page.waitForSelector('app-flatland-map svg', { timeout: 60000 });
  await wait(1500);
  if (await page.$('[data-log="toolbar.play"]')) await realClick('[data-log="toolbar.play"]');
  await page.waitForSelector('app-flatland-map g.agent', { timeout: 60000 });
  await wait(2000);
  await realClick('app-flatland-map g.agent');
  await wait(4000);
  if (await page.$('[data-log="toolbar.pause"]')) await realClick('[data-log="toolbar.pause"]');
  await wait(800);
  await clickOn('app-toolbar sbb-secondary-button', 'Szenario abschliessen', () => !!document.querySelector('app-survey'));
  await answerOne();
}
step('Schichtbilanz');
await page.waitForSelector('app-tour-debrief', { timeout: 60000 });
await wait(3500);
await clickOn('app-tour-debrief sbb-button', null, () => !!document.querySelector('app-survey'));
await answerOne();
await wait(2500);

// The replay of that run, recorded from "Abspielen" to its end.
step('replay');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('details.saved-runs', { timeout: 90000 });
await page.evaluate(() => {
  const d = document.querySelector('details.saved-runs');
  d.open = true;
  d.querySelector('[data-log="savedRuns.replayRun"]').click();
});
await page.waitForSelector('.replay-controls__slider', { timeout: 30000 });
await page.select('.replay-controls__speed select', SPEED);
await page.mouse.move(800, 500);
await wait(1500);
const webm = `${out}/replay.webm`;
const recorder = await page.screencast({ path: webm });
await wait(1000);
await realClick('app-replay-controls sbb-secondary-button', 'Abspielen');
// Polled from here: one long waitForFunction would run into the protocol timeout.
for (let i = 0; i < 1200; i++) {
  const at = await page.evaluate(() => {
    const s = document.querySelector('.replay-controls__slider');
    // The end: the replay paused itself, so "Abspielen" is back (the slider snaps to its step, short of max).
    const playing = !!document.querySelector('app-replay-controls sbb-secondary-button[icon-name="pause-small"]');
    return { end: !s || (!playing && +s.max - +s.value < 200), time: document.querySelector('.replay-controls__time')?.textContent };
  });
  if (i % 20 === 0) console.log('replay at', at.time);
  if (at.end) break;
  await wait(500);
}
// The screencast only sends a frame when the page repaints: a few mouse moves keep the end on film.
for (let i = 0; i < 6; i++) {
  await page.mouse.move(800 + (i % 2) * 6, 600);
  await wait(500);
}
if (process.env.END_SHOT) await page.screenshot({ path: process.env.END_SHOT });
await recorder.stop();
await browser.close();

// mp4 for a player, gif for the PR text (GitHub shows a gif inline).
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-vf', 'scale=1280:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', `${out}/replay.mp4`]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-vf',
  'fps=6,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', `${out}/replay.gif`]);
for (const f of ['replay.webm', 'replay.mp4', 'replay.gif']) console.log(f, (fs.statSync(`${out}/${f}`).size / 1e6).toFixed(1), 'MB');
console.log(errs.join('\n'));
