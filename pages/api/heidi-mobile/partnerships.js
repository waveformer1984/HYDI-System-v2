'use strict';

/**
 * Heidi Mobile — Partnerships & Funding snapshot (read-only v1).
 * No external submission. Drafts require owner approval out of band.
 */

const fs = require('fs');
const path = require('path');
const { guard } = require('../../../lib/heidi-mobile/guard.js');
const { PartnershipsFundingCoordinator } = require('../../../lib/partnerships-funding/coordinator');

function loadOrgProfile() {
  const file = path.join(process.cwd(), 'docs/partnerships/organization-profile.template.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

let _coord;
function coordinator() {
  if (!_coord) {
    _coord = new PartnershipsFundingCoordinator();
    const profile = loadOrgProfile();
    if (profile?.approved_by_owner) _coord.setOrgProfile(profile);
  }
  return _coord;
}

export default async function handler(req, res) {
  const g = guard(req, res, { methods: ['GET'], routeName: 'partnerships', rateMax: 30 });
  if (!g.ok) return;

  try {
    const snap = coordinator().mobileSnapshot();
  if (!snap.org_profile_approved) {
    snap.notice = 'Organization profile not owner-approved — eligibility and drafts may be incomplete.';
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