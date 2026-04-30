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

        #helper-methods-definitions

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