'use strict';

const { readMigration } = require('./helpers');

const SQL = readMigration('20261120210000_makeready_crew.sql');

describe('Migration 20261120210000 — makeready_crew', () => {
  it('extends makeready_requests with crew workflow columns', () => {
    expect(SQL).toMatch(/ALTER TABLE public\.makeready_requests/);
    expect(SQL).toMatch(/crew_status TEXT NOT NULL DEFAULT 'new'/);
    expect(SQL).toMatch(/CHECK \(crew_status IN/);
    expect(SQL).toMatch(/scheduled_at/);
    expect(SQL).toMatch(/crew_label/);
    expect(SQL).toMatch(/crew_notes/);
    expect(SQL).toMatch(/completion_photos/);
    expect(SQL).toMatch(/completed_at/);
    expect(SQL).toMatch(/status_updated_at/);
    expect(SQL).toMatch(/makeready_requests_crew_status_idx/);
  });

  it('does not alter hydi_runs state machine', () => {
    expect(SQL).not.toMatch(/hydi_allowed_transitions/);
    expect(SQL).not.toMatch(/hydi_phase/);
    expect(SQL).not.toMatch(/hydi_status/);
  });
});