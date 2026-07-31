const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const NodeIdentity = require('../../../src/hydi-v3/NodeIdentity');
const NodeTransport = require('../../../src/hydi-v3/NodeTransport');
const NodeDiscovery = require('../../../src/hydi-v3/NodeDiscovery');
const DistributedCompute = require('../../../src/hydi-v3/DistributedCompute');
const NodeMesh = require('../../../src/hydi-v3/NodeMesh');

describe('NodeMesh', () => {
  let dataA;
  let dataB;
  let idA;
  let idB;
  let meshA;
  let meshB;
  let transA;
  let transB;

  beforeEach(async () => {
    dataA = path.join(os.tmpdir(), `hydi-mesh-a-${Date.now()}`);
    dataB = path.join(os.tmpdir(), `hydi-mesh-b-${Date.now()}`);
    await fs.mkdir(dataA, { recursive: true });
    await fs.mkdir(dataB, { recursive: true });
    idA = await new NodeIdentity({ dataPath: dataA, version: '1.0.0' }).init();
    idB = await new NodeIdentity({ dataPath: dataB, version: '1.0.0' }).init();

    const [adapterA, adapterB] = NodeTransport.LoopbackTransport.createPair(idA.nodeId, idB.nodeId, `mesh-hub-${Date.now()}`);
    transA = new NodeTransport({ identity: idA, adapter: adapterA });
    transB = new NodeTransport({ identity: idB, adapter: adapterB });

    const computeA = new DistributedCompute({ heartbeatIntervalMs: 100, nodeTimeoutMs: 200 });
    const computeB = new DistributedCompute({ heartbeatIntervalMs: 100, nodeTimeoutMs: 200 });

    meshA = new NodeMesh({ identity: idA, transport: transA, compute: computeA });
    meshB = new NodeMesh({ identity: idB, transport: transB, compute: computeB });
  });

  afterEach(async () => {
    await meshA.stop().catch(() => {});
    await meshB.stop().catch(() => {});
    await fs.rm(dataA, { recursive: true, force: true }).catch(() => {});
    await fs.rm(dataB, { recursive: true, force: true }).catch(() => {});
  });

  async function linkPeers() {
    await meshA.start();
    await meshB.start();
    transA.addPeer(idB.nodeId, idB.publicKey, 'loopback://b');
    transB.addPeer(idA.nodeId, idA.publicKey, 'loopback://a');
    await meshA.connect(idB.nodeId, idB.publicKey, 'loopback://b', { cpu: 2, ram: 2, capabilities: ['general'] });
    await meshB.connect(idA.nodeId, idA.publicKey, 'loopback://a', { cpu: 1, ram: 1, capabilities: ['general'] });
  }

  test('connects peers and advertises topology', async () => {
    await linkPeers();
    expect(meshA.getPeers().length).toBe(1);
    expect(meshB.getPeers().length).toBe(1);
    const topoA = meshA.getTopology();
    expect(topoA.peers[0].nodeId).toBe(idB.nodeId);
    expect(topoA.leader).not.toBeNull();
  });

  test('routes messages between peers', async () => {
    await linkPeers();
    const received = [];
    meshB.on('message', (m) => received.push(m));
    meshA.send(idB.nodeId, 'custom', { key: 'value' });
    await new Promise((r) => setTimeout(r, 50));
    expect(received.length).toBe(1);
    expect(received[0].type).toBe('custom');
  });

  test('schedules tasks deterministically across peers', async () => {
    await linkPeers();
    const result = meshA.schedule({ id: 't1', type: 'compute' });
    expect(result.status).toBe('assigned');
    expect([idA.nodeId, idB.nodeId]).toContain(result.nodeId);
  });

  test('updates peer capabilities from capability_advert', async () => {
    await linkPeers();
    const events = [];
    meshA.on('capability_advert', (e) => events.push(e));
    meshB.broadcast('capability_advert', { capabilities: ['gpu', 'inference'], gpu: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(events.length).toBe(1);
    const node = meshA.compute.getNode(idB.nodeId);
    expect(node.capabilities).toContain('gpu');
  });
});
