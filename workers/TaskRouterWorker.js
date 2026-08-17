/**
 * Task Router Worker (Heidi Core Brain)
 * Routes tasks to correct worker with correct priority
 * Uses context, system state, and user intent
 */

const QueueManager = require('./QueueManager');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const logger = require('../lib/structured-logger').child({ component: 'TaskRouterWorker' });

class TaskRouterWorker {
    constructor(workerId = null) {
        this.workerId = workerId || `task-router-${Date.now()}`;
        this.queue = new QueueManager();
        this.supabase = null;
        this.running = false;
        this.pollInterval = 3000; // 3 seconds - faster for critical routing
        this.pollTimer = null;
        
        // Worker routing rules
        this.routingRules = {
            // Revenue events
            'stripe.webhook': {
                queue: 'revenue_ingestion',
                priority: 10 // Highest priority for revenue
            },
            
            // Provisioning events
            'service.provision': {
                queue: 'provisioning',
                priority: 8
            },
            'service.deactivate': {
                queue: 'provisioning',
                priority: 8
            },
            
            // Fabrication events
            'fabrication.job': {
                queue: 'fabrication',
                priority: 5
            },
            'fabrication.cancel': {
                queue: 'fabrication',
                priority: 7
            },
            
            // Inventory events
            'inventory.check': {
                queue: 'inventory',
                priority: 4
            },
            'inventory.update': {
                queue: 'inventory',
                priority: 3
            },
            
            // Analytics events
            'cost.calculate': {
                queue: 'cost_margin',
                priority: 2
            },
            'opportunity.detect': {
                queue: 'opportunity_detection',
                priority: 6
            },
            
            // System events
            'system.alert': {
                queue: 'anomaly_detection',
                priority: 9
            },
            'system.health': {
                queue: 'anomaly_detection',
                priority: 3
            },
            
            // Communication events
            'notification.send': {
                queue: 'notification',
                priority: 5
            },
            'audit.log': {
                queue: 'audit',
                priority: 1
            }
        };
        
        // Context cache for routing decisions
        this.contextCache = new Map();
        this.cacheExpiry = 60000; // 1 minute
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
        await this.queue.registerWorker('task_router', this.workerId);
        await this.queue.updateHeartbeat('idle');
        
        logger.info('Task Router initialized', { workerId: this.workerId });
    }

    async start() {
        if (this.running) {
            logger.info('Task Router already running');
            return;
        }

        await this.initialize();
        this.running = true;
        this.queue.startHeartbeat();

        logger.info('Starting to route tasks');
        
        // Start polling
        this.poll();
    }

    async stop() {
        this.running = false;
        
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
        }
        
        await this.queue.shutdown();
        logger.info('Task Router stopped');
    }

    poll() {
        if (!this.running) return;
        
        this.processNextTask()
            .catch(err => {
                logger.error('Task Router error in poll', { error: err });
            })
            .finally(() => {
                // Schedule next poll
                this.pollTimer = setTimeout(() => this.poll(), this.pollInterval);
            });
    }

    async processNextTask() {
        const taskId = await this.queue.dequeue('task_routing');
        
        if (!taskId) {
            return; // No tasks available
        }
        
        try {
            const task = await this.queue.getTask(taskId);
            if (!task) {
                logger.error('Task Router task not found', { taskId });
                return;
            }

            logger.info('Routing task', { taskType: task.payload.type });
            
            // Analyze and route the task
            const routingDecision = await this.analyzeTask(task.payload);
            
            // Execute routing
            await this.executeRouting(task.payload, routingDecision);
            
            // Mark task as completed
            await this.queue.completeTask(taskId, true);
            
            // Log routing decision
            await this.logRouting(task.payload, routingDecision);
            
        } catch (err) {
            logger.error('Task Router task failed', { taskId, error: err });
            await this.queue.completeTask(taskId, false, err.message);
        }
    }

    async analyzeTask(payload) {
        const type = payload.type;
        const context = payload.context || {};
        
        // Check routing rules
        const rule = this.routingRules[type];
        if (rule) {
            return {
                queue: rule.queue,
                priority: rule.priority,
                reason: 'rule_match',
                confidence: 1.0
            };
        }
        
        // Use ML-like analysis for unknown tasks
        const analysis = await this.analyzeWithML(payload);
        
        return {
            queue: analysis.queue,
            priority: analysis.priority,
            reason: analysis.reason,
            confidence: analysis.confidence
        };
    }

    async analyzeWithML(payload) {
        // Simple heuristic-based "ML" analysis
        const text = JSON.stringify(payload).toLowerCase();
        
        // Revenue indicators
        if (text.includes('payment') || text.includes('stripe') || text.includes('invoice')) {
            return {
                queue: 'revenue_ingestion',
                priority: 10,
                reason: 'revenue_keywords',
                confidence: 0.8
            };
        }
        
        // Service indicators
        if (text.includes('service') || text.includes('provision') || text.includes('activate')) {
            return {
                queue: 'provisioning',
                priority: 7,
                reason: 'service_keywords',
                confidence: 0.8
            };
        }
        
        // Alert indicators
        if (text.includes('alert') || text.includes('error') || text.includes('failure')) {
            return {
                queue: 'anomaly_detection',
                priority: 9,
                reason: 'alert_keywords',
                confidence: 0.9
            };
        }
        
        // Default to general processing
        return {
            queue: 'general_processing',
            priority: 3,
            reason: 'default',
            confidence: 0.5
        };
    }

    async executeRouting(payload, routingDecision) {
        // Add routing metadata
        const enrichedPayload = {
            ...payload,
            routing: {
                routed_by: this.workerId,
                routed_at: new Date().toISOString(),
                target_queue: routingDecision.queue,
                priority: routingDecision.priority,
                reason: routingDecision.reason,
                confidence: routingDecision.confidence
            }
        };
        
        // Enqueue to target queue
        await this.queue.enqueue(
            routingDecision.queue,
            enrichedPayload,
            routingDecision.priority
        );
        
        logger.info('Routed task', { targetQueue: routingDecision.queue, priority: routingDecision.priority });
    }

    async logRouting(payload, routingDecision) {
        await this.supabase
            .from('routing_logs')
            .insert({
                task_type: payload.type,
                source_queue: 'task_routing',
                target_queue: routingDecision.queue,
                priority: routingDecision.priority,
                reason: routingDecision.reason,
                confidence: routingDecision.confidence,
                routed_by: this.workerId,
                created_at: new Date().toISOString()
            });
    }

    /**
     * Route a task directly (bypassing queue)
     * Used for high-priority immediate routing
     */
    async routeDirectly(payload) {
        const routingDecision = await this.analyzeTask(payload);
        await this.executeRouting(payload, routingDecision);
        
        return routingDecision;
    }

    /**
     * Get routing statistics
     */
    async getRoutingStats() {
        const { data, error } = await this.supabase
            .from('routing_logs')
            .select('target_queue, count(*)')
            .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .group('target_queue');
        
        if (error) throw error;
        
        return data.reduce((acc, row) => {
            acc[row.target_queue] = row.count;
            return acc;
        }, {});
    }

    /**
     * Update routing rules dynamically
     */
    updateRoutingRule(type, config) {
        this.routingRules[type] = config;
        logger.info('Updated routing rule', { type });
    }

    /**
     * Get system context for routing
     */
    async getSystemContext() {
        const cacheKey = 'system_context';
        const cached = this.contextCache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.data;
        }
        
        // Get current system state
        const { data: queueStats } = await this.supabase
            .from('worker_status')
            .select('worker_type, status, count(*)')
            .group('worker_type, status');
        
        const context = {
            queue_load: {},
            worker_health: {},
            timestamp: new Date().toISOString()
        };
        
        queueStats.forEach(stat => {
            context.queue_load[stat.worker_type] = context.queue_load[stat.worker_type] || {};
            context.queue_load[stat.worker_type][stat.status] = stat.count;
        });
        
        // Cache the context
        this.contextCache.set(cacheKey, {
            data: context,
            timestamp: Date.now()
        });
        
        return context;
    }
}

// Run worker if called directly
if (require.main === module) {
    const worker = new TaskRouterWorker();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        logger.info('Task Router shutting down');
        await worker.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        logger.info('Task Router shutting down');
        await worker.stop();
        process.exit(0);
    });

    // Start worker
    worker.start().catch(err => {
        logger.error('Task Router failed to start', { error: err });
        process.exit(1);
    });
}

module.exports = TaskRouterWorker;
