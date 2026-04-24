/**
 * PRODUCTION RISK DIAGNOSTIC
 * Verifies critical failure points in production
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

class ProductionRiskChecker {
    constructor() {
        this.risks = [];
        this.checks = {
            auth: {},
            vault: {},
            orchestration: {},
            flow: {}
        };
    }

    async log(category, message, status = 'INFO', data = null) {
        const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
        console.log(`\n${icon} [${category}] ${message}`);
        if (data) console.log(JSON.stringify(data, null, 2));
        
        if (status === 'FAIL') {
            this.risks.push({ category, message, data });
        }
    }

    async checkEdgeFunctionAuth() {
        this.log('AUTH', 'Checking Edge Function JWT settings');
        
        try {
            // Test stripe-worker auth
            const stripeResponse = await fetch(`${process.env.SUPABASE_URL}/functions/v1/stripe-worker`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
                },
                body: JSON.stringify({})
            });
            
            if (stripeResponse.status === 401 || stripeResponse.status === 403) {
                this.log('AUTH', 'stripe-worker: Auth rejected', 'FAIL', { status: stripeResponse.status });
                this.checks.auth.stripeWorker = false;
            } else {
                this.log('AUTH', 'stripe-worker: Auth accessible', 'PASS');
                this.checks.auth.stripeWorker = true;
            }
            
            // Test worker-orchestrator auth
            const orchestratorResponse = await fetch(`${process.env.SUPABASE_URL}/functions/v1/worker-orchestrator`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
                },
                body: JSON.stringify({
                    queue_name: 'test',
                    batch_size: 1
                })
            });
            
            if (orchestratorResponse.status === 401 || orchestratorResponse.status === 403) {
                this.log('AUTH', 'worker-orchestrator: Auth rejected', 'FAIL', { status: orchestratorResponse.status });
                this.checks.auth.orchestrator = false;
            } else {
                this.log('AUTH', 'worker-orchestrator: Auth accessible', 'PASS');
                this.checks.auth.orchestrator = true;
            }
            
        } catch (error) {
            this.log('AUTH', 'Failed to test Edge Functions', 'FAIL', { error: error.message });
            this.checks.auth.overall = false;
        }
    }

    async checkVaultSecrets() {
        this.log('VAULT', 'Checking Vault secrets presence');
        
        try {
            // Check invoke_worker_orchestrator function
            const { data, error } = await supabase
                .rpc('invoke_worker_orchestrator', {
                    p_queue_name: 'test',
                    p_batch_size: 1
                });
            
            if (error) {
                if (error.message.includes('missing_vault')) {
                    this.log('VAULT', 'Vault secrets missing', 'FAIL', { error: error.message });
                    this.checks.vault.secrets = false;
                } else {
                    this.log('VAULT', 'Vault check failed', 'FAIL', { error: error.message });
                    this.checks.vault.secrets = false;
                }
            } else if (data === null) {
                this.log('VAULT', 'Vault secrets not configured', 'FAIL');
                this.checks.vault.secrets = false;
            } else {
                this.log('VAULT', 'Vault secrets accessible', 'PASS', { requestId: data });
                this.checks.vault.secrets = true;
            }
            
            // Check what secrets should exist
            const requiredSecrets = ['project_url', 'publishable_key', 'anon_key'];
            
            for (const secret of requiredSecrets) {
                this.log('VAULT', `Required: ${secret}`, 'INFO');
            }
            
        } catch (error) {
            this.log('VAULT', 'Vault check error', 'FAIL', { error: error.message });
            this.checks.vault.overall = false;
        }
    }

    async checkOrchestrationFlow() {
        this.log('ORCHESTRATION', 'Testing end-to-end job flow');
        
        try {
            // 1. Create a test job
            const { data: job, error: enqueueError } = await supabase
                .rpc('enqueue_job', {
                    p_queue_name: 'revenue',
                    p_job_type: 'production_test',
                    p_payload: {
                        test_run: true,
                        timestamp: new Date().toISOString(),
                        risk_check: true
                    },
                    p_dedupe_key: `risk-check-${Date.now()}`,
                    p_priority: 100,
                    p_delay_seconds: 0
                });
            
            if (enqueueError) {
                this.log('ORCHESTRATION', 'Failed to enqueue test job', 'FAIL', enqueueError);
                return;
            }
            
            this.log('ORCHESTRATION', `Test job created: ${job}`, 'PASS');
            this.checks.orchestration.enqueue = true;
            
            // 2. Check initial state
            const { data: initialJob } = await supabase
                .from('worker_jobs')
                .select('*')
                .eq('id', job)
                .single();
            
            if (!initialJob) {
                this.log('ORCHESTRATION', 'Cannot find created job', 'FAIL');
                return;
            }
            
            this.log('ORCHESTRATION', `Initial state: ${initialJob.status}`, 'INFO');
            
            // 3. Invoke orchestrator
            const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/worker-orchestrator`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
                },
                body: JSON.stringify({
                    queue_name: 'revenue',
                    worker_name: 'risk_check_worker',
                    batch_size: 1
                })
            });
            
            const result = await response.json();
            
            if (!result.ok) {
                this.log('ORCHESTRATION', 'Orchestrator processing failed', 'FAIL', result);
                this.checks.orchestration.processing = false;
            } else {
                this.log('ORCHESTRATION', `Processed ${result.claimed} jobs`, 'PASS');
                this.checks.orchestration.processing = true;
            }
            
            // 4. Verify final state
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for processing
            
            const { data: finalJob } = await supabase
                .from('worker_jobs')
                .select('*')
                .eq('id', job)
                .single();
            
            if (finalJob) {
                this.log('ORCHESTRATION', `Final state: ${finalJob.status}`, 'INFO');
                
                if (finalJob.status === 'done') {
                    this.log('ORCHESTRATION', 'Job completed successfully', 'PASS');
                    this.checks.orchestration.completion = true;
                } else if (finalJob.status === 'failed') {
                    this.log('ORCHESTRATION', 'Job failed', 'FAIL', { error: finalJob.error_message });
                    this.checks.orchestration.completion = false;
                } else {
                    this.log('ORCHESTRATION', 'Job stuck in processing', 'FAIL');
                    this.checks.orchestration.completion = false;
                }
            }
            
        } catch (error) {
            this.log('ORCHESTRATION', 'Flow test error', 'FAIL', { error: error.message });
            this.checks.orchestration.overall = false;
        }
    }

    async checkRevenueIngestion() {
        this.log('FLOW', 'Checking revenue ingestion path');
        
        // Check webhook_events table
        const { count: webhookCount } = await supabase
            .from('webhook_events')
            .select('*', { count: 'exact', head: true });
        
        this.log('FLOW', `Webhook events in DB: ${webhookCount}`, 'INFO');
        
        // Check revenue queue depth
        const { count: revenueQueue } = await supabase
            .from('worker_jobs')
            .select('*', { count: 'exact', head: true })
            .eq('queue_name', 'revenue')
            .eq('status', 'queued');
        
        this.log('FLOW', `Revenue jobs queued: ${revenueQueue}`, 'INFO');
        
        if (revenueQueue > 10) {
            this.log('FLOW', 'Revenue queue backing up', 'FAIL', { queueDepth: revenueQueue });
            this.checks.flow.queueHealth = false;
        } else {
            this.log('FLOW', 'Revenue queue healthy', 'PASS');
            this.checks.flow.queueHealth = true;
        }
        
        // Check for stuck jobs
        const { count: stuckJobs } = await supabase
            .from('worker_jobs')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'processing')
            .lt('updated_at', new Date(Date.now() - 5 * 60 * 1000).toISOString()); // Older than 5 mins
        
        if (stuckJobs > 0) {
            this.log('FLOW', 'Stuck jobs detected', 'FAIL', { count: stuckJobs });
            this.checks.flow.stuckJobs = false;
        } else {
            this.log('FLOW', 'No stuck jobs', 'PASS');
            this.checks.flow.stuckJobs = true;
        }
    }

    async generateReport() {
        console.log('\n' + '='.repeat(70));
        console.log('🚨 PRODUCTION RISK ASSESSMENT');
        console.log('='.repeat(70));
        
        console.log('\n📊 CRITICAL RISKS FOUND:');
        if (this.risks.length === 0) {
            console.log('✅ No critical risks detected');
        } else {
            this.risks.forEach((risk, i) => {
                console.log(`\n${i + 1}. [${risk.category}] ${risk.message}`);
                if (risk.data) console.log(`   Details: ${JSON.stringify(risk.data)}`);
            });
        }
        
        console.log('\n🔍 SYSTEM CHECKS:');
        console.log('\nAuthentication:');
        console.log(`  stripe-worker: ${this.checks.auth.stripeWorker ? '✅' : '❌'}`);
        console.log(`  worker-orchestrator: ${this.checks.auth.orchestrator ? '✅' : '❌'}`);
        
        console.log('\nVault Secrets:');
        console.log(`  Configured: ${this.checks.vault.secrets ? '✅' : '❌'}`);
        
        console.log('\nOrchestration:');
        console.log(`  Enqueue: ${this.checks.orchestration.enqueue ? '✅' : '❌'}`);
        console.log(`  Processing: ${this.checks.orchestration.processing ? '✅' : '❌'}`);
        console.log(`  Completion: ${this.checks.orchestration.completion ? '✅' : '❌'}`);
        
        console.log('\nRevenue Flow:');
        console.log(`  Queue Health: ${this.checks.flow.queueHealth ? '✅' : '❌'}`);
        console.log(`  No Stuck Jobs: ${this.checks.flow.stuckJobs ? '✅' : '❌'}`);
        
        console.log('\n💡 IMMEDIATE ACTIONS:');
        if (!this.checks.vault.secrets) {
            console.log('1. ⚠️  Configure Vault secrets for cron automation');
        }
        if (!this.checks.auth.stripeWorker || !this.checks.auth.orchestrator) {
            console.log('2. ⚠️  Verify Edge Function JWT settings');
        }
        if (!this.checks.orchestration.completion) {
            console.log('3. ⚠️  Investigate job processing failures');
        }
        
        console.log('\n' + '='.repeat(70));
    }

    async execute() {
        console.log('🔍 Starting Production Risk Assessment\n');
        
        await this.checkEdgeFunctionAuth();
        await this.checkVaultSecrets();
        await this.checkOrchestrationFlow();
        await this.checkRevenueIngestion();
        
        await this.generateReport();
        
        return {
            risks: this.risks,
            checks: this.checks,
            healthy: this.risks.length === 0
        };
    }
}

// Execute risk check
const checker = new ProductionRiskChecker();
checker.execute().catch(err => {
    console.error('❌ Risk assessment failed:', err);
});
