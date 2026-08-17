const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
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
} = require('../src/index');

describe('application-upgrades', () => {
  it('parses a simple version', () => {
    const v = parseVersion('1.2.3');
    assert.deepStrictEqual(v, { major: 1, minor: 2, patch: 3, prerelease: null, build: null, raw: '1.2.3' });
  });

  it('parses a version with prerelease', () => {
    const v = parseVersion('2.0.0-alpha.1');
    assert.strictEqual(v.major, 2);
    assert.strictEqual(v.prerelease, 'alpha.1');
  });

  it('parses a version with build metadata', () => {
    const v = parseVersion('1.0.0+build.123');
    assert.strictEqual(v.build, 'build.123');
  });

  it('rejects invalid version strings', () => {
    assert.strictEqual(parseVersion('not-a-version'), null);
    assert.strictEqual(parseVersion(''), null);
    assert.strictEqual(parseVersion('1.2'), null);
    assert.strictEqual(parseVersion('v1.2.3'), null);
  });

  it('compares equal versions', () => {
    assert.strictEqual(compareVersions('1.2.3', '1.2.3'), 0);
  });

  it('compares major version differences', () => {
    assert.strictEqual(compareVersions('1.0.0', '2.0.0'), -1);
    assert.strictEqual(compareVersions('2.0.0', '1.0.0'), 1);
  });

  it('compares minor version differences', () => {
    assert.strictEqual(compareVersions('1.1.0', '1.2.0'), -1);
    assert.strictEqual(compareVersions('1.3.0', '1.2.0'), 1);
  });

  it('compares patch version differences', () => {
    assert.strictEqual(compareVersions('1.1.1', '1.1.2'), -1);
    assert.strictEqual(compareVersions('1.1.5', '1.1.4'), 1);
  });

  it('treats prereleases as lower', () => {
    assert.strictEqual(compareVersions('1.0.0-alpha', '1.0.0'), -1);
    assert.strictEqual(compareVersions('1.0.0', '1.0.0-alpha'), 1);
  });

  it('throws on invalid comparison inputs', () => {
    assert.throws(() => compareVersions('bad', '1.0.0'), /invalid semantic version/);
  });

  it('detects upgrades', () => {
    assert.strictEqual(isUpgrade('1.0.0', '1.0.1'), true);
    assert.strictEqual(isUpgrade('1.0.0', '2.0.0'), true);
    assert.strictEqual(isUpgrade('2.0.0', '1.0.0'), false);
    assert.strictEqual(isUpgrade('1.0.0', '1.0.0'), false);
  });

  it('detects major upgrades', () => {
    assert.strictEqual(isMajorUpgrade('1.2.3', '2.0.0'), true);
    assert.strictEqual(isMajorUpgrade('1.2.3', '1.3.0'), false);
    assert.strictEqual(isMajorUpgrade('1.0.0', '2.0.0-rc.1'), true);
  });

  it('detects minor upgrades', () => {
    assert.strictEqual(isMinorUpgrade('1.0.0', '1.1.0'), true);
    assert.strictEqual(isMinorUpgrade('1.0.0', '1.0.1'), false);
    assert.strictEqual(isMinorUpgrade('1.0.0', '2.0.0'), false);
  });

  it('detects patch upgrades', () => {
    assert.strictEqual(isPatchUpgrade('1.0.0', '1.0.1'), true);
    assert.strictEqual(isPatchUpgrade('1.0.0', '1.1.0'), false);
  });

  it('satisfies exact version', () => {
    assert.strictEqual(satisfies('1.2.3', '1.2.3'), true);
    assert.strictEqual(satisfies('1.2.4', '1.2.3'), false);
  });

  it('satisfies caret range', () => {
    assert.strictEqual(satisfies('1.2.3', '^1.0.0'), true);
    assert.strictEqual(satisfies('1.5.0', '^1.0.0'), true);
    assert.strictEqual(satisfies('2.0.0', '^1.0.0'), false);
    assert.strictEqual(satisfies('0.2.5', '^0.2.0'), true);
    assert.strictEqual(satisfies('0.5.0', '^0.2.0'), false);
    assert.strictEqual(satisfies('0.3.0', '^0.2.0'), false);
  });

  it('satisfies tilde range', () => {
    assert.strictEqual(satisfies('1.2.5', '~1.2.0'), true);
    assert.strictEqual(satisfies('1.3.0', '~1.2.0'), false);
  });

  it('satisfies greater-than range', () => {
    assert.strictEqual(satisfies('1.2.0', '>=1.0.0'), true);
    assert.strictEqual(satisfies('0.9.0', '>=1.0.0'), false);
  });

  it('satisfies wildcard', () => {
    assert.strictEqual(satisfies('9.9.9', '*'), true);
  });

  it('rejects invalid satisfaction inputs', () => {
    assert.strictEqual(satisfies('not-a-version', '^1.0.0'), false);
  });

  it('declares patch upgrade compatible', () => {
    const result = isCompatible('1.0.0', '1.0.1', {}, {});
    assert.strictEqual(result.ok, true);
  });

  it('declares minor upgrade compatible', () => {
    const result = isCompatible('1.0.0', '1.1.0', {}, {});
    assert.strictEqual(result.ok, true);
  });

  it('declares major upgrade compatible', () => {
    const result = isCompatible('1.0.0', '2.0.0', {}, {});
    assert.strictEqual(result.ok, true);
  });

  it('rejects downgrade', () => {
    const result = isCompatible('2.0.0', '1.0.0', {}, {});
    assert.strictEqual(result.ok, false);
    assert.ok(result.reason.includes('greater'));
  });

  it('revents event removal on minor upgrade', () => {
    const current = { eventsProduced: ['a.created'] };
    const target = { eventsProduced: ['b.created'] };
    const result = isCompatible('1.0.0', '1.1.0', current, target);
    assert.strictEqual(result.ok, false);
    assert.ok(result.reason.includes('major upgrade'));
  });

  it('allows event removal on major upgrade', () => {
    const current = { eventsProduced: ['a.created'] };
    const target = { eventsProduced: ['b.created'] };
    const result = isCompatible('1.0.0', '2.0.0', current, target);
    assert.strictEqual(result.ok, true);
  });

  it('revents capability removal on minor upgrade', () => {
    const current = { capabilities: ['builder'] };
    const target = { capabilities: ['runner'] };
    const result = isCompatible('1.0.0', '1.1.0', current, target);
    assert.strictEqual(result.ok, false);
    assert.ok(result.reason.includes('major upgrade'));
  });

  it('rejects missing health requirement in target', () => {
    const target = { healthRequirements: ['supabase'] };
    const result = isCompatible('1.0.0', '1.0.1', {}, target);
    assert.strictEqual(result.ok, false);
    assert.ok(result.reason.includes('supabase'));
  });

  it('UpgradeHistory stores and retrieves records', () => {
    const dir = path.join(os.tmpdir(), `upg-hist-${Date.now()}`);
    const history = new UpgradeHistory({ storageDir: dir });
    const record = history.record('proto-yi', { from: '0.1.0', to: '0.2.0', status: 'completed' });
    assert.strictEqual(record.to, '0.2.0');
    const entries = history.getHistory('proto-yi');
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(history.last('proto-yi').to, '0.2.0');
  });

  it('UpgradeHistory returns empty for unknown app', () => {
    const dir = path.join(os.tmpdir(), `upg-hist2-${Date.now()}`);
    const history = new UpgradeHistory({ storageDir: dir });
    assert.deepStrictEqual(history.getHistory('unknown'), []);
    assert.strictEqual(history.last('unknown'), null);
  });

  it('UpgradeHistory clears records', () => {
    const dir = path.join(os.tmpdir(), `upg-hist3-${Date.now()}`);
    const history = new UpgradeHistory({ storageDir: dir });
    history.record('proto-yi', { to: '0.2.0', status: 'completed' });
    history.clear('proto-yi');
    assert.deepStrictEqual(history.getHistory('proto-yi'), []);
  });

  it('UpgradePlanner builds a patch plan', () => {
    const dir = path.join(os.tmpdir(), `upg-plan-${Date.now()}`);
    const history = new UpgradeHistory({ storageDir: dir });
    history.record('proto-yi', { to: '0.1.0', status: 'completed' });
    const planner = new UpgradePlanner({ history });
    const plan = planner.plan('proto-yi', '0.1.1');
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.upgradeType, 'patch');
    assert.ok(plan.steps.some(s => s.name === 'test'));
  });

  it('UpgradePlanner builds a major plan', () => {
    const dir = path.join(os.tmpdir(), `upg-plan2-${Date.now()}`);
    const history = new UpgradeHistory({ storageDir: dir });
    const planner = new UpgradePlanner({ history });
    const plan = planner.plan('proto-yi', '1.0.0');
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.upgradeType, 'major');
    assert.ok(plan.steps.some(s => s.description.includes('major migration')));
  });

  it('UpgradePlanner rejects invalid target version', () => {
    const planner = new UpgradePlanner({});
    const plan = planner.plan('proto-yi', 'not-a-version');
    assert.strictEqual(plan.ok, false);
    assert.ok(plan.error.includes('invalid'));
  });

  it('UpgradePlanner rejects downgrade', () => {
    const dir = path.join(os.tmpdir(), `upg-plan3-${Date.now()}`);
    const history = new UpgradeHistory({ storageDir: dir });
    history.record('proto-yi', { to: '1.0.0', status: 'completed' });
    const planner = new UpgradePlanner({ history });
    const plan = planner.plan('proto-yi', '0.9.0');
    assert.strictEqual(plan.ok, false);
    assert.ok(plan.error.includes('not greater'));
  });

  it('UpgradePlanner uses current version from history', () => {
    const dir = path.join(os.tmpdir(), `upg-plan4-${Date.now()}`);
    const history = new UpgradeHistory({ storageDir: dir });
    history.record('proto-yi', { to: '0.2.0', status: 'completed' });
    const planner = new UpgradePlanner({ history });
    const plan = planner.plan('proto-yi', '0.2.1');
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.from, '0.2.0');
  });

  it('UpgradePlanner detects incompatible minor event removal', () => {
    const dir = path.join(os.tmpdir(), `upg-plan5-${Date.now()}`);
    const history = new UpgradeHistory({ storageDir: dir });
    history.record('proto-yi', { to: '0.1.0', status: 'completed' });
    const manifests = {
      '0.1.0': { eventsProduced: ['a.created'] },
      '0.2.0': { eventsProduced: ['b.created'] }
    };
    const planner = new UpgradePlanner({
      history,
      getManifest: (name, version) => manifests[version] || {}
    });
    const plan = planner.plan('proto-yi', '0.2.0');
    assert.strictEqual(plan.ok, false);
    assert.ok(plan.error.includes('major upgrade'));
  });

  it('UpgradePlanner approves a plan', () => {
    const planner = new UpgradePlanner({});
    const plan = { ok: true, appName: 'proto-yi', to: '0.1.1' };
    const approved = planner.approve(plan);
    assert.strictEqual(approved.ok, true);
    assert.strictEqual(approved.status, 'approved');
  });

  it('UpgradePlanner records completed upgrade', () => {
    const dir = path.join(os.tmpdir(), `upg-comp-${Date.now()}`);
    const history = new UpgradeHistory({ storageDir: dir });
    const planner = new UpgradePlanner({ history });
    const result = planner.complete('proto-yi', '0.2.0');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(history.last('proto-yi').status, 'completed');
  });

  it('UpgradePlanner records failed upgrade', () => {
    const dir = path.join(os.tmpdir(), `upg-fail-${Date.now()}`);
    const history = new UpgradeHistory({ storageDir: dir });
    const planner = new UpgradePlanner({ history });
    const result = planner.fail('proto-yi', '0.2.0', 'migration error');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(history.last('proto-yi').status, 'failed');
    assert.strictEqual(history.last('proto-yi').reason, 'migration error');
  });
});
