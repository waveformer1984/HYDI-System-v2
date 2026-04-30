// Universal Chat Router - Routes messages to appropriate systems
// Fixed for Node.js/Express (not Next.js)

// Import Supabase for health checks
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// System handlers
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
    
    // Get the appropriate handler
    const handler = systemHandlers[system];
    if (!handler) {
      return res.status(400).json({
        error: `Unknown system: ${system}`
      });
    }
    
    // Route message to system
    const response = await handler(message, req);
    
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

// System handlers

async function handleUrsulaMessage(message, request) {
  const lowerMessage = message.toLowerCase();
  
  // Handle system status queries
  if (lowerMessage.includes('system status') || lowerMessage.includes('status')) {
    try {
      // Run auto-heal and get trends
      const { data: heal, error: healError } = await supabase.rpc('auto_heal_from_trends');
      
      // Fetch from Supabase system_dashboard view
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
    return `🧠 Heidi: Analysis complete. Context integrity: ${getContextIntegrity()}`;
  }
  
  return {
    text: `[Heidi] Task received: "${message}"`,
    taskId: `task_${Date.now()}`
  };
}

async function handleCascadeMessage(message, request) {
  // CASCADE processes events
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('process')) {
    const event = extractEventFromMessage(message);
    if (event) {
      const result = await processCascadeEvent(event);
      return `⚡ CASCADE: Event processed - Classification: ${result.classification}, Confidence: ${result.confidence}`;
    }
  }
  
  if (lowerMessage.includes('status')) {
    return `⚡ CASCADE: ${getCascadeStatus()}`;
  }
  
  if (lowerMessage.includes('quarantine')) {
    return `⚡ CASCADE: Quarantine status - ${getQuarantineStatus()}`;
  }
  
  return `⚡ CASCADE: Event processing system. Try 'process <event>', 'status', or 'quarantine'.`;
}

async function handleKiloMessage(message, request) {
  // KILO generates repair hypotheses
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('hypothesis') || lowerMessage.includes('repair')) {
    return `🔧 KILO: Generating repair hypothesis based on current system state... ${generateHypothesis()}`;
  }
  
  if (lowerMessage.includes('validate')) {
    return `🔧 KILO: Validation complete - ${getValidationResult()}`;
  }
  
  if (lowerMessage.includes('manifest')) {
    return `🔧 KILO: Repair manifest ready - ${getRepairManifest()}`;
  }
  
  return `🔧 KILO: Repair hypothesis engine. Ask about 'hypothesis', 'validate', or 'manifest'.`;
}

async function handleProtoForgeMessage(message, request) {
  // ProtoForge core system
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('status')) {
    return `🌐 ProtoForge: Core system status - ${getProtoForgeStatus()}`;
  }
  
  if (lowerMessage.includes('modules')) {
    return `🌐 ProtoForge: Active modules - ${getActiveModules()}`;
  }
  
  if (lowerMessage.includes('govern')) {
    return `🌐 ProtoForge: Governance status - ${getGovernanceStatus()}`;
  }
  
  return `🌐 ProtoForge: Core system coordination. Try 'status', 'modules', or 'govern'.`;
}

async function handleHyveMessage(message, request) {
  // Hyve opportunity collective
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('opportunity')) {
    return `🐝 Hyve: Current opportunities - ${getOpportunities()}`;
  }
  
  if (lowerMessage.includes('collective')) {
    return `🐝 Hyve: Collective status - ${getCollectiveStatus()}`;
  }
  
  if (lowerMessage.includes('swarm')) {
    return `🐝 Hyve: Swarm intelligence active - ${getSwarmStatus()}`;
  }
  
  return `🐝 Hyve: Opportunity collective. Ask about 'opportunity', 'collective', or 'swarm'.`;
}

async function handleInfrastructureMessage(message, request) {
  // Infrastructure monitoring - integrated with Supabase health system
  const lowerMessage = message.toLowerCase();
  
  try {
    // Fetch real health data from Supabase
    const { data: dash, error } = await supabase
      .from('system_dashboard')
      .select('*')
      .single();
    
    if (error) {
      return `🏗️ Infrastructure: Unable to fetch health data - ${error.message}`;
    }
    
    if (lowerMessage.includes('health')) {
      const statusEmoji = dash.current_status === 'OK' ? '✅' : 
                          dash.current_status === 'WARNING' ? '⚠️' : '🔴';
      return `🏗️ Infrastructure Health: ${statusEmoji} ${dash.current_status}\n` +
             `Trend: ${dash.trend_status} (${dash.trend_reason})\n` +
             `Queue: ${dash.jobs_queued} queued, ${dash.jobs_failed} failed, ${dash.jobs_dead} dead\n` +
             `Events (1h): ${dash.events_last_hour} | Auto-heals (24h): ${dash.auto_heals_24h}`;
    }
    
    if (lowerMessage.includes('resources') || lowerMessage.includes('queue')) {
      return `🏗️ Resource Usage:\n` +
             `• Jobs queued: ${dash.jobs_queued}\n` +
             `• Jobs failed: ${dash.jobs_failed}\n` +
             `• Jobs dead: ${dash.jobs_dead}\n` +
             `• Avg queue size: ${dash.avg_queue_size}\n` +
             `• Critical runs: ${dash.critical_pct}% | Warning runs: ${dash.warning_pct}%`;
    }
    
    if (lowerMessage.includes('alerts') || lowerMessage.includes('escalation')) {
      if (dash.escalation_level === 'OK') {
        return `🏗️ Alerts: No active escalations. System is stable.`;
      }
      return `🏗️ ALERT: ${dash.escalation_level} escalation active!\n` +
             `Action: ${dash.escalation_action}\n` +
             `Reason: ${dash.escalation_reason}`;
    }
    
    return `🏗️ Infrastructure: System monitoring. Try 'health', 'resources', 'alerts', or 'queue'.`;
  } catch (err) {
    return `🏗️ Infrastructure Error: ${err.message}`;
  }
}

// Helper functions (simplified implementations)
function getSubscriberCount() {
  return Math.floor(Math.random() * 10) + 1;
}

function getLastEventTime() {
  return new Date().toISOString();
}

function extractEventFromMessage(message) {
  // Simple extraction - in real implementation, parse more carefully
  const match = message.match(/event[:\s]+(.+)$/i);
  return match ? match[1].trim() : null;
}

function broadcastEvent(event) {
  // In real implementation, broadcast to SSE clients
  console.log('Broadcasting event:', event);
}

function getCurrentRiskLevel() {
  const levels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  return levels[Math.floor(Math.random() * levels.length)];
}

function getLastViolation() {
  return 'None in last hour';
}

function getRecommendation() {
  return 'Continue monitoring system integrity';
}

function getContextIntegrity() {
  return (Math.random() * 100).toFixed(1) + '%';
}

async function processCascadeEvent(event) {
  // Simulate CASCADE processing
  return {
    classification: 'INFRA_FAILURE',
    confidence: (Math.random() * 0.5 + 0.5).toFixed(2)
  };
}

function getCascadeStatus() {
  return 'Processing events normally. Queue: 0';
}

function getQuarantineStatus() {
  return '2 events quarantined';
}

function generateHypothesis() {
  return 'Hypothesis: Database connection pool exhaustion';
}

function getValidationResult() {
  return 'Hypothesis validated with 85% confidence';
}

function getRepairManifest() {
  return 'Manifest ready for INFRA_FAILURE';
}

function getProtoForgeStatus() {
  return 'All systems operational';
}

function getActiveModules() {
  return 'CASCADE, KILO, Heidi, Ursula, Hyve';
}

function getGovernanceStatus() {
  return 'All policies compliant';
}

function getOpportunities() {
  return '3 optimization opportunities detected';
}

function getCollectiveStatus() {
  return 'Swarm intelligence: ACTIVE';
}

function getSwarmStatus() {
  return '12 agents collaborating';
}

function getHealthStatus() {
  return 'All systems green';
}

function getResourceUsage() {
  return `CPU: ${Math.floor(Math.random() * 50)}%, RAM: ${Math.floor(Math.random() * 60)}%`;
}

function getActiveAlerts() {
  return 'No active alerts';
}
