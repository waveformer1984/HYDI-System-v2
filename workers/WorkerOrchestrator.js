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
require('dotenv').config();

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
        
        console.log('[🎼 Orchestrator] Initialized');
    }

    async start() {
        if (this.running) {
            console.log('[🎼 Orchestrator] Already running');
            return;
        }
        
        if (!this.initialized) {
            await this.initialize();
        }
        
        this.running = true;
        console.log('[🎼 Orchestrator] Starting worker ecosystem...');
        
        // Start workers in priority order
        await this.startWorkersByPriority();
        
        // Start metrics reporting
        this.startMetricsReporting();

        // Start health monitoring
        this.startHealthMonitoring();

        // Start remote command polling (mobile ops: start/stop/restart via API)
        this.startCommandPolling();

        console.log('[🎼 Orchestrator] All workers started successfully');
    }

    async stop() {
        if (!this.running) return;
        
        this.running = false;
        console.log('[🎼 Orchestrator] Shutting down workers...');
        
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
        if (this.commandInterval) {
            clearInterval(this.commandInterval);
        }

        console.log('[🎼 Orchestrator] Shutdown complete');
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
                console.log(`[🎼 Orchestrator] Skipping ${workerType} (not implemented)`);
                continue;
            }
            
            console.log(`[🎼 Orchestrator] Starting ${workerType} workers...`);
            
            const instances = [];
            for (let i = 0; i < config.instances; i++) {
                const workerId = `${workerType}-${i + 1}`;
                const worker = new config.class(workerId);
                
                try {
                    await worker.start();
                    instances.push(worker);
                    console.log(`[🎼 Orchestrator] ✓ Started worker: ${workerId}`);
                } catch (err) {
                    console.error(`[🎼 Orchestrator] ✗ Failed to start ${workerId}:`, err);
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
            console.log('[🎼 Orchestrator] Metrics:', {
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
                console.warn(`[🎼 Orchestrator] Worker ${status.worker_id} is stale (last heartbeat: ${status.last_heartbeat})`);
                
                // Try to restart if critical
                const workerType = status.worker_id.split('-')[0];
                if (this.workerConfigs[workerType]?.priority === 'critical') {
                    console.log(`[🎼 Orchestrator] Attempting to restart critical worker: ${status.worker_id}`);
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
                console.error(`[🎼 Orchestrator] Error stopping worker ${workerId}:`, err);
            }
        }
        
        // Start new instance
        try {
            const newWorker = new config.class(workerId);
            await newWorker.start();
            instances.push(newWorker);
            this.workers.set(workerType, instances);
            console.log(`[🎼 Orchestrator] ✓ Restarted worker: ${workerId}`);
        } catch (err) {
            console.error(`[🎼 Orchestrator] ✗ Failed to restart ${workerId}:`, err);
        }
    }

    // ── Remote command polling (mobile ops) ──────────────────────────────────
    // Vercel serverless functions can't hold a reference to this long-lived
    // process, so mobile control requests are written to
    // agent_control_commands by api/agent-manager/control.js and picked up
    // here instead of being invoked directly.

    startCommandPolling() {
        this.commandInterval = setInterval(() => {
            this.pollCommands().catch(err => {
                console.error('[🎼 Orchestrator] Command polling error:', err);
            });
        }, 5000); // Every 5 seconds
    }

    async pollCommands() {
        const { data: commands, error } = await this.supabase
            .from('agent_control_commands')
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: true })
            .limit(5);

        if (error) {
            console.error('[🎼 Orchestrator] Failed to fetch pending commands:', error);
            return;
        }

        for (const command of (commands || [])) {
            await this.executeCommand(command);
        }
    }

    async executeCommand(command) {
        const { id, worker_type: workerType, command: action } = command;

        await this.supabase
            .from('agent_control_commands')
            .update({ status: 'acknowledged' })
            .eq('id', id);

        try {
            if (!this.workerConfigs[workerType]) {
                throw new Error(`Unknown worker type: ${workerType}`);
            }
            if (!this.workerConfigs[workerType].class) {
                throw new Error(`Worker type ${workerType} not implemented`);
            }

            let resultMessage;
            if (action === 'start') {
                resultMessage = await this.startWorkerType(workerType);
            } else if (action === 'stop') {
                resultMessage = await this.stopWorkerType(workerType);
            } else if (action === 'restart') {
                await this.stopWorkerType(workerType);
                resultMessage = await this.startWorkerType(workerType);
            } else {
                throw new Error(`Unknown command: ${action}`);
            }

            await this.supabase
                .from('agent_control_commands')
                .update({ status: 'completed', result_message: resultMessage, processed_at: new Date().toISOString() })
                .eq('id', id);

            await this.supabase
                .from('worker_events')
                .insert({ worker_id: null, queue_name: workerType, event_type: 'control_command', details: { command: action, requested_by: command.requested_by, result: resultMessage } });

            console.log(`[🎼 Orchestrator] Command ${action} on ${workerType} completed: ${resultMessage}`);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            await this.supabase
                .from('agent_control_commands')
                .update({ status: 'failed', result_message: message, processed_at: new Date().toISOString() })
                .eq('id', id);
            console.error(`[🎼 Orchestrator] Command ${action} on ${workerType} failed:`, message);
        }
    }

    async startWorkerType(workerType) {
        const config = this.workerConfigs[workerType];
        const instances = this.workers.get(workerType) || [];

        if (instances.length >= config.instances) {
            return `${workerType} already running (${instances.length} instance(s))`;
        }

        const started = [];
        for (let i = instances.length; i < config.instances; i++) {
            const workerId = `${workerType}-${i + 1}`;
            const worker = new config.class(workerId);
            await worker.start();
            instances.push(worker);
            started.push(workerId);
        }
        this.workers.set(workerType, instances);
        return `started ${started.length} instance(s): ${started.join(', ')}`;
    }

    async stopWorkerType(workerType) {
        const instances = this.workers.get(workerType) || [];
        if (instances.length === 0) {
            return `${workerType} already stopped`;
        }

        await Promise.all(instances.map(w => w.stop()));
        const count = instances.length;
        this.workers.set(workerType, []);
        return `stopped ${count} instance(s)`;
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
            
            console.log(`[🎼 Orchestrator] Scaled up ${workerType} to ${currentCount + 1} instances`);
        } else if (direction === 'down' && currentCount > 1) {
            const worker = instances.pop();
            await worker.stop();
            
            console.log(`[🎼 Orchestrator] Scaled down ${workerType} to ${currentCount - 1} instances`);
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
        console.log('\n[🎼 Orchestrator] Shutting down...');
        await orchestrator.stop();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        console.log('\n[🎼 Orchestrator] Shutting down...');
        await orchestrator.stop();
        process.exit(0);
    });
    
    // Start orchestrator
    orchestrator.start().catch(err => {
        console.error('[🎼 Orchestrator] Failed to start:', err);
        process.exit(1);
    });
}

module.exports = WorkerOrchestrator;
