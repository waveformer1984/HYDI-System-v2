/**
 * Cost & Margin Worker
 * Tracks job costs, calculates profit margins, and generates cost analytics.
 *
 * Queue-driven
 * Cost rate management
 * Margin analysis and reporting
 */

'use strict';

const QueueManager = require('./QueueManager');
const { createClient } = require('@supabase/supabase-js');

class CostMarginWorker {
    constructor(workerId = null) {
        this.workerId = workerId || `cost-margin-worker-${Date.now()}`;
        this.queue = new QueueManager();
        this.supabase = null;
        this.running = false;
        this.pollInterval = 10000; // 10 seconds
        this.pollTimer = null;

        this.costRates = {
            labor: {
                standard: 25.00,   // $/hour
                skilled: 45.00,    // $/hour
                specialist: 75.00  // $/hour
            },
            machine: {
                '3d_printer': 5.00,      // $/hour
                'cnc_machine': 20.00,    // $/hour
                'laser_cutter': 15.00,   // $/hour
                'pcb_mill': 10.00,       // $/hour
                'robotics_arm': 12.00    // $/hour
            },
            material: {
                'filament_grams': 0.03,       // $/gram
                'pcb_board': 2.50,            // $/board
                'electronic_component': 0.10, // $/component
                'solder_paste_ml': 0.05,      // $/ml
                'isopropyl_alcohol_ml': 0.002,// $/ml
                'thermal_paste_ml': 0.08,     // $/ml
                'screw': 0.02,                // $/screw
                'nut': 0.01                   // $/nut
            },
            overhead: {
                percentage: 0.15 // 15% overhead
            }
        };

        this.initialize = async function() {
            const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');
            this.supabase = createClient(supabaseUrl, supabaseKey);
            await this.queue.registerWorker('cost_margin', this.workerId);
            await this.queue.updateHeartbeat('idle');
            console.log(`[💸 Cost & Margin Worker] Initialized: ${this.workerId}`);
        };

        this.start = async function() {
            if (this.running) {
                console.log('[💸 Cost & Margin Worker] Already running');
                return;
            }
            await this.initialize();
            this.running = true;
            this.queue.startHeartbeat();
            console.log('[💸 Cost & Margin Worker] Starting cost and margin analysis...');
            this.poll();
        };

        this.stop = async function() {
            this.running = false;
            if (this.pollTimer) clearTimeout(this.pollTimer);
            await this.queue.shutdown();
            console.log('[💸 Cost & Margin Worker] Stopped');
        };

        this.poll = function() {
            if (!this.running) return;
            this.processNextTask()
                .catch(err => {
                    console.error('[💸 Cost & Margin Worker] Error in poll:', err);
                })
                .finally(() => {
                    this.pollTimer = setTimeout(() => this.poll(), this.pollInterval);
                });
        };

        this.processNextTask = async function() {
            const taskId = await this.queue.dequeue('cost_margin');
            if (!taskId) return;
            try {
                const task = await this.queue.getTask(taskId);
                if (!task) {
                    console.error(`[💸 Cost & Margin Worker] Task not found: ${taskId}`);
                    return;
                }
                console.log(`[💸 Cost & Margin Worker] Processing task: ${task.payload.event_type}`);
                switch (task.payload.event_type) {
                    case 'job.completed':
                        await this.trackJobCost(task.payload);
                        break;
                    case 'revenue.received':
                        await this.trackRevenue(task.payload);
                        break;
                    case 'analytics.request':
                        await this.generateCostAnalytics(task.payload);
                        break;
                    case 'margin.check':
                        await this.checkMarginThresholds(task.payload);
                        break;
                    default:
                        console.log(`[💸 Cost & Margin Worker] Unhandled event type: ${task.payload.event_type}`);
                }
                await this.queue.completeTask(taskId, true);
            } catch (err) {
                console.error(`[💸 Cost & Margin Worker] Task failed: ${taskId}`, err);
                await this.queue.completeTask(taskId, false, err.message);
            }
        };

        this.trackJobCost = async function(payload) {
            const { job_id, job_type, duration_hours, materials_used, labor_type } = payload.data;
            console.log(`[💸 Cost & Margin] Tracking cost for job ${job_id}`);
            const laborRate = this.costRates.labor[labor_type || 'standard'];
            const machineRate = this.costRates.machine[job_type] || 0;
            const laborCost = laborRate * (duration_hours || 0);
            const machineCost = machineRate * (duration_hours || 0);
            let materialCost = 0;
            if (materials_used) {
                for (const [material, qty] of Object.entries(materials_used)) {
                    materialCost += (this.costRates.material[material] || 0) * qty;
                }
            }
            const subtotal = laborCost + machineCost + materialCost;
            const overhead = subtotal * this.costRates.overhead.percentage;
            const totalCost = subtotal + overhead;
            await this.supabase.from('job_costs').insert({
                job_id, job_type, labor_cost: laborCost,
                machine_cost: machineCost, material_cost: materialCost,
                overhead_cost: overhead, total_cost: totalCost,
                recorded_at: new Date(), worker_id: this.workerId
            });
            console.log(`[💸 Cost & Margin] Job ${job_id} cost: $${totalCost.toFixed(2)}`);
        };

        this.trackRevenue = async function(payload) {
            const { transaction_id, amount, job_id, customer_email } = payload.data;
            console.log(`[💸 Cost & Margin] Tracking revenue for transaction ${transaction_id}`);
            await this.supabase.from('revenue_transactions').insert({
                transaction_id, amount, job_id, customer_email,
                recorded_at: new Date(), worker_id: this.workerId
            });
            console.log(`[💸 Cost & Margin] Revenue tracked: $${amount} for transaction ${transaction_id}`);
        };

        this.checkMarginThresholds = async function(payload) {
            const { job_type, time_period } = payload.data;
            console.log(`[💸 Cost & Margin] Checking margin thresholds for ${job_type}`);
        };

        this.generateCostAnalytics = async function(payload) {
            const { time_period, job_type, include_details } = payload.data;
            console.log(`[💸 Cost & Margin] Generating cost analytics for ${time_period}`);

            let startDate = new Date();
            if (time_period === 'today') {
                startDate.setHours(0, 0, 0, 0);
            } else if (time_period === 'week') {
                startDate.setDate(startDate.getDate() - 7);
            } else if (time_period === 'month') {
                startDate.setMonth(startDate.getMonth() - 1);
            } else {
                startDate.setDate(startDate.getDate() - 30);
            }

            const { data: jobCosts } = await this.supabase
                .from('job_costs')
                .select('*')
                .gte('recorded_at', startDate.toISOString());

            const { data: revenueTransactions } = await this.supabase
                .from('revenue_transactions')
                .select('*')
                .gte('recorded_at', startDate.toISOString());

            const totalCost = (jobCosts || []).reduce((sum, j) => sum + (j.total_cost || 0), 0);
            const totalRevenue = (revenueTransactions || []).reduce((sum, r) => sum + (r.amount || 0), 0);
            const totalProfit = totalRevenue - totalCost;
            const marginPercentage = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

            const analytics = {
                time_period,
                job_type: job_type || 'all',
                total_revenue: totalRevenue,
                total_cost: totalCost,
                total_profit: totalProfit,
                margin_percentage: marginPercentage,
                generated_at: new Date().toISOString(),
                worker_id: this.workerId
            };

            // Store analytics and return if details requested
            await this.supabase
                .from('cost_analytics')
                .insert(analytics);
            
            console.log(`[💸 Cost & Margin] Analytics generated: $${totalRevenue.toFixed(2)} revenue, $${totalCost.toFixed(2)} cost, $${totalProfit.toFixed(2)} profit (${marginPercentage.toFixed(1)}% margin)`);
            
            if (include_details) {
                // Return detailed breakdown
                return {
                    ...analytics,
                    job_details: jobCosts,
                    revenue_details: revenueTransactions
                };
            }
        };

        // #helper-methods-definitions

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
        console.log('\n[💸 Cost & Margin Worker] Shutting down...');
        await worker.stop();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        console.log('\n[💸 Cost & Margin Worker] Shutting down...');
        await worker.stop();
        process.exit(0);
    });
    
    // Start worker
    worker.start().catch(err => {
        console.error('[💸 Cost & Margin Worker] Failed to start:', err);
        process.exit(1);
    });
}

module.exports = CostMarginWorker;