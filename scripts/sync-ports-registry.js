#!/usr/bin/env node
'use strict';
/**
 * `config/ports.json` is canonical. This script mirrors it to `.ports.json`
 * or verifies they match (--check).
 *
 * Run: node scripts/sync-ports-registry.js [--check]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CANONICAL = path.join(ROOT, 'config', 'ports.json');
const MIRROR = path.join(ROOT, '.ports.json');
const check = process.argv.includes('--check');

function servicesOnly(obj) {
  return JSON.stringify(obj.services || {}, null, 2);
}

if (!fs.existsSync(CANONICAL)) {
  console.error('ports registry: config/ports.json missing');
  process.exit(1);
}

const canonical = JSON.parse(fs.readFileSync(CANONICAL, 'utf8'));
const mirror = fs.existsSync(MIRROR) ? JSON.parse(fs.readFileSync(MIRROR, 'utf8')) : { services: {} };

if (servicesOnly(canonical) === servicesOnly(mirror)) {
  console.log('ports registry: in sync (config/ports.json ↔ .ports.json)');
  process.exit(0);
}

if (check) {
  console.error('ports registry: drift — run `node scripts/sync-ports-registry.js` to mirror from config/ports.json');
  process.exit(1);
}

const merged = { ...mirror, ...canonical };
merged.description =
  'Generated mirror of `config/ports.json` — edit the canonical file only (run `node scripts/sync-ports-registry.js`).';
fs.writeFileSync(MIRROR, JSON.stringify(merged, null, 2) + '\n');
console.log('wrote .ports.json from config/ports.json');
process.exit(0);
