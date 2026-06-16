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
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('system status') || lowerMessage.includes('status')) {
    try {
      const { data: heal } = await supabase.rpc('auto_heal_from_trends');
      
      const { data: dash, error: dashError } = await supabase
        .from('system_dashboard')
        .select('*')
        .single();

      if (dashError) {
        return `❓ Ursula: I'm having trouble connecting to the health monitoring system. Please check back in a moment.`;
      }

      const EMOJI = {
        OK: '✅', WARNING: '🟡', CRITICAL: '🔴', UNKNOWN: '❓',
        stable: '📈', degrading: '📉', critical_trend: '🚨', unknown: '❓'
      };

      let response = `${EMOJI[dash.current_status] || '❓'} HYDI Status: ${dash.current_status}\n`;
      response += `${EMOJI[dash.trend_status] || ''} Trend: ${dash.trend_status} — ${dash.trend_reason}\n`;
      
      if (dash.escalation_level !== 'OK') {
        response += `⚠️ Escalation: ${dash.escalation_action} — ${dash.escalation_reason}\n`;
      }
      
      if (heal && heal.healed > 0) {
        response += `🔧 Auto-healed: ${heal.healed} action(s) taken\n`;
      }
      
      response += `📊 Queue: ${dash.jobs_queued} queued | ${dash.jobs_failed} failed | ${dash.events_last_hour} events/hr`;
      
      return response;
    } catch (error) {
      console.error('Ursula status query error:', error);
      return `❓ Ursula: I'm unable to check system status right now. Error: ${error.message}`;
    }
  }
  
  return {
    text: `[Ursula] Processing: "${message}"`,
    actions: []
  };
}

async function handleHeidiMessage(message, request) {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('analyze')) {
    return `🧠 Heidi: Analysis complete. Context integrity: ${await getContextIntegrity()}`;
  }
  
  return {
    text: `[Heidi] Task received: "${message}"`,
    taskId: `task_${Date.now()}`
  };
}

async function handleCascadeMessage(message, request) {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('process')) {
    const event = extractEventFromMessage(message);
    if (event) {
      const result = await processCascadeEvent(event);
      return `⚡ CASCADE: Event processed - Classification: ${result.classification}, Confidence: ${result.confidence}`;
    }
  }
  
  if (lowerMessage.includes('status')) {
    return `⚡ CASCADE: ${await getCascadeStatus()}`;
  }

  if (lowerMessage.includes('quarantine')) {
    return `⚡ CASCADE: Quarantine status - ${await getQuarantineStatus()}`;
  }
  
  return `⚡ CASCADE: Event processing system. Try 'process <event>', 'status', or 'quarantine'.`;
}

async function handleKiloMessage(message, request) {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('hypothesis') || lowerMessage.includes('repair')) {
    return `🔧 KILO: Generating repair hypothesis based on current system state... ${await generateHypothesis()}`;
  }

  if (lowerMessage.includes('validate')) {
    return `🔧 KILO: Validation complete - ${await getValidationResult()}`;
  }

  if (lowerMessage.includes('manifest')) {
    return `🔧 KILO: Repair manifest ready - ${await getRepairManifest()}`;
  }
  
  return `🔧 KILO: Repair hypothesis engine. Ask about 'hypothesis', 'validate', or 'manifest'.`;
}

async function handleProtoForgeMessage(message, request) {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('status')) {
    return `🌐 ProtoForge: Core system status - ${await getProtoForgeStatus()}`;
  }

  if (lowerMessage.includes('modules')) {
    return `🌐 ProtoForge: Active modules - ${await getActiveModules()}`;
  }

  if (lowerMessage.includes('govern')) {
    return `🌐 ProtoForge: Governance status - ${await getGovernanceStatus()}`;
  }
  
  return `🌐 ProtoForge: Core system coordination. Try 'status', 'modules', or 'govern'.`;
}

async function handleRezonateMessage(message, request) {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('track') || lowerMessage.includes('project')) {
    const { data, error } = await supabase
      .from('rezonate_tracks')
      .select('id, title, status')
      .order('updated_at', { ascending: false })
      .limit(5);
    if (error || !data) return '🎵 Rezonate: No active tracks found.';
    const list = data.map(t => `• ${t.title} [${t.status}]`).join('\n');
    return `🎵 Rezonate: Active tracks:\n${list}`;
  }

  if (lowerMessage.includes('status')) {
    return `🎵 Rezonate: Music production system online. Waveformer Studio active.`;
  }

  return `🎵 Rezonate: Music production interface. Try 'tracks', 'status', or 'project'.`;
}

async function handleHyveMessage(message, request) {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('opportunity')) {
    return `🐝 Hyve: Current opportunities - ${await getOpportunities()}`;
  }
  
  if (lowerMessage.includes('collective')) {
    return `🐝 Hyve: Collective status - ${await getCollectiveStatus()}`;
  }

  if (lowerMessage.includes('swarm')) {
    return `🐝 Hyve: Swarm intelligence active - ${await getSwarmStatus()}`;
  }
  
  return `🐝 Hyve: Opportunity collective. Ask about 'opportunity', 'collective', or 'swarm'.`;
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

// ── Helper utilities ──────────────────────────────────────────────────────────

function extractEventFromMessage(message) {
  const match = message.match(/event[:\s]+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function getContextIntegrity() {
  const { data } = await supabase.from('system_dashboard').select('critical_pct, warning_pct').single();
  if (!data) return 'unknown';
  const integrity = (100 - (data.critical_pct || 0) - (data.warning_pct || 0) / 2).toFixed(1);
  return `${integrity}%`;
}

async function processCascadeEvent(event) {
  const { data, error } = await supabase
    .from('cascade_events')
    .insert({ event_type: event, status: 'queued', payload: { raw: event } })
    .select()
    .single();
  if (error) return { classification: 'UNKNOWN', confidence: '0.00' };
  return {
    classification: data.event_type?.toUpperCase() || 'QUEUED',
    confidence: '1.00'
  };
}

async function getCascadeStatus() {
  const { count } = await supabase
    .from('cascade_events')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'queued');
  const { count: deadCount } = await supabase
    .from('dead_letters')
    .select('*', { count: 'exact', head: true });
  return `Processing events normally. Queue: ${count ?? 0} | Dead letters: ${deadCount ?? 0}`;
}

async function getQuarantineStatus() {
  const { count } = await supabase
    .from('quarantine')
    .select('*', { count: 'exact', head: true });
  return `${count ?? 0} events quarantined`;
}

async function generateHypothesis() {
  const { data } = await supabase.rpc('analyze_health_trends');
  if (!data) return 'No hypothesis available — health trends unavailable';
  return `Hypothesis: ${data.trend_reason || 'System stable, no repair needed'}`;
}

async function getValidationResult() {
  const { data } = await supabase.from('system_dashboard').select('current_status, trend_status').single();
  if (!data) return 'Validation unavailable';
  const ok = data.current_status === 'OK';
  return `${ok ? 'Validated' : 'Flagged'} — status: ${data.current_status}, trend: ${data.trend_status}`;
}

async function getRepairManifest() {
  const { data } = await supabase.rpc('auto_heal_from_trends');
  if (!data) return 'No manifest generated';
  return data.healed > 0
    ? `Manifest applied: ${data.healed} heal(s) — ${(data.actions || []).join(', ')}`
    : 'No repairs required at this time';
}

async function getProtoForgeStatus() {
  const { data } = await supabase.from('system_dashboard').select('current_status, trend_status, jobs_queued, jobs_failed').single();
  if (!data) return 'Status unavailable';
  return `${data.current_status} (trend: ${data.trend_status}) · Queue: ${data.jobs_queued} queued / ${data.jobs_failed} failed`;
}

async function getActiveModules() {
  const { data } = await supabase.from('system_health').select('component, status').order('component');
  if (!data || !data.length) return 'CASCADE, KILO, Heidi, Ursula, Hyve';
  return data.map(r => `${r.component}:${r.status}`).join(', ');
}

async function getGovernanceStatus() {
  const { data } = await supabase.from('system_dashboard').select('escalation_level, escalation_reason').single();
  if (!data) return 'Governance status unavailable';
  return data.escalation_level === 'OK'
    ? 'All policies compliant'
    : `Escalation: ${data.escalation_level} — ${data.escalation_reason}`;
}

async function getOpportunities() {
  const { count } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'new');
  return `${count ?? 0} new leads / optimization opportunities`;
}

async function getCollectiveStatus() {
  // Pull the live HYDI dashboard status so the collective reflects real system health
  const { data } = await supabase
    .from('system_dashboard')
    .select('current_status, trend_status, jobs_queued, auto_heals_24h')
    .single();
  if (!data) return 'Swarm intelligence: ACTIVE (status unavailable)';
  return `Swarm intelligence: ${data.current_status} | trend: ${data.trend_status} | queue: ${data.jobs_queued ?? 0} | auto-heals 24h: ${data.auto_heals_24h ?? 0}`;
}

async function getSwarmStatus() {
  // Count agents with a heartbeat in the last 5 minutes (active lease holders)
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data, count } = await supabase
    .from('agent_leases')
    .select('lease_owner', { count: 'exact', head: false })
    .gte('heartbeat_at', cutoff);
  const activeCount = count ?? (data ? data.length : 0);
  if (activeCount === 0) return 'No agents with active leases in the last 5 min';
  const names = data ? [...new Set(data.map(r => r.lease_owner))].slice(0, 5).join(', ') : '';
  const suffix = names ? `: ${names}` : '';
  return `${activeCount} agent lease${activeCount !== 1 ? 's' : ''} active${suffix}`;
}
