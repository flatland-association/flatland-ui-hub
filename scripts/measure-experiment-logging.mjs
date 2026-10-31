// Measurement run for the experiment logging
// (docs/plans/experiment-logging-frontend-and-replay.md §10.1, results in
// docs/experiment-logging.md "Data size and performance").
//
// Clicks through the two-scenario guided experiment `plan-b-p01`
// like scripts/docshots-experiment-workflow.mjs does, with scripted
// participant activity at a fixed rate, and measures how much data the
// logging creates in the browser and on the server, and what it costs.
//
// Run:
//   ./start-demo.sh                                  # or start the server yourself, see below
//   npm i --prefix /tmp/pptr puppeteer-core
//   NODE_PATH=/tmp/pptr/node_modules CHROME=/usr/bin/chromium STUDY_LOGGING=1 SERVER_RECORDS=backend/data/study-records node scripts/measure-experiment-logging.mjs /tmp/measure
//
// `plan-b-p01` enforces "Study logging", so STUDY_LOGGING=0 (A) has no
// effect there: measure A on a guided condition without `studyLogging`.
//
// The three configurations of §10.1 differ only in the switches:
//   A  STUDY_LOGGING=0, server without the call log and trajectories
//   B  STUDY_LOGGING=1, same server
//   C  STUDY_LOGGING=1, server with UVICORN_LOG_CONFIG=logging.study.json,
//      STUDY_TRAJECTORIES_ENABLED=1 and STUDY_SINK_ENABLED=1
//
// Env:
//   BASE            app URL (default http://127.0.0.1:8000)
//   CHROME          Chrome/Chromium binary
//   STUDY_LOGGING   1 or 0: the "Study logging" setting for the run (default 1)
//   PLAY_SECONDS    seconds each leg plays (default 60)
//   SPEED           play speed level 1–5 (default 3, one step per second)
//   SERVER_RECORDS  the server's STUDY_RECORDS_DIR, to measure the run folder (optional)
//   LABEL           a name for this run in the output folder (default the configuration letter or "run")
//
// Writes <out>/<date>_<commit>_<label>/result.json and result.md, and keeps
// the downloaded files next to them.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const [outRoot = 'measure'] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://127.0.0.1:8000';
const STUDY_LOGGING = (process.env.STUDY_LOGGING ?? '1') === '1';
const PLAY_SECONDS = Number(process.env.PLAY_SECONDS ?? 60);
const SPEED = Number(process.env.SPEED ?? 3);
const SERVER_RECORDS = process.env.SERVER_RECORDS ?? null;
const LABEL = process.env.LABEL ?? 'run';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let out = null;
const t0 = Date.now();

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=de-CH'],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const cdp = await page.createCDPSession();
await cdp.send('Performance.enable');
const errs = [];
page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));

// Frame times and long tasks, from the first document on.
await page.evaluateOnNewDocument(() => {
  const perf = (window.__measure = { frames: [], longtasks: [] });
  let last = performance.now();
  const tick = (now) => {
    perf.frames.push([now, now - last]);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) perf.longtasks.push([e.startTime, e.duration]);
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    /* no longtask support */
  }
});

/** Clicks the first element matching `sel` (and containing `label`), waiting up to 30 s for it. */
const click = async (sel, label) => {
  try {
    await page.waitForFunction(
      (sel, label) => [...document.querySelectorAll(sel)].some((e) => !label || e.textContent.includes(label)),
      { timeout: 30000 }, sel, label ?? null,
    );
  } catch {
    if (out) await page.screenshot({ path: path.join(out, 'failed.png') }).catch(() => {});
    throw new Error(`no ${sel} ${label ?? ''}`);
  }
  await page.evaluate((sel, label) => {
    [...document.querySelectorAll(sel)].find((e) => !label || e.textContent.includes(label)).click();
  }, sel, label ?? null);
};
const heap = async () => {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? null;
};

// A clean slate: German UI, nothing saved, "Study logging" as configured.
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
const commit = await page.evaluate(async () => {
  try {
    return (await (await fetch('/build-info.json', { cache: 'no-store' })).json()).commit ?? 'dev';
  } catch {
    return 'dev';
  }
});
out = path.join(outRoot, `${new Date(t0).toISOString().slice(0, 16).replace(/[:T]/g, '-')}_${commit}_${LABEL}`);
const dl = path.join(out, 'downloads');
fs.mkdirSync(dl, { recursive: true });
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.resolve(dl) });

await page.evaluate(async (on) => {
  localStorage.clear();
  localStorage.setItem('flatland.lang', 'de');
  localStorage.setItem('flatland_study_logging', on ? '1' : '0');
  await new Promise((r) => {
    const req = indexedDB.deleteDatabase('flatland_study_streams');
    req.onsuccess = req.onerror = req.onblocked = () => r();
  });
}, STUDY_LOGGING);
const storageBefore = await page.evaluate(async () => (await navigator.storage.estimate()).usage ?? null);

// A hash-only change is no new document, so `goto` would wait for an event that never comes.
await page.evaluate(() => (location.hash = '#/experiment/plan-b-p01'));
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
// The German UI is up once the start button carries its German label.
await page.waitForFunction(() => document.querySelector('sbb-button.welcome-start')?.textContent.includes('Experiment starten'), { timeout: 60000 });
await wait(1500);
await click('sbb-button.welcome-start');
await wait(5000);
await click('.briefing-actions sbb-button');
await wait(1500);

/** Answers every Likert item with its middle option, then submits. */
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

/** Fixed participant activity, every 3 s: a train on the map, then a decision
 *  if one is offered (accept and override in turn), and the centre tab once. */
const DECISIONS = ['rec.accept', 'proposals.takeAi', 'strategy.apply', 'risk.accept', 'rec.reject', 'proposals.keepPlan', 'risk.override'];
const activity = { trainClicks: 0, decisions: 0, tabSwitches: 0 };
const playLeg = async () => {
  await page.evaluate((level) => {
    const slider = document.querySelector('[data-log="toolbar.speed"]');
    if (slider) {
      slider.value = String(level);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, SPEED);
  // A leg may already be playing (the pause button shows instead).
  if (await page.$('[data-log="toolbar.play"]')) await click('[data-log="toolbar.play"]');
  await page.screenshot({ path: path.join(out, `leg-${legs.length + 1}.png`) });
  const end = Date.now() + PLAY_SECONDS * 1000;
  for (let i = 0; Date.now() < end; i++) {
    const did = await page.evaluate((i, decisions) => {
      const done = { train: false, decision: false, tab: false };
      const trains = document.querySelectorAll('app-flatland-map g.agent');
      if (trains.length) {
        trains[i % trains.length].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        done.train = true;
      }
      const offered = decisions.map((id) => document.querySelector(`[data-log="${id}"]:not([disabled])`)).filter(Boolean);
      if (offered.length) {
        offered[i % offered.length].click();
        done.decision = true;
      }
      if (i === 2) {
        const tabs = document.querySelectorAll('.view-tabs__tab:not(.is-active)');
        if (tabs.length) {
          tabs[0].click();
          done.tab = true;
        }
      }
      return done;
    }, i, DECISIONS);
    activity.trainClicks += did.train ? 1 : 0;
    activity.decisions += did.decision ? 1 : 0;
    activity.tabSwitches += did.tab ? 1 : 0;
    await wait(3000);
  }
  if (await page.$('[data-log="toolbar.pause"]')) await click('[data-log="toolbar.pause"]');
  await wait(1500);
};

const legs = [];
for (let leg = 0; leg < 2; leg++) {
  await click('app-mode-intro sbb-button');
  await wait(6000);
  const heapStart = await heap();
  const playStart = await page.evaluate(() => performance.now());
  await playLeg();
  const playEnd = await page.evaluate(() => performance.now());
  // Footer export of the current leg.
  const exportStart = await page.evaluate(() => performance.now());
  await click('.footer-record-btn');
  await wait(3000);
  legs.push({ leg, heapStart, heapEnd: await heap(), playStart, playEnd, exportStart });
  await click('app-toolbar sbb-secondary-button', 'Szenario abschliessen');
  await wait(1500);
  await answerSurvey();
  await wait(leg === 0 ? 5000 : 3000);
}
// Schichtbilanz, final questionnaire; the run file downloads itself.
await click('app-tour-debrief sbb-button');
await wait(1500);
await answerSurvey();
await wait(4000);

// Timing data lives in this document; the reload below starts a new one.
const timing = await page.evaluate(() => ({
  measures: performance.getEntriesByType('measure')
    .filter((m) => m.name.startsWith('flatland:'))
    .map((m) => ({ name: m.name, start: m.startTime, ms: m.duration })),
  frames: window.__measure.frames,
  longtasks: window.__measure.longtasks,
}));

// "Download data" for the whole run from the start screen.
// The same URL again: a hash-only navigation would not reload, so reload explicitly.
await page.evaluate(() => (location.hash = '#/experiment/plan-b-p01'));
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('[data-log="savedRuns.download"]', { timeout: 30000 }).catch(() => {});
await wait(1000);
await page.evaluate(() => {
  const d = document.querySelector('details.saved-runs');
  if (!d) return;
  d.open = true;
  d.querySelector('[data-log="savedRuns.selectAll"] input')?.click();
});
await wait(500);
const downloaded = await page.evaluate(() => {
  const btn = document.querySelector('[data-log="savedRuns.download"]');
  if (!btn || btn.disabled) return false;
  btn.click();
  return true;
});
if (!downloaded) errs.push('saved runs: "Download data" not offered');
await wait(4000);

// ── Collect ─────────────────────────────────────────────────────────────────
const browserData = await page.evaluate(async () => {
  const streams = await new Promise((resolve) => {
    const req = indexedDB.open('flatland_study_streams');
    req.onerror = () => resolve([]);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('chunks')) return resolve([]);
      const all = db.transaction('chunks', 'readonly').objectStore('chunks').getAll();
      all.onsuccess = () => resolve(all.result);
      all.onerror = () => resolve([]);
    };
  });
  const perStream = {};
  for (const c of streams) {
    const s = (perStream[`${c.sid}:${c.stream}`] ??= { sid: c.sid, stream: c.stream, events: 0, bytes: 0 });
    s.events += c.events.length;
    s.bytes += JSON.stringify(c.events).length;
  }
  const records = Object.keys(localStorage)
    .filter((k) => k.startsWith('flatland_session_record_') && !k.endsWith('index_v1'))
    .map((k) => ({ key: k, bytes: localStorage.getItem(k).length }));
  const localStorageBytes = Object.keys(localStorage).reduce((n, k) => n + k.length + localStorage.getItem(k).length, 0);
  return {
    streams: Object.values(perStream),
    records,
    localStorageBytes,
    storageAfter: (await navigator.storage.estimate()).usage ?? null,
  };
});
Object.assign(browserData, timing);

const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const round = (x) => (x == null ? null : Math.round(x * 10) / 10);
const perf = legs.map((l) => {
  const frames = browserData.frames.filter(([t]) => t >= l.playStart && t <= l.playEnd).map(([, d]) => d);
  const longs = browserData.longtasks.filter(([t]) => t >= l.playStart && t <= l.playEnd);
  return {
    leg: l.leg,
    frameP50: round(pct(frames, 50)),
    frameP95: round(pct(frames, 95)),
    frameMax: round(Math.max(0, ...frames)),
    framesOver50: frames.filter((d) => d > 50).length,
    longTasks: longs.length,
    longTaskMs: round(longs.reduce((n, [, d]) => n + d, 0)),
    heapStartMB: round(l.heapStart / 1e6),
    heapEndMB: round(l.heapEnd / 1e6),
  };
});
const flushes = browserData.measures.filter((m) => m.name === 'flatland:stream-flush').map((m) => m.ms);
const exports = browserData.measures.filter((m) => m.name === 'flatland:export').map((m) => {
  const inside = (t) => t >= m.start && t <= m.start + m.ms;
  return {
    ms: round(m.ms),
    longestLongTask: round(Math.max(0, ...browserData.longtasks.filter(([t]) => inside(t)).map(([, d]) => d))),
    longestFrame: round(Math.max(0, ...browserData.frames.filter(([t]) => inside(t)).map(([, d]) => d))),
  };
});

const files = fs.readdirSync(dl).map((name) => {
  const buf = fs.readFileSync(path.join(dl, name));
  let raw = buf.length;
  if (name.endsWith('.gz')) raw = zlib.gunzipSync(buf).length;
  return { name, bytes: buf.length, rawBytes: raw };
});

/** The server's run folder for this run, summed per kind of file. */
let server = null;
if (SERVER_RECORDS && fs.existsSync(SERVER_RECORDS)) {
  const runs = fs.readdirSync(SERVER_RECORDS)
    .map((n) => path.join(SERVER_RECORDS, n))
    .filter((p) => fs.statSync(p).isDirectory() && fs.statSync(p).mtimeMs >= t0);
  const kinds = {};
  const walk = (p) => {
    for (const n of fs.readdirSync(p)) {
      const f = path.join(p, n);
      const st = fs.statSync(f);
      if (st.isDirectory()) walk(f);
      else {
        const kind = n.endsWith('.pkl') ? '*.pkl' : n.endsWith('.tsv') ? '*.tsv' : n;
        const k = (kinds[kind] ??= { files: 0, bytes: 0 });
        k.files += 1;
        k.bytes += st.size;
      }
    }
  };
  runs.forEach(walk);
  server = { runFolders: runs.map((r) => path.basename(r)), kinds, totalBytes: Object.values(kinds).reduce((n, k) => n + k.bytes, 0) };
}

const result = {
  label: LABEL,
  commit,
  date: new Date(t0).toISOString(),
  config: { base: BASE, studyLogging: STUDY_LOGGING, playSeconds: PLAY_SECONDS, speed: SPEED },
  activity,
  browser: {
    streams: browserData.streams,
    records: browserData.records,
    localStorageBytes: browserData.localStorageBytes,
    storageUsageBefore: storageBefore,
    storageUsageAfter: browserData.storageAfter,
  },
  files,
  server,
  perf: {
    legs: perf,
    streamFlush: { count: flushes.length, p50: round(pct(flushes, 50)), max: round(Math.max(0, ...flushes)) },
    exports,
  },
  errors: errs,
};
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));

const kb = (b) => (b == null ? '–' : `${(b / 1024).toFixed(1)} kB`);
const md = [
  `## ${LABEL}: ${result.date}, build ${commit}`,
  '',
  `Study logging ${STUDY_LOGGING ? 'on' : 'off'}, ${PLAY_SECONDS} s per leg at speed ${SPEED}; ` +
    `${activity.trainClicks} train clicks, ${activity.decisions} decisions, ${activity.tabSwitches} tab switches.`,
  '',
  '| Browser stream | Session | Events | Size (JSON) |',
  '|---|---|---|---|',
  ...browserData.streams.map((s) => `| ${s.stream} | ${s.sid.slice(0, 8)} | ${s.events} | ${kb(s.bytes)} |`),
  '',
  `Session records in localStorage: ${browserData.records.map((r) => kb(r.bytes)).join(', ') || '–'}; ` +
    `localStorage total ${kb(browserData.localStorageBytes)}; ` +
    `storage estimate ${kb(storageBefore)} → ${kb(browserData.storageAfter)}.`,
  '',
  '| Download | gzipped | raw |',
  '|---|---|---|',
  ...files.map((f) => `| ${f.name} | ${kb(f.bytes)} | ${kb(f.rawBytes)} |`),
  '',
  ...(server
    ? ['| Server file | Files | Size |', '|---|---|---|', ...Object.entries(server.kinds).map(([k, v]) => `| ${k} | ${v.files} | ${kb(v.bytes)} |`), `| **total** | | ${kb(server.totalBytes)} |`, '']
    : []),
  '| Leg | Frame p50 / p95 / max (ms) | Frames > 50 ms | Long tasks (total ms) | Heap start → end (MB) |',
  '|---|---|---|---|---|',
  ...perf.map((p) => `| ${p.leg + 1} | ${p.frameP50} / ${p.frameP95} / ${p.frameMax} | ${p.framesOver50} | ${p.longTasks} (${p.longTaskMs}) | ${p.heapStartMB} → ${p.heapEndMB} |`),
  '',
  `Stream flushes: ${flushes.length}, p50 ${round(pct(flushes, 50))} ms, max ${round(Math.max(0, ...flushes))} ms. ` +
    `Exports: ${exports.map((e) => `${e.ms} ms (longest task ${e.longestLongTask} ms)`).join(', ') || '–'}.`,
  '',
  ...(errs.length ? ['Page errors:', ...errs.map((e) => `- ${e}`), ''] : []),
].join('\n');
fs.writeFileSync(path.join(out, 'result.md'), md);
console.log(md);
console.log(`\nwritten to ${out}`);
await browser.close();
