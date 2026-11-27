import fs from 'fs';
import {
  getActivitiesForLeads,
  getPack,
  getPackLeads,
  packCsvPath,
} from '../../../../lib/lead-forge/db';
import { requireLeadForgeAuth } from '../../../../lib/lead-forge/api';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'method not allowed' });
  }
  const auth = await requireLeadForgeAuth(req, res, 'revenue:view');
  if (!auth.ok) return;
  const packId = String(req.query.packId || '');
  if (!packId) return res.status(400).json({ ok: false, error: 'pack id required' });

  if (req.query.download === 'csv') {
    const csvPath = packCsvPath(packId);
    if (!fs.existsSync(csvPath)) return res.status(404).json({ ok: false, error: 'csv not found' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${packId}-leads.csv"`);
    return res.status(200).send(fs.readFileSync(csvPath, 'utf8'));
  }

  try {
    const pack = await getPack(packId);
    if (!pack) return res.status(404).json({ ok: false, error: 'pack not found' });
    const leads = await getPackLeads(packId);
    const activities = await getActivitiesForLeads(leads.map((l) => l.id));
    return res.status(200).json({ ok: true, pack, leads, activities });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'pack lookup failed';
    return res.status(503).json({ ok: false, error: message });
  }
}