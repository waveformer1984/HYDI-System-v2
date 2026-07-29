'use strict';

const { EventEmitter } = require('events');
const crypto = require('crypto');

/**
 * NodeDiscovery discovers peer candidates via static configuration, manual
 * addition, and (optionally) local multicast. It never auto-trusts a peer;
 * trust is established later by NodeIdentity/NodeTransport.
 */
class NodeDiscovery extends EventEmitter {
  constructor(config = {}) {
    super();
    this.identity = config.identity || null;
    this.candidates = new Map();
    this.trusted = new Map();
    this.staticPeers = config.staticPeers || [];
    this.manualPeers = config.manualPeers || [];
    this.enableMulticast = config.enableMulticast === true;
    this.multicastIntervalMs = config.multicastIntervalMs || 30000;
    this.serviceName = config.serviceName || '_hydi._tcp';
    this.logger = config.logger || console;
    this._timer = null;
    this._offline = true;

    for (const p of this.staticPeers) this._addCandidate(p, 'static');
    for (const p of this.manualPeers) this._addCandidate(p, 'manual');
  }

  _addCandidate(peer, source) {
    if (!peer || !peer.nodeId) return null;
    const entry = {
      nodeId: peer.nodeId,
      host: peer.host || 'localhost',
      port: peer.port || 0,
      publicKey: peer.publicKey || null,
      source,
      discoveredAt: Date.now(),
      trust: this.trusted.has(peer.nodeId) ? 'trusted' : 'unknown',
    };
    this.candidates.set(peer.nodeId, entry);
    this.emit('candidate', entry);
    return entry;
  }

  start() {
    this._offline = false;
    if (this.enableMulticast) {
      this._timer = setInterval(() => this.announce(), this.multicastIntervalMs);
      if (this._timer.unref) this._timer.unref();
      this.announce();
    }
    this.emit('started');
    return this;
  }

  stop() {
    this._offline = true;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.emit('stopped');
    return this;
  }

  discover() {
    return Array.from(this.candidates.values()).map((c) => ({ ...c, trusted: this.isTrusted(c.nodeId) }));
  }

  addManualPeer(peer) {
    return this._addCandidate(peer, 'manual');
  }

  addStaticPeer(peer) {
    return this._addCandidate(peer, 'static');
  }

  announce() {
    if (!this.identity) return null;
    const announcement = {
      service: this.serviceName,
      nodeId: this.identity.nodeId,
      fingerprint: this.identity.fingerprint,
      publicKey: this.identity.publicKey,
      host: this.identity.host || 'localhost',
      port: this.identity.port || 0,
      ts: Date.now(),
      nonce: crypto.randomBytes(8).toString('hex'),
    };
    announcement.signature = this.identity.sign(JSON.stringify(announcement, Object.keys(announcement).sort()));
    this.emit('announce', announcement);
    return announcement;
  }

  handleAnnouncement(announcement) {
    if (!announcement || !announcement.nodeId) return null;
    if (this.identity && announcement.nodeId === this.identity.nodeId) return null;
    this._addCandidate({
      nodeId: announcement.nodeId,
      host: announcement.host,
      port: announcement.port,
      publicKey: announcement.publicKey,
    }, 'multicast');
    this.emit('announcement_received', announcement);
    return announcement;
  }

  setTrusted(nodeId, publicKey) {
    this.trusted.set(nodeId, { publicKey, trustedAt: Date.now() });
    const candidate = this.candidates.get(nodeId);
    if (candidate) candidate.trust = 'trusted';
    this.emit('trust_set', { nodeId });
  }

  isTrusted(nodeId) {
    return this.trusted.has(nodeId);
  }

  getTrustedPeers() {
    return Array.from(this.trusted.keys());
  }

  isOffline() {
    return this._offline;
  }
}

module.exports = NodeDiscovery;
