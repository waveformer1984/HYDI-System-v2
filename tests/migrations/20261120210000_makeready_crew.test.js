'use strict';

const { readMigration } = require('./helpers');

const SQL = readMigration('20261120210000_makeready_crew.sql');

describe('Migration 20261120210000 — makeready_crew', () => {
  it('adds crew workflow columns', () => {
    expect(SQL).toMatch(/crew_status/);
    expect(SQL).toMatch(/scheduled_at/);
    expect(SQL).toMatch(/crew_label/);
    expect(SQL).toMatch(/completion_photos/);
    expect(SQL).toMatch(/makeready_requests_crew_status_idx/);
  });
});