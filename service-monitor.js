// Service Health Monitor with Daily Slack Digest
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Load environment
function loadEnvironment() {
  const envContent = fs.readFileSync('.env', 'utf8');
  const env = {};
  
  const lines = envContent.split('\n');
  lines.forEach(line => {
    if (line.startsWith('#') || line.trim() === '') return;
    
    const equalIndex = line.indexOf('=');
    if (equalIndex > 0) {
      const key = line.substring(0, equalIndex).trim();
      let value = line.substring(equalIndex + 1).trim();
      
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      env[key] = value;
    }
  });
  
  return env;
}

// Configuration
const DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const CHECK_INTERVAL_MS = 30000; // 30 seconds
const MAX_FAILURES_BEFORE_ALERT = 3;

// Load environment
const env = loadEnvironment();
const { SUPABASE_URL, SLACK_WEBHOOK_URL } = env;

// Services to monitor
const services = [
  { name: 'Stripe Webhook', fn: 'stripe-webhook' },
  { name: 'Event Streaming', fn: 'events-stream' },
  { name: 'Job Processor', fn: 'jobs-processor' },
  { name: 'Monitoring Service', fn: 'monitoring-health' },
  { name: 'Payout Processor', fn: 'stripe-transfer-payout' },
];

// Extended state for metrics
const state = new Map(
  services.map((s) => [
    s.fn,
    {
      consecutiveFailures: 0,
      lastStatus: "UNKNOWN",
      alertedDown: false,
      
      // digest metrics
      totalChecks: 0,
      successChecks: 0,
      failureChecks: 0,
      totalLatencyMs: 0, // only for successful checks
      minLatencyMs: null,
      maxLatencyMs: null,
      lastError: null,
    },
  ])
);

// Check service health with latency tracking
async function checkServiceHealth(serviceName, functionSlug) {
  const startTime = Date.now();
  const endpoint = `${SUPABASE_URL}/functions/v1/${functionSlug}`;
  
  try {
    // Special handling for Stripe Webhook (POST-only)
    let response;
    if (functionSlug === 'stripe-webhook') {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ healthCheck: true }),
        timeout: 10000
      });
    } else {
      response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
    }
    
    const latency = Date.now() - startTime;
    
    // For POST-only services like Stripe Webhook, 400 is expected for health checks
    if (functionSlug === 'stripe-webhook') {
      if (response.status === 400 || response.ok) {
        return {
          status: 'healthy',
          latency,
          timestamp: new Date().toISOString()
        };
      } else {
        return {
          status: 'unhealthy',
          error: `HTTP ${response.status}`,
          latency,
          timestamp: new Date().toISOString()
        };
      }
    }
    
    // Standard GET-based services
    if (response.ok) {
      return {
        status: 'healthy',
        latency,
        timestamp: new Date().toISOString()
      };
    } else {
      return {
        status: 'unhealthy',
        error: `HTTP ${response.status}`,
        latency,
        timestamp: new Date().toISOString()
      };
    }
  } catch (error) {
    const latency = Date.now() - startTime;
    return {
      status: 'error',
      error: error.message,
      latency,
      timestamp: new Date().toISOString()
    };
  }
}

// Send Slack notification
async function sendSlackAlert(message, isError = false) {
  if (!SLACK_WEBHOOK_URL) return;
  
  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: isError ? `🚨 ${message}` : `✅ ${message}`,
        username: 'HYDI Service Monitor'
      })
    });
  } catch (error) {
    console.error('Slack notification failed:', error.message);
  }
}

// Send daily digest
async function sendDailyDigest() {
  if (!SLACK_WEBHOOK_URL) return;
  
  const lines = [];
  for (const svc of services) {
    const st = state.get(svc.fn);
    const uptime = st.totalChecks > 0 ? ((st.successChecks / st.totalChecks) * 100).toFixed(2) : "0.00";
    const avgLatency = st.successChecks > 0 ? Math.round(st.totalLatencyMs / st.successChecks) : "-";
    
    lines.push(
      `*${svc.name}* (\`${svc.fn}\`)
• Uptime: *${uptime}%* (${st.successChecks}/${st.totalChecks})
• Failures: *${st.failureChecks}*
• Latency (avg/min/max): *${avgLatency}/${st.minLatencyMs ?? "-"}/${st.maxLatencyMs ?? "-"} ms*
• Last status: *${st.lastStatus}*${st.lastError ? `\n• Last error: \`${st.lastError}\`` : ""}`
    );
  }
  
  const text = `📊 *Daily Service Health Digest*\nProject: \`${SUPABASE_URL}\`\nTime: ${new Date().toISOString()}`;
  const blocks = [
    { type: "section", text: { type: "mrkdwn", text } },
    { type: "divider" },
    ...lines.flatMap((line, idx) => [
      { type: "section", text: { type: "mrkdwn", text: line } },
      ...(idx < lines.length - 1 ? [{ type: "divider" }] : []),
    ]),
  ];
  
  try {
    const res = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });
    if (!res.ok) console.error(`Slack digest failed: HTTP ${res.status}`);
  } catch (err) {
    console.error("Slack digest error:", err.message);
  }
}

// Reset digest counters after sending
function resetDigestMetrics() {
  for (const svc of services) {
    const st = state.get(svc.fn);
    
    st.totalChecks = 0;
    st.successChecks = 0;
    st.failureChecks = 0;
    st.totalLatencyMs = 0;
    st.minLatencyMs = null;
    st.maxLatencyMs = null;
    st.lastError = null;
  }
}

// Monitor services sweep loop
async function monitorServices() {
  console.log(`🔍 Health check sweep at ${new Date().toISOString()}`);
  
  for (const service of services) {
    const st = state.get(service.fn);
    const result = await checkServiceHealth(service.name, service.fn);
    
    // Track metrics
    st.totalChecks += 1;
    
    if (result.status === 'healthy') {
      // Success metrics
      st.successChecks += 1;
      st.totalLatencyMs += result.latency;
      st.minLatencyMs = st.minLatencyMs === null ? result.latency : Math.min(st.minLatencyMs, result.latency);
      st.maxLatencyMs = st.maxLatencyMs === null ? result.latency : Math.max(st.maxLatencyMs, result.latency);
      
      // Reset failure tracking
      st.consecutiveFailures = 0;
      st.lastError = null;
      
      // Recovery alert
      if (st.lastStatus !== 'healthy' && st.alertedDown) {
        await sendSlackAlert(`${service.name} has recovered ✅`);
        st.alertedDown = false;
      }
      
      st.lastStatus = 'healthy';
      console.log(`✅ ${service.name}: Healthy (${result.latency}ms)`);
      
    } else {
      // Failure metrics
      st.failureChecks += 1;
      st.lastError = result.error;
      st.consecutiveFailures++;
      
      // Down alert
      if (st.consecutiveFailures >= MAX_FAILURES_BEFORE_ALERT && !st.alertedDown) {
        await sendSlackAlert(`${service.name} is DOWN (${st.consecutiveFailures} consecutive failures): ${result.error}`, true);
        st.alertedDown = true;
      }
      
      st.lastStatus = 'unhealthy';
      console.log(`❌ ${service.name}: ${result.error} (${result.latency}ms) - Failure #${st.consecutiveFailures}`);
    }
  }
  
  // Summary
  const healthyCount = Array.from(state.values()).filter(st => st.lastStatus === 'healthy').length;
  console.log(`📊 Sweep complete: ${healthyCount}/${services.length} services healthy`);
}

// Main monitoring function
async function startMonitoring() {
  console.log('🚀 Starting HYDI Service Monitor');
  console.log(`📡 Monitoring ${services.length} services every ${CHECK_INTERVAL_MS/1000}s`);
  console.log(`📬 Daily digest every ${DIGEST_INTERVAL_MS/1000/60/60}h`);
  console.log(`🔔 Alert threshold: ${MAX_FAILURES_BEFORE_ALERT} consecutive failures`);
  
  // Initial health check
  await monitorServices();
  
  // Regular monitoring interval
  setInterval(monitorServices, CHECK_INTERVAL_MS);
  
  // Daily digest interval
  setInterval(async () => {
    try {
      await sendDailyDigest();
      resetDigestMetrics();
      console.log('📬 Daily digest sent and metrics reset');
    } catch (e) {
      console.error("Daily digest failed:", e.message);
    }
  }, DIGEST_INTERVAL_MS);
  
  console.log('✅ Service monitor started successfully');
}

// Start monitoring
startMonitoring().catch(error => {
  console.error('Failed to start monitoring:', error);
  process.exit(1);
});
