const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const NodeIdentity = require('../../../src/hydi-v3/NodeIdentity');
const LifecycleRegistry = require('../../../src/hydi-v3/LifecycleRegistry');

describe('NodeIdentity', () => {
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `hydi-node-identity-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dataPath, { recursive: true, force: true }).catch(() => {});
  });

  test('generates a new identity on first init', async () => {
    const identity = await new NodeIdentity({ dataPath }).init();
    expect(identity.nodeId).toBeTruthy();
    expect(identity.fingerprint).toBeTruthy();
    expect(identity.publicKey).toBeTruthy();
    expect(identity.privateKey).toBeTruthy();
    expect(identity.getTrust(identity.nodeId)).toBe('self');
  });

  test('serializes and reloads the same identity', async () => {
    const first = await new NodeIdentity({ dataPath, version: '1.2.3' }).init();
    const nodeId = first.nodeId;
    const fingerprint = first.fingerprint;

    const second = await new NodeIdentity({ dataPath, version: '1.2.3' }).init();
    expect(second.nodeId).toBe(nodeId);
    expect(second.fingerprint).toBe(fingerprint);
  });

  test('detects identity tampering on reload', async () => {
    const identity = await new NodeIdentity({ dataPath }).init();
    const identityPath = path.join(dataPath, 'node-identity.json');
    const raw = await fs.readFile(identityPath, 'utf8');
    const parsed = JSON.parse(raw);
    parsed.publicKey = parsed.publicKey.replace('A', 'B');
    await fs.writeFile(identityPath, JSON.stringify(parsed, null, 2));

    await expect(new NodeIdentity({ dataPath }).init()).rejects.toThrow('mismatch');
  });

  test('signs and verifies payloads', async () => {
    const alice = await new NodeIdentity({ dataPath, version: '1.0.0' }).init();
    const bobPath = path.join(os.tmpdir(), `hydi-bob-${Date.now()}`);
    await fs.mkdir(bobPath, { recursive: true });
    const bob = await new NodeIdentity({ dataPath: bobPath, version: '1.0.0' }).init();

    const payload = 'hello federation';
    const signature = alice.sign(payload);
    expect(typeof signature).toBe('string');
    expect(alice.verify(payload, signature, alice.publicKey)).toBe(true);
    expect(bob.verify(payload, signature, alice.publicKey)).toBe(true);

    await fs.rm(bobPath, { recursive: true, force: true }).catch(() => {});
  });

  test('verifyIdentity validates nodeId derived from public key', async () => {
    const alice = await new NodeIdentity({ dataPath, version: '1.0.0' }).init();
    const payload = JSON.stringify({ ts: Date.now() });
    const signature = alice.sign(payload);

    const result = alice.verifyIdentity(payload, signature, alice.publicKey, alice.nodeId);
    expect(result.valid).toBe(true);
    expect(result.nodeId).toBe(alice.nodeId);

    const bad = alice.verifyIdentity(payload, signature, alice.publicKey, 'impostor');
    expect(bad.valid).toBe(false);
  });

  test('trust status controls isTrusted', async () => {
    const identity = await new NodeIdentity({ dataPath }).init();
    expect(identity.isTrusted('some-node')).toBe(false);
    identity.setTrust('some-node', 'verified');
    expect(identity.isTrusted('some-node')).toBe(true);
    identity.setTrust('some-node', 'untrusted');
    expect(identity.isTrusted('some-node')).toBe(false);
    expect(identity.isRevoked('some-node')).toBe(true);
  });

  test('version compatibility is evaluated deterministically', async () => {
    const identity = await new NodeIdentity({ dataPath, version: '3.2.1', minCompatibleVersion: '2.0.0' }).init();
    expect(identity.isCompatible('3.0.0')).toBe(true);
    expect(identity.isCompatible('2.0.0')).toBe(true);
    expect(identity.isCompatible('1.9.9')).toBe(false);
    expect(identity.isCompatible('4.0.0')).toBe(false);
  });

  test('registers with LifecycleRegistry', async () => {
    const registry = new LifecycleRegistry({});
    const identity = await new NodeIdentity({ dataPath, lifecycleRegistry: registry }).init();
    const registered = registry.get('NodeIdentity');
    expect(registered).toBeTruthy();
    expect(registered.phase).toBe(41);
    expect(registered.health).toBe('healthy');
  });
});
