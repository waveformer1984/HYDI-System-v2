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
