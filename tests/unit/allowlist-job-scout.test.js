'use strict';

const path = require('path');
const { build } = require('../../heidi-core/approvals/allowlist');
const lifecycle = require('../../heidi-core/missions/lifecycle');

describe('allowlist job_scout_scan', () => {
  it('builds a bounded run_script action with 4-minute timeout', () => {
    const b = build('job_scout_scan', {});
    expect(b.ok).toBe(true);
    expect(b.action.type).toBe('run_script');
    expect(b.action.args).toEqual(['--once']);
    expect(b.action.timeout_ms).toBe(240000);
    expect(path.basename(b.action.target)).toBe('job-scout.js');
  });

  it('needs no human approval (standing approval policy)', () => {
    const b = build('job_scout_scan', {});
    const policy = lifecycle.approvalPolicy(b.action);
    expect(policy.required).toBe(false);
    expect(policy.reason).toMatch(/job-scout/);
  });
});
