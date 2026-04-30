import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { createClient as createRedisClient } from "npm:@redis/client@1.5.14";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HEIDI_REFLECT_SECRET = Deno.env.get("HEIDI_REFLECT_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Redis client for caching reflection state
let redis: ReturnType<typeof createRedisClient> | null = null;

async function getRedis() {
  if (!redis) {
    const redisUrl = Deno.env.get("REDIS_URL");
    if (redisUrl) {
      redis = createRedisClient({ url: redisUrl });
      await redis.connect();
    }
  }
  return redis;
}

interface ReflectionWindow {
  window_minutes: number;
  correlation_id?: string;
}

interface ReflectionResult {
  correlation_id: string;
  insights_generated: number;
  adaptations_identified: number;
  confidence_updates: number;
  performance_metrics: {
    task_success_rate: number;
    average_confidence: number;
    error_frequency: number;
    learning_velocity: number;
  };
  processing_time_ms: number;
}

interface Insight {
  type: string;
  correlation_id: string;
  confidence: number;
  created_at: string;
  next_action?: {
    type: string;
    config: any;
    auto_safe: boolean;
  };
  [key: string]: any;
}

Deno.serve(async (req: Request) => {
  const startTime = Date.now();
  const correlationId = crypto.randomUUID();
  
  // HARD AUTH CHECK: Reject immediately without proper secret
  const secret = req.headers.get("x-heidi-secret");
  if (!secret || secret !== HEIDI_REFLECT_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  
  // Prevent parallel reflection cycles
  const lockKey = `heidi-reflection-lock`;
  const lock = await getRedis();
  if (lock) {
    const existingLock = await lock.get(lockKey);
    if (existingLock) {
      return new Response(JSON.stringify({ 
        error: "Reflection already in progress",
        lock_holder: existingLock
      }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    // Set lock with 5 minute timeout
    await lock.setEx(lockKey, 300, correlationId);
  }
  
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as ReflectionWindow;
    const windowMinutes = Math.max(1, Math.min(60, body.window_minutes ?? 10));
    
    console.log(`[HEIDI-REFLECT] Starting reflection cycle ${correlationId} for ${windowMinutes} minute window`);

    // Log reflection start
    await logEvent("reflection.started", {
      correlation_id: correlationId,
      window_minutes: windowMinutes,
      actor: "heidi-reflection-engine"
    });

    // 1. Fetch recent events for analysis
    const events = await fetchRecentEvents(windowMinutes);
    console.log(`[HEIDI-REFLECT] Retrieved ${events.length} events for analysis`);

    // 2. Generate insights from events
    const insights = await generateInsights(events, correlationId);
    console.log(`[HEIDI-REFLECT] Generated ${insights.length} insights`);

    // 3. Identify adaptation patterns
    const adaptations = await identifyAdaptationPatterns(insights, correlationId);
    console.log(`[HEIDI-REFLECT] Identified ${adaptations.length} adaptation patterns`);

    // 4. Update performance metrics
    const performanceMetrics = await updatePerformanceMetrics(events, correlationId);
    console.log(`[HEIDI-REFLECT] Updated performance metrics`);

    // 5. Generate confidence updates
    const confidenceUpdates = await generateConfidenceUpdates(performanceMetrics, correlationId);
    console.log(`[HEIDI-REFLECT] Generated ${confidenceUpdates.length} confidence updates`);

    // 6. Persist reflection results
    const reflectionResult: ReflectionResult = {
      correlation_id: correlationId,
      insights_generated: insights.length,
      adaptations_identified: adaptations.length,
      confidence_updates: confidenceUpdates.length,
      performance_metrics: performanceMetrics,
      processing_time_ms: Date.now() - startTime
    };

    await persistReflectionResults(reflectionResult, insights, adaptations, confidenceUpdates);

    // 7. Execute actions for insights with auto_safe = true
    const executedActions = [];
    for (const insight of insights) {
      if (insight.next_action?.auto_safe) {
        try {
          await executeAction(insight.next_action, correlationId);
          executedActions.push({
            insight_type: insight.type,
            action: insight.next_action.type,
            status: "executed"
          });
        } catch (error) {
          executedActions.push({
            insight_type: insight.type,
            action: insight.next_action.type,
            status: "failed",
            error: error instanceof Error ? error.message : String(error)
          });
        }
      } else {
        // Escalate unsafe actions
        await logEvent("action.escalation_required", {
          correlation_id: correlationId,
          insight: insight,
          action: insight.next_action,
          actor: "heidi-reflection-engine"
        });
      }
    }

    // 8. Emit adaptation events
    for (const adaptation of adaptations) {
      await logEvent("adaptation.required", {
        correlation_id: correlationId,
        adaptation: adaptation,
        actor: "heidi-reflection-engine"
      });
    }

    console.log(`[HEIDI-REFLECT] Reflection cycle ${correlationId} completed in ${Date.now() - startTime}ms`);

    // Log reflection completion
    await logEvent("reflection.completed", {
      correlation_id: correlationId,
      result: reflectionResult,
      actor: "heidi-reflection-engine"
    });

    return new Response(JSON.stringify({ 
      ok: true, 
      reflection: reflectionResult,
      insights_count: insights.length,
      adaptations_count: adaptations.length
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[HEIDI-REFLECT] Error in reflection cycle ${correlationId}:`, msg);
    
    await logEvent("reflection.error", {
      correlation_id: correlationId,
      error: msg,
      actor: "heidi-reflection-engine"
    }).catch(() => {}); // Ignore logging errors during error handling

    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    // Release reflection lock
    if (lock) {
      await lock.del(lockKey);
    }
    
    if (redis) {
      await redis.quit();
    }
  }
});

async function fetchRecentEvents(windowMinutes: number) {
  const cutoffTime = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  
  // Get events that haven't been processed in the last reflection cycle
  const { data, error } = await supabase
    .from("heidi_events")
    .select("*")
    .gte("occurred_at", cutoffTime)
    .is("processed_by_reflection", false)
    .order("occurred_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function generateInsights(events: any[], correlationId: string) {
  const insights = [];
  
  // Group events by type for pattern analysis
  const eventsByType = new Map<string, any[]>();
  events.forEach(event => {
    if (!eventsByType.has(event.event_type)) {
      eventsByType.set(event.event_type, []);
    }
    eventsByType.get(event.event_type)!.push(event);
  });

  // Analyze each event type for patterns
  for (const [eventType, typeEvents] of eventsByType) {
    // Error pattern analysis
    if (eventType.includes("error") || eventType.includes("failure")) {
      const errorInsight = await analyzeErrorPatterns(typeEvents, correlationId);
      if (errorInsight) {
        errorInsight.next_action = generateAction(errorInsight);
        insights.push(errorInsight);
      }
    }

    // Performance pattern analysis
    if (eventType.includes("performance") || eventType.includes("task")) {
      const performanceInsight = await analyzePerformancePatterns(typeEvents, correlationId);
      if (performanceInsight) {
        performanceInsight.next_action = generateAction(performanceInsight);
        insights.push(performanceInsight);
      }
    }

    // User interaction analysis
    if (eventType.includes("interaction") || eventType.includes("user")) {
      const interactionInsight = await analyzeInteractionPatterns(typeEvents, correlationId);
      if (interactionInsight) {
        interactionInsight.next_action = generateAction(interactionInsight);
        insights.push(interactionInsight);
      }
    }

    // System health analysis
    if (eventType.includes("health") || eventType.includes("system")) {
      const healthInsight = await analyzeHealthPatterns(typeEvents, correlationId);
      if (healthInsight) {
        healthInsight.next_action = generateAction(healthInsight);
        insights.push(healthInsight);
      }
    }
  }

  // CRITICAL: Delete insights without next_action
  return insights.filter(insight => insight.next_action);
}

function generateAction(insight: any) {
  if (insight.confidence < 0.7) {
    return null; // Low confidence insights get deleted
  }

  const actionMap = {
    "error_pattern": {
      type: "implement_error_recovery",
      config: { 
        error_type: insight.pattern,
        retry_strategy: "exponential_backoff",
        max_retries: 3
      },
      auto_safe: true
    },
    "performance_degradation": {
      type: "enable_caching",
      config: { 
        cache_ttl: 300,
        cache_key: insight.metric
      },
      auto_safe: true
    },
    "slow_response_pattern": {
      type: "simplify_interface",
      config: { 
        target: insight.metric,
        complexity_reduction: 0.3
      },
      auto_safe: true
    },
    "high_ignore_pattern": {
      type: "adjust_alert_thresholds",
      config: { 
        new_threshold: insight.current_value * 0.8,
        review_period: 3600
      },
      auto_safe: true
    },
    "repeated_health_issues": {
      type: "escalate_to_human",
      config: { 
        severity: "critical",
        requires_approval: true
      },
      auto_safe: false
    }
  };

  return actionMap[insight.type] || {
    type: "monitor_pattern",
    config: { pattern: insight.type },
    auto_safe: true
  };
}

async function analyzeErrorPatterns(errorEvents: any[], correlationId: string) {
  if (errorEvents.length < 3) return null; // Need at least 3 errors for pattern

  // Group by error type
  const errorsByType = new Map<string, any[]>();
  errorEvents.forEach(event => {
    const errorType = event.payload?.error_type || "unknown";
    if (!errorsByType.has(errorType)) {
      errorsByType.set(errorType, []);
    }
    errorsByType.get(errorType)!.push(event);
  });

  // Find most frequent error type
  let mostFrequentError = "";
  let maxCount = 0;
  for (const [errorType, errors] of errorsByType) {
    if (errors.length > maxCount) {
      maxCount = errors.length;
      mostFrequentError = errorType;
    }
  }

  if (maxCount >= 3) {
    return {
      type: "error_pattern",
      correlation_id: correlationId,
      pattern: mostFrequentError,
      frequency: maxCount,
      timeframe: "window",
      confidence: Math.min(0.9, 0.3 + (maxCount * 0.1)),
      recommendations: [
        "Investigate root cause of recurring error",
        "Implement automated recovery mechanism",
        "Add monitoring for early detection"
      ],
      created_at: new Date().toISOString()
    };
  }

  return null;
}

async function analyzePerformancePatterns(performanceEvents: any[], correlationId: string) {
  if (performanceEvents.length < 2) return null;

  // Extract performance metrics
  const durations = performanceEvents
    .map(event => event.payload?.duration_ms)
    .filter(d => typeof d === "number");

  if (durations.length < 2) return null;

  const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
  const maxDuration = Math.max(...durations);
  const minDuration = Math.min(...durations);

  // Check for performance degradation
  let insight = null;
  if (avgDuration > 5000) { // 5 second threshold
    insight = {
      type: "performance_degradation",
      correlation_id: correlationId,
      metric: "response_time",
      current_value: avgDuration,
      threshold: 5000,
      confidence: Math.min(0.8, 0.4 + (avgDuration / 10000)),
      recommendations: [
        "Optimize slow operations",
        "Consider caching strategies",
        "Review resource allocation"
      ],
      created_at: new Date().toISOString()
    };
  } else if (maxDuration > minDuration * 10) { // High variance
    insight = {
      type: "performance_variance",
      correlation_id: correlationId,
      metric: "response_time_variance",
      variance_ratio: maxDuration / minDuration,
      confidence: 0.6,
      recommendations: [
        "Investigate performance outliers",
        "Standardize response patterns",
        "Add performance monitoring"
      ],
      created_at: new Date().toISOString()
    };
  }

  return insight;
}

async function analyzeInteractionPatterns(interactionEvents: any[], correlationId: string) {
  if (interactionEvents.length < 5) return null;

  // Analyze response times
  const responseTimes = interactionEvents
    .map(event => event.payload?.response_time_ms)
    .filter(d => typeof d === "number");

  if (responseTimes.length < 3) return null;

  const avgResponseTime = responseTimes.reduce((sum, d) => sum + d, 0) / responseTimes.length;
  const ignoredCount = interactionEvents.filter(e => e.payload?.action === "ignore").length;
  const ignoreRate = ignoredCount / interactionEvents.length;

  let insight = null;
  if (avgResponseTime > 10000) { // 10 second threshold
    insight = {
      type: "slow_response_pattern",
      correlation_id: correlationId,
      metric: "user_response_time",
      current_value: avgResponseTime,
      threshold: 10000,
      confidence: Math.min(0.8, 0.5 + (avgResponseTime / 20000)),
      recommendations: [
        "Simplify user interface",
        "Add progressive disclosure",
        "Improve system responsiveness"
      ],
      created_at: new Date().toISOString()
    };
  } else if (ignoreRate > 0.3) { // 30% ignore rate
    insight = {
      type: "high_ignore_pattern",
      correlation_id: correlationId,
      metric: "alert_ignore_rate",
      current_value: ignoreRate,
      threshold: 0.3,
      confidence: Math.min(0.9, 0.4 + (ignoreRate * 2)),
      recommendations: [
        "Review alert prioritization",
        "Reduce alert fatigue",
        "Improve alert relevance"
      ],
      created_at: new Date().toISOString()
    };
  }

  return insight;
}

async function analyzeHealthPatterns(healthEvents: any[], correlationId: string) {
  if (healthEvents.length < 2) return null;

  // Check for repeated health issues
  const criticalEvents = healthEvents.filter(e => 
    e.payload?.severity === "critical" || e.payload?.health === "critical"
  );

  if (criticalEvents.length >= 2) {
    return {
      type: "repeated_health_issues",
      correlation_id: correlationId,
      severity: "critical",
      count: criticalEvents.length,
      timeframe: "window",
      confidence: Math.min(0.9, 0.6 + (criticalEvents.length * 0.1)),
      recommendations: [
        "Immediate system intervention required",
        "Implement automated safeguards",
        "Escalate to system administrator"
      ],
      created_at: new Date().toISOString()
    };
  }

  return null;
}

async function identifyAdaptationPatterns(insights: any[], correlationId: string) {
  const adaptations = [];
  
  // Group insights by type
  const insightsByType = new Map<string, any[]>();
  insights.forEach(insight => {
    if (!insightsByType.has(insight.type)) {
      insightsByType.set(insight.type, []);
    }
    insightsByType.get(insight.type)!.push(insight);
  });

  // Generate adaptations for recurring patterns
  for (const [insightType, typeInsights] of insightsByType) {
    if (typeInsights.length >= 2) { // Need at least 2 similar insights
      const avgConfidence = typeInsights.reduce((sum, i) => sum + i.confidence, 0) / typeInsights.length;
      
      if (avgConfidence > 0.7) {
        adaptations.push({
          correlation_id: correlationId,
          pattern: insightType,
          occurrences: typeInsights.length,
          confidence: avgConfidence,
          strategy: getAdaptationStrategy(insightType),
          created_at: new Date().toISOString()
        });
      }
    }
  }

  return adaptations;
}

function getAdaptationStrategy(patternType: string) {
  const strategies = {
    "error_pattern": {
      action: "automated_recovery",
      priority: "high",
      implementation: "Implement error-specific recovery mechanisms",
      expected_impact: 0.7
    },
    "performance_degradation": {
      action: "performance_optimization",
      priority: "medium",
      implementation: "Optimize slow operations and add caching",
      expected_impact: 0.5
    },
    "slow_response_pattern": {
      action: "interface_optimization",
      priority: "medium",
      implementation: "Simplify UI and improve responsiveness",
      expected_impact: 0.4
    },
    "high_ignore_pattern": {
      action: "alert_system_overhaul",
      priority: "high",
      implementation: "Redesign alert prioritization and presentation",
      expected_impact: 0.6
    },
    "repeated_health_issues": {
      action: "systemic_intervention",
      priority: "critical",
      implementation: "Implement automated safeguards and monitoring",
      expected_impact: 0.8
    }
  };

  return strategies[patternType] || {
    action: "monitor_pattern",
    priority: "low",
    implementation: "Continue monitoring for pattern evolution",
    expected_impact: 0.1
  };
}

async function updatePerformanceMetrics(events: any[], correlationId: string) {
  const taskEvents = events.filter(e => e.event_type.includes("task"));
  const errorEvents = events.filter(e => e.event_type.includes("error"));
  
  const totalTasks = taskEvents.length;
  const successfulTasks = taskEvents.filter(e => e.payload?.status === "completed").length;
  const taskSuccessRate = totalTasks > 0 ? successfulTasks / totalTasks : 0;
  
  const errorRate = events.length > 0 ? errorEvents.length / events.length : 0;
  
  // Calculate learning velocity (insights per hour)
  const insightsPerHour = events.length / (10 / 60); // 10 minute window
  
  return {
    task_success_rate: taskSuccessRate,
    average_confidence: 0.8, // Would be calculated from actual insights
    error_frequency: errorRate,
    learning_velocity: insightsPerHour,
    correlation_id: correlationId,
    window_minutes: 10,
    created_at: new Date().toISOString()
  };
}

async function generateConfidenceUpdates(performanceMetrics: any, correlationId: string) {
  const updates = [];
  
  // Adjust confidence based on success rate
  if (performanceMetrics.task_success_rate < 0.7) {
    updates.push({
      correlation_id: correlationId,
      metric: "decision_confidence",
      old_threshold: 0.6,
      new_threshold: 0.7,
      reason: "low_success_rate",
      created_at: new Date().toISOString()
    });
  } else if (performanceMetrics.task_success_rate > 0.9) {
    updates.push({
      correlation_id: correlationId,
      metric: "decision_confidence",
      old_threshold: 0.6,
      new_threshold: 0.5,
      reason: "high_success_rate",
      created_at: new Date().toISOString()
    });
  }
  
  return updates;
}

async function executeAction(action: any, correlationId: string) {
  console.log(`[HEIDI-REFLECT] Executing action: ${action.type}`);
  
  switch (action.type) {
    case "implement_error_recovery":
      // Would implement error recovery logic
      console.log(`[HEIDI-REFLECT] Error recovery for: ${action.config.error_type}`);
      break;
      
    case "enable_caching":
      // Would enable caching for the specified metric
      console.log(`[HEIDI-REFLECT] Enabling cache for: ${action.config.cache_key}`);
      break;
      
    case "simplify_interface":
      // Would simplify the interface
      console.log(`[HEIDI-REFLECT] Simplifying interface: ${action.config.target}`);
      break;
      
    case "adjust_alert_thresholds":
      // Would adjust alert thresholds
      console.log(`[HEIDI-REFLECT] Adjusting alert thresholds to: ${action.config.new_threshold}`);
      break;
      
    default:
      console.log(`[HEIDI-REFLECT] Unknown action type: ${action.type}`);
  }
  
  // Log action execution
  await logEvent("action.executed", {
    correlation_id: correlationId,
    action: action,
    actor: "heidi-reflection-engine"
  });
}

async function persistReflectionResults(result: ReflectionResult, insights: any[], adaptations: any[], confidenceUpdates: any[]) {
  // Store main reflection result
  const { error: reflectionError } = await supabase
    .from("heidi_reflections")
    .insert({
      cycle_id: result.correlation_id,
      insights_generated: result.insights_generated,
      adaptations_identified: result.adaptations_identified,
      confidence_updates: result.confidence_updates,
      performance_metrics: result.performance_metrics,
      processing_time_ms: result.processing_time_ms,
      created_at: new Date().toISOString()
    });

  if (reflectionError) throw reflectionError;

  // Store insights
  if (insights.length > 0) {
    const { error: insightsError } = await supabase
      .from("heidi_insights")
      .insert(insights);

    if (insightsError) throw insightsError;
  }

  // Store adaptations
  if (adaptations.length > 0) {
    const { error: adaptationsError } = await supabase
      .from("heidi_adaptations")
      .insert(adaptations);

    if (adaptationsError) throw adaptationsError;
  }

  // Store confidence updates
  if (confidenceUpdates.length > 0) {
    const { error: confidenceError } = await supabase
      .from("heidi_confidence_updates")
      .insert(confidenceUpdates);

    if (confidenceError) throw confidenceError;
  }
  
  // Mark events as processed by this reflection cycle
  const cutoffTime = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minute window
  await supabase
    .from("heidi_events")
    .update({ processed_by_reflection: true })
    .gte("occurred_at", cutoffTime)
    .is("processed_by_reflection", false);
}

async function logEvent(eventType: string, payload: Record<string, unknown>) {
  try {
    await supabase.functions.invoke("heidi-ingest-event", {
      body: {
        actor: "heidi-reflection-engine",
        event_type: eventType,
        correlation_id: payload.correlation_id || crypto.randomUUID(),
        payload: payload,
        occurred_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("Failed to log event:", error);
  }
}
