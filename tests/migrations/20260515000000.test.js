'use strict';

/**
 * Governance gate test for migration 20260515000000_hydi_phase3_memory_layer.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260515000000_hydi_phase3_memory_layer.sql';

describe('Migration 20260515000000 – HYDI Phase 3.0 Memory Layer', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  // ──────────────────────────────────────────────────────────
  // Baseline
  // ──────────────────────────────────────────────────────────
  describe('baseline', () => {
    it('file is non-empty', () => {
      expect(sql.trim().length).toBeGreaterThan(0);
    });

    it('contains valid SQL keywords', () => {
      expect(sql.toUpperCase()).toMatch(/CREATE|ALTER|INSERT|UPDATE|DROP/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // memory_entities table
  // ──────────────────────────────────────────────────────────
  describe('memory_entities table', () => {
    it('creates memory_entities table with IF NOT EXISTS guard', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS memory_entities/);
    });

    it('defines id as UUID primary key with gen_random_uuid()', () => {
      expect(sql).toMatch(/id\s+UUID\s+PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
    });

    it('defines user_id as UUID referencing auth.users with CASCADE delete', () => {
      expect(sql).toMatch(/user_id\s+UUID.*REFERENCES auth\.users\(id\) ON DELETE CASCADE/s);
    });

    it('defines scope column with CHECK constraint for allowed values', () => {
      expect(sql).toMatch(/scope.*CHECK.*scope IN.*'user'.*'project'.*'task'.*'preference'.*'business_rule'/s);
    });

    it('defines content column as TEXT NOT NULL', () => {
      expect(sql).toMatch(/content\s+TEXT\s+NOT NULL/);
    });

    it('defines embedding column as VECTOR(1536)', () => {
      expect(sql).toMatch(/embedding\s+VECTOR\(1536\)/);
    });

    it('defines access_count with DEFAULT 0', () => {
      expect(sql).toMatch(/access_count.*DEFAULT 0/s);
    });

    it('defines expires_at column', () => {
      expect(sql).toMatch(/expires_at\s+TIMESTAMPTZ/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // memory_entities indexes
  // ──────────────────────────────────────────────────────────
  describe('memory_entities indexes', () => {
    it('creates ivfflat index on embedding with vector_cosine_ops', () => {
      expect(sql).toMatch(/USING ivfflat \(embedding vector_cosine_ops\)/);
    });

    it('configures ivfflat with 100 lists', () => {
      expect(sql).toMatch(/WITH \(lists = 100\)/);
    });

    it('creates composite user_id + scope index', () => {
      expect(sql).toMatch(/memory_entities_user_scope_idx/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // memory_relations table
  // ──────────────────────────────────────────────────────────
  describe('memory_relations table', () => {
    it('creates memory_relations table with IF NOT EXISTS guard', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS memory_relations/);
    });

    it('defines from_entity referencing memory_entities with CASCADE delete', () => {
      expect(sql).toMatch(/from_entity.*REFERENCES memory_entities\(id\) ON DELETE CASCADE/s);
    });

    it('defines to_entity referencing memory_entities with CASCADE delete', () => {
      expect(sql).toMatch(/to_entity.*REFERENCES memory_entities\(id\) ON DELETE CASCADE/s);
    });

    it('defines weight column with bounds CHECK constraint', () => {
      expect(sql).toMatch(/weight.*CHECK.*weight >= 0.*weight <= 10\.0/s);
    });

    it('has no_self_loop constraint preventing from_entity = to_entity', () => {
      expect(sql).toMatch(/CONSTRAINT no_self_loop CHECK.*from_entity <> to_entity/s);
    });

    it('defines metadata column as JSONB', () => {
      expect(sql).toMatch(/metadata\s+JSONB/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // memory_relations indexes
  // ──────────────────────────────────────────────────────────
  describe('memory_relations indexes', () => {
    it('creates index on from_entity', () => {
      expect(sql).toMatch(/memory_relations_from_idx.*ON memory_relations.*from_entity/s);
    });

    it('creates index on to_entity', () => {
      expect(sql).toMatch(/memory_relations_to_idx.*ON memory_relations.*to_entity/s);
    });

    it('creates index on relation_type', () => {
      expect(sql).toMatch(/memory_relations_type_idx.*ON memory_relations.*relation_type/s);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Row Level Security
  // ──────────────────────────────────────────────────────────
  describe('row level security', () => {
    it('enables RLS on memory_entities', () => {
      expect(sql).toMatch(/ALTER TABLE memory_entities\s+ENABLE ROW LEVEL SECURITY/);
    });

    it('enables RLS on memory_relations', () => {
      expect(sql).toMatch(/ALTER TABLE memory_relations\s+ENABLE ROW LEVEL SECURITY/);
    });

    it('creates service_role full-access policy for memory_entities', () => {
      expect(sql).toMatch(/service_role_full_access_memory_entities/);
    });

    it('creates authenticated user ownership policy for memory_entities', () => {
      expect(sql).toMatch(/users_own_memory_entities/);
      expect(sql).toMatch(/user_id = auth\.uid\(\)/);
    });

    it('creates service_role full-access policy for memory_relations', () => {
      expect(sql).toMatch(/service_role_full_access_memory_relations/);
    });

    it('creates authenticated user ownership policy for memory_relations', () => {
      expect(sql).toMatch(/users_own_memory_relations/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // get_hydi_context RPC
  // ──────────────────────────────────────────────────────────
  describe('get_hydi_context RPC function', () => {
    it('creates get_hydi_context function', () => {
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION get_hydi_context/);
    });

    it('accepts p_user_id UUID parameter', () => {
      expect(sql).toMatch(/p_user_id\s+UUID/);
    });

    it('accepts p_query_embedding VECTOR(1536) parameter', () => {
      expect(sql).toMatch(/p_query_embedding\s+VECTOR\(1536\)/);
    });

    it('accepts p_top_k INT parameter with default 5', () => {
      expect(sql).toMatch(/p_top_k.*INT.*DEFAULT 5/s);
    });

    it('accepts p_min_similarity FLOAT parameter with default 0.70', () => {
      expect(sql).toMatch(/p_min_similarity.*FLOAT.*DEFAULT 0\.70/s);
    });

    it('accepts optional p_scope TEXT parameter', () => {
      expect(sql).toMatch(/p_scope.*TEXT.*DEFAULT NULL/s);
    });

    it('returns similarity as FLOAT column', () => {
      expect(sql).toMatch(/similarity\s+FLOAT/);
    });

    it('uses cosine distance operator <=>', () => {
      expect(sql).toMatch(/embedding <=> p_query_embedding/);
    });

    it('uses SECURITY DEFINER', () => {
      expect(sql).toMatch(/SECURITY DEFINER/);
    });

    it('sets search_path to public for security', () => {
      expect(sql).toMatch(/SET search_path = public/);
    });

    it('updates access_count on retrieval', () => {
      expect(sql).toMatch(/access_count\s*=\s*access_count \+ 1/);
    });

    it('updates last_accessed on retrieval', () => {
      expect(sql).toMatch(/last_accessed = now\(\)/);
    });

    it('grants EXECUTE to service_role', () => {
      expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION get_hydi_context.*TO service_role/s);
    });
  });

  // ──────────────────────────────────────────────────────────
  // expire_stale_memories helper
  // ──────────────────────────────────────────────────────────
  describe('expire_stale_memories helper function', () => {
    it('creates expire_stale_memories function', () => {
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION expire_stale_memories/);
    });

    it('returns INT (count of deleted rows)', () => {
      expect(sql).toMatch(/expire_stale_memories\(\)\s*RETURNS INT/s);
    });

    it('deletes rows where expires_at <= now()', () => {
      expect(sql).toMatch(/expires_at.*<=.*now\(\)/s);
    });

    it('grants EXECUTE to service_role', () => {
      expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION expire_stale_memories\(\) TO service_role/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Documentation
  // ──────────────────────────────────────────────────────────
  describe('table comments', () => {
    it('adds COMMENT on memory_entities', () => {
      expect(sql).toMatch(/COMMENT ON TABLE memory_entities IS/);
    });

    it('adds COMMENT on memory_relations', () => {
      expect(sql).toMatch(/COMMENT ON TABLE memory_relations IS/);
    });

    it('adds COMMENT on get_hydi_context function', () => {
      expect(sql).toMatch(/COMMENT ON FUNCTION get_hydi_context IS/);
    });
  });
});
