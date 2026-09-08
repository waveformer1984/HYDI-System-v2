/**
 * `chat_messages` lookup — schema drift and the uuid/text comparison.
 *
 * Two independent defects blocked `comm.send_message` from ever verifying its
 * delivery, and the first hid the second:
 *
 *   1. SCHEMA DRIFT. `conversationStore` selects `message_id`, but the local
 *      database had only `id, conversation_id, sender_type, content, tool_call,
 *      created_at`. Migration 20260819140000 adds the columns and had simply
 *      never been applied — the ledger holds 3 entries while the repo has
 *      migrations through August, so this database was provisioned outside the
 *      migration history.
 *
 *   2. TYPE MISMATCH. Once the columns existed, `WHERE message_id = $1 OR
 *      id = $1` still threw: `id` is uuid, `message_id` is text, and
 *      CommunicationLayer generates ids like "out-1757...-a1b2" which are never
 *      uuids. Postgres rejected the whole query — "operator does not exist:
 *      uuid = text" through a bound parameter — so getMessage() threw rather
 *      than returning null.
 *
 * These run against the real local Postgres because the defect was in the SQL
 * itself — a mocked pool would have passed throughout.
 */

import { Pool } from 'pg';
import { randomUUID } from 'crypto';

const DB = {
  host: process.env.PG_HOST || '127.0.0.1',
  port: parseInt(process.env.PG_PORT || '54322', 10),
  database: process.env.PG_DATABASE || 'postgres',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  max: 2,
};

const PREFIX = `storetest_${Date.now()}`;
const NON_UUID_MESSAGE_ID = `out-${Date.now()}-abcd`;

/** The exact query conversationStore.getMessage() issues. */
const LOOKUP = `SELECT * FROM chat_messages WHERE message_id = $1 OR id::text = $1`;

describe('chat_messages supports the store lookup', () => {
  let pool: Pool;
  let rowId: string;
  let conversationId: string;

  beforeAll(async () => {
    pool = new Pool(DB);
    conversationId = randomUUID();
    await pool.query(
      `INSERT INTO chat_conversations (id, channel, classification, metadata)
       VALUES ($1, 'heidi_core', $2, '{}'::jsonb)`,
      [conversationId, PREFIX],
    );
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO chat_messages (conversation_id, sender_type, content, message_id, channel, direction, delivery_status)
       VALUES ($1, 'assistant', $2, $3, 'heidi_core', 'outbound', 'sent')
       RETURNING id`,
      [conversationId, `${PREFIX} body`, NON_UUID_MESSAGE_ID],
    );
    rowId = inserted.rows[0].id;
  }, 30000);

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DELETE FROM chat_messages WHERE message_id = $1`, [NON_UUID_MESSAGE_ID]).catch(() => undefined);
    await pool.query(`DELETE FROM chat_conversations WHERE classification = $1`, [PREFIX]).catch(() => undefined);
    await pool.end();
  }, 30000);

  it('has the columns the store selects', async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'chat_messages'
         AND column_name IN ('message_id', 'delivery_status', 'provider_message_id', 'delivered_at')`,
    );
    expect(rows.map((r) => r.column_name).sort()).toEqual([
      'delivered_at',
      'delivery_status',
      'message_id',
      'provider_message_id',
    ]);
  });

  it('finds a message by its non-uuid message_id', async () => {
    // The case that threw before the cast: an "out-..." id against a uuid column.
    const { rows } = await pool.query(LOOKUP, [NON_UUID_MESSAGE_ID]);
    expect(rows).toHaveLength(1);
    expect(rows[0].delivery_status).toBe('sent');
  });

  it('still finds a message by its uuid primary key', async () => {
    // The cast must not break the lookup form that already worked.
    const { rows } = await pool.query(LOOKUP, [rowId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].message_id).toBe(NON_UUID_MESSAGE_ID);
  });

  it('returns no rows — rather than throwing — for an unknown non-uuid id', async () => {
    // getMessage() is contracted to return null for a missing message. Before
    // the fix it threw instead, which surfaced as a verification `error` and
    // was indistinguishable from the subsystem being down.
    const { rows } = await pool.query(LOOKUP, ['out-does-not-exist-zzzz']);
    expect(rows).toHaveLength(0);
  });

  it('rejects the pre-fix query, proving the regression is real', async () => {
    // Guards against someone "simplifying" the cast back out.
    //
    // The error text depends on how the value arrives. A literal in psql gives
    // "invalid input syntax for type uuid"; a BOUND PARAMETER — which is what
    // the store actually uses — gives "operator does not exist: uuid = text",
    // because the driver sends it as text and no uuid = text operator exists.
    // Same defect, different diagnostic; this asserts the real code path's.
    await expect(
      pool.query(`SELECT * FROM chat_messages WHERE message_id = $1 OR id = $1`, [
        'out-not-a-uuid',
      ]),
    ).rejects.toThrow(/operator does not exist: uuid = text/);
  });
});
