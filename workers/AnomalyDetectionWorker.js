const { createClient } = require('@supabase/supabase-js');
const QueueManager = require('./QueueManager');
require('dotenv').config();
const logger = require('../lib/structured-logger').child({ component: 'AnomalyDetectionWorker' });

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
            logger.info('Anomaly Detection Worker initialized', { workerId: this.workerId });
        };

        this.start = async function() {
            if (this.running) return;
            await this.initialize();
            this.running = true;
            this.queue.startHeartbeat();
            logger.info('Monitoring for anomalies');
            this.poll();
        };

        this.stop = async function() {
            this.running = false;
            if (this.pollTimer) clearTimeout(this.pollTimer);
            await this.queue.shutdown();
            logger.info('Anomaly Detection Worker stopped');
        };

        this.poll = function() {
            if (!this.running) return;
            this.processNextTask()
                .catch(err => logger.error('Anomaly Detection Worker poll error', { error: err }))
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
                    default: throw new Error(`Unhandled event type: ${task.payload.event_type}`);
                }
                await this.queue.completeTask(taskId, true);
            } catch (err) {
                logger.error('Anomaly Detection Worker task failed', { taskId, error: err });
                await this.queue.completeTask(taskId, false, err.message);
            }
        };

        this.checkQueueAnomalies = async function(payload) {
            const { queue_name, pending_jobs } = payload.data;
            logger.info('Checking queue anomalies', { queueName: queue_name });
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
                    
                    logger.info('Queue backup detected', { queueName: queue_name, pendingJobs: pending_jobs });
                }
            }
        };

        this.checkJobAnomalies = async function(payload) {
            const { job_id, job_type, success, duration } = payload.data;
            
            logger.info('Checking job anomalies', { jobType: job_type, jobId: job_id });
            
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
                    
                    logger.info('Failed job spike detected', { jobType: job_type, failureRatePercent: Number((failureRate * 100).toFixed(1)), failedJobs, sampleSize: recentJobs.length });
                }
            }
        };

        this.checkSystemAnomalies = async function(payload) {
            const { metrics } = payload.data;
            
            logger.info('Checking system resource anomalies');
            
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
                
                logger.info('Resource exhaustion detected', { anomalies: anomalies.map(a => ({ type: a.type, value: a.value, unit: a.unit })) });
            }
        };

        this.checkResponseTimeAnomalies = async function(payload) {
            const { endpoint, response_time_ms, timestamp } = payload.data;
            
            logger.info('Checking response time anomalies', { endpoint });
            
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
                    
                    logger.info('Slow response detected', { endpoint, thresholdMs: this.anomalyThresholds.slow_response.threshold_ms, consecutiveSlowSamples: slowResponses.length });
                }
            }
        };

        this.checkBehaviorAnomalies = async function(payload) {
            const { behavior_type, value, baseline, deviation } = payload.data;
            
            logger.info('Checking behavior anomalies', { behaviorType: behavior_type });
            
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
                    
                    logger.info('Unusual pattern detected', { behaviorType: behavior_type, deviation, baseline });
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
            
            logger.info('Emitted anomaly alert', { anomalyType });
        };

        this.triggerAutoRecovery = async function(anomalyType, details) {
            logger.info('Checking auto-recovery options', { anomalyType });
            
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
                    logger.info('No auto-recovery strategy for anomaly type', { anomalyType });
            }
        };

        this.attemptQueueRecovery = async function(details) {
            const { queue_name } = details;

            logger.info('Attempting queue recovery', { queueName: queue_name });
            
            // attempt-restarting-workers-for-queue
            // Try to restart workers for this queue
            const queue = new QueueManager();
            await queue.initialize();
            
            // get-worker-count-for-queue-and-restart-them
            // This would integrate with the orchestrator to restart workers
            // For now, we'll just log the intention
            logger.info('Would restart workers for queue (integration with orchestrator needed)', { queueName: queue_name });
        };

        this.attemptJobRecovery = async function(details) {
            const { job_type } = details;
            
            logger.info('Attempting job recovery', { jobType: job_type });
            
            // attempt-dependency-check-or-rollback
            // This would check dependencies or suggest rollback
            logger.info('Would check dependencies for job type (integration needed)', { jobType: job_type });
        };

        this.attemptResourceRecovery = async function(details) {
            logger.info('Attempting resource recovery');
            
            // attempt-cleanup-or-scaling
            // attempt-garbage-collection-or-cache-clearing
            logger.info('Would attempt resource cleanup or scaling (integration needed)');
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
        logger.info('Anomaly Detection Worker shutting down');
        await worker.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        logger.info('Anomaly Detection Worker shutting down');
        await worker.stop();
        process.exit(0);
    });

    // Start worker
    worker.start().catch(err => {
        logger.error('Anomaly Detection Worker failed to start', { error: err });
        process.exit(1);
    });
}

module.exports = AnomalyDetectionWorker;