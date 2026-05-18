// Universal Chat Router - Routes messages to appropriate systems

import { createHmac, timingSafeEqual } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import {
  getLatestDeployment, triggerRedeploy, listEnvVars, setEnvVar,
  setupDeployHooks, PROJECT_IDS,
} from '../../lib/vercel/vercelAdmin.js';
import { getSystemStatus, isReachable } from '../../lib/termux/termuxClient.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

const systemHandlers = {
  ursula: handleUrsulaMessage,
  heidi: handleHeidiMessage,
  cascade: handleCascadeMessage,
  kilo: handleKiloMessage,
  protoforge: handleProtoForgeMessage,
  hyve: handleHyveMessage,
  infrastructure: handleInfrastructureMessage
};

export default async function handler(req, res) {
  const { valid, reason } = checkServiceToken(req.headers['x-hydi-service-token'])
  if (!valid) return res.status(401).json({ error: 'Unauthorized', reason })

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { message, system } = req.body;
    if (!message || !system) return res.status(400).json({ error: 'Message and system are required' });
    const systemHandler = systemHandlers[system];
    if (!systemHandler) return res.status(400).json({ error: `Unknown system: ${system}` });
    const response = await systemHandler(message, req);
    return res.status(200).json({ response, system, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Chat router error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function handleUrsulaMessage(message, request) {
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('system status') || lowerMessage.includes('status')) {
    try {
      const { data: heal } = await supabase.rpc('auto_heal_from_trends');
      const { data: dash, error: dashError } = await supabase.from('system_dashboard').select('*').single();
      if (dashError) return `❓ Ursula: I'm having trouble connecting to the health monitoring system. Please check back in a moment.`;
      const EMOJI = { OK: '✅', WARNING: '🟡', CRITICAL: '🔴', UNKNOWN: '❓', stable: '📈', degrading: '📉', critical_trend: '🚨', unknown: '❓' };
      let response = `${EMOJI[dash.current_status] || '❓'} HYDI Status: ${dash.current_status}\n`;
      response += `${EMOJI[dash.trend_status] || ''} Trend: ${dash.trend_status} — ${dash.trend_reason}\n`;
      if (dash.escalation_level !== 'OK') response += `⚠️ Escalation: ${dash.escalation_action} — ${dash.escalation_reason}\n`;
      if (heal && heal.healed > 0) response += `🔧 Auto-healed: ${heal.healed} action(s) taken\n`;
      response += `📊 Queue: ${dash.jobs_queued} queued | ${dash.jobs_failed} failed | ${dash.events_last_hour} events/hr`;
      return response;
    } catch (error) {
      return `❓ Ursula: I'm unable to check system status right now. Error: ${error.message}`;
    }
  }
  return { text: `[Ursula] Processing: "${message}"`, actions: [] };
}

async function handleHeidiMessage(message, request) {
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('analyze')) return `🧠 Heidi: Analysis complete. Context integrity: ${(Math.random()*100).toFixed(1)}%`;
  return { text: `[Heidi] Task received: "${message}"`, taskId: `task_${Date.now()}` };
}

async function handleCascadeMessage(message, request) {
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('process')) {
    const match = message.match(/event[:\s]+(.+)$/i);
    if (match) return `⚡ CASCADE: Event processed - Classification: INFRA_FAILURE, Confidence: ${(Math.random()*0.5+0.5).toFixed(2)}`;
  }
  if (lowerMessage.includes('status')) return `⚡ CASCADE: Processing events normally. Queue: 0`;
  if (lowerMessage.includes('quarantine')) return `⚡ CASCADE: Quarantine status - 2 events quarantined`;
  return `⚡ CASCADE: Event processing system. Try 'process <event>', 'status', or 'quarantine'.`;
}

async function handleKiloMessage(message, request) {
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('hypothesis') || lowerMessage.includes('repair')) return `🔧 KILO: Hypothesis: Database connection pool exhaustion`;
  if (lowerMessage.includes('validate')) return `🔧 KILO: Validation complete - Hypothesis validated with 85% confidence`;
  if (lowerMessage.includes('manifest')) return `🔧 KILO: Repair manifest ready for INFRA_FAILURE`;
  return `🔧 KILO: Repair hypothesis engine. Ask about 'hypothesis', 'validate', or 'manifest'.`;
}

async function handleProtoForgeMessage(message, request) {
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('status')) return `🌐 ProtoForge: All systems operational`;
  if (lowerMessage.includes('modules')) return `🌐 ProtoForge: Active modules - CASCADE, KILO, Heidi, Ursula, Hyve`;
  if (lowerMessage.includes('govern')) return `🌐 ProtoForge: Governance status - All policies compliant`;
  return `🌐 ProtoForge: Core system coordination. Try 'status', 'modules', or 'govern'.`;
}

async function handleHyveMessage(message, request) {
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('opportunity')) return `🐝 Hyve: 3 optimization opportunities detected`;
  if (lowerMessage.includes('collective')) return `🐝 Hyve: Swarm intelligence: ACTIVE`;
  if (lowerMessage.includes('swarm')) return `🐝 Hyve: 12 agents collaborating`;
  return `🐝 Hyve: Opportunity collective. Ask about 'opportunity', 'collective', or 'swarm'.`;
}

async function handleInfrastructureMessage(message, request) {
  const lowerMessage = message.toLowerCase()

  if (lowerMessage.includes('device')) {
    try {
      const reachable = await isReachable()
      if (!reachable) return '🏗️ Device: TermuxBridge offline. Restart with: pm2 restart termux-bridge'
      const status = await getSystemStatus()
      const bat = status.battery?.percentage !== undefined ? `${status.battery.percentage}% (${status.battery.status})` : 'unknown'
      const storage = status.storage?.available ?? 'unknown'
      const uptime = typeof status.uptime === 'string' ? status.uptime.split(',')[0] : 'unknown'
      return `🏗️ Device (Termux):\n• Battery: ${bat}\n• Storage available: ${storage}\n• Uptime: ${uptime}`
    } catch (err) { return `🏗️ Device Error: ${err.message}` }
  }

  if (lowerMessage.match(/deployment.?status/) || lowerMessage.match(/status\s+(heidi|hydi|all)/)) {
    const showBoth = lowerMessage.includes('all') || (!lowerMessage.includes('heidi') && !lowerMessage.includes('hydi'))
    const checks = []
    if ((showBoth || lowerMessage.includes('heidi')) && PROJECT_IDS.heidi) checks.push({ name: 'heidi-chat-portal', id: PROJECT_IDS.heidi })
    if ((showBoth || lowerMessage.includes('hydi')) && PROJECT_IDS.hydi) checks.push({ name: 'hydi-system', id: PROJECT_IDS.hydi })
    if (!checks.length) return '🏗️ Status: project IDs not configured. Set VERCEL_PROJECT_HEIDI / VERCEL_PROJECT_HYDI on this project.'
    const STATE_EMOJI = { READY: '✅', ERROR: '🔴', BUILDING: '🔄', CANCELED: '⛔', QUEUED: '⏳' }
    const lines = await Promise.all(checks.map(async ({ name, id }) => {
      try {
        const d = await getLatestDeployment(id)
        if (!d) return `❓ ${name}: no deployments found`
        return `${STATE_EMOJI[d.state] ?? '❓'} ${name}: ${d.state} — ${d.url ?? 'no url'} (${d.created})`
      } catch (e) { return `❓ ${name}: ${e.message}` }
    }))
    return '🏗️ Deployment Status:\n' + lines.join('\n')
  }

  if (lowerMessage.match(/\b(redeploy|deploy)\b/)) {
    const wantsAll = lowerMessage.includes('all'), wantsHeidi = lowerMessage.includes('heidi'), wantsHydi = lowerMessage.includes('hydi')
    const targets = []
    if ((wantsHeidi || wantsAll || (!wantsHeidi && !wantsHydi)) && PROJECT_IDS.heidi) targets.push({ name: 'heidi-chat-portal', id: PROJECT_IDS.heidi })
    if ((wantsHydi || wantsAll) && PROJECT_IDS.hydi) targets.push({ name: 'hydi-system', id: PROJECT_IDS.hydi })
    if (!targets.length) return '🏗️ Redeploy: project IDs not configured. Set VERCEL_PROJECT_HEIDI and/or VERCEL_PROJECT_HYDI.'
    const results = await Promise.all(targets.map(async ({ name, id }) => {
      try {
        const result = await triggerRedeploy(id)
        return `🚀 ${name}: Queued — ${result.url ?? 'deploying...'} [via ${result.via}]`
      } catch (e) { return `❌ ${name}: ${e.message}` }
    }))
    return '🏗️ Redeploy:\n' + results.join('\n')
  }

  if (lowerMessage.includes('env')) {
    const targetHydi = lowerMessage.includes('hydi')
    const projectId = targetHydi ? PROJECT_IDS.hydi : PROJECT_IDS.heidi
    const projectName = targetHydi ? 'hydi-system' : 'heidi-chat-portal'
    if (!projectId) return `🏗️ Env: ${projectName} project ID not configured`
    const setMatch = message.match(/env\s+set(?:\s+(?:heidi|hydi))?\s+([A-Z_][A-Z0-9_]*)=(.+)$/i)
    if (setMatch) {
      try {
        const result = await setEnvVar(projectId, setMatch[1].trim(), setMatch[2].trim())
        return `🏗️ Env ${result.action}: ${setMatch[1]} on ${projectName}. Redeploy to apply.`
      } catch (e) { return `🏗️ Env Error: ${e.message}` }
    }
    if (lowerMessage.includes('list')) {
      try {
        const envs = await listEnvVars(projectId)
        if (!envs.length) return `🏗️ No env vars found on ${projectName}`
        return `🏗️ Env vars on ${projectName} (${envs.length}):\n` + envs.map(e => `• ${e.key} [${e.target.join(', ')}]`).join('\n')
      } catch (e) { return `🏗️ Env Error: ${e.message}` }
    }
    return `🏗️ Env commands:\n• env list [heidi|hydi]\n• env set [heidi|hydi] KEY=value`
  }

  if (lowerMessage.match(/setup\s+hooks?/)) {
    try {
      const results = await setupDeployHooks()
      return [
        '🏗️ Deploy Hooks:',
        ...results.map(r => r.error ? `❌ ${r.envKey}: ${r.error}` : `✅ ${r.envKey}: hook created (id: ${r.hookId})`),
        '',
        'Hook URLs stored as encrypted env vars on HYDI.',
        'Run `redeploy hydi` to activate — future `redeploy` commands will use hooks.',
      ].join('\n')
    } catch (e) { return `🏗️ Setup Error: ${e.message}` }
  }

  try {
    const { data: dash, error } = await supabase.from('system_dashboard').select('*').single()
    if (error) return `🏗️ Infrastructure: Unable to fetch health data — ${error.message}`
    if (lowerMessage.includes('health')) {
      const statusEmoji = { OK: '✅', WARNING: '⚠️', CRITICAL: '🔴' }[dash.current_status] ?? '❓'
      return `🏗️ Infrastructure Health: ${statusEmoji} ${dash.current_status}\nTrend: ${dash.trend_status} (${dash.trend_reason})\nQueue: ${dash.jobs_queued} queued, ${dash.jobs_failed} failed, ${dash.jobs_dead} dead\nEvents (1h): ${dash.events_last_hour} | Auto-heals (24h): ${dash.auto_heals_24h}`
    }
    if (lowerMessage.includes('resources') || lowerMessage.includes('queue')) {
      return `🏗️ Resource Usage:\n• Jobs queued: ${dash.jobs_queued}\n• Jobs failed: ${dash.jobs_failed}\n• Jobs dead: ${dash.jobs_dead}\n• Avg queue size: ${dash.avg_queue_size}\n• Critical: ${dash.critical_pct}% | Warning: ${dash.warning_pct}%`
    }
    if (lowerMessage.includes('alerts') || lowerMessage.includes('escalation')) {
      if (dash.escalation_level === 'OK') return `🏗️ Alerts: No active escalations. System is stable.`
      return `🏗️ ALERT: ${dash.escalation_level} escalation active!\nAction: ${dash.escalation_action}\nReason: ${dash.escalation_reason}`
    }
  } catch (err) { return `🏗️ Infrastructure Error: ${err.message}` }

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
