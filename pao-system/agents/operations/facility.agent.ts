import { BaseAgent } from '../base.agent';

export class FacilityAgent extends BaseAgent {
  constructor() {
    super('facility.agent', ['facility', 'hvac', 'lighting', 'rotation', 'iot']);
  }

  async handle_event(event: any): Promise<void> {
    console.log(`[Facility Agent] Handling event: ${event.type}`);

    switch (event.type) {
      case 'ENVIRONMENTAL_CONTROL_NEEDED':
        await this.handleEnvironmentalControlNeeded(event);
        break;
      case 'ENERGY_OPTIMIZATION_COMMANDS':
        await this.handleEnergyOptimizationCommands(event);
        break;
      case 'SYSTEM_MAINTENANCE_REQUIRED':
        await this.handleSystemMaintenanceRequired(event);
        break;
      case 'ROTATION_CONTROL_UPDATE':
        await this.handleRotationControlUpdate(event);
        break;
      case 'EMERGENCY_ENVIRONMENTAL_SHUTDOWN':
        await this.handleEmergencyEnvironmentalShutdown(event);
        break;
      default:
        console.log(`[Facility Agent] Unhandled event type: ${event.type}`);
    }
  }

  private async handleEnvironmentalControlNeeded(event: any): Promise<void> {
    console.log('[Facility Agent] Processing environmental control needed');
    
    // Determine what environmental controls are needed
    const controlActions = this.determineEnvironmentalControls(event.payload);
    
    // Execute the control actions
    await this.executeEnvironmentalControls(controlActions);
    
    this.emit_event('ENVIRONMENTAL_CONTROLS_APPLIED', {
      request_id: event.payload.request_id,
      controls_applied: controlActions,
      applied_by: this.id,
      timestamp: new Date().toISOString()
    }, event.payload.requesting_agent || 'broadcast', 'medium');
  }

  private async handleEnergyOptimizationCommands(event: any): Promise<void> {
    console.log('[Facility Agent] Processing energy optimization commands');
    
    // Apply energy optimization settings
    const optimizationResults = this.applyEnergyOptimizations(event.payload);
    
    this.emit_event('ENERGY_OPTIMIZATION_APPLIED', {
      command_id: event.payload.command_id,
      optimizations_applied: optimizationResults,
      energy_savings_estimate: this.calculateEnergySavings(optimizationResults),
      applied_by: this.id,
      timestamp: new Date().toISOString()
    }, 'energy.agent', 'medium');
  }

  private async handleSystemMaintenanceRequired(event: any): Promise<void> {
    console.log('[Facility Agent] Processing system maintenance required');
    
    // Schedule and perform maintenance
    const maintenanceResult = await this.performSystemMaintenance(event.payload);
    
    this.emit_event('SYSTEM_MAINTENANCE_COMPLETED', {
      maintenance_id: event.payload.maintenance_id,
      systems_serviced: maintenanceResult.systems_serviced,
      next_maintenance_due: maintenanceResult.next_maintenance_due,
      completed_by: this.id,
      timestamp: new Date().toISOString()
    }, 'broadcast', 'medium');
  }

  private async handleRotationControlUpdate(event: any): Promise<void> {
    console.log('[Facility Agent] Processing rotation control update');
    
    // Update rotation parameters
    const rotationResult = this.updateRotationParameters(event.payload);
    
    this.emit_event('ROTATION_CONTROL_UPDATED', {
      update_id: event.payload.update_id,
      new_parameters: rotationResult,
      updated_by: this.id,
      timestamp: new Date().toISOString()
    }, 'broadcast', 'medium');
  }

  private async handleEmergencyEnvironmentalShutdown(event: any): Promise<void> {
    console.log('[Facility Agent] Processing emergency environmental shutdown');
    
    // Execute emergency shutdown procedures
    await this.executeEmergencyShutdown(event.payload);
    
    this.emit_event('EMERGENCY_SHUTDOWN_EXECUTED', {
      shutdown_id: event.payload.shutdown_id,
      systems_shutdown: ['hvac', 'lighting', 'non_critical_rotation'],
      executed_by: this.id,
      timestamp: new Date().toISOString()
    }, 'broadcast', 'critical');
  }

  private determineEnvironmentalControls(payload: any): any[] {
    const controls = [];
    
    // Temperature control
    if (payload.temperature !== undefined) {
      const targetTemp = payload.temperature;
      const currentTemp = payload.current_temperature || targetTemp; // Simplified
      
      if (currentTemp > targetTemp + 2) {
        controls.push({
          type: 'cooling',
          target_temperature: targetTemp,
          action: 'increase_cooling',
          intensity: Math.min(100, (currentTemp - targetTemp) * 20)
        });
      } else if (currentTemp < targetTemp - 2) {
        controls.push({
          type: 'heating',
          target_temperature: targetTemp,
          action: 'increase_heating',
          intensity: Math.min(100, (targetTemp - currentTemp) * 20)
        });
      }
    }
    
    // Humidity control
    if (payload.humidity !== undefined) {
      const targetHumidity = payload.humidity;
      const currentHumidity = payload.current_humidity || targetHumidity;
      
      if (currentHumidity > targetHumidity + 5) {
        controls.push({
          type: 'dehumidification',
          target_humidity: targetHumidity,
          action: 'increase_dehumidification',
          intensity: Math.min(100, (currentHumidity - targetHumidity) * 10)
        });
      } else if (currentHumidity < targetHumidity - 5) {
        controls.push({
          type: 'humidification',
          target_humidity: targetHumidity,
          action: 'increase_humidification',
          intensity: Math.min(100, (targetHumidity - currentHumidity) * 10)
        });
      }
    }
    
    // Lighting control
    if (payload.lighting_level !== undefined) {
      controls.push({
        type: 'lighting',
        target_level: payload.lighting_level,
        action: 'set_lighting_level',
        intensity: payload.lighting_level
      });
    }
    
    return controls;
  }

  private async executeEnvironmentalControls(controls: any[]): Promise<void> {
    console.log(`[Facility Agent] Executing ${controls.length} environmental control actions`);
    
    // In real system, this would send commands to HVAC, lighting, etc. systems
    for (const control of controls) {
      console.log(`[Facility Agent] Executing control: ${control.type} - ${control.action}`);
      // Simulate execution delay
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log('[Facility Agent] Environmental controls executed');
  }

  private applyEnergyOptimizations(payload: any): any[] {
    const optimizations = [];
    
    // HVAC optimization
    if (payload.hvac_optimization) {
      optimizations.push({
        type: 'hvac_scheduling',
        description: 'Optimize HVAC scheduling based on occupancy patterns',
        estimated_savings: '15-25%',
        payload: payload.hvac_optimization
      });
    }
    
    // Lighting optimization
    if (payload.lighting_optimization) {
      optimizations.push({
        type: 'smart_lighting',
        description: 'Implement smart lighting with motion sensors and daylight harvesting',
        estimated_savings: '20-40%',
        payload: payload.lighting_optimization
      });
    }
    
    // Rotation optimization
    if (payload.rotation_optimization) {
      optimizations.push({
        type: 'efficient_rotation',
        description: 'Optimize rotation patterns for energy efficiency',
        estimated_savings: '10-20%',
        payload: payload.rotation_optimization
      });
    }
    
    return optimizations;
  }

  private calculateEnergySavings(optimizations: any[]): string {
    if (optimizations.length === 0) return '0%';
    
    // Simplified calculation - in reality would be more complex
    const totalSavings = optimizations.reduce((total, opt) => {
      // Extract percentage from estimated_savings string like "15-25%"
      const match = opt.estimated_savings.match(/(\d+)-(\d+)%/);
      if (match) {
        const min = parseInt(match[1]);
        const max = parseInt(match[2]);
        const avg = (min + max) / 2;
        return total + avg;
      }
      return total;
    }, 0);
    
    return `${Math.min(80, totalSavings)}%`; // Cap at 80% savings
  }

  private async performSystemMaintenance(payload: any): Promise<any> {
    console.log(`[Facility Agent] Performing system maintenance: ${payload.maintenance_type || 'general'}`);
    
    // In real system, this would perform actual maintenance tasks
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const systems = payload.systems || ['hvac', 'lighting', 'rotation', 'security'];
    
    return {
      maintenance_id: payload.maintenance_id || `maint_${Date.now()}`,
      systems_serviced: systems,
      next_maintenance_due: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 3 months
      work_performed: [
        'System inspection',
        'Filter replacement',
        'Lubrication of moving parts',
        'Calibration of sensors',
        'Software updates'
      ]
    };
  }

  private updateRotationParameters(payload: any): any {
    console.log(`[Facility Agent] Updating rotation parameters`);
    
    // In real system, this would send commands to rotation motors/controllers
    return {
      rotation_speed_rpm: payload.speed_rpm || 0,
      rotation_direction: payload.direction || 'clockwise',
      rotation_pattern: payload.pattern || 'continuous',
      acceleration_rate: payload.acceleration || 0.5,
      last_updated: new Date().toISOString(),
      updated_by: this.id
    };
  }

  private async executeEmergencyShutdown(payload: any): Promise<void> {
    console.log('[Facility Agent] Executing emergency environmental shutdown');
    
    // In real system, this would trigger emergency shutdown sequences
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    console.log('[Facility Agent] Emergency shutdown executed');
  }
}