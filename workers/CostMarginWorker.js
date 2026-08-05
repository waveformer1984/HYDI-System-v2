const { createClient } = require('@supabase/supabase-js');
const QueueManager = require('./QueueManager');
require('dotenv').config();
const logger = require('../lib/structured-logger').child({ component: 'CostMarginWorker' });
const { resolvePeriodStart, HOURS_PER_DAY } = require('./time-period');

class CostMarginWorker {
    constructor(workerId) {
        this.workerId = workerId || `cost-margin-worker-${Date.now()}`;
        this.running = false;
        this.pollInterval = 5000;
        this.pollTimer = null;
        this.supabase = null;
        this.queue = new QueueManager();
        this.costRates = {
            labor: { fabrication: 45, assembly: 35, design: 60, testing: 40 },
            machine: { '3d_printer': 2.5, cnc: 15, laser: 8, pcb_mill: 12 },
            material: { filament_pla: 0.025, filament_abs: 0.03, solder_paste: 0.5, isopropyl_alcohol: 0.01 }
        };

        this.initialize = function() {
            const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');
            this.supabase = createClient(supabaseUrl, supabaseKey);
            this.queue.registerWorker('cost_margin', this.workerId);
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
            const taskId = await this.queue.dequeue('cost_margin');
            if (!taskId) return;
            try {
                const task = await this.queue.getTask(taskId);
                if (!task) return;
                switch (task.payload.event_type) {
                    case 'analytics.generate': await this.generateCostAnalytics(task.payload); break;
                    default: throw new Error(`Unhandled event type: ${task.payload.event_type}`);
                }
                await this.queue.completeTask(taskId, true);
            } catch (err) {
                await this.queue.completeTask(taskId, false, err.message);
            }
        };

        this.generateCostAnalytics = async function(payload) {
            const { time_period, include_details } = payload.data || {};
            logger.info('Generating cost analytics', { timePeriod: time_period });
            // Honour the requested period. This previously always queried a
            // fixed 30 days while still labelling the stored `cost_analytics`
            // row with `time_period`, so a request for a week returned a
            // month of revenue and cost filed under 'week'. Unrecognised or
            // absent values keep the original 30-day behaviour.
            const since = resolvePeriodStart(time_period, { fallbackHours: 30 * HOURS_PER_DAY }).toISOString();
            const { data: jobCosts } = await this.supabase.from('job_costs').select('*').gte('created_at', since);
            const { data: revenueTransactions } = await this.supabase.from('transactions').select('*').gte('created_at', since);
            const totalRevenue = (revenueTransactions || []).reduce((s,t) => s + (parseFloat(t.amount)||0), 0);
            const totalCost = (jobCosts || []).reduce((s,j) => s + (parseFloat(j.total_cost)||0), 0);
            const totalProfit = totalRevenue - totalCost;
            const marginPercentage = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
            const analytics = { time_period, total_revenue: totalRevenue, total_cost: totalCost, total_profit: totalProfit, margin_percentage: marginPercentage, generated_at: new Date().toISOString() };
            // Store analytics and return if details requested
            await this.supabase
                .from('cost_analytics')
                .insert(analytics);
            
            logger.info('Analytics generated', {
                totalRevenue: Number(totalRevenue.toFixed(2)),
                totalCost: Number(totalCost.toFixed(2)),
                totalProfit: Number(totalProfit.toFixed(2)),
                marginPercentage: Number(marginPercentage.toFixed(1))
            });
            
            if (include_details) {
                // Return detailed breakdown
                return {
                    ...analytics,
                    job_details: jobCosts,
                    revenue_details: revenueTransactions
                };
            }
        };

        // helper-methods-definitions

        this.getAverageLaborRate = function(job_type) {
            // Return average labor rate for job type
            // In reality, this would be more sophisticated
            const laborRates = Object.values(this.costRates.labor);
            return laborRates.reduce((sum, rate) => sum + rate, 0) / laborRates.length;
        };

        this.getAverageMachineRate = function(job_type) {
            // Return average machine rate for job type
            const machineRates = Object.values(this.costRates.machine);
            return machineRates.reduce((sum, rate) => sum + rate, 0) / machineRates.length;
        };

        this.getMaterialCost = function(materialType) {
            return this.costRates.material[materialType] || 0;
        };

        this.estimateMaterialsForJob = function(job_type, specifications) {
            // Estimate materials needed based on job type and specifications
            // This would be much more sophisticated in a real system
            const baseEstimates = {
                '3d_print': {
                    filament_grams: (specifications.size || 100) * 2, // 2g per mm of size
                    support_material_grams: (specifications.size || 100) * 0.5
                },
                'pcb_fabrication': {
                    pcb_board: specifications.quantity || 1,
                    electronic_component: (specifications.complexity || 2) * 10,
                    solder_paste_ml: (specifications.area || 50) * 0.1
                },
                'cnc_machining': {
                    isopropyl_alcohol_ml: (specifications.duration || 1) * 10, // 10ml per hour
                    screw: (specifications.parts || 5) * 4,
                    nut: (specifications.parts || 5) * 4
                },
                'laser_cutting': {
                    solder_paste_ml: (specifications.duration || 1) * 5, // 5ml per hour
                    isopropyl_alcohol_ml: (specifications.duration || 1) * 15 // 15ml per hour
                },
                'robotics_assembly': {
                    electronic_component: (specifications.complexity || 3) * 20,
                    screw: (specifications.joints || 10) * 2,
                    nut: (specifications.joints || 10) * 2,
                    isopropyl_alcohol_ml: (specifications.assembly_time || 1) * 10
                },
                'custom_hardware_build': {
                    pcb_board: 2,
                    electronic_component: 50,
                    screw: 100,
                    nut: 100,
                    isopropyl_alcohol_ml: 50,
                    thermal_paste_ml: 10
                },
                'prototype_fabrication': {
                    filament_grams: 200,
                    pcb_board: 1,
                    electronic_component: 30,
                    screw: 50,
                    nut: 50,
                    isopropyl_alcohol_ml: 30
                }
            };
            
            return baseEstimates[job_type] || {};
        };
    }
}

// Run worker if called directly
if (require.main === module) {
    const worker = new CostMarginWorker();
    
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

module.exports = CostMarginWorker;