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

async function getSystemHealth() {
    if (!JSON_MODE) {
        console.log('🔍 TRUE SYSTEM HEALTH CHECK\n');
        console.log('='.repeat(70));
    }
    
    const health = {
        timestamp: new Date().toISOString(),
        status: 'OK',
        components: {},
        issues: [],
        warnings: [],
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
        // Recent event activity
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { data: recentEvents, error: recentError } = await supabase
            .from('event_bus_events')
            .select('topic, event_name, occurred_at')
            .gte('occurred_at', oneHourAgo)
            .order('occurred_at', { ascending: false })
            .limit(20);
            
        // Last event timestamp
        const { data: lastEvent, error: lastError } = await supabase
            .from('event_bus_events')
            .select('occurred_at')
            .order('occurred_at', { ascending: false })
            .limit(1)
            .single();
            
        if (!recentError && !lastError) {
            const lastEventTime = lastEvent ? new Date(lastEvent.occurred_at) : null;
            const now = new Date();
            const minutesSinceLastEvent = lastEventTime ? 
                Math.floor((now - lastEventTime) / (1000 * 60)) : null;
            
            health.components.eventFlow = {
                status: minutesSinceLastEvent < 10 ? 'OK' : 
                        minutesSinceLastEvent < 30 ? 'WARNING' : 'CRITICAL',
                recentEventsCount: recentEvents?.length || 0,
                lastEventMinutesAgo: minutesSinceLastEvent,
                lastEventTime: lastEvent?.occurred_at
            };
            
            console.log(`  Recent events (1h): ${recentEvents?.length || 0}`);
            console.log(`  Last event: ${minutesSinceLastEvent !== null ? minutesSinceLastEvent + ' minutes ago' : 'never'}`);
            
            // Show sample of recent events
            if (recentEvents && recentEvents.length > 0) {
                console.log('  Recent event types:');
                const topicCounts = recentEvents.reduce((acc, evt) => {
                    acc[evt.topic] = (acc[evt.topic] || 0) + 1;
                    return acc;
                }, {});
                Object.entries(topicCounts).slice(0, 5).forEach(([topic, count]) => {
                    console.log(`    - ${topic}: ${count}`);
                });
            }
            
            if (minutesSinceLastEvent >= 30) {
                health.issues.push(`CRITICAL: No events for ${minutesSinceLastEvent} minutes`);
                health.status = 'CRITICAL';
            } else if (minutesSinceLastEvent >= 10) {
                health.warnings.push(`WARNING: No events for ${minutesSinceLastEvent} minutes`);
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
    
    // ========== 3. REVENUE FLOW ==========
    console.log('\n💰 REVENUE FLOW');
    console.log('-'.repeat(70));
    try {
        // Recent successful payments
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: payments, error: payError } = await supabase
            .from('webhook_events')
            .select('created_at, payload->amount as amount')
            .eq('type', 'invoice.payment_succeeded')
            .gte('created_at', oneDayAgo);
            
        if (!payError) {
            const paymentCount = payments?.length || 0;
            const totalRevenue = payments?.reduce((sum, p) => {
                return sum + (parseInt(p.amount || 0) / 100);
            }, 0) || 0;
            
            health.components.revenue = {
                status: paymentCount > 0 ? 'OK' : 'WARNING',
                payments24h: paymentCount,
                revenue24h: totalRevenue
            };
            
            console.log(`  Payments (24h): ${paymentCount}`);
            console.log(`  Revenue (24h): $${totalRevenue.toFixed(2)}`);
            
            if (paymentCount === 0) {
                health.warnings.push('WARNING: No revenue in last 24 hours');
                if (health.status === 'OK') health.status = 'WARNING';
            }
        } else {
            console.log('  ❌ Cannot read revenue data');
            health.components.revenue = { status: 'UNKNOWN' };
        }
    } catch (err) {
        console.log('  ❌ Revenue check error:', err.message);
        health.components.revenue = { status: 'ERROR', error: err.message };
    }
    
    // ========== 4. ENTITLEMENTS ==========
    console.log('\n🔑 ENTITLEMENTS');
    console.log('-'.repeat(70));
    try {
        const { data: entitlements, error: entError } = await supabase
            .from('entitlements')
            .select('status')
            .limit(100);
            
        if (!entError) {
            const activeCount = entitlements?.filter(e => e.status === 'active').length || 0;
            const totalCount = entitlements?.length || 0;
            
            health.components.entitlements = {
                status: totalCount > 0 ? 'OK' : 'WARNING',
                active: activeCount,
                total: totalCount
            };
            
            console.log(`  Active entitlements: ${activeCount}`);
            console.log(`  Total entitlements: ${totalCount}`);
        } else {
            console.log('  ❌ Cannot read entitlements');
            health.components.entitlements = { status: 'UNKNOWN' };
        }
    } catch (err) {
        console.log('  ❌ Entitlements check error:', err.message);
        health.components.entitlements = { status: 'ERROR', error: err.message };
    }
    
    // ========== 5. AUTOMATION STATUS ==========
    console.log('\n🤖 AUTOMATION STATUS');
    console.log('-'.repeat(70));
    try {
        // Check for recent heartbeat events
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data: heartbeats, error: hbError } = await supabase
            .from('event_bus_events')
            .select('occurred_at')
            .eq('topic', 'system:heartbeat')
            .gte('occurred_at', fiveMinutesAgo)
            .order('occurred_at', { ascending: false });
            
        if (!hbError) {
            const hasHeartbeats = heartbeats && heartbeats.length > 0;
            
            health.components.automation = {
                status: hasHeartbeats ? 'OK' : 'WARNING',
                heartbeats5min: heartbeats?.length || 0,
                lastHeartbeat: heartbeats?.[0]?.occurred_at
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
            revenue_status: health.components.revenue?.status,
            automation_status: health.components.automation?.status,
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

// Run the check
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
