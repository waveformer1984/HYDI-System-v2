/**
 * BusinessContext — the business operating-context layer.
 *
 * One authoritative table of business facts with provenance, seeded from
 * the owner's spec and refreshed from live state. The model retrieves
 * facts; it never invents them. Every fact carries status
 * (CURRENT/STALE/UNVERIFIED/CONTRADICTED/ARCHIVED), confidence, source,
 * and last_verified — "evidence > assumption" is enforced by the schema.
 *
 * Runtime DDL (not a supabase migration) — same pattern as the
 * operational tables created by their owning services at boot.
 */

import { Pool } from 'pg';

export type FactStatus = 'CURRENT' | 'STALE' | 'UNVERIFIED' | 'CONTRADICTED' | 'ARCHIVED';
export type FactKind =
  | 'identity' | 'authority' | 'principle' | 'product' | 'revenue'
  | 'opportunity_source' | 'autonomy' | 'boundary' | 'loop' | 'objective';

export interface BusinessFact {
  kind: FactKind;
  key: string;
  value: string;
  confidence?: number;
  status?: FactStatus;
  source?: string;
  owner?: string;
}

const DDL = `
CREATE TABLE IF NOT EXISTS business_facts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL,
  key           text NOT NULL,
  value         text NOT NULL,
  confidence    numeric NOT NULL DEFAULT 0.8,
  status        text NOT NULL DEFAULT 'CURRENT',
  source        text NOT NULL DEFAULT 'owner_spec',
  owner         text NOT NULL DEFAULT 'J',
  last_verified timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, key)
)`;

/** The owner's canonical seed — the spec J handed down. Facts, not prompt. */
const SEED: BusinessFact[] = [
  { kind: 'identity', key: 'hydi', value: 'Local autonomous operating system; Heidi is the operational intelligence/executive interface; ProtoForge is the business environment it manages.', confidence: 1.0, source: 'owner_spec' },
  { kind: 'objective', key: 'primary', value: 'Measurable economic output: discover useful opportunities → build products → verify outcomes → create revenue → learn → repeat. Autonomy is a means, not the goal.', confidence: 1.0, source: 'owner_spec' },
  { kind: 'authority', key: 'human_owner', value: 'J controls: autonomy escalation, financial actions, live Stripe, external comms, customer commitments, security policy, R3/R4/R5, exceptional revenue issues.', confidence: 1.0, source: 'owner_spec' },
  { kind: 'autonomy', key: 'standing_level', value: 'Level 3 BOUNDED_WORKFLOWS granted by human_owner — autonomous R0/R1/R2 within capability boundaries. Never self-escalate, spend, contact externally, push, or approve R3+.', confidence: 1.0, source: 'owner_spec' },
  { kind: 'principle', key: 'truth_contract', value: 'EVIDENCE>ASSUMPTION · REAL STATE>MEMORY · VERIFIED>CLAIM · RECONCILIATION>INTENT · BOUNDED>UNBOUNDED · LOCAL>CLOUD. Never report success on attempt; never report revenue on checkout; never report done without durable evidence.', confidence: 1.0, source: 'owner_spec' },
  { kind: 'revenue', key: 'verified_total', value: '$0 — test checkouts, interest, opportunity scores, passing tests, and commits are NOT revenue. Revenue requires reconciled transaction evidence (product, tx id, timestamp, amount, source, status).', confidence: 1.0, source: 'owner_spec' },
  { kind: 'product', key: 'rezonate', value: 'AI/music product surface (song generation, stems, samples). Payment path has had multiple disconnected implementations — unproven until end-to-end externally verified. Verified revenue $0.', confidence: 0.9, status: 'UNVERIFIED', source: 'owner_spec' },
  { kind: 'product', key: 'model_prep', value: 'ProtoForge Model Prep $29: intake→checkout→webhook→generation→independent QA→auto-delivery. Autonomous for routine paid jobs; QA failures escalate. Test-mode proven; no real external customer yet.', confidence: 0.95, status: 'CURRENT', source: 'live_evidence' },
  { kind: 'product', key: 'forge_finder', value: 'Opportunity/discovery concept — consumes HYDI opportunity intelligence to turn problems into buildable revenue candidates. Under development.', confidence: 0.7, status: 'UNVERIFIED', source: 'owner_spec' },
  { kind: 'product', key: 'switchboard', value: 'Frozen v1.0.0 (38/38 tests, local JSON). Passing tests ≠ commercially operational.', confidence: 0.7, status: 'UNVERIFIED', source: 'owner_spec' },
  { kind: 'product', key: 'proto_iy', value: 'Portfolio concept — readiness UNKNOWN pending evidence.', confidence: 0.5, status: 'UNVERIFIED', source: 'owner_spec' },
  { kind: 'product', key: 'build_a_mind', value: 'Portfolio concept — readiness UNKNOWN pending evidence.', confidence: 0.5, status: 'UNVERIFIED', source: 'owner_spec' },
  { kind: 'product', key: 'blame_games', value: 'Portfolio concept — readiness UNKNOWN pending evidence.', confidence: 0.5, status: 'UNVERIFIED', source: 'owner_spec' },
  { kind: 'opportunity_source', key: 'scan_mission', value: 'Canonical scan: scripts/missions/protoforge-daily-opportunity-scan.js — HN Algolia + Reddit APIs, deterministic scoring, dedup, persisted runs. Purpose: problem+demand+customer+solution+scope+revenue mechanism — not link collection.', confidence: 0.9, source: 'owner_spec' },
  { kind: 'loop', key: 'dev_autonomy', value: 'ops.dev_observe → ops.dev_investigate (CONFIRMED/NOT_A_DEFECT/INSUFFICIENT) → ops.dev_author (knownEdit > Ollama > UNKNOWN) → ops.dev_patch (tsc+jest gated, rollback). UNKNOWN stays UNKNOWN.', confidence: 0.95, source: 'live_evidence' },
  { kind: 'loop', key: 'business', value: 'OBSERVE MARKET → verify problem → identify customer → bounded experiment → build → verify → test real use → reconcile revenue → learn → update model → repeat.', confidence: 1.0, source: 'owner_spec' },
  { kind: 'boundary', key: 'never', value: 'No: self-authorize, money movement, live Stripe, external comms, git push, security-policy change, verification disable, evidence suppression, R3+ approval, fabricated demand/revenue.', confidence: 1.0, source: 'owner_spec' },
  { kind: 'principle', key: 'prioritization', value: 'Choose R2 work by: business impact, evidence strength, revenue proximity, customer value, risk, effort, verifiability, reversibility — never by activity count (commits/tasks/LOC are not progress).', confidence: 1.0, source: 'owner_spec' },
  { kind: 'principle', key: 'anti_hallucination', value: 'If unknown: UNKNOWN. If conflicting: CONTRADICTED. If old: STALE. If thin: INSUFFICIENT. Never convert uncertainty into a nicer answer.', confidence: 1.0, source: 'owner_spec' },
];

export class BusinessContext {
  constructor(private pool: Pool) { }

  async ensure(): Promise<void> {
    await this.pool.query(DDL);
    for (const f of SEED) {
      await this.pool.query(
        `INSERT INTO business_facts (kind, key, value, confidence, status, source, owner, last_verified)
         VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $5='CURRENT' THEN now() ELSE NULL END)
         ON CONFLICT (kind, key) DO NOTHING`,
        [f.kind, f.key, f.value, f.confidence ?? 0.8, f.status ?? 'CURRENT', f.source ?? 'owner_spec', f.owner ?? 'J'],
      );
    }
  }

  /** Refresh derived facts from live state — evidence beats the seed. */
  async refresh(): Promise<void> {
    // Verified revenue — reconciled ledger only.
    const rev = await this.pool.query(
      `SELECT COALESCE(SUM(amount_cents),0)::int AS cents FROM revenue_ledger WHERE status = 'verified'`
    ).catch(() => ({ rows: [{ cents: 0 }] }));
    const cents = (rev.rows[0] as { cents: number }).cents ?? 0;
    await this.pool.query(
      `UPDATE business_facts SET value=$1, last_verified=now(), status='CURRENT', updated_at=now()
       WHERE kind='revenue' AND key='verified_total'`,
      [`$${(cents / 100).toFixed(2)} verified revenue (reconciled ledger). Test checkouts and checkouts-without-payment are NOT revenue.`],
    );
  }

  async getFacts(kind?: FactKind): Promise<BusinessFact[]> {
    const q = kind
      ? this.pool.query('SELECT kind,key,value,confidence,status,source,owner,last_verified FROM business_facts WHERE kind=$1 ORDER BY key', [kind])
      : this.pool.query('SELECT kind,key,value,confidence,status,source,owner,last_verified FROM business_facts ORDER BY kind, key');
    return (await q).rows as BusinessFact[];
  }

  /** Compact digest for a briefing — facts, not prose. */
  async digest(): Promise<string> {
    const facts = await this.getFacts();
    const products = facts.filter(f => f.kind === 'product');
    const revenue = facts.find(f => f.key === 'verified_total');
    const lines = [
      `Revenue truth: ${revenue?.value.slice(0, 90) ?? 'UNVERIFIED'}`,
      `Products (${products.length}):`,
      ...products.map(p => `  ${p.key}: ${p.status ?? 'CURRENT'} — ${p.value.slice(0, 90)}`),
    ];
    return lines.join('\n');
  }
}
