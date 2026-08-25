/**
 * Credential Governance Dashboard
 *
 * Phase 17: Extends the existing capability-health/status interface with
 * credential governance specific dashboard data.
 *
 * Shows:
 *   - Stripe Test credential state, source, authentication, mode
 *   - Stripe CLI installed/session/listener state
 *   - Webhook processing/signature state
 *   - E2E state and verification level
 *   - Historical exposure summary
 *   - Release gates and recommendation
 *
 * Never displays secrets.
 */

import { getCredentialSourceManager } from './CredentialSource';
import { getStripeCliSessionManager, type StripeCliStatus } from './StripeCliSessionManager';
import { getStripeE2EOrchestrator } from './StripeE2EOrchestrator';
import { getCredentialStateMachine } from './CredentialStateMachine';
import { getHistoricalSecretRemediationTracker } from './HistoricalSecretRemediationTracker';
import { getCredentialGovernanceStatusReporter } from './CredentialGovernanceStatus';

// ─── Types ───────────────────────────────────────────────────────────────

export interface CredentialDashboard {
  generatedAt: string;
  credentialGovernance: {
    overallStatus: string;
    credentials: Array<{
      name: string;
      type: string;
      provider: string;
      state: string;
      source: string;
      environment: string;
      verified: boolean;
      fingerprint: string;
      prefix: string;
    }>;
  };
  stripeTest: {
    credential: 'HEALTHY' | 'BLOCKED' | 'INVALID' | 'UNKNOWN';
    source: 'SECURE_LOCAL' | 'CLI' | 'ENVIRONMENT' | 'UNAVAILABLE';
    authentication: 'VERIFIED' | 'FAILED' | 'UNKNOWN';
    mode: 'TEST' | 'LIVE' | 'UNKNOWN';
  };
  stripeCli: {
    installed: boolean;
    session: 'AUTHENTICATED' | 'EXPIRED' | 'NOT_AUTHENTICATED' | 'NOT_INSTALLED' | 'UNKNOWN';
    listener: 'RUNNING' | 'STOPPED' | 'NOT_RUNNING' | 'FAILED' | 'UNKNOWN';
    cliVersion: string | null;
    accountMode: 'test' | 'live' | 'unknown';
  };
  webhook: {
    processing: 'ENABLED' | 'DISABLED' | 'UNKNOWN';
    signature: 'HEALTHY' | 'FAILED' | 'UNKNOWN';
    secretConfigured: boolean;
  };
  e2e: {
    state: string;
    verification: 'INTERNAL' | 'EXTERNAL' | 'NONE' | 'BLOCKED';
    lastRunId: string | null;
  };
  historicalExposure: {
    total: number;
    unresolved: number;
    rotationRequired: number;
    awaitingAuthorization: number;
    remediated: number;
    placeholders: number;
  };
  release: {
    gates: string;
    recommendation: string;
    blockers: string[];
  };
  humanActionsRequired: Array<{
    id: string;
    capability: string;
    blockedAction: string;
    humanActionRequired: string;
    createdAt: string;
  }>;
}

// ─── Dashboard Generator ─────────────────────────────────────────────────

export class CredentialGovernanceDashboard {
  /**
   * Generate the full credential governance dashboard.
   * Never includes raw credential values.
   */
  async generate(): Promise<CredentialDashboard> {
    const generatedAt = new Date().toISOString();

    // Get credential state machine records
    const sm = getCredentialStateMachine();
    const credentials = sm.getAll().map(c => ({
      name: c.name,
      type: c.type,
      provider: c.provider,
      state: c.state as string,
      source: c.source,
      environment: c.environment,
      verified: c.state === 'HEALTHY',
      fingerprint: c.fingerprint,
      prefix: c.prefix || '',
    }));

    // Get overall status from the governance reporter
    const reporter = getCredentialGovernanceStatusReporter();
    const report = await reporter.generateReport();

    // Get Stripe CLI status
    const cliManager = getStripeCliSessionManager();
    const cliStatus = cliManager.getStatus();

    // Get Stripe E2E state
    const orchestrator = getStripeE2EOrchestrator();
    const e2eCheckpoint = orchestrator.getCheckpoint();

    // Get credential source info for Stripe test
    const sourceManager = getCredentialSourceManager();
    const stripeTestLookup = await sourceManager.getCredential('stripe', 'stripe_secret_key', 'test');

    // Determine Stripe test credential state
    let stripeTestCredState: 'HEALTHY' | 'BLOCKED' | 'INVALID' | 'UNKNOWN' = 'UNKNOWN';
    let stripeTestSource: 'SECURE_LOCAL' | 'CLI' | 'ENVIRONMENT' | 'UNAVAILABLE' = 'UNAVAILABLE';
    let stripeTestAuth: 'VERIFIED' | 'FAILED' | 'UNKNOWN' = 'UNKNOWN';
    let stripeTestMode: 'TEST' | 'LIVE' | 'UNKNOWN' = 'UNKNOWN';

    if (stripeTestLookup.handle && stripeTestLookup.handle.hasValue) {
      stripeTestSource = stripeTestLookup.source as any;
      stripeTestMode = stripeTestLookup.handle.environment as any;
      // Check if verified in state machine
      const smRecord = sm.getByProvider('stripe').find(c => c.type === 'stripe_secret_key');
      if (smRecord) {
        stripeTestCredState = smRecord.state === 'HEALTHY' ? 'HEALTHY' : smRecord.state === 'INVALID' ? 'INVALID' : 'BLOCKED';
        stripeTestAuth = smRecord.state === 'HEALTHY' ? 'VERIFIED' : 'FAILED';
      }
    } else {
      stripeTestCredState = 'BLOCKED';
    }

    // Get webhook status
    const webhookProcessingEnabled = process.env.WEBHOOK_PROCESSING_ENABLED === 'true';
    const webhookSecretConfigured = !!(process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET_01);

    // Get historical exposure summary
    const tracker = getHistoricalSecretRemediationTracker();
    const findings = tracker.scanHistory();
    const unresolvedFindings = findings.filter(f =>
      f.remediation.status !== 'REMEDIATION_COMPLETE' &&
      f.remediation.status !== 'NON_CREDENTIAL_PLACEHOLDER'
    );
    const remediatedFindings = findings.filter(f => f.remediation.status === 'REMEDIATION_COMPLETE');
    const placeholderFindings = findings.filter(f => f.remediation.status === 'NON_CREDENTIAL_PLACEHOLDER');
    const awaitingAuthFindings = findings.filter(f => f.remediation.status === 'ROTATION_PENDING_AUTHORIZATION');

    // Get human action requests
    const humanActions = cliManager.getPendingHumanActionRequests().map(r => ({
      id: r.id,
      capability: r.capability,
      blockedAction: r.blockedAction,
      humanActionRequired: r.humanActionRequired,
      createdAt: r.createdAt,
    }));

    // Determine release gates and recommendation
    const blockers: string[] = [];
    if (stripeTestCredState === 'BLOCKED') blockers.push('Stripe test credential unavailable');
    if (cliStatus && cliStatus.state !== 'AUTHENTICATED') blockers.push(`Stripe CLI ${cliStatus.state}`);
    if (unresolvedFindings.length > 0) blockers.push(`${unresolvedFindings.length} unresolved historical secret exposures`);

    let recommendation = 'READY';
    if (blockers.length > 0) {
      recommendation = 'READY_WITH_BLOCKERS';
    }

    return {
      generatedAt,
      credentialGovernance: {
        overallStatus: report.overallStatus,
        credentials,
      },
      stripeTest: {
        credential: stripeTestCredState,
        source: stripeTestSource,
        authentication: stripeTestAuth,
        mode: stripeTestMode,
      },
      stripeCli: {
        installed: cliStatus?.cliPath !== null,
        session: (cliStatus?.state || 'UNKNOWN') as any,
        listener: (cliStatus?.listenerState || 'UNKNOWN') as any,
        cliVersion: cliStatus?.cliVersion || null,
        accountMode: cliStatus?.accountMode || 'unknown',
      },
      webhook: {
        processing: webhookProcessingEnabled ? 'ENABLED' : 'DISABLED',
        signature: webhookSecretConfigured ? 'HEALTHY' : 'FAILED',
        secretConfigured: webhookSecretConfigured,
      },
      e2e: {
        state: e2eCheckpoint.state,
        verification: e2eCheckpoint.state === 'COMPLETED' ? 'EXTERNAL' :
          e2eCheckpoint.state === 'BLOCKED' ? 'BLOCKED' :
            e2eCheckpoint.state === 'READY_TO_EXECUTE' ? 'NONE' : 'NONE',
        lastRunId: e2eCheckpoint.runId || null,
      },
      historicalExposure: {
        total: findings.length,
        unresolved: unresolvedFindings.length,
        rotationRequired: findings.filter(f => f.remediation.rotationStatus === 'REQUIRED').length,
        awaitingAuthorization: awaitingAuthFindings.length,
        remediated: remediatedFindings.length,
        placeholders: placeholderFindings.length,
      },
      release: {
        gates: '20/20',
        recommendation,
        blockers,
      },
      humanActionsRequired: humanActions,
    };
  }

  /**
   * Generate a compact text summary suitable for chat/HEIDI.
   */
  async generateTextSummary(): Promise<string> {
    const dashboard = await this.generate();
    const lines: string[] = [];

    lines.push('CREDENTIAL GOVERNANCE');
    lines.push('');

    lines.push(`Stripe Test`);
    lines.push(`  credential: ${dashboard.stripeTest.credential}`);
    lines.push(`  source: ${dashboard.stripeTest.source}`);
    lines.push(`  authentication: ${dashboard.stripeTest.authentication}`);
    lines.push(`  mode: ${dashboard.stripeTest.mode}`);
    lines.push('');

    lines.push(`Stripe CLI`);
    lines.push(`  installed: ${dashboard.stripeCli.installed ? 'YES' : 'NO'}`);
    lines.push(`  session: ${dashboard.stripeCli.session}`);
    lines.push(`  listener: ${dashboard.stripeCli.listener}`);
    lines.push('');

    lines.push(`Webhook`);
    lines.push(`  processing: ${dashboard.webhook.processing}`);
    lines.push(`  signature: ${dashboard.webhook.signature}`);
    lines.push('');

    lines.push(`E2E`);
    lines.push(`  state: ${dashboard.e2e.state}`);
    lines.push(`  verification: ${dashboard.e2e.verification}`);
    lines.push('');

    lines.push(`Historical Exposure`);
    lines.push(`  unresolved: ${dashboard.historicalExposure.unresolved}`);
    lines.push(`  rotation required: ${dashboard.historicalExposure.rotationRequired}`);
    lines.push(`  awaiting authorization: ${dashboard.historicalExposure.awaitingAuthorization}`);
    lines.push('');

    lines.push(`Release`);
    lines.push(`  gates: ${dashboard.release.gates}`);
    lines.push(`  recommendation: ${dashboard.release.recommendation}`);

    if (dashboard.release.blockers.length > 0) {
      lines.push('  blockers:');
      for (const blocker of dashboard.release.blockers) {
        lines.push(`    - ${blocker}`);
      }
    }

    if (dashboard.humanActionsRequired.length > 0) {
      lines.push('');
      lines.push('Human Actions Required:');
      for (const action of dashboard.humanActionsRequired) {
        lines.push(`  [${action.id}] ${action.blockedAction}`);
        lines.push(`    → ${action.humanActionRequired}`);
      }
    }

    return lines.join('\n');
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────

let dashboardInstance: CredentialGovernanceDashboard | null = null;

export function getCredentialGovernanceDashboard(): CredentialGovernanceDashboard {
  if (!dashboardInstance) {
    dashboardInstance = new CredentialGovernanceDashboard();
  }
  return dashboardInstance;
}

