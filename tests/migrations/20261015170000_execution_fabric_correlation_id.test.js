'use strict';

const fs = require('fs');
const path = require('path');

describe('migration 20261015170000_execution_fabric_correlation_id', () => {
  it('adds correlation_id to execution_fabric_tasks', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '../../supabase/migrations/20261015170000_execution_fabric_correlation_id.sql'),
      'utf8',
    );
    expect(sql).toMatch(/correlation_id/);
    expect(sql).toMatch(/execution_fabric_tasks/);
  });
});
