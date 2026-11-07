#!/usr/bin/env node
'use strict';
/**
 * Keep `.ports.json` and `config/ports.json` identical (services block).
 * Run: node scripts/sync-ports-registry.js [--check]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, '.ports.json');
const B = path.join(ROOT, 'config', 'ports.json');
const check = process.argv.includes('--check');

function servicesOnly(obj) {
  return JSON.stringify(obj.services || {}, null, 2);
}

const left = JSON.parse(fs.readFileSync(A, 'utf8'));
const right = fs.existsSync(B) ? JSON.parse(fs.readFileSync(B, 'utf8')) : { services: {} };

if (servicesOnly(left) === servicesOnly(right)) {
  console.log('ports registry: in sync');
  process.exit(0);
}

if (check) {
  console.error('ports registry: config/ports.json and .ports.json differ (services)');
  process.exit(1);
}

const merged = { ...right, services: left.services, reserved_ranges: left.reserved_ranges };
merged.description =
  'Global port registry for all HYDI services. Canonical copy — keep in sync with `.ports.json` (run `node scripts/sync-ports-registry.js`).';
merged.validation = left.validation;
fs.writeFileSync(B, JSON.stringify(merged, null, 2) + '\n');
console.log('wrote config/ports.json from .ports.json');
process.exit(0);
