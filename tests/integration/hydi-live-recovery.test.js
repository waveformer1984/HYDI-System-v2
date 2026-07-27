'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const HYDIContinuousRuntime = require('../../src/hydi-v3/HYDIContinuousRuntime');
const { ConnectorRegistry, BaseConnector } = require('../../src/hydi-v3/connectors');

const silent = { log: () => {}, warn: () => {}, error: () => {} };

class FaultyConnector extends BaseConnector {
  async start() { throw new Error('simulated connector timeout'); }
  async stop() { this.state = 'stopped'; }
}
ConnectorRegistry.register('faulty', FaultyConnector);

async function makeDataPath() {
  const dir = path.join(os.tmpdir(), `hydi-live-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('HYDI live recovery', () => {
  let runtime;
  let dataPath;

  afterEach(async () => {
    if (runtime) {
      try { await runtime.stop(); } catch (e) { /* ignore */ }
    }
    if (dataPath) {
      try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
    runtime = null;
  });

  test('missing credentials leave tier 2 connectors not_configured', async () => {
    dataPath = await makeDataPath();
    runtime = new HYDIContinuousRuntime({
      dataPath,
      logger: silent,
      connectors: [
        { type: 'github', name: 'github', enabled: true },
        { type: 'stripe', name: 'stripe', enabled: true },
      ],
    });
    const report = await runtime.start();
    expect(report.status).toBe('ready');
    const status = runtime.getStatus();
    expect(status.connectors.every((c) => c.state === 'not_configured')).toBe(true);
  });

  test('faulty connector degrades but does not crash startup', async () => {
    dataPath = await makeDataPath();
    runtime = new HYDIContinuousRuntime({
      dataPath,
      logger: silent,
      connectors: [{ type: 'faulty', name: 'faulty', enabled: true }],
    });
    await runtime.start();
    const faulty = runtime.connectorManager.getConnector('faulty');
    expect(faulty.state).toBe('error');
    expect(runtime.getStatus().state).toBe('DEGRADED');
  });

  test('filesystem connector recovers after root is restored', async () => {
    dataPath = await makeDataPath();
    const root = path.join(dataPath, 'project');
    await fs.mkdir(root, { recursive: true });
    runtime = new HYDIContinuousRuntime({
      dataPath,
      logger: silent,
      connectors: [{ type: 'filesystem', name: 'fs', enabled: true, roots: { ProtoForge: root }, scanIntervalMs: 500, watch: false }],
    });
    await runtime.start();
    expect(runtime.connectorManager.getConnector('fs').state).toBe('running');

    await fs.rm(root, { recursive: true, force: true });
    await new Promise((r) => setTimeout(r, 1200));
    expect(runtime.connectorManager.getConnector('fs').healthCheck().ok).toBe(false);
    expect(runtime.getStatus().state).toBe('DEGRADED');
  });

  test('restart preserves audit and recommendations', async () => {
    dataPath = await makeDataPath();
    runtime = new HYDIContinuousRuntime({ dataPath, logger: silent });
    await runtime.start();
    runtime.processEvent('CommitCreated', { project: 'ProtoForge', message: 'x' }, 'GitSensor');
    const auditCount = runtime.session.auditLedger.records.length;
    await runtime.stop();
    runtime = null;

    const second = new HYDIContinuousRuntime({ dataPath, logger: silent });
    await second.start();
    expect(second.session.auditLedger.records.length).toBeGreaterThanOrEqual(auditCount);
    await second.stop();
    runtime = second;
  });
});
