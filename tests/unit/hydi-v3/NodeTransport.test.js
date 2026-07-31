const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const NodeIdentity = require('../../../src/hydi-v3/NodeIdentity');
const NodeTransport = require('../../../src/hydi-v3/NodeTransport');

describe('NodeTransport', () => {
  let aliceId;
  let bobId;
  let dataPathAlice;
  let dataPathBob;

  beforeEach(async () => {
    dataPathAlice = path.join(os.tmpdir(), `hydi-alice-${Date.now()}`);
    dataPathBob = path.join(os.tmpdir(), `hydi-bob-${Date.now()}`);
    await fs.mkdir(dataPathAlice, { recursive: true });
    await fs.mkdir(dataPathBob, { recursive: true });
    aliceId = await new NodeIdentity({ dataPath: dataPathAlice, version: '1.0.0' }).init();
    bobId = await new NodeIdentity({ dataPath: dataPathBob, version: '1.0.0' }).init();
  });

  afterEach(async () => {
    await fs.rm(dataPathAlice, { recursive: true, force: true }).catch(() => {});
    await fs.rm(dataPathBob, { recursive: true, force: true }).catch(() => {});
  });

  function createLinkedPair() {
    const [adapterA, adapterB] = NodeTransport.LoopbackTransport.createPair(
      aliceId.nodeId,
      bobId.nodeId,
      `test-hub-${Date.now()}`
    );
    const alice = new NodeTransport({ identity: aliceId, adapter: adapterA });
    const bob = new NodeTransport({ identity: bobId, adapter: adapterB });
    return { alice, bob };
  }

  test('authenticates and delivers messages between peers', async () => {
    const { alice, bob } = createLinkedPair();
    await alice.start();
    await bob.start();

    alice.addPeer(bobId.nodeId, bobId.publicKey, 'loopback://bob');
    bob.addPeer(aliceId.nodeId, aliceId.publicKey, 'loopback://alice');

    const received = [];
    bob.on('message', (msg) => received.push(msg));
    alice.send(bobId.nodeId, 'ping', { hello: true });

    await new Promise((r) => setTimeout(r, 50));
    expect(received.length).toBe(1);
    expect(received[0].from).toBe(aliceId.nodeId);
    expect(received[0].type).toBe('ping');
    expect(received[0].payload.hello).toBe(true);

    await alice.stop();
    await bob.stop();
  });

  test('rejects messages from unregistered peers', async () => {
    const { alice, bob } = createLinkedPair();
    await alice.start();
    await bob.start();

    // Only alice knows bob, not vice versa
    alice.addPeer(bobId.nodeId, bobId.publicKey, 'loopback://bob');

    const untrusted = [];
    bob.on('untrusted', (e) => untrusted.push(e));
    alice.send(bobId.nodeId, 'ping', {});

    await new Promise((r) => setTimeout(r, 50));
    expect(untrusted.length).toBe(1);
    expect(untrusted[0].reason).toBe('peer_not_registered');

    await alice.stop();
    await bob.stop();
  });

  test('rejects replayed messages', async () => {
    const { alice, bob } = createLinkedPair();
    await alice.start();
    await bob.start();
    alice.addPeer(bobId.nodeId, bobId.publicKey, 'loopback://bob');
    bob.addPeer(aliceId.nodeId, aliceId.publicKey, 'loopback://alice');

    const body = { type: 'ping', payload: {}, from: aliceId.nodeId, ts: Date.now(), nonce: 'duplicate' };
    const signature = aliceId.sign(JSON.stringify(body, Object.keys(body).sort()));
    const envelope = { ...body, signature };
    const plaintext = Buffer.from(JSON.stringify(envelope), 'utf8');

    const rejected = [];
    bob.on('rejected', (e) => rejected.push(e));

    alice.adapter.send(bobId.nodeId, plaintext);
    await new Promise((r) => setTimeout(r, 30));
    alice.adapter.send(bobId.nodeId, plaintext);
    await new Promise((r) => setTimeout(r, 30));

    expect(rejected.length).toBe(1);
    expect(rejected[0].reason).toBe('replay');

    await alice.stop();
    await bob.stop();
  });

  test('loopback frames are encrypted, not plaintext', async () => {
    const [adapterA, adapterB] = NodeTransport.LoopbackTransport.createPair(
      aliceId.nodeId,
      bobId.nodeId,
      `plain-hub-${Date.now()}`
    );
    const captured = [];
    const original = adapterA._receive.bind(adapterA);
    adapterA._receive = (from, frame) => { captured.push(frame); return original(from, frame); };
    adapterA.start();
    adapterB.start();

    const secret = 'this-is-a-secret';
    adapterB.send(aliceId.nodeId, Buffer.from(secret));
    await new Promise((r) => setTimeout(r, 30));

    expect(captured.length).toBe(1);
    const raw = captured[0].toString('utf8');
    expect(raw).not.toBe(secret);
    expect(captured[0].length).toBeGreaterThanOrEqual(secret.length + 12 + 16);

    adapterA.stop();
    adapterB.stop();
  });
});
