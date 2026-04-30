/**
 * ENERGY AGENT - ProtoForge Strategic Layer
 * 
 * Focus: Hybrid power systems (solar, wind, flywheel)
 * Constraints: Support full HQ load, integrate with facility AI
 * Output: Energy models, load calculations, optimization plans
 */

import { BaseAgent } from '../base.agent';

export interface EnergySystem {
  id: string;
  name: string;
  type: 'hybrid' | 'solar_only' | 'wind_only' | 'grid_backup';
  components: {
    solar: SolarSystem;
    wind: WindSystem;
    storage: StorageSystem;
    grid: GridConnection;
    backup: BackupSystem;
  };
  capacity: SystemCapacity;
  load_profile: LoadProfile;
  efficiency_metrics: EfficiencyMetrics;
  ai_integration: AIIntegration;
  optimization_plan: OptimizationPlan;
}

export interface SolarSystem {
  panels: SolarPanel[];
  inverters: Inverter[];
  tracking: boolean;
  capacity_kW: number;
  daily_production_kWh: number;
  annual_production_kWh: number;
  efficiency: number;
  degradation_rate: number; // per year
  installation_area_m2: number;
  orientation: string;
  tilt_angle: number;
}

export interface SolarPanel {
  id: string;
  model: string;
  rated_power_W: number;
  efficiency: number;
  dimensions: { width: number; height: number; depth: number };
  weight_kg: number;
  warranty_years: number;
  temperature_coefficient: number;
}

export interface Inverter {
  id: string;
  model: string;
  rated_power_kW: number;
  efficiency: number;
  type: 'string' | 'micro' | 'central';
  mppt_inputs: number;
  max_dc_voltage: number;
  max_ac_current: number;
  communication: string[];
}

export interface WindSystem {
  turbines: WindTurbine[];
  capacity_kW: number;
  daily_production_kWh: number;
  annual_production_kWh: number;
  capacity_factor: number;
  cut_in_speed: number; // m/s
  rated_speed: number; // m/s
  cut_out_speed: number; // m/s
  hub_height: number; // meters
  rotor_diameter: number; // meters
  swept_area: number; // m²
}

export interface WindTurbine {
  id: string;
  model: string;
  rated_power_kW: number;
  rotor_diameter: number;
  hub_height: number;
  cut_in_speed: number;
  rated_speed: number;
  cut_out_speed: number;
  power_curve: PowerCurvePoint[];
  annual_energy_yield: number; // kWh
}

export interface PowerCurvePoint {
  wind_speed: number; // m/s
  power_output: number; // kW
}

export interface StorageSystem {
  primary: FlywheelStorage;
  secondary: BatteryStorage;
  total_capacity_kWh: number;
  usable_capacity_kWh: number;
  round_trip_efficiency: number;
  response_time_ms: number;
  discharge_duration_hours: number;
}

export interface FlywheelStorage {
  units: FlywheelUnit[];
  total_capacity_kWh: number;
  max_power_kW: number;
  response_time_ms: number;
  discharge_duration_hours: number;
  efficiency: number;
  maintenance_interval_months: number;
}

export interface FlywheelUnit {
  id: string;
  capacity_kWh: number;
  max_power_kW: number;
  rotor_mass: number; // kg
  max_rpm: number;
  housing_material: string;
  vacuum_level: string;
  magnetic_bearings: boolean;
}

export interface BatteryStorage {
  chemistry: string;
  capacity_kWh: number;
  max_power_kW: number;
  cycles: number;
  depth_of_discharge: number;
  efficiency: number;
  temperature_range: { min: number; max: number };
  fire_suppression: boolean;
}

export interface GridConnection {
  connection_type: 'grid_tie' | 'off_grid' | 'hybrid';
  capacity_kW: number;
  voltage: string;
  frequency: string;
  import_rate_per_kWh: number;
  export_rate_per_kWh: number;
  net_metering: boolean;
  demand_charges: boolean;
  backup_capability: boolean;
}

export interface BackupSystem {
  type: 'diesel' | 'natural_gas' | 'hydrogen_fuel_cell';
  capacity_kW: number;
  fuel_tank_capacity_liters: number;
  runtime_hours: number;
  auto_start: boolean;
  test_schedule: string;
  maintenance_schedule: string;
}

export interface SystemCapacity {
  total_installed_kW: number;
  total_renewable_kW: number;
  total_storage_kWh: number;
  peak_demand_kW: number;
  average_demand_kW: number;
  minimum_demand_kW: number;
  load_factor: number;
  diversity_factor: number;
}

export interface LoadProfile {
  daily: LoadPoint[];
  weekly: LoadPoint[];
  monthly: LoadPoint[];
  seasonal: LoadPoint[];
  annual: LoadPoint[];
  peak_hours: number[];
  off_peak_hours: number[];
  base_load: number; // kW
  peak_load: number; // kW
  load_duration_curve: LoadDurationPoint[];
}

export interface LoadPoint {
  timestamp: string;
  demand_kW: number;
  source_breakdown: SourceBreakdown;
  category_breakdown: CategoryBreakdown;
}

export interface SourceBreakdown {
  solar_kW: number;
  wind_kW: number;
  storage_kW: number;
  grid_kW: number;
  backup_kW: number;
}

export interface CategoryBreakdown {
  hvac_kW: number;
  lighting_kW: number;
  equipment_kW: number;
  computing_kW: number;
  fabrication_kW: number;
  miscellaneous_kW: number;
}

export interface LoadDurationPoint {
  percentile: number;
  demand_kW: number;
  duration_hours: number;
}

export interface EfficiencyMetrics {
  overall_efficiency: number;
  solar_efficiency: number;
  wind_efficiency: number;
  storage_efficiency: number;
  inverter_efficiency: number;
  transmission_efficiency: number;
  self_consumption_rate: number;
  grid_independence: number;
  capacity_utilization: number;
  renewable_fraction: number;
}

export interface AIIntegration {
  enabled: boolean;
  predictive_load_management: boolean;
  weather_optimization: boolean;
  demand_response: boolean;
  anomaly_detection: boolean;
  optimization_algorithms: string[];
  sensors: EnergySensor[];
  control_systems: ControlSystem[];
  ml_models: MLModel[];
}

export interface EnergySensor {
  id: string;
  type: 'power_meter' | 'weather_station' | 'temperature' | 'irradiance' | 'wind_speed';
  location: string;
  sampling_rate_hz: number;
  accuracy: number;
  calibration_schedule: string;
}

export interface ControlSystem {
  id: string;
  type: string;
  control_strategy: string;
  setpoints: Record<string, number>;
  response_time_ms: number;
  communication_protocol: string;
}

export interface MLModel {
  name: string;
  purpose: string;
  accuracy: number;
  training_data_period: string;
  update_frequency: string;
  prediction_horizon: string;
}

export interface OptimizationPlan {
  short_term: OptimizationAction[];
  medium_term: OptimizationAction[];
  long_term: OptimizationAction[];
  cost_savings_projection: CostSavings;
  efficiency_targets: EfficiencyTargets;
  implementation_schedule: ImplementationSchedule;
}

export interface OptimizationAction {
  id: string;
  name: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  estimated_cost: number;
  estimated_savings_kWh_year: number;
  estimated_savings_cost_year: number;
  payback_period_years: number;
  implementation_complexity: 'low' | 'medium' | 'high';
  dependencies: string[];
  status: 'pending' | 'in_progress' | 'completed';
}

export interface CostSavings {
  annual_energy_savings_kWh: number;
  annual_cost_savings: number;
  co2_reduction_tons: number;
  roi_percent: number;
  npv_10_year: number;
}

export interface EfficiencyTargets {
  current_overall_efficiency: number;
  target_overall_efficiency: number;
  current_renewable_fraction: number;
  target_renewable_fraction: number;
  current_grid_independence: number;
  target_grid_independence: number;
  timeline_months: number;
}

export interface ImplementationSchedule {
  phase1: PhaseSchedule;
  phase2: PhaseSchedule;
  phase3: PhaseSchedule;
  milestones: Milestone[];
}

export interface PhaseSchedule {
  name: string;
  duration_months: number;
  actions: string[];
  completion_criteria: string;
  estimated_cost: number;
}

export interface Milestone {
  name: string;
  target_date: string;
  criteria: string[];
  deliverables: string[];
}

export class EnergyAgent extends BaseAgent {
  private energySystems: Map<string, EnergySystem> = new Map();
  private loadProfiles: Map<string, LoadProfile> = new Map();
  private energyModels: Map<string, any> = new Map();
  private optimizationHistory: any[] = [];
  private weatherData: any = null;
  private facilityData: any = null;

  constructor() {
    super('energy_agent', [
      'energy_system_design',
      'hybrid_power_systems',
      'load_calculations',
      'efficiency_optimization',
      'ai_integration',
      'renewable_energy',
      'energy_storage',
      'grid_management'
    ]);
  }

  async handle_event(event: any): Promise<void> {
    console.log(`[Energy Agent] Handling event: ${event.type}`);

    switch (event.type) {
      case 'DESIGN_READY':
        await this.handleDesignReady(event);
        break;
      case 'ENERGY_DEMAND_UPDATE':
        await this.handleEnergyDemandUpdate(event);
        break;
      case 'WEATHER_FORECAST':
        await this.handleWeatherForecast(event);
        break;
      case 'ENERGY_STORAGE_STATUS':
        await this.handleEnergyStorageStatus(event);
        break;
      default:
        console.log(`[Energy Agent] Unhandled event type: ${event.type}`);
    }
  }

  private async handleDesignReady(event: any): Promise<void> {
    console.log('[Energy Agent] Processing design ready event for energy system planning');
    
    // Calculate energy requirements based on the design
    const energyRequirements = this.calculateEnergyRequirements(event.payload);
    
    // Design hybrid energy system
    const energySystem = this.designHybridEnergySystem(energyRequirements);
    
    // Emit event with energy system specifications
    this.emit_event('ENERGY_SYSTEM_DESIGN_READY', {
      design_id: event.payload.design_id,
      energy_requirements: energyRequirements,
      energy_system: energySystem,
      efficiency_targets: this.calculateEfficiencyTargets(energySystem),
      redundancy_level: this.calculateRedundancyLevel(energySystem),
      designed_by: this.id,
      timestamp: new Date().toISOString()
    }, 'broadcast', 'high');
  }

  private async handleEnergyDemandUpdate(event: any): Promise<void> {
    console.log('[Energy Agent] Processing energy demand update');
    
    // Update energy demand forecasts
    const updatedDemand = this.updateEnergyDemandForecast(event.payload);
    
    // Check if current energy system can meet demand
    const canMeetDemand = this.checkSystemCapacity(updatedDemand);
    
    if (!canMeetDemand) {
      // Emit alert for energy system upgrade needed
      this.emit_event('ENERGY_SYSTEM_UPGRADE_REQUIRED', {
        current_capacity: this.getCurrentSystemCapacity(),
        required_capacity: updatedDemand.peak_demand,
        deficit: updatedDemand.peak_demand - this.getCurrentSystemCapacity(),
        urgency: updatedDemand.peak_demand > this.getCurrentSystemCapacity() * 1.2 ? 'high' : 'medium',
        timestamp: new Date().toISOString()
      }, 'broadcast', 'high');
    }
  }

  private async handleWeatherForecast(event: any): Promise<void> {
    console.log('[Energy Agent] Processing weather forecast for energy optimization');
    
    // Optimize energy system based on weather forecast
    const optimization = this.optimizeForWeather(event.payload);
    
    // Emit optimization commands to facility systems
    this.emit_event('ENERGY_OPTIMIZATION_COMMANDS', {
      forecast_period: event.payload.period,
      solar_adjustment: optimization.solar_adjustment,
      wind_adjustment: optimization.wind_adjustment,
      storage_strategy: optimization.storage_strategy,
      expected_efficiency_gain: optimization.efficiency_gain,
      optimized_by: this.id,
      timestamp: new Date().toISOString()
    }, 'facility.agent', 'medium');
  }

  private async handleEnergyStorageStatus(event: any): Promise<void> {
    console.log('[Energy Agent] Processing energy storage status');
    
    // Analyze storage status and make recommendations
    const storageAnalysis = this.analyzeStorageStatus(event.payload);
    
    if (storageAnalysis.needsAttention) {
      this.emit_event('STORAGE_ACTION_REQUIRED', {
        storage_level: event.payload.level,
        recommended_action: storageAnalysis.recommended_action,
        urgency: storageAnalysis.urgency,
        timestamp: new Date().toISOString()
      }, 'facility.agent', storageAnalysis.urgency);
    }
  }

  private calculateEnergyRequirements(design: any): any {
    // Simplified energy requirement calculation
    // In reality, this would be based on square footage, equipment, occupancy, etc.
    const baseLoad = design.square_feet * 10; // 10W per sq ft base load
    const peakLoad = baseLoad * 2; // Assume 2x base load for peak
    
    return {
      base_load_watts: baseLoad,
      peak_load_watts: peakLoad,
      daily_kwh: (baseLoad * 24) / 1000, // Convert to kWh
      peak_kwh: (peakLoad * 24) / 1000
    };
  }

  private designHybridEnergySystem(requirements: any): any {
    // Design a hybrid system with solar, wind, and flywheel storage
    const solarCapacity = Math.ceil(requirements.peak_load_watts * 0.4); // 40% from solar
    const windCapacity = Math.ceil(requirements.peak_load_watts * 0.3); // 30% from wind
    const storageCapacity = Math.ceil(requirements.daily_kwh * 1.5); // 1.5 days of storage
    
    return {
      solar_panels_watts: solarCapacity,
      wind_turbines_watts: windCapacity,
      flywheel_storage_kwh: storageCapacity,
      grid_connection_watts: Math.ceil(requirements.peak_load_watts * 0.2), // 20% grid backup
      total_capacity_watts: solarCapacity + windCapacity + Math.ceil(requirements.peak_load_watts * 0.2),
      estimated_daily_production_kwh: (solarCapacity * 5 + windCapacity * 4) / 1000 // 5h sun, 4h wind equivalent
    };
  }

  private calculateEfficiencyTargets(system: any): any {
    return {
      target_efficiency_percent: 85, // Target 85% system efficiency
      solar_efficiency_percent: 22,  // Modern solar panel efficiency
      wind_efficiency_percent: 45,   // Modern wind turbine efficiency
      storage_efficiency_percent: 90, // Flywheel storage efficiency
      inverter_efficiency_percent: 95  // DC to AC conversion efficiency
    };
  }

  private calculateRedundancyLevel(system: any): string {
    // Calculate redundancy based on multiple energy sources
    const sources = [
      system.solar_panels_watts > 0 ? 1 : 0,
      system.wind_turbines_watts > 0 ? 1 : 0,
      system.grid_connection_watts > 0 ? 1 : 0
    ].reduce((a, b) => a + b, 0);
    
    return sources >= 2 ? 'high' : sources === 1 ? 'medium' : 'low';
  }

  private updateEnergyDemandForecast(payload: any): any {
    // In real system, this would use historical data and ML predictions
    return {
      ...payload,
      peak_demand: payload.current_demand * 1.2, // Simple 20% buffer
      daily_usage: payload.current_demand * 24 / 1000
    };
  }

  private checkSystemCapacity(demand: any): boolean {
    // In real system, this would check against actual installed capacity
    const currentCapacity = this.getCurrentSystemCapacity();
    return currentCapacity >= demand.peak_demand;
  }

  private getCurrentSystemCapacity(): number {
    // In real system, this would come from facility monitoring
    // For now, return a placeholder
    return 50000; // 50kW placeholder
  }

  private optimizeForWeather(forecast: any): any {
    // Simple weather-based optimization
    return {
      solar_adjustment: forecast.sunny_hours > 6 ? 1.2 : forecast.sunny_hours > 3 ? 1.0 : 0.8,
      wind_adjustment: forecast.wind_speed > 15 ? 1.3 : forecast.wind_speed > 8 ? 1.0 : 0.7,
      storage_strategy: forecast.cloudy_days > 2 ? 'conservative' : 'normal',
      efficiency_gain: Math.min(0.2, (forecast.sunny_hours + forecast.wind_speed/10) / 20) // Up to 20% gain
    };
  }

  private analyzeStorageStatus(status: any): any {
    const levelPercent = (status.level / status.capacity) * 100;
    
    if (levelPercent < 20) {
      return {
        needsAttention: true,
        recommended_action: 'charge_storage_from_available_sources',
        urgency: 'high'
      };
    } else if (levelPercent > 90) {
      return {
        needsAttention: true,
        recommended_action: 'divert_excess_to_grid_or_dump_load',
        urgency: 'medium'
      };
    } else {
      return {
        needsAttention: false,
        recommended_action: 'maintain_current_operation',
        urgency: 'low'
      };
    }
  }

  // ============================================================================
  // COMPREHENSIVE ENERGY SYSTEM DESIGN METHODS
  // ============================================================================

  /**
   * Design complete hybrid energy system for full HQ load
   */
  public designCompleteEnergySystem(facilityData: any): EnergySystem {
    console.log('[Energy Agent] Designing complete hybrid energy system for HQ');
    
    // Step 1: Calculate comprehensive load profile
    const loadProfile = this.calculateFullHQLoadProfile(facilityData);
    this.loadProfiles.set('hq_main', loadProfile);
    
    // Step 2: Size renewable energy components
    const solarSystem = this.designSolarSystem(loadProfile, facilityData);
    const windSystem = this.designWindSystem(loadProfile, facilityData);
    
    // Step 3: Design energy storage
    const storageSystem = this.designStorageSystem(loadProfile);
    
    // Step 4: Design grid connection and backup
    const gridConnection = this.designGridConnection(loadProfile);
    const backupSystem = this.designBackupSystem(loadProfile);
    
    // Step 5: Calculate system capacity
    const capacity = this.calculateSystemCapacity(solarSystem, windSystem, loadProfile);
    
    // Step 6: Calculate efficiency metrics
    const efficiencyMetrics = this.calculateComprehensiveEfficiency({
      solar: solarSystem,
      wind: windSystem,
      storage: storageSystem
    });
    
    // Step 7: Design AI integration
    const aiIntegration = this.designAIIntegration(loadProfile, facilityData);
    
    // Step 8: Create optimization plan
    const optimizationPlan = this.createComprehensiveOptimizationPlan({
      solar: solarSystem,
      wind: windSystem,
      storage: storageSystem,
      grid: gridConnection
    }, loadProfile);
    
    // Assemble complete energy system
    const energySystem: EnergySystem = {
      id: `energy_system_${Date.now()}`,
      name: 'ProtoForge HQ Hybrid Energy System',
      type: 'hybrid',
      components: {
        solar: solarSystem,
        wind: windSystem,
        storage: storageSystem,
        grid: gridConnection,
        backup: backupSystem
      },
      capacity,
      load_profile: loadProfile,
      efficiency_metrics: efficiencyMetrics,
      ai_integration: aiIntegration,
      optimization_plan: optimizationPlan
    };
    
    // Store energy system
    this.energySystems.set(energySystem.id, energySystem);
    
    console.log(`[Energy Agent] Energy system design complete: ${energySystem.id}`);
    
    return energySystem;
  }

  /**
   * Calculate comprehensive HQ load profile
   */
  private calculateFullHQLoadProfile(facilityData: any): LoadProfile {
    console.log('[Energy Agent] Calculating comprehensive HQ load profile');
    
    // Facility data structure
    const { 
      total_area_sqft, 
      container_count, 
      equipment_list, 
      occupancy_schedule,
      hvac_requirements,
      fabrication_equipment,
      computing_infrastructure
    } = facilityData;
    
    // Calculate loads by category
    const hvacLoad = this.calculateHVACLoad(total_area_sqft, hvac_requirements);
    const lightingLoad = this.calculateLightingLoad(total_area_sqft);
    const equipmentLoad = this.calculateEquipmentLoad(equipment_list);
    const computingLoad = this.calculateComputingLoad(computing_infrastructure);
    const fabricationLoad = this.calculateFabricationLoad(fabrication_equipment);
    const miscellaneousLoad = total_area_sqft * 2; // 2W/sqft for misc
    
    // Base load (minimum continuous load)
    const baseLoad = computingLoad.base + hvacLoad.minimum + lightingLoad.minimum + miscellaneousLoad * 0.3;
    
    // Peak load (maximum expected load)
    const peakLoad = hvacLoad.maximum + lightingLoad.maximum + equipmentLoad.maximum + 
                     computingLoad.maximum + fabricationLoad.maximum + miscellaneousLoad;
    
    // Generate 24-hour load profile
    const dailyLoadProfile: LoadPoint[] = [];
    for (let hour = 0; hour < 24; hour++) {
      const demand = this.calculateHourlyDemand(hour, {
        hvac: hvacLoad,
        lighting: lightingLoad,
        equipment: equipmentLoad,
        computing: computingLoad,
        fabrication: fabricationLoad,
        miscellaneous: miscellaneousLoad
      }, occupancy_schedule);
      
      dailyLoadProfile.push({
        timestamp: `2024-01-01T${hour.toString().padStart(2, '0')}:00:00Z`,
        demand_kW: demand,
        source_breakdown: { solar_kW: 0, wind_kW: 0, storage_kW: 0, grid_kW: 0, backup_kW: 0 },
        category_breakdown: {
          hvac_kW: hvacLoad.profile[hour],
          lighting_kW: lightingLoad.profile[hour],
          equipment_kW: equipmentLoad.profile[hour],
          computing_kW: computingLoad.profile[hour],
          fabrication_kW: fabricationLoad.profile[hour],
          miscellaneous_kW: miscellaneousLoad * 0.5
        }
      });
    }
    
    // Calculate load duration curve
    const sortedLoads = dailyLoadProfile.map(p => p.demand_kW).sort((a, b) => b - a);
    const loadDurationCurve: LoadDurationPoint[] = [];
    for (let i = 0; i < sortedLoads.length; i++) {
      loadDurationCurve.push({
        percentile: ((i + 1) / sortedLoads.length) * 100,
        demand_kW: sortedLoads[i],
        duration_hours: (i + 1)
      });
    }
    
    // Identify peak and off-peak hours
    const peakHours = dailyLoadProfile
      .filter(p => p.demand_kW > baseLoad + (peakLoad - baseLoad) * 0.7)
      .map(p => parseInt(p.timestamp.split('T')[1].split(':')[0]));
      
    const offPeakHours = dailyLoadProfile
      .filter(p => p.demand_kW < baseLoad + (peakLoad - baseLoad) * 0.3)
      .map(p => parseInt(p.timestamp.split('T')[1].split(':')[0]));
    
    // Calculate load factor
    const averageLoad = dailyLoadProfile.reduce((sum, p) => sum + p.demand_kW, 0) / 24;
    const loadFactor = averageLoad / peakLoad;
    
    return {
      daily: dailyLoadProfile,
      weekly: [], // Would calculate weekly variations
      monthly: [], // Would calculate monthly variations
      seasonal: [], // Would calculate seasonal variations
      annual: [], // Would calculate annual totals
      peak_hours: peakHours,
      off_peak_hours: offPeakHours,
      base_load: baseLoad,
      peak_load: peakLoad,
      load_duration_curve: loadDurationCurve
    };
  }

  /**
   * Calculate HVAC load
   */
  private calculateHVACLoad(area_sqft: number, requirements: any): any {
    // Simplified HVAC calculation
    const coolingLoad = area_sqft * 25; // 25W/sqft for cooling
    const heatingLoad = area_sqft * 15; // 15W/sqft for heating
    const ventilationLoad = area_sqft * 5; // 5W/sqft for ventilation
    
    const maximum = coolingLoad + heatingLoad + ventilationLoad;
    const minimum = ventilationLoad;
    
    // Generate hourly profile
    const profile = [];
    for (let hour = 0; hour < 24; hour++) {
      const isBusinessHours = hour >= 8 && hour <= 18;
      const isSummer = true; // Simplified
      
      let load = ventilationLoad;
      if (isBusinessHours) {
        load += isSummer ? coolingLoad : heatingLoad;
      } else {
        load += (isSummer ? coolingLoad : heatingLoad) * 0.3;
      }
      profile.push(load / 1000); // Convert to kW
    }
    
    return { maximum: maximum / 1000, minimum: minimum / 1000, profile };
  }

  /**
   * Calculate lighting load
   */
  private calculateLightingLoad(area_sqft: number): any {
    const load = area_sqft * 3; // 3W/sqft for LED lighting
    
    const profile = [];
    for (let hour = 0; hour < 24; hour++) {
      const isBusinessHours = hour >= 7 && hour <= 19;
      const isNight = hour >= 20 || hour <= 6;
      
      let hourlyLoad = 1; // kW
      if (isBusinessHours) hourlyLoad = load / 1000;
      else if (isNight) hourlyLoad = load * 0.1 / 1000;
      else hourlyLoad = load * 0.2 / 1000;
      
      profile.push(hourlyLoad);
    }
    
    return { maximum: load / 1000, minimum: load * 0.1 / 1000, profile };
  }

  /**
   * Calculate equipment load
   */
  private calculateEquipmentLoad(equipmentList: any[]): any {
    let totalLoad = 0;
    const profile = new Array(24).fill(0);
    
    equipmentList.forEach(equipment => {
      totalLoad += equipment.power_watts;
      
      // Add to hourly profile
      for (let hour = equipment.schedule_start || 8; hour <= (equipment.schedule_end || 18); hour++) {
        if (hour < 24) {
          profile[hour] += equipment.power_watts / 1000;
        }
      }
    });
    
    return { maximum: totalLoad / 1000, minimum: Math.min(...profile), profile };
  }

  /**
   * Calculate computing infrastructure load
   */
  private calculateComputingLoad(infrastructure: any): any {
    const servers = infrastructure.server_count || 10;
    const gpuClusters = infrastructure.gpu_cluster_count || 2;
    const networkEquipment = infrastructure.network_equipment || 5;
    
    const serverLoad = servers * 500; // 500W per server
    const gpuLoad = gpuClusters * 2000; // 2kW per GPU cluster
    const networkLoad = networkEquipment * 100; // 100W per network device
    
    const totalLoad = serverLoad + gpuLoad + networkLoad;
    
    // Computing runs 24/7 but varies with AI workload
    const profile = [];
    for (let hour = 0; hour < 24; hour++) {
      const isHighCompute = hour >= 9 && hour <= 17; // Business hours
      const loadFactor = isHighCompute ? 0.9 : 0.6;
      profile.push((totalLoad * loadFactor) / 1000);
    }
    
    return { 
      maximum: (totalLoad * 0.9) / 1000, 
      minimum: (totalLoad * 0.5) / 1000, 
      profile,
      base: (totalLoad * 0.5) / 1000 // Always-on base load
    };
  }

  /**
   * Calculate fabrication equipment load
   */
  private calculateFabricationLoad(equipment: any[]): any {
    let totalLoad = 0;
    const profile = new Array(24).fill(0);
    
    equipment.forEach(machine => {
      totalLoad += machine.power_watts;
      
      // Fabrication typically during business hours
      for (let hour = 8; hour <= 17; hour++) {
        if (hour < 24) {
          profile[hour] += machine.power_watts / 1000;
        }
      }
    });
    
    return { maximum: totalLoad / 1000, minimum: 1, profile };
  }

  /**
   * Calculate hourly demand
   */
  private calculateHourlyDemand(hour: number, loads: any, schedule: any): number {
    return loads.hvac.profile[hour] + 
           loads.lighting.profile[hour] + 
           loads.equipment.profile[hour] + 
           loads.computing.profile[hour] + 
           loads.fabrication.profile[hour] + 
           loads.miscellaneous * 0.5;
  }

  /**
   * Design solar power system
   */
  private designSolarSystem(loadProfile: LoadProfile, facilityData: any): SolarSystem {
    console.log('[Energy Agent] Designing solar power system');
    
    // Sizing: Target 40% of peak load from solar
    const targetSolarContribution = loadProfile.peak_load * 0.4;
    const peakSunHours = 5; // Average peak sun hours
    const panelEfficiency = 0.22;
    const systemLosses = 0.85; // 15% losses
    
    const requiredCapacity = (targetSolarContribution / (peakSunHours * systemLosses)) * 24;
    
    // Calculate number of panels
    const panelPower = 550; // Watts (modern high-efficiency panels)
    const panelCount = Math.ceil((requiredCapacity * 1000) / panelPower);
    
    // Generate panel specifications
    const panels: SolarPanel[] = [];
    for (let i = 0; i < panelCount; i++) {
      panels.push({
        id: `panel_${i + 1}`,
        model: 'LG Neon 2 BiFacial',
        rated_power_W: panelPower,
        efficiency: 0.22,
        dimensions: { width: 2.0, height: 1.0, depth: 0.04 },
        weight_kg: 20,
        warranty_years: 25,
        temperature_coefficient: -0.0034
      });
    }
    
    // Calculate production
    const dailyProduction = panelCount * panelPower * peakSunHours * systemLosses / 1000; // kWh
    const annualProduction = dailyProduction * 365;
    
    // Installation area
    const panelArea = 2.0 * 1.1; // Panel area + spacing
    const totalArea = panelCount * panelArea;
    
    // Design inverters
    const inverterCount = Math.ceil((panelCount * panelPower) / (10000)); // 10kW inverters
    const inverters: Inverter[] = [];
    for (let i = 0; i < inverterCount; i++) {
      inverters.push({
        id: `inverter_${i + 1}`,
        model: 'SMA Sunny Tripower 10000TL',
        rated_power_kW: 10,
        efficiency: 0.98,
        type: 'string',
        mppt_inputs: 2,
        max_dc_voltage: 1000,
        max_ac_current: 16,
        communication: ['Modbus TCP', 'SMA WebConnect']
      });
    }
    
    return {
      panels,
      inverters,
      tracking: true, // Single-axis tracking for efficiency
      capacity_kW: (panelCount * panelPower) / 1000,
      daily_production_kWh: dailyProduction,
      annual_production_kWh: annualProduction,
      efficiency: 0.22,
      degradation_rate: 0.005, // 0.5% per year
      installation_area_m2: totalArea,
      orientation: 'south',
      tilt_angle: 30 // Optimal for most latitudes
    };
  }

  /**
   * Design wind power system
   */
  private designWindSystem(loadProfile: LoadProfile, facilityData: any): WindSystem {
    console.log('[Energy Agent] Designing wind power system');
    
    // Sizing: Target 30% of peak load from wind
    const targetWindContribution = loadProfile.peak_load * 0.3;
    const capacityFactor = 0.35; // Good wind site
    
    const requiredCapacity = targetWindContribution / capacityFactor;
    
    // Calculate number of turbines
    const turbinePower = 100; // kW (small commercial turbines)
    const turbineCount = Math.ceil(requiredCapacity / turbinePower);
    
    // Generate turbine specifications
    const turbines: WindTurbine[] = [];
    for (let i = 0; i < turbineCount; i++) {
      turbines.push({
        id: `turbine_${i + 1}`,
        model: 'Vergnet GEV MP 100',
        rated_power_kW: turbinePower,
        rotor_diameter: 24,
        hub_height: 30,
        cut_in_speed: 3.5,
        rated_speed: 12,
        cut_out_speed: 25,
        power_curve: [
          { wind_speed: 3.5, power_output: 2 },
          { wind_speed: 5, power_output: 15 },
          { wind_speed: 8, power_output: 45 },
          { wind_speed: 10, power_output: 75 },
          { wind_speed: 12, power_output: 100 },
          { wind_speed: 15, power_output: 100 },
          { wind_speed: 25, power_output: 100 }
        ],
        annual_energy_yield: turbinePower * 8760 * capacityFactor // kWh
      });
    }
    
    // Calculate production
    const annualProduction = turbines.reduce((sum, t) => sum + t.annual_energy_yield, 0);
    const dailyProduction = annualProduction / 365;
    
    return {
      turbines,
      capacity_kW: turbineCount * turbinePower,
      daily_production_kWh: dailyProduction,
      annual_production_kWh: annualProduction,
      capacity_factor: capacityFactor,
      cut_in_speed: 3.5,
      rated_speed: 12,
      cut_out_speed: 25,
      hub_height: 30,
      rotor_diameter: 24,
      swept_area: Math.PI * Math.pow(12, 2) // m²
    };
  }

  /**
   * Design energy storage system (Flywheel + Battery hybrid)
   */
  private designStorageSystem(loadProfile: LoadProfile): StorageSystem {
    console.log('[Energy Agent] Designing energy storage system');
    
    // Primary: Flywheel for high-power, short-duration applications
    const flywheelUnits: FlywheelUnit[] = [];
    const flywheelUnitCount = 4;
    
    for (let i = 0; i < flywheelUnitCount; i++) {
      flywheelUnits.push({
        id: `flywheel_${i + 1}`,
        capacity_kWh: 100,
        max_power_kW: 250,
        rotor_mass: 5000, // kg
        max_rpm: 36000,
        housing_material: 'carbon_fiber_composite',
        vacuum_level: '1e-6_torr',
        magnetic_bearings: true
      });
    }
    
    const flywheelSystem: FlywheelStorage = {
      units: flywheelUnits,
      total_capacity_kWh: flywheelUnitCount * 100,
      max_power_kW: flywheelUnitCount * 250,
      response_time_ms: 4,
      discharge_duration_hours: 0.4, // 100kWh / 250kW
      efficiency: 0.95,
      maintenance_interval_months: 12
    };
    
    // Secondary: Battery for longer duration storage
    const batterySystem: BatteryStorage = {
      chemistry: 'LFP', // Lithium Iron Phosphate
      capacity_kWh: loadProfile.peak_load * 4, // 4 hours of peak load
      max_power_kW: loadProfile.peak_load * 2,
      cycles: 6000,
      depth_of_discharge: 0.8,
      efficiency: 0.92,
      temperature_range: { min: 10, max: 40 },
      fire_suppression: true
    };
    
    return {
      primary: flywheelSystem,
      secondary: batterySystem,
      total_capacity_kWh: flywheelSystem.total_capacity_kWh + batterySystem.capacity_kWh,
      usable_capacity_kWh: flywheelSystem.total_capacity_kWh + (batterySystem.capacity_kWh * batterySystem.depth_of_discharge),
      round_trip_efficiency: 0.88,
      response_time_ms: 4,
      discharge_duration_hours: (flywheelSystem.total_capacity_kWh + batterySystem.capacity_kWh) / loadProfile.peak_load
    };
  }

  /**
   * Design grid connection
   */
  private designGridConnection(loadProfile: LoadProfile): GridConnection {
    console.log('[Energy Agent] Designing grid connection');
    
    // Grid connection sized for 20% of peak load + safety margin
    const gridCapacity = loadProfile.peak_load * 0.25;
    
    return {
      connection_type: 'grid_tie',
      capacity_kW: gridCapacity,
      voltage: '480V',
      frequency: '60Hz',
      import_rate_per_kWh: 0.12,
      export_rate_per_kWh: 0.08,
      net_metering: true,
      demand_charges: true,
      backup_capability: true
    };
  }

  /**
   * Design backup power system
   */
  private designBackupSystem(loadProfile: LoadProfile): BackupSystem {
    console.log('[Energy Agent] Designing backup system');
    
    // Backup for critical loads (computing, security, basic HVAC)
    const criticalLoad = loadProfile.base_load * 1.5;
    
    return {
      type: 'natural_gas',
      capacity_kW: criticalLoad,
      fuel_tank_capacity_liters: 0, // Natural gas line
      runtime_hours: 72, // Unlimited with gas line
      auto_start: true,
      test_schedule: 'weekly',
      maintenance_schedule: 'quarterly'
    };
  }

  /**
   * Calculate system capacity
   */
  private calculateSystemCapacity(solar: SolarSystem, wind: WindSystem, loadProfile: LoadProfile): SystemCapacity {
    const totalRenewable = solar.capacity_kW + wind.capacity_kW;
    
    return {
      total_installed_kW: totalRenewable + 500, // Add buffer
      total_renewable_kW: totalRenewable,
      total_storage_kWh: 400 + loadProfile.peak_load * 4,
      peak_demand_kW: loadProfile.peak_load,
      average_demand_kW: loadProfile.base_load + (loadProfile.peak_load - loadProfile.base_load) * 0.5,
      minimum_demand_kW: loadProfile.base_load,
      load_factor: 0.65,
      diversity_factor: 0.85
    };
  }

  /**
   * Calculate comprehensive efficiency metrics
   */
  private calculateComprehensiveEfficiency(components: any): EfficiencyMetrics {
    const solarEfficiency = components.solar.efficiency * 0.95; // 95% of rated efficiency
    const windEfficiency = 0.35; // Capacity factor
    const storageEfficiency = 0.88;
    const inverterEfficiency = 0.98;
    const transmissionEfficiency = 0.95;
    
    const overallEfficiency = solarEfficiency * windEfficiency * storageEfficiency * 
                              inverterEfficiency * transmissionEfficiency;
    
    return {
      overall_efficiency: overallEfficiency,
      solar_efficiency: solarEfficiency,
      wind_efficiency: windEfficiency,
      storage_efficiency: storageEfficiency,
      inverter_efficiency: inverterEfficiency,
      transmission_efficiency: transmissionEfficiency,
      self_consumption_rate: 0.75,
      grid_independence: 0.65,
      capacity_utilization: 0.78,
      renewable_fraction: 0.70
    };
  }

  /**
   * Design AI integration for energy management
   */
  private designAIIntegration(loadProfile: LoadProfile, facilityData: any): AIIntegration {
    console.log('[Energy Agent] Designing AI integration for facility energy management');
    
    const sensors: EnergySensor[] = [
      {
        id: 'main_power_meter',
        type: 'power_meter',
        location: 'main_distribution_panel',
        sampling_rate_hz: 1,
        accuracy: 0.5,
        calibration_schedule: 'annual'
      },
      {
        id: 'weather_station',
        type: 'weather_station',
        location: 'roof',
        sampling_rate_hz: 0.1,
        accuracy: 2.0,
        calibration_schedule: 'biennial'
      },
      {
        id: 'solar_irradiance',
        type: 'irradiance',
        location: 'solar_array',
        sampling_rate_hz: 1,
        accuracy: 3.0,
        calibration_schedule: 'annual'
      }
    ];
    
    const controlSystems: ControlSystem[] = [
      {
        id: 'solar_mppt_controller',
        type: 'maximum_power_point_tracking',
        control_strategy: 'perturb_and_observe',
        setpoints: { voltage_setpoint: 800, current_limit: 100 },
        response_time_ms: 100,
        communication_protocol: 'Modbus TCP'
      },
      {
        id: 'energy_storage_controller',
        type: 'battery_management_system',
        control_strategy: 'state_of_charge_based',
        setpoints: { max_soc: 0.9, min_soc: 0.2, charge_rate: 0.5 },
        response_time_ms: 10,
        communication_protocol: 'CAN Bus'
      }
    ];
    
    const mlModels: MLModel[] = [
      {
        name: 'load_forecasting',
        purpose: 'Predict hourly energy demand for next 24 hours',
        accuracy: 0.94,
        training_data_period: '2_years',
        update_frequency: 'weekly',
        prediction_horizon: '24_hours'
      },
      {
        name: 'solar_production_forecasting',
        purpose: 'Predict solar power output based on weather',
        accuracy: 0.89,
        training_data_period: '1_year',
        update_frequency: 'daily',
        prediction_horizon: '6_hours'
      },
      {
        name: 'energy_optimization',
        purpose: 'Optimize energy dispatch and storage',
        accuracy: 0.91,
        training_data_period: '6_months',
        update_frequency: 'real_time',
        prediction_horizon: '15_minutes'
      }
    ];
    
    return {
      enabled: true,
      predictive_load_management: true,
      weather_optimization: true,
      demand_response: true,
      anomaly_detection: true,
      optimization_algorithms: ['reinforcement_learning', 'predictive_control', 'genetic_optimization'],
      sensors,
      control_systems: controlSystems,
      ml_models: mlModels
    };
  }

  /**
   * Create comprehensive optimization plan
   */
  private createComprehensiveOptimizationPlan(components: any, loadProfile: LoadProfile): OptimizationPlan {
    console.log('[Energy Agent] Creating comprehensive optimization plan');
    
    const shortTermActions: OptimizationAction[] = [
      {
        id: 'opt_001',
        name: 'Implement AI-based load scheduling',
        description: 'Use ML models to schedule high-power operations during peak solar production',
        priority: 'high',
        estimated_cost: 25000,
        estimated_savings_kWh_year: 15000,
        estimated_savings_cost_year: 1800,
        payback_period_years: 13.9,
        implementation_complexity: 'medium',
        dependencies: ['ai_models_trained', 'control_systems_integrated'],
        status: 'pending'
      },
      {
        id: 'opt_002',
        name: 'Optimize HVAC setpoints',
        description: 'Adjust HVAC temperature setpoints based on occupancy and weather',
        priority: 'high',
        estimated_cost: 5000,
        estimated_savings_kWh_year: 25000,
        estimated_savings_cost_year: 3000,
        payback_period_years: 1.7,
        implementation_complexity: 'low',
        dependencies: ['occupancy_sensors_installed'],
        status: 'pending'
      }
    ];
    
    const mediumTermActions: OptimizationAction[] = [
      {
        id: 'opt_003',
        name: 'Add solar panel tracking',
        description: 'Install single-axis tracking system for 25% more solar production',
        priority: 'medium',
        estimated_cost: 75000,
        estimated_savings_kWh_year: 45000,
        estimated_savings_cost_year: 5400,
        payback_period_years: 13.9,
        implementation_complexity: 'medium',
        dependencies: ['structural_analysis_complete', 'tracking_hardware_procured'],
        status: 'pending'
      },
      {
        id: 'opt_004',
        name: 'Upgrade to bifacial panels',
        description: 'Replace standard panels with bifacial for 10-20% more production',
        priority: 'medium',
        estimated_cost: 100000,
        estimated_savings_kWh_year: 20000,
        estimated_savings_cost_year: 2400,
        payback_period_years: 41.7,
        implementation_complexity: 'medium',
        dependencies: ['current_panels_end_of_life'],
        status: 'pending'
      }
    ];
    
    const longTermActions: OptimizationAction[] = [
      {
        id: 'opt_005',
        name: 'Expand wind capacity',
        description: 'Add 2 additional 100kW wind turbines',
        priority: 'low',
        estimated_cost: 400000,
        estimated_savings_kWh_year: 180000,
        estimated_savings_cost_year: 21600,
        payback_period_years: 18.5,
        implementation_complexity: 'high',
        dependencies: ['wind_resource_assessment', 'zoning_approvals', 'grid_impact_study'],
        status: 'pending'
      }
    ];
    
    const costSavings: CostSavings = {
      annual_energy_savings_kWh: 105000,
      annual_cost_savings: 12600,
      co2_reduction_tons: 52.5,
      roi_percent: 8.5,
      npv_10_year: 45000
    };
    
    const efficiencyTargets: EfficiencyTargets = {
      current_overall_efficiency: 0.75,
      target_overall_efficiency: 0.85,
      current_renewable_fraction: 0.70,
      target_renewable_fraction: 0.85,
      current_grid_independence: 0.65,
      target_grid_independence: 0.80,
      timeline_months: 36
    };
    
    const implementationSchedule: ImplementationSchedule = {
      phase1: {
        name: 'Quick Wins',
        duration_months: 3,
        actions: ['opt_002', 'opt_001'],
        completion_criteria: 'HVAC optimization implemented and AI load scheduling operational',
        estimated_cost: 30000
      },
      phase2: {
        name: 'Solar Enhancement',
        duration_months: 6,
        actions: ['opt_003'],
        completion_criteria: 'Solar tracking system installed and commissioned',
        estimated_cost: 75000
      },
      phase3: {
        name: 'Capacity Expansion',
        duration_months: 12,
        actions: ['opt_005', 'opt_004'],
        completion_criteria: 'Wind turbines installed and bifacial panels operational',
        estimated_cost: 500000
      },
      milestones: [
        {
          name: 'Phase 1 Complete',
          target_date: '2024-04-30',
          criteria: ['HVAC optimization deployed', 'AI models trained', 'Energy savings measured'],
          deliverables: ['HVAC optimization report', 'AI model performance metrics']
        },
        {
          name: 'Phase 2 Complete',
          target_date: '2024-10-31',
          criteria: ['Solar tracking installed', 'Production increase verified', 'ROI analysis complete'],
          deliverables: ['Solar tracking commissioning report', 'Production comparison analysis']
        },
        {
          name: 'Phase 3 Complete',
          target_date: '2025-10-31',
          criteria: ['Wind turbines operational', 'Bifacial panels installed', '80% grid independence achieved'],
          deliverables: ['Wind turbine commissioning report', 'System performance validation']
        }
      ]
    };
    
    return {
      short_term: shortTermActions,
      medium_term: mediumTermActions,
      long_term: longTermActions,
      cost_savings_projection: costSavings,
      efficiency_targets: efficiencyTargets,
      implementation_schedule: implementationSchedule
    };
  }

  // ============================================================================
  // PUBLIC API METHODS
  // ============================================================================

  /**
   * Get energy system by ID
   */
  public getEnergySystem(systemId: string): EnergySystem | undefined {
    return this.energySystems.get(systemId);
  }

  /**
   * Get all energy systems
   */
  public getAllEnergySystems(): EnergySystem[] {
    return Array.from(this.energySystems.values());
  }

  /**
   * Get load profile
   */
  public getLoadProfile(profileId: string): LoadProfile | undefined {
    return this.loadProfiles.get(profileId);
  }

  /**
   * Simulate energy production
   */
  public simulateEnergyProduction(systemId: string, duration: number): any {
    const system = this.energySystems.get(systemId);
    if (!system) throw new Error('Energy system not found');
    
    // This would run a detailed simulation
    return {
      system_id: systemId,
      duration_hours: duration,
      estimated_production_kWh: system.components.solar.daily_production_kWh * (duration / 24) +
                                 system.components.wind.daily_production_kWh * (duration / 24),
      estimated_consumption_kWh: system.load_profile.peak_load * duration * 0.7,
      net_energy_kWh: 0 // Would be calculated
    };
  }

  /**
   * Get system status summary
   */
  public getSystemStatus(): any {
    return {
      energy_systems: this.energySystems.size,
      load_profiles: this.loadProfiles.size,
      optimization_history_count: this.optimizationHistory.length,
      latest_optimization: this.optimizationHistory[this.optimizationHistory.length - 1]
    };
  }
}