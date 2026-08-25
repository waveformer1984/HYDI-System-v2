// Delivery endpoint — download artifacts
// GET /api/revenue/jobs/:jobId/delivery?token=<deliveryToken>
//
// Returns the artifact files for a delivered job.
// Requires the delivery token that was generated when the
// human approved the artifact for delivery.

const { getJobManager } = require('../../../../lib/revenue/JobManager');
const fs = require('fs');
const path = require('path');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { jobId, token } = req.query;
    if (!jobId) return res.status(400).json({ error: 'jobId is required' });
    if (!token) return res.status(400).json({ error: 'token is required' });

    const jobManager = getJobManager();
    const job = await jobManager.getJob(jobId);

    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.deliveryStatus !== 'delivered') return res.status(403).json({ error: 'Job not delivered' });
    if (job.deliveryToken !== token) return res.status(403).json({ error: 'Invalid delivery token' });

    // Return artifact listing with download info
    const artifacts = job.artifactPaths.map(p => {
      const filename = path.basename(p);
      const exists = fs.existsSync(p);
      const stat = exists ? fs.statSync(p) : null;
      return {
        filename,
        sizeBytes: stat ? stat.size : 0,
        sha256: job.artifactMetadata[filename]?.sha256 || null,
        downloadUrl: `/api/revenue/jobs/${jobId}/download?token=${token}&file=${filename}`,
        exists,
      };
    });

    return res.status(200).json({
      jobId: job.jobId,
      product: job.product,
      deliveredAt: job.deliveredAt,
      artifacts,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: msg });
  }
}
