#!/usr/bin/env node
// Click ids (docs/plans/experiment-logging-frontend-and-replay.md §5.2): every
// `data-log` attribute in the templates. The ids are translation keys and part
// of the study data, so they must not be renamed or removed silently.
//   node scripts/data-log-ids.mjs           the table for docs/experiment-logging.md
//   node scripts/data-log-ids.mjs --check   CI (via npm run i18n:check): fails when
//                                           an id is not a key in en.json, or a
//                                           computed id's prefix is not a namespace
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../src/app');
const en = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../public/i18n/en.json'), 'utf8'));
const lookup = (key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), en);

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) files.push(p);
  }
};
walk(root);

const STATIC = /\sdata-log="([^"]+)"/g;
// [attr.data-log]="'prefix.' + expr" or [attr.data-log]="expr"
const BOUND = /\[attr\.data-log\]="([^"]+)"/g;

const rows = [];
const errors = [];
for (const file of files.sort()) {
  const rel = path.relative(root, file);
  const text = fs.readFileSync(file, 'utf8');
  for (const [, id] of text.matchAll(STATIC)) {
    rows.push({ id, file: rel });
    if (typeof lookup(id) !== 'string') errors.push(`${rel}: data-log="${id}" is not a key in en.json`);
  }
  for (const [, expr] of text.matchAll(BOUND)) {
    const prefix = /^'([^']+)\.'\s*\+/.exec(expr)?.[1];
    rows.push({ id: prefix ? `${prefix}.<${expr.split('+')[1].trim()}>` : `<${expr}>`, file: rel });
    if (prefix && (typeof lookup(prefix) !== 'object' || lookup(prefix) === null)) {
      errors.push(`${rel}: [attr.data-log] prefix "${prefix}" is not a namespace in en.json`);
    }
  }
}

const table = ['| Click id (`target`) | Template |', '|---|---|',
  ...rows.sort((a, b) => a.id.localeCompare(b.id) || a.file.localeCompare(b.file)).map((r) => `| \`${r.id}\` | \`${r.file}\` |`)].join('\n');

if (process.argv.includes('--check')) {
  // The table in the user docs is this output, so a changed id shows up in review.
  const docs = path.resolve(import.meta.dirname, '../../docs/experiment-logging.md');
  const inDocs = fs.existsSync(docs) ? /<!-- data-log-ids:start -->\n([\s\S]*?)\n<!-- data-log-ids:end -->/.exec(fs.readFileSync(docs, 'utf8'))?.[1] : undefined;
  if (inDocs !== undefined && inDocs.trim() !== table) {
    errors.push('docs/experiment-logging.md: the click id table is out of date; paste `node scripts/data-log-ids.mjs` between its markers');
  }
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log(`✔ ${rows.length} data-log ids, all translation keys`);
} else {
  console.log(table);
}
