'use strict';

// Supabase/PostgREST query builders are thenables, not Promises: they have
// .then() but no .catch(). `await supabase.from(t).insert(...).catch(...)`
// throws "insert(...).catch is not a function" before any request is sent,
// which turned Heidi Mobile's "Request access" into an HTTP 500 after the
// device row was already written. Use `.then(undefined, () => {})` instead.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIRS = ['api', 'pages/api', 'lib'];
// A builder chain (.from(...)...) whose statement ends in .catch( without a
// .then( in between.
const PATTERN = /\.from\((?:(?!;|\.then\()[\s\S])*?\)\s*\.catch\(/g;

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|ts|mjs|cjs)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

test('no .catch() directly on a Supabase query builder', () => {
  const hits = [];
  for (const d of DIRS) {
    for (const f of walk(path.join(ROOT, d), [])) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(PATTERN)) {
        const line = src.slice(0, m.index).split('\n').length;
        hits.push(`${path.relative(ROOT, f)}:${line}`);
      }
    }
  }
  expect(hits).toEqual([]);
});
