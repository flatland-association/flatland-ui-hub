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
  for (const t of targets) {
    for (const k of load(t)) if (!en.has(k)) errors.push(`${t}.json: '${k}' is not in en.json (stale)`);
  }
  if (errors.length) {
    console.error(`\n✖ ${errors.length} i18n error(s):`);
    errors.forEach((e) => console.error(`  ${e}`));
    process.exit(1);
  }
  console.log('\n✔ every literal key used in src/ exists in en.json; no stale de/fr keys');
}
