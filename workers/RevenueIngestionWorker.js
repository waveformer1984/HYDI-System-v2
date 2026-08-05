/**
 * Revenue Ingestion Worker
 * Takes Stripe events and turns them into usable data
 * 
 * Input: Stripe webhook queue
 * Output: customers, subscriptions, payments tables
 * Also triggers: entitlement updates, downstream provisioning
 */

const QueueManager = require('./QueueManager');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const logger = require('../lib/structured-logger').child({ component: 'RevenueIngestionWorker' });

class RevenueIngestionWorker {
    constructor(workerId = null) {
        this.workerId = workerId || `revenue-worker-${Date.now()}`;
        this.queue = new QueueManager();
        this.supabase = null;
        this.running = false;
        this.pollInterval = 5000; // 5 seconds
        this.pollTimer = null;
        
        // Service tier configurations
        this.serviceTiers = {
            starter: {
                name: 'Starter',
                price: 49,
                services: ['SEO Content Generator', 'Blog Post Generator', 'Social Media Manager'],
                limits: { requests_per_month: 1000, storage_gb: 10 }
            },
            pro: {
                name: 'Pro', 
                price: 99,
                services: ['SEO Content Generator', 'Blog Post Generator', 'Social Media Manager', 'Data Pipeline Builder', 'Analytics Dashboard'],
                limits: { requests_per_month: 5000, storage_gb: 50 }
            },
            enterprise: {
                name: 'Enterprise',
                price: 499,
                services: ['All 30 Services Available'],
                limits: { requests_per_month: 'unlimited', storage_gb: 'unlimited' }
            }
        };
    }

    async initialize() {
        // Initialize Supabase
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
        
        if (!supabaseUrl || !supabaseKey) {
            throw new Error('Missing Supabase credentials');
        }
        
        this.supabase = createClient(supabaseUrl, supabaseKey);
        
        // Register worker
        await this.queue.registerWorker('revenue_ingestion', this.workerId);
        await this.queue.updateHeartbeat('idle');
        
        logger.info('Initialized', { workerId: this.workerId });
    }

    async start() {
        if (this.running) {
            logger.info('Already running');
            return;
        }

        await this.initialize();
        this.running = true;
        this.queue.startHeartbeat();

        logger.info('Starting to poll for tasks');
        
        // Start polling
        this.poll();
    }

    async stop() {
        this.running = false;
        
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
        }
        
        await this.queue.shutdown();
        logger.info('Stopped');
    }

    poll() {
        if (!this.running) return;

        this.processNextTask()
            .catch(err => {
                logger.error('Error in poll', { error: err });
            })
            .finally(() => {
                // Schedule next poll
                this.pollTimer = setTimeout(() => this.poll(), this.pollInterval);
            });
    }

    async processNextTask() {
        const taskId = await this.queue.dequeue('revenue_ingestion');
        
        if (!taskId) {
            return; // No tasks available
        }
        
        try {
            const task = await this.queue.getTask(taskId);
            if (!task) {
                logger.error('Task not found', { taskId });
                return;
            }

            logger.info('Processing task', { eventType: task.payload.event_type });
            
            // Process based on event type
            switch (task.payload.event_type) {
                case 'checkout.session.completed':
                    await this.handleCheckoutCompleted(task.payload);
                    break;
                    
                case 'invoice.payment_succeeded':
                    await this.handlePaymentSucceeded(task.payload);
                    break;
                    
                case 'customer.subscription.created':
                    await this.handleSubscriptionCreated(task.payload);
                    break;
                    
                case 'customer.subscription.updated':
                    await this.handleSubscriptionUpdated(task.payload);
                    break;
                    
                case 'customer.subscription.deleted':
                    await this.handleSubscriptionDeleted(task.payload);
                    break;
                    
                default:
                    throw new Error(`Unhandled event type: ${task.payload.event_type}`);
            }

            // Mark task as completed
            await this.queue.completeTask(taskId, true);

            // Trigger downstream provisioning
            await this.triggerProvisioning(task.payload);

        } catch (err) {
            logger.error('Task failed', { taskId, error: err });
            await this.queue.completeTask(taskId, false, err.message);
        }
    }

    async handleCheckoutCompleted(payload) {
        const session = payload.data;
        const customerEmail = session.customer_details?.email;
        const customerId = session.customer;
        
        if (!customerEmail) {
            throw new Error('No customer email in session');
        }
        
        // Determine service tier
        const tier = this.determineServiceTier(session);
        
        // Create or update customer record
        await this.createOrUpdateCustomer(customerEmail, customerId, tier, session);
        
        // Track revenue
        await this.trackRevenue({
            stripe_event_id: payload.event_id,
            customer_email: customerEmail,
            amount: session.amount_total,
            currency: session.currency,
            type: 'payment',
            metadata: {
                session_id: session.id,
                tier: tier
            }
        });
        
        logger.info('Processed checkout', { customerEmail, tier });
    }

    async handlePaymentSucceeded(payload) {
        const invoice = payload.data;
        const customerId = invoice.customer;
        
        // Get customer email
        const { data: customer } = await this.supabase
            .from('customers')
            .select('email')
            .eq('stripe_customer_id', customerId)
            .single();
        
        if (customer) {
            // Track revenue
            await this.trackRevenue({
                stripe_event_id: payload.event_id,
                customer_email: customer.email,
                amount: invoice.amount_paid,
                currency: invoice.currency,
                type: invoice.subscription ? 'subscription' : 'invoice',
                metadata: {
                    invoice_id: invoice.id,
                    subscription_id: invoice.subscription
                }
            });
        }
        
        logger.info('Processed payment', { invoiceId: invoice.id });
    }

    async handleSubscriptionCreated(payload) {
        const subscription = payload.data;
        const customerId = subscription.customer;
        const tier = this.determineTierFromPrice(subscription.items.data[0].price.id);
        
        // Update customer's subscription status
        await this.updateCustomerSubscription(customerId, {
            tier: tier,
            subscription_id: subscription.id,
            status: 'active',
            starts_at: subscription.current_period_start
        });
        
        logger.info('Subscription created', { subscriptionId: subscription.id });
    }

    async handleSubscriptionUpdated(payload) {
        const subscription = payload.data;
        const customerId = subscription.customer;
        const tier = this.determineTierFromPrice(subscription.items.data[0].price.id);
        
        // Update customer's subscription
        await this.updateCustomerSubscription(customerId, {
            tier: tier,
            subscription_id: subscription.id,
            status: subscription.status,
            current_period_end: subscription.current_period_end
        });
        
        logger.info('Subscription updated', { subscriptionId: subscription.id });
    }

    async handleSubscriptionDeleted(payload) {
        const subscription = payload.data;
        const customerId = subscription.customer;
        
        // Deactivate customer's services
        await this.deactivateCustomerServices(customerId);
        
        logger.info('Subscription deleted', { subscriptionId: subscription.id });
    }

    async createOrUpdateCustomer(email, stripeCustomerId, tier, session) {
        // Try to find existing customer
        const { data: existing } = await this.supabase
            .from('customers')
            .select('id')
            .eq('email', email)
            .maybeSingle();
        
        if (existing) {
            // Update with Stripe info
            await this.supabase
                .from('customers')
                .update({
                    stripe_customer_id: stripeCustomerId,
                    tier: tier,
                    updated_at: new Date().toISOString()
                })
                .eq('id', existing.id);
        } else {
            // Create new customer
            await this.supabase
                .from('customers')
                .insert({
                    email: email,
                    stripe_customer_id: stripeCustomerId,
                    tier: tier,
                    status: 'active'
                });
        }
    }

    async trackRevenue(revenueData) {
        await this.supabase
            .from('revenue_tracking')
            .insert({
                ...revenueData,
                created_at: new Date().toISOString()
            });
    }

    async updateCustomerSubscription(customerId, subscriptionData) {
        // Find customer by Stripe ID
        const { data: customer } = await this.supabase
            .from('customers')
            .select('id')
            .eq('stripe_customer_id', customerId)
            .single();
        
        if (customer) {
            await this.supabase
                .from('customers')
                .update({
                    ...subscriptionData,
                    updated_at: new Date().toISOString()
                })
                .eq('id', customer.id);
        }
    }

    async deactivateCustomerServices(customerId) {
        // Find customer
        const { data: customer } = await this.supabase
            .from('customers')
            .select('id, email')
            .eq('stripe_customer_id', customerId)
            .single();
        
        if (customer) {
            // Deactivate all services
            await this.supabase
                .from('customer_services')
                .update({
                    status: 'deactivated',
                    updated_at: new Date().toISOString()
                })
                .eq('customer_email', customer.email);
            
            // Update customer status
            await this.supabase
                .from('customers')
                .update({
                    status: 'cancelled',
                    updated_at: new Date().toISOString()
                })
                .eq('id', customer.id);
        }
    }

    async triggerProvisioning(payload) {
        // Queue provisioning task
        await this.queue.enqueue('provisioning', {
            event_type: payload.event_type,
            data: payload.data,
            processed_by: 'revenue_worker'
        }, 5); // High priority
    }

    determineServiceTier(session) {
        // Check metadata first
        if (session.metadata?.tier) {
            return session.metadata.tier.toLowerCase();
        }
        
        // Determine from price amount
        const amount = session.amount_total;
        if (amount >= 49900) return 'enterprise';
        if (amount >= 9900) return 'pro';
        return 'starter';
    }

    determineTierFromPrice(priceId) {
        // This would match price IDs to tiers
        // For now, default to starter
        return 'starter';
    }
}

// Run worker if called directly
if (require.main === module) {
    const worker = new RevenueIngestionWorker();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        logger.info('Shutting down');
        await worker.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        logger.info('Shutting down');
        await worker.stop();
        process.exit(0);
    });

    // Start worker
    worker.start().catch(err => {
        logger.error('Failed to start', { error: err });
        process.exit(1);
    });
}

module.exports = RevenueIngestionWorker;
