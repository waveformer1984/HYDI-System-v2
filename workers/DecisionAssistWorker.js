const { createClient } = require('@supabase/supabase-js');
const QueueManager = require('./QueueManager');
require('dotenv').config();

function DecisionAssistWorker(workerId) {
    this.workerId = workerId;
    this.running = false;
    this.pollInterval = 5000;
    this.pollTimer = null;
    this.supabase = null;
    this.queue = new QueueManager();

    this.decisionThresholds = {
        'financial_planning': {
            min_data_points: 10,
            confidence_threshold: 0.7,
            factors: ['revenue_trend', 'cost_efficiency', 'cash_flow', 'growth_rate']
        },
        'resource_allocation': {
            min_data_points: 8,
            confidence_threshold: 0.65,
            factors: ['utilization_rate', 'cost_per_unit', 'demand_forecast', 'capacity']
        },
        'risk_assessment': {
            min_data_points: 20,
            confidence_threshold: 0.8,
            factors: ['volatility', 'exposure', 'mitigation_options', 'historical_incidents']
        },
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

        console.log(`[\u{1F9E0} Decision Assist Worker] Initialized: ${this.workerId}`);
    };

    this.start = async function() {
        if (this.running) {
            console.log('[\u{1F9E0} Decision Assist Worker] Already running');
            return;
        }

        await this.initialize();
        this.running = true;
        this.queue.startHeartbeat();

        console.log('[\u{1F9E0} Decision Assist Worker] Starting to analyze data and provide recommendations...');

        // Start polling
        this.poll();
    };

    this.stop = async function() {
        this.running = false;

        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
        }

        await this.queue.shutdown();
        console.log('[\u{1F9E0} Decision Assist Worker] Stopped');
    };

    this.poll = function() {
        if (!this.running) return;

        this.processNextTask()
            .catch(err => {
                console.error('[\u{1F9E0} Decision Assist Worker] Error in poll:', err);
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
                console.error(`[\u{1F9E0} Decision Assist Worker] Task not found: ${taskId}`);
                return;
            }

            console.log(`[\u{1F9E0} Decision Assist Worker] Processing task: ${task.payload.event_type}`);

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
                    console.log(`[\u{1F9E0} Decision Assist Worker] Unhandled event type: ${task.payload.event_type}`);
            }

            // Mark task as completed
            await this.queue.completeTask(taskId, true);

        } catch (err) {
            console.error(`[\u{1F9E0} Decision Assist Worker] Task failed: ${taskId}`, err);
            await this.queue.completeTask(taskId, false, err.message);
        }
    };

    this.analyzeFinancialData = async function(payload) {
        const { revenue, costs, margins, time_period } = payload.data || {};
        console.log(`[\u{1F9E0} Decision Assist] Analyzing financial data for ${time_period}`);
        const threshold = this.decisionThresholds['financial_planning'];
        if (!revenue || revenue.length < threshold.min_data_points) {
            console.log('[\u{1F9E0} Decision Assist] Insufficient data points for financial analysis');
            return;
        }
        await this.supabase.from('decision_insights').insert({
            worker_id: this.workerId,
            insight_type: 'financial_trend',
            payload: { revenue, costs, margins, time_period },
            created_at: new Date().toISOString()
        }).catch(err => console.warn('[\u{1F9E0} Decision Assist] Could not store insight:', err.message));
    };

    this.analyzeSystemLoad = async function(payload) {
        const { cpu, memory, active_jobs } = payload.data || {};
        console.log(`[\u{1F9E0} Decision Assist] Analyzing system load: cpu=${cpu} mem=${memory} jobs=${active_jobs}`);
        const threshold = this.decisionThresholds['system_optimization'];
        if (cpu > 80 || memory > 85) {
            console.warn('[\u{1F9E0} Decision Assist] High resource usage — recommend scaling up');
        }
    };

    this.analyzeBehaviorData = async function(payload) {
        console.log('[\u{1F9E0} Decision Assist] Analyzing behavior data');
        const threshold = this.decisionThresholds['risk_assessment'];
        const data = payload.data || {};
        if (Object.keys(data).length < threshold.min_data_points) {
            console.log('[\u{1F9E0} Decision Assist] Insufficient behavior data points');
        }
    };

    this.processDecisionRequest = async function(payload) {
        const { decision_type, context } = payload.data || {};
        console.log(`[\u{1F9E0} Decision Assist] Processing decision request: ${decision_type}`);
        const threshold = this.decisionThresholds[decision_type] || this.decisionThresholds['system_optimization'];
        await this.supabase.from('decision_log').insert({
            worker_id: this.workerId,
            decision_type,
            context,
            threshold_config: threshold,
            created_at: new Date().toISOString()
        }).catch(err => console.warn('[\u{1F9E0} Decision Assist] Could not log decision:', err.message));
    };

    this.processOptimizationRequest = async function(payload) {
        const { target, current_metrics } = payload.data || {};
        console.log(`[\u{1F9E0} Decision Assist] Processing optimization request for: ${target}`);
        const threshold = this.decisionThresholds['system_optimization'];
        if (current_metrics) {
            const factorsMet = threshold.factors.filter(f => f in current_metrics).length;
            console.log(`[\u{1F9E0} Decision Assist] Optimization factors available: ${factorsMet}/${threshold.factors.length}`);
        }
    };
}

module.exports = DecisionAssistWorker;
