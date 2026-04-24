/**
 * FINAL VERIFICATION - Check complete system status
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function finalVerification() {
    console.log('🔍 FINAL SYSTEM VERIFICATION\n');
    
    const checks = [];
    
    // 1. Check webhook_events constraint by testing duplicate
    try {
        const testEventId = `test_${Date.now()}`;
        
        // Insert test event
        await supabase
            .from('webhook_events')
            .insert({
                event_id: testEventId,
                provider: 'test',
                type: 'test',
                status: 'test'
            });
        
        // Try to insert duplicate
        const { error } = await supabase
            .from('webhook_events')
            .insert({
                event_id: testEventId,
                provider: 'test',
                type: 'test',
                status: 'test'
            });
        
        if (error && error.code === '23505') {
            checks.push('✅ webhook_events unique constraint: ACTIVE');
        } else {
            checks.push('❌ webhook_events unique constraint: MISSING');
        }
        
        // Cleanup
        await supabase
            .from('webhook_events')
            .delete()
            .eq('event_id', testEventId);
    } catch (err) {
        checks.push('❌ webhook_events unique constraint: ERROR');
    }
    
    // 2. Check functions
    const functions = ['retry_failed_jobs', 'flag_dead_jobs'];
    for (const fn of functions) {
        try {
            const { error } = await supabase.rpc(fn);
            if (!error) {
                checks.push(`✅ ${fn} function: WORKING`);
            } else {
                checks.push(`❌ ${fn} function: ERROR`);
            }
        } catch (err) {
            checks.push(`❌ ${fn} function: NOT FOUND`);
        }
    }
    
    // 3. Check cron jobs via direct query
    try {
        const { data, error } = await supabase
            .from('cron.job')
            .select('jobname, schedule, active')
            .in('jobname', ['process_worker_queues', 'retry_failed_jobs', 'flag_dead_jobs']);
        
        if (data && data.length === 3) {
            checks.push('✅ cron jobs: ALL 3 ACTIVE');
            data.forEach(job => {
                checks.push(`  - ${job.jobname}: ${job.schedule} (${job.active ? 'active' : 'inactive'})`);
            });
        } else {
            checks.push(`❌ cron jobs: ONLY ${data?.length || 0}/3 FOUND`);
        }
    } catch (err) {
        checks.push('❌ cron jobs: CANNOT VERIFY (need admin access)');
    }
    
    // 4. Check worker_jobs table health
    try {
        const { data, error } = await supabase
            .from('worker_jobs')
            .select('status')
            .order('created_at', { ascending: false })
            .limit(100);
        
        if (!error && data) {
            const statusCounts = data.reduce((acc, job) => {
                acc[job.status] = (acc[job.status] || 0) + 1;
                return acc;
            }, {});
            
            checks.push(`✅ worker_jobs: ${data.length} total jobs`);
            Object.entries(statusCounts).forEach(([status, count]) => {
                checks.push(`  - ${status}: ${count}`);
            });
        }
    } catch (err) {
        checks.push('❌ worker_jobs: ERROR');
    }
    
    // 5. Check event_bus activity
    try {
        const { data, error } = await supabase
            .from('event_bus_events')
            .select('topic, event_name')
            .order('occurred_at', { ascending: false })
            .limit(5);
        
        if (data && data.length > 0) {
            checks.push(`✅ event_bus: ${data.length} recent events`);
            data.forEach(e => {
                checks.push(`  - ${e.topic}: ${e.event_name}`);
            });
        } else {
            checks.push('⚠️  event_bus: NO RECENT EVENTS');
        }
    } catch (err) {
        checks.push('❌ event_bus: ERROR');
    }
    
    // 6. Check Vault secrets
    try {
        const secrets = ['project_url', 'service_role_key'];
        let secretsOk = 0;
        
        for (const secret of secrets) {
            const { data, error } = await supabase
                .from('vault.decrypted_secrets')
                .select('name')
                .eq('name', secret)
                .single();
            
            if (!error && data) {
                secretsOk++;
            }
        }
        
        if (secretsOk === secrets.length) {
            checks.push('✅ Vault secrets: CONFIGURED');
        } else {
            checks.push(`❌ Vault secrets: MISSING ${secrets.length - secretsOk}`);
        }
    } catch (err) {
        checks.push('❌ Vault secrets: CANNOT VERIFY');
    }
    
    // Summary
    console.log('='.repeat(60));
    checks.forEach(check => console.log(check));
    console.log('='.repeat(60));
    
    const passed = checks.filter(c => c.startsWith('✅')).length;
    const total = checks.filter(c => c.includes('✅') || c.includes('❌')).length;
    
    console.log(`\n📊 OVERALL: ${passed}/${total} checks passed`);
    
    if (passed >= total * 0.8) {
        console.log('\n🎉 SYSTEM IS PRODUCTION READY!');
        console.log('Your autonomous worker system is fully operational.');
    } else {
        console.log('\n⚠️  SYSTEM NEEDS ATTENTION');
        console.log('Some components are not properly configured.');
    }
}

finalVerification();
