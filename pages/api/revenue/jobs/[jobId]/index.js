// Get job status and details
// GET /api/revenue/jobs/:jobId
//
// Returns the current state of a customer job.
// This is used by the customer to check on their job status
// and by the operator to monitor execution.

const { getJobManager } = require('../../../../lib/revenue/JobManager');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { jobId } = req.query;
    if (!jobId) return res.status(400).json({ error: 'jobId is required' });

    const jobManager = getJobManager();
    const job = await jobManager.getJob(jobId);

    if (!job) return res.status(404).json({ error: 'Job not found' });

    // Get job events for audit trail
    const events = await jobManager.getJobEvents(jobId);

    return res.status(200).json({
      job,
      events,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: msg });
  }
}
