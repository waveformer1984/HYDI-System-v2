// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { readScout, setDecision, isValidLeadId } from './job-scout-store';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ursula-scout-'));
}

describe('job scout store (Ursula side)', () => {
  it('returns an empty feed when the scout has not run', () => {
    expect(readScout(tmp())).toEqual({ status: null, leads: [] });
  });

  it('merges decisions into leads without touching leads.json', () => {
    const dir = tmp();
    const leads = { leads: [{ id: 'hn:1', title: 'a', score: 70 }, { id: 'freelancer:2', title: 'b', score: 50 }] };
    fs.writeFileSync(path.join(dir, 'leads.json'), JSON.stringify(leads));
    setDecision('hn:1', 'shortlisted', dir, new Date('2026-11-13T00:00:00Z'));
    const out = readScout(dir);
    expect(out.leads[0].decision).toEqual({ status: 'shortlisted', at: '2026-11-13T00:00:00.000Z' });
    expect(out.leads[1].decision).toBeNull();
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'leads.json'), 'utf8'))).toEqual(leads);
  });

  it('clear removes a decision', () => {
    const dir = tmp();
    setDecision('hn:1', 'dismissed', dir);
    setDecision('hn:1', 'clear', dir);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'decisions.json'), 'utf8'))).toEqual({});
  });

  it('rejects bad ids and statuses', () => {
    expect(isValidLeadId('hn:123')).toBe(true);
    expect(isValidLeadId('../etc:passwd')).toBe(false);
    expect(() => setDecision('hn:1', 'won' as unknown as 'applied', tmp())).toThrow(/invalid status/);
    expect(() => setDecision('x', 'applied', tmp())).toThrow(/invalid lead id/);
  });
});
