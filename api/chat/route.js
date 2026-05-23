// Universal Chat Router - Routes messages to appropriate systems
// Fixed for Node.js/Express (not Next.js)

import { createHmac, timingSafeEqual } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import {
  getLatestDeployment, triggerRedeploy, listEnvVars, setEnvVar,
  setupDeployHooks, PROJECT_IDS,
} from '../../lib/vercel/vercelAdmin.js';
import { getSystemStatus, isReachable } from '../../lib/termux/termuxClient.js';
import { callAgent, isClaudeAvailable } from '../../lib/claude.js';
import { executeApprovedActions } from '../../lib/protoforge/dispatcher.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Service token guard ───────────────────────────────────────────────────────
// Replaces bare x-user-id header trust. Callers must present an HMAC-SHA256
// token in x-hydi-service-token signed with the shared HYDI_SERVICE_SECRET.

const SERVICE_TOKEN_WINDOW_MS = 5 * 60 * 1000

function checkServiceToken(token) {
  const secret = process.env.HYDI_SERVICE_SECRET
  if (!token) return { valid: false, reason: 'missing token' }
  if (!secret) return { valid: false, reason: 'service secret not configured' }
  const parts = token.split('.')
  if (parts.length !== 4) return { valid: false, reason: 'malformed token' }
  const [ts, requestId, service, sig] = parts
  const timestamp = parseInt(ts, 10)
  if (isNaN(timestamp) || Math.abs(Date.now() - timestamp) > SERVICE_TOKEN_WINDOW_MS) {
    return { valid: false, reason: 'token expired or clock skew exceeds 5 minutes' }
  }
  const payload = `${ts}:${requestId}:${service}`
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  try {
    const expectedBuf = Buffer.from(expected, 'hex')
    const sigBuf = Buffer.from(sig, 'hex')
    if (expectedBuf.length !== sigBuf.length || !timingSafeEqual(expectedBuf, sigBuf)) {
      return { valid: false, reason: 'signature mismatch' }
    }
  } catch (_) {
    return { valid: false, reason: 'invalid signature encoding' }
  }
  return { valid: true, service, requestId }
}

// ── System handlers ───────────────────────────────────────────────────────────

const systemHandlers = {
  ursula: handleUrsulaMessage,
  heidi: handleHeidiMessage,
  cascade: handleCascadeMessage,
  kilo: handleKiloMessage,
  protoforge: handleProtoForgeMessage,
  hyve: handleHyveMessage,
  infrastructure: handleInfrastructureMessage,
  rezonate: handleRezonateMessage
};

export default async function handler(req, res) {
  // Verify service token before processing any request
  const { valid, reason } = checkServiceToken(req.headers['x-hydi-service-token'])
  if (!valid) {
    return res.status(401).json({ error: 'Unauthorized', reason })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { message, system } = req.body;
    
    if (!message || !system) {
      return res.status(400).json({
        error: 'Message and system are required'
      });
    }
    
    const systemHandler = systemHandlers[system];
    if (!systemHandler) {
      return res.status(400).json({
        error: `Unknown system: ${system}`
      });
    }
    
    const response = await systemHandler(message, req);
    
    return res.status(200).json({
      response: response,
      system: system,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Chat router error:', error);
    return res.status(500).json({
      error: error.message
    });
  }
}

// ── Individual system handlers ────────────────────────────────────────────────

async function handleUrsulaMessage(message, request) {
  let dashContext = '';
  try {
    const [healResult, dashResult] = await Promise.all([
      supabase.rpc('auto_heal_from_trends'),
      supabase.from('system_dashboard').select('*').single(),
    ]);
    if (!dashResult.error && dashResult.data) {
      dashContext = `Live system_dashboard:\n${JSON.stringify(dashResult.data, null, 2)}`;
      if (healResult.data?.healed > 0) {
        dashContext += `\nauto_heal: ${healResult.data.healed} action(s) taken`;
      }
    }
  } catch (_) {}

  if (isClaudeAvailable()) {
    return callAgent('ursula', message, dashContext || undefined);
  }

  // Structured fallback using raw dashboard data
  if (dashContext) {
    try {
      const { data: dash } = await supabase.from('system_dashboard').select('*').single();
      if (dash) {
        const S = { OK: '✅', WARNING: '🟡', CRITICAL: '🔴', UNKNOWN: '❓' };
        const T = { stable: '📈', degrading: '📉', critical_trend: '🚨', unknown: '❓' };
        let r = `${S[dash.current_status] || '❓'} HYDI: ${dash.current_status}\n`;
        r += `${T[dash.trend_status] || ''} Trend: ${dash.trend_status} — ${dash.trend_reason}\n`;
        if (dash.escalation_level !== 'OK') r += `⚠️ ${dash.escalation_action} — ${dash.escalation_reason}\n`;
        r += `📊 Queue: ${dash.jobs_queued} queued | ${dash.jobs_failed} failed | ${dash.events_last_hour} events/hr`;
        return r;
      }
    } catch (_) {}
  }
  return `❓ Ursula: ANTHROPIC_API_KEY not configured and no dashboard data available.`;
}

async function handleHeidiMessage(message, request) {
  if (isClaudeAvailable()) {
    return callAgent('heidi', message);
  }
  return `🧠 Heidi: ANTHROPIC_API_KEY not configured. Set it to enable live AI responses.`;
}

async function handleCascadeMessage(message, request) {
  if (isClaudeAvailable()) {
    return callAgent('cascade', message);
  }
  return JSON.stringify({
    classification: 'UNKNOWN',
    confidence: 0,
    matched_rules: [],
    severity: 'low',
    requires_kilo: false,
    note: 'ANTHROPIC_API_KEY not configured — classification unavailable'
  }, null, 2);
}

async function handleKiloMessage(message, request) {
  if (isClaudeAvailable()) {
    return callAgent('kilo', message);
  }
  return JSON.stringify({
    hypotheses: [],
    execution_authority: false,
    requires_protoforge_approval: true,
    note: 'ANTHROPIC_API_KEY not configured — hypothesis generation unavailable'
  }, null, 2);
}

async function handleProtoForgeMessage(message, request) {
  if (!isClaudeAvailable()) {
    return JSON.stringify({
      decision: 'deferred',
      rationale: 'ANTHROPIC_API_KEY not configured — governance evaluation unavailable',
      approved_actions: [],
      conditions: ''
    }, null, 2);
  }

  const raw = await callAgent('protoforge', message);

  // If approved actions were returned, attempt to dispatch them
  try {
    const parsed = JSON.parse(raw);
    if (parsed.decision === 'approved' && Array.isArray(parsed.approved_actions) && parsed.approved_actions.length > 0) {
      const results = await executeApprovedActions(parsed.approved_actions);
      parsed.dispatch_results = results;
      return JSON.stringify(parsed, null, 2);
    }
  } catch (_) {}

  return raw;
}

async function handleHyveMessage(message, request) {
  if (isClaudeAvailable()) {
    return callAgent('hyve', message);
  }
  return `🐝 Hyve: ANTHROPIC_API_KEY not configured — swarm intelligence offline.`;
}

async function handleInfrastructureMessage(message, request) {
  const lowerMessage = message.toLowerCase()

  // ── Device telemetry (TermuxBridge) ─────────────────────────────────────────
  if (lowerMessage.includes('device')) {
    try {
      const reachable = await isReachable()
      if (!reachable) {
        return '🏗️ Device: TermuxBridge offline. Restart with: pm2 restart termux-bridge'
      }
      const status = await getSystemStatus()
      const bat = status.battery?.percentage !== undefined
        ? `${status.battery.percentage}% (${status.battery.status})`
        : 'unknown'
      const storage = status.storage?.available ?? 'unknown'
      const uptime = typeof status.uptime === 'string'
        ? status.uptime.split(',')[0]
        : 'unknown'
      return `🏗️ Device (Termux):\n• Battery: ${bat}\n• Storage available: ${storage}\n• Uptime: ${uptime}`
    } catch (err) {
      return `🏗️ Device Error: ${err.message}`
    }
  }

  // ── Deployment status ────────────────────────────────────────────────────────
  if (lowerMessage.match(/deployment.?status/) || lowerMessage.match(/status\s+(heidi|hydi|all)/)) {
    const showBoth = lowerMessage.includes('all') || (!lowerMessage.includes('heidi') && !lowerMessage.includes('hydi'))
    const checks = []
    if ((showBoth || lowerMessage.includes('heidi')) && PROJECT_IDS.heidi) {
      checks.push({ name: 'heidi-chat-portal', id: PROJECT_IDS.heidi })
    }
    if ((showBoth || lowerMessage.includes('hydi')) && PROJECT_IDS.hydi) {
      checks.push({ name: 'hydi-system', id: PROJECT_IDS.hydi })
    }
    if (!checks.length) {
      return '🏗️ Status: project IDs not configured. Set VERCEL_PROJECT_HEIDI / VERCEL_PROJECT_HYDI on this project.'
    }
    const STATE_EMOJI = { READY: '✅', ERROR: '🔴', BUILDING: '🔄', CANCELED: '⛔', QUEUED: '⏳' }
    const lines = await Promise.all(checks.map(async ({ name, id }) => {
      try {
        const d = await getLatestDeployment(id)
        if (!d) return `❓ ${name}: no deployments found`
        const emoji = STATE_EMOJI[d.state] ?? '❓'
        return `${emoji} ${name}: ${d.state} — ${d.url ?? 'no url'} (${d.created})`
      } catch (e) {
        return `❓ ${name}: ${e.message}`
      }
    }))
    return '🏗️ Deployment Status:\n' + lines.join('\n')
  }

  // ── Redeploy ─────────────────────────────────────────────────────────────────
  if (lowerMessage.match(/\b(redeploy|deploy)\b/)) {
    const wantsAll = lowerMessage.includes('all')
    const wantsHeidi = lowerMessage.includes('heidi')
    const wantsHydi = lowerMessage.includes('hydi')
    const defaultBoth = !wantsHeidi && !wantsHydi
    const targets = []
    if ((wantsHeidi || wantsAll || defaultBoth) && PROJECT_IDS.heidi) {
      targets.push({ name: 'heidi-chat-portal', id: PROJECT_IDS.heidi })
    }
    if ((wantsHydi || wantsAll) && PROJECT_IDS.hydi) {
      targets.push({ name: 'hydi-system', id: PROJECT_IDS.hydi })
    }
    if (!targets.length) {
      return '🏗️ Redeploy: project IDs not configured. Set VERCEL_PROJECT_HEIDI and/or VERCEL_PROJECT_HYDI.'
    }
    const results = await Promise.all(targets.map(async ({ name, id }) => {
      try {
        const result = await triggerRedeploy(id)
        return `🚀 ${name}: Queued — ${result.url ?? 'deploying...'} [via ${result.via}]`
      } catch (e) {
        return `❌ ${name}: ${e.message}`
      }
    }))
    return '🏗️ Redeploy:\n' + results.join('\n')
  }

  // ── Env var management ───────────────────────────────────────────────────────
  if (lowerMessage.includes('env')) {
    const targetHydi = lowerMessage.includes('hydi')
    const projectId = targetHydi ? PROJECT_IDS.hydi : PROJECT_IDS.heidi
    const projectName = targetHydi ? 'hydi-system' : 'heidi-chat-portal'
    if (!projectId) return `🏗️ Env: ${projectName} project ID not configured`

    const setMatch = message.match(/env\s+set(?:\s+(?:heidi|hydi))?\s+([A-Z_][A-Z0-9_]*)=(.+)$/i)
    if (setMatch) {
      const [, key, value] = setMatch
      try {
        const result = await setEnvVar(projectId, key.trim(), value.trim())
        return `🏗️ Env ${result.action}: ${key} on ${projectName}. Redeploy to apply.`
      } catch (e) {
        return `🏗️ Env Error: ${e.message}`
      }
    }

    if (lowerMessage.includes('list')) {
      try {
        const envs = await listEnvVars(projectId)
        if (!envs.length) return `🏗️ No env vars found on ${projectName}`
        const lines = envs.map(e => `• ${e.key} [${e.target.join(', ')}]`).join('\n')
        return `🏗️ Env vars on ${projectName} (${envs.length}):\n${lines}`
      } catch (e) {
        return `🏗️ Env Error: ${e.message}`
      }
    }

    return `🏗️ Env commands:\n• env list [heidi|hydi]\n• env set [heidi|hydi] KEY=value`
  }

  // ── Self-provisioning: create Vercel deploy hooks ────────────────────────────
  if (lowerMessage.match(/setup\s+hooks?/)) {
    try {
      const results = await setupDeployHooks()
      const lines = results.map(r =>
        r.error
          ? `❌ ${r.envKey}: ${r.error}`
          : `✅ ${r.envKey}: hook created (id: ${r.hookId})`
      )
      return [
        '🏗️ Deploy Hooks:',
        ...lines,
        '',
        'Hook URLs stored as encrypted env vars on HYDI.',
        'Run `redeploy hydi` to activate — future `redeploy` commands will use hooks.',
      ].join('\n')
    } catch (e) {
      return `🏗️ Setup Error: ${e.message}`
    }
  }

  // ── Supabase health monitoring (existing) ────────────────────────────────────
  try {
    const { data: dash, error } = await supabase
      .from('system_dashboard')
      .select('*')
      .single()

    if (error) {
      return `🏗️ Infrastructure: Unable to fetch health data — ${error.message}`
    }

    if (lowerMessage.includes('health')) {
      const statusEmoji = { OK: '✅', WARNING: '⚠️', CRITICAL: '🔴' }[dash.current_status] ?? '❓'
      return `🏗️ Infrastructure Health: ${statusEmoji} ${dash.current_status}\n` +
             `Trend: ${dash.trend_status} (${dash.trend_reason})\n` +
             `Queue: ${dash.jobs_queued} queued, ${dash.jobs_failed} failed, ${dash.jobs_dead} dead\n` +
             `Events (1h): ${dash.events_last_hour} | Auto-heals (24h): ${dash.auto_heals_24h}`
    }

    if (lowerMessage.includes('resources') || lowerMessage.includes('queue')) {
      return `🏗️ Resource Usage:\n` +
             `• Jobs queued: ${dash.jobs_queued}\n` +
             `• Jobs failed: ${dash.jobs_failed}\n` +
             `• Jobs dead: ${dash.jobs_dead}\n` +
             `• Avg queue size: ${dash.avg_queue_size}\n` +
             `• Critical: ${dash.critical_pct}% | Warning: ${dash.warning_pct}%`
    }

    if (lowerMessage.includes('alerts') || lowerMessage.includes('escalation')) {
      if (dash.escalation_level === 'OK') {
        return `🏗️ Alerts: No active escalations. System is stable.`
      }
      return `🏗️ ALERT: ${dash.escalation_level} escalation active!\n` +
             `Action: ${dash.escalation_action}\n` +
             `Reason: ${dash.escalation_reason}`
    }
  } catch (err) {
    return `🏗️ Infrastructure Error: ${err.message}`
  }

  // Unknown command — try Claude for intelligent interpretation
  if (isClaudeAvailable()) {
    return callAgent('infrastructure', message);
  }

  return [
    '🏗️ Heidi Infrastructure Controls:',
    '  deployment status [heidi|hydi|all]  — check Vercel deployment state',
    '  redeploy [heidi|hydi|all]           — trigger new Vercel deployment',
    '  env list [heidi|hydi]               — list env var names (values hidden)',
    '  env set [heidi|hydi] KEY=value      — update env var (redeploy to apply)',
    '  setup hooks                         — create Vercel deploy hooks (run once)',
    '  device                              — TermuxBridge battery/storage/uptime',
    '  health / resources / alerts / queue — HYDI system monitoring',
  ].join('\n')
}

async function handleRezonateMessage(message, request) {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('project')) {
    try {
      const { count, error } = await supabase
        .from('rezonate_projects')
        .select('id', { count: 'exact', head: true });
      if (error) {
        return `🎵 Rezonate: Unable to fetch project count.`;
      }
      return `🎵 Rezonate: ${count} active projects in your workspace.`;
    } catch (_) {
      return `🎵 Rezonate: Unable to fetch project count.`;
    }
  }

  if (lowerMessage.includes('task') || lowerMessage.includes('dispatch')) {
    return [
      '🎵 Rezonate: Available task types:',
      '  • stem_analysis    — isolate and analyse audio stems',
      '  • mix_analysis     — evaluate mix balance and dynamics',
      '  • audio_export     — render and export audio in target format',
      '  • nft_mint         — mint audio asset as NFT',
      '  • rights_verify    — verify ownership and licensing rights',
      '  • session_recall   — restore a previous session snapshot',
      '  • hardware_map     — map connected audio hardware devices',
      '  • beat_generate    — generate a beat from a style prompt',
    ].join('\n');
  }

  if (lowerMessage.includes('status') || lowerMessage.includes('health')) {
    const nodeType = 'rezonate-audio-node';
    const capabilities = ['stem_analysis', 'mix_analysis', 'audio_export', 'nft_mint', 'rights_verify', 'session_recall', 'hardware_map', 'beat_generate'];
    const federationTrustLevel = 'verified';
    return [
      '🎵 Rezonate Node Manifest:',
      `  • Node type: ${nodeType}`,
      `  • Capabilities: ${capabilities.length} registered`,
      `  • Federation trust level: ${federationTrustLevel}`,
    ].join('\n');
  }

  return [
    '🎵 Rezonate: Audio intelligence node. Available commands:',
    '  project  — show active project count',
    '  task / dispatch  — list available task types',
    '  status / health  — show node manifest and federation trust',
  ].join('\n');
}

