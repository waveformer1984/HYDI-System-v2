import {
  appendSuppression,
  getLead,
  insertActivity,
  updateLead,
} from '../../../../../../lib/lead-forge/db';
import { requireLeadForgeAuth } from '../../../../../../lib/lead-forge/api';

function domainFromWebsite(website) {
  if (!website) return '';
  try {
    return new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`)
      .hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'method not allowed' });
  }
  const auth = await requireLeadForgeAuth(req, res, 'revenue:manage');
  if (!auth.ok) return;

  const leadId = String(req.query.leadId || '');
  try {
    const lead = await getLead(leadId);
    if (!lead) return res.status(404).json({ ok: false, error: 'lead not found' });

    const domain = domainFromWebsite(lead.website);
    appendSuppression({
      domain,
      phone: lead.phone || '',
      businessName: lead.business_name || '',
    });

    const updated = await updateLead(leadId, { status: 'do_not_contact' });
    await insertActivity(
      leadId,
      'suppressed',
      `added to suppression list${domain ? ` (domain ${domain})` : ''}`,
    );

    return res.status(200).json({ ok: true, lead: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'suppress failed';
    return res.status(500).json({ ok: false, error: message });
  }
}