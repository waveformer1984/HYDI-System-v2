'use strict';
const { readMigration } = require('./helpers');

describe('20260426121300_chat_operator_schema', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260426121300_chat_operator_schema.sql').toLowerCase(); });

  test('creates chat_conversations table', () => {
    expect(sql).toContain('chat_conversations');
    expect(sql).toContain('create table');
  });

  test('creates chat_messages table', () => {
    expect(sql).toContain('chat_messages');
  });

  test('creates operator_actions table', () => {
    expect(sql).toContain('operator_actions');
  });

  test('chat_messages references chat_conversations with cascade delete', () => {
    expect(sql).toContain('references chat_conversations');
    expect(sql).toContain('on delete cascade');
  });

  test('sender_type check covers user/assistant/system', () => {
    expect(sql).toContain("'user'");
    expect(sql).toContain("'assistant'");
    expect(sql).toContain("'system'");
  });

  test('action_status check covers all states', () => {
    expect(sql).toContain("'queued'");
    expect(sql).toContain("'running'");
    expect(sql).toContain("'success'");
    expect(sql).toContain("'failed'");
  });

  test('creates Realtime publication for chat events', () => {
    expect(sql).toContain('publication');
    expect(sql).toContain('chat_events');
  });

  test('RLS enabled on all three tables', () => {
    const count = (sql.match(/enable row level security/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(3);
  });
});
