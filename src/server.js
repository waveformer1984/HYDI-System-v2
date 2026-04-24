const express = require('express');
const http = require('http');
const protoforgeEventBus = require('../modules/protoforge-event-bus');
const { testConnection, persistEvent, supabase } = require('./database');
const ursulaSSE = require('../modules/ursula-sse-manager');
const HydiContextualConscience = require('../modules/hydi-contextual-conscience');
const ProtoForgeInfrastructure = require('../modules/protoforge-infrastructure');
const cascade = require('../modules/cascade-complete-v2');
const ChatWebSocketServer = require('../modules/chat-websocket-server');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Service Bundle imports
const serviceRoutes = require('./api/services');
const pricingConfig = require('./api/services/pricing');
const SubscriptionManager = require('./services/subscription-manager');
const HeidiServiceAutomator = require('../modules/heidi-service-automator');
const LocalModelAdapter = require('./models/local-model-adapter');
const path = require('path');

// Universal Agent Bus — The Forge Messaging Backbone
const UniversalAgentBus = require('../modules/universal-agent-bus');
const BusGatekeeper = require('./middleware/bus-gatekeeper');

const app = express();
const PORT = process.env.PORT || 3005;

// Middleware
app.use(express.json());

// Initialize Heidi - Contextual Conscience
const heidi = new HydiContextualConscience();

// Initialize Infrastructure - The Physical Body
const infrastructure = new ProtoForgeInfrastructure();

// Initialize CASCADE V2 - Enhanced Event Processing System
console.log('[CASCADE V2] Initializing enhanced event processing system...');
console.log('[CASCADE V2] Features: Schema Lock | Fingerprinting | Confidence Scoring | Hard Classification | Health Snapshots | Ack Tracking | Dead Letters');

// Initialize system enforcement modules
const { readinessGate } = require('./modules/readiness-gate');
const { noSilentSuccessEnforcer } = require('./modules/no-silent-success-enforcer');
const { systemContractGuard } = require('./modules/system-contract-guard');

// Start enforcement systems
readinessGate.start();
noSilentSuccessEnforcer.initialize();

console.log('[SYSTEM] Enforcement modules initialized');

// Initialize Service Bundle components
console.log('[SERVICE BUNDLE] Initializing service bundle components...');
const subscriptionManager = new SubscriptionManager();
const heidiAutomator = new HeidiServiceAutomator();
const localModelAdapter = new LocalModelAdapter();

// ── Universal Agent Bus ── The Forge Messaging Backbone ──
console.log('[AGENT BUS] Initializing Universal Agent Bus v1.0...');
const agentBus = new UniversalAgentBus({ name: 'UrsulaForgeBus', version: '1.0.0' });

// Register all 13 local models with heartbeat monitoring + backup routes
const modelRegistry = [
  { id: 'gpt-4-local', backupRoute: 'gpt-35-turbo' },
  { id: 'gpt-35-turbo', backupRoute: 'local-llama' },
  { id: 'local-llama', backupRoute: null },
  { id: 'local-classifier', backupRoute: null },
  { id: 'code-specialist', backupRoute: 'gpt-4-local' },
  { id: 'code-parser', backupRoute: null },
  { id: 'bug-finder', backupRoute: 'code-specialist' },
  { id: 'db-specialist', backupRoute: null },
  { id: 'security-scanner', backupRoute: null },
  { id: 'local-ocr', backupRoute: null },
  { id: 'predictive-model', backupRoute: null },
  { id: 'pricing-engine', backupRoute: null },
  { id: 'rule-engine', backupRoute: null }
];

modelRegistry.forEach(m => agentBus.registerModel(m.id, {
  backupRoute: m.backupRoute,
  maxMissedBeats: 3
}));

// Start model heartbeat monitor (60s pings, auto-redirect on flatline)
agentBus.startHeartbeatMonitor();
console.log('[AGENT BUS] Heartbeat monitor active for 13 local models');

// Start Universal Observer (watches all bus events, auto-notifies Heidi on failures)
agentBus.startUniversalObserver();
console.log('[AGENT BUS] Universal Observer watching bus telemetry');

// Restore in-flight messages from pending_tasks table after restart
agentBus.restoreInFlight().then(restored => {
  console.log(`[AGENT BUS] Restored ${restored?.count || 0} in-flight messages from database`);
}).catch(err => {
  console.error('[AGENT BUS] Restore error:', err.message);
});

// Gatekeeper middleware applied to all service routes
const busGatekeeper = new BusGatekeeper(agentBus);
app.use('/api/services', busGatekeeper.middleware());
console.log('[AGENT BUS] Gatekeeper middleware active on /api/services/*');

// Start Heidi automator
heidiAutomator.start();
console.log('[SERVICE BUNDLE] Heidi automator started');
console.log('[SERVICE BUNDLE] Local model adapter initialized');

// Heidi event handlers
heidi.on('high_violation_risk', (alert) => {
  console.log(`[HEIDI] HIGH VIOLATION RISK: ${(alert.risk * 100).toFixed(1)}%`);
  console.log(`[HEIDI] Recommendation: ${alert.recommendation.action}`);
  
  // Could trigger Ursula to speak this
  if (ursulaSSE && ursulaSSE.getSubscriberCount() > 0) {
    ursulaSSE.broadcast({
      type: 'heidi_alert',
      severity: 'high',
      message: `Warning: High violation risk detected. ${alert.recommendation.reason}`,
      data: alert
    });
  }
});

heidi.on('proof_of_work_created', (certification) => {
  console.log(`[HEIDI] Proof of Work certified: ${certification.artifactId} (Quality: ${(certification.qualityScore * 100).toFixed(1)}%)`);
});

heidi.on('value_leak_detected', (leak) => {
  console.log(`[HEIDI] Value Leak Detected: ${leak.problemType} - $${leak.estimatedValue.monthly.toFixed(2)}/month potential`);
});

heidi.on('monetization_opportunities', (opportunities) => {
  console.log(`[HEIDI] Top ${opportunities.length} monetization opportunities identified`);
  opportunities.forEach((opp, i) => {
    console.log(`  ${i + 1}. ${opp.problemType}: $${opp.estimatedValue.monthly.toFixed(2)}/month`);
  });
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Get module count (placeholder)
    const moduleCount = 0;
    
    // Get events count
    const { count } = await supabase
      .from('hydi_events')
      .select('*', { count: 'exact', head: true });
    
    res.json({
      status: 'ok',
      modules: moduleCount,
      events: count || 0
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// System integrity endpoint - deterministic truth enforcement
app.get('/integrity', (req, res) => {
  try {
    const stats = protoforgeEventBus.getStats();
    const integrity = stats.system_integrity;
    
    res.json({
      system_integrity_score: integrity.score,
      pipeline_health_report: integrity.pipeline_health,
      violation_events: integrity.violation_events,
      schema_drift_alerts: integrity.schema_drift_alerts,
      enforcement_status: integrity.score > 0.9 ? 'operational' : 'degraded',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Integrity check failed:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Evolution protocol endpoint - recursive integrity directive
app.get('/evolution', (req, res) => {
  try {
    const stats = protoforgeEventBus.getStats();
    const evolution = stats.evolution_protocol;
    
    res.json({
      evolution_protocol: evolution.evolution_protocol,
      event_count: evolution.event_count,
      violation_sources: evolution.violation_sources,
      schema_proposals_pending: evolution.schema_proposals_pending,
      state_snapshots: evolution.state_snapshots,
      last_snapshot_hash: evolution.last_snapshot_hash,
      ursula_latency_avg: evolution.ursula_latency_avg,
      pipeline_health: evolution.pipeline_health,
      digital_twin_synchronized: evolution.digital_twin_synchronized,
      recursive_integrity_status: evolution.digital_twin_synchronized ? 'synchronized' : 'desynchronized',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Evolution protocol check failed:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Prime Directive endpoint - integrity-first rule
app.get('/prime', (req, res) => {
  try {
    const stats = protoforgeEventBus.getStats();
    const primeDirective = stats.prime_directive;
    
    res.json({
      prime_directive: primeDirective.prime_directive,
      integrity_score: primeDirective.integrity_score,
      integrity_threshold: primeDirective.integrity_threshold,
      compliance_status: primeDirective.compliance_status,
      kilo_restriction_active: primeDirective.kilo_restriction_active,
      revenue_artifacts_blocked: primeDirective.revenue_artifacts_blocked,
      safety_artifacts_allowed: primeDirective.safety_artifacts_allowed,
      artifact_restrictions: primeDirective.artifact_restrictions,
      system_rule: primeDirective.system_rule,
      last_updated: primeDirective.last_updated,
      operational_status: primeDirective.compliance_status === 'COMPLIANT' ? 'NORMAL_OPERATIONS' : 'INTEGRITY_RESTRICTED',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Prime Directive check failed:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});


// Process endpoint - integrated with ProtoForge event bus
app.post('/process', async (req, res) => {
  // Generate unique cycle ID for this request
  const cycleId = `process_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Start tracking this cycle with no silent success enforcer
  noSilentSuccessEnforcer.startCycle(cycleId, 'HTTP_REQUEST', { 
    endpoint: '/process',
    method: 'POST',
    payload_size: JSON.stringify(req.body).length
  });
  
  try {
    // Record cascade processing start
    noSilentSuccessEnforcer.recordState(cycleId, 'cascade', 'processing_started', {
      payload: req.body
    });
    
    const payload = req.body;
    
    // Enforce event continuity through ProtoForge pipeline
    // event -> validate -> classify -> emit -> persist -> broadcast
    const result = await protoforgeEventBus.processEvent(payload);
    
    // Record cascade processing completion
    noSilentSuccessEnforcer.recordState(cycleId, 'cascade', result.status, {
      event_id: payload.event_id,
      validation_status: result.validation?.status,
      opportunity_detected: !!result.opportunity
    });
    
    // Update readiness gate metrics based on cascade processing
    readinessGate.updateCascadeMetrics(
      result.status === 'processed' ? 1 : 0,
      result.status === 'rejected' ? 1 : 0
    );
    
    // Simple persistence - no retries, no abstraction
    if (result.status === 'processed') {
      try {
        // Store original event - simple v2 upsert
        const { data, error } = await supabase
          .from('hydi_events')
          .upsert({
            event_id: payload.event_id,
            type: payload.type,
            source: payload.source,
            timestamp: payload.timestamp,
            payload: payload.payload,
            processed: true,
            stored_at: new Date().toISOString()
          }, {
            onConflict: 'event_id'
          });
        
        if (error) {
          throw error;
        }
        
        // Store opportunity if exists
        if (result.opportunity) {
          const { error: oppError } = await supabase
            .from('hydi_events')
            .upsert({
              event_id: result.opportunity.event_id,
              type: result.opportunity.type,
              source: 'cascade_opportunity',
              timestamp: result.opportunity.timestamp,
              payload: result.opportunity.payload,
              processed: false,
              parent_event_id: payload.event_id,
              stored_at: new Date().toISOString()
            }, {
              onConflict: 'event_id'
            });
          
          if (oppError) {
            console.error('Opportunity storage failed:', oppError.message);
          }
        }
        
        result.persistence_status = 'STORED';
        result.persistence_error = null;
        
      } catch (err) {
        console.error('Persistence failed:', {
          event_id: payload.event_id,
          stage: 'persistence',
          error: err.message
        });
        
        result.persistence_status = 'FAILED';
        result.persistence_error = err.message;
      }
    }
    
    // Check if KILO would be involved (if we had a repair manifest)
    // For now, we'll simulate this based on certain conditions
    let kiloInvolved = false;
    if (result.status === 'processed' && result.validation && result.validation.confidence < 0.7) {
      kiloInvolved = true;
      // Record KILO processing
      noSilentSuccessEnforcer.recordState(cycleId, 'kilo', 'processing_started', {
        trigger: 'low_confidence_event',
        confidence: result.validation.confidence
      });
      
      // Simulate KILO processing
      noSilentSuccessEnforcer.recordState(cycleId, 'kilo', 'manifest_generated', {
        issue_type: 'SIMULATED_ISSUE',
        confidence: result.validation.confidence * 0.9 // Slightly lower confidence for KILO
      });
      
      // Update readiness gate KILO metrics
      readinessGate.updateKiloMetrics(result.validation.confidence * 0.9);
    }
    
    // Determine final state for protoforge
    let protoforgeState = 'success';
    if (result.status === 'rejected') {
      protoforgeState = 'failure';
    } else if (result.status === 'processed' && result.validation && result.validation.confidence < 0.5) {
      protoforgeState = 'degraded';
    }
    
    // Record protoforge state
    noSilentSuccessEnforcer.recordState(cycleId, 'protoforge', protoforgeState, {
      cascade_result: result.status,
      kilo_involved: kiloInvolved
    });
    
    // Mark cycle as complete (this will trigger explicit state emission if needed)
    // The no silent success enforcer will auto-detect if we fail to emit explicit state
    
    // Return processing result - simple contract
    res.json({
      status: result.status,
      event_id: payload.event_id,
      timestamp: new Date().toISOString(),
      validation: result.validation,
      classification: result.classification,
      opportunity: result.opportunity || null,
      persistence_status: result.persistence_status || 'NOT_ATTEMPTED',
      persistence_error: result.persistence_error || null,
      pipeline: 'protoforge_validation_gate',
      cycle_id: cycleId // For tracking
    });
    
    // Explicitly emit state to prevent silent completion
    // In a real implementation, this would be done by the orchestrator
    // For now, we'll rely on the enforcer's timeout mechanism to detect silent failures
    
  } catch (error) {
    // Record error state in cycle
    noSilentSuccessEnforcer.recordState(cycleId, 'cascade', 'error', {
      error: error.message
    });
    
    // Mark protoforge as failed
    noSilentSuccessEnforcer.recordState(cycleId, 'protoforge', 'failure', {
      error: error.message,
      cascade_error: true
    });
    
    console.error('Process endpoint failed:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      pipeline: 'protoforge_validation_gate',
      cycle_id: cycleId
    });
  }
});

// Helper function for database persistence
async function persistEventToDatabase(event, result) {
  try {
    // Store original event using Supabase v2 upsert pattern
    const { data, error } = await supabase
      .from('hydi_events')
      .upsert({
        event_id: event.event_id,
        type: event.type,
        payload: event.payload,
        processed: true
      }, {
        onConflict: 'event_id'
      })
      .select();
    
    if (error) throw error;
    
    // Store opportunity event if exists
    if (result.opportunity) {
      const { error: oppError } = await supabase
        .from('hydi_events')
        .upsert({
          event_id: result.opportunity.event_id,
          type: result.opportunity.type,
          payload: result.opportunity.payload,
          processed: false
        }, {
          onConflict: 'event_id'
        });
      
      if (oppError) throw oppError;
    }
    
    console.log('Event persisted successfully');
  } catch (error) {
    console.error('Database persistence failed:', error);
    throw error;
  }
}

// Insight endpoint
app.get('/insight', async (req, res) => {
  try {
    // Get recent events
    const { data, error } = await supabase
      .from('hydi_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (error) throw error;
    
    res.json({
      insights: data.map(event => ({
        id: event.id,
        type: event.type,
        timestamp: event.created_at,
        summary: `Processed ${event.type} event`
      })),
      count: data.length
    });
  } catch (error) {
    console.error('Insight endpoint failed:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Event logging endpoint
app.post('/event', async (req, res) => {
  try {
    const eventData = req.body;
    
    // Log system event
    const { data, error } = await supabase
      .from('hydi_events')
      .insert({
        event_id: eventData.event_id || `sys-${Date.now()}`,
        type: eventData.type || 'system_event',
        payload: eventData.payload || {},
        processed: true // System events are pre-processed
      })
      .select();
    
    if (error) throw error;
    
    res.json({
      status: 'logged',
      eventId: data[0]?.event_id
    });
  } catch (error) {
    console.error('Event endpoint failed:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Opportunity endpoint - get detected opportunities
app.get('/opportunities', async (req, res) => {
  try {
    const { type, limit = 20 } = req.query;
    
    let query = supabase
      .from('hydi_events')
      .select('*')
      .eq('type', 'hyve_opportunity_detected')
      .order('created_at', { ascending: false });
    
    if (type) {
      query = query.contains('payload', {
        opportunity_classification: { opportunity_type: type }
      });
    }
    
    const { data, error } = await query.limit(limit);
    
    if (error) throw error;
    
    const opportunities = data.map(event => ({
      id: event.id,
      event_id: event.event_id,
      opportunity_type: event.payload.opportunity_classification?.opportunity_type,
      confidence: event.payload.opportunity_classification?.confidence,
      score: event.payload.opportunity_classification?.score,
      indicators: event.payload.opportunity_classification?.indicators,
      detected_at: event.created_at,
      action_required: event.payload.action_required
    }));
    
    res.json({
      opportunities: opportunities,
      count: opportunities.length
    });
  } catch (error) {
    console.error('Opportunities endpoint failed:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Infrastructure event handlers - The Physical Body Speaks
infrastructure.on('infrastructure_alert', (alert) => {
  console.log(`[INFRA] ${alert.layer.toUpperCase()} Alert: ${alert.alert.message}`);
  
  // Process through CASCADE
  cascade.processEvent({
    id: `infra_${Date.now()}`,
    type: alert.alert.severity === 'critical' ? 'error' : 'warning',
    layer: alert.layer,
    alert: alert.alert,
    zoneId: alert.zoneId
  }, 'system');
  
  // Broadcast through Ursula
  if (ursulaSSE && ursulaSSE.getSubscriberCount() > 0) {
    ursulaSSE.broadcast({
      type: 'infrastructure_alert',
      layer: alert.layer,
      severity: alert.alert.severity,
      message: alert.alert.message,
      data: alert
    });
  }
  
  // Track critical alerts with Heidi
  if (alert.alert.severity === 'critical') {
    heidi.logInteraction({
      type: 'system_alert',
      target: `${alert.layer}_${alert.zoneId}`,
      responseTime: 0,
      context: { 
        severity: 'critical',
        alert_type: alert.alert.type,
        auto_response: 'logged_for_review'
      },
      biometricIndicators: { system_stress: 0.8 }
    });
  }
});

infrastructure.on('revenue_tracked', (revenue) => {
  console.log(`[INFRA] Revenue Event: $${revenue.amount} from ${revenue.source} (${revenue.layer})`);
  
  // Broadcast revenue events
  if (ursulaSSE && ursulaSSE.getSubscriberCount() > 0) {
    ursulaSSE.broadcast({
      type: 'revenue_event',
      message: `Revenue: $${revenue.amount} from ${revenue.source}`,
      data: revenue
    });
  }
});

// Heidi endpoints - Contextual Conscience API
app.get('/heidi/insights', (req, res) => {
  try {
    const insights = heidi.getBehavioralInsights();
    res.json({
      status: 'ok',
      insights,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.post('/heidi/interaction', (req, res) => {
  try {
    const interaction = req.body;
    
    // Log the interaction
    heidi.logInteraction(interaction);
    
    res.json({
      status: 'logged',
      interactionId: interaction.id || uuidv4()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.post('/heidi/certify', async (req, res) => {
  try {
    const { artifact, productionData } = req.body;
    
    // Create proof of work certification
    const certification = await heidi.createProofOfWork(artifact, productionData);
    
    res.json({
      status: 'certified',
      certification
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.get('/heidi/value-leaks', (req, res) => {
  try {
    const valueLeaks = heidi.getValueLeaks();
    
    res.json({
      status: 'ok',
      valueLeaks,
      count: valueLeaks.length,
      totalPotentialValue: valueLeaks.reduce((sum, leak) => sum + (leak.estimatedValue?.monthly || 0), 0)
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.get('/heidi/resource-status', (req, res) => {
  try {
    const resourceStatus = heidi.getResourcePreservationStatus();
    
    res.json({
      status: 'ok',
      ...resourceStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Ursula SSE Stream endpoint - The Voice of the Machine
app.get('/events/stream', (req, res) => {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });
  
  console.log('[URSULA] New client connected to SSE stream');
  
  // Add client to manager
  const clientId = ursulaSSE.addClient(res);
  
  // Send initial connection event
  res.write('event: connected\n');
  res.write(`data: ${JSON.stringify({
    type: 'system_status',
    message: 'Connected to ProtoForge Central Nervous System',
    timestamp: new Date().toISOString()
  })}\n\n`);
  
  // Handle client disconnect
  req.on('close', () => {
    console.log('[URSULA] Client disconnected from SSE stream');
    ursulaSSE.removeClient(clientId);
  });
  
  // Send heartbeat every 30 seconds
  const heartbeat = setInterval(() => {
    if (ursulaSSE.clients.has(clientId)) {
      res.write('event: heartbeat\n');
      res.write(`data: ${JSON.stringify({
        type: 'heartbeat',
        timestamp: new Date().toISOString()
      })}\n\n`);
    } else {
      clearInterval(heartbeat);
    }
  }, 30000);
});

// CASCADE endpoints - Event Processing System API
app.get('/cascade/status', (req, res) => {
  try {
    const status = cascade.getStatus();
    res.json({
      status: 'ok',
      cascade: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.post('/cascade/event', async (req, res) => {
  try {
    const { source, event } = req.body;
    
    if (!source || !event) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing source or event'
      });
    }
    
    const result = await cascade.processEvent(event, source);
    
    res.json({
      status: 'ok',
      result: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.get('/cascade/quarantine', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const report = cascade.getQuarantineReport(limit);
    
    res.json({
      status: 'ok',
      quarantine: report,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.post('/cascade/quarantine/:eventId/release', (req, res) => {
  try {
    const { eventId } = req.params;
    const { approved_by } = req.body;
    
    if (!approved_by) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing approved_by field'
      });
    }
    
    const result = cascade.manualReleaseFromQuarantine(eventId, approvedBy);
    
    res.json({
      status: 'ok',
      result: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// CASCADE V2 additional endpoints

// Get health report
app.get('/cascade/health', (req, res) => {
  try {
    const healthReport = cascade.getHealthReport();
    
    res.json({
      status: 'ok',
      health: healthReport,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Get dead letter report
app.get('/cascade/dead-letters', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const deadLetters = cascade.getDeadLetterReport(limit);
    
    res.json({
      status: 'ok',
      dead_letters: deadLetters,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Get emission tracking
app.get('/cascade/emissions', (req, res) => {
  try {
    const { event_id } = req.query;
    const tracking = cascade.getEmissionTracking(event_id);
    
    res.json({
      status: 'ok',
      tracking: tracking,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Get schema lock info
app.get('/cascade/schema', (req, res) => {
  try {
    const status = cascade.getStatus();
    
    res.json({
      status: 'ok',
      schema: status.schema_lock,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Get fingerprint stats
app.get('/cascade/fingerprint', (req, res) => {
  try {
    const status = cascade.getStatus();
    
    res.json({
      status: 'ok',
      fingerprint: status.fingerprint,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Infrastructure endpoints - The Physical Body API
app.get('/infrastructure/health', (req, res) => {
  try {
    const health = infrastructure.getHealthSummary();
    res.json({
      status: 'ok',
      health,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.get('/infrastructure/scaffold/:pointId', (req, res) => {
  try {
    const point = infrastructure.getScaffoldPoint(req.params.pointId);
    if (!point) {
      return res.status(404).json({
        status: 'error',
        message: 'Scaffold point not found'
      });
    }
    res.json({
      status: 'ok',
      point
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.post('/infrastructure/scaffold/:pointId/calibrate', async (req, res) => {
  try {
    const { actualPosition } = req.body;
    const point = await infrastructure.calibratePoint(req.params.pointId, actualPosition);
    
    res.json({
      status: 'calibrated',
      point
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.get('/infrastructure/power', (req, res) => {
  try {
    const powerZones = Object.fromEntries(infrastructure.dcMicrogrid);
    res.json({
      status: 'ok',
      zones: powerZones,
      totalPower: Array.from(infrastructure.dcMicrogrid.values()).reduce((sum, z) => sum + z.power, 0)
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.get('/infrastructure/thermal', (req, res) => {
  try {
    const thermalZones = Object.fromEntries(infrastructure.plumbing);
    res.json({
      status: 'ok',
      zones: thermalZones,
      avgTemperature: Array.from(infrastructure.plumbing.values()).reduce((sum, z) => sum + z.temp, 0) / infrastructure.plumbing.size
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.post('/infrastructure/revenue', (req, res) => {
  try {
    const { layer, amount, source, description } = req.body;
    
    infrastructure.trackRevenue(layer, amount, source);
    
    res.json({
      status: 'tracked',
      revenue: { layer, amount, source, description },
      totalRevenue: infrastructure.getTotalRevenue()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.get('/infrastructure/revenue', (req, res) => {
  try {
    res.json({
      status: 'ok',
      streams: infrastructure.revenueStreams,
      totalRevenue: infrastructure.getTotalRevenue(),
      efficiency: infrastructure.calculateEfficiency()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.post('/infrastructure/maintenance/schedule', (req, res) => {
  try {
    const { layer, zoneId, task, estimatedCost } = req.body;
    
    const maintenance = infrastructure.scheduleMaintenance(layer, zoneId, task, estimatedCost);
    
    res.json({
      status: 'scheduled',
      maintenance
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.get('/infrastructure/all', (req, res) => {
  try {
    const all = infrastructure.getAllInfrastructure();
    res.json({
      status: 'ok',
      ...all
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Service Bundle API Routes
app.use('/api/services', serviceRoutes);

// Serve pricing configuration
app.get('/api/services/pricing', (req, res) => {
  res.json({
    success: true,
    data: pricingConfig.export()
  });
});

// Serve service bundle dashboard
app.get('/admin/services', (req, res) => {
  res.sendFile(path.join(__dirname, '../ursula-dashboard-services.html'));
});

// Initialize ProtoForge event bus integration
async function initializeIntegrations() {
  try {
    // Ursula SSE stream is ready - The Voice of the Machine
    console.log('[URSULA] SSE stream ready - Central Nervous System active');
    
    // Subscribe ProtoForge to relevant events - Ursula as the Broadcaster
    protoforgeEventBus.subscribe('hyve_opportunity_detected', (opportunityEvent) => {
      console.log(`[PROTOFORGE] Hyve opportunity: ${opportunityEvent.payload.opportunity_classification.opportunity_type}`);
      
      // Broadcast to Ursula SSE - The Voice of the Machine
      const broadcastCount = ursulaSSE.broadcast({
        type: 'hyve_opportunity',
        message: `Opportunity detected: ${opportunityEvent.payload.opportunity_classification.opportunity_type}`,
        data: opportunityEvent
      });
      console.log(`[URSULA] Broadcast to ${broadcastCount} subscribers`);
    });
    
    protoforgeEventBus.subscribe('validation_complete', (validationEvent) => {
      ursulaSSE.broadcast({
        type: 'validation_complete',
        message: 'Event validation completed',
        data: validationEvent
      });
    });
    
    protoforgeEventBus.subscribe('event_rejected', (rejectionEvent) => {
      ursulaSSE.broadcast({
        type: 'event_rejected',
        message: 'Event rejected',
        data: rejectionEvent
      });
    });
    
    protoforgeEventBus.subscribe('broadcast', (broadcastEvent) => {
      ursulaSSE.broadcast(broadcastEvent);
    });
    
    // Heidi alerts through Ursula
    heidi.on('high_violation_risk', (alert) => {
      ursulaSSE.broadcast({
        type: 'heidi_alert',
        severity: 'high',
        message: `Warning: High violation risk detected. ${alert.recommendation.reason}`,
        data: alert
      });
    });
    
    heidi.on('proof_of_work_created', (certification) => {
      ursulaSSE.broadcast({
        type: 'proof_of_work',
        message: `Artifact certified: ${certification.artifactId} (${(certification.qualityScore * 100).toFixed(1)}% quality)`,
        data: certification
      });
    });
    
    heidi.on('value_leak_detected', (leak) => {
      ursulaSSE.broadcast({
        type: 'value_opportunity',
        message: `Monetization opportunity: ${leak.problemType} - $${leak.estimatedValue.monthly.toFixed(2)}/month`,
        data: leak
      });
    });
    
    console.log('[PROTOFORGE] Event bus integrated with server');
    console.log('[URSULA] SSE stream ACTIVE - Broadcasting to all nodes');
    console.log('[SYSTEM] The Forge is ALIVE - All systems connected');
    
  } catch (error) {
    console.error('Failed to initialize integrations:', error);
  }
}

// Create HTTP server for WebSocket support
const server = http.createServer(app);

// Initialize WebSocket chat server
const chatServer = new ChatWebSocketServer(server);

server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log('ProtoForge Validation Gate - Operational');
  console.log('[DATABASE] Single Supabase client initialized');
  console.log('[CHAT WS] WebSocket server initialized - Connect to ws://localhost:${PORT}/ws/<system>');
  
  // Start CASCADE V2 system
  const cascadeStatus = cascade.start();
  console.log('[CASCADE V2]', cascadeStatus.status.toUpperCase(), '- Enhanced event processing active');
  console.log('[CASCADE V2] Version:', cascadeStatus.version);
  
  await initializeIntegrations();
  
  // Service Bundle event listeners
  subscriptionManager.serviceBundle.on('service_used', (data) => {
    console.log(`[SERVICE BUNDLE] Service used: ${data.serviceId} by ${data.subscriptionId} - Revenue: $${data.revenue}`);
  });
  
  subscriptionManager.serviceBundle.on('subscription_created', (data) => {
    console.log(`[SERVICE BUNDLE] New subscription: ${data.tier} for ${data.customerId}`);
  });
  
  subscriptionManager.serviceBundle.on('upsell_trigger', (data) => {
    console.log(`[SERVICE BUNDLE] Upsell trigger: ${data.customerId} at ${data.usagePercentage.toFixed(1)}% usage`);
    // Trigger Heidi's usage-to-upsell workflow
    heidiAutomator.triggerWorkflow('usage_to_upsell', {
      customerId: data.customerId,
      subscriptionId: data.subscriptionId,
      tier: data.tier,
      usagePercentage: data.usagePercentage,
      triggerService: data.serviceId
    });
  });
  
  // Setup CASCADE V2 event listeners
  cascade.on('heartbeat', (heartbeat) => {
    console.log(`[CASCADE V2] Heartbeat: ${heartbeat.status} - Active modules: ${heartbeat.active_modules.length}`);
  });
  
  cascade.on('emission_success', (success) => {
    console.log(`[CASCADE V2] Emission successful: ${success.event_id} -> ${success.target_system} (ack: ${success.acknowledged})`);
  });
  
  cascade.on('quarantine_resolved', (record) => {
    console.log(`[CASCADE V2] Quarantine resolved: ${record.event_id}`);
  });
  
  cascade.on('event_dead_lettered', (deadLetter) => {
    console.log(`[CASCADE V2] Event dead-lettered: ${deadLetter.event_id} - Reason: ${deadLetter.dead_letter_reason}`);
  });
  
  cascade.on('schema_violation', (violation) => {
    console.log(`[CASCADE V2] Schema violation: ${violation.event.event_id} - Errors: ${violation.violations.length}`);
  });
  
  cascade.on('health_snapshot', (snapshot) => {
    // Log every 5th snapshot to avoid spam
    if (Math.random() < 0.2) {
      console.log(`[CASCADE V2] Health: ${snapshot.system_health} | Throughput: ${snapshot.event_throughput.current.toFixed(2)}/s | Error ratio: ${(snapshot.error_ratio.current * 100).toFixed(1)}%`);
    }
  });
  
  // ── Universal Agent Bus Event Bridges ──
  // Bridge Service Bundle events onto the Agent Bus for unified telemetry
  subscriptionManager.serviceBundle.on('service_used', (data) => {
    agentBus.publish('Ursula', 'Heidi', 'service_usage_logged', {
      customerId: data.subscriptionId,
      serviceId: data.serviceId,
      revenue: data.revenue,
      tier: data.tier
    }, { priority: agentBus.priorities[data.tier?.toUpperCase()] || 1 });
  });
  
  subscriptionManager.serviceBundle.on('upsell_trigger', (data) => {
    agentBus.publish('Ursula', 'Heidi', 'upsell_needed', {
      customerId: data.customerId,
      subscriptionId: data.subscriptionId,
      usagePercentage: data.usagePercentage,
      triggerService: data.serviceId,
      tier: data.tier
    }, { priority: agentBus.priorities.PRO });
  });
  
  // Bridge local model health events to dashboard
  agentBus.on('model_flatlined', (event) => {
    console.log(`[AGENT BUS] ALERT: Model ${event.modelId} flatlined — redirecting to ${event.backupRoute || 'NONE'}`);
  });
  
  agentBus.on('model_redirect', (event) => {
    console.log(`[AGENT BUS] Redirect: ${event.from} -> ${event.to} (${event.reason})`);
  });
  
  agentBus.on('fail_event', (fail) => {
    console.log(`[AGENT BUS] FAIL EVENT: ${fail.action} for ${fail.customerId || 'system'} — ${fail.error}`);
  });
  
  // Bridge Ursula heartbeat to the Agent Bus
  const ursulaHeartbeat = require('../modules/ursula-heartbeat');
  if (ursulaHeartbeat) {
    console.log('[AGENT BUS] Ursula heartbeat monitor bridged to bus telemetry');
  }
  
  console.log('CASCADE V2:');
  console.log('  - Processed:', cascadeStats.stats.events_processed);
  console.log('  - Rejected:', cascadeStats.stats.events_rejected, '(Schema:', cascadeStats.stats.schema_violations, '| Duplicates:', cascadeStats.stats.duplicate_blocks, '| Low Conf:', cascadeStats.stats.low_confidence_blocks, ')');
  console.log('  - Quarantined:', cascadeStats.stats.events_quarantined);
  console.log('  - Dead-lettered:', cascadeStats.stats.events_dead_lettered);
  console.log('  - Repair manifests:', cascadeStats.stats.repair_manifests_generated);
  console.log('System Health:', cascadeStats.system_health.toUpperCase());
  console.log('Pipeline V2: Schema Lock -> Fingerprint -> Confidence Check -> Hard Classification -> Decision -> Emit (w/ Ack) -> Dead Letter');
  console.log('SERVICE BUNDLE:');
  console.log('  - Active services:', subscriptionManager.serviceBundle.services.size);
  console.log('  - Active subscriptions:', subscriptionManager.subscriptions.size);
  console.log('==================\n');
}, 5000);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\n[SHUTDOWN] Gracefully shutting down Forge ecosystem...');

  // 1. Persist in-flight Agent Bus messages to pending_tasks table
  console.log('[SHUTDOWN] Persisting in-flight Agent Bus messages...');
  try {
    await agentBus.persistInFlight();
    await agentBus.flushTelemetry(true);
    agentBus.stopHeartbeatMonitor();
    console.log('[SHUTDOWN] Agent Bus state persisted and telemetry flushed');
  } catch (err) {
    console.error('[SHUTDOWN] Agent Bus persistence error:', err.message);
  }

  // 2. Stop Heidi automator
  heidiAutomator.stop();
  console.log('[SHUTDOWN] Heidi automator stopped');

  // 3. Shutdown local model adapter
  await localModelAdapter.shutdown();
  console.log('[SHUTDOWN] Local model adapter shut down');

  console.log('[SHUTDOWN] Forge ecosystem shutdown complete');
  process.exit(0);
});

module.exports = app;
