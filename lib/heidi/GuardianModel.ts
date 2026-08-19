/**
 * HEIDI Guardian — Protected Assets Model
 *
 * HEIDI is a digital guardian. This module defines the protected-assets
 * model and guardian behavior.
 *
 * Guardian behavior:
 *   OBSERVE → VALIDATE → CORRELATE → ASSESS THREAT → SELECT PROTECTION
 *   → AUTHORIZE → EXECUTE → VERIFY → RECORD → ESCALATE
 *
 * The guardian protects the owner's authority rather than replacing it.
 * Guardian actions are themselves governed by the autonomy policy.
 */

import { Pool, QueryResultRow } from 'pg';

export type AssetCategory = 'human' | 'protoforge' | 'hydi';
export type ProtectionLevel = 'standard' | 'elevated' | 'critical';

export interface ProtectedAsset {
  assetId: string;
  assetCategory: AssetCategory;
  assetType: string;
  assetName: string;
  description: string | null;
  protectionLevel: ProtectionLevel;
  accessPolicy: Record<string, unknown>;
  monitoringEnabled: boolean;
  alertOnAccess: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ThreatAssessment {
  threatId: string;
  assetId: string;
  threatType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  description: string;
  recommendedAction: string;
  authorizationRequired: 'autonomous' | 'policy_authorized' | 'human_required';
  timestamp: string;
}

interface DBConfig {
  host?: string; port?: number; database?: string; user?: string; password?: string;
}

// Default protected assets — seeded on first run
const DEFAULT_ASSETS: Omit<ProtectedAsset, 'assetId' | 'createdAt' | 'updatedAt'>[] = [
  // Human assets
  { assetCategory: 'human', assetType: 'private_info', assetName: 'owner_personal_data',
    description: 'Human owner personal information', protectionLevel: 'critical',
    accessPolicy: { allowedActors: ['human_owner'], denyAllOthers: true },
    monitoringEnabled: true, alertOnAccess: true, metadata: {} },
  { assetCategory: 'human', assetType: 'credentials', assetName: 'owner_credentials',
    description: 'Human owner credentials and API keys', protectionLevel: 'critical',
    accessPolicy: { allowedActors: ['human_owner'], denyAllOthers: true, neverDisplay: true },
    monitoringEnabled: true, alertOnAccess: true, metadata: {} },
  { assetCategory: 'human', assetType: 'financial', assetName: 'owner_financial_resources',
    description: 'Human owner financial resources', protectionLevel: 'critical',
    accessPolicy: { allowedActors: ['human_owner'], denyAllOthers: true },
    monitoringEnabled: true, alertOnAccess: true, metadata: {} },

  // ProtoForge assets
  { assetCategory: 'protoforge', assetType: 'source_code', assetName: 'protoforge_repository',
    description: 'ProtoForge source code and intellectual property', protectionLevel: 'elevated',
    accessPolicy: { allowedActors: ['human_owner', 'heidi'], denyModificationsBy: ['external'] },
    monitoringEnabled: true, alertOnAccess: false, metadata: {} },
  { assetCategory: 'protoforge', assetType: 'customer_data', assetName: 'customer_database',
    description: 'Customer data and records', protectionLevel: 'critical',
    accessPolicy: { allowedActors: ['human_owner', 'heidi', 'authorized_service'], denyAllOthers: true },
    monitoringEnabled: true, alertOnAccess: true, metadata: {} },
  { assetCategory: 'protoforge', assetType: 'infrastructure', assetName: 'protoforge_infrastructure',
    description: 'ProtoForge infrastructure and deployments', protectionLevel: 'elevated',
    accessPolicy: { allowedActors: ['human_owner', 'heidi'], denyDestructiveBy: ['external', 'unknown_user'] },
    monitoringEnabled: true, alertOnAccess: false, metadata: {} },
  { assetCategory: 'protoforge', assetType: 'revenue', assetName: 'revenue_pipeline',
    description: 'Revenue pipeline and financial records', protectionLevel: 'critical',
    accessPolicy: { allowedActors: ['human_owner', 'heidi'], denyModificationsBy: ['external'] },
    monitoringEnabled: true, alertOnAccess: true, metadata: {} },

  // HYDI assets
  { assetCategory: 'hydi', assetType: 'system_integrity', assetName: 'hydi_system_integrity',
    description: 'HYDI system integrity and databases', protectionLevel: 'critical',
    accessPolicy: { allowedActors: ['human_owner', 'heidi'], denyDestructiveBy: ['external', 'unknown_user'] },
    monitoringEnabled: true, alertOnAccess: true, metadata: {} },
  { assetCategory: 'hydi', assetType: 'autonomy_policy', assetName: 'heidi_autonomy_policy',
    description: 'HEIDI autonomy policy and guardrails', protectionLevel: 'critical',
    accessPolicy: { allowedActors: ['human_owner'], denyAllOthers: true, neverModify: true },
    monitoringEnabled: true, alertOnAccess: true, metadata: {} },
  { assetCategory: 'hydi', assetType: 'audit_history', assetName: 'heidi_audit_history',
    description: 'HEIDI audit history and decision records', protectionLevel: 'critical',
    accessPolicy: { allowedActors: ['human_owner', 'heidi'], denyModificationsBy: ['all'], appendOnly: true },
    monitoringEnabled: true, alertOnAccess: true, metadata: {} },
];

export class GuardianModel {
  private pool: Pool;
  private seeded = false;

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

  async seedDefaults(): Promise<void> {
    if (this.seeded) return;
    for (const asset of DEFAULT_ASSETS) {
      await this.pool.query(
        `INSERT INTO heidi_protected_assets
           (asset_category, asset_type, asset_name, description, protection_level, access_policy, monitoring_enabled, alert_on_access, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (asset_category, asset_type, asset_name) DO NOTHING`,
        [
          asset.assetCategory, asset.assetType, asset.assetName, asset.description,
          asset.protectionLevel, JSON.stringify(asset.accessPolicy),
          asset.monitoringEnabled, asset.alertOnAccess, JSON.stringify(asset.metadata),
        ],
      );
    }
    this.seeded = true;
  }

  async listAssets(filter?: { category?: AssetCategory; protectionLevel?: ProtectionLevel }): Promise<ProtectedAsset[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filter?.category) { conditions.push(`asset_category = $${idx++}`); params.push(filter.category); }
    if (filter?.protectionLevel) { conditions.push(`protection_level = $${idx++}`); params.push(filter.protectionLevel); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await this.pool.query<QueryResultRow>(
      `SELECT * FROM heidi_protected_assets ${where} ORDER BY protection_level DESC, asset_category, asset_name`,
      params,
    );
    return rows.rows.map((r) => this.mapAsset(r));
  }

  async getAsset(category: AssetCategory, type: string, name: string): Promise<ProtectedAsset | null> {
    const row = await this.queryOne<QueryResultRow>(
      `SELECT * FROM heidi_protected_assets WHERE asset_category = $1 AND asset_type = $2 AND asset_name = $3`,
      [category, type, name],
    );
    return row ? this.mapAsset(row) : null;
  }

  async checkAccess(
    actor: string,
    actorTrustLevel: string,
    action: 'read' | 'modify' | 'delete' | 'execute',
    assetCategory: AssetCategory,
    assetType: string,
    assetName: string,
  ): Promise<{ allowed: boolean; reason: string }> {
    const asset = await this.getAsset(assetCategory, assetType, assetName);
    if (!asset) {
      return { allowed: false, reason: `Protected asset not found: ${assetCategory}/${assetType}/${assetName}` };
    }

    const policy = asset.accessPolicy;
    const allowedActors = (policy.allowedActors as string[]) || [];
    const denyAllOthers = policy.denyAllOthers as boolean;
    const neverDisplay = policy.neverDisplay as boolean;
    const neverModify = policy.neverModify as boolean;
    const appendOnly = policy.appendOnly as boolean;

    // Never display credentials
    if (action === 'read' && neverDisplay && actor !== 'human_owner') {
      return { allowed: false, reason: `Asset ${assetName} is never displayable except to human owner` };
    }

    // Never modify
    if (action === 'modify' && neverModify) {
      return { allowed: false, reason: `Asset ${assetName} can never be modified` };
    }

    // Append-only
    if (action === 'delete' && appendOnly) {
      return { allowed: false, reason: `Asset ${assetName} is append-only — deletion prohibited` };
    }

    // Check allowed actors
    if (allowedActors.includes(actor)) {
      return { allowed: true, reason: `Actor ${actor} is in allowed list for ${assetName}` };
    }

    // Deny all others
    if (denyAllOthers) {
      return { allowed: false, reason: `Asset ${assetName} denies access to all actors not in allowed list` };
    }

    // Trust level check
    if (actorTrustLevel === 'malicious_input' || actorTrustLevel === 'untrusted_input' || actorTrustLevel === 'unknown_user') {
      return { allowed: false, reason: `Actor trust level ${actorTrustLevel} is insufficient for protected asset ${assetName}` };
    }

    // Critical assets require trusted_human or trusted_system
    if (asset.protectionLevel === 'critical' && action !== 'read') {
      if (actorTrustLevel !== 'trusted_human' && actorTrustLevel !== 'trusted_system') {
        return { allowed: false, reason: `Critical asset ${assetName} modification requires trusted_human or trusted_system trust level` };
      }
    }

    return { allowed: true, reason: `Access permitted to ${assetName} for actor ${actor} (${actorTrustLevel})` };
  }

  async assessThreat(input: {
    assetId: string;
    threatType: string;
    description: string;
    confidence: number;
  }): Promise<ThreatAssessment> {
    const severity = input.confidence > 0.8 ? 'critical' :
      input.confidence > 0.6 ? 'high' :
      input.confidence > 0.3 ? 'medium' : 'low';

    const authorizationRequired = severity === 'critical' || severity === 'high'
      ? 'human_required'
      : severity === 'medium'
        ? 'policy_authorized'
        : 'autonomous';

    const recommendedAction = severity === 'critical'
      ? 'Immediate escalation to human owner — block all access to affected asset'
      : severity === 'high'
        ? 'Escalate to human owner and increase monitoring on affected asset'
        : severity === 'medium'
          ? 'Increase monitoring and log the threat for review'
          : 'Log the threat for periodic review';

    return {
      threatId: `threat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      assetId: input.assetId,
      threatType: input.threatType,
      severity,
      confidence: input.confidence,
      description: input.description,
      recommendedAction,
      authorizationRequired,
      timestamp: new Date().toISOString(),
    };
  }

  async getSummary(): Promise<{
    total: number;
    critical: number;
    elevated: number;
    standard: number;
    byCategory: Record<string, number>;
  }> {
    await this.seedDefaults();
    const rows = await this.pool.query<QueryResultRow>(
      `SELECT asset_category, protection_level, count(*) as cnt
       FROM heidi_protected_assets GROUP BY asset_category, protection_level`,
    );

    const summary: { total: number; critical: number; elevated: number; standard: number; byCategory: Record<string, number> } = {
      total: 0, critical: 0, elevated: 0, standard: 0, byCategory: {},
    };
    for (const row of rows.rows) {
      const count = parseInt(row.cnt, 10);
      summary.total += count;
      const summaryRecord = summary as unknown as Record<string, number>;
      summaryRecord[row.protection_level] = (summaryRecord[row.protection_level] || 0) + count;
      summary.byCategory[row.asset_category] = (summary.byCategory[row.asset_category] || 0) + count;
    }
    return summary;
  }

  private mapAsset(row: QueryResultRow): ProtectedAsset {
    return {
      assetId: row.id,
      assetCategory: row.asset_category,
      assetType: row.asset_type,
      assetName: row.asset_name,
      description: row.description,
      protectionLevel: row.protection_level,
      accessPolicy: row.access_policy || {},
      monitoringEnabled: row.monitoring_enabled,
      alertOnAccess: row.alert_on_access,
      metadata: row.metadata || {},
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
let _instance: GuardianModel | null = null;

export function getGuardianModel(config?: DBConfig): GuardianModel {
  if (!_instance) {
    _instance = new GuardianModel(config);
  }
  return _instance;
}
