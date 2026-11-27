import { listPacks } from '../../../../lib/lead-forge/db';
import { createJob, schedulePackJob } from '../../../../lib/lead-forge/jobs';
import { parsePackBody, requireLeadForgeAuth } from '../../../../lib/lead-forge/api';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const auth = await requireLeadForgeAuth(req, res, 'revenue:view');
    if (!auth.ok) return;
    try {
      const packs = await listPacks();
      return res.status(200).json({ ok: true, packs });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'list packs failed';
      return res.status(503).json({ ok: false, error: message });
    }
  }

  if (req.method === 'POST') {
    const auth = await requireLeadForgeAuth(req, res, 'revenue:manage');
    if (!auth.ok) return;
    try {
      const request = parsePackBody(req.body);
      const job = createJob(request);
      schedulePackJob(job.id);
      return res.status(202).json({ ok: true, jobId: job.id, status: job.status });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'invalid pack request';
      return res.status(400).json({ ok: false, error: message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'method not allowed' });
}