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
                
                console.log(`[🔍 Opportunity] High frequency usage detected: ${customer_email} used ${service_name} ${usageCount} times in ${this.opportunityPatterns.high_frequency_usage.window_minutes} minutes`);
            }
        };

        this.analyzeFeatureRequests = async function(payload) {
            const { customer_email, feature_name, timestamp } = payload.data;
            
            console.log(`[🔍 Opportunity] Analyzing feature request: ${feature_name} from ${customer_email}`);
            
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
                
                console.log(`[🔍 Opportunity] Repeated feature request detected: ${feature_name} requested ${requestCount} times in ${this.opportunityPatterns.repeated_feature_request.window_hours} hours`);
            }
        };

        this.analyzeAbandonedCart = async function(payload) {
            const { customer_email, cart_value, items, timestamp } = payload.data;
            
            console.log(`[🔍 Opportunity] Analyzing abandoned cart for ${customer_email}: $${cart_value}`);
            
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
                
                console.log(`[🔍 Opportunity] High-value abandoned cart detected: ${customer_email} abandoned cart worth $${cartValue}`);
            }
        };

        this.analyzeServiceCompletion = async function(payload) {
            const { customer_email, service_name, satisfaction_score, timestamp } = payload.data;
            
            console.log(`[🔍 Opportunity] Analyzing service completion: ${service_name} for ${customer_email}`);
            
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
                                
                                console.log(`[🔍 Opportunity] Cross-sell opportunity: ${customer_email} uses ${service} (satisfaction: ${satisfaction}/5.0) but not ${complementary}`);
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
            
            console.log(`[🔍 Opportunity] Analyzing user behavior: ${behavior_type} for ${customer_email}`);
            
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
                        
                        console.log(`[🔍 Opportunity] Usage spike detected: ${customer_email} usage of ${service_name} is ${usageRatio.toFixed(1)}x baseline (${currentUsage} vs ${baseline})`);
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
            
            #emit-opportunity-event
            // Emit event to notify other systems
            const queue = new QueueManager();
            await queue.initialize();
            
            await queue.enqueue('event_bus', {
                event_type: 'opportunity.detected',
                data: opportunity
            }, 7); // High priority for opportunities
            
            console.log(`[🔍 Opportunity] Emitted ${opportunityType} opportunity for ${customer_email}`);
        };

        #helper-methods-for-patterns
        this.getOptimalLevel = function(itemType) {
            // Define optimal stock levels for different item types
            const optimalLevels = {
                'filament_pla': 1000, // grams
                'filament_abs': 1000, // grams
                'filament_petg': 1000, // grams
                'electronic_resistor': 100, // count
                'electronic_capacitor': 100, // count
                'electronic_ic': 50, // count
                'pcb_prototype': 20, // count
                'pcb_production': 50, // count
                'material_solder_paste': 200, // ml
                'material_isopropyl_alcohol': 500, // ml
                'material_thermal_paste': 100, // ml
                'fastener_screw': 200, // count
                'fastener_nut': 200, // count
                'fastener_bolt': 100, // count
            };
            
            return optimalLevels[itemType] || 50; // Default optimal level
        };
    }
}

// Run worker if called directly
if (require.main === module) {
    const worker = new OpportunityDetectionWorker();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n[🔍 Opportunity Detection Worker] Shutting down...');
        await worker.stop();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        console.log('\n[🔍 Opportunity Detection Worker] Shutting down...');
        await worker.stop();
        process.exit(0);
    });
    
    // Start worker
    worker.start().catch(err => {
        console.error('[🔍 Opportunity Detection Worker] Failed to start:', err);
        process.exit(1);
    });
}

module.exports = OpportunityDetectionWorker;