import { BaseAgent } from '../base.agent';

export class ProcurementAgent extends BaseAgent {
  constructor() {
    super('procurement.agent', ['procurement', 'supply_chain', 'vendor_management']);
  }

  async handle_event(event: any): Promise<void> {
    console.log(`[Procurement Agent] Handling event: ${event.type}`);

    switch (event.type) {
      case 'SUPPLY_ISSUE':
        await this.handleSupplyIssue(event);
        break;
      case 'MATERIAL_SHORTAGE':
        await this.handleMaterialShortage(event);
        break;
      case 'BUILD_READY':
        await this.handleBuildReady(event);
        break;
      case 'FABRICATION_COMPLETE':
        await this.handleFabricationComplete(event);
        break;
      case 'BUDGET_APPROVED_FOR_PURCHASE':
        await this.handleBudgetApprovedForPurchase(event);
        break;
      default:
        console.log(`[Procurement Agent] Unhandled event type: ${event.type}`);
    }
  }

  private async handleSupplyIssue(event: any): Promise<void> {
    console.log('[Procurement Agent] Processing supply issue');
    
    // Analyze the supply issue
    const issueAnalysis = this.analyzeSupplyIssue(event.payload);
    
    // Find alternative suppliers or solutions
    const solutions = this.findAlternativeSolutions(issueAnalysis);
    
    // Emit procurement actions
    this.emit_event('PROCUREMENT_ACTION_REQUIRED', {
      issue_id: event.payload.issue_id,
      analysis: issueAnalysis,
      solutions: solutions,
      recommended_action: solutions.length > 0 ? solutions[0] : 'escalate_to_manual_review',
      urgency: issueAnalysis.severity,
      timestamp: new Date().toISOString()
    }, 'broadcast', issueAnalysis.severity);
  }

  private async handleMaterialShortage(event: any): Promise<void> {
    console.log('[Procurement Agent] Processing material shortage');
    
    // Check inventory and alternatives
    const shortageAnalysis = this.analyzeMaterialShortage(event.payload);
    
    // If we can procure alternatives, do so
    if (shortageAnalysis.alternatives_available) {
      await this.initiateProcurement(shortageAnalysis.recommended_alternative);
      
      this.emit_event('MATERIALS_PROCURED', {
        shortage_id: event.payload.shortage_id,
        material: shortageAnalysis.recommended_alternative.material,
        quantity: shortageAnalysis.recommended_alternative.quantity,
        supplier: shortageAnalysis.recommended_alternative.supplier,
        expected_delivery: shortageAnalysis.recommended_alternative.expected_delivery,
        procured_by: this.id,
        timestamp: new Date().toISOString()
      }, 'broadcast', 'medium');
    } else {
      // No alternatives, escalate
      this.emit_event('MATERIAL_SHORTAGE_ESCALATED', {
        shortage_id: event.payload.shortage_id,
        material: event.payload.material,
        quantity_needed: event.payload.quantity,
        urgency: 'critical',
        timestamp: new Date().toISOString()
      }, 'broadcast', 'critical');
    }
  }

  private async handleBuildReady(event: any): Promise<void> {
    console.log('[Procurement Agent] Processing build ready event');
    
    // Calculate materials needed for the build
    const materialsNeeded = this.calculateMaterialsNeeded(event.payload);
    
    // Check what's in inventory vs what needs to be procured
    const procurementPlan = this.createProcurementPlan(materialsNeeded);
    
    // Emit procurement requests
    this.emit_event('MATERIALS_NEEDED', {
      build_id: event.payload.build_id,
      materials_needed: procurementPlan.materials_to_procure,
      inventory_available: procurementPlan.inventory_available,
      total_estimated_cost: procurementPlan.total_estimated_cost,
      timestamp: new Date().toISOString()
    }, 'finance.agent', 'high'); // Send to finance for budget check
  }

  private async handleFabricationComplete(event: any): Promise<void> {
    console.log('[Procurement Agent] Processing fabrication complete');
    
    // Update inventory with fabricated parts
    this.updateInventory(event.payload.fabricated_parts);
    
    // Check if this resolves any pending material shortages
    this.checkForResolvedShortages();
    
    // Emit inventory update
    this.emit_event('INVENTORY_UPDATED', {
      parts_added: event.payload.fabricated_parts,
      updated_by: this.id,
      timestamp: new Date().toISOString()
    }, 'broadcast', 'low');
  }

  private async handleBudgetApprovedForPurchase(event: any): Promise<void> {
    console.log('[Procurement Agent] Processing budget approved for purchase');
    
    // Execute the purchase
    const purchaseResult = await this.executePurchase(event.payload.purchase_request);
    
    // Emit purchase result
    this.emit_event('PURCHASE_COMPLETED', {
      purchase_id: event.payload.purchase_request.id,
      supplier: purchaseResult.supplier,
      total_cost: purchaseResult.total_cost,
      expected_delivery: purchaseResult.expected_delivery,
      purchase_result: purchaseResult.status,
      purchased_by: this.id,
      timestamp: new Date().toISOString()
    }, 'broadcast', 'medium');
  }

  private analyzeSupplyIssue(payload: any): any {
    // Simplified supply issue analysis
    return {
      issue_id: payload.issue_id || `issue_${Date.now()}`,
      type: payload.type || 'unknown',
      severity: payload.urgency || 'medium',
      description: payload.description || 'Supply chain issue detected',
      affected_materials: payload.affected_materials || [],
      impact_assessment: 'moderate' // Simplified
    };
  }

  private findAlternativeSolutions(analysis: any): any[] {
    // Simplified alternative solutions
    return [
      {
        type: 'alternative_supplier',
        description: 'Source from alternative supplier',
        estimated_cost: analysis.affected_materials.length * 100,
        lead_time_days: 7
      },
      {
        type: 'material_substitution',
        description: 'Substitute with equivalent material',
        estimated_cost: analysis.affected_materials.length * 80,
        lead_time_days: 3
      }
    ];
  }

  private analyzeMaterialShortage(payload: any): any {
    // Simplified material shortage analysis
    return {
      shortage_id: payload.shortage_id || `shortage_${Date.now()}`,
      material: payload.material,
      quantity_needed: payload.quantity,
      quantity_available: payload.quantity_available || 0,
      alternatives_available: true, // Simplified
      recommended_alternative: {
        material: payload.material, // In reality, this might be a different material
        quantity: payload.quantity,
        supplier: 'Preferred Supplier Co.',
        expected_delivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 1 week
      }
    };
  }

  private calculateMaterialsNeeded(buildSpec: any): any {
    // Simplified materials calculation
    return {
      steel_tons: buildSpec.square_feet * 0.05,
      concrete_cubic_yards: buildSpec.square_feet * 0.2,
      glass_square_feet: buildSpec.square_feet * 0.3,
      wiring_feet: buildSpec.square_feet * 10,
      plumbing_feet: buildSpec.square_feet * 5
    };
  }

  private createProcurementPlan(materialsNeeded: any): any {
    // Simplified procurement plan
    const materialsToProcure: any[] = [];
    const inventoryAvailable: Record<string, any> = {};
    
    // Check each material against inventory (simplified)
    for (const [material, quantity] of Object.entries(materialsNeeded)) {
      // Simulate inventory check
      const inInventory = Math.random() > 0.7; // 30% chance we have it in inventory
      
      if (inInventory) {
        inventoryAvailable[material] = quantity;
      } else {
        materialsToProcure.push({
          material: material,
          quantity: quantity,
          estimated_unit_cost: this.getEstimatedUnitCost(material),
          supplier: 'TBD'
        });
      }
    }
    
    // Calculate total estimated cost
    const totalEstimatedCost = materialsToProcure.reduce((total, item) => {
      return total + (item.quantity * item.estimated_unit_cost);
    }, 0);
    
    return {
      materials_to_procure: materialsToProcure,
      inventory_available: inventoryAvailable,
      total_estimated_cost: totalEstimatedCost
    };
  }

  private getEstimatedUnitCost(material: string): number {
    // Simplified unit costs
    const costs: Record<string, number> = {
      'steel_tons': 800,
      'concrete_cubic_yards': 120,
      'glass_square_feet': 25,
      'wiring_feet': 2,
      'plumbing_feet': 5
    };
    
    return costs[material] || 100;
  }

  private async initiateProcurement(alternative: any): Promise<void> {
    console.log(`[Procurement Agent] Initiating procurement for ${alternative.material}`);
    
    // In real system, this would create purchase orders, contact suppliers, etc.
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate work
    
    console.log(`[Procurement Agent] Procurement initiated for ${alternative.quantity} ${alternative.material}`);
  }

  private updateInventory(parts: any[]): void {
    console.log(`[Procurement Agent] Updating inventory with ${parts.length} fabricated parts`);
    // In real system, this would update database/inventory management system
  }

  private checkForResolvedShortages(): void {
    console.log('[Procurement Agent] Checking for resolved material shortages');
    // In real system, this would check pending shortages against updated inventory
  }

  private async executePurchase(purchaseRequest: any): Promise<any> {
    console.log(`[Procurement Agent] Executing purchase: ${purchaseRequest.id}`);
    
    // In real system, this would interact with purchasing systems/suppliers
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate work
    
    return {
      supplier: purchaseRequest.preferred_supplier || 'Default Supplier',
      total_cost: purchaseRequest.total_estimated_cost * 1.05, // Add 5% for taxes/fees
      expected_delivery: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days
      status: 'completed'
    };
  }
}