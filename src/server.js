const express = require('express');
const http = require('http');
const protoforgeEventBus = require('../modules/protoforge-event-bus');
const { supabase } = require('./database');
const ursulaSSE = require('../modules/ursula-sse-manager');
const HydiContextualConscience = require('../modules/hydi-contextual-conscience');
const ProtoForgeInfrastructure = require('../modules/protoforge-infrastructure');
const cascade = require('../modules/cascade-complete-v2');
const ChatWebSocketServer = require('../modules/chat-websocket-server');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const logger = require('../lib/structured-logger').child({ component: 'HeidiServer' });

// Service Bundle imports
const serviceRoutes = require('./api/services');
const pricingConfig = require('./api/services/pricing');
const SubscriptionManager = require('./services/subscription-manager');
const HeidiServiceAutomator = require('../modules/heidi-service-automator');
const LocalModelAdapter = require('./models/local-model-adapter');
const AdaptationExecutor = require('../modules/adaptation-executor');
const path = require('path');

// Universal Agent Bus — The Forge Messaging Backbone
const UniversalAgentBus = require('../modules/universal-agent-bus');
const BusGatekeeper = require('./middleware/bus-gatekeeper');
const SimpleKeymaker = require('./middleware/simple-keymaker');
const Keymaker = require('./middleware/keymaker');

const app = express();
const PORT = process.env.PORT || 3005;

// Middleware - ORDER MATTERS
app.use(express.json());

// Global error logger - catch silent failures
app.use((err, req, res, _next) => {
  logger.error('Global error', { error: err, path: req.path, method: req.method });
  res.status(400).json({
    error: err.message,
    type: 'express_error',
    path: req.path,
    method: req.method
  });
});

// Initialize Heidi - Contextual Conscience
const heidi = new HydiContextualConscience();

// Initialize Infrastructure - The Physical Body
const infrastructure = new ProtoForgeInfrastructure();

// Initialize CASCADE V2 - Enhanced Event Processing System
logger.info('CASCADE V2: Initializing enhanced event processing system');
logger.info('CASCADE V2: Features enabled', { features: ['Schema Lock', 'Fingerprinting', 'Confidence Scoring', 'Hard Classification', 'Health Snapshots', 'Ack Tracking', 'Dead Letters'] });

// Initialize system enforcement modules
const { readinessGate } = require('../modules/readiness-gate');
const noSilentSuccessEnforcer = require('../modules/no-silent-success-enforcer');
require('../modules/system-contract-guard');

// Start enforcement systems
readinessGate.start();
noSilentSuccessEnforcer.initialize();

logger.info('SYSTEM: Enforcement modules initialized');

// Initialize Service Bundle components
logger.info('SERVICE BUNDLE: Initializing service bundle components');
const subscriptionManager = new SubscriptionManager();
const heidiAutomator = new HeidiServiceAutomator();
const localModelAdapter = new LocalModelAdapter();

// ── Universal Agent Bus ── The Forge Messaging Backbone ──
logger.info('AGENT BUS: Initializing Universal Agent Bus v1.0');
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
logger.info('AGENT BUS: Heartbeat monitor active for 13 local models');

// Start Universal Observer (watches all bus events, auto-notifies Heidi on failures)
agentBus.startUniversalObserver();
logger.info('AGENT BUS: Universal Observer watching bus telemetry');

// Restore in-flight messages from pending_tasks table after restart
agentBus.restoreInFlight().then(restored => {
  logger.info('AGENT BUS: Restored in-flight messages from database', { count: restored?.count || 0 });
}).catch(err => {
  logger.error('AGENT BUS: Restore error', { error: err });
});

// Gatekeeper middleware applied to all service routes
const busGatekeeper = new BusGatekeeper(agentBus);
app.use('/api/services', busGatekeeper.middleware());
logger.info('AGENT BUS: Gatekeeper middleware active on /api/services/*');

// ── SIMPLE KEYMAKER ── API Key → Tier Access ──
logger.info('SIMPLE KEYMAKER: Initializing simple API key validation');
const simpleKeymaker = new SimpleKeymaker();
app.use(simpleKeymaker.middleware());
logger.info('SIMPLE KEYMAKER: Middleware active on POST routes');

// ── KEYMAKER ── Access, Routing, Permission Control (backs /keymaker/* routes) ──
logger.info('KEYMAKER: Initializing access/routing/permission middleware');
const keymaker = new Keymaker();
app.use(keymaker.middleware());
logger.info('KEYMAKER: Middleware active — populates req.keymaker');

// Start Heidi automator
heidiAutomator.start();
logger.info('SERVICE BUNDLE: Heidi automator started');
logger.info('SERVICE BUNDLE: Local model adapter initialized');

// Initialize Adaptation Executor - makes insights actionable
new AdaptationExecutor({
  confidenceThreshold: 0.7,
  autoExecuteSafe: true
});
logger.info('SERVICE BUNDLE: Adaptation executor initialized');

// Wire adaptation executor to model events
localModelAdapter.on('inference_complete', (event) => {
  // Structured logging for model performance
  logger.info('Model inference complete', {
    model: event.modelId,
    latency: event.processingTime,
    success: true,
    failover: false,
    confidence: event.result?.confidence || 0,
    tier: event.tier,
    priority: event.priority
  });
});

localModelAdapter.on('inference_error', (event) => {
  // Structured logging for model errors
  logger.info('Model inference error', {
    model: event.modelId,
    latency: event.processingTime,
    success: false,
    error: event.error,
    tier: event.tier
  });
});

localModelAdapter.on('model_flatlined', (event) => {
  logger.info('Model flatlined', {
    model: event.modelId,
    failover: true,
    backup_route: event.backupRoute,
    event_type: 'model_flatline'
  });
});

// Heidi event handlers
heidi.on('high_violation_risk', (alert) => {
  logger.info('HEIDI: High violation risk', { riskPercent: Number((alert.risk * 100).toFixed(1)), recommendationAction: alert.recommendation.action });

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
  logger.info('HEIDI: Proof of Work certified', { artifactId: certification.artifactId, qualityScorePercent: Number((certification.qualityScore * 100).toFixed(1)) });
});

heidi.on('value_leak_detected', (leak) => {
  logger.info('HEIDI: Value leak detected', { problemType: leak.problemType, estimatedMonthlyValue: Number(leak.estimatedValue.monthly.toFixed(2)) });
});

heidi.on('monetization_opportunities', (opportunities) => {
  logger.info('HEIDI: Top monetization opportunities identified', {
    count: opportunities.length,
    opportunities: opportunities.map((opp) => ({ problemType: opp.problemType, estimatedMonthlyValue: Number(opp.estimatedValue.monthly.toFixed(2)) }))
  });
});

// Bare test endpoint - no middleware, no auth, just truth
app.post('/bare-test', (req, res) => {
  logger.info('BARE TEST: Request received', { body: req.body, headers: Object.keys(req.headers) });

  res.json({
    ok: true, 
    body: req.body,
    timestamp: new Date().toISOString() 
  });
});

// Simple GET endpoint to test Express
app.get('/test-get', (req, res) => {
  res.json({ message: 'Express is working', timestamp: new Date().toISOString() });
});

// Simple test endpoint - proves the loop works
app.post('/test-loop', async (req, res) => {
  logger.info('TEST LOOP: Request received', { headers: Object.keys(req.headers), apiKey: req.headers['x-api-key'], body: req.body });

  // Check tier access
  if (!req.apiKey || !SimpleKeymaker.checkTierAccess('starter', req.apiKey.tier)) {
    logger.info('TEST LOOP: Access denied', { tier: req.apiKey?.tier || 'none' });
    return res.status(403).json({
      error: 'Insufficient tier',
      required: 'starter',
      current: req.apiKey?.tier || 'none'
    });
  }
  
  try {
    // Simple processing - no complex modules
    const result = {
      received: req.body,
      processed: true,
      tier: req.apiKey.tier,
      timestamp: new Date().toISOString(),
      processing_time_ms: Date.now() - Date.parse(req.body.timestamp || new Date()),
      status: 'success'
    };
    
    logger.info('TEST LOOP: User processed event', { tier: req.apiKey.tier, eventId: req.body.event_id });

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('TEST LOOP: Processing error', { error });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Get module count (placeholder)
    const moduleCount = 0;

    // Get events count
    const { count } = await supabase
      .from('heidi_events')
      .select('*', { count: 'exact', head: true });

    res.json({
      status: 'ok',
      modules: moduleCount,
      events: count || 0
    });
  } catch (error) {
    logger.error('Health check failed', { error });
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
    logger.error('Integrity check failed', { error });
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
    logger.error('Evolution protocol check failed', { error });
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
    logger.error('Prime Directive check failed', { error });
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});


// Process endpoint - integrated with ProtoForge event bus (requires API key)
app.post('/process', async (req, res) => {
  // Check tier access - /process requires at least starter tier
  if (!req.apiKey || !SimpleKeymaker.checkTierAccess('starter', req.apiKey.tier)) {
    return res.status(403).json({
      error: 'Insufficient tier',
      required: 'starter',
      current: req.apiKey?.tier || 'none',
      hint: 'Upgrade your plan or check your API key'
    });
  }
  // Generate unique cycle ID for this request
  const cycleId = `process_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // TODO: Re-enable noSilentSuccessEnforcer when iconv-lite issue is fixed
  logger.info('PROCESS: Starting cycle', { cycleId });

  try {
    logger.info('PROCESS: Cascade processing started', { eventId: req.body.event_id });

    const payload = req.body;

    // Enforce event continuity through ProtoForge pipeline
    // event -> validate -> classify -> emit -> persist -> broadcast
    const result = await protoforgeEventBus.processEvent(payload);

    // Record cascade processing completion
    logger.info('PROCESS: Cascade completed', { status: result.status, eventId: payload.event_id });
    logger.info('PROCESS: Validation result', { validationStatus: result.validation?.status, hasOpportunity: !!result.opportunity });
    
    // Update readiness gate metrics based on cascade processing
    readinessGate.updateCascadeMetrics(
      result.status === 'processed' ? 1 : 0,
      result.status === 'rejected' ? 1 : 0
    );
    
    // Simple persistence - no retries, no abstraction
    if (result.status === 'processed') {
      try {
        // heidi_events has no external-id column to upsert against (its PK
        // is an auto-generated uuid), so this is a plain insert. Fields with
        // no real column (event_id, source, timestamp) are folded into
        // payload so nothing is silently dropped.
        const { error } = await supabase
          .from('heidi_events')
          .insert({
            event_type: payload.type,
            division: payload.division,
            payload: { ...payload.payload, event_id: payload.event_id, source: payload.source, timestamp: payload.timestamp },
            verdict: result.status === 'processed' ? 'AUTO-APPROVE' : result.status === 'rejected' ? 'BLOCK' : null,
            context_snapshot: result.validation || null
          });

        if (error) {
          throw error;
        }

        // Store opportunity if exists
        if (result.opportunity) {
          const { error: oppError } = await supabase
            .from('heidi_events')
            .insert({
              event_type: result.opportunity.type,
              division: result.opportunity.division,
              payload: {
                ...result.opportunity.payload,
                event_id: result.opportunity.event_id,
                source: 'cascade_opportunity',
                timestamp: result.opportunity.timestamp,
                parent_event_id: payload.event_id
              },
              context_snapshot: result.validation || null
            });

          if (oppError) {
            logger.error('Opportunity storage failed', { error: oppError.message });
          }
        }

        result.persistence_status = 'STORED';
        result.persistence_error = null;

      } catch (err) {
        logger.error('Persistence failed', {
          eventId: payload.event_id,
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
    logger.info('PROCESS: Protoforge state', { protoforgeState, kiloInvolved });
    
    // TODO: Re-enable noSilentSuccessEnforcer when iconv-lite issue is fixed
    
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
    logger.error('PROCESS: Error in cycle', { cycleId, error: error.message });

    // Mark protoforge as failed
    logger.error('PROCESS: Protoforge failed', { eventId: req.body.event_id, error: error.message });

    logger.error('Process endpoint failed', { error });
    res.status(500).json({
      status: 'error',
      message: error.message,
      pipeline: 'protoforge_validation_gate',
      cycle_id: cycleId
    });
  }
});

// Insight endpoint
app.get('/insight', async (req, res) => {
  try {
    // Get recent events
    const { data, error } = await supabase
      .from('heidi_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;

    res.json({
      insights: data.map(event => ({
        id: event.id,
        type: event.event_type,
        timestamp: event.created_at,
        summary: `Processed ${event.event_type} event`
      })),
      count: data.length
    });
  } catch (error) {
    logger.error('Insight endpoint failed', { error });
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
      .from('heidi_events')
      .insert({
        event_type: eventData.type || 'system_event',
        division: eventData.division,
        payload: { ...(eventData.payload || {}), event_id: eventData.event_id || `sys-${Date.now()}` }
      })
      .select();

    if (error) throw error;

    res.json({
      status: 'logged',
      eventId: data[0]?.id
    });
  } catch (error) {
    logger.error('Event endpoint failed', { error });
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
      .from('heidi_events')
      .select('*')
      .eq('event_type', 'hyve_opportunity_detected')
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
    logger.error('Opportunities endpoint failed', { error });
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Infrastructure event handlers - The Physical Body Speaks
infrastructure.on('infrastructure_alert', (alert) => {
  logger.info('INFRA: Alert', { layer: alert.layer.toUpperCase(), message: alert.alert.message });
  
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
  logger.info('INFRA: Revenue event', { amount: revenue.amount, source: revenue.source, layer: revenue.layer });

  // Broadcast revenue events
  if (ursulaSSE && ursulaSSE.getSubscriberCount() > 0) {
    ursulaSSE.broadcast({
      type: 'revenue_event',
      message: `Revenue: $${revenue.amount} from ${revenue.source}`,
      data: revenue
    });
  }
});

// Bridge infrastructure health snapshot → Supabase every 30 s
// so Ursula's dashboard reflects Digital Twin + 48V microgrid state
let _infraSyncErrorLogged = false;
infrastructure.on('health_update', async (health) => {
  try {
    const { error } = await supabase
      .from('infrastructure_health')
      .upsert({
        id: 'singleton',
        overall:    health.overall,
        power:      health.power,
        thermal:    health.thermal,
        scaffold:   health.scaffold,
        revenue:    health.revenue,
        efficiency: health.efficiency,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

    if (error) {
      if (!_infraSyncErrorLogged) {
        logger.error('INFRA: Failed to sync health to Supabase', { error: error.message, hint: 'Run: npx supabase db push  to create the infrastructure_health table' });
        _infraSyncErrorLogged = true;
      }
    } else {
      _infraSyncErrorLogged = false; // reset if it recovers
    }
  } catch (err) {
    if (!_infraSyncErrorLogged) {
      logger.error('INFRA: health_update bridge error', { error: err.message });
      _infraSyncErrorLogged = true;
    }
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

// NEW: Heidi Self-Awareness endpoints
app.get('/heidi/self-awareness', (req, res) => {
  try {
    const selfAwarenessStatus = heidi.getSelfAwarenessStatus();
    
    res.json({
      status: 'ok',
      self_awareness: selfAwarenessStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.post('/heidi/autonomous-action', async (req, res) => {
  try {
    const { action, context } = req.body;
    
    if (!action) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing action parameter'
      });
    }
    
    const result = await heidi.performAutonomousAction(action, context);
    
    res.json({
      status: 'ok',
      result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.get('/heidi/reflection-status', (req, res) => {
  try {
    const reflectionStatus = heidi.reflectionEngine.getCurrentReflection();
    const performanceMetrics = heidi.reflectionEngine.getPerformanceMetrics();
    const adaptivePatterns = heidi.reflectionEngine.getAdaptivePatterns();
    
    res.json({
      status: 'ok',
      current_reflection: reflectionStatus,
      performance_metrics: performanceMetrics,
      adaptive_patterns: adaptivePatterns,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.get('/heidi/decision-stats', (req, res) => {
  try {
    const decisionStats = heidi.decisionEngine.getDecisionStats();
    const currentDecision = heidi.decisionEngine.getCurrentDecision();
    
    res.json({
      status: 'ok',
      decision_stats: decisionStats,
      current_decision: currentDecision,
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
  
  logger.info('URSULA: New client connected to SSE stream');
  
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
    logger.info('URSULA: Client disconnected from SSE stream');
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
    
    const result = cascade.manualReleaseFromQuarantine(eventId, approved_by);
    
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

// ─────────────────────────────────────────────────────────────
// KEYMAKER API ROUTES - Access, Routing, Permission Control
// ─────────────────────────────────────────────────────────────

// Get Keymaker status and stats
app.get('/keymaker/status', async (req, res) => {
  try {
    const stats = await keymaker.getStats();
    res.json({
      status: 'ok',
      keymaker: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Issue a new key (admin or self-service for authenticated users)
app.post('/keymaker/keys', async (req, res) => {
  try {
    const { userId, role, tier, durationHours, services, scopes } = req.body;
    const identity = req.keymaker?.identity;
    
    // Only admins can issue keys for others
    if (identity?.role !== 'admin' && userId && userId !== identity?.userId) {
      return res.status(403).json({ error: 'Admin access required to issue keys for other users' });
    }
    
    const result = await keymaker.issueKey(
      userId || identity?.userId,
      role || identity?.role || 'guest',
      tier || identity?.tier || 'starter',
      { durationHours: durationHours || 1, services, scopes }
    );
    
    res.json({
      status: 'key_issued',
      key: result.key,
      keyHash: result.keyHash,
      expiresAt: result.expiresAt,
      note: 'Store this key securely - it will not be shown again'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Revoke a key
app.delete('/keymaker/keys/:keyHash', async (req, res) => {
  try {
    const identity = req.keymaker?.identity;
    if (identity?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    await keymaker.revokeKey(req.params.keyHash, req.body.reason || 'manual_revoke');
    res.json({ status: 'key_revoked', keyHash: req.params.keyHash });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Validate a key (debug/health endpoint)
app.post('/keymaker/validate', async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) {
      return res.status(400).json({ error: 'Key required' });
    }
    
    const validation = await keymaker.validateKey(key, req);
    res.json(validation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get audit log (admin only)
app.get('/keymaker/audit', async (req, res) => {
  try {
    const identity = req.keymaker?.identity;
    if (identity?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { data, error } = await supabase
      .from('keymaker_access_log')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(req.query.limit || 100);
    
    if (error) throw error;
    
    res.json({
      status: 'ok',
      logs: data,
      count: data.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Neo admin endpoints
app.post('/keymaker/admin/kill-switch', async (req, res) => {
  try {
    const identity = req.keymaker?.identity;
    if (identity?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required - Neo only' });
    }
    
    const { enabled, reason } = req.body;
    await supabase.rpc('neo_kill_switch', { p_enabled: enabled, p_reason: reason });
    
    res.json({
      status: 'kill_switch_triggered',
      enabled,
      reason,
      triggeredBy: identity.userId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/keymaker/admin/break-glass', async (req, res) => {
  try {
    const identity = req.keymaker?.identity;
    if (identity?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required - Neo only' });
    }
    
    const { userId, durationMinutes, reason } = req.body;
    const result = await supabase.rpc('neo_break_glass_access', {
      p_user_id: userId,
      p_duration_minutes: durationMinutes || 60,
      p_reason: reason
    });
    
    res.json({
      status: 'break_glass_issued',
      keyHash: result.data,
      toUser: userId,
      durationMinutes: durationMinutes || 60,
      reason
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

logger.info('KEYMAKER: API routes registered: /keymaker/*');

// Initialize ProtoForge event bus integration
async function initializeIntegrations() {
  try {
    // Ursula SSE stream is ready - The Voice of the Machine
    logger.info('URSULA: SSE stream ready - Central Nervous System active');

    // Subscribe ProtoForge to relevant events - Ursula as the Broadcaster
    protoforgeEventBus.subscribe('hyve_opportunity_detected', (opportunityEvent) => {
      logger.info('PROTOFORGE: Hyve opportunity', { opportunityType: opportunityEvent.payload.opportunity_classification.opportunity_type });

      // Broadcast to Ursula SSE - The Voice of the Machine
      const broadcastCount = ursulaSSE.broadcast({
        type: 'hyve_opportunity',
        message: `Opportunity detected: ${opportunityEvent.payload.opportunity_classification.opportunity_type}`,
        data: opportunityEvent
      });
      logger.info('URSULA: Broadcast to subscribers', { broadcastCount });
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
    
    logger.info('PROTOFORGE: Event bus integrated with server');
    logger.info('URSULA: SSE stream ACTIVE - Broadcasting to all nodes');
    logger.info('SYSTEM: The Forge is ALIVE - All systems connected');

  } catch (error) {
    logger.error('Failed to initialize integrations', { error });
  }
}

// Create HTTP server for WebSocket support
const server = http.createServer(app);

// Initialize WebSocket chat server
new ChatWebSocketServer(server);

server.listen(PORT, async () => {
  logger.info('Server running on port', { port: PORT });
  logger.info('ProtoForge Validation Gate - Operational');
  logger.info('DATABASE: Single Supabase client initialized');
  logger.info('WebSocket server initialized', { url: `ws://localhost:${PORT}/ws/<system>` });

  // Start CASCADE V2 system
  const cascadeStatus = cascade.start();
  logger.info('CASCADE V2: Enhanced event processing active', { status: cascadeStatus.status.toUpperCase() });
  logger.info('CASCADE V2: Version', { version: cascadeStatus.version });

  await initializeIntegrations();
  
  // Service Bundle event listeners — serviceBundle is temporarily disabled in
  // SubscriptionManager's constructor, so guard rather than assume it exists.
  if (subscriptionManager.serviceBundle) {
    subscriptionManager.serviceBundle.on('service_used', (data) => {
      logger.info('SERVICE BUNDLE: Service used', { serviceId: data.serviceId, subscriptionId: data.subscriptionId, revenue: data.revenue });
    });

    subscriptionManager.serviceBundle.on('subscription_created', (data) => {
      logger.info('SERVICE BUNDLE: New subscription', { tier: data.tier, customerId: data.customerId });
    });

    subscriptionManager.serviceBundle.on('upsell_trigger', (data) => {
      logger.info('SERVICE BUNDLE: Upsell trigger', { customerId: data.customerId, usagePercentage: Number(data.usagePercentage.toFixed(1)) });
      // Trigger Heidi's usage-to-upsell workflow
      heidiAutomator.triggerWorkflow('usage_to_upsell', {
        customerId: data.customerId,
        subscriptionId: data.subscriptionId,
        tier: data.tier,
        usagePercentage: data.usagePercentage,
        triggerService: data.serviceId
      });
    });
  }
  
  // Setup CASCADE V2 event listeners
  cascade.on('heartbeat', (heartbeat) => {
    logger.info('CASCADE V2: Heartbeat', { status: heartbeat.status, activeModuleCount: heartbeat.active_modules.length });
  });

  cascade.on('emission_success', (success) => {
    logger.info('CASCADE V2: Emission successful', { eventId: success.event_id, targetSystem: success.target_system, acknowledged: success.acknowledged });
  });

  cascade.on('quarantine_resolved', (record) => {
    logger.info('CASCADE V2: Quarantine resolved', { eventId: record.event_id });
  });

  cascade.on('event_dead_lettered', (deadLetter) => {
    logger.info('CASCADE V2: Event dead-lettered', { eventId: deadLetter.event_id, reason: deadLetter.dead_letter_reason });
  });

  cascade.on('schema_violation', (violation) => {
    logger.info('CASCADE V2: Schema violation', { eventId: violation.event.event_id, errorCount: violation.violations.length });
  });

  cascade.on('health_snapshot', (snapshot) => {
    // Log every 5th snapshot to avoid spam
    if (Math.random() < 0.2) {
      logger.info('CASCADE V2: Health', {
        systemHealth: snapshot.system_health,
        throughputPerSec: Number(snapshot.event_throughput.current.toFixed(2)),
        errorRatioPercent: Number((snapshot.error_ratio.current * 100).toFixed(1))
      });
    }
  });
  
  // ── Universal Agent Bus Event Bridges ──
  // Bridge Service Bundle events onto the Agent Bus for unified telemetry
  // (guarded — serviceBundle is temporarily disabled, see block above)
  if (subscriptionManager.serviceBundle) {
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
  }
  
  // Bridge local model health events to dashboard
  agentBus.on('model_flatlined', (event) => {
    logger.info('AGENT BUS: ALERT Model flatlined', { modelId: event.modelId, backupRoute: event.backupRoute || 'NONE' });
  });

  agentBus.on('model_redirect', (event) => {
    logger.info('AGENT BUS: Redirect', { from: event.from, to: event.to, reason: event.reason });
  });

  agentBus.on('fail_event', (fail) => {
    logger.info('AGENT BUS: Fail event', { action: fail.action, customerId: fail.customerId || 'system', error: fail.error });
  });

  // Bridge Ursula heartbeat to the Agent Bus
  const ursulaHeartbeat = require('../modules/ursula-heartbeat');
  if (ursulaHeartbeat) {
    logger.info('AGENT BUS: Ursula heartbeat monitor bridged to bus telemetry');
  }
  
  // cascadeStatus (from cascade.start(), above) is just { status, start_time,
  // version } — the summary below needs the live stats/system_health shape.
  const cascadeStats = cascade.getStatus();
  logger.info('Startup summary: CASCADE V2', {
    processed: cascadeStats.stats.events_processed,
    rejected: cascadeStats.stats.events_rejected,
    rejectedSchemaViolations: cascadeStats.stats.schema_violations,
    rejectedDuplicates: cascadeStats.stats.duplicate_blocks,
    rejectedLowConfidence: cascadeStats.stats.low_confidence_blocks,
    quarantined: cascadeStats.stats.events_quarantined,
    deadLettered: cascadeStats.stats.events_dead_lettered,
    repairManifestsGenerated: cascadeStats.stats.repair_manifests_generated,
    systemHealth: cascadeStats.system_health.toUpperCase(),
    pipeline: 'Schema Lock -> Fingerprint -> Confidence Check -> Hard Classification -> Decision -> Emit (w/ Ack) -> Dead Letter',
    serviceBundleActiveServices: subscriptionManager.serviceBundle ? subscriptionManager.serviceBundle.services.size : 'disabled',
    serviceBundleActiveSubscriptions: subscriptionManager.subscriptions ? subscriptionManager.subscriptions.size : 'n/a (DB-backed)'
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SHUTDOWN: Gracefully shutting down Forge ecosystem');

  // 1. Persist in-flight Agent Bus messages to pending_tasks table
  logger.info('SHUTDOWN: Persisting in-flight Agent Bus messages');
  try {
    await agentBus.persistInFlight();
    await agentBus.flushTelemetry(true);
    agentBus.stopHeartbeatMonitor();
    logger.info('SHUTDOWN: Agent Bus state persisted and telemetry flushed');
  } catch (err) {
    logger.error('SHUTDOWN: Agent Bus persistence error', { error: err.message });
  }

  // 2. Stop Heidi automator
  heidiAutomator.stop();
  logger.info('SHUTDOWN: Heidi automator stopped');

  // 3. Shutdown local model adapter
  await localModelAdapter.shutdown();
  logger.info('SHUTDOWN: Local model adapter shut down');

  logger.info('SHUTDOWN: Forge ecosystem shutdown complete');
  process.exit(0);
});

// server.listen(PORT) above (line ~1542) is the authoritative listener — it wraps app
// with an http.Server so WebSocket support works. Do not add a second app.listen here.

// Export app for testing
module.exports = app;

