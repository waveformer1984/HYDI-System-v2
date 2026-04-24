/**
 * Provisioning Worker
 * Turns payments into real-world access or actions
 * 
 * Input: entitlements + payments
 * Output: service state
 * Also triggers: fabrication workflows
 */

const QueueManager = require('./QueueManager');
const { createClient } = require('@supabase/supabase-js');
const ServiceProvisioner = require('../modules/service-provisioner');

class ProvisioningWorker {
    constructor(workerId = null) {
        this.workerId = workerId || `provisioning-worker-${Date.now()}`;
        this.queue = new QueueManager();
        this.supabase = null;
        this.serviceProvisioner = new ServiceProvisioner();
        this.running = false;
        this.pollInterval = 4000; // 4 seconds
        this.pollTimer = null;
        
        // Service tier configurations (matching Revenue Worker)
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
        await this.queue.registerWorker('provisioning', this.workerId);
        await this.queue.updateHeartbeat('idle');
        
        console.log(`[⚙️ Provisioning Worker] Initialized: ${this.workerId}`);
    }

    async start() {
        if (this.running) {
            console.log('[⚙️ Provisioning Worker] Already running');
            return;
        }
        
        await this.initialize();
        this.running = true;
        this.queue.startHeartbeat();
        
        console.log('[⚙️ Provisioning Worker] Starting to process provisioning tasks...');
        
        // Start polling
        this.poll();
    }

    async stop() {
        this.running = false;
        
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
        }
        
        await this.queue.shutdown();
        console.log('[⚙️ Provisioning Worker] Stopped');
    }

    poll() {
        if (!this.running) return;
        
        this.processNextTask()
            .catch(err => {
                console.error('[⚙️ Provisioning Worker] Error in poll:', err);
            })
            .finally(() => {
                // Schedule next poll
                this.pollTimer = setTimeout(() => this.poll(), this.pollInterval);
            });
    }

    async processNextTask() {
        const taskId = await this.queue.dequeue('provisioning');
        
        if (!taskId) {
            return; // No tasks available
        }
        
        try {
            const task = await this.queue.getTask(taskId);
            if (!task) {
                console.error(`[⚙️ Provisioning Worker] Task not found: ${taskId}`);
                return;
            }
            
            console.log(`[⚙️ Provisioning Worker] Processing task: ${task.payload.event_type}`);
            
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
                    
                case 'fabrication.request':
                    await this.handleFabricationRequest(task.payload);
                    break;
                    
                default:
                    console.log(`[⚙️ Provisioning Worker] Unhandled event type: ${task.payload.event_type}`);
            }
            
            // Mark task as completed
            await this.queue.completeTask(taskId, true);
            
        } catch (err) {
            console.error(`[⚙️ Provisioning Worker] Task failed: ${taskId}`, err);
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
        
        // Get service list for this tier
        const tierConfig = this.serviceTiers[tier];
        if (!tierConfig) {
            throw new Error(`Unknown tier: ${tier}`);
        }
        
        // Prepare customer data for provisioning
        const customerData = {
            customer_email: customerEmail,
            customer_id: customerId,
            tier: tier,
            services: tierConfig.services,
            limits: tierConfig.limits
        };
        
        // Provision services
        await this.serviceProvisioner.provisionServices(customerData);
        
        // Trigger any fabrication workflows if needed
        await this.triggerFabricationIfNeeded(customerData);
        
        console.log(`[⚙️ Provisioning] Provisioned ${tier} services for ${customerEmail}`);
    }

    async handlePaymentSucceeded(payload) {
        const invoice = payload.data;
        const customerId = invoice.customer;
        
        // Get customer email
        const { data: customer } = await this.supabase
            .from('customers')
            .select('email, tier')
            .eq('stripe_customer_id', customerId)
            .single();
        
        if (!customer) {
            console.warn(`[⚙️ Provisioning] Customer not found for Stripe ID: ${customerId}`);
            return;
        }
        
        // For subscription payments, ensure services are still active
        if (invoice.subscription) {
            // Services should remain active, just validate
            const { data: services } = await this.supabase
                .from('customer_services')
                .select('*')
                .eq('customer_email', customer.email)
                .eq('status', 'active');
                
            console.log(`[⚙️ Provisioning] Validated ${services?.length || 0} active services for ${customer.email}`);
        }
        
        console.log(`[⚙️ Provisioning] Processed payment: ${invoice.id} for ${customer.email}`);
    }

    async handleSubscriptionCreated(payload) {
        const subscription = payload.data;
        const customerId = subscription.customer;
        const tier = this.determineTierFromPrice(subscription.items.data[0].price.id);
        
        // Get customer email
        const { data: customer } = await this.supabase
            .from('customers')
            .select('email')
            .eq('stripe_customer_id', customerId)
            .single();
        
        if (!customer) {
            console.warn(`[⚙️ Provisioning] Customer not found for Stripe ID: ${customerId}`);
            return;
        }
        
        // Get service list for this tier
        const tierConfig = this.serviceTiers[tier];
        if (!tierConfig) {
            throw new Error(`Unknown tier: ${tier}`);
        }
        
        // Prepare customer data for provisioning
        const customerData = {
            customer_email: customer.email,
            customer_id: customerId,
            tier: tier,
            services: tierConfig.services,
            limits: tierConfig.limits
        };
        
        // Provision services
        await this.serviceProvisioner.provisionServices(customerData);
        
        console.log(`[⚙️ Provisioning] Subscription created: ${subscription.id} for ${customer.email}`);
    }

    async handleSubscriptionUpdated(payload) {
        const subscription = payload.data;
        const customerId = subscription.customer;
        const tier = this.determineTierFromPrice(subscription.items.data[0].price.id);
        
        // Get customer email
        const { data: customer } = await this.supabase
            .from('customers')
            .select('email, tier')
            .eq('stripe_customer_id', customerId)
            .single();
        
        if (!customer) {
            console.warn(`[⚙️ Provisioning] Customer not found for Stripe ID: ${customerId}`);
            return;
        }
        
        // Check if tier changed
        if (customer.tier !== tier) {
            console.log(`[⚙️ Provisioning] Tier changed for ${customer.email}: ${customer.tier} -> ${tier}`);
            
            // Deactivate old services
            await this.serviceProvisioner.deactivateServices(customerId);
            
            // Provision new services
            const tierConfig = this.serviceTiers[tier];
            if (tierConfig) {
                const customerData = {
                    customer_email: customer.email,
                    customer_id: customerId,
                    tier: tier,
                    services: tierConfig.services,
                    limits: tierConfig.limits
                };
                
                await this.serviceProvisioner.provisionServices(customerData);
            }
        }
        
        console.log(`[⚙️ Provisioning] Subscription updated: ${subscription.id} for ${customer.email}`);
    }

    async handleSubscriptionDeleted(payload) {
        const subscription = payload.data;
        const customerId = subscription.customer;
        
        // Get customer email
        const { data: customer } = await this.supabase
            .from('customers')
            .select('email')
            .eq('stripe_customer_id', customerId)
            .single();
        
        if (!customer) {
            console.warn(`[⚙️ Provisioning] Customer not found for Stripe ID: ${customerId}`);
            return;
        }
        
        // Deactivate all services
        await this.serviceProvisioner.deactivateServices(customerId);
        
        console.log(`[⚙️ Provisioning] Subscription deleted: ${subscription.id} for ${customer.email}`);
    }

    async handleFabricationRequest(payload) {
        // Handle fabrication job requests
        const { customer_email, job_type, specifications, priority = 3 } = payload.data;
        
        console.log(`[⚙️ Provisioning] Processing fabrication request: ${job_type} for ${customer_email}`);
        
        // Validate customer has access to fabrication services
        const { data: customer } = await this.supabase
            .from('customers')
            .select('tier')
            .eq('email', customer_email)
            .single();
        
        if (!customer) {
            throw new Error(`Customer not found: ${customer_email}`);
        }
        
        // Check if customer tier includes fabrication access
        // (This would be customized based on your business logic)
        const hasFabricationAccess = ['pro', 'enterprise'].includes(customer.tier);
        
        if (!hasFabricationAccess) {
            console.log(`[⚙️ Provisioning] Customer ${customer_email} does not have fabrication access`);
            return;
        }
        
        // Enqueue fabrication job
        await this.queue.enqueue('fabrication', {
            event_type: 'fabrication.job',
            data: {
                customer_email,
                job_type,
                specifications,
                requested_at: new Date().toISOString()
            },
            processed_by: 'provisioning_worker'
        }, priority);
        
        console.log(`[⚙️ Provisioning] Fabrication job queued: ${job_type}`);
    }

    async triggerFabricationIfNeeded(customerData) {
        // Check if any services in the tier require fabrication
        // For example, if they ordered physical products or custom hardware
        const fabricationServices = ['Custom Hardware Builder', '3D Print Service', 'PCB Fabrication'];
        const hasFabricationServices = customerData.services.some(service => 
            fabricationServices.includes(service)
        );
        
        if (hasFabricationServices) {
            console.log(`[⚙️ Provisioning] Triggering fabrication workflow for ${customerData.customer_email}`);
            
            // Enqueue a generic fabrication readiness check
            await this.queue.enqueue('fabrication', {
                event_type: 'fabrication.readiness_check',
                data: {
                    customer_email: customerData.customer_email,
                    customer_id: customerData.customer_id,
                    tier: customerData.tier,
                    triggered_by: 'provisioning_worker'
                }
            }, 4); // Medium priority
        }
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
        // For now, default to starter (should be enhanced with actual price lookup)
        return 'starter';
    }
}

// Run worker if called directly
if (require.main === module) {
    const worker = new ProvisioningWorker();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n[⚙️ Provisioning Worker] Shutting down...');
        await worker.stop();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        console.log('\n[⚙️ Provisioning Worker] Shutting down...');
        await worker.stop();
        process.exit(0);
    });
    
    // Start worker
    worker.start().catch(err => {
        console.error('[⚙️ Provisioning Worker] Failed to start:', err);
        process.exit(1);
    });
}

module.exports = ProvisioningWorker;