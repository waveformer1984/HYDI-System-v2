const fs = require('fs');
const path = require('path');

function parseVersion(version) {
  if (typeof version !== 'string' || !version) {
    return null;
  }
  const match = version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\w.]+))?(?:\+([\w.]+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null,
    build: match[5] || null,
    raw: version
  };
}

function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) {
    throw new Error('invalid semantic version');
  }

  for (const key of ['major', 'minor', 'patch']) {
    if (va[key] !== vb[key]) return va[key] > vb[key] ? 1 : -1;
  }

  if (va.prerelease && !vb.prerelease) return -1;
  if (!va.prerelease && vb.prerelease) return 1;
  if (va.prerelease && vb.prerelease) {
    const pa = va.prerelease.split('.');
    const pb = vb.prerelease.split('.');
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      if (pa[i] === undefined) return -1;
      if (pb[i] === undefined) return 1;
      const na = parseInt(pa[i], 10);
      const nb = parseInt(pb[i], 10);
      if (!isNaN(na) && !isNaN(nb)) {
        if (na !== nb) return na > nb ? 1 : -1;
      } else {
        if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
      }
    }
  }

  return 0;
}

function isUpgrade(from, to) {
  return compareVersions(from, to) < 0;
}

function isMajorUpgrade(from, to) {
  const va = parseVersion(from);
  const vb = parseVersion(to);
  if (!va || !vb) return false;
  return vb.major > va.major;
}

function isMinorUpgrade(from, to) {
  const va = parseVersion(from);
  const vb = parseVersion(to);
  if (!va || !vb) return false;
  return vb.major === va.major && vb.minor > va.minor;
}

function isPatchUpgrade(from, to) {
  const va = parseVersion(from);
  const vb = parseVersion(to);
  if (!va || !vb) return false;
  return vb.major === va.major && vb.minor === va.minor && vb.patch > va.patch;
}

function satisfies(version, range) {
  const parsed = parseVersion(version);
  if (!parsed) return false;

  if (range === '*') return true;

  const caret = range.match(/^\^(.*)$/);
  if (caret) {
    const target = parseVersion(caret[1]);
    if (!target) return false;
    if (parsed.major !== target.major) return false;
    if (parsed.major === 0) {
      if (parsed.minor !== target.minor) return false;
    }
    return compareVersions(version, caret[1]) >= 0;
  }

  const tilde = range.match(/^~(.*)$/);
  if (tilde) {
    const target = parseVersion(tilde[1]);
    if (!target) return false;
    if (parsed.major !== target.major || parsed.minor !== target.minor) return false;
    return compareVersions(version, tilde[1]) >= 0;
  }

  const gte = range.match(/^>=\s*(.*)$/);
  if (gte) {
    return compareVersions(version, gte[1]) >= 0;
  }

  const exact = range.match(/^\d+\.\d+\.\d+$/);
  if (exact) {
    return compareVersions(version, range) === 0;
  }

  return false;
}

function isCompatible(currentVersion, targetVersion, currentManifest = {}, targetManifest = {}) {
  if (!isUpgrade(currentVersion, targetVersion)) {
    return { ok: false, reason: 'target version must be greater than current version' };
  }

  const currentEvents = new Set(currentManifest.eventsProduced || []);
  const targetEvents = new Set(targetManifest.eventsProduced || []);
  const removedEvents = [...currentEvents].filter(e => !targetEvents.has(e));

  if (removedEvents.length > 0 && isMajorUpgrade(currentVersion, targetVersion) === false) {
    return { ok: false, reason: `removing events ${removedEvents.join(', ')} requires a major upgrade` };
  }

  const currentCaps = new Set(currentManifest.capabilities || []);
  const targetCaps = new Set(targetManifest.capabilities || []);
  const removedCaps = [...currentCaps].filter(c => !targetCaps.has(c));

  if (removedCaps.length > 0 && isMajorUpgrade(currentVersion, targetVersion) === false) {
    return { ok: false, reason: `removing capabilities ${removedCaps.join(', ')} requires a major upgrade` };
  }

  const targetServices = new Set([
    ...(targetManifest.providers || []),
    ...(targetManifest.dependencies?.services || [])
  ]);
  const required = targetManifest.healthRequirements || [];
  for (const svc of required) {
    if (!targetServices.has(svc)) {
      return { ok: false, reason: `target requires service ${svc} but it is not declared` };
    }
  }

  return { ok: true };
}

class UpgradeHistory {
  constructor(options = {}) {
    this.storageDir = options.storageDir || process.cwd();
    this.storePath = path.join(this.storageDir, '.protoforge', 'upgrade-history.json');
  }

  _ensureStore() {
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.storePath)) {
      fs.writeFileSync(this.storePath, JSON.stringify({}, null, 2));
    }
  }

  _read() {
    this._ensureStore();
    try {
      return JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
    } catch {
      return {};
    }
  }

  _write(data) {
    this._ensureStore();
    fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2));
  }

  getHistory(appName) {
    const store = this._read();
    return store[appName] || [];
  }

  record(appName, record) {
    const store = this._read();
    if (!store[appName]) store[appName] = [];
    const entry = {
      id: `${appName}-${Date.now()}`,
      startedAt: new Date().toISOString(),
      ...record
    };
    store[appName].push(entry);
    this._write(store);
    return entry;
  }

  last(appName) {
    const entries = this.getHistory(appName);
    return entries[entries.length - 1] || null;
  }

  clear(appName) {
    const store = this._read();
    delete store[appName];
    this._write(store);
  }
}

class UpgradePlanner {
  constructor(options = {}) {
    this.history = options.history || new UpgradeHistory();
    this.getManifest = options.getManifest || (() => ({}));
  }

  plan(appName, targetVersion) {
    const currentRecord = this.history.last(appName);
    const currentVersion = currentRecord ? currentRecord.to : '0.0.0';

    const currentManifest = this.getManifest(appName, currentVersion) || {};
    const targetManifest = this.getManifest(appName, targetVersion) || {};

    const parsed = parseVersion(targetVersion);
    if (!parsed) {
      return { ok: false, error: 'invalid target version' };
    }

    if (!isUpgrade(currentVersion, targetVersion)) {
      return { ok: false, error: `target ${targetVersion} is not greater than current ${currentVersion}` };
    }

    const compat = isCompatible(currentVersion, targetVersion, currentManifest, targetManifest);
    if (!compat.ok) {
      return { ok: false, error: compat.reason };
    }

    const steps = [];
    steps.push({ name: 'validate', description: `validate manifest for ${appName} ${targetVersion}` });
    steps.push({ name: 'compatibility', description: `check compatibility from ${currentVersion} to ${targetVersion}` });
    steps.push({ name: 'backup', description: 'backup current state' });
    if (isMajorUpgrade(currentVersion, targetVersion)) {
      steps.push({ name: 'migration', description: 'run major migration' });
    } else if (isMinorUpgrade(currentVersion, targetVersion)) {
      steps.push({ name: 'migration', description: 'run minor migration' });
    } else {
      steps.push({ name: 'migration', description: 'run patch migration' });
    }
    steps.push({ name: 'test', description: `run certification tests for ${appName}` });
    steps.push({ name: 'approve', description: 'await approval' });
    steps.push({ name: 'activate', description: `activate ${appName} ${targetVersion}` });

    return {
      ok: true,
      appName,
      from: currentVersion,
      to: targetVersion,
      upgradeType: isMajorUpgrade(currentVersion, targetVersion) ? 'major' : (isMinorUpgrade(currentVersion, targetVersion) ? 'minor' : 'patch'),
      steps,
      compatibility: compat
    };
  }

  approve(plan) {
    if (!plan || !plan.ok) {
      return { ok: false, error: 'invalid upgrade plan' };
    }
    return { ok: true, status: 'approved', plan };
  }

  complete(appName, targetVersion, metadata = {}) {
    const entry = this.history.record(appName, {
      to: targetVersion,
      status: 'completed',
      completedAt: new Date().toISOString(),
      ...metadata
    });
    return { ok: true, status: 'completed', entry };
  }

  fail(appName, targetVersion, reason) {
    const entry = this.history.record(appName, {
      to: targetVersion,
      status: 'failed',
      completedAt: new Date().toISOString(),
      reason
    });
    return { ok: true, status: 'failed', entry };
  }
}

module.exports = {
  parseVersion,
  compareVersions,
  isUpgrade,
  isMajorUpgrade,
  isMinorUpgrade,
  isPatchUpgrade,
  satisfies,
  isCompatible,
  UpgradeHistory,
  UpgradePlanner
};
