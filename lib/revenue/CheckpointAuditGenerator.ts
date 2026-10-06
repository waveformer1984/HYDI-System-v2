/**
 * Checkpoint Audit Generator — fulfillment for the checkpoint_audit offer.
 *
 * The customer supplies a workflow (steps); the Ursula Checkpoint engine
 * performs the real analysis; this generator turns the verified engine
 * output into the deliverable package:
 *
 *   checkpoint-audit.md  — human-readable audit report
 *   audit-data.json      — machine-readable engine response + input echo
 *
 * Fail-closed: an engine error fails the job — a checkpoint audit that
 * never ran must never produce an artifact. No fabricated findings.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { ArtifactResult } from './ModelArtifactGenerator';

export interface CheckpointAuditInput {
  jobId: string;
  requestText: string;
  requirements: {
    steps?: Array<Record<string, unknown> | string>;
    workflowName?: string;
    category?: string;
    projectId?: number;
  };
  outputDir: string;
}

export interface CheckpointAuditOutput {
  artifacts: ArtifactResult[];
  workflowId: number;
  riskLevel: string;
  failurePoints: number;
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function writeArtifact(outputDir: string, filename: string, content: string, metadata: Record<string, unknown>): ArtifactResult {
  const p = path.join(outputDir, filename);
  const buf = Buffer.from(content, 'utf8');
  fs.writeFileSync(p, buf);
  return { path: p, filename, sizeBytes: buf.length, sha256: sha256(buf), metadata };
}

/**
 * Normalize customer input into engine step objects. requirements.steps
 * wins; otherwise requestText is split into coarse step objects. A job
 * with no describable steps is refused — a fabricated empty audit is a
 * fabricated deliverable.
 */
function normalizeSteps(input: CheckpointAuditInput): Array<{ name: string } & Record<string, unknown>> {
  const reqSteps = input.requirements?.steps;
  if (Array.isArray(reqSteps) && reqSteps.length > 0) {
    return reqSteps.map((s) => (typeof s === 'string' ? { name: s } : { name: String(s.name ?? s.title ?? 'step'), ...s }));
  }
  const parts = String(input.requestText || '')
    .split(/[\n;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
  if (parts.length === 0) throw new Error('no workflow steps could be derived from the job request — audit requires customer workflow input');
  return parts.map((name) => ({ name }));
}

/** Render the engine report into the customer-facing audit document. */
function renderAuditMarkdown(jobId: string, requestText: string, report: Record<string, unknown>): string {
  const steps = Array.isArray(report.steps) ? report.steps as Array<Record<string, unknown>> : [];
  const checkpoints = Array.isArray(report.checkpoints) ? report.checkpoints as Array<Record<string, unknown>> : [];
  const lines = [
    `# Checkpoint Workflow Audit`,
    ``,
    `Job: ${jobId}`,
    `Workflow: ${String(report.workflow_name ?? 'Untitled')}`,
    `Category: ${String(report.category ?? 'general')}`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `## Risk Summary`,
    ``,
    `- Overall risk level: **${String(report.risk_level ?? 'UNKNOWN')}**`,
    `- Steps analyzed: ${String(report.total_steps ?? steps.length)}`,
    `- Failure points detected: ${String(report.failure_points ?? 0)}`,
    `- Checkpoints required: ${String(report.checkpoints_required ?? 0)}`,
    ``,
    `## Customer Request`,
    ``,
    `\`\`\``,
    requestText.trim().slice(0, 4000),
    `\`\`\``,
    ``,
    `## Workflow Map`,
    ``,
  ];
  for (const s of steps) {
    lines.push(`${String(s.number ?? '?')}. **${String(s.name ?? 'step')}** — risk ${String(s.risk ?? '?')}/10`);
  }
  lines.push('', '## Failure Points', '');
  const fps = (report.failure_point_details && Array.isArray(report.failure_point_details))
    ? report.failure_point_details as Array<Record<string, unknown>>
    : checkpoints;
  if (fps.length === 0) {
    lines.push('No discrete failure points detected above the engine threshold.');
  }
  for (const f of fps) {
    lines.push(`- ${String(f.description ?? f.message ?? f.name ?? JSON.stringify(f))}`);
  }
  lines.push(
    '',
    '## Recommendations',
    '',
    checkpoints.length === 0
      ? '- No mandatory checkpoints; review steps scoring ≥ 6/10 for manual review points.'
      : checkpoints.map((c) => `- ${String(c.description ?? c.mitigation ?? JSON.stringify(c))}`).join('\n'),
    '',
    '---',
    `Produced by Checkpoint (Ursula engine) workflow ${String(report.workflow_id ?? report.id ?? 'n/a')} — findings are engine-derived, not LLM-generated.`,
  );
  return lines.join('\n');
}

/**
 * Generate the audit package: analyze via the live engine, fetch the full
 * report, write both artifacts.
 */
export async function generateCheckpointAudit(input: CheckpointAuditInput): Promise<CheckpointAuditOutput> {
  const { jobId, requestText, requirements, outputDir } = input;
  fs.mkdirSync(outputDir, { recursive: true });

  const steps = normalizeSteps(input);
  const base = (process.env.URSULA_ENGINE_URL || 'http://localhost:5000').replace(/\/+$/, '');

  const analyzeRes = await fetch(`${base}/checkpoint/workflow/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: requirements?.projectId ?? 0,
      name: requirements?.workflowName || `job-${jobId}`,
      category: requirements?.category || 'general',
      steps,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!analyzeRes.ok) {
    const body = await analyzeRes.text().catch(() => '');
    throw new Error(`checkpoint analyze failed: HTTP ${analyzeRes.status} ${body.slice(0, 200)}`);
  }
  const analyzed = await analyzeRes.json() as { workflow_id?: number; risk_level?: string; failure_points?: number };
  const workflowId = analyzed.workflow_id;
  if (typeof workflowId !== 'number' || !Number.isInteger(workflowId)) {
    throw new Error('checkpoint analyze returned no workflow_id — audit did not persist');
  }

  const reportRes = await fetch(`${base}/checkpoint/workflow/${workflowId}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!reportRes.ok) {
    throw new Error(`checkpoint report fetch failed: HTTP ${reportRes.status} for workflow ${analyzed.workflow_id}`);
  }
  const report = await reportRes.json() as Record<string, unknown>;

  const data = {
    jobId,
    offerId: 'checkpoint_audit',
    engine: base,
    input: { steps, requestText: requestText.slice(0, 4000) },
    analyzeResult: analyzed,
    report,
    generatedAt: new Date().toISOString(),
  };

  const artifacts: ArtifactResult[] = [
    writeArtifact(outputDir, 'checkpoint-audit.md', renderAuditMarkdown(jobId, requestText, report), { kind: 'audit_report', engine: 'checkpoint' }),
    writeArtifact(outputDir, 'audit-data.json', JSON.stringify(data, null, 2) + '\n', { kind: 'audit_data', workflow_id: analyzed.workflow_id }),
  ];

  return {
    artifacts,
    workflowId,
    riskLevel: String(analyzed.risk_level ?? report.risk_level ?? 'UNKNOWN'),
    failurePoints: Number(analyzed.failure_points ?? report.failure_points ?? 0),
  };
}
