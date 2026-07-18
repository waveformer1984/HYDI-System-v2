const { createClient } = require('@supabase/supabase-js');
const QueueManager = require('./QueueManager');
require('dotenv').config();
const logger = require('../lib/structured-logger').child({ component: 'InventoryMaterialsWorker' });

class InventoryMaterialsWorker {
    constructor(workerId) {
        this.workerId = workerId || `inventory-materials-worker-${Date.now()}`;
        this.running = false;
        this.pollInterval = 30000;
        this.pollTimer = null;
        this.supabase = null;
        this.queue = new QueueManager();
        this.lowStockThresholds = {
            filament_grams: 200,
            components_count: 20,
            material_ml: 100,
            pcb_boards: 5,
            electronic_components: 10
        };
        this.materialConsumption = {
            '3d_print': { filament_pla: 100, isopropyl_alcohol_ml: 10 },
            pcb_fabrication: { pcb_board: 1, solder_paste_ml: 5 },
            cnc_machining: { isopropyl_alcohol_ml: 20 },
            laser_cutting: { isopropyl_alcohol_ml: 15 }
        };
    }

    async initialize() {
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
        if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');
        this.supabase = createClient(supabaseUrl, supabaseKey);
        this.queue.registerWorker('inventory_materials', this.workerId);
        this.queue.updateHeartbeat('idle');
        logger.info('Inventory & Materials Worker initialized', { workerId: this.workerId });
    }

    async start() {
        if (this.running) return;
        await this.initialize();
        this.running = true;
        this.queue.startHeartbeat();
        logger.info('Monitoring inventory');
        this.poll();
    }

    async stop() {
        this.running = false;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        await this.queue.shutdown();
        logger.info('Inventory & Materials Worker stopped');
    }

    poll() {
        if (!this.running) return;
        this.routineCheck()
            .catch(err => logger.error('Error in routine check', { error: err }))
            .finally(() => { this.pollTimer = setTimeout(() => this.poll(), this.pollInterval); });
    }

    async routineCheck() {
        try {
            const inventory = await this.getAllInventory();
            const lowStockItems = this.identifyLowStock(inventory);
            if (lowStockItems.length > 0) {
                await this.triggerLowStockAlerts(lowStockItems);
                await this.triggerProcurementForLowStock(lowStockItems);
            }
            await this.checkForExpiringItems();
            // Update inventory metrics
            await this.updateInventoryMetrics();
        } catch (err) {
            logger.error('Error in routine check', { error: err });
        }
    }

    async triggerProcurement(payload) {
        const { trigger_type, item_types, urgency } = payload.data;
        logger.info('Triggering procurement', { triggerType: trigger_type });
        let procurementList = [];
        if (trigger_type === 'low_stock') {
            procurementList = await this.getLowStockItems(item_types);
        } else if (trigger_type === 'scheduled') {
            procurementList = await this.getScheduledProcurement(item_types);
        } else if (item_types) {
            procurementList = await this.getSpecificProcurementList(item_types);
        } else {
            procurementList = await this.getGeneralProcurementNeeds();
        }
        for (const item of procurementList) {
            await this.createProcurementOrder(item, urgency || 'normal');
        }
        if (procurementList.length > 0) {
            await this.notifyProcurementTriggered(procurementList, urgency);
        }
    }


    // Helper methods
    async getAllInventory() {
        const { data, error } = await this.supabase
            .from('inventory_items')
            .select('*');
            
        if (error) throw error;
        return data || [];
    }

    async getInventoryByType(itemType) {
        const { data, error } = await this.supabase
            .from('inventory_items')
            .select('*')
            .eq('item_type', itemType);
            
        if (error) throw error;
        return data || [];
    }

    async getSpecificInventory(itemIds) {
        const { data, error } = await this.supabase
            .from('inventory_items')
            .select('*')
            .in('item_id', itemIds);
            
        if (error) throw error;
        return data || [];
    }

    identifyLowStock(inventoryData, customThreshold) {
        const threshold = customThreshold || {};
        const lowStockItems = [];
        
        for (const item of inventoryData) {
            let isLow = false;
            
            if (item.item_type.includes('filament') && item.quantity_grams < (threshold.filament_grams || this.lowStockThresholds.filament_grams)) {
                isLow = true;
            } else if (item.item_type.includes('component') && item.quantity_count < (threshold.components_count || this.lowStockThresholds.components_count)) {
                isLow = true;
            } else if (item.item_type.includes('material') && item.quantity_ml < (threshold.material_ml || this.lowStockThresholds.material_ml)) {
                isLow = true;
            } else if (item.item_type.includes('pcb') && item.quantity_count < (threshold.pcb_boards || this.lowStockThresholds.pcb_boards)) {
                isLow = true;
            } else if (item.item_type.includes('electronic') && item.quantity_count < (threshold.electronic_components || this.lowStockThresholds.electronic_components)) {
                isLow = true;
            }
            
            if (isLow) {
                lowStockItems.push(item);
            }
        }
        
        return lowStockItems;
    }

    async triggerLowStockAlerts(lowStockItems) {
        // Group by severity
        const criticalItems = lowStockItems.filter(item => item.quantity <= 0);
        const warningItems = lowStockItems.filter(item => item.quantity > 0);
        
        if (criticalItems.length > 0) {
            await this.queue.enqueue('notification', {
                event_type: 'notification.send',
                data: {
                    recipient: 'inventory-team@theforge.local',
                    template: 'inventory.critical',
                    data: {
                        items: criticalItems,
                        timestamp: new Date().toISOString()
                    }
                }
            }, 10); // Highest priority
        }
        
        if (warningItems.length > 0) {
            await this.queue.enqueue('notification', {
                event_type: 'notification.send',
                data: {
                    recipient: 'inventory-team@theforge.local',
                    template: 'inventory.warning',
                    data: {
                        items: warningItems,
                        timestamp: new Date().toISOString()
                    }
                }
            }, 7); // High priority
        }
    }

    async triggerProcurementForLowStock(lowStockItems) {
        for (const item of lowStockItems) {
            await this.triggerProcurement({
                data: {
                    trigger_type: 'low_stock',
                    item_types: [item.item_type],
                    urgency: item.quantity <= 0 ? 'critical' : 'high'
                }
            });
        }
    }

    async calculateRequiredMaterials(jobType, specifications) {
        const baseConsumption = this.materialConsumption[jobType] || {};
        const required = {};
        
        for (const [materialType, baseAmount] of Object.entries(baseConsumption)) {
            // Apply specifications modifiers
            let amount = baseAmount;
            
            if (specifications.size || specifications.volume) {
                // Scale by size/volume if specified
                const sizeFactor = specifications.size || specifications.volume || 1;
                amount *= sizeFactor;
            }
            
            if (specifications.quantity) {
                // Multiply by quantity if specified
                amount *= specifications.quantity;
            }
            
            required[materialType] = amount;
        }
        
        return required;
    }

    async getAvailableMaterials() {
        const inventory = await this.getAllInventory();
        const available = {};
        
        for (const item of inventory) {
            available[item.item_type] = {
                quantity: item.quantity_count || item.quantity_grams || item.quantity_ml || 0,
                unit: item.quantity_count ? 'count' : item.quantity_grams ? 'grams' : 'ml',
                location: item.location,
                lot_number: item.lot_number
            };
        }
        
        return available;
    }

    checkMaterialsAvailability(required, available) {
        for (const [materialType, requiredAmount] of Object.entries(required)) {
            const availableItem = available[materialType];
            if (!availableItem || availableItem.quantity < requiredAmount) {
                return false;
            }
        }
        return true;
    }

    getMissingMaterials(required, available) {
        const missing = [];
        
        for (const [materialType, requiredAmount] of Object.entries(required)) {
            const availableItem = available[materialType];
            const availableAmount = availableItem ? availableItem.quantity : 0;
            
            if (availableAmount < requiredAmount) {
                missing.push({
                    material_type: materialType,
                    required: requiredAmount,
                    available: availableAmount,
                    shortfall: requiredAmount - availableAmount
                });
            }
        }
        
        return missing;
    }

    async reserveMaterialsInDatabase(requiredMaterials, customerEmail) {
        // Create a reservation record
        await this.supabase
            .from('material_reservations')
            .insert({
                customer_email: customerEmail,
                reserved_materials: requiredMaterials,
                reserved_at: new Date(),
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
                status: 'active'
            });
            
        // Actually deduct from inventory (in real system, this might be separate)
        for (const [materialType, amount] of Object.entries(requiredMaterials)) {
            await this.updateInventoryLevels({
                data: {
                    item_type: materialType,
                    change_amount: amount,
                    operation: 'subtract'
                }
            });
        }
    }

    async getLowStockItems(itemTypes) {
        const inventory = await this.getAllInventory();
        const lowStock = [];
        
        for (const item of inventory) {
            if (!itemTypes || itemTypes.includes(item.item_type)) {
                let isLow = false;
                
                if (item.item_type.includes('filament') && item.quantity_grams < this.lowStockThresholds.filament_grams) {
                    isLow = true;
                } else if (item.item_type.includes('component') && item.quantity_count < this.lowStockThresholds.components_count) {
                    isLow = true;
                } else if (item.item_type.includes('material') && item.quantity_ml < this.lowStockThresholds.material_ml) {
                    isLow = true;
                } else if (item.item_type.includes('pcb') && item.quantity_count < this.lowStockThresholds.pcb_boards) {
                    isLow = true;
                } else if (item.item_type.includes('electronic') && item.quantity_count < this.lowStockThresholds.electronic_components) {
                    isLow = true;
                }
                
                if (isLow) {
                    lowStock.push(item);
                }
            }
        }
        
        return lowStock;
    }

    async getScheduledProcurement(itemTypes) {
        // This would integrate with a procurement schedule
        // For now, return empty - would be implemented based on business needs
        return [];
    }

    async getSpecificProcurementList(itemTypes) {
        const inventory = await this.getAllInventory();
        const procurementList = [];
        
        for (const item of inventory) {
            if (itemTypes.includes(item.item_type)) {
                // Calculate how much to order to reach optimal levels
                const optimalLevel = this.getOptimalLevel(item.item_type);
                const currentLevel = item.quantity_count || item.quantity_grams || item.quantity_ml || 0;
                
                if (currentLevel < optimalLevel) {
                    procurementList.push({
                        ...item,
                        order_quantity: optimalLevel - currentLevel,
                        order_reason: 'restock_to_optimal'
                    });
                }
            }
        }
        
        return procurementList;
    }

    async getGeneralProcurementNeeds() {
        const inventory = await this.getAllInventory();
        const procurementList = [];
        
        for (const item of inventory) {
            const optimalLevel = this.getOptimalLevel(item.item_type);
            const currentLevel = item.quantity_count || item.quantity_grams || item.quantity_ml || 0;
            
            if (currentLevel < optimalLevel) {
                procurementList.push({
                    ...item,
                    order_quantity: optimalLevel - currentLevel,
                    order_reason: 'restock_to_optimal'
                });
            }
        }
        
        return procurementList;
    }

    getOptimalLevel(itemType) {
        // Define optimal stock levels for different item types
        const optimalLevels = {
            'filament_pla': 1000, // grams
            'filament_abs': 1000, // grams
            'filament_petg': 1000, // grams
            'electronic_resistor': 100, // count
            'electronic_capacitor': 100, // count
            'electronic_ic': 50, // count
            'pcb_prototype': 20, // count
            'pcb_production': 50, // count
            'material_solder_paste': 200, // ml
            'material_isopropyl_alcohol': 500, // ml
            'material_thermal_paste': 100, // ml
            'fastener_screw': 200, // count
            'fastener_nut': 200, // count
            'fastener_bolt': 100, // count
        };
        
        return optimalLevels[itemType] || 50; // Default optimal level
    }

    async createProcurementOrder(item, urgency) {
        await this.supabase
            .from('procurement_orders')
            .insert({
                item_id: item.item_id,
                item_type: item.item_type,
                item_name: item.name,
                quantity: item.order_quantity,
                urgency: urgency,
                status: 'pending',
                ordered_at: new Date(),
                expected_delivery: new Date(Date.now() + (urgency === 'critical' ? 24 : urgency === 'high' ? 72 : 168) * 60 * 60 * 1000), // 1, 3, or 7 days
                supplier: item.preferred_supplier || 'default_supplier',
                notes: `Auto-generated: ${item.order_reason}`
            });
            
        logger.info('Created procurement order', { itemName: item.name, quantity: item.order_quantity });
    }

    async notifyProcurementTriggered(procurementList, urgency) {
        await this.queue.enqueue('notification', {
            event_type: 'notification.send',
            data: {
                recipient: 'procurement-team@theforge.local',
                template: 'procurement.triggered',
                data: {
                    items: procurementList,
                    urgency: urgency,
                    triggered_at: new Date().toISOString(),
                    triggered_by: 'inventory_worker'
                }
            }
        }, urgency === 'critical' ? 10 : urgency === 'high' ? 8 : 6);
    }

    async checkForExpiringItems() {
        const { data: expiringItems } = await this.supabase
            .from('inventory_items')
            .select('*')
            .not('warranty_expiry', 'is', null)
            .lt('warranty_expiry', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)) // Expiring in 30 days
            .gte('warranty_expiry', new Date()); // Not already expired
        
        if (expiringItems && expiringItems.length > 0) {
            logger.info('Found items expiring soon', { count: expiringItems.length });
            
            await this.queue.enqueue('notification', {
                event_type: 'notification.send',
                data: {
                    recipient: 'inventory-team@theforge.local',
                    template: 'inventory.expiring',
                    data: {
                        items: expiringItems,
                        timestamp: new Date().toISOString()
                    }
                }
            }, 5); // Medium priority
        }
    }

    async updateInventoryMetrics() {
        const inventory = await this.getAllInventory();
        
        // Calculate metrics
        const totalItems = inventory.length;
        const lowStockCount = this.identifyLowStock(inventory).length;
        const outOfStockCount = inventory.filter(item => 
            (item.quantity_count || item.quantity_grams || item.quantity_ml || 0) <= 0
        ).length;
        
        const metrics = {
            total_inventory_items: totalItems,
            low_stock_items: lowStockCount,
            out_of_stock_items: outOfStockCount,
            inventory_value_estimate: this.calculateInventoryValue(inventory),
            last_updated: new Date().toISOString()
        };
        
        // Store metrics
        await this.supabase
            .from('inventory_metrics')
            .upsert({
                worker_id: this.workerId,
                ...metrics
            }, {
                onConflict: 'worker_id'
            });
    }

    calculateInventoryValue(inventory) {
        // Simplified inventory valuation
        // In reality, this would use actual unit costs
        let totalValue = 0;
        
        for (const item of inventory) {
            const quantity = item.quantity_count || item.quantity_grams || item.quantity_ml || 0;
            // Assume average unit cost - would be stored in item record in real system
            const estimatedUnitCost = 1.0; // $1 per unit as placeholder
            totalValue += quantity * estimatedUnitCost;
        }
        
        return totalValue;
    }
}

// Run worker if called directly
if (require.main === module) {
    const worker = new InventoryMaterialsWorker();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        logger.info('Inventory & Materials Worker shutting down');
        await worker.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        logger.info('Inventory & Materials Worker shutting down');
        await worker.stop();
        process.exit(0);
    });

    // Start worker
    worker.start().catch(err => {
        logger.error('Inventory & Materials Worker failed to start', { error: err });
        process.exit(1);
    });
}

module.exports = InventoryMaterialsWorker;