'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const ID_ALGORITHM = 'ed25519';
const HASH_ALGORITHM = 'sha256';

function base64UrlEscape(str) {
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function compareVersion(a, b) {
  const aa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const bb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(aa.length, bb.length); i += 1) {
    const av = aa[i] || 0;
    const bv = bb[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

class NodeIdentity extends EventEmitter {
  constructor(config = {}) {
    super();
    this.dataPath = config.dataPath || path.resolve(__dirname, '../../data');
    this.version = config.version || '0.0.0';
    this.minCompatibleVersion = config.minCompatibleVersion || '0.0.0';
    this.lifecycleRegistry = config.lifecycleRegistry || null;
    this.logger = config.logger || console;

    this.publicKey = null;
    this.privateKey = null;
    this.nodeId = null;
    this.fingerprint = null;
    this.trust = new Map();
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return this;
    await fs.mkdir(this.dataPath, { recursive: true });
    const identityPath = path.join(this.dataPath, 'node-identity.json');
    const exists = await fs.access(identityPath).then(() => true).catch(() => false);
    if (exists) {
      await this._load(identityPath);
    } else {
      await this._generate();
      await this._save(identityPath);
    }
    this._registerWithLifecycle();
    this._initialized = true;
    this.emit('initialized', { nodeId: this.nodeId, fingerprint: this.fingerprint });
    return this;
  }

  async _generate() {
    const keys = crypto.generateKeyPairSync(ID_ALGORITHM, {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    this.publicKey = keys.publicKey;
    this.privateKey = keys.privateKey;
    this._deriveId();
  }

  _deriveId() {
    const hash = crypto.createHash(HASH_ALGORITHM).update(this.publicKey).digest();
    this.nodeId = base64UrlEscape(hash.toString('base64'));
    this.fingerprint = crypto.createHash(HASH_ALGORITHM).update(this.publicKey).digest('hex');
  }

  async _save(identityPath) {
    const payload = {
      nodeId: this.nodeId,
      fingerprint: this.fingerprint,
      publicKey: this.publicKey,
      privateKey: this.privateKey,
      version: this.version,
      minCompatibleVersion: this.minCompatibleVersion,
      trust: Array.from(this.trust.entries()),
      updatedAt: Date.now(),
    };
    await fs.writeFile(identityPath, JSON.stringify(payload, null, 2), 'utf8');
  }

  async _load(identityPath) {
    const text = await fs.readFile(identityPath, 'utf8');
    const payload = JSON.parse(text);
    this.publicKey = payload.publicKey;
    this.privateKey = payload.privateKey;
    this.version = payload.version || this.version;
    this.minCompatibleVersion = payload.minCompatibleVersion || this.minCompatibleVersion;
    this._deriveId();
    if (payload.nodeId && payload.nodeId !== this.nodeId) {
      throw new Error('node_identity_id_mismatch');
    }
    if (payload.fingerprint && payload.fingerprint !== this.fingerprint) {
      throw new Error('node_identity_fingerprint_mismatch');
    }
    this.trust = new Map(payload.trust || []);
  }

  _registerWithLifecycle() {
    if (!this.lifecycleRegistry) return;
    this.lifecycleRegistry.register({
      name: 'NodeIdentity',
      category: 'federation',
      version: this.version,
      phase: 41,
      capabilities: ['identity', 'signing', 'fingerprint'],
      permissions: {},
      health: 'healthy',
    });
    this.lifecycleRegistry.setHealth('NodeIdentity', 'healthy');
  }

  get id() {
    return this.nodeId;
  }

  getId() {
    return this.nodeId;
  }

  getFingerprint() {
    return this.fingerprint;
  }

  getPublicKey() {
    return this.publicKey;
  }

  exportPublic() {
    return {
      nodeId: this.nodeId,
      fingerprint: this.fingerprint,
      publicKey: this.publicKey,
      version: this.version,
      minCompatibleVersion: this.minCompatibleVersion,
    };
  }

  toJSON() {
    return this.exportPublic();
  }

  sign(data) {
    const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const signature = crypto.sign(null, buffer, this.privateKey);
    return signature.toString('base64url');
  }

  verify(data, signature, publicKey) {
    const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const sigBuffer = typeof signature === 'string' ? Buffer.from(signature, 'base64url') : signature;
    const pub = publicKey || this.publicKey;
    return crypto.verify(null, buffer, pub, sigBuffer);
  }

  verifyIdentity(data, signature, publicKey, nodeId) {
    const fingerprint = crypto.createHash(HASH_ALGORITHM).update(publicKey).digest('hex');
    const derivedId = base64UrlEscape(crypto.createHash(HASH_ALGORITHM).update(publicKey).digest('base64'));
    if (nodeId && derivedId !== nodeId) return { valid: false, reason: 'identity_mismatch' };
    const signatureValid = this.verify(data, signature, publicKey);
    if (!signatureValid) return { valid: false, reason: 'invalid_signature' };
    return { valid: true, nodeId: derivedId, fingerprint };
  }

  setTrust(nodeId, status) {
    const allowed = ['unknown', 'untrusted', 'community', 'verified', 'official'];
    if (!allowed.includes(status)) throw new Error(`invalid_trust_status: ${status}`);
    this.trust.set(nodeId, status);
    this.emit('trust_changed', { nodeId, status });
    return { nodeId, status };
  }

  getTrust(nodeId) {
    if (nodeId === this.nodeId) return 'self';
    return this.trust.get(nodeId) || 'unknown';
  }

  isTrusted(nodeId) {
    const status = this.getTrust(nodeId);
    return status === 'verified' || status === 'official' || status === 'self';
  }

  isRevoked(nodeId) {
    return this.trust.get(nodeId) === 'untrusted';
  }

  isCompatible(otherVersion) {
    return compareVersion(otherVersion, this.minCompatibleVersion) >= 0
      && compareVersion(this.version, otherVersion) >= -0;
  }

  async save() {
    await this._save(path.join(this.dataPath, 'node-identity.json'));
    this.emit('saved', { nodeId: this.nodeId });
  }

  async reload() {
    this._initialized = false;
    await this.init();
    return this;
  }

  healthCheck() {
    return {
      ok: Boolean(this.nodeId && this.publicKey && this.privateKey),
      nodeId: this.nodeId,
      fingerprint: this.fingerprint,
    };
  }
}

module.exports = NodeIdentity;
