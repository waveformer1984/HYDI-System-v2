/**
 * HEIDI Operational Autonomy Contract
 *
 * The formal contract specifying what HEIDI may and may not do autonomously.
 *
 * This contract is enforced by the existing policy architecture:
 *   - AutonomyPolicyModel (what actions are allowed)
 *   - CapabilityAuthorizer (what capabilities are authorized)
 *   - ActionSelector (what actions are selected)
 *   - ActionRegistry (what actions exist)
 *
 * The contract is NOT a separate enforcement layer — it is a declaration
 * that the existing layers enforce. Any violation of the "MUST NEVER"
 * clauses should be caught by the policy model's fail-closed design.
 *
 * Principle: AUTONOMY MUST BE GOVERNED.
 * Principle: identity ≠ permission ≠ policy ≠ execution ≠ causality ≠ observation
 * Principle: When in doubt, DO NOT MUTATE. RECORD → ESCALATE.
 */

// ---------------------------------------------------------------------------
// HEIDI MAY AUTOMATICALLY (with policy authorization)
// ---------------------------------------------------------------------------

export const HEIDI_MAY: ReadonlyArray<{
  capability: string;
  risk: string;
  authorization: string;
  description: string;
}> = Object.freeze([
  { capability: 'health.read', risk: 'R0', authorization: 'autonomous',
    description: 'Read health state of any component at any time' },
  { capability: 'diagnostic.snapshot', risk: 'R0', authorization: 'autonomous',
    description: 'Produce diagnostic snapshots at any time' },
  { capability: 'runtime.probe', risk: 'R0', authorization: 'autonomous',
    description: 'Execute functional probes at any time' },
  { capability: 'configuration.validate', risk: 'R0', authorization: 'autonomous',
    description: 'Validate configuration without changes' },
  { capability: 'health.recover', risk: 'R1', authorization: 'autonomous',
    description: 'Restart approved local processes (protoforge-core, heidi-web, heidi-mobile-chat)' },
  { capability: 'health.recover', risk: 'R2', authorization: 'policy_authorized',
    description: 'Restart approved containers (supabase_db, supabase_rest, supabase_kong, etc.)' },
  { capability: 'health.recover', risk: 'R2', authorization: 'policy_authorized',
    description: 'Restart Ollama AI service' },
  { capability: 'health.recover', risk: 'R2', authorization: 'policy_authorized',
    description: 'Recover database connectivity (local container restart only)' },
  { capability: 'health.recover', risk: 'R2', authorization: 'policy_authorized',
    description: 'Restart bridge components (if registered process modules)' },
  { capability: 'health.recover', risk: 'R0', authorization: 'autonomous',
    description: 'Escalate to human operator when recovery is exhausted or unsafe' },
]);

// ---------------------------------------------------------------------------
// HEIDI MUST NEVER AUTOMATICALLY (prohibited — enforced by fail-closed design)
// ---------------------------------------------------------------------------

export const HEIDI_MUST_NEVER: ReadonlyArray<{
  prohibition: string;
  enforcement: string;
  rationale: string;
}> = Object.freeze([
  {
    prohibition: 'rotate or replace user secrets',
    enforcement: 'No capability exists for secret rotation. CapabilityAuthorizer denies unknown capabilities.',
    rationale: 'Secret rotation is a user action. Automated rotation could lock out the operator.',
  },
  {
    prohibition: 'expose credentials',
    enforcement: 'Security protocol prohibits logging secrets. No capability exposes credential values.',
    rationale: 'Credential exposure is a security violation.',
  },
  {
    prohibition: 'modify production credentials without explicit authorization',
    enforcement: 'No capability exists for credential modification. All credential actions require human authorization.',
    rationale: 'Credential changes can break production access.',
  },
  {
    prohibition: 'make unrestricted filesystem changes',
    enforcement: 'Recovery actions only write to .hydi-operational/ (event journal). No general filesystem mutation capability.',
    rationale: 'Unrestricted filesystem access could corrupt the system.',
  },
  {
    prohibition: 'execute arbitrary shell commands',
    enforcement: 'ActionRegistry only contains typed, bounded actions. Unregistered actions are blocked by RecoveryEngine.executeAction().',
    rationale: 'Arbitrary shell execution is a security boundary violation.',
  },
  {
    prohibition: 'disable security controls',
    enforcement: 'No capability exists for disabling security. CapabilityAuthorizer is fail-closed.',
    rationale: 'Disabling security controls removes the boundaries that make autonomy safe.',
  },
  {
    prohibition: 'change autonomy policy itself',
    enforcement: 'AutonomyPolicyModel.addPolicy() exists but is not callable from autonomous paths. Policy changes require code deployment.',
    rationale: 'Self-modification of authority is the autonomy escape hatch.',
  },
  {
    prohibition: 'silently alter its own authority',
    enforcement: 'All authorization decisions are recorded in PolicyDecisionRecordStore. Silent authority changes are impossible.',
    rationale: 'Authority changes must be auditable.',
  },
  {
    prohibition: 'perform destructive database operations',
    enforcement: 'No capability exists for destructive DB operations. Database recovery only restarts containers.',
    rationale: 'Destructive DB operations can cause data loss.',
  },
  {
    prohibition: 'perform financial actions',
    enforcement: 'No capability exists for financial actions. Stripe operations are in a separate API layer, not in the operational autonomy system.',
    rationale: 'Financial actions have real-world consequences.',
  },
  {
    prohibition: 'bypass approval requirements',
    enforcement: 'ActionSelector checks policy, budget, and authorization before any action. Urgency does not bypass policy.',
    rationale: 'Urgency is not authority.',
  },
  {
    prohibition: 'hide or rewrite audit history',
    enforcement: 'PolicyDecisionRecordStore is append-only JSONL. No update or delete capability exists for audit records (update only modifies the in-memory copy, the original remains in the file).',
    rationale: 'Audit history must be immutable for trust.',
  },
]);

// ---------------------------------------------------------------------------
// Contract summary for operator display
// ---------------------------------------------------------------------------

export function formatContract(): string {
  const lines: string[] = [
    'HEIDI OPERATIONAL AUTONOMY CONTRACT',
    '====================================',
    '',
    'HEIDI MAY AUTOMATICALLY (with policy authorization):',
    '',
  ];

  for (const may of HEIDI_MAY) {
    lines.push(`  [${may.risk} ${may.authorization}] ${may.capability}: ${may.description}`);
  }

  lines.push('', 'HEIDI MUST NEVER AUTOMATICALLY:', '');

  for (const never of HEIDI_MUST_NEVER) {
    lines.push(`  ✗ ${never.prohibition}`);
    lines.push(`    Enforcement: ${never.enforcement}`);
    lines.push(`    Rationale: ${never.rationale}`);
    lines.push('');
  }

  lines.push('PRINCIPLE: AUTONOMY MUST BE GOVERNED.');
  lines.push('PRINCIPLE: When in doubt, DO NOT MUTATE. RECORD → ESCALATE.');

  return lines.join('\n');
}
