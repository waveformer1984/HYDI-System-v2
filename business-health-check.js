/**
 * BUSINESS HEALTH CHECK - Final verification
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function businessHealthCheck() {
    console.log('🏥 BUSINESS HEALTH CHECK\n');
    
    const checks = [];
    
    // 1. Revenue Intelligence
    try {
        const { data: revenueAnomalies, error } = await supabase
            .from('event_bus_events')
            .select('*')
            .eq('topic', 'alerts:revenue')
            .gte('occurred_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());
            
        if (!error && revenueAnomalies.length === 0) {
            checks.push('✅ Revenue Intelligence: No anomalies (1 hour)');
        } else if (revenueAnomalies.length > 0) {
            checks.push(`⚠️  Revenue Intelligence: ${revenueAnomalies.length} anomalies detected`);
        } else {
            checks.push('❌ Revenue Intelligence: Error checking');
        }
    } catch (err) {
        checks.push('❌ Revenue Intelligence: Failed');
    }
    
    // 2. Entitlement Monitoring
    try {
        const { data: missingEntitlements, error } = await supabase
            .from('event_bus_events')
            .select('*')
            .eq('topic', 'alerts:critical')
            .eq('event_name', 'missing_entitlement');
            
        if (!error && missingEntitlements.length === 0) {
            checks.push('✅ Entitlement Monitoring: All payments have entitlements');
        } else if (missingEntitlements.length > 0) {
            checks.push(`🚨 Entitlement Monitoring: ${missingEntitlements.length} missing entitlements!`);
        } else {
            checks.push('❌ Entitlement Monitoring: Error checking');
        }
    } catch (err) {
        checks.push('❌ Entitlement Monitoring: Failed');
    }
    
    // 3. Worker Activity
    try {
        const { data: workerMetrics, error } = await supabase
            .from('event_bus_events')
            .select('*')
            .eq('topic', 'workers:metrics')
            .gte('occurred_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());
            
        if (!error && workerMetrics.length > 0) {
            checks.push(`✅ Worker Activity: ${workerMetrics.length} metric reports (1 hour)`);
        } else if (workerMetrics.length === 0) {
            checks.push('⚠️  Worker Activity: No metrics in last hour (workers may be idle)');
        } else {
            checks.push('❌ Worker Activity: Error checking');
        }
    } catch (err) {
        checks.push('❌ Worker Activity: Failed');
    }
    
    // 4. Queue Health
    try {
        const { data: queueStats, error } = await supabase
            .from('worker_jobs')
            .select('status')
            .order('created_at', { ascending: false })
            .limit(100);
            
        if (!error && queueStats) {
            const statusCounts = queueStats.reduce((acc, job) => {
                acc[job.status] = (acc[job.status] || 0) + 1;
                return acc;
            }, {});
            
            const queued = statusCounts.queued || 0;
            const failed = statusCounts.failed || 0;
            
            if (queued < 20 && failed < 5) {
                checks.push(`✅ Queue Health: ${queued} queued, ${failed} failed (healthy)`);
            } else {
                checks.push(`⚠️  Queue Health: ${queued} queued, ${failed} failed (needs attention)`);
            }
        }
    } catch (err) {
        checks.push('❌ Queue Health: Failed');
    }
    
    // 5. Recent Revenue
    try {
        const { data: recentRevenue, error } = await supabase
            .from('webhook_events')
            .select('payload->>amount')
            .eq('type', 'invoice.payment_succeeded')
            .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
            
        if (!error) {
            const total = recentRevenue.reduce((sum, event) => {
                return sum + (parseInt(event.amount || 0) / 100);
            }, 0);
            
            checks.push(`✅ Revenue (24h): $${total.toFixed(2)} from ${recentRevenue.length} payments`);
        }
    } catch (err) {
        checks.push('❌ Revenue Check: Failed');
    }
    
    // 6. Self-Healing Activity
    try {
        const { data: healingEvents, error } = await supabase
            .from('event_bus_events')
            .select('*')
            .eq('topic', 'system:healing')
            .gte('occurred_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());
            
        if (!error && healingEvents.length === 0) {
            checks.push('✅ Self-Healing: No interventions needed (1 hour)');
        } else if (healingEvents.length > 0) {
            checks.push(`⚠️  Self-Healing: ${healingEvents.length} interventions (1 hour)`);
        } else {
            checks.push('❌ Self-Healing: Error checking');
        }
    } catch (err) {
        checks.push('❌ Self-Healing: Failed');
    }
    
    // 7. Executive Dashboard
    try {
        const { data: dashboard, error } = await supabase
            .from('system_executive_dashboard')
            .select('*');
            
        if (!error && dashboard) {
            checks.push('✅ Executive Dashboard: All metrics available');
            dashboard.forEach(metric => {
                const value = metric.value || '0';
                const unit = metric.unit || '';
                checks.push(`  - ${metric.metric}: ${value}${unit}`);
            });
        }
    } catch (err) {
        checks.push('❌ Executive Dashboard: Failed');
    }
    
    // Summary
    console.log('='.repeat(60));
    checks.forEach(check => console.log(check));
    console.log('='.repeat(60));
    
    const passed = checks.filter(c => c.includes('✅')).length;
    const warnings = checks.filter(c => c.includes('⚠️')).length;
    const failed = checks.filter(c => c.includes('❌')).length;
    
    console.log(`\n📊 SUMMARY:`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`⚠️  Warnings: ${warnings}`);
    console.log(`❌ Failed: ${failed}`);
    
    if (failed === 0 && warnings === 0) {
        console.log('\n🎉 PERFECT HEALTH!');
        console.log('Your business intelligence system is running flawlessly.');
    } else if (failed === 0) {
        console.log('\n🟡 GOOD HEALTH');
        console.log('System is operational with some items to monitor.');
    } else {
        console.log('\n🔴 NEEDS ATTENTION');
        console.log('Some components require immediate attention.');
    }
    
    console.log('\n' + '='.repeat(60));
}

businessHealthCheck();
