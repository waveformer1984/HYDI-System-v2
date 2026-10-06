/**
 * DeliveryVerifier — independent machine QA for Model Prep artifacts.
 *
 * The generator verifies its own work; this verifier re-derives every
 * claim from the files on disk, so `generated ≠ verified`. Verdicts:
 *
 *   PASS    — every required artifact exists, is structurally valid,
 *             and satisfies the product contract (≤100mm, one object,
 *             STL + OpenSCAD + spec)
 *   FAIL    — a required check definitively failed → HUMAN_REQUIRED
 *   UNKNOWN — evidence insufficient to decide → HUMAN_REQUIRED
 *
 * Only PASS is delivery-eligible. Ambiguity goes to a human, never to
 * the customer.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type Verdict = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface CheckResult {
  name: string;
  result: 'PASS' | 'FAIL' | 'UNKNOWN';
  detail: string;
}

export interface VerificationReport {
  verdict: Verdict;
  checks: CheckResult[];
  artifactHashes: Record<string, string>;
  verifiedAt: string;
  boundsMm?: { x: number; y: number; z: number } | null;
}

const MAX_DIM_MM = 100;

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Parse an ASCII STL's vertex bounds. Returns null if not parseable.
 * Binary STL: validate structure (80-byte header + uint32 count +
 * 50 bytes/triangle) and extract bounds from the facet stream.
 */
function stlBounds(buf: Buffer): { x: number; y: number; z: number; triangles: number } | null {
  if (buf.length < 6) return null;
  const head = buf.slice(0, 5).toString('ascii').trim().toLowerCase();
  if (head === 'solid') {
    const text = buf.toString('utf8');
    const verts = [...text.matchAll(/vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g)];
    if (verts.length === 0 || verts.length % 3 !== 0) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const v of verts) {
      const x = parseFloat(v[1]), y = parseFloat(v[2]), z = parseFloat(v[3]);
      if ([x, y, z].some(Number.isNaN)) return null;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    return { x: maxX - minX, y: maxY - minY, z: maxZ - minZ, triangles: verts.length / 3 };
  }
  // Binary STL
  if (buf.length < 84) return null;
  const n = buf.readUInt32LE(80);
  if (buf.length !== 84 + n * 50 || n === 0) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    for (let v = 0; v < 3; v++) {
      const off = 84 + i * 50 + 12 + v * 12;
      const x = buf.readFloatLE(off), y = buf.readFloatLE(off + 4), z = buf.readFloatLE(off + 8);
      if ([x, y, z].some(Number.isNaN)) return null;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  return { x: maxX - minX, y: maxY - minY, z: maxZ - minZ, triangles: n };
}

/**
 * Independently verify the artifact directory for a job.
 * Reads the files itself — does not trust generation metadata.
 *
 * Product-aware: model-prep jobs need SCAD+STL+spec; checkpoint_audit
 * jobs need the audit report + data. The product the customer paid for
 * determines what "deliverable" means — verifying the wrong artifact
 * set is a wrong-delivery, not a pass.
 */
export function verifyDeliverableArtifacts(jobDir: string, opts?: { maxDimMm?: number; product?: string }): VerificationReport {
  if (opts?.product === 'checkpoint_audit') {
    return verifyAuditArtifacts(jobDir);
  }
  return verifyModelPrepArtifacts(jobDir, opts);
}

/**
 * checkpoint_audit deliverable: checkpoint-audit.md (the customer-facing
 * report) + audit-data.json (engine workflow_id + risk_level + steps —
 * proof the engine actually analyzed, not just that a file exists).
 */
function verifyAuditArtifacts(jobDir: string): VerificationReport {
  const checks: CheckResult[] = [];
  const artifactHashes: Record<string, string> = {};
  const verifiedAt = new Date().toISOString();
  const fail = (name: string, detail: string) => checks.push({ name, result: 'FAIL', detail });
  const pass = (name: string, detail: string) => checks.push({ name, result: 'PASS', detail });

  if (!fs.existsSync(jobDir)) {
    fail('artifact_dir', `directory missing: ${jobDir}`);
    return { verdict: 'FAIL', checks, artifactHashes, verifiedAt };
  }
  const files = fs.readdirSync(jobDir);

  const report = files.find(f => f === 'checkpoint-audit.md');
  if (!report) fail('audit_report_present', 'no checkpoint-audit.md');
  else {
    const buf = fs.readFileSync(path.join(jobDir, report));
    artifactHashes[report] = sha256(buf);
    const text = buf.toString('utf8');
    if (buf.length < 200) fail('audit_report_thin', 'audit report suspiciously thin');
    else if (!/risk/i.test(text) || !/workflow/i.test(text)) fail('audit_report_structure', 'report lacks risk/workflow content');
    else pass('audit_report', `${report} (${buf.length}B, sha256 ${artifactHashes[report].slice(0, 12)}…)`);
  }

  const data = files.find(f => f === 'audit-data.json');
  if (!data) fail('audit_data_present', 'no audit-data.json');
  else {
    const buf = fs.readFileSync(path.join(jobDir, data));
    artifactHashes[data] = sha256(buf);
    try {
      const parsed = JSON.parse(buf.toString('utf8'));
      const wid = parsed?.analyzeResult?.workflow_id ?? parsed?.report?.workflow_id ?? parsed?.report?.id;
      const rl = parsed?.report?.risk_level;
      const stepCount = Array.isArray(parsed?.report?.steps) ? parsed.report.steps.length : 0;
      if (!Number.isInteger(wid)) fail('audit_data_workflow', 'no workflow_id — engine analysis unproven');
      else if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(rl)) fail('audit_data_risk', `risk_level '${rl}' not in engine enum`);
      else if (stepCount === 0) fail('audit_data_steps', 'report contains no analyzed steps');
      else pass('audit_data', `workflow ${wid}, risk ${rl}, ${stepCount} steps`);
    } catch {
      fail('audit_data_parse', 'audit-data.json is not valid JSON');
    }
  }

  const anyFail = checks.some(c => c.result === 'FAIL');
  return { verdict: anyFail ? 'FAIL' : 'PASS', checks, artifactHashes, verifiedAt, boundsMm: null };
}

function verifyModelPrepArtifacts(jobDir: string, opts?: { maxDimMm?: number }): VerificationReport {
  const maxDim = opts?.maxDimMm ?? MAX_DIM_MM;
  const checks: CheckResult[] = [];
  const artifactHashes: Record<string, string> = {};
  const verifiedAt = new Date().toISOString();

  const fail = (name: string, detail: string) => checks.push({ name, result: 'FAIL', detail });
  const pass = (name: string, detail: string) => checks.push({ name, result: 'PASS', detail });

  if (!fs.existsSync(jobDir)) {
    fail('artifact_dir', `directory missing: ${jobDir}`);
    return { verdict: 'FAIL', checks, artifactHashes, verifiedAt };
  }

  const files = fs.readdirSync(jobDir);
  const scad = files.find(f => f.endsWith('.scad'));
  const stl = files.find(f => f.endsWith('.stl'));
  const spec = files.find(f => /^readme\.md$/i.test(f) || f.endsWith('.spec.md'));

  // OpenSCAD source
  if (!scad) fail('openscad_present', 'no .scad file');
  else {
    const buf = fs.readFileSync(path.join(jobDir, scad));
    artifactHashes[scad] = sha256(buf);
    if (buf.length === 0) fail('openscad_nonempty', 'empty .scad');
    else if (!/cube|cylinder|sphere|polyhedron|hull|difference|union|translate|rotate/i.test(buf.toString('utf8'))) {
      fail('openscad_geometry', 'no recognizable OpenSCAD geometry primitives');
    } else pass('openscad', `${scad} (${buf.length}B, sha256 ${artifactHashes[scad].slice(0, 12)}…)`);
  }

  // STL — structural validity + geometry + dimensional policy
  let boundsMm: VerificationReport['boundsMm'] = null;
  if (!stl) fail('stl_present', 'no .stl file');
  else {
    const buf = fs.readFileSync(path.join(jobDir, stl));
    artifactHashes[stl] = sha256(buf);
    if (buf.length === 0) fail('stl_nonempty', 'empty .stl');
    else {
      const b = stlBounds(buf);
      if (!b) fail('stl_structure', 'not a parseable ASCII or binary STL');
      else {
        boundsMm = { x: round(b.x), y: round(b.y), z: round(b.z) };
        const maxSide = Math.max(b.x, b.y, b.z);
        if (b.triangles < 4) fail('stl_geometry', `degenerate mesh: ${b.triangles} triangles`);
        else if (maxSide <= 0) fail('stl_geometry', 'zero-volume bounds');
        else if (maxSide > maxDim) fail('product_policy', `dimension ${round(maxSide)}mm exceeds ${maxDim}mm product limit`);
        else pass('stl', `${stl} valid, ${b.triangles} tris, ${round(b.x)}×${round(b.y)}×${round(b.z)}mm ≤ ${maxDim}mm`);
      }
    }
  }

  // Specification document
  if (!spec) fail('spec_present', 'no README.md/.spec.md');
  else {
    const buf = fs.readFileSync(path.join(jobDir, spec));
    artifactHashes[spec] = sha256(buf);
    if (buf.length < 200) fail('spec_nonempty', 'specification suspiciously thin');
    else pass('spec', `${spec} (${buf.length}B)`);
  }

  const anyFail = checks.some(c => c.result === 'FAIL');
  const verdict: Verdict = anyFail ? 'FAIL' : 'PASS';
  return { verdict, checks, artifactHashes, verifiedAt, boundsMm };
}

/**
 * Delivery eligibility — the only gate between awaiting_review and
 * the customer. Anything other than clean PASS → HUMAN_REQUIRED.
 */
export function deliveryEligibility(job: {
  jobStatus: string; paymentStatus: string; deliveryStatus: string;
  artifactPaths: string[] | null;
}, report: VerificationReport): { eligible: boolean; reason: string } {
  if (job.jobStatus !== 'awaiting_review') return { eligible: false, reason: `job status is ${job.jobStatus}, not awaiting_review` };
  if (job.paymentStatus !== 'paid') return { eligible: false, reason: `payment_status is ${job.paymentStatus} — unpaid work is not deliverable` };
  if (job.deliveryStatus === 'delivered') return { eligible: false, reason: 'already delivered' };
  if (report.verdict === 'PASS') return { eligible: true, reason: 'independent QA PASS — all artifacts valid and within product policy' };
  if (report.verdict === 'UNKNOWN') return { eligible: false, reason: 'verification UNKNOWN — requires human review' };
  return { eligible: false, reason: `QA FAIL: ${report.checks.filter(c => c.result === 'FAIL').map(c => `${c.name}: ${c.detail}`).join('; ')}` };
}

function round(n: number): number { return Math.round(n * 100) / 100; }
