#!/usr/bin/env node
'use strict';
/**
 * Port registry consistency check (Phase 2).
 *
 * config/ports.json is the canonical port registry. This script verifies that the
 * ports services actually bind — in ecosystem.config.js (PM2 env) and
 * boot.config.json (boot-agent modules) — match the registry. Report-only;
 * exits 1 on mismatch so CI/hooks can gate on it.
 *
 * Run: node scripts/check-port-registry.js [--json]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { loadPortsRegistry } = require('../lib/config/ports-registry');
const registry = loadPortsRegistry();

/** serviceId -> port from the registry */
const regById = {};
const portToIds = {};
for (const [id, s] of Object.entries(registry.services || {})) {
  regById[id] = s.port;
  (portToIds[s.port] = portToIds[s.port] || []).push(id);
}

/** Collect declared ports from a config object: env vars + explicit port fields */
function portsFromConfig(cfg, label, out) {
  const apps = Array.isArray(cfg.apps) ? cfg.apps : cfg.apps ? [cfg.apps] : [];
  for (const app of apps) {
    const name = app.name || '(unnamed)';
    const env = app.env || {};
    for (const [k, v] of Object.entries(env)) {
      if (/PORT/i.test(k) && /^\d+$/.test(String(v))) {
        out.push({ source: label, service: name, via: `env.${k}`, port: Number(v) });
      }
    }
    if (Number.isInteger(app.port)) {
      out.push({ source: label, service: name, via: 'port', port: app.port });
    }
  }
}

const declared = [];
try {
  const eco = require(path.join(ROOT, 'ecosystem.config.js'));
  portsFromConfig(eco, 'ecosystem.config.js', declared);
} catch (e) {
  console.error(`cannot read ecosystem.config.js: ${e.message}`);
  process.exit(2);
}
try {
  const boot = JSON.parse(fs.readFileSync(path.join(ROOT, 'boot.config.json'), 'utf8'));
  for (const m of boot.modules || []) {
    const env = m.env || {};
    for (const [k, v] of Object.entries(env)) {
      if (/PORT/i.test(k) && /^\d+$/.test(String(v))) {
        declared.push({ source: 'boot.config.json', service: m.id, via: `env.${k}`, port: Number(v) });
      }
    }
    if (Number.isInteger(m.port)) {
      declared.push({ source: 'boot.config.json', service: m.id, via: 'port', port: m.port });
    }
  }
} catch (e) {
  console.error(`cannot read boot.config.json: ${e.message}`);
}

// Map declared services to registry ids where names line up.
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');
const issues = [];
const matched = [];
for (const d of declared) {
  const candidates = [norm(d.service)];
  // common aliases between PM2 names and registry ids
  const alias = {
    'heidi-web-standalone': 'next-app',
    'heidi-web': 'next-app', // boot.config module name for the same :3000 app
    'heidi-mobile-chat': 'heidi-mobile-chat',
    'ursula-local': 'ursula-local',
    'protoforge-core': 'protoforge-core',
    'heidi-core': 'heidi-core',
    'heidi-agent': 'heidi-advisory',
    'rezonate-app': null, // app-specific port, not in registry — checked below
  };
  const regId = alias.hasOwnProperty(norm(d.service)) ? alias[norm(d.service)] : candidates[0];
  if (regId && regById[regId] != null) {
    if (regById[regId] === d.port) {
      matched.push({ ...d, registryId: regId });
    } else {
      issues.push({ ...d, registryId: regId, registryPort: regById[regId], problem: 'PORT_MISMATCH' });
    }
  } else {
    // port not claimed by registry for this service — flag only if the port
    // is registered to a *different* service (real collision)
    const owners = portToIds[d.port] || [];
    if (owners.length && !owners.includes(regId)) {
      issues.push({ ...d, registryId: null, registryPort: d.port, owners, problem: 'PORT_OWNED_BY_OTHER_SERVICE' });
    }
  }
}

// Registry entries nothing declares (informational — external services ok)
const declaredPorts = new Set(declared.map((d) => d.port));
const undeclared = Object.entries(regById)
  .filter(([id, port]) => !declaredPorts.has(port) && !(registry.services[id] || {}).external)
  .map(([id, port]) => ({ id, port }));

const report = { matched: matched.length, issues, undeclaredRegistryPorts: undeclared };
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`port registry consistency: ${matched.length} declared ports match config/ports.json`);
  for (const i of issues) {
    console.log(`  FAIL ${i.source} ${i.service} (${i.via}) -> :${i.port}  ${i.problem}${i.registryPort != null ? ` (registry ${i.registryId}=:${i.registryPort})` : ''}${i.owners ? ` (owned by ${i.owners.join(',')})` : ''}`);
  }
  for (const u of undeclared) {
    console.log(`  note registry ${u.id}=:${u.port} has no declared binding (ok if external/manual)`);
  }
  if (!issues.length) console.log('  no mismatches');
}
process.exit(issues.length ? 1 : 0);
