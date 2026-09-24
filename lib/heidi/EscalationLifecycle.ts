/**
 * EscalationLifecycle — read-only classification of escalation items.
 *
 * Classifies items for executive presentation. NEVER mutates state.
 * Classes:
 *   VOID            — premise references an entity that no longer exists
 *   HUMAN_DECISION  — requires an operator decision; remains human-owned
 *   POLICY_STANDING — standing constraint (auth/level denials); not work
 *   STALE           — unresolved and old, no recent regeneration
 *   ACTIONABLE      — recent, non-policy, premise plausibly live
 *   UNKNOWN         — evidence insufficient (preferred over guessing)
 */

export type EscalationClass =
  | 'VOID' | 'HUMAN_DECISION' | 'POLICY_STANDING'
  | 'STALE' | 'ACTIONABLE' | 'UNKNOWN';

export interface EscalationItem {
  title: string;
  created_at?: string;
  category?: string;
  /** Caller resolves referenced entity existence for VOID detection. */
  referencedEntityExists?: boolean | null;
}

const POLICY_PATTERNS = [
  /autonomy level/i,
  /requires autonomy/i,
  /requires authorization level/i,
  /authorization required/i,
  /credential/i,
];
const DECISION_PATTERNS = [
  /\bdecision\b/i,
  /requires? (?:your|human) (?:decision|approval|review)/i,
  /awaiting (?:your|human) (?:decision|approval)/i,
];
const STALE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function classifyEscalation(item: EscalationItem): EscalationClass {
  if (item.referencedEntityExists === false) return 'VOID';
  if (POLICY_PATTERNS.some((r) => r.test(item.title))) return 'POLICY_STANDING';
  if (DECISION_PATTERNS.some((r) => r.test(item.title))) return 'HUMAN_DECISION';
  if (item.created_at) {
    const age = Date.now() - new Date(item.created_at).getTime();
    if (age > STALE_AGE_MS) return 'STALE';
    return 'ACTIONABLE';
  }
  return 'UNKNOWN';
}

export function summarizeClasses(items: EscalationItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) {
    const c = classifyEscalation(i);
    out[c] = (out[c] ?? 0) + 1;
  }
  return out;
}
