'use strict';
/**
 * Proposal starter for a strong lead. Template-only (no model call, $0):
 * it gives Jordan a first paragraph to edit, never something to send as-is.
 * Nothing here submits anything — the draft is stored with the lead and
 * shown in Ursula.
 */

function fmtBudget(b) {
  if (!b) return null;
  const cur = b.currency && b.currency !== 'USD' ? `${b.currency} ` : '$';
  if (Number.isFinite(b.min) && Number.isFinite(b.max) && b.max) {
    return `${cur}${b.min}–${cur}${b.max}${b.type === 'hourly' ? '/hr' : ''}`;
  }
  return b.text || null;
}

function draftProposal(lead, division) {
  const skills = (lead.matched || []).slice(0, 4).join(', ');
  const pitch = division && division.pitch ? division.pitch : 'this kind of work';
  const lines = [
    `Hi — I read your post "${lead.title}".`,
    '',
    `This is squarely what we do: ${pitch}.${skills ? ` Relevant here: ${skills}.` : ''}`,
    '',
    'How I would approach it:',
    '1. A short call or a few questions to pin down scope and what "done" looks like.',
    '2. A fixed milestone plan with a first deliverable you can review early.',
    '3. Delivery with notes so you can maintain it afterwards.',
    '',
    'A couple of questions before I quote: [EDIT: 1–2 specific questions about their post].',
    '',
    '— Jordan, ProtoForge',
  ];
  return lines.join('\n');
}

module.exports = { draftProposal, fmtBudget };
