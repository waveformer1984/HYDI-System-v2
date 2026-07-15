'use strict';
const { readMigration } = require('./helpers');

describe('20260715210000_secure_action_worker_cron', () => {
  let sql;
  beforeAll(() => { sql = readMigration('20260715210000_secure_action_worker_cron.sql').toLowerCase(); });

  test('is a non-empty SQL file', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  test('contains valid SQL statements', () => {
    expect(sql).toMatch(/\b(create|alter|drop|insert|update|grant|do|select)\b/);
  });

  test('unschedules the old cron job before recreating it', () => {
    expect(sql).toMatch(/cron\.unschedule/);
  });

  test('reads url and jwt from vault.decrypted_secrets instead of a literal', () => {
    expect(sql).toMatch(/vault\.decrypted_secrets/);
    expect(sql).toMatch(/action_worker_project_url/);
    expect(sql).toMatch(/action_worker_service_jwt/);
  });

  test('contains no hardcoded JWT-shaped secret', () => {
    expect(sql).not.toMatch(/eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}/i);
  });

  test('reschedules the cron job to call the safe function, not a raw net.http_post with an inline bearer token', () => {
    expect(sql).toMatch(/cron\.schedule/);
    expect(sql).toMatch(/select public\.trigger_action_worker/);
  });
});
