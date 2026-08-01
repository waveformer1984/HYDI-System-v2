const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { MigrationRunner, parseVersionFile } = require('../src/index');

function createNamedMigration(dir, version, name, body) {
  const file = path.join(dir, `${version}-${name}.js`);
  const code = typeof body === 'function'
    ? `module.exports = { description: '${name}', up: ${body.toString()}, down: ${body.toString()} };`
    : `module.exports = { description: '${name}', up: async () => { ${body} } };`;
  fs.writeFileSync(file, code);
  return file;
}

function safePath(stateFile) {
  return stateFile.replace(/\\/g, '/');
}

function stateWrite(stateFile, value) {
  return `require('fs').writeFileSync(${JSON.stringify(safePath(stateFile))}, ${JSON.stringify(value)});`;
}

function stateAppend(stateFile, value) {
  return `require('fs').appendFileSync(${JSON.stringify(safePath(stateFile))}, ${JSON.stringify(value)});`;
}

describe('migrations', () => {
  it('parses versioned migration filenames', () => {
    const parsed = parseVersionFile('0001-add-users.js');
    assert.deepStrictEqual(parsed, { version: '0001', name: 'add-users', file: '0001-add-users.js' });
  });

  it('rejects unversioned filenames', () => {
    assert.strictEqual(parseVersionFile('add-users.js'), null);
    assert.strictEqual(parseVersionFile('v1-add-users.js'), null);
  });

  it('discovers and sorts migrations', () => {
    const dir = path.join(os.tmpdir(), `mig-disc-${Date.now()}`, 'migrations');
    fs.mkdirSync(dir, { recursive: true });
    createNamedMigration(dir, '0002', 'add-events', '');
    createNamedMigration(dir, '0001', 'init', '');
    const runner = new MigrationRunner({ migrationsDir: dir });
    const all = runner.discover();
    assert.strictEqual(all.length, 2);
    assert.strictEqual(all[0].version, '0001');
    assert.strictEqual(all[1].version, '0002');
  });

  it('returns empty for missing directory', () => {
    const dir = path.join(os.tmpdir(), `mig-missing-${Date.now()}`, 'migrations');
    const runner = new MigrationRunner({ migrationsDir: dir });
    assert.deepStrictEqual(runner.discover(), []);
  });

  it('reports status before any runs', () => {
    const dir = path.join(os.tmpdir(), `mig-status1-${Date.now()}`, 'migrations');
    fs.mkdirSync(dir, { recursive: true });
    createNamedMigration(dir, '0001', 'init', '');
    const runner = new MigrationRunner({ migrationsDir: dir });
    const status = runner.status();
    assert.strictEqual(status.length, 1);
    assert.strictEqual(status[0].applied, false);
    assert.strictEqual(status[0].failed, false);
  });

  it('runs migrations in order', async () => {
    const dir = path.join(os.tmpdir(), `mig-run-${Date.now()}`, 'migrations');
    const stateFile = path.join(os.tmpdir(), `mig-run-${Date.now()}.state`);
    fs.mkdirSync(dir, { recursive: true });
    createNamedMigration(dir, '0001', 'init', stateWrite(stateFile, 'one'));
    createNamedMigration(dir, '0002', 'add-users', stateAppend(stateFile, 'two'));
    const runner = new MigrationRunner({ migrationsDir: dir });
    const result = await runner.run();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(fs.readFileSync(stateFile, 'utf-8'), 'onetwo');
  });

  it('skips already applied migrations', async () => {
    const dir = path.join(os.tmpdir(), `mig-skip-${Date.now()}`, 'migrations');
    const stateFile = path.join(os.tmpdir(), `mig-skip-${Date.now()}.state`);
    fs.mkdirSync(dir, { recursive: true });
    createNamedMigration(dir, '0001', 'init', stateWrite(stateFile, 'a'));
    const runner = new MigrationRunner({ migrationsDir: dir });
    const first = await runner.run();
    const second = await runner.run();
    assert.strictEqual(second.results[0].status, 'skipped');
    assert.strictEqual(fs.readFileSync(stateFile, 'utf-8'), 'a');
  });

  it('stops on failure by default', async () => {
    const dir = path.join(os.tmpdir(), `mig-fail-${Date.now()}`, 'migrations');
    fs.mkdirSync(dir, { recursive: true });
    createNamedMigration(dir, '0001', 'ok', '');
    createNamedMigration(dir, '0002', 'bad', `throw new Error('boom');`);
    createNamedMigration(dir, '0003', 'later', '');
    const runner = new MigrationRunner({ migrationsDir: dir });
    const result = await runner.run();
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.results.length, 2);
    assert.strictEqual(result.results[1].status, 'failed');
  });

  it('continues on failure when asked', async () => {
    const dir = path.join(os.tmpdir(), `mig-continue-${Date.now()}`, 'migrations');
    fs.mkdirSync(dir, { recursive: true });
    createNamedMigration(dir, '0001', 'ok', '');
    createNamedMigration(dir, '0002', 'bad', `throw new Error('boom');`);
    createNamedMigration(dir, '0003', 'ok2', '');
    const runner = new MigrationRunner({ migrationsDir: dir });
    const result = await runner.run({ continueOnError: true });
    assert.strictEqual(result.results.length, 3);
    assert.strictEqual(result.results[1].status, 'failed');
    assert.strictEqual(result.results[2].status, 'applied');
    assert.strictEqual(result.ok, false);
  });

  it('rolls back applied migrations', async () => {
    const dir = path.join(os.tmpdir(), `mig-rollback-${Date.now()}`, 'migrations');
    const stateFile = path.join(os.tmpdir(), `mig-rollback-${Date.now()}.state`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(stateFile, 'init');
    fs.writeFileSync(
      path.join(dir, '0001-init.js'),
      `module.exports = { description: 'init', up: async () => { require('fs').appendFileSync(${JSON.stringify(safePath(stateFile))}, 'up1'); }, down: async () => { require('fs').appendFileSync(${JSON.stringify(safePath(stateFile))}, 'down1'); } };`
    );
    fs.writeFileSync(
      path.join(dir, '0002-users.js'),
      `module.exports = { description: 'users', up: async () => { require('fs').appendFileSync(${JSON.stringify(safePath(stateFile))}, 'up2'); }, down: async () => { require('fs').appendFileSync(${JSON.stringify(safePath(stateFile))}, 'down2'); } };`
    );
    const runner = new MigrationRunner({ migrationsDir: dir });
    await runner.run();
    const result = await runner.rollback();
    assert.strictEqual(result.ok, true);
    const content = fs.readFileSync(stateFile, 'utf-8');
    assert.ok(content.includes('down2'));
    assert.ok(content.includes('down1'));
  });

  it('rollbacks respect target version', async () => {
    const dir = path.join(os.tmpdir(), `mig-roll-to-${Date.now()}`, 'migrations');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '0001-init.js'), `module.exports = { description: 'init', up: () => {}, down: () => {} };`);
    fs.writeFileSync(path.join(dir, '0002-users.js'), `module.exports = { description: 'users', up: () => {}, down: () => {} };`);
    fs.writeFileSync(path.join(dir, '0003-events.js'), `module.exports = { description: 'events', up: () => {}, down: () => {} };`);
    const runner = new MigrationRunner({ migrationsDir: dir });
    await runner.run();
    const result = await runner.rollback({ to: '0002' });
    assert.strictEqual(result.results.length, 1);
    assert.strictEqual(result.results[0].version, '0003');
  });

  it('supports dry-run', async () => {
    const dir = path.join(os.tmpdir(), `mig-dry-${Date.now()}`, 'migrations');
    const stateFile = path.join(os.tmpdir(), `mig-dry-${Date.now()}.state`);
    fs.mkdirSync(dir, { recursive: true });
    createNamedMigration(dir, '0001', 'init', stateWrite(stateFile, 'x'));
    const runner = new MigrationRunner({ migrationsDir: dir, dryRun: true });
    const result = await runner.run();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.results[0].status, 'dry-run');
    assert.strictEqual(fs.existsSync(stateFile), false);
  });

  it('resets status', async () => {
    const dir = path.join(os.tmpdir(), `mig-reset-${Date.now()}`, 'migrations');
    fs.mkdirSync(dir, { recursive: true });
    createNamedMigration(dir, '0001', 'init', '');
    const runner = new MigrationRunner({ migrationsDir: dir });
    await runner.run();
    runner.reset();
    const status = runner.status();
    assert.strictEqual(status[0].applied, false);
  });

  it('throws when migration lacks up', async () => {
    const dir = path.join(os.tmpdir(), `mig-noup-${Date.now()}`, 'migrations');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '0001-noup.js'), `module.exports = {};`);
    const runner = new MigrationRunner({ migrationsDir: dir });
    await assert.rejects(runner.run(), /does not export an up/);
  });

  it('reports failed status', async () => {
    const dir = path.join(os.tmpdir(), `mig-failed-status-${Date.now()}`, 'migrations');
    fs.mkdirSync(dir, { recursive: true });
    createNamedMigration(dir, '0001', 'bad', `throw new Error('boom');`);
    const runner = new MigrationRunner({ migrationsDir: dir });
    await runner.run();
    const status = runner.status();
    assert.strictEqual(status[0].failed, true);
    assert.strictEqual(status[0].applied, false);
  });

  it('runs up to a target version', async () => {
    const dir = path.join(os.tmpdir(), `mig-to-${Date.now()}`, 'migrations');
    fs.mkdirSync(dir, { recursive: true });
    createNamedMigration(dir, '0001', 'init', '');
    createNamedMigration(dir, '0002', 'users', '');
    createNamedMigration(dir, '0003', 'events', '');
    const runner = new MigrationRunner({ migrationsDir: dir });
    const result = await runner.run({ to: '0002' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.results.length, 2);
    assert.strictEqual(result.results[0].status, 'applied');
    assert.strictEqual(result.results[1].status, 'applied');
    const status = runner.status();
    assert.strictEqual(status[0].applied, true);
    assert.strictEqual(status[1].applied, true);
    assert.strictEqual(status[2].applied, false);
  });
});
