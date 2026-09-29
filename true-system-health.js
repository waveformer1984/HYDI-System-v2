/**
 * TRUE SYSTEM HEALTH - Unified Health Check
 * Source of truth for system status
 * Usage: node true-system-health.js [--json]
 * Exit codes: 0=OK/WARNING, 1=CRITICAL
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const JSON_MODE = process.argv.includes('--json');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Event Flow liveness check, extracted so it can be unit tested against a
 * fixture Supabase client without a live database (see
 * tests/unit/true-system-health-eventflow.test.js).
 *
 * What counts as evidence of event-system liveness, and why:
 *
 * This used to exclude event_type='cognitive_cycle' from the "last event"
 * query (SELF_GENERATED_EVENT_TYPES). That exclusion was correct for a
 * DIFFERENT, now-fixed problem: evaluate_system_escalation() (a different
 * mechanism, in a different table -- event_bus_events) used to write a row
 * every time this health check ran, so the check was measuring its own
 * output. That write path was removed entirely in migration
 * 20260915180000_dashboard_read_purity.sql.
 *
 * cognitive_cycle never had that problem. It is written by
 * lib/heidi/CognitiveCore.ts's recordCycle() through the same
 * this.pool.query() call, into the same heidi_events table, as
 * authorization_escalation -- not a weaker or self-referential signal, just
 * a much more frequent one (hydi-daemon's own ~60s self-observation loop).
 * If that write path broke, cognitive_cycle would stop landing too, so its
 * presence is direct evidence the event system can currently write -- which
 * is exactly what this check exists to answer. Verified 2026-09-17:
 * excluding it produced 20/20 consecutive CRITICAL system_health_runs while
 * every other signal (process liveness, watchdog's independent classifier,
 * protoforge-core's own event counter) confirmed the system was healthy --
 * the only thing that had actually stopped for 21+ hours was
 * authorization_escalation, a rare, request-driven event type that HYDI can
 * legitimately go many hours without needing in a low-traffic deployment.
 *
 * A genuine total stall (no heidi_events row of ANY type, including
 * cognitive_cycle) still reports CRITICAL, unchanged.
 */
async function checkEventFlow(supabaseClient, now = new Date()) {
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

    const { data: recentEvents, error: recentError } = await supabaseClient
        .from('heidi_events')
        .select('event_type, created_at')
        .gte('created_at', oneHourAgo)
        .order('created_at', { ascending: false })
        .limit(20);

    const { data: lastEvent, error: lastError } = await supabaseClient
        .from('heidi_events')
        .select('created_at,event_type')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (recentError || lastError) {
        return { status: 'UNKNOWN', error: (recentError || lastError).message, recentEvents: null, minutesSinceLastEvent: null, lastEventTime: null };
    }

    const lastEventTime = lastEvent ? new Date(lastEvent.created_at) : null;
    const minutesSinceLastEvent = lastEventTime
        ? Math.floor((now - lastEventTime) / (1000 * 60))
        : null;

    // No event at all is the WORST case, not the best. Guarded explicitly
    // because `null < 10` is true in JS, so a naive comparison chain would
    // report a completely dead event bus as OK.
    const status =
        minutesSinceLastEvent === null ? 'CRITICAL' :
        minutesSinceLastEvent < 10 ? 'OK' :
        minutesSinceLastEvent < 30 ? 'WARNING' : 'CRITICAL';

    return {
        status,
        recentEvents: recentEvents || [],
        minutesSinceLastEvent,
        lastEventTime: lastEvent?.created_at ?? null,
    };
}

/**
 * Revenue is an OPTIONAL integration, not a core subsystem.
 *
 * 2026-09-18: this check previously set health.status='WARNING' whenever no
 * payment had landed in 24h. With STRIPE_SECRET_KEY deliberately unset for
 * local-first operation that condition is permanent, which pinned the whole
 * system at WARNING in 20/20 runs, drove trend='degrading' and
 * warning_escalation, made /api/health report 'degraded', and caused the
 * watchdog to score 29 successful process restarts as 0 successful recoveries
 * (recovery's postcondition requires postState==='HEALTHY'). An optional
 * service that was never configured cannot be a system fault.
 *
 * Returns a status the caller records but MUST NOT fold into core health.
 */
async function checkRevenue(supabaseClient, env = process.env, now = new Date()) {
    if (!env.STRIPE_SECRET_KEY) {
        return {
            status: 'OPTIONAL_SERVICE_UNAVAILABLE',
            reason: 'stripe_not_configured',
            configured: false,
            payments24h: 0,
            revenue24h: 0,
        };
    }

    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    let payments, payError;
    try {
        ({ data: payments, error: payError } = await supabaseClient
            .from('webhook_events')
            .select('created_at, payload->amount as amount')
            .eq('type', 'invoice.payment_succeeded')
            .gte('created_at', oneDayAgo));
    } catch (err) {
        return { status: 'UNKNOWN', reason: 'query_threw', configured: true, error: err.message };
    }

    if (payError) {
        return { status: 'UNKNOWN', reason: 'query_failed', configured: true, error: payError.message };
    }

    const paymentCount = payments?.length || 0;
    const totalRevenue = payments?.reduce((sum, p) => sum + (parseInt(p.amount || 0, 10) / 100), 0) || 0;

    return {
        // Zero payments on a configured provider is a business fact, not a defect.
        status: paymentCount > 0 ? 'OK' : 'NO_ACTIVITY',
        configured: true,
        payments24h: paymentCount,
        revenue24h: totalRevenue,
    };
}

/**
 * Entitlements is an OPTIONAL integration. The table does not exist in this
 * deployment; the previous code caught that error, set status 'UNKNOWN', and
 * pushed nothing to issues or warnings -- so the unknown was invisible, and
 * entitlements_status was never even written to system_health_runs. A missing
 * table is a knowable, reportable condition, distinct from a genuine unknown.
 */
async function checkEntitlements(supabaseClient) {
    let rows, entError;
    try {
        ({ data: rows, error: entError } = await supabaseClient
            .from('entitlements')
            .select('status')
            .limit(100));
    } catch (err) {
        return { status: 'UNKNOWN', reason: 'query_threw', error: err.message };
    }

    if (entError) {
        const msg = entError.message || '';
        const missing = entError.code === '42P01' || /does not exist|could not find the table/i.test(msg);
        return missing
            ? { status: 'OPTIONAL_SERVICE_UNAVAILABLE', reason: 'table_missing', error: msg }
            : { status: 'UNKNOWN', reason: 'query_failed', error: msg };
    }

    const total = rows?.length || 0;
    const active = rows?.filter((e) => e.status === 'active').length || 0;
    return { status: total > 0 ? 'OK' : 'NO_ACTIVITY', active, total };
}

/**
 * Surface an UNKNOWN so it stays visible in the payload. Never upgrades a
 * status, never degrades core health -- an unknown optional integration is
 * reported, not treated as a pass and not treated as a system failure.
 */
function recordUnknown(health, name, result) {
    if (result && (result.status === 'UNKNOWN' || result.status === 'ERROR')) {
        health.unknowns.push(`${name}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`);
    }
}

async function getSystemHealth() {
    if (!JSON_MODE) {
        console.log('🔍 TRUE SYSTEM HEALTH CHECK\n');
        console.log('='.repeat(70));
    }
    
    const health = {
        timestamp: new Date().toISOString(),
        status: 'OK',
        // CORE only: queue, eventFlow, automation. These alone may set `status`.
        components: {},
        // Optional integrations (Stripe revenue, entitlements). Reported truthfully,
        // but structurally incapable of degrading core status -- an absent optional
        // service is not a system fault.
        optionalIntegrations: {},
        issues: [],
        warnings: [],
        // Anything we genuinely could not determine. UNKNOWN stays visible here
        // rather than being swallowed; it is never upgraded to a pass.
        unknowns: [],
        environment: process.env.NODE_ENV || 'production'
    };
    
    // ========== 1. QUEUE HEALTH ==========
    console.log('\n📊 QUEUE HEALTH');
    console.log('-'.repeat(70));
    try {
        const { data: queueStats, error } = await supabase
            .from('worker_jobs')
            .select('status')
            .order('created_at', { ascending: false })
            .limit(200);
            
        if (!error && queueStats) {
            const distribution = queueStats.reduce((acc, job) => {
                acc[job.status] = (acc[job.status] || 0) + 1;
                return acc;
            }, {});
            
            const queued = distribution.queued || 0;
            const done = distribution.done || 0;
            const failed = distribution.failed || 0;
            const processing = distribution.processing || 0;
            const total = queueStats.length;
            
            health.components.queue = {
                status: queued < 20 && failed < 5 ? 'OK' : queued < 50 ? 'WARNING' : 'CRITICAL',
                queued,
                done,
                failed,
                processing,
                total
            };
            
            console.log(`  Status Distribution (last ${total} jobs):`);
            console.log(`    ✅ done:        ${done}`);
            console.log(`    ⏳ queued:      ${queued}`);
            console.log(`    🔄 processing:  ${processing}`);
            console.log(`    ❌ failed:      ${failed}`);
            
            if (queued >= 50) {
                health.issues.push(`CRITICAL: Queue backlog (${queued} jobs)`);
                health.status = 'CRITICAL';
            } else if (queued >= 20) {
                health.warnings.push(`WARNING: Elevated queue (${queued} jobs)`);
                if (health.status === 'OK') health.status = 'WARNING';
            }
            
            if (failed >= 10) {
                health.issues.push(`CRITICAL: High failure count (${failed})`);
                health.status = 'CRITICAL';
            } else if (failed >= 5) {
                health.warnings.push(`WARNING: Elevated failures (${failed})`);
                if (health.status === 'OK') health.status = 'WARNING';
            }
        } else {
            console.log('  ❌ Cannot read queue stats');
            health.components.queue = { status: 'UNKNOWN', error: error?.message };
        }
    } catch (err) {
        console.log('  ❌ Queue check error:', err.message);
        health.components.queue = { status: 'ERROR', error: err.message };
    }
    
    // ========== 2. EVENT FLOW HEALTH ==========
    console.log('\n📡 EVENT FLOW HEALTH');
    console.log('-'.repeat(70));
    try {
        const flow = await checkEventFlow(supabase);

        if (flow.status !== 'UNKNOWN') {
            health.components.eventFlow = {
                status: flow.status,
                recentEventsCount: flow.recentEvents?.length || 0,
                lastEventMinutesAgo: flow.minutesSinceLastEvent,
                lastEventTime: flow.lastEventTime,
            };

            console.log(`  Recent events (1h): ${flow.recentEvents?.length || 0}`);
            console.log(`  Last event: ${flow.minutesSinceLastEvent !== null ? flow.minutesSinceLastEvent + ' minutes ago' : 'never'}`);

            // Show sample of recent events
            if (flow.recentEvents && flow.recentEvents.length > 0) {
                console.log('  Recent event types:');
                const eventTypeCounts = flow.recentEvents.reduce((acc, evt) => {
                    acc[evt.event_type] = (acc[evt.event_type] || 0) + 1;
                    return acc;
                }, {});
                Object.entries(eventTypeCounts).slice(0, 5).forEach(([eventType, count]) => {
                    console.log(`    - ${eventType}: ${count}`);
                });
            }

            if (flow.minutesSinceLastEvent === null) {
                health.issues.push('CRITICAL: No operational events have ever been recorded');
                health.status = 'CRITICAL';
            } else if (flow.minutesSinceLastEvent >= 30) {
                health.issues.push(`CRITICAL: No events for ${flow.minutesSinceLastEvent} minutes`);
                health.status = 'CRITICAL';
            } else if (flow.minutesSinceLastEvent >= 10) {
                health.warnings.push(`WARNING: No events for ${flow.minutesSinceLastEvent} minutes`);
                if (health.status === 'OK') health.status = 'WARNING';
            }
        } else {
            console.log('  ❌ Cannot read event flow');
            health.components.eventFlow = { status: 'UNKNOWN' };
        }
    } catch (err) {
        console.log('  ❌ Event flow error:', err.message);
        health.components.eventFlow = { status: 'ERROR', error: err.message };
    }
    
    // ========== 3. REVENUE FLOW (OPTIONAL INTEGRATION) ==========
    console.log('\n💰 REVENUE FLOW (optional integration)');
    console.log('-'.repeat(70));
    health.optionalIntegrations.revenue = await checkRevenue(supabase);
    {
        const r = health.optionalIntegrations.revenue;
        console.log(`  Status: ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
        if (r.configured) {
            console.log(`  Payments (24h): ${r.payments24h}`);
            console.log(`  Revenue (24h): $${(r.revenue24h || 0).toFixed(2)}`);
        }
        recordUnknown(health, 'revenue', r);
    }

    // ========== 4. ENTITLEMENTS (OPTIONAL INTEGRATION) ==========
    console.log('\n🔑 ENTITLEMENTS (optional integration)');
    console.log('-'.repeat(70));
    health.optionalIntegrations.entitlements = await checkEntitlements(supabase);
    {
        const e = health.optionalIntegrations.entitlements;
        console.log(`  Status: ${e.status}${e.reason ? ` (${e.reason})` : ''}`);
        if (e.status === 'OK' || e.status === 'NO_ACTIVITY') {
            console.log(`  Active entitlements: ${e.active}`);
            console.log(`  Total entitlements: ${e.total}`);
        }
        recordUnknown(health, 'entitlements', e);
    }
    
    // ========== 5. AUTOMATION STATUS ==========
    console.log('\n🤖 AUTOMATION STATUS');
    console.log('-'.repeat(70));
    try {
        // Same dead-table bug as event flow above (see 2026-09-14 note): this
        // looked for topic='system:heartbeat' in event_bus_events, which no
        // current writer has ever emitted. hydi-daemon's own R0 self-observation
        // loop (event_type='cognitive_cycle' in heidi_events, ~once/60s) IS a
        // genuine automation heartbeat -- unlike the event-flow check above,
        // this check's entire purpose is "is some automation loop ticking",
        // so cognitive_cycle is deliberately NOT excluded here.
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data: heartbeats, error: hbError } = await supabase
            .from('heidi_events')
            .select('created_at')
            .eq('event_type', 'cognitive_cycle')
            .gte('created_at', fiveMinutesAgo)
            .order('created_at', { ascending: false });

        if (!hbError) {
            const hasHeartbeats = heartbeats && heartbeats.length > 0;

            health.components.automation = {
                status: hasHeartbeats ? 'OK' : 'WARNING',
                heartbeats5min: heartbeats?.length || 0,
                lastHeartbeat: heartbeats?.[0]?.created_at
            };
            
            console.log(`  Heartbeats (5min): ${heartbeats?.length || 0}`);
            console.log(`  Status: ${hasHeartbeats ? '✅ Active' : '⚠️  No recent heartbeats'}`);
            
            if (!hasHeartbeats) {
                health.warnings.push('WARNING: No automation heartbeats in 5 minutes');
                if (health.status === 'OK') health.status = 'WARNING';
            }
        } else {
            console.log('  ⚠️  Cannot verify automation (no access to heartbeats)');
            health.components.automation = { status: 'UNKNOWN' };
        }
    } catch (err) {
        console.log('  ⚠️  Automation check error:', err.message);
        health.components.automation = { status: 'ERROR', error: err.message };
    }
    
    // ========== FINAL STATUS ==========
    if (!JSON_MODE) {
        console.log('\n' + '='.repeat(70));
        console.log('📋 SYSTEM HEALTH SUMMARY');
        console.log('='.repeat(70));
        
        // Overall status
        const statusEmoji = health.status === 'OK' ? '🟢' : 
                           health.status === 'WARNING' ? '🟡' : '🔴';
        console.log(`\n${statusEmoji} SYSTEM HEALTH: ${health.status}`);
        
        // Component summary
        console.log('\nComponent Status:');
        Object.entries(health.components).forEach(([name, comp]) => {
            const emoji = comp.status === 'OK' ? '✅' : 
                         comp.status === 'WARNING' ? '⚠️' : 
                         comp.status === 'CRITICAL' ? '❌' : '❓';
            console.log(`  ${emoji} ${name}: ${comp.status}`);
        });
        
        // Issues and warnings
        if (health.issues.length > 0) {
            console.log('\n🔴 CRITICAL ISSUES:');
            health.issues.forEach(issue => console.log(`  - ${issue}`));
        }
        
        if (health.warnings.length > 0) {
            console.log('\n🟡 WARNINGS:');
            health.warnings.forEach(warning => console.log(`  - ${warning}`));
        }
        
        if (health.issues.length === 0 && health.warnings.length === 0) {
            console.log('\n✅ All systems operational');
        }
        
        console.log('\n' + '='.repeat(70));
    }
    
    // Persist to database (fire and forget, don't block on this)
    try {
        await supabase.from('system_health_runs').insert({
            run_at: health.timestamp,
            status: health.status,
            environment: health.environment,
            queue_status: health.components.queue?.status,
            event_flow_status: health.components.eventFlow?.status,
            automation_status: health.components.automation?.status,
            // Optional integrations are recorded for observability but are not
            // read by analyze_health_trends()/evaluate_system_escalation(),
            // which aggregate `status` and details->components->queue only.
            revenue_status: health.optionalIntegrations.revenue?.status,
            // Previously omitted entirely, which is why the column was always NULL.
            entitlements_status: health.optionalIntegrations.entitlements?.status,
            issues_count: health.issues.length,
            warnings_count: health.warnings.length,
            details: health
        });
    } catch (persistErr) {
        // Silently fail persistence - don't break health check
        if (!JSON_MODE) {
            console.log('⚠️  (Health run not persisted - table may not exist)');
        }
    }
    
    // Return structured result for potential programmatic use
    return health;
}

module.exports = { getSystemHealth, checkEventFlow, checkRevenue, checkEntitlements };

// Run the check only when invoked directly (node true-system-health.js), not
// when required by a test -- matches scripts/system-health-scheduler.js's
// same require.main guard, added here for the same reason: this file has
// exported, independently-testable functions now (see
// tests/unit/true-system-health-eventflow.test.js) and must not execute for
// real, including calling process.exit(), just by being required.
if (require.main === module) {
    getSystemHealth().then(health => {
        if (JSON_MODE) {
            console.log(JSON.stringify(health, null, 2));
        }

        // Exit codes: 0 = OK/WARNING (operational), 1 = CRITICAL (action required)
        const exitCode = health.status === 'CRITICAL' ? 1 : 0;
        process.exit(exitCode);
    }).catch(err => {
        if (JSON_MODE) {
            console.error(JSON.stringify({ error: err.message, fatal: true }));
        } else {
            console.error('Fatal error:', err);
        }
        process.exit(1);
    });
}
