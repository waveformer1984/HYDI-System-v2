import {
  getLead,
  insertActivity,
  updateLead,
} from '../../../../lib/lead-forge/db';
import { requireLeadForgeAuth } from '../../../../lib/lead-forge/api';

const STATUSES = new Set([
  'new', 'reviewed', 'approved', 'contacted', 'replied', 'won', 'lost', 'do_not_contact',
]);

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', ['PATCH']);
    return res.status(405).json({ error: 'method not allowed' });
  }
  const auth = await requireLeadForgeAuth(req, res, 'revenue:manage');
  if (!auth.ok) return;

  const leadId = String(req.query.leadId || '');
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    const existing = await getLead(leadId);
    if (!existing) return res.status(404).json({ ok: false, error: 'lead not found' });

    const patch = {};
    if (body.status !== undefined) {
      if (!STATUSES.has(body.status)) return res.status(400).json({ ok: false, error: 'invalid status' });
      patch.status = body.status;
    }
    if (body.notes !== undefined) patch.notes = body.notes === null ? null : String(body.notes);
    if (body.next_follow_up !== undefined) patch.next_follow_up = body.next_follow_up || null;
    for (const key of ['email_1', 'email_2', 'email_3']) {
      if (body[key] !== undefined) patch[key] = body[key] === null ? null : String(body[key]);
    }

    const updated = await updateLead(leadId, patch);

    if (patch.status && patch.status !== existing.status) {
      await insertActivity(leadId, 'status_change', `status: ${existing.status} → ${patch.status}`);
    }
    const draftKeys = ['email_1', 'email_2', 'email_3'].filter((k) => patch[k] !== undefined && patch[k] !== existing[k]);
    if (draftKeys.length) {
      await insertActivity(leadId, 'draft_edit', `updated drafts: ${draftKeys.join(', ')}`);
    }
    if (patch.notes !== undefined && patch.notes !== existing.notes) {
      await insertActivity(leadId, 'note', String(patch.notes));
    }

    return res.status(200).json({ ok: true, lead: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'lead update failed';
    return res.status(503).json({ ok: false, error: message });
  }
}