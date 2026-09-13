/**
 * Migration test: 20260819140000_communication_layer_schema
 *
 * Verifies that the communication layer schema extension correctly:
 *   - adds columns to chat_conversations, chat_messages, operator_actions
 *   - creates communication_events and communication_kill_switch tables
 *   - enforces constraints (direction, delivery_status, channel, etc.)
 *   - enables RLS on new tables
 *   - creates indexes for query patterns
 *   - seeds the kill switch singleton
 */

const { Client } = require('pg');

const DB_CONFIG = {
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT || '54322', 10),
  database: process.env.PGDATABASE || 'postgres',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
};

async function withClient(fn) {
  const c = new Client(DB_CONFIG);
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function columnExists(c, table, column) {
  const r = await c.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
    [table, column]
  );
  return r.rows.length > 0;
}

async function tableExists(c, table) {
  const r = await c.query(
    `SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=$1`,
    [table]
  );
  return r.rows.length > 0;
}

async function constraintExists(c, constraintName) {
  const r = await c.query(
    `SELECT 1 FROM pg_constraint WHERE conname=$1`,
    [constraintName]
  );
  return r.rows.length > 0;
}

async function indexExists(c, indexName) {
  const r = await c.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=$1`,
    [indexName]
  );
  return r.rows.length > 0;
}

describe('migration: 20260819140000_communication_layer_schema', () => {
  test('chat_conversations has extended columns', async () => {
    await withClient(async (c) => {
      expect(await columnExists(c, 'chat_conversations', 'channel')).toBe(true);
      expect(await columnExists(c, 'chat_conversations', 'prospect_id')).toBe(true);
      expect(await columnExists(c, 'chat_conversations', 'customer_id')).toBe(true);
      expect(await columnExists(c, 'chat_conversations', 'opportunity_id')).toBe(true);
      expect(await columnExists(c, 'chat_conversations', 'support_case_id')).toBe(true);
      expect(await columnExists(c, 'chat_conversations', 'classification')).toBe(true);
      expect(await columnExists(c, 'chat_conversations', 'metadata')).toBe(true);
      expect(await columnExists(c, 'chat_conversations', 'closed_at')).toBe(true);
    });
  });

  test('chat_messages has extended columns', async () => {
    await withClient(async (c) => {
      expect(await columnExists(c, 'chat_messages', 'message_id')).toBe(true);
      expect(await columnExists(c, 'chat_messages', 'direction')).toBe(true);
      expect(await columnExists(c, 'chat_messages', 'sender_id')).toBe(true);
      expect(await columnExists(c, 'chat_messages', 'recipient_id')).toBe(true);
      expect(await columnExists(c, 'chat_messages', 'channel')).toBe(true);
      expect(await columnExists(c, 'chat_messages', 'content_type')).toBe(true);
      expect(await columnExists(c, 'chat_messages', 'reply_to')).toBe(true);
      expect(await columnExists(c, 'chat_messages', 'delivery_status')).toBe(true);
      expect(await columnExists(c, 'chat_messages', 'processing_status')).toBe(true);
      expect(await columnExists(c, 'chat_messages', 'authorization_context')).toBe(true);
      expect(await columnExists(c, 'chat_messages', 'audit_reference')).toBe(true);
      expect(await columnExists(c, 'chat_messages', 'provider_message_id')).toBe(true);
      expect(await columnExists(c, 'chat_messages', 'metadata')).toBe(true);
      expect(await columnExists(c, 'chat_messages', 'delivered_at')).toBe(true);
    });
  });

  test('operator_actions has extended columns', async () => {
    await withClient(async (c) => {
      expect(await columnExists(c, 'operator_actions', 'action_type')).toBe(true);
      expect(await columnExists(c, 'operator_actions', 'risk_level')).toBe(true);
      expect(await columnExists(c, 'operator_actions', 'authorization_mode')).toBe(true);
      expect(await columnExists(c, 'operator_actions', 'authorized')).toBe(true);
      expect(await columnExists(c, 'operator_actions', 'policy_reference')).toBe(true);
      expect(await columnExists(c, 'operator_actions', 'audit_reference')).toBe(true);
      expect(await columnExists(c, 'operator_actions', 'metadata')).toBe(true);
    });
  });

  test('communication_events table exists with RLS', async () => {
    await withClient(async (c) => {
      expect(await tableExists(c, 'communication_events')).toBe(true);
      const r = await c.query(`SELECT rowsecurity FROM pg_tables WHERE tablename='communication_events'`);
      expect(r.rows[0].rowsecurity).toBe(true);
    });
  });

  test('communication_kill_switch table exists with singleton', async () => {
    await withClient(async (c) => {
      expect(await tableExists(c, 'communication_kill_switch')).toBe(true);
      const r = await c.query(`SELECT status FROM communication_kill_switch WHERE id=1`);
      expect(r.rows.length).toBe(1);
      expect(r.rows[0].status).toBe('active');
    });
  });

  test('constraints enforce valid direction values', async () => {
    await withClient(async (c) => {
      expect(await constraintExists(c, 'chat_messages_direction_check')).toBe(true);
      // Insert should fail with invalid direction
      const conv = await c.query(`INSERT INTO chat_conversations (owner_user_id, channel) VALUES (gen_random_uuid(), 'web_chat') RETURNING id`);
      await expect(
        c.query(`INSERT INTO chat_messages (conversation_id, sender_type, content, direction) VALUES ($1, 'user', 'test', 'invalid')`, [conv.rows[0].id])
      ).rejects.toThrow();
      // Cleanup
      await c.query(`DELETE FROM chat_conversations WHERE id=$1`, [conv.rows[0].id]);
    });
  });

  test('constraints enforce valid delivery_status values', async () => {
    await withClient(async (c) => {
      expect(await constraintExists(c, 'chat_messages_delivery_status_check')).toBe(true);
    });
  });

  test('constraints enforce valid channel values', async () => {
    await withClient(async (c) => {
      expect(await constraintExists(c, 'chat_conversations_channel_check')).toBe(true);
      expect(await constraintExists(c, 'chat_messages_channel_check')).toBe(true);
    });
  });

  test('message_id is unique', async () => {
    await withClient(async (c) => {
      expect(await indexExists(c, 'chat_messages_message_id_key')).toBe(true);
    });
  });

  test('indexes exist for query patterns', async () => {
    await withClient(async (c) => {
      expect(await indexExists(c, 'idx_chat_messages_direction')).toBe(true);
      expect(await indexExists(c, 'idx_chat_messages_channel')).toBe(true);
      expect(await indexExists(c, 'idx_chat_messages_delivery_status')).toBe(true);
      expect(await indexExists(c, 'idx_communication_events_event_type')).toBe(true);
      expect(await indexExists(c, 'idx_communication_events_created_at')).toBe(true);
    });
  });

  test('kill_switch singleton constraint prevents second row', async () => {
    await withClient(async (c) => {
      await expect(
        c.query(`INSERT INTO communication_kill_switch (id, status) VALUES (2, 'active')`)
      ).rejects.toThrow();
    });
  });

  test('can insert and retrieve a full communication record', async () => {
    await withClient(async (c) => {
      const conv = await c.query(
        `INSERT INTO chat_conversations (owner_user_id, channel, prospect_id, classification, metadata)
         VALUES (gen_random_uuid(), 'email', 'prospect-123', 'LEAD', '{"source":"test"}')
         RETURNING id, channel, prospect_id`
      );
      expect(conv.rows[0].channel).toBe('email');
      expect(conv.rows[0].prospect_id).toBe('prospect-123');

      const msg = await c.query(
        `INSERT INTO chat_messages (conversation_id, sender_type, content, direction, channel, delivery_status, message_id, sender_id, recipient_id)
         VALUES ($1, 'agent', 'Hello from HEIDI', 'outbound', 'email', 'sent', 'msg-test-' || gen_random_uuid()::text, 'heidi', 'prospect-123')
         RETURNING id, direction, delivery_status`,
        [conv.rows[0].id]
      );
      expect(msg.rows[0].direction).toBe('outbound');
      expect(msg.rows[0].delivery_status).toBe('sent');

      const evt = await c.query(
        `INSERT INTO communication_events (event_id, event_type, channel, conversation_id, message_id, actor, action_type, risk_level, authorized)
         VALUES ('evt-' || gen_random_uuid()::text, 'outbound_sent', 'email', $1, $2, 'heidi', 'prospect_outreach', 'R1', true)
         RETURNING id, event_type`,
        [conv.rows[0].id, msg.rows[0].id]
      );
      expect(evt.rows[0].event_type).toBe('outbound_sent');

      // Cleanup
      await c.query(`DELETE FROM communication_events WHERE conversation_id=$1`, [conv.rows[0].id]);
      await c.query(`DELETE FROM chat_messages WHERE conversation_id=$1`, [conv.rows[0].id]);
      await c.query(`DELETE FROM chat_conversations WHERE id=$1`, [conv.rows[0].id]);
    });
  });
});
