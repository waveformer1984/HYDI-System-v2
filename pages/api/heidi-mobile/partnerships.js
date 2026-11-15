'use strict';

/**
 * Heidi Mobile — Partnerships & Funding snapshot (read-only v1).
 * No external submission. Drafts require owner approval out of band.
 */

const { guard } = require('../../../lib/heidi-mobile/guard.js');
const { ResourceAcquisitionEngine } = require('../../../lib/partnerships-funding/resource-engine');
const { loadApprovedOrgProfileFromEnv } = require('../../../lib/partnerships-funding/profile-loader');

let _engine;
function engine() {
  if (!_engine) {
    _engine = new ResourceAcquisitionEngine();
    const loaded = loadApprovedOrgProfileFromEnv();
    if (loaded.ok) _engine.setOrgProfile(loaded.profile);
  }
  return _engine;
}

export default async function handler(req, res) {
  const g = guard(req, res, { methods: ['GET'], routeName: 'partnerships', rateMax: 30 });
  if (!g.ok) return;

  try {
    const snap = engine().acquisitionSnapshot();
    if (!snap.org_profile_approved) {
      snap.notice =
        'Organization profile not owner-approved — set HYDI_ORG_PROFILE_PATH to a private file with owner_approval_record before drafting.';
    }
    res.status(200).json(snap);
  } catch (e) {
    res.status(500).json({
      ok: false,
      research_status: 'unavailable',
      error: e instanceof Error ? e.message : 'partnerships_unreadable',
    });
  }
}