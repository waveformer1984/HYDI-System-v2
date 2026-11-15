'use strict';

const {
  proposedDispatcherDecision,
  MIGRATION_SURFACE,
} = require('../../lib/heidi/inference-dispatch-proposal');

describe('inference dispatch proposal (no execution change)', () => {
  test('migration surface documents compatibility and rollback', () => {
    const d = proposedDispatcherDecision(MIGRATION_SURFACE);
    expect(d.execution_changed).toBe(false);
    expect(d.in_migration_scope).toBe(true);
    expect(d.would_dispatch_to.route).toBe('POST /chat-tools');
    expect(d.rollback).toMatch(/no-op|DISPATCH_PROPOSAL|shim/i);
  });

  test('out-of-scope surfaces unchanged', () => {
    const d = proposedDispatcherDecision('other');
    expect(d.in_migration_scope).toBe(false);
    expect(d.execution_changed).toBe(false);
  });
});