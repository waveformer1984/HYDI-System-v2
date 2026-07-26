'use strict';

const fs = require('fs').promises;
const path = require('path');

const BACKUP_FILES = [
  'executive-os.json',
  'executive-cockpit.json',
  'execution-gateway.json',
  'business-workflows.json',
  'business-outcomes.json',
  'executive-timeline.json',
  'session-memory.json',
];

const COMMAND_PALETTE = [
  { command: 'good morning', description: 'Generate the complete executive briefing.' },
  { command: 'status', description: 'Short ProtoForge status summary.' },
  { command: 'what changed', description: 'Everything recorded since the last briefing.' },
  { command: 'what deserves my attention', description: 'Risks and pending approvals.' },
  { command: 'what should we build today', description: 'Top scored recommendations, reframed as build suggestions.' },
  { command: "what's blocking revenue", description: 'Revenue-related risks and Sales Manager priorities.' },
  { command: 'what can you do without me', description: 'Autonomous action classes and auto-approved workflow types.' },
  { command: 'focus resonate', description: 'Set owner priority and jump to an objective\'s status.' },
  { command: 'focus revenue', description: 'Set owner priority to revenue.' },
  { command: 'focus manufacturing', description: 'Set owner priority to manufacturing.' },
  { command: 'show approvals', description: 'List every pending approval.' },
  { command: 'show <agent domain>', description: 'Open an agent\'s workspace (e.g. "show manufacturing").' },
  { command: 'approve / reject <id|it>', description: 'Approve or reject a pending item.' },
  { command: 'explain recommendation <n>', description: 'Full why/impact/risk/effort/objective/confidence breakdown.' },
  { command: 'simulate [<id>]', description: 'Dry-run preview of a pending approval.' },
  { command: 'modify <id> <notes>', description: 'Request a modification without approving or rejecting.' },
  { command: 'recommend', description: 'Top ranked recommendations right now.' },
  { command: 'timeline', description: 'Recent activity across execution, workflows, approvals, and briefings.' },
  { command: 'health', description: 'Business health dashboard.' },
  { command: 'backup', description: 'Back up the executive data stores.' },
  { command: 'help', description: 'This list.' },
];

/**
 * ConsoleAPI is the one reusable local API described in Phase 15: every
 * method here is called identically by the readline CLI and by the local
 * web console's HTTP routes (pages/api/console/*), so there is exactly one
 * implementation of every operation and no surface can drift from another.
 *
 * It does not implement business logic itself — it is a thin facade over
 * ConversationEngine, ApprovalCenter, ExecutiveTimeline, AgentWorkspace, and
 * SessionMemory, all of which are constructed once per OperatorSession.
 */
class ConsoleAPI {
  constructor(config = {}) {
    this.conversationEngine = config.conversationEngine || null;
    this.approvalCenter = config.approvalCenter || null;
    this.timeline = config.timeline || null;
    this.agentWorkspace = config.agentWorkspace || null;
    this.sessionMemory = config.sessionMemory || null;
    this.executiveOS = config.executiveOS || null;
    this.dataPath = config.dataPath || path.resolve(__dirname, '../../data');
    this.logger = config.logger || console;

    if (this.conversationEngine) {
      this.conversationEngine.onBackup = () => this.backup();
    }
  }

  healthCheck() {
    const parts = {
      conversationEngine: this.conversationEngine ? this.conversationEngine.healthCheck().ok : false,
      approvalCenter: this.approvalCenter ? this.approvalCenter.healthCheck().ok : false,
      timeline: this.timeline ? this.timeline.healthCheck().ok : false,
      agentWorkspace: this.agentWorkspace ? this.agentWorkspace.healthCheck().ok : false,
      sessionMemory: this.sessionMemory ? this.sessionMemory.healthCheck().ok : false,
    };
    return { ok: Object.values(parts).every(Boolean), checks: parts };
  }

  // -------------------------------------------------------------------------
  // Conversation
  // -------------------------------------------------------------------------

  async goodMorning() {
    return this.ask('good morning');
  }

  async ask(text) {
    if (!this.conversationEngine) throw new Error('ConversationEngine not connected');
    return this.conversationEngine.ask(text);
  }

  getSessionState() {
    return this.sessionMemory ? this.sessionMemory.getContext() : {};
  }

  setWindowLayout(layout) {
    if (!this.sessionMemory) return {};
    return this.sessionMemory.setWindowLayout(layout);
  }

  getCommandPalette() {
    return COMMAND_PALETTE;
  }

  // -------------------------------------------------------------------------
  // Approval Center
  // -------------------------------------------------------------------------

  getApprovals() {
    return this.approvalCenter ? this.approvalCenter.list() : [];
  }

  getApproval(id) {
    return this.approvalCenter ? this.approvalCenter.get(id) : null;
  }

  async approve(id) {
    if (!this.approvalCenter) throw new Error('ApprovalCenter not connected');
    return this.approvalCenter.approve(id);
  }

  reject(id) {
    if (!this.approvalCenter) throw new Error('ApprovalCenter not connected');
    return this.approvalCenter.reject(id);
  }

  requestModification(id, notes) {
    if (!this.approvalCenter) throw new Error('ApprovalCenter not connected');
    return this.approvalCenter.requestModification(id, notes);
  }

  async simulate(id) {
    if (!this.approvalCenter) throw new Error('ApprovalCenter not connected');
    return this.approvalCenter.simulate(id);
  }

  explainApproval(id) {
    if (!this.approvalCenter) throw new Error('ApprovalCenter not connected');
    return this.approvalCenter.explain(id);
  }

  // -------------------------------------------------------------------------
  // Timeline
  // -------------------------------------------------------------------------

  getTimeline(query = {}) {
    return this.timeline ? this.timeline.list(query) : [];
  }

  // -------------------------------------------------------------------------
  // Business health
  // -------------------------------------------------------------------------

  getHealth() {
    return this.conversationEngine ? this.conversationEngine.buildBusinessHealth() : {};
  }

  // -------------------------------------------------------------------------
  // Agent workspace
  // -------------------------------------------------------------------------

  getAgents() {
    return this.agentWorkspace ? this.agentWorkspace.listAgents() : [];
  }

  getAgent(name) {
    if (!this.agentWorkspace) return null;
    return this.agentWorkspace.getAgent(name);
  }

  // -------------------------------------------------------------------------
  // Backup
  // -------------------------------------------------------------------------

  /**
   * Copy the known JSON stores into data/backups/<timestamp>/. This is a
   * local, dependency-free snapshot — it complements (does not replace) the
   * repo's existing scripts/local-backup.sh / backup-system.ps1 for a full
   * filesystem backup.
   */
  async backup() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const targetDir = path.join(this.dataPath, 'backups', stamp);
    await fs.mkdir(targetDir, { recursive: true });

    const copied = [];
    for (const file of BACKUP_FILES) {
      const src = path.join(this.dataPath, file);
      try {
        await fs.copyFile(src, path.join(targetDir, file));
        copied.push(file);
      } catch (e) {
        if (e.code !== 'ENOENT') {
          this.logger.error('[ConsoleAPI] backup copy error', { file, error: e.message });
        }
      }
    }

    const result = {
      ok: true,
      dir: targetDir,
      files: copied.length,
      fileNames: copied,
      text: `Backup completed: ${copied.length} file(s) copied to ${targetDir}.`,
    };
    if (this.timeline) this.timeline.record('backup', result.text, result);
    return result;
  }
}

module.exports = ConsoleAPI;
module.exports.COMMAND_PALETTE = COMMAND_PALETTE;
module.exports.BACKUP_FILES = BACKUP_FILES;
