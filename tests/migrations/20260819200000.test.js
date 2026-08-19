/**
 * Migration test for 20260819200000_heidi_cognitive_core.sql
 *
 * Verifies that the cognitive core schema:
 *   - Creates all required tables
 *   - Has RLS enabled
 *   - Has proper constraints
 *   - Has the identity singleton
 *   - Has proper indexes
 */

const { Client } = require('pg');

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 54322,
  database: 'postgres',
  user: 'postgres',
  password: 'postgres',
};

const REQUIRED_TABLES = [
  'heidi_identity',
  'heidi_goals',
  'heidi_world_model',
  'heidi_trust_classifications',
  'heidi_protected_assets',
];

const REQUIRED_INDEXES = [
  'idx_heidi_goals_parent_id',
  'idx_heidi_goals_goal_type',
  'idx_heidi_goals_status',
  'idx_heidi_goals_priority',
  'idx_heidi_goals_owner',
  'idx_heidi_goals_deadline',
  'idx_heidi_world_model_entity_type',
  'idx_heidi_world_model_entity_id',
  'idx_heidi_world_model_status',
  'idx_heidi_world_model_entity_category',
  'idx_heidi_trust_input_source',
  'idx_heidi_trust_trust_level',
  'idx_heidi_trust_created_at',
  'idx_heidi_protected_assets_category',
  'idx_heidi_protected_assets_protection_level',
];

describe('20260819200000_heidi_cognitive_core migration', () => {
  let client;

  beforeAll(async () => {
    client = new Client(DB_CONFIG);
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end();
  });

  test('all required tables exist', async () => {
    for (const table of REQUIRED_TABLES) {
      const result = await client.query(
        `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = $1`,
        [table]
      );
      expect(result.rows.length).toBe(1);
    }
  });

  test('RLS is enabled on all tables', async () => {
    for (const table of REQUIRED_TABLES) {
      const result = await client.query(
        `SELECT relrowsecurity FROM pg_class WHERE relname = $1 AND relnamespace = 'public'::regnamespace`,
        [table]
      );
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].relrowsecurity).toBe(true);
    }
  });

  test('heidi_identity has singleton constraint', async () => {
    const result = await client.query(
      `SELECT con.conname, pg_get_constraintdef(con.oid) as def
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       WHERE rel.relname = 'heidi_identity' AND con.contype = 'c'`
    );
    const singletonConstraint = result.rows.find(r => r.def && r.def.includes('id = 1'));
    expect(singletonConstraint).toBeDefined();
  });

  test('heidi_identity singleton row exists', async () => {
    const result = await client.query(
      `SELECT * FROM heidi_identity WHERE id = 1`
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].system_name).toBe('HEIDI');
    expect(result.rows[0].version).toBe('2.0');
    expect(result.rows[0].role).toBe('autonomous_intelligence');
  });

  test('heidi_goals has valid goal_type constraint', async () => {
    // Valid insert
    await client.query(
      `INSERT INTO heidi_goals (goal_type, title) VALUES ('mission', 'Constraint Test Mission') RETURNING id`
    );
    // Invalid insert should fail
    await expect(
      client.query(`INSERT INTO heidi_goals (goal_type, title) VALUES ('invalid_type', 'Bad')`)
    ).rejects.toThrow();
    // Cleanup
    await client.query(`DELETE FROM heidi_goals WHERE title = 'Constraint Test Mission'`);
  });

  test('heidi_goals has valid status constraint', async () => {
    const mission = await client.query(
      `INSERT INTO heidi_goals (goal_type, title, status) VALUES ('mission', 'Status Test', 'pending') RETURNING id`
    );
    const goalId = mission.rows[0].id;
    // Valid status update
    await client.query(`UPDATE heidi_goals SET status = 'active' WHERE id = $1`, [goalId]);
    // Invalid status should fail
    await expect(
      client.query(`UPDATE heidi_goals SET status = 'invalid_status' WHERE id = $1`, [goalId])
    ).rejects.toThrow();
    await client.query(`DELETE FROM heidi_goals WHERE id = $1`, [goalId]);
  });

  test('heidi_goals has parent_id foreign key', async () => {
    const parent = await client.query(
      `INSERT INTO heidi_goals (goal_type, title) VALUES ('mission', 'FK Parent') RETURNING id`
    );
    const parentId = parent.rows[0].id;
    const child = await client.query(
      `INSERT INTO heidi_goals (goal_type, title, parent_id) VALUES ('objective', 'FK Child', $1) RETURNING id`,
      [parentId]
    );
    expect(child.rows.length).toBe(1);
    // Deleting parent should cascade
    await client.query(`DELETE FROM heidi_goals WHERE id = $1`, [parentId]);
    const orphaned = await client.query(`SELECT * FROM heidi_goals WHERE id = $1`, [child.rows[0].id]);
    expect(orphaned.rows.length).toBe(0);
  });

  test('heidi_goals priority is bounded 1-10', async () => {
    // Valid priority
    const valid = await client.query(
      `INSERT INTO heidi_goals (goal_type, title, priority) VALUES ('mission', 'Priority Valid', 5) RETURNING id`
    );
    expect(valid.rows.length).toBe(1);
    // Invalid priority (too high)
    await expect(
      client.query(`INSERT INTO heidi_goals (goal_type, title, priority) VALUES ('mission', 'Priority High', 11)`)
    ).rejects.toThrow();
    // Invalid priority (too low)
    await expect(
      client.query(`INSERT INTO heidi_goals (goal_type, title, priority) VALUES ('mission', 'Priority Low', 0)`)
    ).rejects.toThrow();
    await client.query(`DELETE FROM heidi_goals WHERE title = 'Priority Valid'`);
  });

  test('heidi_goals progress is bounded 0-1', async () => {
    const goal = await client.query(
      `INSERT INTO heidi_goals (goal_type, title, progress) VALUES ('mission', 'Progress Test', 0.5) RETURNING id`
    );
    // Invalid progress > 1
    await expect(
      client.query(`UPDATE heidi_goals SET progress = 1.5 WHERE id = $1`, [goal.rows[0].id])
    ).rejects.toThrow();
    await client.query(`DELETE FROM heidi_goals WHERE id = $1`, [goal.rows[0].id]);
  });

  test('heidi_world_model has unique entity_type + entity_id', async () => {
    await client.query(
      `INSERT INTO heidi_world_model (entity_type, entity_id, entity_name) VALUES ('service', 'unique-test', 'Test')`
    );
    // Duplicate should fail
    await expect(
      client.query(`INSERT INTO heidi_world_model (entity_type, entity_id, entity_name) VALUES ('service', 'unique-test', 'Duplicate')`)
    ).rejects.toThrow();
    await client.query(`DELETE FROM heidi_world_model WHERE entity_id = 'unique-test'`);
  });

  test('heidi_world_model has valid entity_type constraint', async () => {
    await client.query(
      `INSERT INTO heidi_world_model (entity_type, entity_id, entity_name) VALUES ('system', 'type-test', 'Test')`
    );
    await expect(
      client.query(`INSERT INTO heidi_world_model (entity_type, entity_id, entity_name) VALUES ('invalid_type', 'type-test-2', 'Bad')`)
    ).rejects.toThrow();
    await client.query(`DELETE FROM heidi_world_model WHERE entity_id = 'type-test'`);
  });

  test('heidi_trust_classifications has valid trust_level constraint', async () => {
    await client.query(
      `INSERT INTO heidi_trust_classifications (input_source, input_type, trust_level)
       VALUES ('test', 'human_message', 'trusted_human')`
    );
    await expect(
      client.query(`INSERT INTO heidi_trust_classifications (input_source, input_type, trust_level) VALUES ('test', 'human_message', 'invalid_level')`)
    ).rejects.toThrow();
    await client.query(`DELETE FROM heidi_trust_classifications WHERE input_source = 'test'`);
  });

  test('heidi_protected_assets has unique category + type + name', async () => {
    await client.query(
      `INSERT INTO heidi_protected_assets (asset_category, asset_type, asset_name)
       VALUES ('human', 'test_asset', 'unique_asset_test')`
    );
    await expect(
      client.query(`INSERT INTO heidi_protected_assets (asset_category, asset_type, asset_name) VALUES ('human', 'test_asset', 'unique_asset_test')`)
    ).rejects.toThrow();
    await client.query(`DELETE FROM heidi_protected_assets WHERE asset_name = 'unique_asset_test'`);
  });

  test('all required indexes exist', async () => {
    for (const indexName of REQUIRED_INDEXES) {
      const result = await client.query(
        `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
        [indexName]
      );
      expect(result.rows.length).toBe(1);
    }
  });

  test('updated_at triggers are present', async () => {
    const triggers = await client.query(
      `SELECT tg.tgname FROM pg_trigger tg
       JOIN pg_class rel ON rel.oid = tg.tgrelid
       WHERE rel.relname IN ('heidi_identity', 'heidi_goals', 'heidi_world_model', 'heidi_protected_assets')
       AND tg.tgname LIKE 'trg_%_updated_at'`
    );
    const triggerNames = triggers.rows.map(r => r.tgname);
    expect(triggerNames).toContain('trg_heidi_identity_updated_at');
    expect(triggerNames).toContain('trg_heidi_goals_updated_at');
    expect(triggerNames).toContain('trg_heidi_world_model_updated_at');
    expect(triggerNames).toContain('trg_heidi_protected_assets_updated_at');
  });

  test('heidi_identity autonomy_level is bounded 0-5', async () => {
    // Valid update
    await client.query(`UPDATE heidi_identity SET autonomy_level = 3 WHERE id = 1`);
    // Invalid — too high
    await expect(
      client.query(`UPDATE heidi_identity SET autonomy_level = 6 WHERE id = 1`)
    ).rejects.toThrow();
    // Reset
    await client.query(`UPDATE heidi_identity SET autonomy_level = 2 WHERE id = 1`);
  });

  test('service_role has access to all tables', async () => {
    // We're connected as postgres, which has all access.
    // Verify the policies exist.
    for (const table of REQUIRED_TABLES) {
      const result = await client.query(
        `SELECT polname FROM pg_policy WHERE polrelid = $1::regclass`,
        [table]
      );
      expect(result.rows.length).toBeGreaterThan(0);
    }
  });
});
