'use strict';

/**
 * OperatorMode enforces the CLI's `--dry-run` and `--offline` run modes.
 *
 * The enforcement point is deliberately NOT the command parser. Classifying
 * raw operator text as "mutating" would duplicate ConversationEngine's routing
 * table and drift from it the moment a new verb is added — and a missed verb
 * would mean a dry run performing a real mutation. Instead this module wraps
 * the small set of methods that are the *only* ways the executive stack can
 * change anything outside itself:
 *
 *   ExecutionGateway.execute / approve / reject / requestModification
 *   BusinessWorkflowEngine.approveWorkflow / rejectWorkflow / startWorkflow
 *   ConsoleAPI.backup
 *
 * Any phrasing that reaches a real effect must pass through one of these, so
 * the guard cannot be bypassed by rewording a command.
 *
 * Dry run routes approvals to `ExecutionGateway.simulatePending()` and forces
 * `execute()` down the gateway's existing simulate path. It introduces no new
 * execution route of its own.
 *
 * Owner priority and other session-view preferences are intentionally NOT
 * guarded: they change what the operator sees, not what the system does, and
 * blocking them would make a dry run unusable for exploring focus areas.
 */

/**
 * Action types that require a network to have any effect. All of these are
 * already `forbidden` in ExecutionGateway's own classification; offline mode
 * re-checks them at the call boundary so a custom adapter registered at
 * runtime cannot reintroduce a network path.
 */
const NETWORK_ACTION_TYPES = new Set([
  'send-email',
  'direct-external-api',
  'purchase',
  'transfer-funds',
  'publish',
  'deploy',
  'sync-remote',
  'fetch-url',
]);

class OperatorMode {
  constructor(config = {}) {
    this.dryRun = !!config.dryRun;
    this.offline = !!config.offline;
    this.logger = config.logger || console;

    /** Ordered record of everything the guard intercepted. */
    this.journal = [];

    this._patches = [];
    this._installed = false;
  }

  get active() {
    const modes = [];
    if (this.dryRun) modes.push('dry-run');
    if (this.offline) modes.push('offline');
    return modes;
  }

  get enabled() {
    return this.dryRun || this.offline;
  }

  /** One-line description for the CLI banner and health output. */
  describe() {
    if (!this.enabled) return 'live mode — actions execute normally';
    const parts = [];
    if (this.dryRun) parts.push('DRY RUN — mutations are simulated or refused, nothing is executed');
    if (this.offline) parts.push('OFFLINE — network-dependent actions are refused');
    return parts.join(' | ');
  }

  _record(entry) {
    const record = { at: Date.now(), ...entry };
    this.journal.push(record);
    return record;
  }

  _blocked(operation, detail, extra = {}) {
    const record = this._record({ operation, detail, blocked: true, ...extra });
    return {
      ok: false,
      dryRun: this.dryRun,
      offline: this.offline,
      blocked: true,
      operation,
      text: detail,
      record,
    };
  }

  /** Offline check applied to every action before it reaches an adapter. */
  assertAllowedOffline(actionType) {
    if (!this.offline) return null;
    if (!NETWORK_ACTION_TYPES.has(actionType)) return null;
    return this._blocked(
      'offline-refusal',
      `Refused "${actionType}": offline mode is active and this action requires network access.`,
      { actionType },
    );
  }

  /**
   * Wrap the mutation authorities on a started OperatorSession.
   * Safe to call once; repeated calls are ignored.
   */
  install(session) {
    if (this._installed || !this.enabled || !session) return this;
    this._installed = true;

    this._guardGateway(session.executionGateway);
    this._guardWorkflowEngine(session.workflowEngine);
    this._guardConsoleAPI(session.consoleAPI);

    return this;
  }

  uninstall() {
    for (const { target, key, original } of this._patches) {
      target[key] = original;
    }
    this._patches = [];
    this._installed = false;
    return this;
  }

  _patch(target, key, factory) {
    if (!target || typeof target[key] !== 'function') return;
    const original = target[key].bind(target);
    this._patches.push({ target, key, original: target[key] });
    target[key] = factory(original);
  }

  _guardGateway(gateway) {
    if (!gateway) return;

    this._patch(gateway, 'execute', (original) => async (action = {}, options = {}) => {
      const refusal = this.assertAllowedOffline(action.type);
      if (refusal) throw new Error(refusal.text);

      if (!this.dryRun) return original(action, options);

      // Force the gateway's own simulate path rather than adding a new one.
      const result = await original(action, { ...options, simulate: true });

      // A review-required action is only queued here, not run — recording it
      // as "simulated" would overstate what the dry run actually intercepted.
      if (result && result.status !== 'awaiting-approval') {
        this._record({ operation: 'execute', actionType: action.type, simulated: true });
      }
      return result;
    });

    this._patch(gateway, 'approve', (original) => async (actionId) => {
      if (!this.dryRun) return original(actionId);

      const entry = gateway.pending.get(actionId);
      if (!entry) throw new Error(`No pending action ${actionId}`);

      const refusal = this.assertAllowedOffline(entry.type);
      if (refusal) throw new Error(refusal.text);

      const preview = await gateway.simulatePending(actionId);
      this._record({ operation: 'approve', actionId, actionType: entry.type, simulated: true });
      return {
        id: actionId,
        approved: false,
        dryRun: true,
        status: 'simulated',
        result: preview.result,
        text: `[dry run] Would approve ${actionId} (${entry.type}). Simulated result recorded; nothing was executed.`,
      };
    });

    this._patch(gateway, 'reject', (original) => (actionId) => {
      if (!this.dryRun) return original(actionId);
      this._record({ operation: 'reject', actionId, simulated: true });
      return {
        id: actionId,
        approved: false,
        dryRun: true,
        status: 'simulated',
        text: `[dry run] Would reject ${actionId}. The pending action was left untouched.`,
      };
    });

    this._patch(gateway, 'requestModification', (original) => (actionId, notes) => {
      if (!this.dryRun) return original(actionId, notes);
      this._record({ operation: 'requestModification', actionId, simulated: true });
      return {
        id: actionId,
        dryRun: true,
        status: 'simulated',
        notes: notes || '',
        text: `[dry run] Would attach a modification note to ${actionId}. Nothing was written.`,
      };
    });
  }

  _guardWorkflowEngine(engine) {
    if (!engine) return;

    for (const key of ['approveWorkflow', 'rejectWorkflow', 'startWorkflow']) {
      this._patch(engine, key, (original) => (...args) => {
        if (!this.dryRun) return original(...args);
        const id = args[0];
        this._record({ operation: key, workflowId: id, simulated: true });
        return {
          id,
          dryRun: true,
          status: 'simulated',
          text: `[dry run] Would ${key.replace('Workflow', '')} workflow ${id}. Workflow state is unchanged.`,
        };
      });
    }
  }

  _guardConsoleAPI(consoleAPI) {
    if (!consoleAPI) return;

    this._patch(consoleAPI, 'backup', (original) => async () => {
      if (!this.dryRun) return original();
      this._record({ operation: 'backup', simulated: true });
      return {
        ok: true,
        dryRun: true,
        files: 0,
        fileNames: [],
        text: '[dry run] Would copy the executive data stores into a new timestamped backup directory. No files were written.',
      };
    });
  }

  /**
   * Offline preflight: confirm nothing in the running stack declares a
   * network dependency. Returns a check suitable for startup output.
   */
  verifyOffline(session) {
    if (!this.offline) return null;

    const capabilities = session && session.executionGateway
      ? session.executionGateway.getCapabilities()
      : [];

    // getCapabilities() returns one flat { adapter, action, actionClass } per
    // supported action type.
    const networkCapable = capabilities
      .filter((cap) => NETWORK_ACTION_TYPES.has(cap.action))
      .map((cap) => ({ adapter: cap.adapter, type: cap.action }));

    return {
      name: 'OfflineMode',
      ok: networkCapable.length === 0,
      networkCapable,
      detail: networkCapable.length === 0
        ? `${capabilities.length} capability(ies) verified local-only`
        : `${networkCapable.length} network-capable action type(s) present and will be refused`,
    };
  }

  /** Summary of everything intercepted, for printing at shutdown. */
  summary() {
    if (this.journal.length === 0) {
      return this.dryRun ? 'Dry run: no mutating actions were attempted.' : '';
    }
    const lines = [`Dry run summary — ${this.journal.length} intercepted action(s):`];
    for (const entry of this.journal) {
      const target = entry.actionId || entry.workflowId || entry.actionType || '';
      lines.push(`  - ${entry.operation}${target ? ` ${target}` : ''}${entry.blocked ? ' (refused)' : ' (simulated)'}`);
    }
    return lines.join('\n');
  }
}

module.exports = OperatorMode;
module.exports.NETWORK_ACTION_TYPES = NETWORK_ACTION_TYPES;
