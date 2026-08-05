const { createClient } = require('@supabase/supabase-js');
const QueueManager = require('./QueueManager');
require('dotenv').config();
const logger = require('../lib/structured-logger').child({ component: 'OpportunityDetectionWorker' });
const { getOptimalLevel } = require('./inventory-taxonomy');

class OpportunityDetectionWorker {
    constructor(workerId) {
        this.workerId = workerId || `opportunity-detection-worker-${Date.now()}`;
        this.running = false;
        this.pollInterval = 5000;
        this.pollTimer = null;
        this.supabase = null;
        this.queue = new QueueManager();
        this.opportunityPatterns = {
            high_frequency_usage: { threshold: 10, window_minutes: 60 },
            repeated_feature_request: { threshold: 3, window_hours: 168 },
            abandoned_cart: { threshold: 100 },
            usage_spike: { threshold: 3 },
            complementary_usage: { enabled: true }
        };

        this.initialize = function() {
            const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');
            this.supabase = createClient(supabaseUrl, supabaseKey);
            this.queue.registerWorker('opportunity_detection', this.workerId);
            this.queue.updateHeartbeat('idle');
            logger.info('Initialized', { workerId: this.workerId });
        };

        this.start = async function() {
            if (this.running) return;
            await this.initialize();
            this.running = true;
            this.queue.startHeartbeat();
            this.poll();
        };

        this.stop = async function() {
            this.running = false;
            if (this.pollTimer) clearTimeout(this.pollTimer);
            await this.queue.shutdown();
        };

        this.poll = function() {
            if (!this.running) return;
            this.processNextTask()
                .catch(err => logger.error('Poll error', { error: err }))
                .finally(() => { this.pollTimer = setTimeout(() => this.poll(), this.pollInterval); });
        };

        this.processNextTask = async function() {
            const taskId = await this.queue.dequeue('opportunity_detection');
            if (!taskId) return;
            try {
                const task = await this.queue.getTask(taskId);
                if (!task) return;
                switch (task.payload.event_type) {
                    case 'usage.recorded': await this.analyzeHighFrequencyUsage(task.payload); break;
                    case 'feature.requested': await this.analyzeFeatureRequests(task.payload); break;
                    case 'cart.abandoned': await this.analyzeAbandonedCart(task.payload); break;
                    case 'service.completed': await this.analyzeServiceCompletion(task.payload); break;
                    case 'behavior.updated': await this.analyzeUserBehavior(task.payload); break;
                    default: throw new Error(`Unhandled event type: ${task.payload.event_type}`);
                }
                await this.queue.completeTask(taskId, true);
            } catch (err) {
                await this.queue.completeTask(taskId, false, err.message);
            }
        };

        this.analyzeHighFrequencyUsage = async function(payload) {
            const { customer_email, service_name } = payload.data;
            logger.info('Analyzing high frequency usage', { serviceName: service_name, customerEmail: customer_email });
            // Analyze high frequency usage
            const { data: recentUsage } = await this.supabase
                .from('service_usage_logs')
                .select('*')
                .eq('customer_email', customer_email)
                .eq('service_name', service_name)
                .gte('timestamp', new Date(Date.now() - this.opportunityPatterns.high_frequency_usage.window_minutes * 60 * 1000).toISOString());
            
            const usageCount = recentUsage.length;
            const threshold = this.opportunityPatterns.high_frequency_usage.threshold;
            
            if (usageCount >= threshold) {
                await this.emitOpportunity('high_frequency_usage', {
                    data: {
                        customer_email,
                        service_name,
                        usage_count: usageCount,
                        threshold: threshold,
                        window_minutes: this.opportunityPatterns.high_frequency_usage.window_minutes,
                        suggested_action: 'offer_volume_discount_or_tier_upgrade'
                    }
                });
                
                logger.info('High frequency usage detected', {
                    customerEmail: customer_email,
                    serviceName: service_name,
                    usageCount,
                    windowMinutes: this.opportunityPatterns.high_frequency_usage.window_minutes
                });
            }
        };

        this.analyzeFeatureRequests = async function(payload) {
            const { customer_email, feature_name, timestamp } = payload.data;
            
            logger.info('Analyzing feature request', { featureName: feature_name, customerEmail: customer_email });
            
            // Analyze repeated feature requests
            const { data: recentRequests } = await this.supabase
                .from('feature_requests')
                .select('*')
                .eq('feature_name', feature_name)
                .gte('requested_at', new Date(Date.now() - this.opportunityPatterns.repeated_feature_request.window_hours * 60 * 60 * 1000).toISOString());
            
            const requestCount = recentRequests.length;
            const threshold = this.opportunityPatterns.repeated_feature_request.threshold;
            
            if (requestCount >= threshold) {
                await this.emitOpportunity('repeated_feature_request', {
                    data: {
                        customer_email,
                        feature_name,
                        request_count: requestCount,
                        threshold: threshold,
                        window_hours: this.opportunityPatterns.repeated_feature_request.window_hours,
                        suggested_action: 'prioritize_feature_development'
                    }
                });
                
                logger.info('Repeated feature request detected', {
                    featureName: feature_name,
                    requestCount,
                    windowHours: this.opportunityPatterns.repeated_feature_request.window_hours
                });
            }
        };

        this.analyzeAbandonedCart = async function(payload) {
            const { customer_email, cart_value, items, timestamp } = payload.data;
            
            logger.info('Analyzing abandoned cart', { customerEmail: customer_email, cartValue: cart_value });
            
            // Analyze abandoned cart for recovery opportunity
            const cartValue = parseFloat(cart_value) || 0;
            const threshold = this.opportunityPatterns.abandoned_cart.threshold; // $100
            
            if (cartValue >= threshold) {
                await this.emitOpportunity('abandoned_cart', {
                    data: {
                        customer_email,
                        cart_value: cart_value,
                        items: items,
                        threshold: threshold,
                        suggested_action: 'send_recovery_discount_offer'
                    }
                });
                
                logger.info('High-value abandoned cart detected', { customerEmail: customer_email, cartValue });
            }
        };

        this.analyzeServiceCompletion = async function(payload) {
            const { customer_email, service_name, satisfaction_score, timestamp } = payload.data;
            
            logger.info('Analyzing service completion', { serviceName: service_name, customerEmail: customer_email });
            
            // Analyze cross-sell opportunities based on service completion
            const satisfaction = parseFloat(satisfaction_score) || 0;
            
            // If customer is highly satisfied, they might be open to complementary services
            if (satisfaction >= 4.0) { // Out of 5.0 scale
                // Get services this customer uses
                const { data: customerServices } = await this.supabase
                    .from('service_usage_logs')
                    .select('service_name')
                    .eq('customer_email', customer_email)
                    .gte('timestamp', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()) // Last 30 days
                    .group('service_name');
                
                // Define complementary services
                const complementaryServices = {
                    'SEO Content Generator': ['Blog Post Generator', 'Social Media Manager'],
                    'Blog Post Generator': ['SEO Content Generator', 'Social Media Manager'],
                    'Social Media Manager': ['SEO Content Generator', 'Blog Post Generator'],
                    'Data Pipeline Builder': ['Analytics Dashboard'],
                    'Analytics Dashboard': ['Data Pipeline Builder'],
                    '3d_print': ['pcb_fabrication', 'cnc_machining'],
                    'pcb_fabrication': ['3d_print', 'cnc_machining'],
                    'cnc_machining': ['3d_print', 'pcb_fabrication']
                };
                
                const usedServices = customerServices.map(s => s.service_name);
                let complementaryFound = false;
                
                for (const service of usedServices) {
                    if (complementaryServices[service]) {
                        for (const complementary of complementaryServices[service]) {
                            if (!usedServices.includes(complementary)) {
                                // Found a complementary service the customer doesn't use yet
                                await this.emitOpportunity('complementary_usage', {
                                    data: {
                                        customer_email,
                                        current_service: service,
                                        complementary_service: complementary,
                                        satisfaction_score: satisfaction,
                                        suggested_action: 'offer_complementary_service_discount'
                                    }
                                });
                                
                                logger.info('Cross-sell opportunity detected', {
                                    customerEmail: customer_email,
                                    currentService: service,
                                    satisfactionScore: satisfaction,
                                    complementaryService: complementary
                                });
                                complementaryFound = true;
                                break;
                            }
                        }
                    }
                    if (complementaryFound) break;
                }
            }
        };

        this.analyzeUserBehavior = async function(payload) {
            const { customer_email, behavior_type, behavior_data, timestamp } = payload.data;
            
            logger.info('Analyzing user behavior', { behaviorType: behavior_type, customerEmail: customer_email });
            
            // Analyze behavior patterns for usage spikes
            if (behavior_type === 'usage_metrics') {
                const { service_name, usage_count, baseline_usage } = behavior_data;
                
                const currentUsage = parseFloat(usage_count) || 0;
                const baseline = parseFloat(baseline_usage) || 0;
                
                if (baseline > 0) {
                    const usageRatio = currentUsage / baseline;
                    const threshold = this.opportunityPatterns.usage_spike.threshold; // 3x normal usage
                    
                    if (usageRatio >= threshold) {
                        await this.emitOpportunity('usage_spike', {
                            data: {
                                customer_email,
                                service_name,
                                current_usage: currentUsage,
                                baseline_usage: baseline,
                                usage_ratio: usageRatio,
                                threshold: threshold,
                                suggested_action: 'offer_capacity_upgrade_or_higher_tier'
                            }
                        });
                        
                        logger.info('Usage spike detected', {
                            customerEmail: customer_email,
                            serviceName: service_name,
                            usageRatio: Number(usageRatio.toFixed(1)),
                            currentUsage,
                            baseline
                        });
                    }
                }
            }
        };

        this.emitOpportunity = async function(opportunityType, payload) {
            const { customer_email, details } = payload.data || {};
            
            const opportunity = {
                type: opportunityType,
                customer_email: customer_email || 'unknown',
                detected_at: new Date().toISOString(),
                details: details || {},
                detected_by: this.workerId
            };
            
            // Store opportunity
            await this.supabase
                .from('opportunities_detected')
                .insert(opportunity);
            
            // emit-opportunity-event
            // Emit event to notify other systems
            const queue = new QueueManager();
            await queue.initialize();
            
            await queue.enqueue('event_bus', {
                event_type: 'opportunity.detected',
                data: opportunity
            }, 7); // High priority for opportunities
            
            logger.info('Opportunity emitted', { opportunityType, customerEmail: customer_email });
        };

        // helper-methods-for-patterns
        // Delegates to the shared taxonomy: this table was previously a
        // byte-identical private copy of InventoryMaterialsWorker's, and
        // nothing forced the two to agree (see inventory-taxonomy.js).
        this.getOptimalLevel = function(itemType) {
            return getOptimalLevel(itemType);
        };
    }
}

// Run worker if called directly
if (require.main === module) {
    const worker = new OpportunityDetectionWorker();
    
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

module.exports = OpportunityDetectionWorker;