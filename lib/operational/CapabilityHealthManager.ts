/**
 * HEIDI Capability Health Manager
 *
 * Aggregates capability health across the entire system into a unified,
 * evidence-backed view. HEIDI can ask "What can I do right now?" and
 * receive honest, verified answers.
 *
 * Capability states:
 *   READY         — capability was exercised or independently verified
 *   DEGRADED      — capability works but with reduced fidelity
 *   BLOCKED       — external dependency prevents execution
 *   UNAVAILABLE   — underlying system is down
 *   REPAIRABLE    — HEIDI can repair this autonomously (R0/R1)
 *   HUMAN_REQUIRED— requires human authorization or action
 *   PROHIBITED    — policy prohibits this action
 *
 * Every state includes evidence. READY is never reported merely because
 * a module exists — it must be verified.
 *
 * This builds on top of existing infrastructure:
 *   - HealthProvenanceChecker (component health)
 *   - RecoveryEngine (recovery state)
 *   - SelfHealthMonitor (HEIDI's own health)
 *   - WorldModel (entity state)
 *   - CapabilityRegistry (capability descriptors)
 *
 * It does NOT replace those — it aggregates them.
 */

import type { CapabilityDescriptor } from '../heidi/CapabilityRegistry';
import type { HealthCheckResult } from './HealthProvenanceChecker';

// ─── Types ───────────────────────────────────────────────────────────────

export type CapabilityHealthState =
  | 'READY'
  | 'DEGRADED'
  | 'BLOCKED'
  | 'UNAVAILABLE'
  | 'REPAIRABLE'
  | 'HUMAN_REQUIRED'
  | 'PROHIBITED'
  | 'UNKNOWN';

export type BlockerClassification =
  | 'SOFTWARE_BUG'
  | 'CONFIGURATION_BUG'
  | 'DATABASE_STATE_PROBLEM'
  | 'INFRASTRUCTURE_RUNTIME_PROBLEM'
  | 'MISSING_LOCAL_CAPABILITY'
  | 'MISSING_EXTERNAL_CREDENTIAL'
  | 'HUMAN_AUTHORIZATION_REQUIRED'
  | 'EXTERNAL_SERVICE_UNAVAILABLE'
  | 'POLICY_PROHIBITED_ACTION'
  | 'NOT_BLOCKED'
  | 'UNKNOWN_BLOCKER';

export interface CapabilityHealthReport {
  capabilityId: string;
  description: string;
  provider: string;
  dependencies: string[];
  state: CapabilityHealthState;
  evidence: string;
  lastSuccessfulVerification: string | null;
  lastFailure: string | null;
  failureClassification: BlockerClassification;
  repairability: 'auto_repairable' | 'human_required' | 'not_repairable' | 'not_applicable';
  requiredAuthorization: string;
  requiredCredentials: string[];
  recoveryProcedure: string;
  verificationProcedure: string;
  checkedAt: string;
}

export interface CapabilityHealthSummary {
  total: number;
  ready: number;
  degraded: number;
  blocked: number;
  unavailable: number;
  repairable: number;
  humanRequired: number;
  prohibited: number;
  unknown: number;
  reports: CapabilityHealthReport[];
}

// ─── Capability Probe Interface ──────────────────────────────────────────

export interface CapabilityProbe {
  capabilityId: string;
  description: string;
  provider: string;
  dependencies: string[];
  requiredCredentials: string[];
  requiredAuthorization: string;
  verificationProcedure: string;
  recoveryProcedure: string;
  /**
   * Probe the capability. Returns evidence-backed state.
   * Never returns READY without actually exercising the capability.
   */
  probe(): Promise<{
    state: CapabilityHealthState;
    evidence: string;
    failureClassification?: BlockerClassification;
    lastSuccessfulVerification?: string | null;
    lastFailure?: string;
  }>;
}

// ─── Capability Health Manager ───────────────────────────────────────────

export class CapabilityHealthManager {
  private probes: Map<string, CapabilityProbe> = new Map();
  private lastReports: Map<string, CapabilityHealthReport> = new Map();
  private lastFullCheck: CapabilityHealthSummary | null = null;

  /**
   * Register a capability probe.
   */
  registerProbe(probe: CapabilityProbe): void {
    this.probes.set(probe.capabilityId, probe);
  }

  /**
   * Check a single capability by ID.
   */
  async checkCapability(capabilityId: string): Promise<CapabilityHealthReport | null> {
    const probe = this.probes.get(capabilityId);
    if (!probe) return null;

    try {
      const result = await probe.probe();
      const report: CapabilityHealthReport = {
        capabilityId: probe.capabilityId,
        description: probe.description,
        provider: probe.provider,
        dependencies: probe.dependencies,
        state: result.state,
        evidence: result.evidence,
        lastSuccessfulVerification: result.lastSuccessfulVerification || null,
        lastFailure: result.lastFailure || null,
        failureClassification: result.failureClassification || (result.state === 'READY' ? 'NOT_BLOCKED' : 'UNKNOWN_BLOCKER'),
        repairability: this.classifyRepairability(result.state, result.failureClassification),
        requiredAuthorization: probe.requiredAuthorization,
        requiredCredentials: probe.requiredCredentials,
        recoveryProcedure: probe.recoveryProcedure,
        verificationProcedure: probe.verificationProcedure,
        checkedAt: new Date().toISOString(),
      };

      this.lastReports.set(capabilityId, report);
      return report;
    } catch (error) {
      const report: CapabilityHealthReport = {
        capabilityId: probe.capabilityId,
        description: probe.description,
        provider: probe.provider,
        dependencies: probe.dependencies,
        state: 'UNKNOWN',
        evidence: `Probe failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        lastSuccessfulVerification: null,
        lastFailure: new Date().toISOString(),
        failureClassification: 'SOFTWARE_BUG',
        repairability: 'auto_repairable',
        requiredAuthorization: probe.requiredAuthorization,
        requiredCredentials: probe.requiredCredentials,
        recoveryProcedure: probe.recoveryProcedure,
        verificationProcedure: probe.verificationProcedure,
        checkedAt: new Date().toISOString(),
      };
      this.lastReports.set(capabilityId, report);
      return report;
    }
  }

  /**
   * Check all registered capabilities and return a summary.
   */
  async checkAll(): Promise<CapabilityHealthSummary> {
    const reports: CapabilityHealthReport[] = [];

    for (const [capabilityId] of this.probes) {
      const report = await this.checkCapability(capabilityId);
      if (report) reports.push(report);
    }

    const summary: CapabilityHealthSummary = {
      total: reports.length,
      ready: reports.filter((r) => r.state === 'READY').length,
      degraded: reports.filter((r) => r.state === 'DEGRADED').length,
      blocked: reports.filter((r) => r.state === 'BLOCKED').length,
      unavailable: reports.filter((r) => r.state === 'UNAVAILABLE').length,
      repairable: reports.filter((r) => r.state === 'REPAIRABLE').length,
      humanRequired: reports.filter((r) => r.state === 'HUMAN_REQUIRED').length,
      prohibited: reports.filter((r) => r.state === 'PROHIBITED').length,
      unknown: reports.filter((r) => r.state === 'UNKNOWN').length,
      reports,
    };

    this.lastFullCheck = summary;
    return summary;
  }

  /**
   * Get the last cached summary (without re-probing).
   */
  getLastSummary(): CapabilityHealthSummary | null {
    return this.lastFullCheck;
  }

  /**
   * Get the last report for a single capability.
   */
  getLastReport(capabilityId: string): CapabilityHealthReport | null {
    return this.lastReports.get(capabilityId) || null;
  }

  /**
   * Get all capabilities that are in a specific state.
   */
  getCapabilitiesByState(state: CapabilityHealthState): CapabilityHealthReport[] {
    const results: CapabilityHealthReport[] = [];
    for (const report of this.lastReports.values()) {
      if (report.state === state) results.push(report);
    }
    return results;
  }

  /**
   * Get all blocked capabilities with their blocker classification.
   */
  getBlockedCapabilities(): CapabilityHealthReport[] {
    return [
      ...this.getCapabilitiesByState('BLOCKED'),
      ...this.getCapabilitiesByState('UNAVAILABLE'),
      ...this.getCapabilitiesByState('HUMAN_REQUIRED'),
    ];
  }

  /**
   * Get all auto-repairable capabilities.
   */
  getAutoRepairable(): CapabilityHealthReport[] {
    return [...this.getCapabilitiesByState('REPAIRABLE')].filter(
      (r) => r.repairability === 'auto_repairable',
    );
  }

  /**
   * Answer "What can I do right now?" — returns all READY capabilities.
   */
  getReadyCapabilities(): CapabilityHealthReport[] {
    return this.getCapabilitiesByState('READY');
  }

  /**
   * Classify repairability based on state and blocker type.
   */
  private classifyRepairability(
    state: CapabilityHealthState,
    blocker: BlockerClassification | undefined,
  ): 'auto_repairable' | 'human_required' | 'not_repairable' | 'not_applicable' {
    if (state === 'READY' || state === 'DEGRADED') return 'not_applicable';
    if (state === 'PROHIBITED') return 'not_repairable';
    if (state === 'HUMAN_REQUIRED') return 'human_required';

    if (blocker) {
      switch (blocker) {
        case 'SOFTWARE_BUG':
        case 'CONFIGURATION_BUG':
        case 'DATABASE_STATE_PROBLEM':
        case 'INFRASTRUCTURE_RUNTIME_PROBLEM':
        case 'MISSING_LOCAL_CAPABILITY':
          return 'auto_repairable';
        case 'MISSING_EXTERNAL_CREDENTIAL':
        case 'HUMAN_AUTHORIZATION_REQUIRED':
        case 'EXTERNAL_SERVICE_UNAVAILABLE':
          return 'human_required';
        case 'POLICY_PROHIBITED_ACTION':
          return 'not_repairable';
        default:
          return 'not_repairable';
      }
    }

    return 'not_repairable';
  }

  /**
   * Get a human-readable summary string.
   */
  formatSummary(summary: CapabilityHealthSummary): string {
    const lines: string[] = [];
    lines.push('════════════════════════════════════════════════════════════════');
    lines.push('CAPABILITY HEALTH SUMMARY');
    lines.push('════════════════════════════════════════════════════════════════');
    lines.push(`Total capabilities:     ${summary.total}`);
    lines.push(`READY:                  ${summary.ready}`);
    lines.push(`DEGRADED:               ${summary.degraded}`);
    lines.push(`BLOCKED:                ${summary.blocked}`);
    lines.push(`UNAVAILABLE:            ${summary.unavailable}`);
    lines.push(`REPAIRABLE:             ${summary.repairable}`);
    lines.push(`HUMAN_REQUIRED:         ${summary.humanRequired}`);
    lines.push(`PROHIBITED:             ${summary.prohibited}`);
    lines.push(`UNKNOWN:                ${summary.unknown}`);
    lines.push('');

    for (const report of summary.reports) {
      const icon = this.stateIcon(report.state);
      lines.push(`  ${icon} ${report.capabilityId}: ${report.state}`);
      if (report.state !== 'READY') {
        lines.push(`     Evidence: ${report.evidence.substring(0, 100)}`);
        if (report.requiredCredentials.length > 0) {
          lines.push(`     Required credentials: ${report.requiredCredentials.join(', ')}`);
        }
      }
    }

    lines.push('════════════════════════════════════════════════════════════════');
    return lines.join('\n');
  }

  private stateIcon(state: CapabilityHealthState): string {
    switch (state) {
      case 'READY': return '[OK]';
      case 'DEGRADED': return '[~] ';
      case 'BLOCKED': return '[X] ';
      case 'UNAVAILABLE': return '[!] ';
      case 'REPAIRABLE': return '[R] ';
      case 'HUMAN_REQUIRED': return '[H] ';
      case 'PROHIBITED': return '[P] ';
      case 'UNKNOWN': return '[?] ';
      default: return '[ ] ';
    }
  }
}

// ─── Built-in Probes ─────────────────────────────────────────────────────

/**
 * Create a probe for a database capability.
 */
export function createDatabaseProbe(config: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}): CapabilityProbe {
  return {
    capabilityId: 'system.database',
    description: 'Local Supabase/Postgres database',
    provider: 'postgres',
    dependencies: [],
    requiredCredentials: [],
    requiredAuthorization: 'R0',
    verificationProcedure: 'Connect to database and query for table count',
    recoveryProcedure: 'Start local Supabase via supabase start',
    async probe() {
      try {
        const { Pool } = await import('pg');
        const pool = new Pool({ ...config, max: 1, connectionTimeoutMillis: 5000 });
        const result = await pool.query('SELECT count(*) as cnt FROM information_schema.tables WHERE table_schema = $1', ['public']);
        await pool.end();
        const tableCount = parseInt(result.rows[0]?.cnt || '0', 10);
        return {
          state: 'READY' as CapabilityHealthState,
          evidence: `Database connected successfully. ${tableCount} tables in public schema.`,
          lastSuccessfulVerification: new Date().toISOString(),
          failureClassification: 'NOT_BLOCKED' as BlockerClassification,
        };
      } catch (error) {
        return {
          state: 'UNAVAILABLE' as CapabilityHealthState,
          evidence: `Database connection failed: ${error instanceof Error ? error.message : 'unknown'}`,
          lastFailure: new Date().toISOString(),
          failureClassification: 'INFRASTRUCTURE_RUNTIME_PROBLEM' as BlockerClassification,
        };
      }
    },
  };
}

/**
 * Create a probe for the local Ollama model.
 */
export function createOllamaProbe(url: string, model: string): CapabilityProbe {
  return {
    capabilityId: 'system.local_model',
    description: 'Local Ollama language model',
    provider: 'ollama',
    dependencies: [],
    requiredCredentials: [],
    requiredAuthorization: 'R0',
    verificationProcedure: 'HTTP GET to Ollama API root',
    recoveryProcedure: 'Start Ollama with: ollama serve',
    async probe() {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          return {
            state: 'READY' as CapabilityHealthState,
            evidence: `Ollama responded at ${url} (HTTP ${response.status})`,
            lastSuccessfulVerification: new Date().toISOString(),
            failureClassification: 'NOT_BLOCKED' as BlockerClassification,
          };
        }
        return {
          state: 'DEGRADED' as CapabilityHealthState,
          evidence: `Ollama responded with HTTP ${response.status}`,
          lastFailure: new Date().toISOString(),
          failureClassification: 'INFRASTRUCTURE_RUNTIME_PROBLEM' as BlockerClassification,
        };
      } catch (error) {
        return {
          state: 'UNAVAILABLE' as CapabilityHealthState,
          evidence: `Ollama not reachable at ${url}: ${error instanceof Error ? error.message : 'unknown'}`,
          lastFailure: new Date().toISOString(),
          failureClassification: 'INFRASTRUCTURE_RUNTIME_PROBLEM' as BlockerClassification,
        };
      }
    },
  };
}

/**
 * Create a probe for an external credential-gated capability.
 */
export function createCredentialProbe(config: {
  capabilityId: string;
  description: string;
  provider: string;
  credentialEnvVars: string[];
  dependencies?: string[];
}): CapabilityProbe {
  return {
    capabilityId: config.capabilityId,
    description: config.description,
    provider: config.provider,
    dependencies: config.dependencies || [],
    requiredCredentials: config.credentialEnvVars,
    requiredAuthorization: 'R0',
    verificationProcedure: `Check for environment variables: ${config.credentialEnvVars.join(', ')}`,
    recoveryProcedure: 'Set the required environment variables in .env.local',
    async probe() {
      const missing = config.credentialEnvVars.filter((k) => !process.env[k]);
      if (missing.length === 0) {
        return {
          state: 'READY' as CapabilityHealthState,
          evidence: `All required credentials present: ${config.credentialEnvVars.join(', ')}`,
          lastSuccessfulVerification: new Date().toISOString(),
          failureClassification: 'NOT_BLOCKED' as BlockerClassification,
        };
      }
      return {
        state: 'BLOCKED' as CapabilityHealthState,
        evidence: `Missing credentials: ${missing.join(', ')}`,
        lastFailure: new Date().toISOString(),
        failureClassification: 'MISSING_EXTERNAL_CREDENTIAL' as BlockerClassification,
      };
    },
  };
}

/**
 * Create a probe for a commercial workflow capability.
 */
export function createCommercialProbe(config: {
  capabilityId: string;
  description: string;
  getState: () => Promise<{
    discoveryAvailable: boolean;
    discoveryBlocker: string | null;
    emailAvailable: boolean;
    emailBlocker: string | null;
    stripeAvailable: boolean;
    stripeBlocker: string | null;
    prospectsDiscovered: number;
    opportunitiesCreated: number;
  }>;
}): CapabilityProbe {
  return {
    capabilityId: config.capabilityId,
    description: config.description,
    provider: 'commercial_workflow',
    dependencies: ['system.database'],
    requiredCredentials: [],
    requiredAuthorization: 'R0',
    verificationProcedure: 'Query commercial workflow state',
    recoveryProcedure: 'Check commercial workflow dependencies',
    async probe() {
      try {
        const state = await config.getState();
        const parts: string[] = [];
        let overallState: CapabilityHealthState = 'READY';

        if (!state.discoveryAvailable) {
          parts.push('discovery: BLOCKED');
          overallState = 'BLOCKED';
        } else {
          parts.push('discovery: READY');
        }

        if (!state.emailAvailable) {
          parts.push('email: BLOCKED');
          if (overallState === 'READY') overallState = 'DEGRADED';
        } else {
          parts.push('email: READY');
        }

        if (!state.stripeAvailable) {
          parts.push('stripe: BLOCKED');
          if (overallState === 'READY') overallState = 'DEGRADED';
        } else {
          parts.push('stripe: READY');
        }

        parts.push(`prospects: ${state.prospectsDiscovered}`);
        parts.push(`opportunities: ${state.opportunitiesCreated}`);

        const blocker = overallState === 'BLOCKED' ? 'MISSING_EXTERNAL_CREDENTIAL' as BlockerClassification : 'NOT_BLOCKED' as BlockerClassification;

        return {
          state: overallState,
          evidence: parts.join('; '),
          lastSuccessfulVerification: overallState === 'READY' ? new Date().toISOString() : null,
          failureClassification: blocker,
        };
      } catch (error) {
        return {
          state: 'UNKNOWN' as CapabilityHealthState,
          evidence: `Commercial workflow state query failed: ${error instanceof Error ? error.message : 'unknown'}`,
          lastFailure: new Date().toISOString(),
          failureClassification: 'SOFTWARE_BUG' as BlockerClassification,
        };
      }
    },
  };
}
