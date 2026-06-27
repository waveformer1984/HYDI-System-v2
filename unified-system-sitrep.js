#!/usr/bin/env node
/**
 * UNIFIED SYSTEM SITREP — Cross-Root Health Monitor
 *
 * Scans all HYDI, Heidi, Ursula, and ProtoForge roots and
 * prints a formatted SITREP to console (and optional JSON output).
 *
 * Usage:
 *   node unified-system-sitrep.js
 *   node unified-system-sitrep.js --json > sitrep.json
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');

const JSON_MODE = process.argv.includes('--json');

// ── Configuration: known system roots ──
const ROOTS = {
  canonical: 'C:\\Users\\Owner\\HYDI_System',
  backup:    'C:\\Users\\Owner\\HYDI_System_BACKUP',
  hydisystem:'C:\\Users\\Owner\\HYDIsystem',
  hypdi:     'C:\\Users\\Owner\\HYPDI_System',
  hydiCore:  'C:\\Users\\Owner\\HYDI_CORE',
  protoForge:'C:\\Users\\Owner\\ProtoForge',
  protoDash: 'C:\\Users\\Owner\\protoforge-dash',
  protoSite: 'C:\\Users\\Owner\\protoforgesite',
  protoMaster:'C:\\Users\\Owner\\protoforge-master'
};

// ── Helpers ──
function exists(p) { return fs.existsSync(p); }
function dirSize(p) {
  try {
    const items = fs.readdirSync(p);
    return items.length;
  } catch { return 0; }
}
function fileSize(p) {
  try { return fs.statSync(p).size; }
  catch { return 0; }
}
async function httpPing(url, timeout = 1500) {
  return new Promise(resolve => {
    const req = http.get(url, { timeout }, res => {
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
    });
    req.on('error', () => resolve({ ok: false, status: 'unreachable' }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 'timeout' }); });
  });
}

// ── Scanners ──
function scanHeidi(root, name) {
  const srcDir = path.join(root, 'src');
  const coreDir = path.join(root, 'heidi-core');
  const hasSrc = exists(srcDir);
  const hasCore = exists(coreDir);
  const files = [];

  if (hasSrc) {
    const candidates = [
      'orchestrator/HeidiOrchestrator.js',
      'core/HeidiCoreLoop.js',
      'memory/HeidiMemorySystem.js',
      'awareness/HeidiSelfAwareness.js',
      'control/HeidiControlPlane.js',
      'revenue/HeidiRevenueEngine.js'
    ];
    for (const c of candidates) {
      const p = path.join(srcDir, c);
      if (exists(p)) files.push({ module: path.basename(c), size: fileSize(p), path: p });
    }
  }

  return {
    root: name,
    present: hasSrc || hasCore,
    srcModules: files.length,
    modules: files,
    selfLaunch: exists(path.join(coreDir, 'HeidiSelfLaunchProtocol.js')),
    memorySnapshot: exists(path.join(coreDir, 'heidi-memory.json'))
  };
}

function scanUrsula(root, name) {
  const modulesDir = path.join(root, 'modules');
  const hasModules = exists(modulesDir);
  const files = [];
  const candidates = [
    'ursula-service-bundle.js',
    'ursula-sse-manager.js',
    'ursula-sse-stream.js',
    'ursula-heartbeat.js'
  ];
  for (const c of candidates) {
    const p = path.join(modulesDir, c);
    if (exists(p)) files.push({ module: c, size: fileSize(p) });
  }

  const dashboards = [];
  const dashCandidates = [
    'ursula-dashboard.html',
    'ursula-dashboard-services.html',
    'ursula-chat-portal.html'
  ];
  for (const c of dashCandidates) {
    const p = path.join(root, c);
    if (exists(p)) dashboards.push(c);
  }

  return {
    root: name,
    present: hasModules,
    moduleCount: files.length,
    modules: files,
    dashboards,
    agentEntry: exists(path.join(root, 'agents', 'ursula', 'ursula.js'))
  };
}

function scanProtoForge(root, name) {
  const mainFile = path.join(root, 'protoforge-main.js');
  const present = exists(mainFile) || exists(path.join(root, 'package.json'));
  const pkgPath = path.join(root, 'package.json');
  let pkg = null;
  if (exists(pkgPath)) {
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); }
    catch {}
  }

  return {
    root: name,
    present,
    hasMain: exists(mainFile),
    mainSize: fileSize(mainFile),
    packageName: pkg?.name || null,
    dependencies: pkg ? Object.keys(pkg.dependencies || {}).length : 0
  };
}

// ── Main ──
async function run() {
  const report = {
    timestamp: new Date().toISOString(),
    heidi: [],
    ursula: [],
    protoforge: [],
    runtime: { ports: {} }
  };

  // Scan roots
  for (const [name, root] of Object.entries(ROOTS)) {
    if (!exists(root)) continue;
    report.heidi.push(scanHeidi(root, name));
    report.ursula.push(scanUrsula(root, name));
    report.protoforge.push(scanProtoForge(root, name));
  }

  // Ping known runtime ports
  const pings = [
    { name: 'ursula-agent',      url: 'http://localhost:3005/health' },
    { name: 'ursula-dashboard',  url: 'http://localhost:3004/health' },
    { name: 'protoforge-hq',     url: 'http://localhost:3005/api/status' },
    { name: 'revenue-api',       url: 'http://localhost:8002/api/health' },
    { name: 'hydi-main',         url: 'http://localhost:3000/health' }
  ];

  for (const p of pings) {
    report.runtime.ports[p.name] = await httpPing(p.url);
  }

  // Summary stats
  const heidiActive = report.heidi.filter(h => h.present).length;
  const ursulaActive = report.ursula.filter(u => u.present).length;
  const pfActive = report.protoforge.filter(p => p.present).length;
  const runningPorts = Object.entries(report.runtime.ports).filter(([,v]) => v.ok).length;

  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // ── Console Output ──
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         UNIFIED SYSTEM SITREP                                ║');
  console.log(`║         ${report.timestamp}                    ║`.slice(0, 64));
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  console.log(`  Heidi Roots Present:      ${heidiActive} / ${report.heidi.length}`);
  console.log(`  Ursula Roots Present:       ${ursulaActive} / ${report.ursula.length}`);
  console.log(`  ProtoForge Roots Present:   ${pfActive} / ${report.protoforge.length}`);
  console.log(`  Runtime Ports Responsive:   ${runningPorts} / ${pings.length}`);
  console.log('');

  console.log('  ── HEIDI ──');
  for (const h of report.heidi) {
    const icon = h.present ? '✅' : '❌';
    console.log(`   ${icon} ${h.root.padEnd(12)} | modules: ${h.srcModules} | self-launch: ${h.selfLaunch ? 'Y' : 'N'}`);
  }

  console.log('');
  console.log('  ── URSULA ──');
  for (const u of report.ursula) {
    const icon = u.present ? '✅' : '❌';
    console.log(`   ${icon} ${u.root.padEnd(12)} | modules: ${u.moduleCount} | dashboards: ${u.dashboards.length} | agent: ${u.agentEntry ? 'Y' : 'N'}`);
  }

  console.log('');
  console.log('  ── PROTOFORGE ──');
  for (const p of report.protoforge) {
    const icon = p.present ? '✅' : '❌';
    console.log(`   ${icon} ${p.root.padEnd(12)} | main: ${p.hasMain ? 'Y' : 'N'} | pkg: ${p.packageName || 'none'}`);
  }

  console.log('');
  console.log('  ── RUNTIME PORTS ──');
  for (const [name, result] of Object.entries(report.runtime.ports)) {
    const icon = result.ok ? '🟢' : '🔴';
    const status = result.ok ? result.status : result.status;
    console.log(`   ${icon} ${name.padEnd(18)} | ${status}`);
  }

  console.log('');
  console.log('  ── RECOMMENDATIONS ──');
  if (heidiActive > 1) {
    console.log('   ⚠️  Multiple Heidi roots detected. Consolidation recommended.');
  }
  if (runningPorts === 0) {
    console.log('   ⚠️  No runtime ports responsive. Systems are not currently running.');
  }
  if (!report.ursula.some(u => u.agentEntry)) {
    console.log('   ℹ️  Ursula agent entry point missing from canonical root.');
  }
  console.log('');
}

run().catch(err => {
  console.error('SITREP failed:', err);
  process.exit(1);
});
