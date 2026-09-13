/**
 * HEIDI Unified Identity Model
 *
 * The single authoritative identity for HEIDI. Consolidates the scattered
 * identity information from heidi-baseline.json, ethos-mission.md, and
 * AutonomyContract.ts into one persistent, machine-readable model.
 *
 * Identity is stored in the heidi_identity table (singleton) and survives
 * process restarts, deployments, and model changes.
 *
 * Principles:
 *   - identity ≠ permission ≠ policy ≠ execution
 *   - identity is persistent and verifiable
 *   - identity does not grant authority — policy does
 *   - identity changes are auditable
 */

import { Pool, QueryResultRow } from 'pg';
import { HEIDI_MAY, HEIDI_MUST_NEVER } from '../operational/AutonomyContract';

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface HeidiIdentity {
  systemName: string;
  version: string;
  role: string;
  description: string;
  autonomyLevel: AutonomyLevel;
  capabilities: string[];
  permissions: string[];
  operatingPolicies: Record<string, unknown>;
  trustedEntities: TrustedEntity[];
  protectedAssets: ProtectedAssetRef[];
  currentMission: string | null;
  activeGoals: string[];
  currentEnvironment: Record<string, unknown>;
  persistentState: Record<string, unknown>;
  identityChecksum: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TrustedEntity {
  type: 'human_owner' | 'system' | 'service' | 'customer';
  id: string;
  name: string;
  trustLevel: 'full' | 'elevated' | 'standard' | 'limited';
}

export interface ProtectedAssetRef {
  category: 'human' | 'protoforge' | 'hydi';
  type: string;
  name: string;
  protectionLevel: 'standard' | 'elevated' | 'critical';
}

export interface AutonomyLevelDescriptor {
  level: AutonomyLevel;
  name: string;
  description: string;
  capabilities: string[];
}

export const AUTONOMY_LEVELS: AutonomyLevelDescriptor[] = [
  {
    level: 0, name: 'OBSERVE',
    description: 'Observe only. No actions, no recommendations.',
    capabilities: ['perceive', 'record'],
  },
  {
    level: 1, name: 'RECOMMEND',
    description: 'Observe and recommend. No autonomous execution.',
    capabilities: ['perceive', 'record', 'recommend', 'brief'],
  },
  {
    level: 2, name: 'EXECUTE_REVERSIBLE',
    description: 'Execute reversible low-risk actions within policy bounds.',
    capabilities: ['perceive', 'record', 'recommend', 'brief', 'execute_reversible'],
  },
  {
    level: 3, name: 'BOUNDED_WORKFLOWS',
    description: 'Execute bounded operational workflows within defined limits.',
    capabilities: ['perceive', 'record', 'recommend', 'brief', 'execute_reversible', 'execute_bounded_workflow'],
  },
  {
    level: 4, name: 'MULTI_STEP_OBJECTIVES',
    description: 'Manage multi-step objectives within defined limits.',
    capabilities: ['perceive', 'record', 'recommend', 'brief', 'execute_reversible', 'execute_bounded_workflow', 'manage_objectives'],
  },
  {
    level: 5, name: 'STRATEGIC_AUTONOMY',
    description: 'Operate strategically within explicitly protected boundaries and human oversight.',
    capabilities: ['perceive', 'record', 'recommend', 'brief', 'execute_reversible', 'execute_bounded_workflow', 'manage_objectives', 'strategic_planning'],
  },
];

interface DBConfig {
  host?: string; port?: number; database?: string; user?: string; password?: string;
}

export class HeidiIdentityModel {
  private pool: Pool;
  private cached: HeidiIdentity | null = null;
  private cachedAt: number = 0;
  private readonly cacheTtlMs = 10000;

  constructor(config?: DBConfig) {
    this.pool = new Pool({
      host: config?.host || process.env.PG_HOST || '127.0.0.1',
      port: config?.port || parseInt(process.env.PG_PORT || '54322', 10),
      database: config?.database || process.env.PG_DATABASE || 'postgres',
      user: config?.user || process.env.PG_USER || 'postgres',
      password: config?.password || process.env.PG_PASSWORD || 'postgres',
      max: 5, idleTimeoutMillis: 30000,
    });
  }

  async getIdentity(): Promise<HeidiIdentity> {
    if (this.cached && Date.now() - this.cachedAt < this.cacheTtlMs) {
      return this.cached;
    }
    const row = await this.queryOne<QueryResultRow>(
      `SELECT * FROM heidi_identity WHERE id = 1`,
    );
    if (!row) {
      return this.getDefaultIdentity();
    }
    this.cached = this.mapRow(row);
    this.cachedAt = Date.now();
    return this.cached;
  }

  async updateIdentity(updates: Partial<Omit<HeidiIdentity, 'createdAt' | 'updatedAt' | 'identityChecksum'>>): Promise<HeidiIdentity> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (updates.systemName !== undefined) { sets.push(`system_name = $${idx++}`); params.push(updates.systemName); }
    if (updates.version !== undefined) { sets.push(`version = $${idx++}`); params.push(updates.version); }
    if (updates.role !== undefined) { sets.push(`role = $${idx++}`); params.push(updates.role); }
    if (updates.description !== undefined) { sets.push(`description = $${idx++}`); params.push(updates.description); }
    if (updates.autonomyLevel !== undefined) { sets.push(`autonomy_level = $${idx++}`); params.push(updates.autonomyLevel); }
    if (updates.capabilities !== undefined) { sets.push(`capabilities = $${idx++}`); params.push(JSON.stringify(updates.capabilities)); }
    if (updates.permissions !== undefined) { sets.push(`permissions = $${idx++}`); params.push(JSON.stringify(updates.permissions)); }
    if (updates.operatingPolicies !== undefined) { sets.push(`operating_policies = $${idx++}`); params.push(JSON.stringify(updates.operatingPolicies)); }
    if (updates.trustedEntities !== undefined) { sets.push(`trusted_entities = $${idx++}`); params.push(JSON.stringify(updates.trustedEntities)); }
    if (updates.protectedAssets !== undefined) { sets.push(`protected_assets = $${idx++}`); params.push(JSON.stringify(updates.protectedAssets)); }
    if (updates.currentMission !== undefined) { sets.push(`current_mission = $${idx++}`); params.push(updates.currentMission); }
    if (updates.activeGoals !== undefined) { sets.push(`active_goals = $${idx++}`); params.push(JSON.stringify(updates.activeGoals)); }
    if (updates.currentEnvironment !== undefined) { sets.push(`current_environment = $${idx++}`); params.push(JSON.stringify(updates.currentEnvironment)); }
    if (updates.persistentState !== undefined) { sets.push(`persistent_state = $${idx++}`); params.push(JSON.stringify(updates.persistentState)); }

    if (sets.length === 0) {
      return this.getIdentity();
    }

    const row = await this.queryOne<QueryResultRow>(
      `UPDATE heidi_identity SET ${sets.join(', ')} WHERE id = 1 RETURNING *`,
      params,
    );
    if (row) {
      this.cached = this.mapRow(row);
      this.cachedAt = Date.now();
    }
    return this.cached || this.getDefaultIdentity();
  }

  async setAutonomyLevel(level: AutonomyLevel, reason: string, authorizedBy: string): Promise<HeidiIdentity> {
    if (level < 0 || level > 5) {
      throw new Error(`Invalid autonomy level: ${level}`);
    }
    // Autonomy level increases require qualification evidence
    const current = await this.getIdentity();
    if (level > current.autonomyLevel) {
      // Check for qualification evidence in persistent state
      const qualifications = current.persistentState['autonomy_qualifications'] as Array<{ level: number; evidence: string; timestamp: string }> || [];
      const hasQualification = qualifications.some((q) => q.level >= level);
      if (!hasQualification && authorizedBy !== 'human_owner') {
        throw new Error(`Autonomy increase to level ${level} requires qualification evidence or human owner authorization`);
      }
    }

    const env = { ...current.currentEnvironment, autonomyChangeReason: reason, autonomyChangedBy: authorizedBy, autonomyChangedAt: new Date().toISOString() };
    return this.updateIdentity({ autonomyLevel: level, currentEnvironment: env });
  }

  async setMission(mission: string): Promise<HeidiIdentity> {
    return this.updateIdentity({ currentMission: mission });
  }

  async addTrustedEntity(entity: TrustedEntity): Promise<HeidiIdentity> {
    const current = await this.getIdentity();
    const existing = current.trustedEntities.filter((e) => !(e.type === entity.type && e.id === entity.id));
    existing.push(entity);
    return this.updateIdentity({ trustedEntities: existing });
  }

  async addProtectedAsset(asset: ProtectedAssetRef): Promise<HeidiIdentity> {
    const current = await this.getIdentity();
    const existing = current.protectedAssets.filter((a) => !(a.category === asset.category && a.type === asset.type && a.name === asset.name));
    existing.push(asset);
    return this.updateIdentity({ protectedAssets: existing });
  }

  async addCapability(capability: string): Promise<HeidiIdentity> {
    const current = await this.getIdentity();
    if (!current.capabilities.includes(capability)) {
      return this.updateIdentity({ capabilities: [...current.capabilities, capability] });
    }
    return current;
  }

  getAutonomyLevelDescriptor(level: AutonomyLevel): AutonomyLevelDescriptor {
    return AUTONOMY_LEVELS[level] || AUTONOMY_LEVELS[0];
  }

  getContract(): { may: typeof HEIDI_MAY; mustNever: typeof HEIDI_MUST_NEVER } {
    return { may: HEIDI_MAY, mustNever: HEIDI_MUST_NEVER };
  }

  async toSummary(): Promise<string> {
    const id = await this.getIdentity();
    const desc = this.getAutonomyLevelDescriptor(id.autonomyLevel);
    const lines = [
      'HEIDI IDENTITY SUMMARY',
      '======================',
      `System: ${id.systemName} v${id.version}`,
      `Role: ${id.role}`,
      `Description: ${id.description}`,
      `Autonomy Level: ${id.autonomyLevel} (${desc.name}) — ${desc.description}`,
      `Capabilities: ${id.capabilities.length > 0 ? id.capabilities.join(', ') : 'none declared'}`,
      `Trusted Entities: ${id.trustedEntities.length}`,
      `Protected Assets: ${id.protectedAssets.length}`,
      `Current Mission: ${id.currentMission || 'none'}`,
      `Active Goals: ${id.activeGoals.length}`,
      '',
      'HEIDI MAY (autonomously):',
      ...HEIDI_MAY.map((m) => `  [${m.risk}/${m.authorization}] ${m.capability}: ${m.description}`),
      '',
      'HEIDI MUST NEVER:',
      ...HEIDI_MUST_NEVER.map((n) => `  ✗ ${n.prohibition}`),
    ];
    return lines.join('\n');
  }

  private getDefaultIdentity(): HeidiIdentity {
    return {
      systemName: 'HEIDI',
      version: '2.0',
      role: 'autonomous_intelligence',
      description: 'Persistent autonomous intelligence, digital guardian, and executive operator for ProtoForge',
      autonomyLevel: 2,
      capabilities: ['perceive', 'record', 'recommend', 'brief', 'execute_reversible'],
      permissions: [],
      operatingPolicies: {},
      trustedEntities: [{ type: 'human_owner', id: 'owner', name: 'Human Owner', trustLevel: 'full' }],
      protectedAssets: [],
      currentMission: null,
      activeGoals: [],
      currentEnvironment: {},
      persistentState: {},
      identityChecksum: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  private mapRow(row: QueryResultRow): HeidiIdentity {
    return {
      systemName: row.system_name,
      version: row.version,
      role: row.role,
      description: row.description,
      autonomyLevel: row.autonomy_level as AutonomyLevel,
      capabilities: row.capabilities || [],
      permissions: row.permissions || [],
      operatingPolicies: row.operating_policies || {},
      trustedEntities: row.trusted_entities || [],
      protectedAssets: row.protected_assets || [],
      currentMission: row.current_mission,
      activeGoals: row.active_goals || [],
      currentEnvironment: row.current_environment || {},
      persistentState: row.persistent_state || {},
      identityChecksum: row.identity_checksum,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async queryOne<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<T | null> {
    const result = await this.pool.query<T>(text, params as never[]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Singleton
let _instance: HeidiIdentityModel | null = null;

export function getHeidiIdentity(config?: DBConfig): HeidiIdentityModel {
  if (!_instance) {
    _instance = new HeidiIdentityModel(config);
  }
  return _instance;
}
