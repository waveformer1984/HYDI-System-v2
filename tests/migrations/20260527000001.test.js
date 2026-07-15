'use strict';
const { readMigration } = require('./helpers');

describe('20260527000001_infrastructure_health_table', () => {
  let sql;
  beforeAll(() => {
    sql = readMigration('20260527000001_infrastructure_health_table.sql').toLowerCase();
  });

  test('creates infrastructure_health table', () => {
    expect(sql).toContain('create table');
    expect(sql).toContain('infrastructure_health');
  });

  test('has singleton primary key', () => {
    expect(sql).toContain("primary key");
    expect(sql).toContain("'singleton'");
  });

  test('has overall, power, thermal, scaffold, revenue columns', () => {
    expect(sql).toContain('overall');
    expect(sql).toContain('power');
    expect(sql).toContain('thermal');
    expect(sql).toContain('scaffold');
    expect(sql).toContain('revenue');
  });

  test('has efficiency numeric column', () => {
    expect(sql).toContain('efficiency');
    expect(sql).toContain('numeric');
  });

  test('has updated_at timestamptz column', () => {
    expect(sql).toContain('updated_at');
    expect(sql).toContain('timestamptz');
  });

  test('enables RLS', () => {
    expect(sql).toContain('enable row level security');
  });

  test('seeds singleton row', () => {
    expect(sql).toContain('insert into infrastructure_health');
    expect(sql).toContain('on conflict');
    expect(sql).toContain('do nothing');
  });
});
