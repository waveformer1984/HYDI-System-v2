// ProtoForge Infrastructure Manager
// Digital Twin and Physical Asset Management for the Industrial Organism

const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../src/database');

class ProtoForgeInfrastructure extends EventEmitter {
  constructor() {
    super();
    
    // Infrastructure layers
    this.scaffold = new Map(); // UUID -> physical coordinate data
    this.dcMicrogrid = new Map(); // Circuit -> power data
    this.plumbing = new Map(); // Zone -> thermal/pneumatic data
    this.nervousSystem = new Map(); // Node -> network/data integrity
    
    // Revenue tracking per layer
    this.revenueStreams = {
      scaffold: { maintenance: 0, revenue: 0 },
      wiring: { maintenance: 0, revenue: 0 },
      plumbing: { maintenance: 0, revenue: 0 }
    };
    
    // System health
    this.healthStatus = {
      overall: 'operational',
      criticalAlerts: [],
      maintenanceSchedule: new Map(),
      uptime: {
        scaffold: Date.now(),
        wiring: Date.now(),
        plumbing: Date.now()
      }
    };
    
    // Initialize infrastructure monitoring
    this.initializeDigitalTwin();
    this.startInfrastructureMonitoring();
  }
  
  /**
   * Initialize the Digital Twin - Scaffold Mapping
   */
  async initializeDigitalTwin() {
    console.log('[INFRA] Initializing Digital Twin scaffold mapping...');
    
    // Define the scaffold grid (example: 2m x 2m x 1m workspace)
    const gridSize = { x: 2000, y: 2000, z: 1000 }; // mm
    const resolution = 100; // 10cm grid
    
    for (let x = 0; x <= gridSize.x; x += resolution) {
      for (let y = 0; y <= gridSize.y; y += resolution) {
        for (let z = 0; z <= gridSize.z; z += resolution) {
          const pointId = uuidv4();
          this.scaffold.set(pointId, {
            coordinates: { x, y, z },
            type: 'grid_point',
            calibrated: false,
            lastCalibrated: null,
            attachedComponents: [],
            vibrationLevel: 0,
            temperature: 20
          });
        }
      }
    }
    
    console.log(`[INFRA] Digital Twin initialized: ${this.scaffold.size} coordinate points`);
    
    // Load existing calibration data
    await this.loadCalibrationData();
  }
  
  /**
   * Calibrate a scaffold point
   */
  async calibratePoint(pointId, actualPosition) {
    const point = this.scaffold.get(pointId);
    if (!point) {
      throw new Error(`Point ${pointId} not found in scaffold`);
    }
    
    const offset = {
      x: actualPosition.x - point.coordinates.x,
      y: actualPosition.y - point.coordinates.y,
      z: actualPosition.z - point.coordinates.z
    };
    
    point.calibrated = true;
    point.offset = offset;
    point.lastCalibrated = new Date().toISOString();
    
    // Persist calibration
    await this.persistCalibration(pointId, point);
    
    this.emit('point_calibrated', { pointId, offset });
    
    return point;
  }
  
  /**
   * Initialize DC Microgrid monitoring
   */
  initializeDCMicrogrid() {
    console.log('[INFRA] Initializing 48V DC Microgrid monitoring...');
    
    // Define power zones
    const powerZones = [
      { id: 'primary_bus', voltage: 48, current: 0, capacity: 1000 },
      { id: 'compute_nodes', voltage: 48, current: 0, capacity: 200 },
      { id: 'stepper_motors', voltage: 48, current: 0, capacity: 500 },
      { id: 'laser_system', voltage: 48, current: 0, capacity: 300 },
      { id: 'emergency_backup', voltage: 48, current: 0, capacity: 1000 }
    ];
    
    powerZones.forEach(zone => {
      this.dcMicrogrid.set(zone.id, {
        ...zone,
        health: 'optimal',
        lastUpdate: new Date().toISOString(),
        alerts: []
      });
    });
    
    // Start power monitoring
    this.startPowerMonitoring();
  }
  
  /**
   * Monitor power consumption and health
   */
  startPowerMonitoring() {
    setInterval(() => {
      this.dcMicrogrid.forEach((zone, id) => {
        // Simulate power readings
        zone.current = Math.random() * zone.capacity * 0.8;
        zone.power = zone.voltage * zone.current;
        zone.utilization = (zone.current / zone.capacity) * 100;
        
        // Check for issues
        if (zone.utilization > 90) {
          this.handlePowerAlert(id, 'high_utilization', `Zone ${id} at ${zone.utilization.toFixed(1)}% capacity`);
        }
        
        if (zone.voltage < 45) {
          this.handlePowerAlert(id, 'undervoltage', `Zone ${id} voltage: ${zone.voltage}V`);
        }
        
        zone.lastUpdate = new Date().toISOString();
      });
      
      // Emit power status
      this.emit('power_update', {
        totalPower: Array.from(this.dcMicrogrid.values()).reduce((sum, z) => sum + z.power, 0),
        zones: Object.fromEntries(this.dcMicrogrid)
      });
    }, 1000); // Update every second
  }
  
  /**
   * Initialize Plumbing/Thermal Management
   */
  initializePlumbing() {
    console.log('[INFRA] Initializing Thermal Management and Plumbing...');
    
    const thermalZones = [
      { id: 'compute_cooling', temp: 20, flow: 5, pressure: 90 },
      { id: 'motor_cooling', temp: 25, flow: 8, pressure: 95 },
      { id: 'laser_cooling', temp: 18, flow: 3, pressure: 100 },
      { id: 'ambient', temp: 22, flow: 0, pressure: 101 }
    ];
    
    thermalZones.forEach(zone => {
      this.plumbing.set(zone.id, {
        ...zone,
        fluidLevel: 100,
        filterLife: 100,
        lastMaintenance: new Date().toISOString(),
        alerts: []
      });
    });
    
    // Start thermal monitoring
    this.startThermalMonitoring();
  }
  
  /**
   * Monitor thermal and pneumatic systems
   */
  startThermalMonitoring() {
    setInterval(() => {
      this.plumbing.forEach((zone, id) => {
        // Simulate sensor readings
        zone.temp += (Math.random() - 0.5) * 2;
        zone.flow += (Math.random() - 0.5) * 0.5;
        zone.pressure += (Math.random() - 0.5) * 2;
        
        // Check for issues
        if (zone.temp > 35) {
          this.handleThermalAlert(id, 'overheating', `Zone ${id} temperature: ${zone.temp.toFixed(1)}°C`);
        }
        
        if (zone.pressure < 85) {
          this.handleThermalAlert(id, 'low_pressure', `Zone ${id} pressure: ${zone.pressure.toFixed(1)} PSI`);
        }
        
        if (zone.filterLife < 20) {
          this.handleThermalAlert(id, 'filter_replacement', `Zone ${id} filter life: ${zone.filterLife.toFixed(1)}%`);
        }
      });
      
      // Emit thermal status
      this.emit('thermal_update', {
        avgTemp: Array.from(this.plumbing.values()).reduce((sum, z) => sum + z.temp, 0) / this.plumbing.size,
        zones: Object.fromEntries(this.plumbing)
      });
    }, 2000); // Update every 2 seconds
  }
  
  /**
   * Handle power alerts
   */
  handlePowerAlert(zoneId, type, message) {
    const zone = this.dcMicrogrid.get(zoneId);
    const alert = {
      id: uuidv4(),
      type,
      message,
      timestamp: new Date().toISOString(),
      severity: type === 'undervoltage' ? 'critical' : 'warning'
    };
    
    zone.alerts.push(alert);
    zone.health = alert.severity === 'critical' ? 'critical' : 'degraded';
    
    this.emit('infrastructure_alert', {
      layer: 'power',
      zoneId,
      alert
    });
    
    // Track maintenance cost
    this.revenueStreams.wiring.maintenance += 50; // Estimated repair cost
    
    console.log(`[INFRA] Power Alert [${zoneId}]: ${message}`);
  }
  
  /**
   * Handle thermal alerts
   */
  handleThermalAlert(zoneId, type, message) {
    const zone = this.plumbing.get(zoneId);
    const alert = {
      id: uuidv4(),
      type,
      message,
      timestamp: new Date().toISOString(),
      severity: type === 'overheating' ? 'critical' : 'warning'
    };
    
    zone.alerts.push(alert);
    
    this.emit('infrastructure_alert', {
      layer: 'plumbing',
      zoneId,
      alert
    });
    
    // Track maintenance cost
    this.revenueStreams.plumbing.maintenance += 25; // Estimated maintenance cost
    
    console.log(`[INFRA] Thermal Alert [${zoneId}]: ${message}`);
  }
  
  /**
   * Track revenue generation by infrastructure layer
   */
  trackRevenue(layer, amount, source) {
    this.revenueStreams[layer].revenue += amount;
    
    this.emit('revenue_tracked', {
      layer,
      amount,
      source,
      timestamp: new Date().toISOString(),
      totalRevenue: this.getTotalRevenue()
    });
    
    console.log(`[INFRA] Revenue: $${amount} from ${source} (${layer})`);
  }
  
  /**
   * Get total revenue across all layers
   */
  getTotalRevenue() {
    return Object.values(this.revenueStreams)
      .reduce((sum, stream) => sum + stream.revenue, 0);
  }
  
  /**
   * Get infrastructure health summary
   */
  getHealthSummary() {
    const powerHealth = Array.from(this.dcMicrogrid.values())
      .filter(z => z.health === 'optimal').length / this.dcMicrogrid.size;
    
    const thermalAlerts = Array.from(this.plumbing.values())
      .reduce((sum, z) => sum + z.alerts.length, 0);
    
    const scaffoldCalibration = Array.from(this.scaffold.values())
      .filter(p => p.calibrated).length / this.scaffold.size;
    
    return {
      overall: powerHealth > 0.8 && thermalAlerts === 0 ? 'operational' : 'degraded',
      power: {
        health: powerHealth * 100,
        zones: this.dcMicrogrid.size,
        alerts: Array.from(this.dcMicrogrid.values()).reduce((sum, z) => sum + z.alerts.length, 0)
      },
      thermal: {
        health: Math.max(0, 100 - thermalAlerts * 10),
        zones: this.plumbing.size,
        alerts: thermalAlerts
      },
      scaffold: {
        calibration: scaffoldCalibration * 100,
        points: this.scaffold.size,
        vibrationLevel: this.getAverageVibration()
      },
      revenue: this.revenueStreams,
      efficiency: this.calculateEfficiency()
    };
  }
  
  /**
   * Calculate system efficiency
   */
  calculateEfficiency() {
    const totalMaintenance = Object.values(this.revenueStreams)
      .reduce((sum, stream) => sum + stream.maintenance, 0);
    
    const totalRevenue = this.getTotalRevenue();
    
    if (totalRevenue === 0) return 100; // No revenue yet, assume 100% efficient
    
    return Math.max(0, ((totalRevenue - totalMaintenance) / totalRevenue) * 100);
  }
  
  /**
   * Get average vibration level
   */
  getAverageVibration() {
    const values = Array.from(this.scaffold.values()).map(p => p.vibrationLevel);
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }
  
  /**
   * Schedule maintenance
   */
  scheduleMaintenance(layer, zoneId, task, estimatedCost) {
    const maintenance = {
      id: uuidv4(),
      layer,
      zoneId,
      task,
      estimatedCost,
      scheduled: new Date().toISOString(),
      status: 'scheduled'
    };
    
    if (!this.healthStatus.maintenanceSchedule.has(layer)) {
      this.healthStatus.maintenanceSchedule.set(layer, []);
    }
    
    this.healthStatus.maintenanceSchedule.get(layer).push(maintenance);
    
    this.emit('maintenance_scheduled', maintenance);
    
    return maintenance;
  }
  
  /**
   * Start comprehensive infrastructure monitoring
   */
  startInfrastructureMonitoring() {
    console.log('[INFRA] Starting infrastructure monitoring...');
    
    // Initialize all systems
    this.initializeDCMicrogrid();
    this.initializePlumbing();
    
    // Health check every 30 seconds
    setInterval(() => {
      const health = this.getHealthSummary();
      this.emit('health_update', health);
      
      if (health.overall !== 'operational') {
        console.log(`[INFRA] System health: ${health.overall}`);
      }
    }, 30000);
  }
  
  /**
   * Database operations
   */
  async persistCalibration(pointId, data) {
    try {
      await supabase.from('infrastructure_calibration').upsert({
        point_id: pointId,
        data: data,
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('[INFRA] Failed to persist calibration:', error);
    }
  }
  
  async loadCalibrationData() {
    try {
      const { data } = await supabase
        .from('infrastructure_calibration')
        .select('*');
      
      data.forEach(record => {
        const point = this.scaffold.get(record.point_id);
        if (point) {
          Object.assign(point, record.data);
        }
      });
      
      console.log(`[INFRA] Loaded ${data.length} calibration points`);
    } catch (error) {
      console.log('[INFRA] No existing calibration data found');
    }
  }
  
  // Public API
  getScaffoldPoint(pointId) {
    return this.scaffold.get(pointId);
  }
  
  getPowerZone(zoneId) {
    return this.dcMicrogrid.get(zoneId);
  }
  
  getThermalZone(zoneId) {
    return this.plumbing.get(zoneId);
  }
  
  getAllInfrastructure() {
    return {
      scaffold: Object.fromEntries(this.scaffold),
      power: Object.fromEntries(this.dcMicrogrid),
      thermal: Object.fromEntries(this.plumbing),
      health: this.getHealthSummary()
    };
  }
}

module.exports = ProtoForgeInfrastructure;
