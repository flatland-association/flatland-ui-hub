// Walk-through screenshots for #198 (docs/plans/hide-scenario-bar/), on the
// Plan B condition `plan-b-p01` with the Plan B deployment config, German UI:
// every stage of the run, from the start screen to the end.
//   <prefix>-01-picker.png              start screen with the condition,
//   <prefix>-02-briefing.png            the briefing's opening page,
//   <prefix>-<k>a-intro.png             scenario k's intro card (k = 1..5, files 03..07),
//   <prefix>-<k>b-running.png           scenario k running: stepper, guide strip, toolbar,
//   <prefix>-<k>c-bars.png              the same, cropped to the bars above the map,
//   <prefix>-08-final-survey.png        the final questionnaire,
//   <prefix>-09-end.png                 the end page.
// Prefix `before`: the app as it is. Prefix `proposal`: the same run with the
// plan's proposal previewed in the page only (no code change): the guide strip
// and its connector lines hidden (REQ-2), the stepper's scenarios read
// "Szenario k/N" (REQ-1, Q-3), the finish button reads «Szenario abschliessen →
// Szenario k/N» (REQ-5), the toolbar at the top (Q-4). Once the plan is built, run it
// with prefix `after` and PREVIEW=0 on the branch. Prints the texts read from
// the page.
//
// Run:
//   UI_CONFIG=frontend/public/ui-configs/plan-b.json ./start-demo.sh   # production build on :8000
//   NODE_PATH=<puppeteer-core>/node_modules node scripts/docshots-hide-scenario-bar.mjs docs/plans/hide-scenario-bar before
//   NODE_PATH=<puppeteer-core>/node_modules node scripts/docshots-hide-scenario-bar.mjs docs/plans/hide-scenario-bar proposal
//
// Env: BASE (default http://127.0.0.1:8000), CHROME (Chrome/Chromium binary),
// PREVIEW (default: on for prefix `proposal` only).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const [out = 'docshots', prefix = 'before'] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://127.0.0.1:8000';
const PREVIEW = process.env.PREVIEW ? process.env.PREVIEW === '1' : prefix === 'proposal';
const W = 1600, H = 1000;
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=de-CH'], defaultViewport: { width: W, height: H } });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim().replace(/\s+/g, ' ')));
const click = async (sel, label) => {
  const ok = await page.evaluate((sel, label) => {
    const el = [...document.querySelectorAll(sel)].find((e) => !label || e.textContent.includes(label));
    if (!el) return false; el.click(); return true;
  }, sel, label);
  if (!ok) throw new Error(`no ${sel} ${label ?? ''}`);
};

/** The proposal: CSS, and the finish button's text node rewritten in place, so
 *  Angular keeps its nodes and the run goes on. */
const preview = async () => {
  if (!PREVIEW) return;
  await page.evaluate(() => {
    if (!document.getElementById('proposal-198')) {
      const style = document.createElement('style');
      style.id = 'proposal-198';
      style.textContent = `
        app-tour-guide, .xp__connector { display: none !important; }
        app-root > * { order: 3; }
        app-root > app-config-shell { order: 0; }
        app-root > app-toolbar { order: 1; }
        app-root > app-experiment-progress { order: 2; }
        .xp__legs > .xp__step[data-proposal] { font-size: 0 !important; }
        .xp__legs > .xp__step[data-proposal]::before { font-size: var(--proposal-size); }
        /* ::after, so the stepper's own ✓ (::before) of a done leg stays. */
        .xp__legs > .xp__step[data-proposal]::after { content: attr(data-proposal); font-size: var(--proposal-size); }`;
      document.head.appendChild(style);
    }
    const legs = [...document.querySelectorAll('.xp__legs > .xp__step:not(.xp__step--survey)')];
    legs.forEach((li, i) => {
      if (!li.dataset.proposal) li.style.setProperty('--proposal-size', getComputedStyle(li).fontSize);
      li.dataset.proposal = `Szenario ${i + 1}/${legs.length}`;
    });
    // «Szenario abschliessen → ⟨name⟩ (k/N)» → «Szenario abschliessen → Szenario k/N».
    document.querySelectorAll('app-toolbar sbb-secondary-button').forEach((b) => b.childNodes.forEach((t) => {
      if (t.nodeType === Node.TEXT_NODE) t.data = t.data.replace(/→ .*\((\d+)\/(\d+)\)\s*$/, '→ Szenario $1/$2 ');
    }));
  });
  await wait(300);
};
const shot = async (name) => { await preview(); await page.screenshot({ path: `${out}/${prefix}-${name}.png` }); };
/** Crop to the union of the given elements' boxes, padded. */
const crop = async (name, sels, pad = 8) => {
  await preview();
  const box = await page.evaluate((sels) => {
    const rs = sels.flatMap((s) => [...document.querySelectorAll(s)]).map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height);
    if (!rs.length) return null;
    const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
    return { x, y, w: Math.max(...rs.map((r) => r.right)) - x, h: Math.max(...rs.map((r) => r.bottom)) - y };
  }, sels);
  if (!box) throw new Error(`no box for ${sels}`);
  const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
  await page.screenshot({ path: `${out}/${prefix}-${name}.png`, clip: { x, y, width: Math.min(W - x, box.w + 2 * pad), height: Math.min(H - y, box.h + 2 * pad) } });
};
const finishButton = async () => (await text('app-toolbar sbb-secondary-button')).filter((t) => t.includes('→') || t.includes('Fragebogen'));
const report = async (label) => {
  const legs = PREVIEW
    ? await page.$$eval('.xp__legs > .xp__step', (els) => els.map((e) => e.dataset.proposal ?? e.textContent.trim()))
    : await text('.xp__legs > .xp__step');
  const guide = await page.$eval('app-tour-guide', (e) => getComputedStyle(e).display !== 'none').catch(() => false);
  console.log(`${prefix} ${label}: legs: ${legs.join(' ─ ')} | count: ${(await text('.xp__left')).join('')} | guide strip: ${guide ? 'shown' : 'hidden'} | finish: ${(await finishButton()).join(' / ')}`);
};

// German UI, a clean slate.
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('flatland.lang', 'de'); });
await page.goto(`${BASE}/#/experiment/plan-b-p01`, { waitUntil: 'networkidle2' });
await page.reload({ waitUntil: 'networkidle2' });
await wait(2000);

await shot('01-picker');
await click('sbb-button.welcome-start');
await wait(5000);
await shot('02-briefing');
await click('.briefing-actions sbb-button');

const legs = 5;
for (let k = 1; k <= legs; k++) {
  const n = String(k + 2).padStart(2, '0');
  await page.waitForSelector('app-mode-intro sbb-button', { timeout: 30000 });
  await wait(1000);
  console.log(`${prefix} scenario ${k} intro: ${(await text('app-mode-intro .intro-step')).join('')}`);
  await shot(`${n}a-intro`);
  await click('app-mode-intro sbb-button');
  await wait(8000);
  await shot(`${n}b-running`);
  await report(`scenario ${k}`);
  await crop(`${n}c-bars`, ['app-experiment-progress', 'app-tour-guide', 'app-toolbar']);
  await click('app-toolbar sbb-secondary-button', 'Szenario abschliessen');
  await wait(3000);
}

await page.waitForSelector('app-survey', { timeout: 30000 });
await wait(1500);
await shot('08-final-survey');
// The end: page through the final questionnaire, answering every item with a
// middle value (required items block "Weiter"), and submit it.
const fillPage = () => page.evaluate(() => {
  const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const groups = new Map();
  document.querySelectorAll('app-survey input[type="radio"]').forEach((r) => groups.set(r.name, [...(groups.get(r.name) ?? []), r]));
  groups.forEach((rs) => rs[Math.floor(rs.length / 2)].click());
  document.querySelectorAll('app-survey input[type="number"], app-survey input[type="range"]').forEach((el) => set(el, '50'));
  document.querySelectorAll('app-survey textarea').forEach((el) => set(el, 'Walk-through'));
});
for (let i = 0; i < 20 && !(await page.$('app-survey [data-log="surveyUi.submit"]')); i++) {
  await fillPage();
  await click('app-survey [data-log="surveyUi.next"]');
  await wait(800);
}
await fillPage();
await click('app-survey [data-log="surveyUi.submit"]');
await wait(4000);
await shot('09-end');

await page.evaluate(() => localStorage.removeItem('flatland_experiment_run_v1'));
await browser.close();
