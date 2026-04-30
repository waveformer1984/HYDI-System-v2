import { BaseAgent } from '../base.agent';

export class ConstructionAgent extends BaseAgent {
  constructor() {
    super('construction.agent', ['construction', 'build_coordination', 'scheduling']);
  }

  async handle_event(event: any): Promise<void> {
    console.log(`[Construction Agent] Handling event: ${event.type}`);

    switch (event.type) {
      case 'DESIGN_READY':
        await this.handleDesignReady(event);
        break;
      case 'MATERIALS_NEEDED':
        await this.handleMaterialsNeeded(event);
        break;
      case 'MATERIALS_PROCURED':
        await this.handleMaterialsProcured(event);
        break;
      case 'FABRICATION_COMPLETE':
        await this.handleFabricationComplete(event);
        break;
      case 'BUILD_PHASE_COMPLETE':
        await this.handleBuildPhaseComplete(event);
        break;
      case 'WORKFLOW_OPTIMIZATION_SUGGESTED':
        await this.handleWorkflowOptimizationSuggested(event);
        break;
      default:
        console.log(`[Construction Agent] Unhandled event type: ${event.type}`);
    }
  }

  private async handleDesignReady(event: any): Promise<void> {
    console.log('[Construction Agent] Processing design ready event');
    
    // Create construction plan from design
    const constructionPlan = this.createConstructionPlan(event.payload);
    
    // Emit that we're ready to begin procurement
    this.emit_event('BUILD_READY', {
      design_id: event.payload.design_id,
      construction_plan: constructionPlan,
      estimated_start_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week from now
      estimated_duration_days: constructionPlan.total_estimated_days,
      created_by: this.id,
      timestamp: new Date().toISOString()
    }, 'procurement.agent', 'high');
  }

  private async handleMaterialsNeeded(event: any): Promise<void> {
    console.log('[Construction Agent] Processing materials needed event');
    
    // Check if we have the materials or need to wait for procurement
    const materialsStatus = this.checkMaterialsAvailability(event.payload);
    
    if (materialsStatus.all_available) {
      // All materials available, can start build
      this.emit_event('BUILD_CAN_START', {
        build_id: event.payload.build_id,
        materials_available: true,
        ready_timestamp: new Date().toISOString()
      }, 'broadcast', 'medium');
    } else {
      // Wait for materials, but let procurement know we need them
      console.log(`[Construction Agent] Waiting for materials: ${JSON.stringify(event.payload.materials_needed)}`);
      // In a real system, we might set up a listener or wait for MATERIALS_PROCURED event
    }
  }

  private async handleMaterialsProcured(event: any): Promise<void> {
    console.log('[Construction Agent] Processing materials procured event');
    
    // Check if these materials satisfy our needs
    const materialsSatisfy = this.checkIfMaterialsSatisfyBuild(event.payload);
    
    if (materialsSatisfy) {
      // We can start or continue the build
      this.emit_event('BUILD_CAN_START_OR_CONTINUE', {
        build_id: event.payload.build_id || 'unknown',
        materials_received: true,
        ready_timestamp: new Date().toISOString()
      }, 'broadcast', 'medium');
    } else {
      // Still missing some materials
      console.log('[Construction Agent] Still waiting for additional materials');
    }
  }

  private async handleFabricationComplete(event: any): Promise<void> {
    console.log('[Construction Agent] Processing fabrication complete event');
    
    // Check if fabricated parts are needed for current build
    const partsNeeded = this.checkIfFabricatedPartsAreNeeded(event.payload);
    
    if (partsNeeded) {
      // Update build progress with fabricated parts
      this.emit_event('FABRICATED_PARTS_RECEIVED', {
        build_id: event.payload.build_id || 'unknown',
        parts_received: event.payload.fabricated_parts,
        received_by: this.id,
        timestamp: new Date().toISOString()
      }, 'broadcast', 'medium');
    }
  }

  private async handleBuildPhaseComplete(event: any): Promise<void> {
    console.log('[Construction Agent] Processing build phase complete event');
    
    // Update build progress
    const buildProgress = this.updateBuildProgress(event.payload);
    
    // Check if build is complete
    if (buildProgress.is_complete) {
      this.emit_event('BUILD_COMPLETE', {
        build_id: event.payload.build_id,
        completion_timestamp: new Date().toISOString(),
        final_cost: buildProgress.actual_cost,
        timeline_variance_days: buildProgress.timeline_variance,
        completed_by: this.id,
        timestamp: new Date().toISOString()
      }, 'broadcast', 'high');
    } else {
      // Build not complete, emit next phase
      this.emit_event('NEXT_BUILD_PHASE_READY', {
        build_id: event.payload.build_id,
        current_phase: buildProgress.current_phase,
        next_phase: buildProgress.next_phase,
        estimated_start: buildProgress.next_phase_estimated_start,
        estimated_duration: buildProgress.next_phase_estimated_duration
      }, 'broadcast', 'medium');
    }
  }

  private async handleWorkflowOptimizationSuggested(event: any): Promise<void> {
    console.log('[Construction Agent] Processing workflow optimization suggestion');
    
    // Evaluate the optimization suggestion
    const evaluation = this.evaluateWorkflowOptimization(event.payload);
    
    if (evaluation.worth_implementing) {
      // Implement the optimization
      await this.implementWorkflowOptimization(event.payload.optimization);
      
      this.emit_event('WORKFLOW_OPTIMIZATION_APPLIED', {
        optimization_id: event.payload.optimization_id,
        applied_by: this.id,
        improvement_estimate: evaluation.improvement_estimate,
        timestamp: new Date().toISOString()
      }, 'broadcast', 'medium');
    } else {
      console.log(`[Construction Agent] Optimization ${event.payload.optimization_id} not worth implementing`);
    }
  }

  private createConstructionPlan(design: any): any {
    // Simplified construction plan creation
    return {
      phases: [
        {
          name: 'foundation',
          estimated_days: 10,
          dependencies: [],
          resources_needed: ['concrete_cubic_yards', 'steel_tons']
        },
        {
          name: 'framing',
          estimated_days: 15,
          dependencies: ['foundation'],
          resources_needed: ['steel_tons', 'wiring_feet', 'plumbing_feet']
        },
        {
          name: 'enclosure',
          estimated_days: 12,
          dependencies: ['framing'],
          resources_needed: ['glass_square_feet', 'wiring_feet']
        },
        {
          name: 'interiors',
          estimated_days: 20,
          dependencies: ['enclosure'],
          resources_needed: ['wiring_feet', 'plumbing_feet']
        }
      ],
      total_estimated_days: 57,
      critical_path: ['foundation', 'framing', 'enclosure', 'interiors']
    };
  }

  private checkMaterialsAvailability(payload: any): any {
    // Simplified materials availability check
    // In reality, this would check against inventory/procurement status
    const materialsNeeded = payload.materials_needed || [];
    
    // Simulate availability (70% chance each material is available)
    const unavailableMaterials = materialsNeeded.filter(m => Math.random() > 0.3);
    
    return {
      all_available: unavailableMaterials.length === 0,
      unavailable_materials: unavailableMaterials,
      available_materials: materialsNeeded.filter(m => !unavailableMaterials.includes(m))
    };
  }

  private checkIfMaterialsSatisfyBuild(payload: any): boolean {
    // Simplified check
    // In reality, this would compare against build requirements
    return Math.random() > 0.4; // 60% chance materials satisfy build
  }

  private checkIfFabricatedPartsAreNeeded(payload: any): boolean {
    // Simplified check
    return Math.random() > 0.5; // 50% chance we need these fabricated parts
  }

  private updateBuildProgress(payload: any): any {
    // Simplified build progress update
    return {
      build_id: payload.build_id,
      current_phase: payload.phase || 'unknown',
      phases_completed: payload.phases_completed || [],
      is_complete: payload.phases_completed.length >= 4, // Assuming 4 phases
      next_phase: payload.phases_completed.length >= 4 ? null : ['foundation', 'framing', 'enclosure', 'interiors'][payload.phases_completed.length],
      next_phase_estimated_start: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day
      next_phase_estimated_duration: 5, // 5 days
      actual_cost: payload.actual_cost || 0,
      timeline_variance: payload.timeline_variance || 0
    };
  }

  private evaluateWorkflowOptimization(payload: any): any {
    // Simplified optimization evaluation
    const improvement = Math.random() * 30; // 0-30% improvement
    const implementationCost = Math.random() * 1000; // $0-1000 cost
    
    return {
      worth_implementing: improvement > 10 && implementationCost < 500, // Worth it if >10% improvement and cost < $500
      improvement_estimate: `${improvement.toFixed(1)}%`,
      implementation_cost: `$${implementationCost.toFixed(2)}`,
      roi_weeks: implementationCost > 0 ? (improvement * 10) / implementationCost : 0 // Simplified ROI
    };
  }

  private async implementWorkflowOptimization(optimization: any): Promise<void> {
    console.log(`[Construction Agent] Implementing workflow optimization: ${optimization.type || 'unknown'}`);
    
    // In real system, this would change workflows, update SOPs, etc.
    await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate work
    
    console.log('[Construction Agent] Workflow optimization implemented');
  }
}