const { createClient } = require('@supabase/supabase-js');
const QueueManager = require('./QueueManager');
require('dotenv').config();
const logger = require('../lib/structured-logger').child({ component: 'DecisionAssistWorker' });

class DecisionAssistWorker {
    constructor(workerId) {
        this.workerId = workerId || `decision-assist-worker-${Date.now()}`;
        this.running = false;
        this.pollInterval = 5000;
        this.pollTimer = null;
        this.supabase = null;
        this.queue = new QueueManager();
        this.decisionThresholds = {
            'financial_planning': { min_data_points: 10, confidence_threshold: 0.7, factors: ['revenue_trend','cost_efficiency','cash_flow','growth_rate'] },
            'resource_allocation': { min_data_points: 8, confidence_threshold: 0.65, factors: ['utilization_rate','cost_per_unit','demand_forecast','capacity'] },
            'risk_assessment': { min_data_points: 20, confidence_threshold: 0.8, factors: ['volatility','exposure','mitigation_options','historical_incidents'] },
            // System optimization decisions
            'system_optimization': {
                min_data_points: 15,
                confidence_threshold: 0.6,
                factors: ['response_time', 'error_rate', 'resource_utilization', 'user_satisfaction']
            }
        };
        
        this.initialize = function() {
            // Initialize Supabase
            const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
            
            if (!supabaseUrl || !supabaseKey) {
                throw new Error('Missing Supabase credentials');
            }
            
            this.supabase = createClient(supabaseUrl, supabaseKey);
            
            // Register worker
            this.queue.registerWorker('decision_assist', this.workerId);
            this.queue.updateHeartbeat('idle');
            
            logger.info('Decision Assist Worker initialized', { workerId: this.workerId });
        };

        this.start = async function() {
            if (this.running) {
                logger.info('Decision Assist Worker already running');
                return;
            }

            await this.initialize();
            this.running = true;
            this.queue.startHeartbeat();

            logger.info('Starting to analyze data and provide recommendations');
            
            // Start polling
            this.poll();
        };

        this.stop = async function() {
            this.running = false;
            
            if (this.pollTimer) {
                clearTimeout(this.pollTimer);
            }
            
            await this.queue.shutdown();
            logger.info('Decision Assist Worker stopped');
        };

        this.poll = function() {
            if (!this.running) return;
            
            this.processNextTask()
                .catch(err => {
                    logger.error('Decision Assist Worker error in poll', { error: err });
                })
                .finally(() => {
                    // Schedule next poll
                    this.pollTimer = setTimeout(() => this.poll(), this.pollInterval);
                });
        };

        this.processNextTask = async function() {
            const taskId = await this.queue.dequeue('decision_assist');
            
            if (!taskId) {
                return; // No tasks available
            }
            
            try {
                const task = await this.queue.getTask(taskId);
                if (!task) {
                    logger.error('Decision Assist Worker task not found', { taskId });
                    return;
                }

                logger.info('Processing task', { eventType: task.payload.event_type });
                
                // Process based on event type
                switch (task.payload.event_type) {
                    case 'financials.updated':
                        await this.analyzeFinancialData(task.payload);
                        break;
                        
                    case 'system.load':
                        await this.analyzeSystemLoad(task.payload);
                        break;
                        
                    case 'behavior.data':
                        await this.analyzeBehaviorData(task.payload);
                        break;
                        
                    case 'decision.request':
                        await this.processDecisionRequest(task.payload);
                        break;
                        
                    case 'optimization.request':
                        await this.processOptimizationRequest(task.payload);
                        break;
                        
                    default:
                        logger.info('Unhandled event type', { eventType: task.payload.event_type });
                }

                // Mark task as completed
                await this.queue.completeTask(taskId, true);

            } catch (err) {
                logger.error('Decision Assist Worker task failed', { taskId, error: err });
                await this.queue.completeTask(taskId, false, err.message);
            }
        };

        this.analyzeFinancialData = async function(payload) {
            const { revenue, costs, margins, time_period } = payload.data;
            
            logger.info('Analyzing financial data', { timePeriod: time_period });
            
            // analyze-financial-trends
        };
    }
}

// Run worker if called directly
if (require.main === module) {
    const worker = new DecisionAssistWorker();
    process.on('SIGINT', async () => { await worker.stop(); process.exit(0); });
    process.on('SIGTERM', async () => { await worker.stop(); process.exit(0); });
    worker.start().catch(err => { logger.error('Decision Assist Worker failed to start', { error: err }); process.exit(1); });
}

module.exports = DecisionAssistWorker;
