/**
 * Worker Orchestrator
 * Manages the entire worker ecosystem
 * Starts, stops, and monitors all workers
 */

const RevenueIngestionWorker = require('./RevenueIngestionWorker');
const TaskRouterWorker = require('./TaskRouterWorker');
const EventBusWorker = require('./EventBusWorker');
const ProvisioningWorker = require('./ProvisioningWorker');
const FabricationWorker = require('./FabricationWorker');
const InventoryMaterialsWorker = require('./InventoryMaterialsWorker');
const CostMarginWorker = require('./CostMarginWorker');
const OpportunityDetectionWorker = require('./OpportunityDetectionWorker');
const BehaviorPatternWorker = require('./BehaviorPatternWorker');
const AnomalyDetectionWorker = require('./AnomalyDetectionWorker');
const DecisionAssistWorker = require('./DecisionAssistWorker');
const SecurityIdentityWorker = require('./SecurityIdentityWorker');
const SyncWorker = require('./SyncWorker');
const NotificationWorker = require('./NotificationWorker');
const AuditWorker = require('./AuditWorker');
const QueueManager = require('./QueueManager');
const { createClient } = require('@supabase/supabase-js');
const { createNotification } = require('../lib/notifications/notify');
const { publish } = require('../lib/realtime/eventBus');
require('dotenv').config();
const logger = require('../lib/structured-logger').child({ component: 'WorkerOrchestrator' });

class WorkerOrchestrator {
    constructor() {
        this.workers = new Map();
        this.supabase = null;
        this.initialized = false;
        this.running = false;
        this.metricsInterval = null;
        
        // Worker configurations
        this.workerConfigs = {
            // Core workers (always running)
            revenue_ingestion: {
                class: RevenueIngestionWorker,
                instances: 2,
                priority: 'critical'
            },
            task_router: {
                class: TaskRouterWorker,
                instances: 2,
                priority: 'critical'
            },
            event_bus: {
                class: EventBusWorker,
                instances: 1,
                priority: 'critical'
            },
            
            // ProtoForge workers (production layer)
            provisioning: {
                class: ProvisioningWorker,
                instances: 1,
                priority: 'high'
            },
            fabrication: {
                class: FabricationWorker,
                instances: 1,
                priority: 'medium'
            },
            inventory: {
                class: InventoryMaterialsWorker,
                instances: 1,
                priority: 'medium'
            },
            cost_margin: {
                class: CostMarginWorker,
                instances: 1,
                priority: 'low'
            },
            
            // HEIDI workers (intelligence layer)
            opportunity_detection: {
                class: OpportunityDetectionWorker,
                instances: 1,
                priority: 'medium'
            },
            behavior_pattern: {
                class: BehaviorPatternWorker,
                instances: 1,
                priority: 'low'
            },
            anomaly_detection: {
                class: AnomalyDetectionWorker,
                instances: 1,
                priority: 'high'
            },
            decision_assist: {
                class: DecisionAssistWorker,
                instances: 1,
                priority: 'low'
            },
            
            // URSULA workers (communication layer)
            security_identity: {
                class: SecurityIdentityWorker,
                instances: 1,
                priority: 'critical'
            },
            sync: {
                class: SyncWorker,
                instances: 1,
                priority: 'high'
            },
            notification: {
                class: NotificationWorker,
                instances: 1,
                priority: 'medium'
            },
            audit: {
                class: AuditWorker,
                instances: 1,
                priority: 'low'
            }
        };
    }

    async initialize() {
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseKey) {
            throw new Error('Missing Supabase credentials');
        }

        this.supabase = createClient(supabaseUrl, supabaseKey);
        this.initialized = true;
        this.commandPollInterval = null;

        logger.info('Initialized');
    }

    async start() {
        if (this.running) {
            logger.info('Already running');
            return;
        }

        if (!this.initialized) {
            await this.initialize();
        }

        this.running = true;
        logger.info('Starting worker ecosystem');
        
        // Start workers in priority order
        await this.startWorkersByPriority();
        
        // Start metrics reporting
        this.startMetricsReporting();

        // Start health monitoring
        this.startHealthMonitoring();

        // Start polling agent_control_commands (mobile-ops worker control —
        // see api/agent-manager/control.js, the only writer of that table).
        this.startCommandPolling();

        logger.info('All workers started successfully');
    }

    async stop() {
        if (!this.running) return;

        this.running = false;
        logger.info('Shutting down workers');

        // Stop all workers
        const stopPromises = [];
        for (const [workerType, instances] of this.workers) {
            for (const worker of instances) {
                stopPromises.push(worker.stop());
            }
        }

        await Promise.all(stopPromises);

        // Clear intervals
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
        }
        if (this.healthInterval) {
            clearInterval(this.healthInterval);
        }
        if (this.commandPollInterval) {
            clearInterval(this.commandPollInterval);
        }

        logger.info('Shutdown complete');
    }

    // ── Mobile-ops command queue ──────────────────────────────────────────
    // Polls agent_control_commands for rows written by
    // api/agent-manager/control.js (Authentication -> Authorization ->
    // Command Queue -> Execution -> Audit Log; this is the "Execution" and
    // "Audit Log" half of that chain — the API layer only ever queues).

    startCommandPolling(intervalMs = 5000) {
        this.commandPollInterval = setInterval(() => {
            this.pollControlCommands().catch((err) => {
                logger.error('Command poll failed', { error: err });
            });
        }, intervalMs);
    }

    async pollControlCommands() {
        const { data: pending, error } = await this.supabase
            .from('agent_control_commands')
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: true })
            .limit(10);

        if (error) {
            logger.error('Failed to fetch pending commands', { error });
            return;
        }

        for (const command of pending || []) {
            await this.executeControlCommand(command);
        }
    }

    async executeControlCommand(command) {
        const { id, worker_type: workerType, worker_id: workerId, command: action } = command;

        await this.supabase
            .from('agent_control_commands')
            .update({ status: 'processing', started_at: new Date().toISOString() })
            .eq('id', id);

        let result;
        try {
            result = await this.runLifecycleAction(action, workerType, workerId);

            await this.supabase
                .from('agent_control_commands')
                .update({ status: 'completed', result, completed_at: new Date().toISOString() })
                .eq('id', id);

            await this.supabase.from('worker_events').insert({
                worker_id: workerId || workerType,
                queue_name: workerType,
                event_type: `control_${action}`,
                details: { command_id: id, result },
            }).catch(() => {});
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            await this.supabase
                .from('agent_control_commands')
                .update({ status: 'failed', error_message: message, completed_at: new Date().toISOString() })
                .eq('id', id);

            await this.supabase.from('worker_events').insert({
                worker_id: workerId || workerType,
                queue_name: workerType,
                event_type: `control_${action}_failed`,
                details: { command_id: id, error: message },
            }).catch(() => {});

            await createNotification(this.supabase, {
                category: 'worker_failure',
                title: `${workerType} ${action} failed`,
                body: message,
                metadata: { command_id: id, worker_type: workerType, worker_id: workerId, action },
            }).catch(() => {});
            publish('notification', { category: 'worker_failure', worker_type: workerType, worker_id: workerId, action });
        }
    }

    async runLifecycleAction(action, workerType, workerId) {
        const config = this.workerConfigs[workerType];
        if (!config || !config.class) {
            throw new Error(`Unknown or unimplemented worker type: ${workerType}`);
        }

        switch (action) {
            case 'start':
                return this.startWorkerType(workerType);
            case 'stop':
                return this.stopWorkerType(workerType, workerId);
            case 'restart':
                if (workerId) {
                    await this.restartWorker(workerId, workerType);
                    return { restarted: [workerId] };
                }
                return this.restartWorkerType(workerType);
            case 'scale_up':
                await this.scaleWorker(workerType, 'up');
                return { scaled: 'up', instances: (this.workers.get(workerType) || []).length };
            case 'scale_down':
                await this.scaleWorker(workerType, 'down');
                return { scaled: 'down', instances: (this.workers.get(workerType) || []).length };
            default:
                throw new Error(`Unknown lifecycle action: ${action}`);
        }
    }

    /** Start every configured instance of a worker type that isn't already running. */
    async startWorkerType(workerType) {
        const config = this.workerConfigs[workerType];
        const existing = this.workers.get(workerType) || [];
        const started = [];

        for (let i = existing.length; i < config.instances; i++) {
            const workerId = `${workerType}-${i + 1}`;
            const worker = new config.class(workerId);
            await worker.start();
            existing.push(worker);
            started.push(workerId);
        }

        this.workers.set(workerType, existing);
        return { started };
    }

    /** Stop one worker instance (workerId given) or every instance of a type. */
    async stopWorkerType(workerType, workerId) {
        const instances = this.workers.get(workerType) || [];
        const stopped = [];

        if (workerId) {
            const worker = instances.find((w) => w.workerId === workerId);
            if (worker) {
                await worker.stop();
                instances.splice(instances.indexOf(worker), 1);
                stopped.push(workerId);
            }
        } else {
            for (const worker of instances) {
                await worker.stop();
                stopped.push(worker.workerId);
            }
            instances.length = 0;
        }

        this.workers.set(workerType, instances);
        return { stopped };
    }

    async restartWorkerType(workerType) {
        const instances = [...(this.workers.get(workerType) || [])];
        const restarted = [];
        for (const worker of instances) {
            await this.restartWorker(worker.workerId, workerType);
            restarted.push(worker.workerId);
        }
        return { restarted };
    }

    async startWorkersByPriority() {
        const priorities = {
            critical: 0,
            high: 1,
            medium: 2,
            low: 3
        };
        
        // Sort worker types by priority
        const sortedTypes = Object.entries(this.workerConfigs)
            .sort(([,a], [,b]) => priorities[a.priority] - priorities[b.priority])
            .map(([type]) => type);
        
        for (const workerType of sortedTypes) {
            const config = this.workerConfigs[workerType];
            
            if (!config.class) {
                logger.info('Skipping worker type (not implemented)', { workerType });
                continue;
            }

            logger.info('Starting workers', { workerType });
            
            const instances = [];
            for (let i = 0; i < config.instances; i++) {
                const workerId = `${workerType}-${i + 1}`;
                const worker = new config.class(workerId);
                
                try {
                    await worker.start();
                    instances.push(worker);
                    logger.info('Started worker', { workerId });
                } catch (err) {
                    logger.error('Failed to start worker', { workerId, error: err });
                }
            }
            
            if (instances.length > 0) {
                this.workers.set(workerType, instances);
            }
        }
    }

    async startMetricsReporting() {
        this.metricsInterval = setInterval(async () => {
            const metrics = await this.gatherMetrics();
            
            // Store metrics
            await this.supabase
                .from('orchestrator_metrics')
                .insert({
                    worker_counts: metrics.workerCounts,
                    queue_stats: metrics.queueStats,
                    system_health: metrics.systemHealth,
                    created_at: new Date().toISOString()
                });
            
            // Log summary
            logger.info('Metrics', {
                workers: metrics.totalWorkers,
                queues: Object.keys(metrics.queueStats).length,
                healthy: metrics.systemHealth.healthy_workers
            });
        }, 60000); // Every minute
    }

    async startHealthMonitoring() {
        this.healthInterval = setInterval(async () => {
            await this.checkWorkerHealth();
        }, 30000); // Every 30 seconds
    }

    async checkWorkerHealth() {
        const queue = new QueueManager();
        await queue.initialize();
        
        // Get all worker statuses
        const { data: workerStatuses } = await this.supabase
            .from('worker_status')
            .select('*');
        
        const now = new Date();
        const staleThreshold = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes
        
        for (const status of workerStatuses || []) {
            const lastHeartbeat = new Date(status.last_heartbeat);
            
            if (lastHeartbeat < staleThreshold && status.status !== 'stopped') {
                logger.warn('Worker is stale', { workerId: status.worker_id, lastHeartbeat: status.last_heartbeat });

                // Try to restart if critical
                const workerType = status.worker_id.split('-')[0];
                if (this.workerConfigs[workerType]?.priority === 'critical') {
                    logger.info('Attempting to restart critical worker', { workerId: status.worker_id });
                    await this.restartWorker(status.worker_id, workerType);
                }
            }
        }
    }

    async restartWorker(workerId, workerType) {
        const config = this.workerConfigs[workerType];
        if (!config.class) return;
        
        // Stop existing worker
        const instances = this.workers.get(workerType) || [];
        const existingWorker = instances.find(w => w.workerId === workerId);
        
        if (existingWorker) {
            try {
                await existingWorker.stop();
                instances.splice(instances.indexOf(existingWorker), 1);
            } catch (err) {
                logger.error('Error stopping worker', { workerId, error: err });
            }
        }

        // Start new instance
        try {
            const newWorker = new config.class(workerId);
            await newWorker.start();
            instances.push(newWorker);
            this.workers.set(workerType, instances);
            logger.info('Restarted worker', { workerId });
        } catch (err) {
            logger.error('Failed to restart worker', { workerId, error: err });
        }
    }

    async gatherMetrics() {
        // Count workers by type
        const workerCounts = {};
        let totalWorkers = 0;
        
        for (const [type, instances] of this.workers) {
            workerCounts[type] = instances.length;
            totalWorkers += instances.length;
        }
        
        // Get queue statistics
        const queue = new QueueManager();
        await queue.initialize();
        const queueStats = await queue.getQueueStats();
        
        // Check system health
        const { data: healthData } = await this.supabase
            .from('worker_status')
            .select('status, count(*)')
            .group('status');
        
        const systemHealth = {
            total_workers: totalWorkers,
            healthy_workers: 0,
            busy_workers: 0,
            error_workers: 0
        };
        
        healthData?.forEach(stat => {
            if (stat.status === 'idle') systemHealth.healthy_workers = stat.count;
            else if (stat.status === 'busy') systemHealth.busy_workers = stat.count;
            else if (stat.status === 'error') systemHealth.error_workers = stat.count;
        });
        
        return {
            workerCounts,
            queueStats,
            systemHealth,
            totalWorkers
        };
    }

    async scaleWorker(workerType, direction) {
        const config = this.workerConfigs[workerType];
        if (!config.class) {
            throw new Error(`Worker type ${workerType} not implemented`);
        }
        
        const instances = this.workers.get(workerType) || [];
        const currentCount = instances.length;
        
        if (direction === 'up') {
            const newWorkerId = `${workerType}-${currentCount + 1}`;
            const newWorker = new config.class(newWorkerId);
            
            await newWorker.start();
            instances.push(newWorker);
            this.workers.set(workerType, instances);

            logger.info('Scaled up', { workerType, instanceCount: currentCount + 1 });
        } else if (direction === 'down' && currentCount > 1) {
            const worker = instances.pop();
            await worker.stop();

            logger.info('Scaled down', { workerType, instanceCount: currentCount - 1 });
        }
    }

    async getWorkerStatus() {
        const metrics = await this.gatherMetrics();
        
        // Add detailed worker info
        const detailedWorkers = {};
        for (const [type, instances] of this.workers) {
            detailedWorkers[type] = instances.map(w => ({
                id: w.workerId,
                running: w.running || false
            }));
        }
        
        return {
            ...metrics,
            workers: detailedWorkers
        };
    }
}

// Run orchestrator if called directly
if (require.main === module) {
    const orchestrator = new WorkerOrchestrator();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        logger.info('Shutting down');
        await orchestrator.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        logger.info('Shutting down');
        await orchestrator.stop();
        process.exit(0);
    });

    // Start orchestrator
    orchestrator.start().catch(err => {
        logger.error('Failed to start', { error: err });
        process.exit(1);
    });
}

module.exports = WorkerOrchestrator;
