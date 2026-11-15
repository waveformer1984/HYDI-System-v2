'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { validatePrivateProfilePath, redactProfileForLogs } = require('../../lib/partnerships-funding/profile-validator');

describe('private org profile validator', () => {
  test('redacts sensitive fields for logs', () => {
    const safe = redactProfileForLogs({ legal: { business_email: 'secret@test.com' } });
    expect(safe.legal.business_email).toBe('[REDACTED]');
  });

  test('rejects template path inside repo', () => {
    const r = validatePrivateProfilePath(path.join(process.cwd(), 'docs/partnerships/organization-profile.template.json'));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('refused_committed_template_path');
  });

  test('validates approved profile outside docs path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prof-'));
    const file = path.join(dir, 'org.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        approved_by_owner: true,
        owner_approval_record: { approved_by: 'human:owner', approved_at: '2026-01-01T00:00:00.000Z', method: 'offline' },
        legal: { entity_name: 'Test LLC', business_email: 'a@b.com' },
        classification: { structure: 'company' },
        funding: {},
        product: {},
        goals: { requested_support: [] },
        sharing: {},
      }),
    );
    const v = validatePrivateProfilePath(file);
    expect(v.ok).toBe(true);
    expect(v.log_safe.legal.business_email).toBe('[REDACTED]');
  });
});