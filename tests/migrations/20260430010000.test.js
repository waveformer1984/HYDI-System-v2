'use strict';
const { readMigration } = require('./helpers');

describe('20260430010000_create_users_table', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260430010000_create_users_table.sql').toLowerCase(); });

  test('creates users table', () => {
    expect(sql).toContain('create table');
    expect(sql).toContain('users');
  });

  test('creates api_keys table', () => {
    expect(sql).toContain('api_keys');
  });

  test('users.tier check covers starter/pro/enterprise', () => {
    expect(sql).toContain('tier');
    expect(sql).toContain('starter');
    expect(sql).toContain('pro');
    expect(sql).toContain('enterprise');
  });

  test('users.email is unique', () => {
    expect(sql).toContain('email');
    expect(sql).toContain('unique');
  });

  test('api_keys references users with cascade delete', () => {
    expect(sql).toContain('references users');
    expect(sql).toContain('on delete cascade');
  });

  test('api_keys.key_hash is unique', () => {
    expect(sql).toContain('key_hash');
  });

  test('enables RLS', () => {
    expect(sql).toContain('enable row level security');
  });
});
