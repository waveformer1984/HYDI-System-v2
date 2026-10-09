import fs from 'fs';
import os from 'os';
import path from 'path';
import { verifyDeliverableArtifacts, deliveryEligibility } from '../../lib/revenue/DeliveryVerifier';

function mkJobDir(files: Record<string, string | Buffer>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

const GOOD_SCAD = 'module box(){ cube([40,30,20]); } box();';
const GOOD_STL = [
  'solid test',
  ...Array.from({ length: 12 }, () =>
    'facet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 40 0 0\nvertex 0 30 0\nendloop\nendfacet\n'),
  'endsolid test',
].join('\n');
const GOOD_SPEC = '# Specification\n' + 'dimensions and print settings '.repeat(20);

const PAID_JOB = { jobStatus: 'awaiting_review', paymentStatus: 'paid', deliveryStatus: 'pending', artifactPaths: [] as string[] };

describe('DeliveryVerifier — artifact QA', () => {
  test('PASSes a complete valid artifact set', () => {
    const r = verifyDeliverableArtifacts(mkJobDir({ 'part.scad': GOOD_SCAD, 'part.stl': GOOD_STL, 'README.md': GOOD_SPEC }));
    expect(r.verdict).toBe('PASS');
    expect(Object.keys(r.artifactHashes).length).toBe(3);
    expect(r.boundsMm?.x).toBeLessThanOrEqual(100);
  });
  test('FAILs when STL is missing', () => {
    const r = verifyDeliverableArtifacts(mkJobDir({ 'part.scad': GOOD_SCAD, 'README.md': GOOD_SPEC }));
    expect(r.verdict).toBe('FAIL');
    expect(r.checks.some(c => c.name === 'stl_present')).toBe(true);
  });
  test('FAILs when OpenSCAD is missing', () => {
    const r = verifyDeliverableArtifacts(mkJobDir({ 'part.stl': GOOD_STL, 'README.md': GOOD_SPEC }));
    expect(r.verdict).toBe('FAIL');
  });
  test('FAILs on empty STL', () => {
    const r = verifyDeliverableArtifacts(mkJobDir({ 'part.scad': GOOD_SCAD, 'part.stl': '', 'README.md': GOOD_SPEC }));
    expect(r.verdict).toBe('FAIL');
  });
  test('FAILs on oversized geometry (product policy)', () => {
    const big = 'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 300 0 0\nvertex 0 300 0\nendloop\nendfacet\n'.repeat(4) + 'endsolid t';
    const r = verifyDeliverableArtifacts(mkJobDir({ 'part.scad': GOOD_SCAD, 'part.stl': big, 'README.md': GOOD_SPEC }));
    expect(r.verdict).toBe('FAIL');
    expect(r.checks.some(c => c.name === 'product_policy')).toBe(true);
  });
  test('FAILs on non-parseable STL', () => {
    const r = verifyDeliverableArtifacts(mkJobDir({ 'part.scad': GOOD_SCAD, 'part.stl': 'not an stl at all just text', 'README.md': GOOD_SPEC }));
    expect(r.verdict).toBe('FAIL');
  });
});

const GOOD_AUDIT_MD = '# Checkpoint Workflow Audit\n' + 'workflow risk analysis findings and recommendations '.repeat(10);
const GOOD_AUDIT_DATA = JSON.stringify({
  analyzeResult: { workflow_id: 42 },
  report: { risk_level: 'HIGH', steps: [{ number: 1, name: 'wiring', risk: 8 }] },
});

describe('DeliveryVerifier — checkpoint_audit QA', () => {
  const opts = { product: 'checkpoint_audit' };
  test('PASSes a complete engine-backed audit', () => {
    const r = verifyDeliverableArtifacts(mkJobDir({ 'checkpoint-audit.md': GOOD_AUDIT_MD, 'audit-data.json': GOOD_AUDIT_DATA }), opts);
    expect(r.verdict).toBe('PASS');
    expect(Object.keys(r.artifactHashes).length).toBe(2);
  });
  test('FAILs when the audit report is missing', () => {
    const r = verifyDeliverableArtifacts(mkJobDir({ 'audit-data.json': GOOD_AUDIT_DATA }), opts);
    expect(r.verdict).toBe('FAIL');
    expect(r.checks.some(c => c.name === 'audit_report_present')).toBe(true);
  });
  test('FAILs on a thin report — existence is not enough', () => {
    const r = verifyDeliverableArtifacts(mkJobDir({ 'checkpoint-audit.md': 'risk workflow', 'audit-data.json': GOOD_AUDIT_DATA }), opts);
    expect(r.verdict).toBe('FAIL');
    expect(r.checks.some(c => c.name === 'audit_report_thin')).toBe(true);
  });
  test('FAILs without an engine workflow_id — analysis unproven', () => {
    const data = JSON.stringify({ report: { risk_level: 'HIGH', steps: [{ name: 'x' }] } });
    const r = verifyDeliverableArtifacts(mkJobDir({ 'checkpoint-audit.md': GOOD_AUDIT_MD, 'audit-data.json': data }), opts);
    expect(r.verdict).toBe('FAIL');
    expect(r.checks.some(c => c.name === 'audit_data_workflow')).toBe(true);
  });
  test('FAILs on a risk_level outside the engine enum', () => {
    const data = JSON.stringify({ analyzeResult: { workflow_id: 7 }, report: { risk_level: 'SPICY', steps: [{ name: 'x' }] } });
    const r = verifyDeliverableArtifacts(mkJobDir({ 'checkpoint-audit.md': GOOD_AUDIT_MD, 'audit-data.json': data }), opts);
    expect(r.verdict).toBe('FAIL');
    expect(r.checks.some(c => c.name === 'audit_data_risk')).toBe(true);
  });
  test('FAILs when no steps were analyzed', () => {
    const data = JSON.stringify({ analyzeResult: { workflow_id: 7 }, report: { risk_level: 'LOW', steps: [] } });
    const r = verifyDeliverableArtifacts(mkJobDir({ 'checkpoint-audit.md': GOOD_AUDIT_MD, 'audit-data.json': data }), opts);
    expect(r.verdict).toBe('FAIL');
    expect(r.checks.some(c => c.name === 'audit_data_steps')).toBe(true);
  });
  test('FAILs on unparseable audit data', () => {
    const r = verifyDeliverableArtifacts(mkJobDir({ 'checkpoint-audit.md': GOOD_AUDIT_MD, 'audit-data.json': '{nope' }), opts);
    expect(r.verdict).toBe('FAIL');
    expect(r.checks.some(c => c.name === 'audit_data_parse')).toBe(true);
  });
});

describe('deliveryEligibility — gate', () => {
  const passReport = { verdict: 'PASS' as const, checks: [], artifactHashes: {}, verifiedAt: '' };
  test('rejects unpaid jobs — no revenue, no delivery', () => {
    const r = deliveryEligibility({ ...PAID_JOB, paymentStatus: 'unpaid' }, passReport);
    expect(r.eligible).toBe(false);
  });
  test('rejects already-delivered jobs', () => {
    const r = deliveryEligibility({ ...PAID_JOB, deliveryStatus: 'delivered' }, passReport);
    expect(r.eligible).toBe(false);
  });
  test('rejects wrong job status', () => {
    const r = deliveryEligibility({ ...PAID_JOB, jobStatus: 'failed' }, passReport);
    expect(r.eligible).toBe(false);
  });
  test('rejects UNKNOWN verification', () => {
    const r = deliveryEligibility(PAID_JOB, { ...passReport, verdict: 'UNKNOWN' });
    expect(r.eligible).toBe(false);
  });
  test('accepts paid + PASS', () => {
    const r = deliveryEligibility(PAID_JOB, passReport);
    expect(r.eligible).toBe(true);
  });
});
