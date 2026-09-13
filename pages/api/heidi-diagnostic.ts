import type { NextApiRequest, NextApiResponse } from 'next';
import type {
  AuthorizationLevel,
  CapabilityAcquisitionState,
  CapabilityBlocker,
  ExternalCommitmentType,
  PolicyDecision,
} from '../../lib/operational/CapabilityAcquisitionTypes';
import type { ProviderAdapter } from '../../lib/operational/ProviderAdapters';

/**
 * GET /api/heidi-diagnostic
 * GET /api/heidi-diagnostic?capability=commercial.stripe
 *
 * Self-diagnostic endpoint. Produces a structured explanation of each
 * capability's current state, blocker, governance level, and next action.
 *
 * Every field is backed by a real check against the acquisition engine,
 * provider adapter registry, owner authorization store, and durable
 * acquisition store. No fabricated values.
 *
 * SECURITY: Credential values are NEVER exposed. Only presence is checked
 * via process.env. Missing/present env var names are reported, never values.
 */

// ─── Response Types ───────────────────────────────────────────────────────

interface GovernanceInfo {
  level: AuthorizationLevel;
  description: string;
}

type AutonomyStatus = 'ALLOWED' | 'REQUIRES_OWNER_AUTHORIZATION' | 'DENIED';

interface CredentialStatus {
  required: string[];
  present: string[];
  missing: string[];
}

interface AuthorizationStatus {
  pending: boolean;
  authorized: boolean;
  reason: string;
}

interface RetryStatus {
  attempts: number;
  circuitBreakerTripped: boolean;
  lastError: string | null;
}

interface CapabilityDiagnostic {
  capability: string;
  provider: string;
  state: CapabilityAcquisitionState;
  blocker: CapabilityBlocker | null;
  governance: GovernanceInfo;
  autonomy: AutonomyStatus;
  action: string;
  currentLimitation: string;
  nextAction: string;
  credentialStatus: CredentialStatus;
  authorizationStatus: AuthorizationStatus;
  retryStatus: RetryStatus;
}

interface DiagnosticResponse {
  timestamp: string;
  totalCapabilities: number;
  diagnostics: CapabilityDiagnostic[];
}

// ─── Governance Level Descriptions ────────────────────────────────────────

const GOVERNANCE_DESCRIPTIONS: Record<AuthorizationLevel, string> = {
  R0: 'Observation only — autonomous, no side effects',
  R1: 'Reversible local action — autonomous (config, restart, credential provisioning)',
  R2: 'External side effect — requires owner authorization (resource creation)',
  R3: 'Financial/legal/identity commitment — requires owner authorization (account creation, billing, ToS)',
  R5: 'Never authorized — guardian block (refused by policy)',
};

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Determine the highest (most restrictive) authorization level across all
 * commitment types for a provider's acquisition plan. The governance level
 * reported is the most restrictive commitment the acquisition involves.
 */
function computeGovernanceLevel(
  commitmentTypes: ExternalCommitmentType[],
  policyGetLevel: (ct: ExternalCommitmentType) => AuthorizationLevel,
): AuthorizationLevel {
  const order: AuthorizationLevel[] = ['R0', 'R1', 'R2', 'R3', 'R5'];
  if (commitmentTypes.length === 0) return 'R0';
  let highest: AuthorizationLevel = 'R0';
  for (const ct of commitmentTypes) {
    const level = policyGetLevel(ct);
    if (order.indexOf(level) > order.indexOf(highest)) {
      highest = level;
    }
  }
  return highest;
}

/**
 * Map a policy decision to the autonomy status reported in the diagnostic.
 */
function policyDecisionToAutonomy(decision: PolicyDecision | null): AutonomyStatus {
  if (decision === null) return 'REQUIRES_OWNER_AUTHORIZATION';
  if (decision === 'ALLOW_AUTONOMOUS' || decision === 'ALLOW_WITH_POLICY') return 'ALLOWED';
  if (decision === 'REQUIRES_OWNER_AUTHORIZATION') return 'REQUIRES_OWNER_AUTHORIZATION';
  return 'DENY' as AutonomyStatus;
}

/**
 * Build a human-readable description of what HEIDI is currently doing
 * about this capability, based on its state.
 */
function describeAction(
  state: CapabilityAcquisitionState,
  blocker: CapabilityBlocker | null,
  missingCredentials: string[],
): string {
  switch (state) {
    case 'READY':
      return 'Capability is verified and operational — no action needed';
    case 'DISCOVERING':
      return 'Discovering current account and credential state';
    case 'BLOCKED':
      if (blocker === 'MISSING_CREDENTIAL') {
        return `Waiting for human to provide credentials: ${missingCredentials.join(', ')}`;
      }
      if (blocker === 'INVALID_CREDENTIAL' || blocker === 'EXPIRED_CREDENTIAL' || blocker === 'REVOKED_CREDENTIAL') {
        return 'Credential present but rejected by provider — awaiting corrected credentials';
      }
      return `Blocked: ${blocker ?? 'unknown reason'}`;
    case 'PLANNED':
      return 'Acquisition plan created — awaiting authorization evaluation';
    case 'AUTHORIZING':
      return 'Evaluating governance policy for this acquisition';
    case 'ACQUIRING':
      return 'Executing autonomous acquisition steps';
    case 'PROVISIONING':
      return 'Provisioning credentials (recording fingerprints, not values)';
    case 'CONFIGURING':
      return 'Applying configuration and restarting affected services';
    case 'VERIFYING':
      return 'Verifying capability against real provider API';
    case 'QUALIFYING':
      return 'Capability verified — recording qualification evidence';
    case 'POLICY_BLOCKED':
      return 'Policy blocked — owner authorization required but not granted';
    case 'ACQUISITION_FAILED':
    case 'PROVISIONING_FAILED':
    case 'VERIFICATION_FAILED':
      return 'Acquisition failed — awaiting retry or human intervention';
    case 'PROVIDER_UNAVAILABLE':
      return 'Provider API unavailable — retrying with backoff';
    case 'UNKNOWN':
    default:
      return 'No acquisition lifecycle started — capability not yet evaluated';
  }
}

/**
 * Describe what is currently preventing resolution of the capability.
 */
function describeCurrentLimitation(
  state: CapabilityAcquisitionState,
  blocker: CapabilityBlocker | null,
  missingCredentials: string[],
  autonomy: AutonomyStatus,
  circuitBreakerTripped: boolean,
): string {
  if (state === 'READY') return 'None — capability is operational';
  if (circuitBreakerTripped) {
    return 'Circuit breaker tripped after repeated failures — automatic retries suspended';
  }
  if (blocker === 'MISSING_CREDENTIAL') {
    return `Missing environment variables: ${missingCredentials.join(', ')}. These must be human-provided.`;
  }
  if (blocker === 'INVALID_CREDENTIAL' || blocker === 'EXPIRED_CREDENTIAL' || blocker === 'REVOKED_CREDENTIAL') {
    return `${blocker}: the present credential was rejected by the provider API. A new credential is required.`;
  }
  if (state === 'POLICY_BLOCKED' || autonomy === 'REQUIRES_OWNER_AUTHORIZATION') {
    return 'Owner authorization required for this acquisition — HEIDI cannot proceed without it';
  }
  if (state === 'PROVIDER_UNAVAILABLE') {
    return 'Provider API is unreachable — transient outage or network issue';
  }
  if (state === 'UNKNOWN') {
    return 'Capability has not been evaluated yet — no lifecycle started';
  }
  return `Capability is in state ${state}`;
}

/**
 * Describe the next concrete action needed to move this capability forward.
 */
function describeNextAction(
  state: CapabilityAcquisitionState,
  blocker: CapabilityBlocker | null,
  missingCredentials: string[],
  autonomy: AutonomyStatus,
  authorized: boolean,
  pending: boolean,
  circuitBreakerTripped: boolean,
): string {
  if (state === 'READY') return 'No action needed — monitor for drift';
  if (circuitBreakerTripped) {
    return 'Reset circuit breaker (manual or via daemon cycle) before retrying acquisition';
  }
  if (blocker === 'MISSING_CREDENTIAL' || (state === 'BLOCKED' && missingCredentials.length > 0)) {
    return `Add the following to .env.local: ${missingCredentials.join(', ')}. Then trigger a daemon acquisition cycle.`;
  }
  if (blocker === 'INVALID_CREDENTIAL' || blocker === 'EXPIRED_CREDENTIAL' || blocker === 'REVOKED_CREDENTIAL') {
    return `Replace the rejected credential in .env.local with a valid one from the provider dashboard, then retry acquisition`;
  }
  if (autonomy === 'REQUIRES_OWNER_AUTHORIZATION') {
    if (pending) {
      return 'Owner must approve the pending authorization request before HEIDI can proceed';
    }
    if (!authorized) {
      return 'Submit an owner authorization request for this provider, then await approval';
    }
  }
  if (state === 'UNKNOWN') {
    return 'Trigger a daemon acquisition cycle to begin discovery for this capability';
  }
  if (state === 'PROVIDER_UNAVAILABLE') {
    return 'Wait for provider API to recover, then retry acquisition';
  }
  if (state.includes('FAILED')) {
    return 'Review the last error, correct the underlying issue, and retry acquisition';
  }
  return 'Trigger a daemon acquisition cycle to advance this capability';
}

// ─── Main Handler ─────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ─── Acquire singletons ──────────────────────────────────────────────
    const { getAcquisitionEngine } = await import('../../lib/operational/ExternalCapabilityAcquisitionEngine');
    const { getProviderAdapterRegistry } = await import('../../lib/operational/ProviderAdapters');
    const { getOwnerAuthorizationStore } = await import('../../lib/operational/OwnerAuthorizationStore');
    const { getDurableAcquisitionStore } = await import('../../lib/operational/DurableAcquisitionStore');
    const { getAcquisitionGovernancePolicy } = await import('../../lib/operational/AcquisitionGovernancePolicy');

    const engine = getAcquisitionEngine();
    const registry = getProviderAdapterRegistry();
    const authStore = getOwnerAuthorizationStore();
    const durableStore = getDurableAcquisitionStore();
    const governancePolicy = getAcquisitionGovernancePolicy();

    // Clean up expired authorizations so the diagnostic reflects current truth
    try {
      authStore.cleanupExpired();
    } catch { /* best effort */ }

    // ─── Filter by capability query param ────────────────────────────────
    const requestedCapability = typeof req.query.capability === 'string' ? req.query.capability : null;
    let adapters: ProviderAdapter[] = registry.getAllAdapters();
    if (requestedCapability) {
      adapters = adapters.filter((a) => a.capabilityId === requestedCapability);
      if (adapters.length === 0) {
        return res.status(404).json({
          error: 'Capability not found',
          capability: requestedCapability,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // ─── Build diagnostics ───────────────────────────────────────────────
    const diagnostics: CapabilityDiagnostic[] = [];

    for (const adapter of adapters) {
      const { capabilityId, providerId, requiredEnvVars } = adapter;

      // 1. Capability state from the engine
      const state: CapabilityAcquisitionState = engine.getCapabilityState(capabilityId);

      // 2. Lifecycle record (for blocker, policy decision, retry count, last error)
      const lifecycle = engine.getLifecycle(capabilityId);
      const blocker: CapabilityBlocker | null = lifecycle?.blocker ?? null;
      const policyDecision = lifecycle?.policyDecision ?? null;

      // 3. Credential presence — check process.env, NEVER expose values
      const present: string[] = [];
      const missing: string[] = [];
      for (const envVar of requiredEnvVars) {
        if (process.env[envVar]) {
          present.push(envVar);
        } else {
          missing.push(envVar);
        }
      }

      // 4. Governance level — derived from the provider's commitment types
      const plan = adapter.getAcquisitionPlan();
      const governanceLevel = computeGovernanceLevel(
        plan.commitmentTypes,
        (ct) => governancePolicy.getRequiredAuthorizationLevel(ct),
      );
      const governance: GovernanceInfo = {
        level: governanceLevel,
        description: GOVERNANCE_DESCRIPTIONS[governanceLevel],
      };

      // 5. Autonomy — from the policy decision recorded in the lifecycle,
      //    or re-derived from the governance level if no lifecycle exists yet
      let autonomy: AutonomyStatus;
      if (policyDecision !== null) {
        autonomy = policyDecisionToAutonomy(policyDecision);
      } else if (governanceLevel === 'R0' || governanceLevel === 'R1') {
        autonomy = 'ALLOWED';
      } else if (governanceLevel === 'R5') {
        autonomy = 'DENIED';
      } else {
        autonomy = 'REQUIRES_OWNER_AUTHORIZATION';
      }

      // 6. Authorization status — check the owner authorization store
      let authorizationStatus: AuthorizationStatus;
      try {
        const pendingRequests = authStore.getPendingRequests().filter((r) => r.provider === providerId);
        const pending = pendingRequests.length > 0;

        // Check if there's an active authorization covering all commitment types
        const authorized = plan.commitmentTypes.every((ct) =>
          authStore.getActiveAuthorizationFor(providerId, ct) !== null,
        );

        let reason: string;
        if (authorized) {
          reason = 'Owner authorization is active and covers all required commitment types';
        } else if (pending) {
          reason = `Authorization request pending (${pendingRequests.length} request${pendingRequests.length > 1 ? 's' : ''}) — awaiting owner decision`;
        } else if (governanceLevel === 'R0' || governanceLevel === 'R1') {
          reason = 'No owner authorization required — autonomous actions only';
        } else {
          reason = 'No active owner authorization — acquisition cannot proceed autonomously';
        }

        authorizationStatus = { pending, authorized, reason };
      } catch {
        authorizationStatus = {
          pending: false,
          authorized: false,
          reason: 'Authorization store unavailable — cannot determine authorization state',
        };
      }

      // 7. Retry status — from the durable acquisition store
      let retryStatus: RetryStatus;
      try {
        const durableRecord = durableStore.getState(capabilityId);
        const attempts = durableRecord?.retryCount ?? lifecycle?.retryCount ?? 0;
        const lastError = durableRecord?.lastError ?? lifecycle?.lastError ?? null;

        // Circuit breaker state: the engine trips it after maxAttempts consecutive
        // failures. We infer it from the durable record — if the state is a
        // failure state and attempts >= the default max (3), the breaker is
        // likely tripped. The engine's in-memory set is not directly exposed,
        // so we use the durable record's failure state + retry count as a proxy.
        const failureStates: CapabilityAcquisitionState[] = [
          'ACQUISITION_FAILED',
          'PROVISIONING_FAILED',
          'VERIFICATION_FAILED',
        ];
        const circuitBreakerTripped =
          failureStates.includes(state) && attempts >= 3;

        retryStatus = { attempts, circuitBreakerTripped, lastError };
      } catch {
        retryStatus = { attempts: 0, circuitBreakerTripped: false, lastError: null };
      }

      // 8. Build human-readable action descriptions
      const action = describeAction(state, blocker, missing);
      const currentLimitation = describeCurrentLimitation(
        state,
        blocker,
        missing,
        autonomy,
        retryStatus.circuitBreakerTripped,
      );
      const nextAction = describeNextAction(
        state,
        blocker,
        missing,
        autonomy,
        authorizationStatus.authorized,
        authorizationStatus.pending,
        retryStatus.circuitBreakerTripped,
      );

      diagnostics.push({
        capability: capabilityId,
        provider: providerId,
        state,
        blocker,
        governance,
        autonomy,
        action,
        currentLimitation,
        nextAction,
        credentialStatus: {
          required: [...requiredEnvVars],
          present,
          missing,
        },
        authorizationStatus,
        retryStatus,
      });
    }

    const response: DiagnosticResponse = {
      timestamp: new Date().toISOString(),
      totalCapabilities: diagnostics.length,
      diagnostics,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('[/api/heidi-diagnostic] Error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'unknown',
      timestamp: new Date().toISOString(),
    });
  }
}
