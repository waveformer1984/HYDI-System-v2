const { createClient } = require('@supabase/supabase-js');
const QueueManager = require('./QueueManager');
require('dotenv').config();

class AnomalyDetectionWorker {
    constructor(workerId) {
        this.workerId = workerId || `anomaly-detection-worker-${Date.now()}`;
        this.running = false;
        this.pollInterval = 5000;
        this.pollTimer = null;
        this.supabase = null;
        this.queue = new QueueManager();
        this.anomalyThresholds = {
            stuck_queue: { queue_length_threshold: 100, time_window_minutes: 10 },
            failed_job_spike: { failure_rate_threshold: 0.3, min_samples: 10, time_window_minutes: 5 },
            resource_exhaustion: { memory_threshold_mb: 1500, cpu_threshold_percent: 90, disk_threshold_percent: 85 },
            slow_response: { threshold_ms: 2000, consecutive_samples: 3 },
            unusual_pattern: { deviation_threshold: 2.0 }
        };

        this.initialize = function() {
            const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');
            this.supabase = createClient(supabaseUrl, supabaseKey);
            this.queue.registerWorker('anomaly_detection', this.workerId);
            this.queue.updateHeartbeat('idle');
            console.log(`[⚠️ Anomaly Detection Worker] Initialized: ${this.workerId}`);
        };

        this.start = async function() {
            if (this.running) return;
            await this.initialize();
            this.running = true;
            this.queue.startHeartbeat();
            console.log('[⚠️ Anomaly Detection Worker] Monitoring for anomalies...');
            this.poll();
        };

        this.stop = async function() {
            this.running = false;
            if (this.pollTimer) clearTimeout(this.pollTimer);
            await this.queue.shutdown();
            console.log('[⚠️ Anomaly Detection Worker] Stopped');
        };

        this.poll = function() {
            if (!this.running) return;
            this.processNextTask()
                .catch(err => console.error('[⚠️ Anomaly Detection Worker] Poll error:', err))
                .finally(() => { this.pollTimer = setTimeout(() => this.poll(), this.pollInterval); });
        };

        this.processNextTask = async function() {
            const taskId = await this.queue.dequeue('anomaly_detection');
            if (!taskId) return;
            try {
                const task = await this.queue.getTask(taskId);
                if (!task) return;
                switch (task.payload.event_type) {
                    case 'queue.status': await this.checkQueueAnomalies(task.payload); break;
                    case 'job.completed': await this.checkJobAnomalies(task.payload); break;
                    case 'system.metrics': await this.checkSystemAnomalies(task.payload); break;
                    case 'api.response': await this.checkResponseTimeAnomalies(task.payload); break;
                    case 'behavior.update': await this.checkBehaviorAnomalies(task.payload); break;
                    default: console.log(`[⚠️ Anomaly] Unhandled: ${task.payload.event_type}`);
                }
                await this.queue.completeTask(taskId, true);
            } catch (err) {
                console.error(`[⚠️ Anomaly Detection Worker] Task failed: ${taskId}`, err);
                await this.queue.completeTask(taskId, false, err.message);
            }
        };

        this.checkQueueAnomalies = async function(payload) {
            const { queue_name, pending_jobs } = payload.data;
            console.log(`[⚠️ Anomaly] Checking queue anomalies for ${queue_name}`);
            const queues = [queue_name];
            for (const queue_name of queues) {
                // Check for queue length anomaly (backup indicator)
                if (pending_jobs > this.anomalyThresholds.stuck_queue.queue_length_threshold) {
                    await this.triggerAnomalyAlert('queue_backup', {
                        queue_name,
                        pending_jobs_count: pending_jobs,
                        threshold: this.anomalyThresholds.stuck_queue.queue_length_threshold,
                        suggested_action: 'investigate_processing_speed_or_scale_workers'
                    });
                    
                    console.log(`[⚠️ Anomaly] Queue backup detected: ${queue_name} has ${pending_jobs} pending jobs`);
                }
            }
        };

        this.checkJobAnomalies = async function(payload) {
            const { job_id, job_type, success, duration } = payload.data;
            
            console.log(`[⚠️ Anomaly] Checking job anomalies for ${job_type} job ${job_id}`);
            
            // check-failed-job-patterns
            // Check for failed job spikes
            const { data: recentJobs } = await this.supabase
                .from('job_performance')
                .select('*')
                .eq('job_type', job_type)
                .gte('recorded_at', new Date(Date.now() - this.anomalyThresholds.failed_job_spike.time_window_minutes * 60 * 1000).toISOString());
            
            if (recentJobs.length >= this.anomalyThresholds.failed_job_spike.min_samples) {
                const failedJobs = recentJobs.filter(job => job.success === 0).length;
                const failureRate = failedJobs / recentJobs.length;
                
                if (failureRate > this.anomalyThresholds.failed_job_spike.failure_rate_threshold) {
                    await this.triggerAnomalyAlert('failed_job_spike', {
                        job_type,
                        failure_rate: failureRate,
                        threshold: this.anomalyThresholds.failed_job_spike.failure_rate_threshold,
                        sample_size: recentJobs.length,
                        time_window_minutes: this.anomalyThresholds.failed_job_spike.time_window_minutes,
                        suggested_action: 'investigate_job_processing_issues_or_check_dependencies'
                    });
                    
                    console.log(`[⚠️ Anomaly] Failed job spike detected: ${job_type} has ${(failureRate*100).toFixed(1)}% failure rate (${failedJobs}/${recentJobs.length})`);
                }
            }
        };

        this.checkSystemAnomalies = async function(payload) {
            const { metrics } = payload.data;
            
            console.log(`[⚠️ Anomaly] Checking system resource anomalies`);
            
            // check-resource-exhaustion
            // Check for resource exhaustion
            const anomalies = [];
            
            if (metrics.memory_mb && metrics.memory_mb > this.anomalyThresholds.resource_exhaustion.memory_threshold_mb) {
                anomalies.push({
                    type: 'memory_exhaustion',
                    value: metrics.memory_mb,
                    threshold: this.anomalyThresholds.resource_exhaustion.memory_threshold_mb,
                    unit: 'MB'
                });
            }
            
            if (metrics.cpu_percent && metrics.cpu_percent > this.anomalyThresholds.resource_exhaustion.cpu_threshold_percent) {
                anomalies.push({
                    type: 'cpu_exhaustion',
                    value: metrics.cpu_percent,
                    threshold: this.anomalyThresholds.resource_exhaustion.cpu_threshold_percent,
                    unit: '%'
                });
            }
            
            if (metrics.disk_percent && metrics.disk_percent > this.anomalyThresholds.resource_exhaustion.disk_threshold_percent) {
                anomalies.push({
                    type: 'disk_exhaustion',
                    value: metrics.disk_percent,
                    threshold: this.anomalyThresholds.resource_exhaustion.disk_threshold_percent,
                    unit: '%'
                });
            }
            
            if (anomalies.length > 0) {
                await this.triggerAnomalyAlert('resource_exhaustion', {
                    anomalies: anomalies,
                    suggested_action: 'investigate_resource_usage_or_scale_infrastructure'
                });
                
                console.log(`[⚠️ Anomaly] Resource exhaustion detected: ${anomalies.map(a => `${a.type}: ${a.value}${a.unit}`).join(', ')}`);
            }
        };

        this.checkResponseTimeAnomalies = async function(payload) {
            const { endpoint, response_time_ms, timestamp } = payload.data;
            
            console.log(`[⚠️ Anomaly] Checking response time anomalies for ${endpoint}`);
            
            // check-slow-response-pattern
            // Check for slow response times
            const { data: recentResponses } = await this.supabase
                .from('response_times')
                .select('*')
                .eq('endpoint', endpoint)
                .gte('timestamp', new Date(Date.now() - 30 * 60 * 1000).toISOString()) // Last 30 minutes
                .order('timestamp', { ascending: false })
                .limit(this.anomalyThresholds.slow_response.consecutive_samples);
            
            if (recentResponses.length >= this.anomalyThresholds.slow_response.consecutive_samples) {
                const slowResponses = recentResponses.filter(r => r.response_time_ms > this.anomalyThresholds.slow_response.threshold_ms);
                
                if (slowResponses.length >= this.anomalyThresholds.slow_response.consecutive_samples) {
                    await this.triggerAnomalyAlert('slow_response', {
                        endpoint,
                        response_time_ms: response_time_ms,
                        threshold_ms: this.anomalyThresholds.slow_response.threshold_ms,
                        consecutive_slow: slowResponses.length,
                        suggested_action: 'investigate_endpoint_performance_or_scale_resources'
                    });
                    
                    console.log(`[⚠️ Anomaly] Slow response detected: ${endpoint} has been slow (>${this.anomalyThresholds.slow_response.threshold_ms}ms) for ${slowResponses.length} consecutive samples`);
                }
            }
        };

        this.checkBehaviorAnomalies = async function(payload) {
            const { behavior_type, value, baseline, deviation } = payload.data;
            
            console.log(`[⚠️ Anomaly] Checking behavior anomalies: ${behavior_type}`);
            
            // check-unusual-patterns
            // Check for unusual patterns using statistical deviation
            if (baseline !== undefined && deviation !== undefined) {
                const threshold = this.anomalyThresholds.unusual_pattern.deviation_threshold;
                
                if (Math.abs(deviation) > threshold) {
                    await this.triggerAnomalyAlert('unusual_pattern', {
                        behavior_type,
                        value: value,
                        baseline: baseline,
                        deviation: deviation,
                        threshold: threshold,
                        suggested_action: 'investigate_behavior_change_or_check_data_quality'
                    });
                    
                    console.log(`[⚠️ Anomaly] Unusual pattern detected: ${behavior_type} deviates by ${deviation} from baseline ${baseline}`);
                }
            }
        };

        this.triggerAnomalyAlert = async function(anomalyType, details) {
            const anomaly = {
                type: anomalyType,
                detected_at: new Date().toISOString(),
                details: details,
                detected_by: this.workerId
            };
            
            // store-anomaly-and-emit-alert
            // Store anomaly
            await this.supabase
                .from('anomalies_detected')
                .insert(anomaly);
            
            // emit-anomaly-event
            // Emit event to notify other systems (including notification worker)
            const queue = new QueueManager();
            await queue.initialize();
            
            await queue.enqueue('event_bus', {
                event_type: 'anomaly.detected',
                data: anomaly
            }, 10); // Highest priority for anomalies
            
            // trigger-auto-recovery-if-applicable
            // Trigger auto-recovery flows if applicable
            await this.triggerAutoRecovery(anomalyType, details);
            
            console.log(`[⚠️ Anomaly] Emitted ${anomalyType} anomaly alert`);
        };

        this.triggerAutoRecovery = async function(anomalyType, details) {
            console.log(`[⚠️ Anomaly] Checking auto-recovery options for ${anomalyType}`);
            
            // auto-recovery-strategies
            switch (anomalyType) {
                case 'stuck_queue':
                    // For stuck queues, try to restart workers or increase processing
                    await this.attemptQueueRecovery(details);
                    break;
                    
                case 'failed_job_spike':
                    // For failed job spikes, maybe check dependencies or rollback recent changes
                    await this.attemptJobRecovery(details);
                    break;
                    
                case 'resource_exhaustion':
                    // For resource exhaustion, might trigger scaling or cleanup
                    await this.attemptResourceRecovery(details);
                    break;
                    
                default:
                    console.log(`[⚠️ Anomaly] No auto-recovery strategy for ${anomalyType}`);
            }
        };

        this.attemptQueueRecovery = async function(details) {
            const { queue_name } = details;
            
            console.log(`[⚠️ Anomaly] Attempting queue recovery for ${queue_name}`);
            
            // attempt-restarting-workers-for-queue
            // Try to restart workers for this queue
            const queue = new QueueManager();
            await queue.initialize();
            
            // get-worker-count-for-queue-and-restart-them
            // This would integrate with the orchestrator to restart workers
            // For now, we'll just log the intention
            console.log(`[⚠️ Anomaly] Would restart workers for queue ${queue_name} (integration with orchestrator needed)`);
        };

        this.attemptJobRecovery = async function(details) {
            const { job_type } = details;
            
            console.log(`[⚠️ Anomaly] Attempting job recovery for ${job_type}`);
            
            // attempt-dependency-check-or-rollback
            // This would check dependencies or suggest rollback
            console.log(`[⚠️ Anomaly] Would check dependencies for job type ${job_type} (integration needed)`);
        };

        this.attemptResourceRecovery = async function(details) {
            console.log(`[⚠️ Anomaly] Attempting resource recovery`);
            
            // attempt-cleanup-or-scaling
            // attempt-garbage-collection-or-cache-clearing
            console.log(`[⚠️ Anomaly] Would attempt resource cleanup or scaling (integration needed)`);
        };

        // helper-methods
        this.getQueueStatus = async function(queueName) {
            const queue = new QueueManager();
            await queue.initialize();
            
            const stats = await queue.getQueueStats();
            return stats[queueName] || null;
        };
    }
}

// Run worker if called directly
if (require.main === module) {
    const worker = new AnomalyDetectionWorker();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n[⚠️ Anomaly Detection Worker] Shutting down...');
        await worker.stop();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        console.log('\n[⚠️ Anomaly Detection Worker] Shutting down...');
        await worker.stop();
        process.exit(0);
    });
    
    // Start worker
    worker.start().catch(err => {
        console.error('[⚠️ Anomaly Detection Worker] Failed to start:', err);
        process.exit(1);
    });
}

module.exports = AnomalyDetectionWorker;