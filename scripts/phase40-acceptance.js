#!/usr/bin/env node
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;

const MarketplaceManager = require('../src/hydi-v3/MarketplaceManager');
const RepositoryManager = require('../src/hydi-v3/RepositoryManager');
const PublisherRegistry = require('../src/hydi-v3/PublisherRegistry');
const CapabilityRegistry = require('../src/hydi-v3/CapabilityRegistry');
const SignatureVerifier = require('../src/hydi-v3/SignatureVerifier');
const DependencyResolver = require('../src/hydi-v3/DependencyResolver');
const CapabilitySandbox = require('../src/hydi-v3/CapabilitySandbox');
const CapabilityInstaller = require('../src/hydi-v3/CapabilityInstaller');
const LifecycleRegistry = require('../src/hydi-v3/LifecycleRegistry');
const SnapshotManager = require('../src/hydi-v3/SnapshotManager');
const MarketplaceDashboard = require('../src/hydi-v3/MarketplaceDashboard');

const silent = { log: () => {}, error: () => {}, warn: () => {} };

// Real Ed25519 keypair standing in for the 'protoforge' test publisher's
// identity. Generated once per run; only the public key is ever registered
// with PublisherRegistry, matching how a real publisher would operate.
const PROTOFORGE_KEYS = SignatureVerifier.generateKeyPair();
const reportPath = path.resolve(__dirname, '../reports/business-os/phase40-marketplace-report.md');

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

async function tmpDir() {
  const dir = path.join(os.tmpdir(), `hydi-p40-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function sign(cap, signer) {
  const { digest, signature } = signer.sign(cap, PROTOFORGE_KEYS.privateKey);
  cap.digest = digest;
  cap.signature = signature;
  return cap;
}

function makeMarketplace() {
  const lifecycle = new LifecycleRegistry({ logger: silent });
  const snapDir = path.join(os.tmpdir(), `hydi-p40-snap-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const snapshot = new SnapshotManager({ dataPath: snapDir, registry: lifecycle, logger: silent });
  const repo = new RepositoryManager({ logger: silent });
  const publishers = new PublisherRegistry({ logger: silent });
  const capabilities = new CapabilityRegistry({ logger: silent });
  const sandbox = new CapabilitySandbox({ logger: silent });
  const resolver = new DependencyResolver({ repository: repo, hydiVersion: '99.99.99' });
  const verifier = new SignatureVerifier({ publisherRegistry: publishers, logger: silent });
  const installer = new CapabilityInstaller({
    registry: capabilities,
    publisherRegistry: publishers,
    signatureVerifier: verifier,
    dependencyResolver: resolver,
    sandbox,
    snapshotManager: snapshot,
    lifecycleRegistry: lifecycle,
    logger: silent,
  });
  const marketplace = new MarketplaceManager({
    repositoryManager: repo,
    capabilityRegistry: capabilities,
    publisherRegistry: publishers,
    signatureVerifier: verifier,
    dependencyResolver: resolver,
    sandbox,
    capabilityInstaller: installer,
    lifecycleRegistry: lifecycle,
    logger: silent,
  });
  return { marketplace, repo, publishers, capabilities, lifecycle, snapshot, sandbox, verifier };
}

async function addOfficialRepo(m) {
  await m.snapshot.start();
  m.publishers.register({ id: 'protoforge', name: 'ProtoForge', status: 'official', publicKey: PROTOFORGE_KEYS.publicKey });
  m.publishers.register({ id: 'community-dev', name: 'Community', status: 'community' });
  const pkgA = sign({ id: 'audio.mastering', version: '1.0.0', type: 'Skill', publisher: 'protoforge', category: 'audio', offlineCompatible: true, requiredPermissions: { filesystem: ['read'] }, dependencies: [] }, m.verifier);
  const pkgB = sign({ id: 'vision.ocr', version: '1.0.0', type: 'Skill', publisher: 'protoforge', category: 'vision', offlineCompatible: false, requiredPermissions: { hardware: true }, dependencies: [] }, m.verifier);
  m.repo.addRepository({ id: 'official', name: 'Official', type: 'official', offline: false, packages: [pkgA, pkgB] });
}

async function marketplaceTest() {
  const m = makeMarketplace();
  await addOfficialRepo(m);
  const search = m.marketplace.search({ q: 'audio' });
  assert(search.length === 1 && search[0].id === 'audio.mastering', 'Marketplace search should find audio capability');
  const result = await m.marketplace.install('audio.mastering');
  assert(result.success && !result.quarantined, `Signed package should install: ${JSON.stringify(result)}`);
  assert(m.capabilities.get('audio.mastering').state === 'installed', 'Capability should be installed');
  await fs.rm(m.snapshot.store.dataPath, { recursive: true, force: true });
  return { passed: true, installed: result.success };
}

async function repositoryTest() {
  const m = makeMarketplace();
  await m.snapshot.start();
  const offlinePkg = { id: 'offline.tool', version: '1.0.0', type: 'Skill', publisher: 'protoforge', category: 'utility', offlineCompatible: true, requiredPermissions: {}, dependencies: [] };
  m.publishers.register({ id: 'protoforge', status: 'official' });
  m.repo.addRepository({ id: 'local', name: 'Local', type: 'local', offline: true, packages: [offlinePkg] });
  const found = m.marketplace.search({ q: 'offline' });
  assert(found.length === 1, 'Offline repository should be searchable without network');
  const sync = m.repo.sync('local');
  assert(sync.success && sync.offline, 'Offline sync should not fail');
  await fs.rm(m.snapshot.store.dataPath, { recursive: true, force: true });
  return { passed: true, offline: true };
}

async function signatureTest() {
  const m = makeMarketplace();
  await m.snapshot.start();
  m.publishers.register({ id: 'protoforge', status: 'official', publicKey: PROTOFORGE_KEYS.publicKey });
  const signed = sign({ id: 'signed.pkg', version: '1.0.0', type: 'Skill', publisher: 'protoforge', category: 'test', requiredPermissions: {}, dependencies: [] }, m.verifier);
  const unsigned = { id: 'unsigned.pkg', version: '1.0.0', type: 'Skill', publisher: 'protoforge', category: 'test', requiredPermissions: {}, dependencies: [] };
  m.repo.addRepository({ id: 'test', type: 'test', packages: [signed, unsigned] });

  const signedInstall = await m.marketplace.install('signed.pkg');
  assert(signedInstall.success && !signedInstall.quarantined, 'Signed package should install cleanly');

  const unsignedInstall = await m.marketplace.install('unsigned.pkg');
  assert(!unsignedInstall.success, 'Unsigned package should be rejected without approval');

  const quarantined = await m.marketplace.install('unsigned.pkg', { allowUnsigned: true });
  assert(quarantined.success && quarantined.quarantined, 'Unsigned package should install in quarantine when allowed');
  await fs.rm(m.snapshot.store.dataPath, { recursive: true, force: true });
  return { passed: true, signed: true, quarantined: true };
}

async function dependencyTest() {
  const repo = new RepositoryManager({ logger: silent });
  const a = { id: 'A', version: '1.0.0', type: 'Skill', requiredPermissions: {}, dependencies: [{ id: 'B' }] };
  const b = { id: 'B', version: '1.0.0', type: 'Skill', requiredPermissions: {}, dependencies: [{ id: 'A' }] };
  const c = { id: 'C', version: '1.0.0', type: 'Skill', requiredPermissions: {}, dependencies: [{ id: 'B', version: '^2.0.0' }] };
  repo.addRepository({ id: 'test', packages: [a, b, c] });
  const resolver = new DependencyResolver({ repository: repo, hydiVersion: '99.99.99' });

  const circular = resolver.resolve(a);
  assert(!circular.success && circular.circular.length > 0, 'Circular dependencies should be detected');

  const installedB = new Map([['B', { id: 'B', version: '1.0.0' }]]);
  const conflict = resolver.resolve(c, installedB);
  assert(!conflict.success && conflict.conflicts.length > 0, 'Version conflicts should be detected');
  return { passed: true };
}

async function sandboxTest() {
  const sandbox = new CapabilitySandbox({ logger: silent });
  sandbox.registerCapability({ id: 'safe.skill', version: '1.0.0', type: 'Skill', requiredPermissions: { filesystem: true, network: false } });
  const allowed = sandbox.executeCapability('safe.skill', 'filesystem', 'read');
  const denied = sandbox.executeCapability('safe.skill', 'network', 'request');
  assert(allowed.success, 'Allowed capability action should succeed');
  assert(!denied.success && denied.error.includes('permission_denied'), 'Denied capability action should fail closed');
  return { passed: true };
}

async function installTest() {
  const m = makeMarketplace();
  await addOfficialRepo(m);
  const result = await m.marketplace.install('vision.ocr');
  assert(result.success, 'Capability install should succeed');
  assert(m.capabilities.get('vision.ocr').state === 'installed', 'Capability registry should reflect installation');
  assert(m.lifecycle.get('vision.ocr'), 'Lifecycle registry should include installed capability');
  await fs.rm(m.snapshot.store.dataPath, { recursive: true, force: true });
  return { passed: true, installed: result.success };
}

async function rollbackTest() {
  const m = makeMarketplace();
  await addOfficialRepo(m);
  const before = await m.snapshot.create('baseline');
  const install = await m.marketplace.install('audio.mastering');
  assert(install.success, 'Install should succeed before rollback');
  const rolled = await m.marketplace.rollback(install.installation.id);
  assert(rolled.success, `Rollback should succeed: ${JSON.stringify(rolled)}`);
  assert(!m.capabilities.get('audio.mastering'), 'Capability should be removed after rollback');
  await fs.rm(m.snapshot.store.dataPath, { recursive: true, force: true });
  return { passed: true, rollback: true };
}

async function lifecycleTest() {
  const m = makeMarketplace();
  await addOfficialRepo(m);
  await m.marketplace.install('audio.mastering');
  const dashboard = new MarketplaceDashboard({
    registry: m.lifecycle,
    capabilityRegistry: m.capabilities,
    publisherRegistry: m.publishers,
    marketplaceManager: m.marketplace,
    dependencyResolver: m.marketplace.resolver,
  });
  const report = await dashboard.fullReport();
  assert(report.marketplace && report.marketplace.installed.length >= 1, 'Dashboard should include marketplace data');
  await fs.rm(m.snapshot.store.dataPath, { recursive: true, force: true });
  return { passed: true, dashboard: true };
}

async function runAll() {
  const sections = [];

  const marketplace = await marketplaceTest();
  sections.push({ title: 'Marketplace', passed: true, detail: marketplace });

  const repository = await repositoryTest();
  sections.push({ title: 'Repository', passed: true, detail: repository });

  const signature = await signatureTest();
  sections.push({ title: 'Signature & Trust', passed: true, detail: signature });

  const dependency = await dependencyTest();
  sections.push({ title: 'Dependency Resolution', passed: true, detail: dependency });

  const sandbox = await sandboxTest();
  sections.push({ title: 'Capability Sandbox', passed: true, detail: sandbox });

  const install = await installTest();
  sections.push({ title: 'Capability Install', passed: true, detail: install });

  const rollback = await rollbackTest();
  sections.push({ title: 'Rollback', passed: true, detail: rollback });

  const lifecycle = await lifecycleTest();
  sections.push({ title: 'Lifecycle Integration', passed: true, detail: lifecycle });

  const overall = { overall: 'PASS', sections };
  console.log(JSON.stringify(overall, null, 2));

  let md = '# Phase 40 — Verified Capability Marketplace Report\n\n';
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `Overall: **PASS**\n\n`;
  for (const section of sections) {
    md += `## ${section.title}\n\n`;
    md += `- Status: PASS\n`;
    md += `- Detail: \`\`\`json\n${JSON.stringify(section.detail, null, 2)}\n\`\`\`\n\n`;
  }
  await fs.writeFile(reportPath, md, 'utf8');
  return overall;
}

async function main() {
  const mode = process.argv[2] || 'all';
  try {
    switch (mode) {
      case 'marketplace': { const r = await marketplaceTest(); console.log(JSON.stringify(r, null, 2)); process.exit(r.passed ? 0 : 1); }
      case 'repository': { const r = await repositoryTest(); console.log(JSON.stringify(r, null, 2)); process.exit(r.passed ? 0 : 1); }
      case 'signature': { const r = await signatureTest(); console.log(JSON.stringify(r, null, 2)); process.exit(r.passed ? 0 : 1); }
      case 'dependency': { const r = await dependencyTest(); console.log(JSON.stringify(r, null, 2)); process.exit(r.passed ? 0 : 1); }
      case 'sandbox': { const r = await sandboxTest(); console.log(JSON.stringify(r, null, 2)); process.exit(r.passed ? 0 : 1); }
      case 'capability-install': { const r = await installTest(); console.log(JSON.stringify(r, null, 2)); process.exit(r.passed ? 0 : 1); }
      case 'rollback': { const r = await rollbackTest(); console.log(JSON.stringify(r, null, 2)); process.exit(r.passed ? 0 : 1); }
      case 'lifecycle': { const r = await lifecycleTest(); console.log(JSON.stringify(r, null, 2)); process.exit(r.passed ? 0 : 1); }
      case 'all':
      default: { const r = await runAll(); process.exit(r.overall === 'PASS' ? 0 : 1); }
    }
  } catch (e) {
    console.error(JSON.stringify({ overall: 'FAIL', error: e instanceof Error ? e.message : String(e) }, null, 2));
    process.exit(1);
  }
}

main();
