/**
 * Agent Cryptographic Authentication
 * No more "trust me, I'm finance-agent"
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

class AgentAuth {
  constructor() {
    this.keysDir = path.join(__dirname, '../keys');
    this.registeredAgents = new Map();
  }

  /**
   * Generate key pair for a new agent
   */
  async generateAgentKeys(agentId) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    // Store keys securely
    await this.ensureKeysDir();
    await fs.writeFile(path.join(this.keysDir, `${agentId}.pub`), publicKey);
    await fs.writeFile(path.join(this.keysDir, `${agentId}.key`), privateKey, { mode: 0o600 });

    // Register agent
    this.registeredAgents.set(agentId, {
      publicKey,
      createdAt: new Date().toISOString(),
      lastSeen: null
    });

    console.log(`[AUTH] Generated keys for agent: ${agentId}`);
    return { publicKey, privateKey };
  }

  /**
   * Register an agent's public key
   */
  async registerAgent(agentId, publicKey) {
    this.registeredAgents.set(agentId, {
      publicKey,
      registeredAt: new Date().toISOString(),
      fingerprint: this.getFingerprint(publicKey)
    });

    // Persist registration
    await this.saveRegistrations();
    console.log(`[AUTH] Registered agent: ${agentId}`);
  }

  /**
   * Sign a request payload
   */
  signRequest(agentId, payload, privateKey) {
    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString('hex');
    
    const message = {
      agent_id: agentId,
      timestamp,
      nonce,
      payload
    };

    const messageStr = JSON.stringify(message, Object.keys(message).sort());
    const signature = crypto.sign('sha256', Buffer.from(messageStr), privateKey);

    return {
      ...message,
      signature: signature.toString('base64')
    };
  }

  /**
   * Verify a signed request
   */
  verifyRequest(signedRequest) {
    const { agent_id, signature, timestamp, nonce, payload } = signedRequest;

    // Check if agent exists
    const agent = this.registeredAgents.get(agent_id);
    if (!agent) {
      throw new Error(`Unknown agent: ${agent_id}`);
    }

    // Check timestamp (replay protection)
    const now = Date.now();
    const requestTime = parseInt(timestamp);
    if (Math.abs(now - requestTime) > 300000) { // 5 minutes
      throw new Error('Request timestamp too old');
    }

    // Verify signature
    const message = {
      agent_id,
      timestamp,
      nonce,
      payload
    };

    const messageStr = JSON.stringify(message, Object.keys(message).sort());
    const isValid = crypto.verify(
      'sha256',
      Buffer.from(messageStr),
      agent.publicKey,
      Buffer.from(signature, 'base64')
    );

    if (!isValid) {
      throw new Error('Invalid signature');
    }

    // Update last seen
    agent.lastSeen = new Date().toISOString();

    return {
      agent_id,
      payload,
      verified: true
    };
  }

  /**
   * Get key fingerprint for logging
   */
  getFingerprint(publicKey) {
    const hash = crypto.createHash('sha256');
    hash.update(publicKey);
    return hash.digest('hex').substring(0, 16);
  }

  /**
   * Ensure keys directory exists
   */
  async ensureKeysDir() {
    try {
      await fs.mkdir(this.keysDir, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  /**
   * Save registrations to disk
   */
  async saveRegistrations() {
    const data = JSON.stringify(Object.fromEntries(this.registeredAgents), null, 2);
    await fs.writeFile(path.join(this.keysDir, 'registrations.json'), data);
  }

  /**
   * Load registrations from disk
   */
  async loadRegistrations() {
    try {
      const data = await fs.readFile(path.join(this.keysDir, 'registrations.json'), 'utf8');
      const registrations = JSON.parse(data);
      
      for (const [agentId, info] of Object.entries(registrations)) {
        this.registeredAgents.set(agentId, info);
      }
      
      console.log(`[AUTH] Loaded ${this.registeredAgents.size} agent registrations`);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  /**
   * Revoke an agent
   */
  async revokeAgent(agentId) {
    if (!this.registeredAgents.has(agentId)) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    this.registeredAgents.delete(agentId);
    
    // Remove keys
    try {
      await fs.unlink(path.join(this.keysDir, `${agentId}.pub`));
      await fs.unlink(path.join(this.keysDir, `${agentId}.key`));
    } catch (err) {
      // Ignore if files don't exist
    }

    await this.saveRegistrations();
    console.log(`[AUTH] Revoked agent: ${agentId}`);
  }
}

module.exports = AgentAuth;
