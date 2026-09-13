/**
 * Control Plane Bridge Adapter
 *
 * Wraps ProductionOperationsControlPlane so that CognitiveCore's
 * ExecutionBridge can invoke production operations (preflight, blocker
 * resolution, credential health, configuration control) through the
 * same dependency-injection pattern used by every other bridge adapter.
 *
 * This adapter is a THIN TRANSLATION LAYER — it does NOT:
 *   - duplicate control-plane logic
 *   - bypass authorization
 *   - expose raw credential values
 *   - create transaction authorizations
 *   - fabricate results
 *
 * SECURITY INVARIANT: Every method that returns credential data returns
 * metadata only. The raw Stripe key, webhook secrets, and any other
 * secret values are NEVER passed through this bridge. The bridge returns
 * safe projections (mode, configured, health, prefix, fingerprint).
 *
 * FINANCIAL SAFETY INVARIANT: This bridge can report transaction
 * authorization STATE but can never CREATE an authorization. Authorization
 * issuance remains a human-initiated action through the secure API endpoint.
 */

import type { ProductionOperationsControlPlane } from '../operational/ProductionOperationsControlPlane';
import type { ExecutionBridge } from './CognitiveCore';

export function createControlPlaneBridge(
  controlPlane: ProductionOperationsControlPlane,
): NonNullable<ExecutionBridge['controlPlane']> {
  return {
    /**
     * Run a read-only preflight check.
     * Returns { state, blockers, checks, stripeMode, ... } — never secrets.
     */
    async preflight() {
      return controlPlane.runPreflight();
    },

    /**
     * Run the autonomous preflight loop:
     *   preflight → classify blockers → resolve auto-resolvable → verify → rerun
     *
     * Bounded by maxAttempts. Never creates an infinite loop.
     * Stops at READY, OPERATOR_INPUT_REQUIRED, HUMAN_AUTHORIZATION_REQUIRED,
     * PROHIBITED, or MAX_ATTEMPTS_EXCEEDED.
     */
    async autonomousPreflight() {
      return controlPlane.runAutonomousPreflight();
    },

    /**
     * Get a safe, redacted status report.
     * Includes configuration summary, Stripe credential health (metadata only),
     * pending authorization state, and audit logs.
     */
    async getStatus() {
      return controlPlane.getStatusReport();
    },

    /**
     * Get Stripe credential health metadata.
     * Returns { configured, mode, valid, authorizationState, prefix, fingerprint }
     * NEVER returns the raw key value.
     */
    async getCredentialHealth() {
      return controlPlane.getCredentialHealthReport();
    },

    /**
     * Get the current transaction authorization state.
     * This reports whether an authorization EXISTS — it does NOT create one.
     * Authorization creation is a human-only action.
     */
    getTransactionAuthorizationState() {
      return controlPlane.getTransactionAuthorizationState();
    },

    /**
     * Apply a safe, non-secret configuration change.
     * Policy-checked, validated, audited, verified after application.
     * Secret keys are rejected — they must go through CredentialManager.
     */
    async applySafeConfiguration(key: string, value: string, reason: string) {
      return controlPlane.applySafeConfiguration(key, value, reason);
    },

    /**
     * Disarm live qualification mode.
     * Disables ALLOW_LIVE_STRIPE, revokes pending authorization, verifies state.
     * Idempotent — returns ALREADY_DISARMED if already disarmed.
     * This is a safety-reducing operation, autonomous-safe.
     */
    async disarmLiveQualification(reason?: string) {
      return controlPlane.disarmLiveQualification(reason);
    },

    /**
     * Stage a live authorization request — the one-click "Authorize" flow.
     * HYDI runs all autonomous steps and produces a human-readable summary
     * with a pending LiveAuthorizationRequest. The human clicks "Allow" to resolve.
     *
     * This does NOT set ALLOW_LIVE_STRIPE or issue a transaction authorization.
     * Those happen on the approval click.
     */
    async stageLiveAuthorization(params?: {
      customer?: string;
      amountCents?: number;
      product?: string;
    }) {
      return controlPlane.stageLiveAuthorization(params || {});
    },

    /**
     * Get the pending live authorization request (if any).
     */
    getPendingLiveAuthorizationRequest() {
      return controlPlane.getPendingLiveAuthorizationRequest();
    },

    /**
     * Get a live authorization request by ID.
     */
    getLiveAuthorizationRequest(requestId: string) {
      return controlPlane.getLiveAuthorizationRequest(requestId);
    },
  };
}
