'use strict';

const fs = require('fs');
const path = require('path');

const REPO = process.env.HYDI_REPO_ROOT || path.resolve(__dirname, '..', '..');

function readSnippet(filePath, max = 4000) {
  try {
    const full = path.join(REPO, filePath);
    const text = fs.readFileSync(full, 'utf8');
    return text.length > max ? `${text.slice(0, max)}…` : text;
  } catch {
    return null;
  }
}

/**
 * Reusable HYDI narrative package — distinguishes verified vs planned.
 */
function buildHydiProjectPackage() {
  return {
    generated_at: new Date().toISOString(),
    classification: 'OWNER_REVIEW_REQUIRED',
    verified_capabilities: [
      'Six-layer event pipeline (CASCADE → KILO → ProtoForge) with replay tests',
      'Partnerships / resource acquisition coordinator (fixture-backed)',
      'Heidi mobile operations BFF and local-first Supabase path',
      'Stripe Connect multi-stream revenue wiring (test-mode qualified)',
    ],
    experimental_capabilities: [
      'Distributed execution hardening (PR #590 — unmerged)',
      'Dev workforce coordinator (PR #591)',
    ],
    planned_capabilities: [
      'Operator-verified live program discovery',
      'Frank/Tailscale production validation',
    ],
    simulated_demonstrations: [
      'Jest integration suites without production credentials',
    ],
    references: {
      architecture: 'CLAUDE.md',
      partnerships_workflow: 'docs/PARTNERSHIPS_FUNDING_WORKFLOW.md',
      resource_engine: 'docs/HYDI_RESOURCE_ACQUISITION_ENGINE.md',
      repository: 'https://github.com/waveformer1984/HYDI-System-v2',
    },
    snippets: {
      pipeline_replay: readSnippet('tests/unit/pipeline-replay.test.js', 1200),
    },
    compute_requirements: 'Local Ollama inference + local Supabase; optional API credits if owner-approved.',
    security_posture: 'Fail-closed PolicyEngine; operator auth for external submissions.',
    never_auto_submit: true,
  };
}

function applicationChecklist(opportunity, draft) {
  return {
    opportunity_id: opportunity.id,
    program_name: opportunity.program_name,
    checklist: [
      'Owner-approved org profile on file (HYDI_ORG_PROFILE_PATH)',
      'Official source operator-verified',
      'Eligibility gaps resolved or explicitly accepted',
      'Draft reviewed — no misrepresentation of HYDI status',
      'Operator authorization before external submit',
      'Evidence reference recorded after submit',
    ],
    unresolved: draft?.unresolved_questions || opportunity.unresolved_questions || [],
  };
}

module.exports = { buildHydiProjectPackage, applicationChecklist };