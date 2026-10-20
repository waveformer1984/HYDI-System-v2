'use strict';

const fs = require('fs');
const path = require('path');

describe('migration 20261020120000_board_messages', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../../supabase/migrations/20261020120000_board_messages.sql'),
    'utf8',
  );

  it('creates the chat log with the board columns and a 4000-char body', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.board_messages/);
    expect(sql).toMatch(/sender_type text NOT NULL CHECK \(sender_type IN \('human', 'agent'\)\)/);
    expect(sql).toMatch(/channel text NOT NULL DEFAULT 'general'/);
    expect(sql).toMatch(/char_length\(body\) BETWEEN 1 AND 4000/);
    expect(sql).toMatch(/reply_to uuid/);
    expect(sql).toMatch(/mentions text\[\]/);
  });

  it('keeps board messages out of the executable task bus', () => {
    expect(sql).not.toMatch(/INSERT INTO\s+agent_bus/i);
    expect(sql).toMatch(/never be inserted there/);
  });

  it('enables RLS and grants nothing to anon or authenticated', () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/TO service_role/);
    expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/TO anon/);
    expect(sql).not.toMatch(/TO authenticated/);
    expect(sql).not.toMatch(/TO public/);
  });
});
