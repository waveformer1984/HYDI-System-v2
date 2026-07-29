'use strict';

const { EventEmitter } = require('events');
const crypto = require('crypto');

const IV_LEN = 12;
const TAG_LEN = 16;
const NONCE_WINDOW_MS = 300000;

function canonicalString(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function pruneSeen(seen, now) {
  for (const [nonce, ts] of seen) {
    if (now - ts > NONCE_WINDOW_MS) seen.delete(nonce);
  }
}

/**
 * LoopbackTransport is an in-memory encrypted transport adapter used for tests
 * and local simulations. It never sends plaintext and can be swapped for a
 * socket, WebSocket, or mDNS transport without changing NodeTransport callers.
 */
class LoopbackTransport extends EventEmitter {
  constructor(hubId, nodeId) {
    super();
    this.hubId = hubId;
    this.nodeId = nodeId;
    this.hub = null;
    this._started = false;
  }

  start() {
    if (this._started) return;
    this._started = true;
    if (!LoopbackTransport.hubs.has(this.hubId)) {
      LoopbackTransport.hubs.set(this.hubId, { key: crypto.randomBytes(32), peers: new Map() });
    }
    this.hub = LoopbackTransport.hubs.get(this.hubId);
    this.hub.peers.set(this.nodeId, this);
  }

  stop() {
    this._started = false;
    if (!this.hub) return;
    this.hub.peers.delete(this.nodeId);
    if (this.hub.peers.size === 0) LoopbackTransport.hubs.delete(this.hubId);
    this.hub = null;
  }

  connect(remoteNodeId) {
    if (!this._started) throw new Error('transport_not_started');
    return { remoteNodeId, connected: true };
  }

  send(remoteNodeId, data) {
    if (!this._started) throw new Error('transport_not_started');
    const peer = this.hub.peers.get(remoteNodeId);
    if (!peer) throw new Error(`peer_not_found:${remoteNodeId}`);
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.hub.key, iv);
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    const frame = Buffer.concat([iv, tag, ciphertext]);
    peer._receive(this.nodeId, frame);
  }

  _receive(fromNodeId, frame) {
    try {
      const iv = frame.slice(0, IV_LEN);
      const tag = frame.slice(IV_LEN, IV_LEN + TAG_LEN);
      const ciphertext = frame.slice(IV_LEN + TAG_LEN);
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.hub.key, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      this.emit('message', { from: fromNodeId, data: plaintext });
    } catch (err) {
      this.emit('error', { error: err instanceof Error ? err.message : String(err), from: fromNodeId });
    }
  }

  static createPair(nodeA, nodeB, hubId) {
    const id = hubId || `hub-${crypto.randomBytes(8).toString('hex')}`;
    const key = crypto.randomBytes(32);
    LoopbackTransport.hubs.set(id, { key, peers: new Map() });
    const a = new LoopbackTransport(id, nodeA);
    const b = new LoopbackTransport(id, nodeB);
    a.start();
    b.start();
    return [a, b];
  }
}
LoopbackTransport.hubs = new Map();

/**
 * NodeTransport provides authenticated, encrypted, replay-protected messaging.
 * The underlying adapter is swappable; the default LoopbackTransport is used
 * for deterministic local-first tests.
 */
class NodeTransport extends EventEmitter {
  constructor(config = {}) {
    super();
    this.identity = config.identity;
    this.adapter = config.adapter || null;
    this.peers = new Map();
    this.seenNonces = new Map();
    this.logger = config.logger || console;
    this._nonceCounter = 0;
    this._boundAdapter = null;
  }

  get isStarted() {
    return Boolean(this.adapter && this.adapter._started);
  }

  async start() {
    if (!this.identity) throw new Error('identity_required');
    if (!this.adapter) this.adapter = new LoopbackTransport(`default-${this.identity.nodeId}`, this.identity.nodeId);
    this._boundAdapter = (event) => this._onAdapterMessage(event);
    this.adapter.on('message', this._boundAdapter);
    this.adapter.start();
    this.emit('started');
    return this;
  }

  async stop() {
    if (this.adapter) {
      if (this._boundAdapter) this.adapter.off('message', this._boundAdapter);
      this.adapter.stop();
    }
    this.emit('stopped');
    return this;
  }

  async connect(nodeId, publicKey, address) {
    if (this.peers.has(nodeId)) return this.peers.get(nodeId);
    this.peers.set(nodeId, { nodeId, publicKey, address, connectedAt: Date.now() });
    if (this.adapter && typeof this.adapter.connect === 'function') {
      await this.adapter.connect(nodeId, address);
    }
    this.emit('peer_connected', { nodeId, address });
    return this.peers.get(nodeId);
  }

  addPeer(nodeId, publicKey, address) {
    return this.connect(nodeId, publicKey, address);
  }

  disconnect(nodeId) {
    this.peers.delete(nodeId);
    this.emit('peer_disconnected', { nodeId });
  }

  hasPeer(nodeId) {
    return this.peers.has(nodeId);
  }

  send(nodeId, type, payload) {
    const peer = this.peers.get(nodeId);
    if (!peer) throw new Error(`peer_not_registered:${nodeId}`);
    const envelope = this._createEnvelope(type, payload);
    const buffer = Buffer.from(JSON.stringify(envelope), 'utf8');
    if (this.adapter) this.adapter.send(nodeId, buffer);
    this.emit('sent', { nodeId, type });
    return { nodeId, type, sentAt: envelope.ts };
  }

  broadcast(type, payload) {
    const results = [];
    for (const nodeId of this.peers.keys()) {
      results.push(this.send(nodeId, type, payload));
    }
    return results;
  }

  _createEnvelope(type, payload) {
    const ts = Date.now();
    this._nonceCounter += 1;
    const nonce = `${this.identity.nodeId}:${ts}:${this._nonceCounter}:${crypto.randomBytes(4).toString('hex')}`;
    const body = { type, payload, from: this.identity.nodeId, ts, nonce };
    const signature = this.identity.sign(canonicalString(body));
    return { ...body, signature };
  }

  _onAdapterMessage({ from, data }) {
    let envelope;
    try {
      envelope = JSON.parse(data.toString('utf8'));
    } catch (err) {
      this.emit('malformed', { from, error: 'json_parse_failed' });
      return;
    }
    const { signature, ...body } = envelope;
    const peer = this.peers.get(from);
    if (!peer) {
      this.emit('untrusted', { from, reason: 'peer_not_registered' });
      return;
    }
    const now = Date.now();
    if (body.ts && now - body.ts > NONCE_WINDOW_MS) {
      this.emit('rejected', { from, reason: 'expired_message' });
      return;
    }
    if (this.seenNonces.has(body.nonce)) {
      this.emit('rejected', { from, reason: 'replay' });
      return;
    }
    const valid = this.identity.verify(canonicalString(body), signature, peer.publicKey);
    if (!valid) {
      this.emit('untrusted', { from, reason: 'invalid_signature' });
      return;
    }
    this.seenNonces.set(body.nonce, body.ts || now);
    if (this.seenNonces.size > 10000) pruneSeen(this.seenNonces, now);
    this.emit('message', { from: body.from, type: body.type, payload: body.payload, ts: body.ts, nonce: body.nonce });
  }

  getPeerCount() {
    return this.peers.size;
  }
}

NodeTransport.LoopbackTransport = LoopbackTransport;
module.exports = NodeTransport;
