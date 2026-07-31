'use strict';

const { EventEmitter } = require('events');

/**
 * ConsensusManager provides lightweight agreement on task ownership and
 * lifecycle state. It is not a blockchain. It is a simple majority/quorum
 * mechanism for proposals between trusted peers.
 */
class ConsensusManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.mesh = config.mesh || null;
    this.identity = config.identity || null;
    this.quorum = config.quorum || 0.51;
    this.proposals = new Map();
    this.decisions = new Map();
    this.logger = config.logger || console;
    this._onVote = (msg) => this._handleVote(msg);
    if (this.mesh && typeof this.mesh.on === 'function') this.mesh.on('consensus_vote', this._onVote);
  }

  start() {
    this.emit('started');
    return this;
  }

  stop() {
    if (this.mesh && typeof this.mesh.off === 'function') this.mesh.off('consensus_vote', this._onVote);
    this.emit('stopped');
    return this;
  }

  propose(topic, value, options = {}) {
    const proposalId = `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const proposal = {
      id: proposalId,
      topic,
      value,
      proposedBy: this.identity ? this.identity.nodeId : 'local',
      proposedAt: Date.now(),
      ttlMs: options.ttlMs || 30000,
      votes: new Map(),
      status: 'open',
    };
    this.proposals.set(proposalId, proposal);
    this._vote(proposalId, proposal.proposedBy, true);
    if (this.mesh) {
      this.mesh.broadcast('consensus_propose', { proposalId, topic, value, proposedBy: proposal.proposedBy });
    }
    this.emit('proposed', proposal);
    return { success: true, proposalId, proposal };
  }

  vote(proposalId, nodeId, accepted) {
    this._vote(proposalId, nodeId, accepted);
    if (this.mesh) {
      this.mesh.broadcast('consensus_vote', { proposalId, nodeId, accepted });
    }
    return { success: true };
  }

  _vote(proposalId, nodeId, accepted) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'open') return;
    proposal.votes.set(nodeId, accepted);
    this._checkQuorum(proposal);
  }

  _checkQuorum(proposal) {
    if (proposal.status !== 'open') return;
    const total = this.mesh ? this.mesh.getPeers().length + 1 : 1;
    if (total === 0) return;
    const yes = Array.from(proposal.votes.values()).filter(Boolean).length;
    const ratio = yes / total;
    if (ratio >= this.quorum) {
      proposal.status = 'accepted';
      this.decisions.set(proposal.topic, { ...proposal, acceptedAt: Date.now() });
      this.emit('accepted', proposal);
    } else if (proposal.votes.size >= total && ratio < this.quorum) {
      proposal.status = 'rejected';
      this.emit('rejected', proposal);
    }
  }

  _handleVote(msg) {
    const { proposalId, nodeId, accepted } = (msg && msg.payload) || {};
    if (!proposalId || !nodeId) return;
    this._vote(proposalId, nodeId, accepted);
  }

  decide(topic, timeoutMs = 5000) {
    return new Promise((resolve) => {
      const existing = this.decisions.get(topic);
      if (existing) return resolve({ accepted: true, proposal: existing });
      const timer = setTimeout(() => resolve({ accepted: false, error: 'timeout' }), timeoutMs);
      const onAccept = (proposal) => {
        if (proposal.topic === topic) {
          clearTimeout(timer);
          resolve({ accepted: true, proposal });
        }
      };
      this.once('accepted', onAccept);
    });
  }

  getDecision(topic) {
    return this.decisions.get(topic) || null;
  }
}

module.exports = ConsensusManager;
