import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth/requireAuth.js';
import baseLogger from '../../lib/structured-logger.js';

const logger = baseLogger.child({ component: 'AgentManagerAgents' });

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase env vars not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    }
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

const AGENT_REGISTRY = [
  {
    id: 'heidi',
    name: 'Heidi',
    role: 'Conversational Orchestrator',
    layer: 'CORE',
    capabilities: ['task_routing', 'context_management', 'model_switching', 'self_reflection'],
    endpoint: '/api/heidi/route',
  },
  {
    id: 'ursula',
    name: 'Ursula',
    role: 'System Monitor',
    layer: 'CORE',
    capabilities: ['health_monitoring', 'status_reporting', 'alert_management'],
    endpoint: '/api/ursula/status',
  },
  {
    id: 'cascade',
    name: 'CASCADE',
    role: 'Event Classifier',
    layer: 'PIPELINE',
    capabilities: ['event_classification', 'rule_matching', 'confidence_scoring'],
    endpoint: '/api/chat/route',
  },
  {
    id: 'kilo',
    name: 'KILO',
    role: 'Hypothesis Generator',
    layer: 'PIPELINE',
    capabilities: ['hypothesis_generation', 'fix_suggestion', 'pattern_analysis'],
    endpoint: '/api/chat/route',
  },
  {
    id: 'protoforge',
    name: 'ProtoForge',
    role: 'Policy Engine',
    layer: 'PIPELINE',
    capabilities: ['policy_enforcement', 'governance', 'suggestion_validation'],
    endpoint: '/api/chat/route',
  },
  {
    id: 'hyve',
    name: 'Hyve',
    role: 'Swarm Intelligence',
    layer: 'PIPELINE',
    capabilities: ['opportunity_detection', 'collective_reasoning', 'pattern_synthesis'],
    endpoint: '/api/chat/route',
  },
  {
    id: 'rezonate',
    name: 'Rezonate',
    role: 'Audio / DAW Node',
    layer: 'CREATIVE',
    capabilities: ['stem_analysis', 'mix_analysis', 'audio_export', 'nft_mint', 'rights_verify', 'session_recall', 'hardware_map', 'beat_generate'],
    endpoint: '/api/rezonate/route',
  },
  {
    id: 'waveformer',
    name: 'Waveformer Studio',
    role: 'Label Management',
    layer: 'CREATIVE',
    capabilities: ['artist_management', 'distribution', 'rights_tracking', 'royalty_calculation'],
    endpoint: null,
  },
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.MOBILE_CHAT_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hydi-service-token, x-hydi-device-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const auth = await requireAuth(req, res, supabase, { permission: 'worker:view', routeName: 'agent-manager-agents-get' });
  if (!auth.ok) return;

  try {
    // Pull task counts + last activity per agent from actions table
    const { data: taskStats, error: statsError } = await supabase
      .from('actions')
      .select('task_name, status, payload, created_at')
      .order('created_at', { ascending: false })
      .limit(500);

    if (statsError) throw statsError;

    // Pull system dashboard for overall health
    const { data: dash } = await supabase
      .from('system_dashboard')
      .select('current_status, jobs_queued, jobs_failed, trend_status')
      .single();

    // Aggregate per-agent stats from payload.agent_id
    const statsByAgent = {};
    for (const row of (taskStats || [])) {
      const agentId = row.payload?.agent_id || 'heidi';
      if (!statsByAgent[agentId]) {
        statsByAgent[agentId] = { pending: 0, completed: 0, failed: 0, last_active: null };
      }
      statsByAgent[agentId][row.status] = (statsByAgent[agentId][row.status] || 0) + 1;
      if (!statsByAgent[agentId].last_active || row.created_at > statsByAgent[agentId].last_active) {
        statsByAgent[agentId].last_active = row.created_at;
      }
    }

    const agents = AGENT_REGISTRY.map((agent) => {
      const stats = statsByAgent[agent.id] || { pending: 0, completed: 0, failed: 0, last_active: null };
      const totalTasks = stats.completed + stats.failed;
      const successRate = totalTasks > 0 ? Math.round((stats.completed / totalTasks) * 100) : null;

      let status = 'idle';
      if (stats.pending > 0) status = 'active';
      if (agent.id === 'heidi' || agent.id === 'ursula') {
        status = dash?.current_status === 'OK' ? 'healthy' : dash?.current_status === 'WARNING' ? 'degraded' : 'error';
      }

      return {
        ...agent,
        status,
        stats: {
          pending: stats.pending,
          completed: stats.completed,
          failed: stats.failed,
          success_rate: successRate,
          last_active: stats.last_active,
        },
      };
    });

    return res.status(200).json({
      ok: true,
      agents,
      system: dash || null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[agent-manager/agents] Request failed', { error: err });
    return res.status(500).json({ ok: false, error: err.message });
  }
}
