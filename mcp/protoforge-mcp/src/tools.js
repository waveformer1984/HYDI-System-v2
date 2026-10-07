// ProtoForge MCP tool catalog.
//
// Every tool declares a `risk` tier. v0.1 ships only `read` tools; the
// registry (registerAll) refuses to expose anything else, so a write tool
// can't reach a phone by accident. Write tiers arrive with the Heidi gate:
//
//   read        — no side effects. Exposed.
//   reversible  — logged, undoable writes (labels, drafts, task status).
//   gated       — money, sending, deleting, restarting: must pass the triple
//                 gate (HEIDI_ALLOW_EXEC + AUTO-APPROVE ≥ 0.85 + within
//                 heidi_decision_bounds) or an explicit human approval.

import { z } from 'zod';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { STREAMS, REPO_ROOT } from './config.js';
import { request, hydiGet, supabaseSelect, stripeGet } from './clients.js';

export const RISK_TIERS = ['read', 'reversible', 'gated'];
export const EXPOSED_TIERS = new Set(['read']);

const limitArg = (def, max) => z.number().int().min(1).max(max).default(def).describe(`Rows to return (1-${max}, default ${def})`);

/** Shape a client result into what the agent sees. */
function outcome(r, pick = (b) => b) {
  if (r.ok) return { ok: true, data: pick(r.body) };
  return { ok: false, status: r.status || undefined, error: r.error || summarizeBody(r.body) };
}

/** Kahn topological sort over dependsOn, as scripts/boot-agent.js does. Returns null on a cycle. */
export function topoSort(modules) {
  const ids = new Set(modules.map((m) => m.id));
  const indeg = new Map(modules.map((m) => [m.id, 0]));
  const edges = new Map(modules.map((m) => [m.id, []]));
  for (const m of modules) {
    for (const dep of m.dependsOn || []) {
      if (!ids.has(dep)) continue;
      edges.get(dep).push(m.id);
      indeg.set(m.id, indeg.get(m.id) + 1);
    }
  }
  const byId = new Map(modules.map((m) => [m.id, m]));
  const queue = modules.filter((m) => indeg.get(m.id) === 0).map((m) => m.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(byId.get(id));
    for (const next of edges.get(id)) {
      indeg.set(next, indeg.get(next) - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  return order.length === modules.length ? order : null;
}

function summarizeBody(body) {
  if (!body) return 'no response body';
  if (typeof body === 'string') return body.slice(0, 300);
  return body.error || body.message || body.reason || JSON.stringify(body).slice(0, 300);
}

export const TOOLS = [
  {
    name: 'system_health',
    title: 'System health',
    risk: 'read',
    description:
      'Check whether each HYDI service on Frank is up: protoforge-core (CASCADE/KILO/ProtoForge pipeline), heidi-web (Next.js + API), and heidi-mobile-chat. Use first when asked "is everything running?".',
    inputSchema: {},
    async handler(_args, { cfg, deps }) {
      const targets = [
        ['protoforge-core', `${cfg.protoforgeCoreUrl}/health`],
        ['heidi-web', `${cfg.heidiWebUrl}/api/health`],
        ['heidi-mobile-chat', `${cfg.mobileChatUrl}/api/health`],
      ];
      const checks = await Promise.all(
        targets.map(async ([service, url]) => {
          const started = Date.now();
          const r = await request(url, { timeoutMs: Math.min(cfg.timeoutMs, 4000), fetchImpl: deps.fetchImpl });
          return {
            service,
            up: r.ok,
            status: r.status || undefined,
            latency_ms: Date.now() - started,
            ...(r.ok ? {} : { error: r.error || summarizeBody(r.body) }),
          };
        }),
      );
      return { all_up: checks.every((c) => c.up), checks };
    },
  },
  {
    name: 'mobile_status',
    title: 'Business snapshot',
    risk: 'read',
    description:
      'Compact snapshot from heidi-web /api/mobile-status: system health, revenue per Stripe Connect stream, and pipeline stage latency. Use for "how is the business doing?" or a daily brief.',
    inputSchema: {},
    async handler(_args, { cfg, deps }) {
      return outcome(await hydiGet(cfg, '/api/mobile-status', deps));
    },
  },
  {
    name: 'pending_approvals',
    title: 'Pending approvals',
    risk: 'read',
    description:
      'List actions ProtoForge escalated for human review that are still waiting on a decision (GET /api/actions): type, reasoning summary, confidence, age. Read-only — approving is a separate, gated step.',
    inputSchema: {},
    async handler(_args, { cfg, deps }) {
      return outcome(await hydiGet(cfg, '/api/actions', deps), (b) => ({
        count: Array.isArray(b && b.actions) ? b.actions.length : 0,
        actions: (b && b.actions) || [],
      }));
    },
  },
  {
    name: 'recent_actions',
    title: 'Recent actions',
    risk: 'read',
    description:
      'Recent rows from the Supabase `actions` log (newest first), optionally filtered by status. Payloads are omitted; returns id, task_name, status, session and time.',
    inputSchema: {
      status: z.enum(['pending', 'completed', 'failed']).optional().describe('Only rows with this status'),
      limit: limitArg(20, 100),
    },
    async handler({ status, limit = 20 }, { cfg, deps }) {
      const query = { select: 'id,task_name,status,session_id,created_at', order: 'created_at.desc', limit: String(limit) };
      if (status) query.status = `eq.${status}`;
      return outcome(await supabaseSelect(cfg, 'actions', query, deps), (rows) => ({ count: rows.length, rows }));
    },
  },
  {
    name: 'heidi_events',
    title: 'Heidi decision log',
    risk: 'read',
    description:
      "Heidi's decision audit trail from `heidi_events` (newest first): event type, division, verdict (AUTO-APPROVE / REVIEW / BLOCK). Optionally filter by division or verdict.",
    inputSchema: {
      division: z.string().min(1).max(64).optional().describe('ProtoForge division, e.g. galactic_bytes'),
      verdict: z.enum(['AUTO-APPROVE', 'REVIEW', 'BLOCK']).optional(),
      limit: limitArg(20, 100),
    },
    async handler({ division, verdict, limit = 20 }, { cfg, deps }) {
      const query = { select: 'id,event_type,division,verdict,created_at', order: 'created_at.desc', limit: String(limit) };
      if (division) query.division = `eq.${division}`;
      if (verdict) query.verdict = `eq.${verdict}`;
      return outcome(await supabaseSelect(cfg, 'heidi_events', query, deps), (rows) => ({ count: rows.length, rows }));
    },
  },
  {
    name: 'decision_bounds',
    title: 'Autonomy bounds',
    risk: 'read',
    description:
      "Heidi's current autonomy limits from `heidi_decision_bounds`: auto-approve confidence threshold, max auto-approve amount, and who holds the agent lease. Use before proposing any autonomous action.",
    inputSchema: {},
    async handler(_args, { cfg, deps }) {
      const r = await supabaseSelect(
        cfg,
        'heidi_decision_bounds',
        { select: 'auto_approve_threshold,max_auto_approve_amount,lease_holder,lease_expires,updated_at', order: 'updated_at.desc', limit: '1' },
        deps,
      );
      return outcome(r, (rows) => {
        const row = rows[0] || null;
        const leaseActive = !!(row && row.lease_holder && row.lease_expires && Date.parse(row.lease_expires) > Date.now());
        return {
          configured: !!row,
          bounds: row,
          lease_active: leaseActive,
          exec_enabled_here: cfg.env.HEIDI_ALLOW_EXEC === 'true',
        };
      });
    },
  },
  {
    name: 'stripe_balance',
    title: 'Stripe balance',
    risk: 'read',
    description:
      'Read-only Stripe balance (available and pending, per currency) for the platform account, or for one revenue stream\'s Connect sub-account. Amounts are in the smallest currency unit (cents).',
    inputSchema: {
      stream: z.enum(STREAMS).optional().describe('Revenue stream; omit for the platform account'),
    },
    async handler({ stream }, { cfg, deps }) {
      let account;
      if (stream) {
        const envName = `STRIPE_ACCOUNT_${stream.toUpperCase()}`;
        account = cfg.env[envName];
        if (!account) return { ok: false, error: `${envName} is not set, so that stream's sub-account is unknown` };
      }
      return outcome(await stripeGet(cfg, '/v1/balance', { account }, deps), (b) => ({
        scope: stream || 'platform',
        livemode: b.livemode,
        available: (b.available || []).map(({ amount, currency }) => ({ amount, currency })),
        pending: (b.pending || []).map(({ amount, currency }) => ({ amount, currency })),
      }));
    },
  },
  {
    name: 'boot_plan',
    title: 'Boot plan',
    risk: 'read',
    description:
      'The HYDI boot plan from boot.config.json: which modules are enabled, their boot order, ports, health URLs and dependencies. Use when diagnosing why something is down.',
    inputSchema: {},
    // Deliberately does NOT run `boot-agent.js --dry-run`: that claims the
    // canonical boot lease before checking the flag, which makes the live
    // PM2 runtime stand down (exit 75, not respawned). Reading the config
    // and ordering it the same way (Kahn over dependsOn) is side-effect free.
    async handler(_args, { deps }) {
      const configPath = path.join(deps.repoRoot || REPO_ROOT, 'boot.config.json');
      let config;
      try {
        config = JSON.parse(await (deps.readFileImpl || readFile)(configPath, 'utf8'));
      } catch (err) {
        return { ok: false, error: `cannot read boot.config.json: ${err instanceof Error ? err.message : 'unknown error'}` };
      }
      const all = Array.isArray(config.modules) ? config.modules : [];
      const enabled = all.filter((m) => m.enabled !== false);
      const order = topoSort(enabled);
      if (!order) return { ok: false, error: 'dependency cycle in boot.config.json' };
      return {
        ok: true,
        order: order.map((m, i) => ({
          step: i + 1,
          id: m.id,
          label: m.label,
          type: m.type,
          required: m.required !== false,
          port: m.port,
          health: m.health && m.health.url,
          depends_on: m.dependsOn || [],
        })),
        disabled: all.filter((m) => m.enabled === false).map((m) => m.id),
        required_env: (config.settings && config.settings.requiredEnv) || [],
      };
    },
  },
];

/**
 * Register every exposed tool on an McpServer. Throws at startup if any tool
 * declares an unknown tier, so a mis-tagged tool fails loudly, not silently.
 */
export function registerAll(server, ctx, tools = TOOLS) {
  const registered = [];
  for (const tool of tools) {
    if (!RISK_TIERS.includes(tool.risk)) throw new Error(`tool ${tool.name}: unknown risk tier '${tool.risk}'`);
    if (!EXPOSED_TIERS.has(tool.risk)) continue;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        try {
          const result = await tool.handler(args || {}, ctx);
          const isError = result && result.ok === false;
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError };
        } catch (err) {
          return { content: [{ type: 'text', text: `${tool.name} failed: ${err instanceof Error ? err.message : 'unknown error'}` }], isError: true };
        }
      },
    );
    registered.push(tool.name);
  }
  return registered;
}
