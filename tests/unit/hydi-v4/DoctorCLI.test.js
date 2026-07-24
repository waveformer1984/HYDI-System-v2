'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const { Kernel, DoctorCLI, HModule } = require('../../../src/hydi-v4');

function tmpDir() {
  return path.join(os.tmpdir(), `hydi-v4-doctor-${Date.now()}-${randomUUID().slice(0, 8)}`);
}

class HealthyModule extends HModule {
  constructor(kernel, id) {
    super(kernel, { id, name: id, version: '1.0.0', capabilities: ['compute'] });
  }

  async initialize() {
    this._initialized = true;
  }

  async start() {
    this._started = true;
  }

  async health() {
    return { healthy: true };
  }
}

describe('DoctorCLI', () => {
  let kernel;
  let cli;
  let dataPath;

  beforeEach(async () => {
    dataPath = tmpDir();
    process.env.HYDI_VAULT_KEY = `test-key-${randomUUID()}`;
    kernel = new Kernel({ dataPath, autoStartModules: false });
    cli = new DoctorCLI(kernel);
    await kernel.start();
    kernel.registerModule(new HealthyModule(kernel, 'mod-a'));
    await kernel.startModule('mod-a');
  });

  afterEach(async () => {
    await kernel.stop().catch(() => {});
    await fs.rm(dataPath, { recursive: true, force: true }).catch(() => {});
    delete process.env.HYDI_VAULT_KEY;
  });

  test('doctor returns healthy status', async () => {
    const result = await cli.run(['doctor']);
    expect(result.ok).toBe(true);
    expect(result.moduleCount).toBe(1);
  });

  test('modules lists registered modules', async () => {
    const result = await cli.run(['modules']);
    expect(result.ok).toBe(true);
    expect(result.modules.length).toBe(1);
  });

  test('validate checks graph and ledger', async () => {
    const result = await cli.run(['validate']);
    expect(result.ok).toBe(true);
  });

  test('release generates manifests', async () => {
    const result = await cli.run(['release']);
    expect(result.ok).toBe(true);
    expect(result.modules).toBe(1);
  });

  test('unknown command fails', async () => {
    const result = await cli.run(['badcmd']);
    expect(result.ok).toBe(false);
  });
});
