/**
 * HYDI Diagnostic Snapshot — `npm run hydi:diagnose`
 *
 * Produces a complete operational snapshot that is both human-readable
 * and machine-readable (JSON). Reports:
 * - repository identity
 * - Git state
 * - process state
 * - ports
 * - module health
 * - dependency graph
 * - persistence mode
 * - database state
 * - AI runtime
 * - bridge
 * - ProtoForge
 * - CASCADE
 * - KILO
 * - recovery state
 * - recent incidents
 * - security state
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import type { SystemSnapshot, ComponentHealth } from './types';
import type { SystemStateModel } from './SystemStateModel';
import type { DependencyGraph } from './types';
import type { HealthProvenanceChecker } from './HealthProvenanceChecker';
import type { CapabilityAuthorizer } from './CapabilityAuthorizer';
import type { RecoveryEngine } from './RecoveryEngine';
import type { IncidentCorrelator } from './IncidentCorrelator';
import type { OperationalMemory } from './OperationalMemory';

export class DiagnosticSnapshot {
  private root: string;
  private stateModel: SystemStateModel;
  private graph: DependencyGraph;
  private healthChecker: HealthProvenanceChecker;
  private authorizer: CapabilityAuthorizer;
  private recoveryEngine: RecoveryEngine;
  private correlator: IncidentCorrelator;
  private memory: OperationalMemory;

  constructor(
    root: string,
    stateModel: SystemStateModel,
    graph: DependencyGraph,
    healthChecker: HealthProvenanceChecker,
    authorizer: CapabilityAuthorizer,
    recoveryEngine: RecoveryEngine,
    correlator: IncidentCorrelator,
    memory: OperationalMemory,
  ) {
    this.root = root;
    this.stateModel = stateModel;
    this.graph = graph;
    this.healthChecker = healthChecker;
    this.authorizer = authorizer;
    this.recoveryEngine = recoveryEngine;
    this.correlator = correlator;
    this.memory = memory;
  }

  /**
   * Produce a full diagnostic snapshot.
   * @param jsonOutput If true, return JSON only. Otherwise return human-readable text.
   */
  async produce(jsonOutput = false): Promise<string> {
    // Run health checks to get fresh state
    await this.healthChecker.checkAll();

    const snapshot = this.buildSnapshot();

    if (jsonOutput) {
      return JSON.stringify(snapshot, null, 2);
    }

    return this.formatHumanReadable(snapshot);
  }

  private buildSnapshot(): SystemSnapshot {
    const components = this.stateModel.getAllStates();
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const isLocal = supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost');

    let gitCommit = 'unknown';
    let gitBranch = 'unknown';
    let gitClean = true;
    try {
      gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf8', timeout: 5000 }).trim().slice(0, 12);
      gitBranch = execSync('git branch --show-current', { encoding: 'utf8', timeout: 5000 }).trim();
      const status = execSync('git status --porcelain', { encoding: 'utf8', timeout: 5000 }).trim();
      gitClean = status.length === 0;
    } catch { /* git not available */ }

    let remote = 'unknown';
    try {
      remote = execSync('git remote get-url origin', { encoding: 'utf8', timeout: 5000 }).trim();
    } catch { /* ignore */ }

    const recoveryHistory = this.recoveryEngine.getHistory();
    const totalRecoveries = recoveryHistory.length;
    const successfulRecoveries = recoveryHistory.filter(
      (r) => r.finalState === 'HEALTHY',
    ).length;
    const successRate = totalRecoveries > 0 ? successfulRecoveries / totalRecoveries : 1;

    const capabilities = this.authorizer.getAllCapabilities();

    return {
      timestamp: new Date().toISOString(),
      repository: {
        path: this.root,
        remote,
        branch: gitBranch,
        commit: gitCommit,
        clean: gitClean,
      },
      runtime: {
        nodeVersion: process.version,
        platform: process.platform,
        pid: process.pid,
        uptimeSeconds: process.uptime(),
      },
      components,
      dependencyGraph: {
        nodes: Array.from(this.graph.nodes.values()).map((n) => ({
          id: n.id,
          category: n.category,
          criticality: n.criticality,
          dependencies: n.dependencies,
        })),
        criticalPath: this.graph.criticalPath,
      },
      persistence: {
        mode: isLocal ? 'local' : 'cloud',
        endpoint: supabaseUrl,
        cloudFallback: !isLocal,
        active: isLocal ? 'local' : 'cloud',
      },
      recovery: {
        activeRecoveries: this.recoveryEngine.getActiveRecoveries(),
        recentIncidents: this.memory.getRecent(20),
        totalRecoveries,
        successRate,
      },
      security: {
        capabilities,
        deniedActions: this.authorizer.getDeniedCount(),
      },
      overallState: this.stateModel.getOverallState(),
    };
  }

  private formatHumanReadable(snapshot: SystemSnapshot): string {
    const lines: string[] = [];
    const hr = '─'.repeat(60);

    lines.push(hr);
    lines.push('HYDI DIAGNOSTIC SNAPSHOT');
    lines.push(`Timestamp: ${snapshot.timestamp}`);
    lines.push(hr);

    // Repository
    lines.push('');
    lines.push('REPOSITORY');
    lines.push(`  Path:   ${snapshot.repository.path}`);
    lines.push(`  Remote: ${snapshot.repository.remote}`);
    lines.push(`  Branch: ${snapshot.repository.branch}`);
    lines.push(`  Commit: ${snapshot.repository.commit}`);
    lines.push(`  Clean:  ${snapshot.repository.clean ? 'yes' : 'NO (uncommitted changes)'}`);

    // Runtime
    lines.push('');
    lines.push('RUNTIME');
    lines.push(`  Node:    ${snapshot.runtime.nodeVersion}`);
    lines.push(`  Platform: ${snapshot.runtime.platform}`);
    lines.push(`  PID:     ${snapshot.runtime.pid}`);
    lines.push(`  Uptime:  ${snapshot.runtime.uptimeSeconds.toFixed(0)}s`);

    // Overall state
    lines.push('');
    lines.push(`OVERALL STATE: ${this.stateEmoji(snapshot.overallState)}`);

    // Components
    lines.push('');
    lines.push('COMPONENTS');
    for (const comp of snapshot.components) {
      const emoji = this.stateEmoji(comp.state);
      lines.push(`  ${emoji} ${comp.component.padEnd(25)} ${comp.state}`);
      if (comp.error) {
        lines.push(`      error: ${comp.error}`);
      }
      for (const ev of comp.evidence) {
        if (ev.status === 'fail') {
          lines.push(`      FAIL: ${ev.check}: ${ev.value}`);
        }
      }
    }

    // Dependency graph
    lines.push('');
    lines.push('DEPENDENCY GRAPH');
    lines.push(`  Critical path: ${snapshot.dependencyGraph.criticalPath.join(' → ')}`);
    for (const node of snapshot.dependencyGraph.nodes) {
      if (node.dependencies.length > 0) {
        lines.push(`  ${node.id} depends on: ${node.dependencies.join(', ')}`);
      }
    }

    // Persistence
    lines.push('');
    lines.push('PERSISTENCE');
    lines.push(`  Mode:          ${snapshot.persistence.mode}`);
    lines.push(`  Endpoint:      ${snapshot.persistence.endpoint}`);
    lines.push(`  Cloud fallback: ${snapshot.persistence.cloudFallback}`);
    lines.push(`  Active:        ${snapshot.persistence.active}`);

    // Recovery
    lines.push('');
    lines.push('RECOVERY');
    lines.push(`  Active recoveries: ${snapshot.recovery.activeRecoveries.length}`);
    if (snapshot.recovery.activeRecoveries.length > 0) {
      for (const r of snapshot.recovery.activeRecoveries) {
        lines.push(`    - ${r}`);
      }
    }
    lines.push(`  Total recoveries: ${snapshot.recovery.totalRecoveries}`);
    lines.push(`  Success rate:     ${(snapshot.recovery.successRate * 100).toFixed(1)}%`);

    // Active incidents
    const activeIncidents = this.correlator.getActiveIncidents();
    if (activeIncidents.length > 0) {
      lines.push('');
      lines.push('ACTIVE INCIDENTS');
      for (const inc of activeIncidents) {
        lines.push(`  [${inc.id.slice(0, 8)}] ${inc.rootComponent}: ${inc.rootCause}`);
        lines.push(`    affected: ${inc.affectedComponents.join(', ')}`);
      }
    }

    // Security
    lines.push('');
    lines.push('SECURITY');
    lines.push(`  Denied actions: ${snapshot.security.deniedActions}`);
    lines.push(`  Capabilities:`);
    for (const cap of snapshot.security.capabilities) {
      const status = cap.authorized ? 'ALLOWED' : 'DENIED';
      lines.push(`    ${status.padEnd(8)} ${cap.capability}`);
    }

    lines.push('');
    lines.push(hr);
    lines.push(`Overall: ${snapshot.overallState}`);
    lines.push(hr);

    return lines.join('\n');
  }

  private stateEmoji(state: string): string {
    switch (state) {
      case 'HEALTHY': return '✓';
      case 'STARTING': return '◐';
      case 'DEGRADED': return '⚠';
      case 'UNKNOWN': return '?';
      case 'UNAVAILABLE': return '✗';
      case 'RECOVERING': return '↻';
      case 'BLOCKED': return '⊘';
      case 'FAILED': return '✗';
      default: return '?';
    }
  }
}
