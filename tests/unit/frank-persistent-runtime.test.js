'use strict';

const fs = require('fs');
const path = require('path');
const ecosystem = require('../../ecosystem.config');
const {
  MIGRATIONS,
  applyExecutionFabricMigrations,
} = require('../../scripts/apply-execution-fabric-migrations');
const {
  verifyFabricRestart,
} = require('../../scripts/verify-execution-fabric-restart');

const ROOT = path.resolve(__dirname, '../..');

describe('Frank execution-fabric persistence setup', () => {
  it('applies the fixed idempotent migration set transactionally', async () => {
    const queries = [];
    const pool = {
      query: jest.fn(async (sql) => {
        queries.push(sql);
        if (String(sql).startsWith('SELECT to_regclass')) {
          return { rows: [{ tasks: true, observations: true }] };
        }
        return { rows: [] };
      }),
    };
    const result = await applyExecutionFabricMigrations({ pool, root: ROOT });
    expect(result).toEqual({ ok: true, applied: [...MIGRATIONS] });
    expect(queries.filter((sql) => sql === 'BEGIN')).toHaveLength(3);
    expect(queries.filter((sql) => sql === 'COMMIT')).toHaveLength(3);
    expect(queries.join('\n')).toMatch(/CREATE TABLE IF NOT EXISTS public\.execution_fabric_tasks/);
    expect(queries.join('\n')).toMatch(/ADD COLUMN IF NOT EXISTS correlation_id/);
    expect(queries.join('\n')).toMatch(/ADD COLUMN IF NOT EXISTS tenant_id/);
  });

  it('rolls back the migration transaction on failure', async () => {
    const queries = [];
    const pool = {
      query: jest.fn(async (sql) => {
        queries.push(sql);
        if (String(sql).includes('CREATE TABLE IF NOT EXISTS')) throw new Error('db failed');
        return { rows: [] };
      }),
    };
    await expect(applyExecutionFabricMigrations({ pool, root: ROOT })).rejects.toThrow('db failed');
    expect(queries).toEqual(['BEGIN', expect.stringContaining('CREATE TABLE IF NOT EXISTS'), 'ROLLBACK']);
  });

  it('creates an unapproved proof task and finds it after the web restart', async () => {
    const task = { id: '671cbabdb448ff6e21509e9d', state: 'AWAITING_APPROVAL' };
    const calls = [];
    const fetchFn = jest.fn(async (url, options = {}) => {
      calls.push({ url, options });
      let body;
      if (url.includes('readiness=1')) body = { persistence_mode: 'postgres' };
      else if (options.method === 'POST') body = { task };
      else body = { ok: true, task };
      return { ok: true, status: options.method === 'POST' ? 202 : 200, json: async () => body };
    });
    const restart = jest.fn(async () => {});
    const wait = jest.fn(async () => true);
    const result = await verifyFabricRestart({
      secret: 'test-service-secret',
      fetchFn,
      restart,
      wait,
    });
    expect(result).toEqual({ ok: true, task_id: task.id, state: 'AWAITING_APPROVAL' });
    expect(restart).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledTimes(1);
    const submitted = JSON.parse(calls.find((call) => call.options.method === 'POST').options.body);
    expect(submitted.confirm).toBe(false);
    expect(submitted.capability).toBe('board.request');
    expect(calls.some((call) => /approve|cancel/.test(call.url))).toBe(false);
  });

  it('declares persistent heidi-web and the PowerShell-compatible heidi-core command', () => {
    const web = ecosystem.apps.find((app) => app.name === 'heidi-web-standalone');
    expect(web.env.EXECUTION_FABRIC_PERSIST).toBe('postgres');
    expect(web.env_production.EXECUTION_FABRIC_PERSIST).toBe('postgres');

    const core = ecosystem.apps.filter((app) => app.name === 'heidi-core');
    expect(core).toHaveLength(1);
    expect(core[0]).toMatchObject({
      script: 'server.js',
      cwd: path.join(ROOT, 'heidi-core'),
      instances: 1,
      exec_mode: 'fork',
    });
    expect(core[0].env).toMatchObject({
      HEIDI_PORT: '3459',
      HEIDI_ALLOW_EXEC: 'false',
    });
  });

  it('records heidi-core runtime provenance for commit verification', () => {
    const source = fs.readFileSync(path.join(ROOT, 'heidi-core/server.js'), 'utf8');
    expect(source).toContain("recordProcessProvenance('heidi-core'");
    expect(source).toContain("require('path').resolve(__dirname, '..')");
  });
});
