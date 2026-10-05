#!/usr/bin/env node
// i18n coverage report (docs/plans/i18n-strategy.md). English is the reference;
// German and French may be partial by design, so the report never fails on them.
//   npm run i18n:coverage              per namespace
//   npm run i18n:coverage -- --missing also list missing keys
//   npm run i18n:check                 CI gate (--strict): fails only on errors
//                                      that show up as broken UI, never on
//                                      partial de/fr coverage:
//     - a literal key used in src/ ('a.b' | transloco, .t('a.b')) missing in en
//     - a de/fr key that no longer exists in en (stale, silently unused)
//     - literal user-facing text in a template (text node, title, placeholder,
//       aria-label, alt) outside the internal tools listed in INTERNAL below.
//       A line carrying `data-lint-ignore` is skipped (use it sparingly).
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '../public/i18n');
const flat = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
const load = (lang) => {
  const file = path.join(dir, `${lang}.json`);
  return fs.existsSync(file) ? new Set(flat(JSON.parse(fs.readFileSync(file, 'utf8')))) : new Set();
};

// Templates that are deliberately English (AGENTS.md: "Internal tools and
// questionnaires stay English"), plus components no template mounts any more.
const INTERNAL = [
  ['features/infrastructure-builder/', 'internal tool'],
  ['features/layout-designer/', 'internal tool'],
  ['features/widgets-gallery/', 'internal tool'],
  ['features/algorithms-gallery/', 'internal tool'],
  ['features/contribute/', 'internal tool'],
  ['features/layout/pages/layout-sandbox/', 'internal tool'],
  ['features/survey/', 'questionnaire'],
  ['features/simulation-slider/', 'not mounted anywhere (translate before reviving)'],
  ['features/status-bar/', 'not mounted anywhere (translate before reviving)'],
  ['shared/layout/panels/layout-view-toggle-panel/', 'not mounted anywhere (translate before reviving)'],
];
// Product and place names that read the same in every language, and units.
const NEUTRAL = new Set(['flatland', 'dispatcher', 'ai4realnet', 'sbb', 'design', 'system', 'lyne', 'min', 'svg', 'ai4realnet.eu']);

/** Blank out `@if (...)`-style control-flow headers (their conditions are code, not text). */
function blankControlFlow(t) {
  const re = /@(?:else if|if|for|switch|case|defer)\b/g;
  const out = t.split('');
  let m;
  while ((m = re.exec(t))) {
    let i = m.index + m[0].length;
    while (t[i] === ' ') i++;
    if (t[i] !== '(') continue;
    let depth = 0;
    let j = i;
    for (; j < t.length; j++) {
      if (t[j] === '(') depth++;
      else if (t[j] === ')' && --depth === 0) break;
    }
    for (let k = m.index; k <= j; k++) if (out[k] !== '\n') out[k] = ' ';
  }
  // `@let name = expression;` declares a variable, it is not text.
  return out.join('').replace(/@let\b[^;]*;/g, (d) => d.replace(/[^\n]/g, ' '));
}

function hardcodedText(src, walk) {
  const errors = [];
  const words = /[\p{L}\p{N}][\p{L}\p{N}.]*/gu;
  const flagged = (text) => (text.match(words) ?? []).some((w) => /\p{L}{3,}/u.test(w) && !NEUTRAL.has(w.toLowerCase()));
  for (const file of walk(src).filter((f) => f.endsWith('.html') && !f.endsWith('index.html'))) {
    const rel = path.relative(src, file).replace(/^app\//, '');
    if (INTERNAL.some(([prefix]) => rel.startsWith(prefix))) continue;
    const html = blankControlFlow(fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' ')));
    const lines = html.split('\n');
    const lineAt = (idx) => html.slice(0, idx).split('\n').length;
    const report = (idx, what) => {
      if (lines[lineAt(idx) - 1].includes('data-lint-ignore')) return;
      errors.push(`${rel}:${lineAt(idx)}: hardcoded text ${what} (use a key in public/i18n/*.json)`);
    };
    const tag = /<\/?[a-zA-Z][\w:-]*(?:"[^"]*"|'[^']*'|[^>"'])*>/g;
    let last = 0;
    let m;
    const text = (from, to) => {
      const raw = html.slice(from, to).replace(/\{\{[\s\S]*?\}\}/g, ' ').replace(/@(?:else|empty|default|loading|placeholder|error)\b/g, ' ').replace(/&[#\w]+;/g, ' ');
      if (flagged(raw)) report(from + html.slice(from, to).search(/\S/), `"${raw.replace(/\s+/g, ' ').trim().slice(0, 40)}"`);
    };
    while ((m = tag.exec(html))) {
      text(last, m.index);
      for (const a of m[0].matchAll(/\s(?:title|placeholder|aria-label|alt)="([^"{]*)"/g)) {
        if (flagged(a[1])) report(m.index, `in attribute "${a[1].slice(0, 40)}"`);
      }
      last = m.index + m[0].length;
    }
    text(last, html.length);
  }
  return errors;
}

const en = load('en');
const targets = ['de', 'fr'];
const namespaces = [...new Set([...en].map((k) => k.split('.')[0]))].sort();
const showMissing = process.argv.includes('--missing');
const strict = process.argv.includes('--strict');

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('namespace', 14) + pad('en', 6) + targets.map((t) => pad(t, 12)).join(''));
for (const ns of namespaces) {
  const keys = [...en].filter((k) => k.split('.')[0] === ns);
  const cells = targets.map((t) => {
    const have = load(t);
    const n = keys.filter((k) => have.has(k)).length;
    return pad(`${n}/${keys.length} ${Math.round((100 * n) / keys.length)}%`, 12);
  });
  console.log(pad(ns, 14) + pad(keys.length, 6) + cells.join(''));
}
for (const t of targets) {
  const have = load(t);
  const missing = [...en].filter((k) => !have.has(k));
  const extra = [...have].filter((k) => !en.has(k));
  console.log(`\n${t}: ${en.size - missing.length}/${en.size} keys` + (extra.length ? ` · ${extra.length} not in en (stale?)` : ''));
  if (showMissing) missing.forEach((k) => console.log(`  missing ${k}`));
}

if (strict) {
  const src = path.resolve(import.meta.dirname, '../src');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  // Only literal, fully-spelled keys; dynamic ones ('ns.' + id) can't be checked statically.
  const KEY = String.raw`'([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)'`;
  const patterns = [new RegExp(KEY + String.raw`\s*\|\s*transloco`, 'g'), new RegExp(String.raw`\.t\(\s*` + KEY + String.raw`\s*[,)]`, 'g')];
  const errors = [];
  for (const file of walk(src).filter((f) => /\.(html|ts)$/.test(f))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const re of patterns) {
      for (const m of text.matchAll(re)) {
        if (!en.has(m[1])) errors.push(`${path.relative(src, file)}: '${m[1]}' is not in en.json`);
      }
    }
  }
  errors.push(...hardcodedText(src, walk));
  for (const t of targets) {
    for (const k of load(t)) if (!en.has(k)) errors.push(`${t}.json: '${k}' is not in en.json (stale)`);
  }
  if (errors.length) {
    console.error(`\n✖ ${errors.length} i18n error(s):`);
    errors.forEach((e) => console.error(`  ${e}`));
    process.exit(1);
  }
  console.log('\n✔ every literal key used in src/ exists in en.json; no stale de/fr keys; no hardcoded template text');
}
