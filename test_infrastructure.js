// Test ProtoForge Infrastructure System
// Demonstrates the Industrial Organism concept

const ProtoForgeInfrastructure = require('./modules/protoforge-infrastructure');

async function testInfrastructure() {
  console.log('=== Testing ProtoForge Infrastructure ===\n');
  
  // Initialize infrastructure
  const infra = new ProtoForgeInfrastructure();
  
  // Wait for initialization
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log('1. Digital Twin - Scaffold Mapping');
  console.log(`   Total coordinate points: ${infra.scaffold.size}`);
  console.log(`   Grid resolution: 10cm`);
  console.log(`   Workspace: 2m x 2m x 1m\n`);
  
  // Calibrate a point
  const points = Array.from(infra.scaffold.keys());
  const testPoint = points[0];
  
  console.log('2. Calibrating scaffold point...');
  await infra.calibratePoint(testPoint, { x: 0.1, y: 0.1, z: 0.1 });
  console.log(`   Point calibrated: ${testPoint.substring(0, 8)}...\n`);
  
  console.log('3. DC Microgrid Status');
  infra.dcMicrogrid.forEach((zone, id) => {
    console.log(`   ${id}: ${zone.voltage}V @ ${zone.current.toFixed(1)}A (${zone.utilization.toFixed(1)}% load)`);
  });
  console.log(`   Total power: ${Array.from(infra.dcMicrogrid.values()).reduce((sum, z) => sum + z.power, 0).toFixed(1)}W\n`);
  
  console.log('4. Thermal/Plumbing Status');
  infra.plumbing.forEach((zone, id) => {
    console.log(`   ${id}: ${zone.temp.toFixed(1)}°C, ${zone.flow.toFixed(1)}L/min @ ${zone.pressure.toFixed(1)} PSI`);
  });
  console.log(`   Average temperature: ${(Array.from(infra.plumbing.values()).reduce((sum, z) => sum + z.temp, 0) / infra.plumbing.size).toFixed(1)}°C\n`);
  
  console.log('5. Revenue Tracking - Industrial Organism in Action');
  
  // Track revenue from different layers
  infra.trackRevenue('scaffold', 500, 'Aerospace Part Manufacturing', 'High-tolerance bracket');
  infra.trackRevenue('wiring', 200, 'Compute-as-a-Service', 'AI processing for external client');
  infra.trackRevenue('plumbing', 150, 'Continuous Operation', '24/7 printing service');
  
  console.log('   Revenue events tracked:');
  console.log(`   - Scaffold: $500 (Aerospace parts)`);
  console.log(`   - Wiring: $200 (Cloud compute)`);
  console.log(`   - Plumbing: $150 (Continuous operation)`);
  console.log(`   Total Revenue: $${infra.getTotalRevenue()}\n`);
  
  console.log('6. System Health & Efficiency');
  const health = infra.getHealthSummary();
  console.log(`   Overall Status: ${health.overall.toUpperCase()}`);
  console.log(`   Power Health: ${health.power.health.toFixed(1)}%`);
  console.log(`   Thermal Health: ${health.thermal.health.toFixed(1)}%`);
  console.log(`   Scaffold Calibration: ${health.scaffold.calibration.toFixed(1)}%`);
  console.log(`   System Efficiency: ${health.efficiency.toFixed(1)}%`);
  console.log(`   Net Profit: $${(health.revenue.scaffold.revenue + health.revenue.wiring.revenue + health.revenue.plumbing.revenue - 
                           health.revenue.scaffold.maintenance - health.revenue.wiring.maintenance - health.revenue.plumbing.maintenance).toFixed(2)}\n`);
  
  // Simulate an infrastructure alert
  console.log('7. Infrastructure Alert Simulation');
  
  // Trigger a power alert
  const powerZone = infra.getPowerZone('laser_system');
  if (powerZone) {
    powerZone.utilization = 95; // High utilization
    console.log('   Simulating high power utilization...');
    
    // Wait for alert to be processed
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log(`   Power alerts: ${powerZone.alerts.length}`);
    if (powerZone.alerts.length > 0) {
      console.log(`   Latest: ${powerZone.alerts[powerZone.alerts.length - 1].message}`);
    }
  }
  
  console.log('\n8. Maintenance Scheduling');
  const maintenance = infra.scheduleMaintenance('power', 'laser_system', 'Replace power supply', 250);
  console.log(`   Scheduled: ${maintenance.task}`);
  console.log(`   Estimated cost: $${maintenance.estimatedCost}`);
  console.log(`   Status: ${maintenance.status}\n`);
  
  console.log('=== Infrastructure Test Complete ===');
  console.log('The Industrial Organism is alive and generating revenue!');
  console.log('Every pipe, wire, and strut serves dual purpose:');
  console.log('- Physical support + Data conduit');
  console.log('- Power distribution + Revenue generation');
  console.log('- Thermal management + Continuous operation');
}

// Run the test
testInfrastructure().catch(console.error);
