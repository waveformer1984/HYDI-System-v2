import { getJob } from '../../../../lib/lead-forge/jobs';
import { requireLeadForgeAuth } from '../../../../lib/lead-forge/api';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'method not allowed' });
  }
  const auth = await requireLeadForgeAuth(req, res, 'revenue:view');
  if (!auth.ok) return;
  const job = getJob(String(req.query.jobId || ''));
  if (!job) return res.status(404).json({ ok: false, error: 'job not found' });
  return res.status(200).json({
    ok: true,
    job: {
      id: job.id,
      status: job.status,
      packId: job.packId,
      boardWarning: job.boardWarning,
      error: job.error,
      request: job.request,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
  });
}