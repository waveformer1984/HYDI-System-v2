/**
 * HEIDI World Model
 *
 * A persistent, machine-readable representation of ProtoForge and its
 * surrounding environment. HEIDI can answer:
 *   What exists? What is healthy? What is broken? What depends on what?
 *   What changed? Who/what owns it? What am I trying to accomplish?
 *   What can I safely do? What should I not do?
 *
 * The world model is built on top of the existing:
 *   - SystemStateModel (component health)
 *   - DependencyGraphBuilder (service dependencies)
 *   - ServiceRegistry (runtime services)
 *   - Revenue tables (customers, prospects, revenue)
 *   - Communication tables (conversations, messages)
 *
 * It does NOT replace those — it aggregates them into a unified view.
 */

import { Pool, QueryResultRow } from 'pg';

export type EntityType =
  | 'system' | 'service' | 'process' | 'repository' | 'database'
  | 'customer' | 'project' | 'revenue_stream' | 'infrastructure'
  | 'credential' | 'tool' | 'dependency' | 'incident' | 'goal'
  | 'risk' | 'relationship' | 'ownership' | 'authority' | 'environment';

export type EntityStatus = 'healthy' | 'degraded' | 'failed' | 'unknown' | 'active' | 'inactive' | 'deprecated';

export interface WorldEntity {
  entityId: string;
  entityType: EntityType;
  entityName: string;
  entityCategory: string | null;
  status: EntityStatus;
  properties: Record<string, unknown>;
  relationships: EntityRelationship[];
  owner: string | null;
  healthEndpoint: string | null;
  lastObservedAt: string | null;
  observationConfidence: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface EntityRelationship {
  type: 'depends_on' | 'owns' | 'manages' | 'contains' | 'connects_to' | 'produces' | 'consumes';
  targetEntityType: EntityType;
  targetEntityId: string;
  targetEntityName?: string;
}

interface DBConfig {
  host?: string; port?: number; database?: string; user?: string; password?: string;
}

export class WorldModel {
  private pool: Pool;

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

  async upsertEntity(input: {
    entityType: EntityType;
    entityId: string;
    entityName: string;
    entityCategory?: string;
    status?: EntityStatus;
    properties?: Record<string, unknown>;
    relationships?: EntityRelationship[];
    owner?: string;
    healthEndpoint?: string;
    observationConfidence?: number;
    metadata?: Record<string, unknown>;
  }): Promise<WorldEntity> {
    const row = await this.queryOne<QueryResultRow>(
      `INSERT INTO heidi_world_model
         (entity_type, entity_id, entity_name, entity_category, status, properties,
          relationships, owner, health_endpoint, observation_confidence, metadata, last_observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       ON CONFLICT (entity_type, entity_id)
       DO UPDATE SET
         entity_name = EXCLUDED.entity_name,
         entity_category = COALESCE(EXCLUDED.entity_category, heidi_world_model.entity_category),
         status = EXCLUDED.status,
         properties = EXCLUDED.properties,
         relationships = EXCLUDED.relationships,
         owner = COALESCE(EXCLUDED.owner, heidi_world_model.owner),
         health_endpoint = COALESCE(EXCLUDED.health_endpoint, heidi_world_model.health_endpoint),
         observation_confidence = EXCLUDED.observation_confidence,
         metadata = EXCLUDED.metadata,
         last_observed_at = now(),
         updated_at = now()
       RETURNING *`,
      [
        input.entityType,
        input.entityId,
        input.entityName,
        input.entityCategory || null,
        input.status || 'unknown',
        JSON.stringify(input.properties || {}),
        JSON.stringify(input.relationships || []),
        input.owner || null,
        input.healthEndpoint || null,
        input.observationConfidence ?? null,
        JSON.stringify(input.metadata || {}),
      ],
    );
    if (!row) throw new Error('World model upsert returned no row');
    return this.mapEntity(row);
  }

  async getEntity(entityType: EntityType, entityId: string): Promise<WorldEntity | null> {
    const row = await this.queryOne<QueryResultRow>(
      `SELECT * FROM heidi_world_model WHERE entity_type = $1 AND entity_id = $2`,
      [entityType, entityId],
    );
    return row ? this.mapEntity(row) : null;
  }

  async listEntities(filter: {
    entityType?: EntityType;
    status?: EntityStatus;
    entityCategory?: string;
    limit?: number;
  }): Promise<WorldEntity[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filter.entityType) { conditions.push(`entity_type = $${idx++}`); params.push(filter.entityType); }
    if (filter.status) { conditions.push(`status = $${idx++}`); params.push(filter.status); }
    if (filter.entityCategory) { conditions.push(`entity_category = $${idx++}`); params.push(filter.entityCategory); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit || 200;
    params.push(limit);

    const rows = await this.pool.query<QueryResultRow>(
      `SELECT * FROM heidi_world_model ${where} ORDER BY entity_type, entity_name LIMIT $${idx}`,
      params,
    );
    return rows.rows.map((r) => this.mapEntity(r));
  }

  async updateStatus(entityType: EntityType, entityId: string, status: EntityStatus, observationConfidence?: number): Promise<void> {
    await this.pool.query(
      `UPDATE heidi_world_model
       SET status = $1, observation_confidence = $2, last_observed_at = now(), updated_at = now()
       WHERE entity_type = $3 AND entity_id = $4`,
      [status, observationConfidence ?? null, entityType, entityId],
    );
  }

  async getHealthSummary(): Promise<{
    total: number;
    healthy: number;
    degraded: number;
    failed: number;
    unknown: number;
    byType: Record<string, { total: number; healthy: number; degraded: number; failed: number; unknown: number }>;
  }> {
    const rows = await this.pool.query<QueryResultRow>(
      `SELECT entity_type, status, count(*) as cnt FROM heidi_world_model GROUP BY entity_type, status`,
    );

    const summary: {
      total: number; healthy: number; degraded: number; failed: number; unknown: number;
      byType: Record<string, { total: number; healthy: number; degraded: number; failed: number; unknown: number }>;
    } = {
      total: 0, healthy: 0, degraded: 0, failed: 0, unknown: 0,
      byType: {},
    };

    for (const row of rows.rows) {
      const type = row.entity_type as string;
      const status = row.status as string;
      const count = parseInt(row.cnt, 10);

      if (!summary.byType[type]) {
        summary.byType[type] = { total: 0, healthy: 0, degraded: 0, failed: 0, unknown: 0 };
      }
      summary.byType[type].total += count;
      const byTypeEntry = summary.byType[type] as unknown as Record<string, number>;
      byTypeEntry[status] = (byTypeEntry[status] || 0) + count;
      summary.total += count;
      const summaryRecord = summary as unknown as Record<string, number>;
      summaryRecord[status] = (summaryRecord[status] || 0) + count;
    }

    return summary;
  }

  async getRelationships(entityType: EntityType, entityId: string): Promise<EntityRelationship[]> {
    const entity = await this.getEntity(entityType, entityId);
    return entity?.relationships || [];
  }

  async findDependents(entityType: EntityType, entityId: string): Promise<WorldEntity[]> {
    // Find all entities that depend on the given entity
    const all = await this.listEntities({ limit: 1000 });
    return all.filter((e) =>
      e.relationships.some((r) => r.type === 'depends_on' && r.targetEntityType === entityType && r.targetEntityId === entityId),
    );
  }

  async answerQuestion(question: string): Promise<string> {
    const q = question.toLowerCase();
    const summary = await this.getHealthSummary();

    if (q.includes('what exists') || q.includes('what do you know')) {
      const entities = await this.listEntities({ limit: 50 });
      const byType: Record<string, number> = {};
      for (const e of entities) {
        byType[e.entityType] = (byType[e.entityType] || 0) + 1;
      }
      return `World model contains ${summary.total} entities: ${Object.entries(byType).map(([t, c]) => `${c} ${t}`).join(', ')}. Health: ${summary.healthy} healthy, ${summary.degraded} degraded, ${summary.failed} failed, ${summary.unknown} unknown.`;
    }

    if (q.includes('what is healthy')) {
      const healthy = await this.listEntities({ status: 'healthy', limit: 50 });
      return `${healthy.length} entities are healthy: ${healthy.map((e) => e.entityName).join(', ')}`;
    }

    if (q.includes('what is broken') || q.includes('what is failed')) {
      const failed = await this.listEntities({ status: 'failed', limit: 50 });
      const degraded = await this.listEntities({ status: 'degraded', limit: 50 });
      return `${failed.length} failed: ${failed.map((e) => e.entityName).join(', ') || 'none'}. ${degraded.length} degraded: ${degraded.map((e) => e.entityName).join(', ') || 'none'}.`;
    }

    if (q.includes('what changed') || q.includes('recent')) {
      const rows = await this.pool.query<QueryResultRow>(
        `SELECT * FROM heidi_world_model ORDER BY updated_at DESC LIMIT 10`,
      );
      const recent = rows.rows.map((r) => `${r.entity_name} (${r.status}, updated ${r.updated_at})`);
      return `Recently changed: ${recent.join(', ') || 'none'}`;
    }

    return `World model: ${summary.total} entities, ${summary.healthy} healthy, ${summary.degraded} degraded, ${summary.failed} failed, ${summary.unknown} unknown.`;
  }

  async syncFromRuntime(): Promise<{ synced: number; errors: string[] }> {
    let synced = 0;
    const errors: string[] = [];

    // Sync services from boot.config.json
    try {
      const bootConfig = require('../../boot.config.json');
      for (const module of bootConfig.modules || []) {
        await this.upsertEntity({
          entityType: 'service',
          entityId: module.id,
          entityName: module.name || module.id,
          entityCategory: 'runtime_service',
          status: 'unknown',
          properties: { port: module.port, command: module.command },
          relationships: (module.dependsOn || []).map((dep: string) => ({
            type: 'depends_on' as const,
            targetEntityType: 'service' as EntityType,
            targetEntityId: dep,
          })),
          healthEndpoint: module.healthEndpoint || (module.port ? `http://localhost:${module.port}/health` : null),
          owner: 'system',
        });
        synced++;
      }
    } catch (e) {
      errors.push(`boot.config sync: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // Sync revenue streams
    try {
      const rows = await this.pool.query<QueryResultRow>(
        `SELECT DISTINCT stream_name FROM revenue_events WHERE stream_name IS NOT NULL LIMIT 20`,
      );
      for (const row of rows.rows) {
        await this.upsertEntity({
          entityType: 'revenue_stream',
          entityId: row.stream_name,
          entityName: row.stream_name,
          entityCategory: 'revenue',
          status: 'active',
          properties: {},
          owner: 'system',
        });
        synced++;
      }
    } catch (e) {
      errors.push(`revenue sync: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // Sync customers
    try {
      const rows = await this.pool.query<QueryResultRow>(
        `SELECT id, email, status FROM customers LIMIT 50`,
      );
      for (const row of rows.rows) {
        await this.upsertEntity({
          entityType: 'customer',
          entityId: row.id,
          entityName: row.email || row.id,
          entityCategory: 'customer',
          status: (row.status as EntityStatus) || 'unknown',
          properties: { email: row.email },
          owner: 'system',
        });
        synced++;
      }
    } catch (e) {
      // customers table may not have expected columns
      errors.push(`customer sync: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    return { synced, errors };
  }

  private mapEntity(row: QueryResultRow): WorldEntity {
    return {
      entityId: row.entity_id,
      entityType: row.entity_type as EntityType,
      entityName: row.entity_name,
      entityCategory: row.entity_category,
      status: row.status as EntityStatus,
      properties: row.properties || {},
      relationships: row.relationships || [],
      owner: row.owner,
      healthEndpoint: row.health_endpoint,
      lastObservedAt: row.last_observed_at,
      observationConfidence: row.observation_confidence ? parseFloat(row.observation_confidence) : null,
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
let _instance: WorldModel | null = null;

export function getWorldModel(config?: DBConfig): WorldModel {
  if (!_instance) {
    _instance = new WorldModel(config);
  }
  return _instance;
}
