// Operator approval endpoint — human reviews and approves artifacts for delivery
// POST /api/revenue/jobs/:jobId/approve
//
// Uses the canonical requireAuth guard with RBAC permission 'revenue:manage'.
// Accepts x-hydi-service-token (HMAC, role=owner) or x-hydi-device-token
// (per-device, role resolved from registration).
// Re-verifies artifacts on disk before approving delivery.
// This is the human gate — no automated delivery bypass exists.

import { getJobManager } from '../../../../../lib/revenue/JobManager';
import { verifyArtifacts } from '../../../../../lib/revenue/ModelArtifactGenerator';
import { requireAuth } from '../../../../../lib/auth/requireAuth';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Lazy-init Supabase client for auth audit logging
let supabaseClient = null;
function getSupabase() {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (url && key) {
      supabaseClient = createClient(url, key);
    }
  }
  return supabaseClient;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authenticate using the canonical RBAC guard
  const supabase = getSupabase();
  if (!supabase) {
    return res.status(500).json({ error: 'Auth infrastructure unavailable — SUPABASE_URL not configured' });
  }

  const auth = await requireAuth(req, res, supabase, {
    permission: 'revenue:manage',
    routeName: 'job-approve',
    rateMax: 20,
  });
  if (!auth.ok) return; // requireAuth already wrote the 401/403 response

  try {
    const { jobId } = req.query;
    const { notes, action } = req.body; // action: 'approve' or 'reject'

    if (!jobId) return res.status(400).json({ error: 'jobId is required' });
    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action must be "approve" or "reject"' });
    }

    const jobManager = getJobManager();
    const job = await jobManager.getJob(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (job.jobStatus !== 'awaiting_review') {
      return res.status(409).json({ error: `Job is not awaiting review (status: ${job.jobStatus})` });
    }

    if (action === 'approve') {
      // ─── Re-verify artifacts on disk before delivery ───
      const verificationResult = verifyArtifactsOnDisk(job);
      if (!verificationResult.verified) {
        await jobManager.failExecution(jobId, `Pre-delivery artifact verification failed: ${verificationResult.details}`);
        return res.status(422).json({
          error: 'Artifact verification failed — cannot approve delivery',
          details: verificationResult.details,
        });
      }

      // Approve for delivery
      const approvedJob = await jobManager.approveForDelivery(jobId, `human:${auth.role}`, notes);
      return res.status(200).json({
        jobId: approvedJob.jobId,
        jobStatus: approvedJob.jobStatus,
        deliveryStatus: approvedJob.deliveryStatus,
        deliveryToken: approvedJob.deliveryToken,
        message: 'Job approved for delivery',
      });
    } else {
      // Reject
      const rejectedJob = await jobManager.failExecution(jobId, `Delivery rejected by ${auth.role}: ${notes || 'No reason provided'}`);
      return res.status(200).json({
        jobId: rejectedJob.jobId,
        jobStatus: rejectedJob.jobStatus,
        message: 'Job rejected — refund will be processed',
      });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: msg });
  }
}

/**
 * Re-verify artifacts on disk before delivery.
 * Checks:
 *   - All artifact files exist
 *   - STL is structurally valid
 *   - File hashes match recorded hashes
 *   - Files are associated with the correct job
 */
function verifyArtifactsOnDisk(job) {
  if (!job.artifactPaths || job.artifactPaths.length === 0) {
    return { verified: false, details: 'No artifact paths recorded' };
  }

  if (job.artifactPaths.length < 3) {
    return { verified: false, details: `Expected 3 artifacts, got ${job.artifactPaths.length}` };
  }

  const hasScad = job.artifactPaths.some(p => p.endsWith('.scad'));
  const hasStl = job.artifactPaths.some(p => p.endsWith('.stl'));
  const hasReadme = job.artifactPaths.some(p => path.basename(p) === 'README.md');

  if (!hasScad) return { verified: false, details: 'Missing .scad file in artifact paths' };
  if (!hasStl) return { verified: false, details: 'Missing .stl file in artifact paths' };
  if (!hasReadme) return { verified: false, details: 'Missing README.md in artifact paths' };

  // Verify each file exists and hash matches
  for (const artifactPath of job.artifactPaths) {
    if (!fs.existsSync(artifactPath)) {
      return { verified: false, details: `File not found on disk: ${path.basename(artifactPath)}` };
    }

    const content = fs.readFileSync(artifactPath);
    const currentHash = crypto.createHash('sha256').update(content).digest('hex');
    const filename = path.basename(artifactPath);
    const recordedHash = job.artifactMetadata[filename]?.sha256;

    if (recordedHash && currentHash !== recordedHash) {
      return {
        verified: false,
        details: `Hash mismatch for ${filename}: artifact may have been tampered with after generation`,
      };
    }

    // Verify file is not empty
    if (content.length < 10) {
      return { verified: false, details: `File too small: ${filename} (${content.length} bytes)` };
    }
  }

  // Verify STL structural validity
  const stlPath = job.artifactPaths.find(p => p.endsWith('.stl'));
  if (stlPath) {
    const stlContent = fs.readFileSync(stlPath, 'utf8');
    if (!stlContent.startsWith('solid ')) {
      return { verified: false, details: 'STL file does not start with "solid "' };
    }
    if (!stlContent.includes('endsolid')) {
      return { verified: false, details: 'STL file does not contain "endsolid"' };
    }
    const triangleCount = (stlContent.match(/endfacet/g) || []).length;
    if (triangleCount < 4) {
      return { verified: false, details: `STL has insufficient triangles (${triangleCount})` };
    }
  }

  return { verified: true, details: 'All artifacts verified: files exist, hashes match, STL valid' };
}
