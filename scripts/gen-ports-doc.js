#!/usr/bin/env node
'use strict';
/**
 * Generates docs/PORTS.md from config/ports.json — the canonical port registry.
 * Run: node scripts/gen-ports-doc.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { loadPortsRegistry } = require('../lib/config/ports-registry');
const registry = loadPortsRegistry();

const lines = [
  '# Port Registry',
  '',
  '> Generated from `config/ports.json` by `scripts/gen-ports-doc.js`. Do not edit by hand —',
  '> edit the registry and regenerate (`node scripts/gen-ports-doc.js`).',
  '> Validate with `node scripts/check-ports.js`.',
  '',
  '| Service | Port | Env var | Description | Depends on |',
  '|---|---|---|---|---|',
];
for (const [id, s] of Object.entries(registry.services || {})) {
  lines.push(`| \`${id}\` | ${s.port} | \`${s.env_var || ''}\` | ${s.name || ''} — ${s.description || ''} | ${(s.depends_on || []).join(', ') || '—'} |`);
}
fs.writeFileSync(path.join(ROOT, 'docs', 'PORTS.md'), lines.join('\n') + '\n');
console.log(`wrote docs/PORTS.md (${Object.keys(registry.services || {}).length} services)`);
