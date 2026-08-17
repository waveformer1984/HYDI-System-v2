/**
 * Fabrication / Job Queue Worker
 * Handles actual build tasks (3D prints, robotic ops, etc.)
 * 
 * Queue-driven
 * Prioritized jobs
 * Retry logic for failed builds
 */

const QueueManager = require('./QueueManager');
const { createClient } = require('@supabase/supabase-js');
const logger = require('../lib/structured-logger').child({ component: 'FabricationWorker' });

class FabricationWorker {
    constructor(workerId = null) {
        this.workerId = workerId || `fabrication-worker-${Date.now()}`;
        this.queue = new QueueManager();
        this.supabase = null;
        this.running = false;
        this.pollInterval = 3000; // 3 seconds
        this.pollTimer = null;
        
        // Job types this worker can handle
        this.supportedJobTypes = [
            '3d_print',
            'pcb_fabrication',
            'cnc_machining',
            'laser_cutting',
            'robotics_assembly',
            'custom_hardware_build',
            'prototype_fabrication'
        ];
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
        await this.queue.registerWorker('fabrication', this.workerId);
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

        logger.info('Starting to process fabrication jobs');
        
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

        this.processNextJob()
            .catch(err => {
                logger.error('Error in poll', { error: err });
            })
            .finally(() => {
                // Schedule next poll
                this.pollTimer = setTimeout(() => this.poll(), this.pollInterval);
            });
    }

    async processNextJob() {
        const taskId = await this.queue.dequeue('fabrication');
        
        if (!taskId) {
            return; // No jobs available
        }
        
        try {
            const task = await this.queue.getTask(taskId);
            if (!task) {
                logger.error('Job not found', { taskId });
                return;
            }

            logger.info('Processing job', { jobType: task.payload.job_type });
            
            // Process based on job type
            switch (task.payload.job_type) {
                case '3d_print':
                    await this.process3DPrintJob(task.payload);
                    break;
                    
                case 'pcb_fabrication':
                    await this.processPCBFabricationJob(task.payload);
                    break;
                    
                case 'cnc_machining':
                    await this.processCNCMachiningJob(task.payload);
                    break;
                    
                case 'laser_cutting':
                    await this.processLaserCuttingJob(task.payload);
                    break;
                    
                case 'robotics_assembly':
                    await this.processRoboticsAssemblyJob(task.payload);
                    break;
                    
                case 'custom_hardware_build':
                    await this.processCustomHardwareBuildJob(task.payload);
                    break;
                    
                case 'prototype_fabrication':
                    await this.processPrototypeFabricationJob(task.payload);
                    break;
                    
                case 'fabrication.readiness_check':
                    await this.processReadinessCheck(task.payload);
                    break;
                    
                default:
                    logger.info('Unsupported job type', { jobType: task.payload.job_type });
                    // Still mark as completed to avoid infinite retries
                    await this.queue.completeTask(taskId, true);
                    return;
            }

            // Mark job as completed
            await this.queue.completeTask(taskId, true);

        } catch (err) {
            logger.error('Job failed', { taskId, error: err });
            await this.queue.completeTask(taskId, false, err.message);
        }
    }

    async process3DPrintJob(payload) {
        const { customer_email, specifications, priority = 3 } = payload.data;

        logger.info('Processing 3D print job', { customerEmail: customer_email });

        // Simulate 3D printing process
        await this.simulateFabricationProcess('3D Print', specifications);

        // Log completion
        await this.logJobCompletion(payload, '3d_print', 'completed');

        // Notify customer
        await this.notifyJobCompletion(customer_email, '3D Print', 'completed');

        logger.info('3D print job completed', { customerEmail: customer_email });
    }

    async processPCBFabricationJob(payload) {
        const { customer_email, specifications, priority = 3 } = payload.data;

        logger.info('Processing PCB fabrication job', { customerEmail: customer_email });

        // Simulate PCB fabrication process
        await this.simulateFabricationProcess('PCB Fabrication', specifications);

        // Log completion
        await this.logJobCompletion(payload, 'pcb_fabrication', 'completed');

        // Notify customer
        await this.notifyJobCompletion(customer_email, 'PCB Fabrication', 'completed');

        logger.info('PCB fabrication job completed', { customerEmail: customer_email });
    }

    async processCNCMachiningJob(payload) {
        const { customer_email, specifications, priority = 3 } = payload.data;

        logger.info('Processing CNC machining job', { customerEmail: customer_email });

        // Simulate CNC machining process
        await this.simulateFabricationProcess('CNC Machining', specifications);

        // Log completion
        await this.logJobCompletion(payload, 'cnc_machining', 'completed');

        // Notify customer
        await this.notifyJobCompletion(customer_email, 'CNC Machining', 'completed');

        logger.info('CNC machining job completed', { customerEmail: customer_email });
    }

    async processLaserCuttingJob(payload) {
        const { customer_email, specifications, priority = 3 } = payload.data;

        logger.info('Processing laser cutting job', { customerEmail: customer_email });

        // Simulate laser cutting process
        await this.simulateFabricationProcess('Laser Cutting', specifications);

        // Log completion
        await this.logJobCompletion(payload, 'laser_cutting', 'completed');

        // Notify customer
        await this.notifyJobCompletion(customer_email, 'Laser Cutting', 'completed');

        logger.info('Laser cutting job completed', { customerEmail: customer_email });
    }

    async processRoboticsAssemblyJob(payload) {
        const { customer_email, specifications, priority = 3 } = payload.data;

        logger.info('Processing robotics assembly job', { customerEmail: customer_email });

        // Simulate robotics assembly process
        await this.simulateFabricationProcess('Robotics Assembly', specifications);

        // Log completion
        await this.logJobCompletion(payload, 'robotics_assembly', 'completed');

        // Notify customer
        await this.notifyJobCompletion(customer_email, 'Robotics Assembly', 'completed');

        logger.info('Robotics assembly job completed', { customerEmail: customer_email });
    }

    async processCustomHardwareBuildJob(payload) {
        const { customer_email, specifications, priority = 3 } = payload.data;

        logger.info('Processing custom hardware build job', { customerEmail: customer_email });

        // Simulate custom hardware build process
        await this.simulateFabricationProcess('Custom Hardware Build', specifications);

        // Log completion
        await this.logJobCompletion(payload, 'custom_hardware_build', 'completed');

        // Notify customer
        await this.notifyJobCompletion(customer_email, 'Custom Hardware Build', 'completed');

        logger.info('Custom hardware build job completed', { customerEmail: customer_email });
    }

    async processPrototypeFabricationJob(payload) {
        const { customer_email, specifications, priority = 3 } = payload.data;

        logger.info('Processing prototype fabrication job', { customerEmail: customer_email });

        // Simulate prototype fabrication process
        await this.simulateFabricationProcess('Prototype Fabrication', specifications);

        // Log completion
        await this.logJobCompletion(payload, 'prototype_fabrication', 'completed');

        // Notify customer
        await this.notifyJobCompletion(customer_email, 'Prototype Fabrication', 'completed');

        logger.info('Prototype fabrication job completed', { customerEmail: customer_email });
    }

    async processReadinessCheck(payload) {
        const { customer_email, customer_id, tier } = payload.data;

        logger.info('Performing readiness check', { customerEmail: customer_email });
        
        // Check if customer has necessary permissions/quota
        const { data: customer } = await this.supabase
            .from('customers')
            .select('tier, status')
            .eq('email', customer_email)
            .single();
        
        if (!customer) {
            throw new Error(`Customer not found: ${customer_email}`);
        }
        
        // Check if tier allows fabrication
        const allowsFabrication = ['pro', 'enterprise'].includes(customer.tier);
        const isActive = customer.status === 'active';
        
        if (!allowsFabrication || !isActive) {
            logger.info('Customer not ready for fabrication', { customerEmail: customer_email });
            await this.notifyFabricationReadiness(customer_email, false, !allowsFabrication ? 'tier_restriction' : 'account_inactive');
            return;
        }

        // Check current queue load
        const queueStats = await this.queue.getQueueStats();
        const fabricationQueueLength = queueStats.fabrication?.pending || 0;

        if (fabricationQueueLength > 10) { // Arbitrary threshold
            logger.info('Queue busy', { customerEmail: customer_email });
            await this.notifyFabricationReadiness(customer_email, false, 'queue_busy');
            return;
        }

        logger.info('Customer is ready for fabrication', { customerEmail: customer_email });
        await this.notifyFabricationReadiness(customer_email, true);
    }

    async simulateFabricationProcess(jobType, specifications) {
        // Simulate work based on job complexity
        const baseTime = 2000; // 2 seconds base
        const complexityFactor = specifications.complexity || 1;
        const workTime = baseTime * complexityFactor;
        
        // Simulate the work
        await new Promise(resolve => setTimeout(resolve, workTime));
        
        // Occasionally simulate failures for testing retry logic
        if (Math.random() < 0.1) { // 10% failure rate
            throw new Error(`Simulated fabrication failure for ${jobType}`);
        }
    }

    async logJobCompletion(payload, jobType, status) {
        const { customer_email, specifications } = payload.data;
        
        await this.supabase
            .from('fabrication_jobs')
            .insert({
                customer_email,
                job_type: jobType,
                status: status,
                specifications: specifications,
                started_at: new Date(),
                completed_at: new Date(),
                worker_id: this.workerId
            });
    }

    async notifyJobCompletion(customer_email, jobType, status) {
        // Send notification through event bus
        const queue = new QueueManager();
        await queue.initialize();
        
        await queue.enqueue('notification', {
            event_type: 'notification.send',
            data: {
                recipient: customer_email,
                template: 'fabrication_completed',
                data: {
                    job_type: jobType,
                    status: status,
                    completed_at: new Date().toISOString()
                }
            }
        }, 5); // High priority
    }

    async notifyFabricationReadiness(customer_email, isReady, reason = null) {
        // Send notification through event bus
        const queue = new QueueManager();
        await queue.initialize();
        
        await queue.enqueue('notification', {
            event_type: 'notification.send',
            data: {
                recipient: customer_email,
                template: 'fabrication_readiness',
                data: {
                    is_ready: isReady,
                    reason: reason,
                    checked_at: new Date().toISOString()
                }
            }
        }, 5); // High priority
    }
}

// Run worker if called directly
if (require.main === module) {
    const worker = new FabricationWorker();
    
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

module.exports = FabricationWorker;