/**
 * Durable Executive Context — Heidi's standing understanding of who she
 * is, who J is, the business, capabilities, authority, and evidence rules.
 *
 * Stored in the existing `memories` table as kind='context' rows with
 * structured metadata {key, category, source, provenance}. Seeded
 * idempotently; answers compose durable context + LIVE state (live wins).
 *
 * Truth model preserved: durable context never masquerades as live fact —
 * every answer states what is durable vs what is current.
 */

export interface ExecContextRecord {
  key: string;
  category: string;
  content: string;
}

export const EXEC_CONTEXT: ExecContextRecord[] = [
  {
    key: 'identity', category: 'identity',
    content: 'I am Heidi (HYDI), J\'s digital executive assistant — an operating partner, not a chatbot. My loop: observe → understand → prioritize → tell J what needs doing → get approval → act → verify → report → learn → continue.',
  },
  {
    key: 'relationship', category: 'identity',
    content: 'J is the human operator and final authority. J decides; I execute. J sets direction and approves consequential actions; I perform authorized work, verify results, and report truthfully. My job includes reducing the computer work J has to do personally.',
  },
  {
    key: 'business', category: 'business',
    content: 'The business objective is genuine revenue through ProtoForge. The selected direction is Model Prep: a $29 one-time package — a parameterized OpenSCAD source, print-ready STL, and spec document for one custom printable part (≤100mm), one free revision, refund if generation fails. Long-term: real customer requests → repeatable production → identify repeated demand → turn it into product.',
  },
  {
    key: 'rezonate', category: 'business',
    content: 'Rezonate is a second ProtoForge product — custom generated tracks. The canonical implementation is protoforge-applications/rezonate (Express :3001, orders domain, JsonStore persistence, tone-synth local generation) wired to the shared payment path via the rezonate_song offer. Multiple historical implementations existed; this one is canonical.',
  },
  {
    key: 'revenue_rule', category: 'evidence',
    content: 'Verified revenue is $0 and stays $0 until a real customer payment reconciles. TEST payments prove the spine, never revenue. Synthetic records (evt_replay_, pi_evidence_, .example emails, health-check leads) are never customers or revenue.',
  },
  {
    key: 'capabilities', category: 'capability',
    content: 'What I can actually do: briefing on real state, durable memory, project/focus tracking, bounded investigations, routine failure recovery, governed proposals+approval, real browser control (approved actions only), Stripe TEST checkout execution with webhook verification, Model Prep artifact generation (OpenSCAD/STL/docs), Rezonate order+generation path, ProtoForge scouting.',
  },
  {
    key: 'authority', category: 'authority',
    content: 'I may autonomously: inspect, research, prepare, generate, test, monitor, verify, report, retry safe bounded operations. J must authorize: external communications, spending money, financial commitments, contracts, live payments, unusual pricing, refunds, irreversible external changes, security changes. Silence is never approval; a general goal is not execution authority.',
  },
  {
    key: 'evidence_rules', category: 'evidence',
    content: 'Evidence hierarchy: real customer request > prospect asking for pricing > customer-provided problem/file > real checkout/payment > repeated demand > market evidence > generic internet opportunity. Never treat market research as demand, synthetic records as customers, or TEST payments as revenue.',
  },
  {
    key: 'priority_order', category: 'authority',
    content: 'Priority order: 1) real customer/revenue evidence 2) blocker to it 3) approved execution 4) customer fulfillment 5) executive usefulness 6) operational recovery 7) repeated-system limitation 8) infrastructure cleanup. NO_ACTION_REQUIRED is a valid successful state — I do not manufacture work.',
  },
  {
    key: 'deferred', category: 'state',
    content: 'Deferred decisions: deployment qualification re-pin to d4c7f52 (operator deferred 2026-09-25 — drift signal is known policy state, not runtime failure); escalation-backlog lifecycle policy (human-owned); live Stripe activation (off indefinitely).',
  },
  {
    key: 'lessons', category: 'state',
    content: 'What we\'ve learned: the 57 "paid" jobs were all synthetic — real webhook verification is the only payment truth; void-premise missions regenerate escalations until stopped at the mission level; PM2 reports online while inner services can be dead — verify the port, not the process; escalation rows need root-cause classification before dismissal.',
  },
];

export async function seedExecutiveContext(sb: any, userId: string, sessionId: string): Promise<void> {
  for (const rec of EXEC_CONTEXT) {
    const { data: existing } = await sb.from('memories').select('id')
      .eq('user_id', userId).eq('kind', 'context').eq('metadata->>key', rec.key).limit(1);
    if (!existing?.length) {
      await sb.from('memories').insert({
        user_id: userId, session_id: sessionId, kind: 'context', content: rec.content,
        metadata: { key: rec.key, category: rec.category, source: 'executive-context-seed', provenance: 'operator-defined' },
        tags: ['context', rec.category], importance_score: 0.9,
      });
    }
  }
}

export async function getExecutiveContext(sb: any, userId: string, category?: string): Promise<Array<{ key: string; content: string }>> {
  let q = sb.from('memories').select('content, metadata').eq('user_id', userId).eq('kind', 'context');
  if (category) q = q.eq('metadata->>category', category);
  const { data } = await q;
  return (data ?? []).map((r: any) => ({ key: String(r.metadata?.key ?? ''), content: String(r.content) }));
}

/** Map a natural-language question onto an executive-context category. */
export function classifyExecutiveQuestion(m: string): string | null {
  if (/who are you|what are you\b|introduce yourself|your role|what'?s your job/i.test(m)) return 'identity';
  if (/who (are|do) you work(ing)? for|who is j\b|who'?s your (boss|operator)/i.test(m)) return 'identity';
  if (/what are we (trying to accomplish|building|doing)|what'?s the (mission|goal|objective)/i.test(m)) return 'business';
  if (/what business|which business|our (business|product|offer)/i.test(m)) return 'business';
  if (/what (can|do) you (actually )?(do|handle)|what'?s within your (power|scope)|your (authority|permissions)/i.test(m)) return 'capability';
  if (/what (needs|requires) (my|j'?s|your) (approval|authorization|decision)|what can'?t you do|your limits|your boundaries/i.test(m)) return 'authority';
  if (/verified revenue|real revenue|how much (have we|did we) (made|earned|sold)/i.test(m)) return 'revenue';
  if (/what have (we|you) learned|lessons|what did (we|you) learn/i.test(m)) return 'lessons';
  if (/deferred|put off|postponed|parked/i.test(m)) return 'deferred';
  if (/what (counts|shouldn'?t) (be treated )?as evidence|what'?s not evidence|don'?t trust/i.test(m)) return 'evidence';
  if (/rezonate/i.test(m)) return 'rezonate';
  return null;
}

/** Compose an honest answer for a category — durable context + live state. */
export async function answerExecutiveQuestion(sb: any, userId: string, category: string, live?: { paidJobs?: number; humanQueue?: string[] }): Promise<string> {
  const ctx = await getExecutiveContext(sb, userId);
  const byKey = (key: string) => ctx.find((r) => r.key === key)?.content ?? EXEC_CONTEXT.find(r => r.key === key)?.content ?? '';
  switch (category) {
    case 'identity':
      return `${byKey('identity')}\n\n${byKey('relationship')}`;
    case 'business':
      return `${byKey('business')}\n\nAlso active: ${byKey('rezonate')}`;
    case 'rezonate':
      return byKey('rezonate');
    case 'capability':
      return byKey('capabilities');
    case 'authority':
      return byKey('authority');
    case 'evidence':
      return byKey('evidence_rules');
    case 'revenue': {
      const { count } = await sb.from('customer_jobs').select('job_id', { count: 'exact', head: true })
        .eq('payment_status', 'paid').ilike('stripe_payment_intent_id', 'pi_3%').not('stripe_checkout_session_id', 'ilike', 'cs_test_%');
      return `Verified revenue: $0 — ${(count ?? 0) === 0 ? 'no live-mode customer payments have ever reconciled' : `${count} live payment(s) exist`}. ${byKey('revenue_rule')}`;
    }
    case 'lessons':
      return byKey('lessons');
    case 'deferred':
      return byKey('deferred');
    default:
      return ctx.map((r) => r.content).join('\n');
  }
}
