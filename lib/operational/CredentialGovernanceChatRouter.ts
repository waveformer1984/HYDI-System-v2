/**
 * Credential Governance Chat Intent Router
 *
 * Phase 18: Maps HEIDI chat operational requests into actual registered
 * capabilities/actions. Not keyword-only fake responses — the response
 * reflects real state.
 *
 * Supported intents:
 *   - "Run Stripe qualification."
 *   - "Check Stripe credentials."
 *   - "Why is Stripe blocked?"
 *   - "Fix the Stripe blocker."
 *   - "Rotate the exposed Stripe credential."
 *   - "Verify the old credential is dead."
 *   - "Run the full release qualification."
 *   - "What still requires me?"
 *   - "Continue the interrupted credential rotation."
 *   - "Show credential governance dashboard."
 */

import { getCredentialGovernanceOrchestrator } from './CredentialGovernanceOrchestrator';
import { getCredentialGovernanceDashboard } from './CredentialGovernanceDashboard';
import { getStripeCliSessionManager } from './StripeCliSessionManager';
import { getStripeE2EOrchestrator } from './StripeE2EOrchestrator';
import { getCredentialStateMachine } from './CredentialStateMachine';
import { getHistoricalSecretRemediationTracker } from './HistoricalSecretRemediationTracker';
import { getRotationTransactionManager, type RotationTransaction } from './ProviderRotationAdapter';

// ─── Types ───────────────────────────────────────────────────────────────

export type ChatIntent =
  | 'run_stripe_qualification'
  | 'check_stripe_credentials'
  | 'why_is_stripe_blocked'
  | 'fix_stripe_blocker'
  | 'rotate_exposed_credential'
  | 'verify_old_credential_dead'
  | 'run_full_release_qualification'
  | 'what_requires_me'
  | 'continue_rotation'
  | 'show_dashboard'
  | 'unknown';

export interface ChatIntentResult {
  intent: ChatIntent;
  understood: boolean;
  response: string;
  actions: string[];
  requiresAuthorization: boolean;
  authorizationRole: 'owner' | 'operator' | 'viewer' | null;
  evidence: string[];
}

// ─── Intent Router ───────────────────────────────────────────────────────

export class CredentialGovernanceChatRouter {
  /**
   * Parse a user message and determine the intent.
   */
  parseIntent(message: string): ChatIntent {
    const lower = message.toLowerCase().trim();

    if (lower.match(/run.*stripe.*qual|stripe.*e2e|stripe.*test/)) return 'run_stripe_qualification';
    if (lower.match(/check.*stripe.*cred|stripe.*credential.*status|credential.*health/)) return 'check_stripe_credentials';
    if (lower.match(/why.*stripe.*block|what.*block.*stripe|stripe.*why.*block/)) return 'why_is_stripe_blocked';
    if (lower.match(/fix.*stripe.*block|resolve.*stripe.*block|unblock.*stripe/)) return 'fix_stripe_blocker';
    if (lower.match(/rotate.*exposed|rotate.*credential|rotate.*stripe.*key/)) return 'rotate_exposed_credential';
    if (lower.match(/verify.*old.*credential|old.*credential.*dead|old.*key.*revoked/)) return 'verify_old_credential_dead';
    if (lower.match(/run.*full.*release|release.*qualification|full.*qualification/)) return 'run_full_release_qualification';
    if (lower.match(/what.*requires.*me|human.*action|what.*need.*do|pending.*action/)) return 'what_requires_me';
    if (lower.match(/continue.*rotation|resume.*rotation|interrupted.*rotation/)) return 'continue_rotation';
    if (lower.match(/dashboard|status.*report|credential.*governance.*status/)) return 'show_dashboard';

    return 'unknown';
  }

  /**
   * Handle a chat message by routing to the appropriate capability.
   * The response reflects real state — not a fake keyword response.
   */
  async handle(message: string, authorization?: { actor: string; role: string }): Promise<ChatIntentResult> {
    const intent = this.parseIntent(message);

    switch (intent) {
      case 'run_stripe_qualification':
        return this.handleRunStripeQualification(authorization);

      case 'check_stripe_credentials':
        return this.handleCheckStripeCredentials();

      case 'why_is_stripe_blocked':
        return this.handleWhyIsStripeBlocked();

      case 'fix_stripe_blocker':
        return this.handleFixStripeBlocker(authorization);

      case 'rotate_exposed_credential':
        return this.handleRotateExposedCredential(authorization);

      case 'verify_old_credential_dead':
        return this.handleVerifyOldCredentialDead(authorization);

      case 'run_full_release_qualification':
        return this.handleRunFullReleaseQualification(authorization);

      case 'what_requires_me':
        return this.handleWhatRequiresMe();

      case 'continue_rotation':
        return this.handleContinueRotation(authorization);

      case 'show_dashboard':
        return this.handleShowDashboard();

      default:
        return {
          intent: 'unknown',
          understood: false,
          response: 'I understand you want to work with credential governance, but I need a more specific request. Try: "Check Stripe credentials", "Why is Stripe blocked?", "Run Stripe qualification", "What still requires me?", or "Show dashboard".',
          actions: [],
          requiresAuthorization: false,
          authorizationRole: null,
          evidence: [],
        };
    }
  }

  // ─── Intent Handlers ────────────────────────────────────────────────────

  private async handleRunStripeQualification(authorization?: { actor: string; role: string }): Promise<ChatIntentResult> {
    const orchestrator = getCredentialGovernanceOrchestrator();
    const auth = authorization
      ? { mode: 'human_authorized' as const, actor: authorization.actor, role: authorization.role }
      : { mode: 'autonomous' as const, actor: null, role: null };

    const result = await orchestrator.runAutonomyCycle(auth);

    return {
      intent: 'run_stripe_qualification',
      understood: true,
      response: `Stripe qualification cycle completed. Status: ${result.status}. Ready to execute: ${result.readyToExecute}. ${result.humanActionsRequired.length > 0 ? `${result.humanActionsRequired.length} human action(s) required.` : 'No human actions required.'}`,
      actions: result.evidence,
      requiresAuthorization: result.readyToExecute && !authorization,
      authorizationRole: result.readyToExecute ? 'operator' : null,
      evidence: result.evidence,
    };
  }

  private async handleCheckStripeCredentials(): Promise<ChatIntentResult> {
    const sm = getCredentialStateMachine();
    const creds = sm.getByProvider('stripe');
    const evidence: string[] = [];
    const actions: string[] = [];

    if (creds.length === 0) {
      evidence.push('No Stripe credentials registered in the state machine');
      return {
        intent: 'check_stripe_credentials',
        understood: true,
        response: 'No Stripe credentials have been discovered. The system has not detected any Stripe credential in any source.',
        actions,
        requiresAuthorization: false,
        authorizationRole: null,
        evidence,
      };
    }

    for (const cred of creds) {
      evidence.push(`${cred.name}: state=${cred.state}, source=${cred.source}, environment=${cred.environment}, verified=${cred.state === 'HEALTHY'}`);
    }

    return {
      intent: 'check_stripe_credentials',
      understood: true,
      response: `Found ${creds.length} Stripe credential(s). ${creds.filter(c => c.state === 'HEALTHY').length} healthy, ${creds.filter(c => c.state === 'BLOCKED' || c.state === 'INVALID').length} blocked/invalid.`,
      actions,
      requiresAuthorization: false,
      authorizationRole: null,
      evidence,
    };
  }

  private async handleWhyIsStripeBlocked(): Promise<ChatIntentResult> {
    const orchestrator = getStripeE2EOrchestrator();
    const checkpoint = orchestrator.getCheckpoint();
    const cliManager = getStripeCliSessionManager();
    const cliStatus = cliManager.getStatus();
    const evidence: string[] = [];

    if (checkpoint.state !== 'BLOCKED') {
      return {
        intent: 'why_is_stripe_blocked',
        understood: true,
        response: `Stripe E2E is not blocked. Current state: ${checkpoint.state}.`,
        actions: [],
        requiresAuthorization: false,
        authorizationRole: null,
        evidence: [`E2E state: ${checkpoint.state}`],
      };
    }

    const reasons: string[] = [];
    if (checkpoint.blocker) {
      reasons.push(`E2E blocker: ${checkpoint.blocker.reason}`);
      evidence.push(`Blocker type: ${checkpoint.blocker.type}`);
      evidence.push(`Required action: ${checkpoint.blocker.requiredHumanAction || 'none'}`);
    }
    if (cliStatus && cliStatus.state !== 'AUTHENTICATED') {
      reasons.push(`Stripe CLI: ${cliStatus.state}`);
      if (cliStatus.blocker) {
        evidence.push(`CLI blocker: ${cliStatus.blocker.reason}`);
      }
    }

    return {
      intent: 'why_is_stripe_blocked',
      understood: true,
      response: `Stripe is blocked for the following reasons:\n${reasons.map(r => `  - ${r}`).join('\n')}`,
      actions: [],
      requiresAuthorization: false,
      authorizationRole: null,
      evidence,
    };
  }

  private async handleFixStripeBlocker(authorization?: { actor: string; role: string }): Promise<ChatIntentResult> {
    const orchestrator = getCredentialGovernanceOrchestrator();
    const e2e = getStripeE2EOrchestrator();
    const checkpoint = e2e.getCheckpoint();

    if (checkpoint.state !== 'BLOCKED') {
      return {
        intent: 'fix_stripe_blocker',
        understood: true,
        response: `Stripe is not currently blocked. State: ${checkpoint.state}`,
        actions: [],
        requiresAuthorization: false,
        authorizationRole: null,
        evidence: [`State: ${checkpoint.state}`],
      };
    }

    // Try self-healing
    const healResult = await orchestrator.selfHeal('STRIPE_CLI_NOT_RUNNING');

    // Reevaluate blockers
    const reeval = await orchestrator.reevaluateBlockers();

    return {
      intent: 'fix_stripe_blocker',
      understood: true,
      response: healResult.healed
        ? `Attempted to fix the Stripe blocker. Action: ${healResult.action}. Result: ${healResult.evidence}. After reevaluation, E2E state: ${reeval.newState}.`
        : `Cannot autonomously fix this blocker. ${healResult.evidence}. ${reeval.newBlockers.length > 0 ? 'Human action may be required.' : ''}`,
      actions: [healResult.action],
      requiresAuthorization: !healResult.healed,
      authorizationRole: !healResult.healed ? 'operator' : null,
      evidence: [healResult.evidence, `Reevaluation: ${reeval.newState}`],
    };
  }

  private async handleRotateExposedCredential(authorization?: { actor: string; role: string }): Promise<ChatIntentResult> {
    if (!authorization || (authorization.role !== 'owner' && authorization.role !== 'operator')) {
      return {
        intent: 'rotate_exposed_credential',
        understood: true,
        response: 'Credential rotation requires owner or operator authorization. Please authenticate with an appropriate role.',
        actions: [],
        requiresAuthorization: true,
        authorizationRole: 'owner',
        evidence: ['Rotation denied — insufficient authorization'],
      };
    }

    const orchestrator = getCredentialGovernanceOrchestrator();
    const result = await orchestrator.runHistoricalSecretRemediation({
      mode: 'human_authorized',
      actor: authorization.actor,
      role: authorization.role,
    });

    return {
      intent: 'rotate_exposed_credential',
      understood: true,
      response: `Historical secret remediation: ${result.totalFindings} findings, ${result.realCredentials} real credentials, ${result.placeholders} placeholders, ${result.awaitingAuthorization} awaiting authorization. ${result.humanActionsRequired.length} human action(s) required for Dashboard-based rotations.`,
      actions: result.humanActionsRequired.map(a => a.humanActionRequired),
      requiresAuthorization: result.awaitingAuthorization > 0,
      authorizationRole: 'owner',
      evidence: [`Total: ${result.totalFindings}`, `Real: ${result.realCredentials}`, `Placeholders: ${result.placeholders}`],
    };
  }

  private async handleVerifyOldCredentialDead(authorization?: { actor: string; role: string }): Promise<ChatIntentResult> {
    const tracker = getHistoricalSecretRemediationTracker();
    const findings = tracker.scanHistory();
    const realFindings = findings.filter(f => f.remediation.status !== 'NON_CREDENTIAL_PLACEHOLDER');
    const evidence: string[] = [];

    if (realFindings.length === 0) {
      return {
        intent: 'verify_old_credential_dead',
        understood: true,
        response: 'No exposed credentials to verify.',
        actions: [],
        requiresAuthorization: false,
        authorizationRole: null,
        evidence: ['No findings to verify'],
      };
    }

    // For each finding, check if the credential has been rotated
    // (This would require the old credential value, which we don't store)
    for (const finding of realFindings) {
      evidence.push(`${finding.secretType} (${finding.fingerprint}): ${finding.remediation.status}`);
    }

    return {
      intent: 'verify_old_credential_dead',
      understood: true,
      response: `Found ${realFindings.length} exposed credential(s). Verification requires checking each against the provider API. Current remediation statuses recorded.`,
      actions: [],
      requiresAuthorization: true,
      authorizationRole: 'operator',
      evidence,
    };
  }

  private async handleRunFullReleaseQualification(authorization?: { actor: string; role: string }): Promise<ChatIntentResult> {
    const dashboard = getCredentialGovernanceDashboard();
    const summary = await dashboard.generateTextSummary();

    return {
      intent: 'run_full_release_qualification',
      understood: true,
      response: `Current release qualification status:\n\n${summary}`,
      actions: [],
      requiresAuthorization: false,
      authorizationRole: null,
      evidence: ['Dashboard generated'],
    };
  }

  private async handleWhatRequiresMe(): Promise<ChatIntentResult> {
    const orchestrator = getCredentialGovernanceOrchestrator();
    const cliManager = getStripeCliSessionManager();
    const pendingActions = cliManager.getPendingHumanActionRequests();
    const rotationManager = getRotationTransactionManager();
    const activeRotations = rotationManager.getActiveTransactions().filter(t => t.state === 'ESCALATE');

    const evidence: string[] = [];
    const actions: string[] = [];

    if (pendingActions.length === 0 && activeRotations.length === 0) {
      return {
        intent: 'what_requires_me',
        understood: true,
        response: 'No human actions are currently required. All blockers that can be resolved autonomously have been addressed.',
        actions: [],
        requiresAuthorization: false,
        authorizationRole: null,
        evidence: ['No pending human actions'],
      };
    }

    for (const action of pendingActions) {
      actions.push(action.humanActionRequired);
      evidence.push(`[${action.id}] ${action.blockedAction}: ${action.humanActionRequired}`);
    }

    for (const rotation of activeRotations) {
      if (rotation.blocker) {
        actions.push(rotation.blocker.requiredHumanAction || `Complete rotation ${rotation.operationId}`);
        evidence.push(`Rotation ${rotation.operationId}: ${rotation.blocker.reason}`);
      }
    }

    return {
      intent: 'what_requires_me',
      understood: true,
      response: `${pendingActions.length + activeRotations.length} human action(s) required:\n${actions.map(a => `  - ${a}`).join('\n')}`,
      actions,
      requiresAuthorization: true,
      authorizationRole: 'owner',
      evidence,
    };
  }

  private async handleContinueRotation(authorization?: { actor: string; role: string }): Promise<ChatIntentResult> {
    const rotationManager = getRotationTransactionManager();
    const active = rotationManager.getActiveTransactions();

    if (active.length === 0) {
      return {
        intent: 'continue_rotation',
        understood: true,
        response: 'No interrupted credential rotations in progress.',
        actions: [],
        requiresAuthorization: false,
        authorizationRole: null,
        evidence: ['No active rotations'],
      };
    }

    const evidence: string[] = [];
    const actions: string[] = [];

    for (const rotation of active) {
      const recovered = await rotationManager.recoverTransaction(rotation.operationId);
      if (recovered) {
        evidence.push(`Rotation ${rotation.operationId}: state=${rotation.state}, next step pending`);
        actions.push(`Continue rotation ${rotation.operationId}`);
      }
    }

    return {
      intent: 'continue_rotation',
      understood: true,
      response: `Found ${active.length} interrupted rotation(s). ${actions.length} can be continued. ${active.filter(r => r.state === 'ESCALATE').length} require human action.`,
      actions,
      requiresAuthorization: active.some(r => r.state === 'ESCALATE'),
      authorizationRole: 'owner',
      evidence,
    };
  }

  private async handleShowDashboard(): Promise<ChatIntentResult> {
    const dashboard = getCredentialGovernanceDashboard();
    const summary = await dashboard.generateTextSummary();

    return {
      intent: 'show_dashboard',
      understood: true,
      response: summary,
      actions: [],
      requiresAuthorization: false,
      authorizationRole: null,
      evidence: ['Dashboard text summary generated'],
    };
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────

let chatRouterInstance: CredentialGovernanceChatRouter | null = null;

export function getCredentialGovernanceChatRouter(): CredentialGovernanceChatRouter {
  if (!chatRouterInstance) {
    chatRouterInstance = new CredentialGovernanceChatRouter();
  }
  return chatRouterInstance;
}

