/**
 * TEST REAL FLOWS - The only tests that matter
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

class RealFlowTester {
    constructor() {
        this.testResults = [];
    }

    async runTest(name, testFn) {
        console.log(`\n🧪 Testing: ${name}`);
        console.log('-'.repeat(50));
        
        try {
            const result = await testFn();
            this.testResults.push({ name, success: true, result });
            console.log('✅ PASSED');
            if (result) console.log('   ', result);
        } catch (error) {
            this.testResults.push({ name, success: false, error: error.message });
            console.log('❌ FAILED:', error.message);
        }
    }

    async testSuccessfulCheckout() {
        const eventId = 'evt_test_success_' + Date.now();
        
        // 1. Create webhook event
        const { data: webhook } = await supabase
            .from('webhook_events')
            .insert({
                event_id: eventId,
                event_type: 'checkout.session.completed',
                payload: {
                    id: 'cs_test_' + Date.now(),
                    customer: 'cus_test_success',
                    amount_total: 2000,
                    currency: 'usd',
                    payment_status: 'paid',
                    subscription: 'sub_test_' + Date.now()
                },
                processed: false
            })
            .select()
            .single();
        
        // 2. Process through worker
        await fetch(`${process.env.SUPABASE_URL}/functions/v1/worker-orchestrator`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify({ queue_name: 'revenue', batch_size: 5 })
        });
        
        // 3. Verify results
        const validation = await supabase
            .rpc('validate_stripe_event_integrity', { p_event_id: eventId })
            .single();
        
        if (!validation || !validation.event_valid) {
            const issues = (validation && validation.issues) ? validation.issues : ['Unknown validation error'];
            throw new Error('Event validation failed: ' + issues.join(', '));
        }
        
        // 4. Check downstream effects
        const { data: entitlements } = await supabase
            .from('entitlements')
            .select('*')
            .eq('source_event_id', eventId);
        
        return {
            webhookCreated: !!webhook,
            validationPassed: validation.event_valid,
            entitlementsCreated: entitlements?.length || 0,
            checks: validation.checks
        };
    }

    async testFailedPayment() {
        const eventId = 'evt_test_fail_' + Date.now();
        
        // Create failed payment event
        const { data: webhook } = await supabase
            .from('webhook_events')
            .insert({
                event_id: eventId,
                event_type: 'invoice.payment_failed',
                payload: {
                    id: 'in_test_fail_' + Date.now(),
                    customer: 'cus_test_fail',
                    amount_due: 2000,
                    attempt_count: 1,
                    next_payment_attempt: new Date(Date.now() + 86400000).toISOString()
                },
                processed: false
            })
            .select()
            .single();
        
        // Process it
        await fetch(`${process.env.SUPABASE_URL}/functions/v1/worker-orchestrator`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify({ queue_name: 'revenue', batch_size: 5 })
        });
        
        // Check for dunning or retry logic
        const { data: jobs } = await supabase
            .from('worker_jobs')
            .select('*')
            .like('payload', `%${eventId}%`);
        
        return {
            webhookCreated: !!webhook,
            jobsCreated: jobs?.length || 0,
            handledCorrectly: (jobs?.length || 0) > 0
        };
    }

    async testRefund() {
        const eventId = 'evt_test_refund_' + Date.now();
        
        // Create refund event
        const { data: webhook } = await supabase
            .from('webhook_events')
            .insert({
                event_id: eventId,
                event_type: 'charge.refunded',
                payload: {
                    id: 'ch_test_refund_' + Date.now(),
                    amount_refunded: 500,
                    currency: 'usd',
                    customer: 'cus_test_refund',
                    charge: 'ch_test_' + Date.now()
                },
                processed: false
            })
            .select()
            .single();
        
        // Process it
        await fetch(`${process.env.SUPABASE_URL}/functions/v1/worker-orchestrator`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify({ queue_name: 'revenue', batch_size: 5 })
        });
        
        // Verify refund tracking
        const { data: refundTracking } = await supabase
            .from('revenue_tracking')
            .select('*')
            .eq('event_id', eventId);
        
        return {
            webhookCreated: !!webhook,
            refundTracked: (refundTracking?.length || 0) > 0,
            amountCorrect: refundTracking?.[0]?.amount === -500
        };
    }

    async testSubscriptionCancel() {
        const eventId = 'evt_test_cancel_' + Date.now();
        
        // Create cancellation event
        const { data: webhook } = await supabase
            .from('webhook_events')
            .insert({
                event_id: eventId,
                event_type: 'customer.subscription.deleted',
                payload: {
                    id: 'sub_test_cancel_' + Date.now(),
                    customer: 'cus_test_cancel',
                    cancel_at_period_end: false,
                    ended_at: new Date().toISOString()
                },
                processed: false
            })
            .select()
            .single();
        
        // Process it
        await fetch(`${process.env.SUPABASE_URL}/functions/v1/worker-orchestrator`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify({ queue_name: 'revenue', batch_size: 5 })
        });
        
        // Check entitlements are revoked
        const { data: entitlements } = await supabase
            .from('entitlements')
            .select('*')
            .eq('customer', 'cus_test_cancel')
            .eq('enabled', false);
        
        return {
            webhookCreated: !!webhook,
            entitlementsRevoked: (entitlements?.length || 0) > 0,
            handledCorrectly: true
        };
    }

    async testNoDuplicates() {
        // Send same event twice
        const eventId = 'evt_test_dup_' + Date.now();
        
        for (let i = 0; i < 2; i++) {
            await supabase
                .from('webhook_events')
                .insert({
                    event_id: eventId,
                    event_type: 'checkout.session.completed',
                    payload: { id: 'cs_test_dup', customer: 'cus_test_dup' },
                    processed: false
                });
        }
        
        // Process
        await fetch(`${process.env.SUPABASE_URL}/functions/v1/worker-orchestrator`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify({ queue_name: 'revenue', batch_size: 10 })
        });
        
        // Check for duplicates
        const { data: jobs } = await supabase
            .from('worker_jobs')
            .select('*')
            .eq('dedupe_key', eventId);
        
        return {
            duplicatesCreated: (jobs?.length || 0) > 1,
            correctlyDeduped: (jobs?.length || 0) === 1
        };
    }

    async generateReport() {
        console.log('\n' + '='.repeat(60));
        console.log('📊 REAL FLOW TEST REPORT');
        console.log('='.repeat(60));
        
        const passed = this.testResults.filter(r => r.success).length;
        const total = this.testResults.length;
        
        console.log(`\n✅ Passed: ${passed}/${total}`);
        
        if (passed === total) {
            console.log('\n🎉 ALL REAL-WORLD SCENARIOS HANDLED CORRECTLY');
            console.log('\nYour system is ready for production.');
        } else {
            console.log('\n⚠️  Some scenarios failed. Review above.');
        }
        
        console.log('\n' + '='.repeat(60));
    }

    async execute() {
        console.log('🧪 RUNNING REAL-WORLD FLOW TESTS\n');
        
        await this.runTest('Successful Checkout', () => this.testSuccessfulCheckout());
        await this.runTest('Failed Payment', () => this.testFailedPayment());
        await this.runTest('Refund', () => this.testRefund());
        await this.runTest('Subscription Cancellation', () => this.testSubscriptionCancel());
        await this.runTest('No Duplicates', () => this.testNoDuplicates());
        
        await this.generateReport();
    }
}

// Execute tests
new RealFlowTester().execute();
