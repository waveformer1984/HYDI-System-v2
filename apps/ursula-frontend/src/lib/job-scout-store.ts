/**
 * Server-side access to Heidi's job scout files (lib/job-scout/scout.js in
 * the repo root writes them):
 *
 *   leads.json      read-only here — the scout owns it
 *   status.json     read-only here
 *   decisions.json  written only here — Jordan's shortlist / dismiss / applied
 *
 * Ursula never contacts a job site and never applies; "applied" is a marker
 * Jordan sets after applying himself.
 */
import fs from 'fs';
import path from 'path';

export const DECISIONS = ['shortlisted', 'dismissed', 'applied'] as const;
export type Decision = (typeof DECISIONS)[number];

export interface ScoutLead {
  id: string;
  source: string;
  sourceUrl: string;
  title: string;
  description: string;
  company: string | null;
  budget: { min: number | null; max: number | null; currency: string; type: string; text?: string | null };
  skills: string[];
  postedAt: string | null;
  score: number;
  division: string | null;
  matched: string[];
  reasons: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  draft: string | null;
  decision?: { status: Decision; at: string } | null;
}

const ID_RE = /^[a-z]{2,16}:[A-Za-z0-9_-]{1,64}$/;

export function isValidLeadId(id: string): boolean {
  return ID_RE.test(id);
}

export function scoutDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.JOB_SCOUT_DIR) return path.resolve(env.JOB_SCOUT_DIR);
  // Ursula runs from apps/ursula-frontend; the scout writes at the repo root.
  return path.resolve(process.cwd(), '..', '..', '.runtime', 'job-scout');
}

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; }
}

export function readDecisions(dir = scoutDir()): Record<string, { status: Decision; at: string }> {
  return readJson(path.join(dir, 'decisions.json'), {});
}

export function readScout(dir = scoutDir()) {
  const status = readJson<Record<string, unknown> | null>(path.join(dir, 'status.json'), null);
  const { leads = [] } = readJson<{ leads?: ScoutLead[] }>(path.join(dir, 'leads.json'), {});
  const decisions = readDecisions(dir);
  return {
    status,
    leads: leads.map((l) => ({ ...l, decision: decisions[l.id] || null })),
  };
}

const MAX_DECISIONS = 5000;

export function setDecision(id: string, status: Decision | 'clear', dir = scoutDir(), now = new Date()) {
  if (!isValidLeadId(id)) throw new Error('invalid lead id');
  // Only values from our own allowlist are ever written — never the raw
  // request string. The file path is fixed; the id is regex-checked above.
  const allowed = status === 'clear' ? 'clear' : DECISIONS.find((d) => d === status);
  if (!allowed) throw new Error('invalid status');
  const file = path.join(dir, 'decisions.json');
  const decisions = readDecisions(dir);
  if (allowed === 'clear') delete decisions[id];
  else {
    if (!(id in decisions) && Object.keys(decisions).length >= MAX_DECISIONS) throw new Error('too many decisions recorded');
    decisions[id] = { status: allowed, at: now.toISOString() };
  }
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(decisions, null, 2));
  fs.renameSync(tmp, file);
  return decisions[id] || null;
}
