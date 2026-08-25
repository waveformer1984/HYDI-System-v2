// Download individual artifact file
// GET /api/revenue/jobs/:jobId/download?token=<token>&file=<filename>
//
// Streams the actual file content to the customer.

const { getJobManager } = require('../../../../lib/revenue/JobManager');
const fs = require('fs');
const path = require('path');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { jobId, token, file } = req.query;
    if (!jobId || !token || !file) {
      return res.status(400).json({ error: 'jobId, token, and file are required' });
    }

    const jobManager = getJobManager();
    const job = await jobManager.getJob(jobId);

    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.deliveryStatus !== 'delivered') return res.status(403).json({ error: 'Job not delivered' });
    if (job.deliveryToken !== token) return res.status(403).json({ error: 'Invalid delivery token' });

    // Find the artifact
    const artifactPath = job.artifactPaths.find(p => path.basename(p) === file);
    if (!artifactPath) return res.status(404).json({ error: 'File not found in job artifacts' });
    if (!fs.existsSync(artifactPath)) return res.status(404).json({ error: 'File not found on disk' });

    // Set content type based on extension
    const ext = path.extname(file).toLowerCase();
    const contentTypes = {
      '.stl': 'application/sla',
      '.scad': 'text/plain',
      '.md': 'text/markdown',
    };
    res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);

    const stream = fs.createReadStream(artifactPath);
    stream.pipe(res);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: msg });
  }
}
