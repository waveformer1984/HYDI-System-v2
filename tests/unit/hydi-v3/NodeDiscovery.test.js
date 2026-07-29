const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const NodeIdentity = require('../../../src/hydi-v3/NodeIdentity');
const NodeDiscovery = require('../../../src/hydi-v3/NodeDiscovery');

describe('NodeDiscovery', () => {
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `hydi-discovery-${Date.now()}`);
    await fs.mkdir(dataPath, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dataPath, { recursive: true, force: true }).catch(() => {});
  });

  test('returns static and manual peers without auto-trusting', () => {
    const discovery = new NodeDiscovery({
      staticPeers: [
        { nodeId: 'static-1', host: '10.0.0.1', port: 9000 },
      ],
      manualPeers: [
        { nodeId: 'manual-1', host: '10.0.0.2', port: 9001 },
      ],
    });

    const all = discovery.discover();
    expect(all.length).toBe(2);
    expect(all.every((p) => p.trusted === false)).toBe(true);
    expect(discovery.isTrusted('static-1')).toBe(false);
  });

  test('marks a peer trusted only after explicit trust assignment', () => {
    const discovery = new NodeDiscovery({
      staticPeers: [{ nodeId: 'peer-a', host: 'localhost', port: 1 }],
    });
    discovery.setTrusted('peer-a', 'pubkey-a');
    expect(discovery.isTrusted('peer-a')).toBe(true);
    const found = discovery.discover().find((p) => p.nodeId === 'peer-a');
    expect(found.trust).toBe('trusted');
  });

  test('emits announcements signed by identity', async () => {
    const identity = await new NodeIdentity({ dataPath, version: '1.0.0' }).init();
    const discovery = new NodeDiscovery({ identity, enableMulticast: false }).start();

    const announcements = [];
    discovery.on('announce', (a) => announcements.push(a));
    const a = discovery.announce();

    expect(a.nodeId).toBe(identity.nodeId);
    expect(a.signature).toBeTruthy();
    const payload = { ...a };
    delete payload.signature;
    expect(identity.verify(JSON.stringify(payload, Object.keys(payload).sort()), a.signature, identity.publicKey)).toBe(true);
  });

  test('operates offline when multicast is disabled', () => {
    const discovery = new NodeDiscovery({ staticPeers: [{ nodeId: 'offline-peer', host: 'x', port: 1 }] });
    expect(discovery.isOffline()).toBe(true);
    discovery.start();
    expect(discovery.isOffline()).toBe(false);
    expect(discovery.discover().length).toBe(1);
    discovery.stop();
    expect(discovery.isOffline()).toBe(true);
  });
});
