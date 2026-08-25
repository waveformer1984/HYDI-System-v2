/**
 * Stripe CLI Session Manager
 *
 * Diagnoses and manages the Stripe CLI session state separately from
 * the application API key. Stripe CLI authentication is a distinct
 * credential/session state — "stripe CLI authenticated" does NOT mean
 * "application API key valid."
 *
 * States:
 *   NOT_INSTALLED      — Stripe CLI binary not found
 *   NOT_AUTHENTICATED  — Installed but never logged in
 *   AUTHENTICATED      — Valid session
 *   EXPIRED            — Session exists but has expired
 *   INVALID            — Session exists but is rejected
 *   UNKNOWN            — Cannot determine state
 *
 * Autonomous actions (R0-R2):
 *   - Locate Stripe CLI
 *   - Inspect CLI configuration
 *   - Verify executable availability
 *   - Inspect session state
 *   - Start/stop stripe listen
 *   - Restart a failed listener
 *   - Capture temporary webhook signing secret
 *   - Verify forwarding health
 *
 * NOT autonomous:
 *   - Browser OAuth authentication (requires human)
 *
 * When browser authentication is required, produces:
 *   AWAITING_HUMAN_AUTHORIZATION
 * with a precise action request.
 */

import { execSync, spawn, ChildProcess } from 'child_process';
import { createHash } from 'crypto';
import { createEvidence, type EvidenceBlocker } from './EvidenceModel';

// ─── Types ───────────────────────────────────────────────────────────────

export type StripeCliState =
  | 'NOT_INSTALLED'
  | 'NOT_AUTHENTICATED'
  | 'AUTHENTICATED'
  | 'EXPIRED'
  | 'INVALID'
  | 'UNKNOWN';

export type StripeListenerState =
  | 'NOT_RUNNING'
  | 'STARTING'
  | 'RUNNING'
  | 'STOPPED'
  | 'FAILED'
  | 'UNKNOWN';

export interface StripeCliStatus {
  state: StripeCliState;
  listenerState: StripeListenerState;
  cliPath: string | null;
  cliVersion: string | null;
  accountId: string | null;
  accountMode: 'test' | 'live' | 'unknown';
  sessionExpiry: string | null;
  webhookSecretPrefix: string | null;
  webhookSecretFingerprint: string | null;
  forwardingEndpoint: string | null;
  lastChecked: string;
  evidence: string;
  blocker: EvidenceBlocker | null;
}

export interface HumanActionRequest {
  id: string;
  capability: string;
  blockedAction: string;
  reason: string;
  humanActionRequired: string;
  securityImpact: string;
  afterCompletion: string;
  expiration: string;
  createdAt: string;
  resolved: boolean;
  resolvedAt: string | null;
}

// ─── Stripe CLI Session Manager ──────────────────────────────────────────

export class StripeCliSessionManager {
  private listenerProcess: ChildProcess | null = null;
  private currentWebhookSecret: string | null = null;
  private currentStatus: StripeCliStatus | null = null;
  private humanActionRequests: Map<string, HumanActionRequest> = new Map();
  private correlationId: string;

  constructor(correlationId?: string) {
    this.correlationId = correlationId || `stripe-cli-${Date.now()}`;
  }

  /**
   * Diagnose the Stripe CLI state.
   * This is a safe, read-only operation (R0).
   */
  async diagnose(): Promise<StripeCliStatus> {
    const lastChecked = new Date().toISOString();
    let cliPath: string | null = null;
    let cliVersion: string | null = null;
    let state: StripeCliState = 'UNKNOWN';
    let accountId: string | null = null;
    let accountMode: 'test' | 'live' | 'unknown' = 'unknown';
    let sessionExpiry: string | null = null;
    let evidence = '';
    let blocker: EvidenceBlocker | null = null;

    // Step 1: Locate Stripe CLI
    try {
      cliPath = execSync('where stripe 2>NUL', { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] }).trim().split('\n')[0].trim();
      if (!cliPath) throw new Error('not found');
    } catch {
      state = 'NOT_INSTALLED';
      evidence = 'Stripe CLI not found in PATH';
      blocker = {
        type: 'MISSING_LOCAL_CAPABILITY',
        provider: 'stripe',
        capability: 'stripe-e2e-qualification',
        severity: 'blocking',
        repairability: 'human_required',
        reason: 'Stripe CLI is not installed',
        attemptedActions: ['path_search'],
        requiredHumanAction: 'Install Stripe CLI: https://docs.stripe.com/stripe-cli',
        risk: 'LOW',
      };
      this.currentStatus = { state, listenerState: 'NOT_RUNNING', cliPath, cliVersion, accountId, accountMode, sessionExpiry, webhookSecretPrefix: null, webhookSecretFingerprint: null, forwardingEndpoint: null, lastChecked, evidence, blocker };
      this.recordEvidence('diagnose', state, evidence, blocker);
      return this.currentStatus;
    }

    // Step 2: Get CLI version
    try {
      cliVersion = execSync('stripe version 2>NUL', { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    } catch {
      cliVersion = 'unknown';
    }

    // Step 3: Check session state
    try {
      // Try to get config info — this checks if we have a valid session
      const configOutput = execSync('stripe config --list 2>NUL', { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'] }).trim();

      // Parse for account ID and mode
      const lines = configOutput.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('account_id') || trimmed.startsWith('account_id=')) {
          accountId = trimmed.split('=')[1]?.trim() || null;
        }
        if (trimmed.includes('live') && !trimmed.includes('live_mode=false')) {
          accountMode = 'live';
        } else if (trimmed.includes('test')) {
          accountMode = 'test';
        }
      }

      // Try a simple API call to verify the session is valid
      try {
        const testResult = execSync('stripe get /v1/balance 2>NUL', { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        if (testResult.includes('available') || testResult.includes('livemode')) {
          state = 'AUTHENTICATED';
          evidence = `Stripe CLI authenticated — account: ${accountId || 'unknown'}, mode: ${accountMode}`;
        } else if (testResult.includes('Unauthorized') || testResult.includes('401')) {
          state = 'EXPIRED';
          evidence = 'Stripe CLI session expired (401)';
          blocker = {
            type: 'HUMAN_AUTHORIZATION_REQUIRED',
            provider: 'stripe',
            capability: 'stripe-e2e-qualification',
            severity: 'blocking',
            repairability: 'human_required',
            reason: 'Stripe CLI session expired',
            attemptedActions: ['cli_detection', 'version_check', 'session_check'],
            requiredHumanAction: 'Complete Stripe CLI browser authentication: run "stripe login"',
            risk: 'LOW',
          };
        } else {
          state = 'UNKNOWN';
          evidence = `Stripe CLI returned unexpected response: ${testResult.substring(0, 100)}`;
        }
      } catch (apiErr) {
        // The API call failed — could be expired or invalid
        const errMsg = apiErr instanceof Error ? apiErr.message : 'unknown';
        if (errMsg.includes('401') || errMsg.includes('Unauthorized') || errMsg.includes('expired')) {
          state = 'EXPIRED';
          evidence = 'Stripe CLI session expired';
          blocker = {
            type: 'HUMAN_AUTHORIZATION_REQUIRED',
            provider: 'stripe',
            capability: 'stripe-e2e-qualification',
            severity: 'blocking',
            repairability: 'human_required',
            reason: 'Stripe CLI session expired',
            attemptedActions: ['cli_detection', 'version_check', 'session_check'],
            requiredHumanAction: 'Complete Stripe CLI browser authentication: run "stripe login"',
            risk: 'LOW',
          };
        } else if (errMsg.includes('not authenticated') || errMsg.includes('login')) {
          state = 'NOT_AUTHENTICATED';
          evidence = 'Stripe CLI not authenticated';
          blocker = {
            type: 'HUMAN_AUTHORIZATION_REQUIRED',
            provider: 'stripe',
            capability: 'stripe-e2e-qualification',
            severity: 'blocking',
            repairability: 'human_required',
            reason: 'Stripe CLI not authenticated',
            attemptedActions: ['cli_detection', 'version_check'],
            requiredHumanAction: 'Complete Stripe CLI browser authentication: run "stripe login"',
            risk: 'LOW',
          };
        } else {
          state = 'UNKNOWN';
          evidence = `Stripe CLI session check failed: ${errMsg.substring(0, 100)}`;
        }
      }
    } catch (configErr) {
      // Config command failed — may not be authenticated
      state = 'NOT_AUTHENTICATED';
      evidence = 'Stripe CLI config not available — not authenticated';
      blocker = {
        type: 'HUMAN_AUTHORIZATION_REQUIRED',
        provider: 'stripe',
        capability: 'stripe-e2e-qualification',
        severity: 'blocking',
        repairability: 'human_required',
        reason: 'Stripe CLI not authenticated',
        attemptedActions: ['cli_detection', 'version_check'],
        requiredHumanAction: 'Complete Stripe CLI browser authentication: run "stripe login"',
        risk: 'LOW',
      };
    }

    // Step 4: Check listener state
    const listenerState = this.checkListenerState();

    const webhookSecretPrefix = this.currentWebhookSecret ? 'whsec_...' : null;
    const webhookSecretFingerprint = this.currentWebhookSecret
      ? createHash('sha256').update(this.currentWebhookSecret).digest('hex').substring(0, 16)
      : null;

    this.currentStatus = {
      state,
      listenerState,
      cliPath,
      cliVersion,
      accountId,
      accountMode,
      sessionExpiry,
      webhookSecretPrefix,
      webhookSecretFingerprint,
      forwardingEndpoint: this.listenerProcess ? 'localhost:3000/api/webhooks/stripe' : null,
      lastChecked,
      evidence,
      blocker,
    };

    this.recordEvidence('diagnose', state, evidence, blocker);

    // If we need human action, create a durable request
    if (blocker && blocker.type === 'HUMAN_AUTHORIZATION_REQUIRED') {
      this.createHumanActionRequest(blocker);
    }

    return this.currentStatus;
  }

  /**
   * Start the Stripe CLI listener for webhook forwarding.
   * This is an R2 autonomous action (reversible local process).
   */
  async startListener(forwardTo: string = 'localhost:3000/api/webhooks/stripe'): Promise<{ started: boolean; webhookSecret: string | null; reason: string }> {
    // First check if CLI is authenticated
    const status = await this.diagnose();
    if (status.state !== 'AUTHENTICATED') {
      return { started: false, webhookSecret: null, reason: `Cannot start listener — CLI state: ${status.state}` };
    }

    if (this.listenerProcess) {
      return { started: true, webhookSecret: this.currentWebhookSecret, reason: 'Listener already running' };
    }

    try {
      this.listenerProcess = spawn('stripe', ['listen', '--forward-to', forwardTo], {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
      });

      // Capture the webhook secret from the listener output
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ started: true, webhookSecret: this.currentWebhookSecret, reason: 'Listener started (webhook secret capture timed out)' });
        }, 10000);

        this.listenerProcess!.stdout?.on('data', (data: Buffer) => {
          const output = data.toString();
          // Stripe CLI prints the webhook secret like: "Ready! Your webhook signing secret is whsec_..."
          const match = output.match(/whsec_([A-Za-z0-9]+)/);
          if (match) {
            this.currentWebhookSecret = `whsec_${match[1]}`;
            clearTimeout(timeout);
            this.recordEvidence('startListener', 'AUTHENTICATED', `Listener started — webhook secret captured: whsec_...${match[1].substring(match[1].length - 4)}`, null);
            resolve({ started: true, webhookSecret: this.currentWebhookSecret, reason: 'Listener started with webhook secret' });
          }
        });

        this.listenerProcess!.stderr?.on('data', (data: Buffer) => {
          const output = data.toString();
          if (output.includes('Ready')) {
            // Listener is ready but we may not have captured the secret yet
            clearTimeout(timeout);
            resolve({ started: true, webhookSecret: this.currentWebhookSecret, reason: 'Listener started' });
          }
        });

        this.listenerProcess!.on('error', (err: Error) => {
          clearTimeout(timeout);
          this.listenerProcess = null;
          resolve({ started: false, webhookSecret: null, reason: `Listener failed to start: ${err.message}` });
        });

        this.listenerProcess!.on('exit', (code: number) => {
          clearTimeout(timeout);
          this.listenerProcess = null;
          if (code !== 0 && code !== null) {
            resolve({ started: false, webhookSecret: null, reason: `Listener exited with code ${code}` });
          }
        });
      });
    } catch (error) {
      this.listenerProcess = null;
      return { started: false, webhookSecret: null, reason: `Failed to start listener: ${error instanceof Error ? error.message : 'unknown'}` };
    }
  }

  /**
   * Stop the Stripe CLI listener.
   */
  stopListener(): void {
    if (this.listenerProcess) {
      try {
        this.listenerProcess.kill('SIGTERM');
      } catch {
        // Process may have already exited
      }
      this.listenerProcess = null;
    }
  }

  /**
   * Restart the listener if it has failed.
   * R2 autonomous action.
   */
  async restartListener(forwardTo?: string): Promise<{ started: boolean; webhookSecret: string | null; reason: string }> {
    this.stopListener();
    return this.startListener(forwardTo);
  }

  /**
   * Get the current webhook signing secret from the CLI listener.
   * This is a temporary secret — NOT the production webhook secret.
   */
  getWebhookSecret(): string | null {
    return this.currentWebhookSecret;
  }

  /**
   * Get the current CLI status (cached from last diagnose).
   */
  getStatus(): StripeCliStatus | null {
    return this.currentStatus;
  }

  /**
   * Check if the state has changed since the last diagnosis.
   * Used for automatic unblock detection.
   */
  async checkIfStateChanged(): Promise<{ changed: boolean; newState: StripeCliState; oldState: StripeCliState }> {
    const oldState = this.currentStatus?.state || 'UNKNOWN';
    const newStatus = await this.diagnose();
    return {
      changed: newStatus.state !== oldState,
      newState: newStatus.state,
      oldState,
    };
  }

  /**
   * Get all pending human action requests.
   */
  getPendingHumanActionRequests(): HumanActionRequest[] {
    return Array.from(this.humanActionRequests.values()).filter(r => !r.resolved);
  }

  /**
   * Resolve a human action request (when the external condition changes).
   */
  resolveHumanActionRequest(id: string): void {
    const request = this.humanActionRequests.get(id);
    if (request) {
      request.resolved = true;
      request.resolvedAt = new Date().toISOString();
    }
  }

  /**
   * Check if any human action requests can be auto-resolved.
   */
  async checkAndResolveHumanActions(): Promise<void> {
    const pending = this.getPendingHumanActionRequests();
    if (pending.length === 0) return;

    // Re-diagnose to check if the condition has changed
    const status = await this.diagnose();
    if (status.state === 'AUTHENTICATED') {
      // All authentication-related requests can be resolved
      for (const request of pending) {
        if (request.blockedAction.includes('authentication') || request.blockedAction.includes('CLI')) {
          this.resolveHumanActionRequest(request.id);
        }
      }
    }
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  private checkListenerState(): StripeListenerState {
    if (!this.listenerProcess) return 'NOT_RUNNING';
    if (this.listenerProcess.killed) return 'STOPPED';
    if (this.listenerProcess.exitCode !== null) {
      return this.listenerProcess.exitCode === 0 ? 'STOPPED' : 'FAILED';
    }
    return 'RUNNING';
  }

  private createHumanActionRequest(blocker: EvidenceBlocker): HumanActionRequest {
    const request: HumanActionRequest = {
      id: `AR-${randomUUID().substring(0, 8)}`,
      capability: 'Stripe Credential Governance',
      blockedAction: blocker.reason,
      reason: blocker.reason,
      humanActionRequired: blocker.requiredHumanAction || 'Unknown action required',
      securityImpact: 'None.',
      afterCompletion: 'HYDI will automatically resume Stripe E2E qualification.',
      expiration: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      resolved: false,
      resolvedAt: null,
    };
    this.humanActionRequests.set(request.id, request);
    return request;
  }

  private recordEvidence(action: string, state: StripeCliState, evidence: string, blocker: EvidenceBlocker | null): void {
    createEvidence({
      operationId: `stripe-cli-${action}-${Date.now()}`,
      capability: 'stripe-e2e-qualification',
      provider: 'stripe',
      environment: 'test',
      action: `cli_${action}`,
      authorization: { mode: 'autonomous', actor: 'stripe-cli-manager', role: null, permission: 'credentials:probe' },
      observation: evidence,
      verificationLevel: state === 'AUTHENTICATED' ? 'VERIFIED_EXTERNAL' : 'VERIFIED_INTERNAL',
      verificationMethod: 'stripe.cli.diagnose',
      result: state === 'AUTHENTICATED' ? 'PASS' : state === 'NOT_INSTALLED' ? 'BLOCKED' : 'BLOCKED',
      confidence: state === 'AUTHENTICATED' ? 1.0 : 0.0,
      externalEvidence: [],
      internalEvidence: [`cli_state: ${state}`],
      correlationId: this.correlationId,
      blocker,
    });
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';

let cliManagerInstance: StripeCliSessionManager | null = null;

export function getStripeCliSessionManager(): StripeCliSessionManager {
  if (!cliManagerInstance) {
    cliManagerInstance = new StripeCliSessionManager();
  }
  return cliManagerInstance;
}
