#!/usr/bin/env node

/**
 * CHAOS ENGINEERING RUNTIME
 * 
 * This doesn't test Heidi in isolation.
 * It runs Heidi while actively breaking things around her.
 * 
 * Because the real test isn't "can she boot?"
 * It's "can she survive when the universe is actively trying to kill her?"
 */

const HeidiSelfLaunchProtocol = require('./HeidiSelfLaunchProtocol');
const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');

class ChaosEngineeringRuntime extends EventEmitter {
  constructor() {
    super();
    this.heidi = null;
    this.chaosMonkeys = [];
    this.runtimeStats = {
      crashes: 0,
      recoveries: 0,
      corruption_events: 0,
      drift_escalations: 0,
      uptime: 0,
      mean_time_to_recovery: 0
    };
    this.isRunning = false;
  }

  /**
   * Start Heidi under chaos conditions
   */
  async startUnderChaos(duration = 60000) {
    console.log('🌪️  STARTING HEIDI UNDER CHAOS CONDITIONS');
    console.log('==========================================');
    console.log(`Duration: ${duration}ms`);
    console.log('Chaos Level: MAXIMUM');
    console.log('');

    this.isRunning = true;
    const startTime = Date.now();
    
    // Launch Heidi
    console.log('🚀 Launching Heidi...');
    this.heidi = new HeidiSelfLaunchProtocol();
    
    // Wire up chaos monkeys before launch
    this.deployChaosMonkeys();
    
    // Start the chaos
    this.startChaosEngine();
    
    // Launch Heidi
    const launchResult = await this.heidi.launch('manual');
    
    if (!launchResult.success) {
      console.log('❌ Heidi failed to launch under chaos');
      this.runtimeStats.crashes++;
      return false;
    }
    
    console.log('✅ Heidi launched successfully under chaos');
    
    // Monitor for the specified duration
    await this.monitorUnderChaos(duration);
    
    // Stop chaos and cleanup
    await this.stopChaos();
    
    // Calculate final stats
    this.runtimeStats.uptime = Date.now() - startTime;
    
    this.printFinalReport();
    
    return this.runtimeStats.crashes < 5; // Survived if less than 5 crashes
  }

  /**
   * Deploy chaos monkeys - agents that actively break things
   */
  deployChaosMonkeys() {
    console.log('🐵 Deploying chaos monkeys...');

    // Memory corruption monkey
    this.chaosMonkeys.push({
      name: 'MemoryCorruptor',
      interval: null,
      execute: async () => {
        if (this.heidi && this.heidi.state) {
          // Randomly corrupt memory entries
          if (Math.random() < 0.3) {
            await this.corruptRandomMemory();
            this.runtimeStats.corruption_events++;
            console.log('🦠 Memory corruption event');
          }
        }
      }
    });

    // Configuration drift monkey
    this.chaosMonkeys.push({
      name: 'ConfigDrifter',
      interval: null,
      execute: async () => {
        if (this.heidi && this.heidi.config) {
          // Slowly drift configuration values
          const keys = Object.keys(this.heidi.config);
          const keyToCorrupt = keys[Math.floor(Math.random() * keys.length)];
          
          if (typeof this.heidi.config[keyToCorrupt] === 'number') {
            const drift = (Math.random() - 0.5) * 0.1; // ±5% drift
            this.heidi.config[keyToCorrupt] *= (1 + drift);
            console.log(`🌊 Config drift: ${keyToCorrupt}`);
          }
        }
      }
    });

    // Network partition monkey
    this.chaosMonkeys.push({
      name: 'NetworkPartitioner',
      interval: null,
      execute: async () => {
        // Simulate network issues
        if (Math.random() < 0.2) {
          console.log('🌐 Simulating network partition...');
          // This would affect external calls in a real system
          await this.simulateNetworkPartition();
        }
      }
    });

    // Resource exhaustion monkey
    this.chaosMonkeys.push({
      name: 'ResourceExhaustor',
      interval: null,
      execute: async () => {
        // Consume memory randomly
        if (Math.random() < 0.15) {
          const memoryHog = new Array(100000).fill(Math.random());
          setTimeout(() => {
            // Clean up after a short time
            memoryHog.length = 0;
          }, 5000);
          console.log('🔋 Resource exhaustion event');
        }
      }
    });

    // Task queue poison monkey
    this.chaosMonkeys.push({
      name: 'TaskQueuePoisoner',
      interval: null,
      execute: async () => {
        if (this.heidi && this.heidi.state && this.heidi.state.task_queue) {
          // Add poison tasks
          this.heidi.state.task_queue.push({
            id: 'poison_' + Date.now(),
            title: 'Poison Task',
            status: 'pending',
            priority: 'high',
            malicious: true,
            createdAt: new Date().toISOString()
          });
          console.log('☠️  Poison task injected');
        }
      }
    });
  }

  /**
   * Start the chaos engine
   */
  startChaosEngine() {
    console.log('⚡ Starting chaos engine...');

    // Start each monkey with random intervals
    this.chaosMonkeys.forEach(monkey => {
      const interval = 1000 + Math.random() * 4000; // 1-5 seconds
      monkey.interval = setInterval(() => {
        if (this.isRunning) {
          monkey.execute().catch(error => {
            console.log(`💥 Chaos monkey ${monkey.name} failed:`, error.message);
          });
        }
      }, interval);
      
      console.log(`🐵 ${monkey.name} deployed (interval: ${interval}ms)`);
    });

    // Start drift escalation monitor
    this.driftMonitor = setInterval(() => {
      if (this.heidi && this.isRunning) {
        this.monitorDriftEscalation();
      }
    }, 2000);
  }

  /**
   * Monitor Heidi under chaos conditions
   */
  async monitorUnderChaos(duration) {
    console.log(`👁️  Monitoring Heidi for ${duration}ms...`);
    
    const endTime = Date.now() + duration;
    let lastCrashTime = 0;
    
    while (Date.now() < endTime && this.isRunning) {
      await this.sleep(1000);
      
      // Check if Heidi is still responsive
      const isHealthy = await this.checkHeidiHealth();
      
      if (!isHealthy) {
        const crashTime = Date.now();
        this.runtimeStats.crashes++;
        
        if (lastCrashTime > 0) {
          const recoveryTime = crashTime - lastCrashTime;
          this.runtimeStats.mean_time_to_recovery = 
            (this.runtimeStats.mean_time_to_recovery + recoveryTime) / 2;
        }
        
        console.log(`💥 Heidi crash detected! Total crashes: ${this.runtimeStats.crashes}`);
        
        // Attempt recovery
        const recovered = await this.attemptRecovery();
        if (recovered) {
          this.runtimeStats.recoveries++;
          lastCrashTime = Date.now();
          console.log('🔄 Heidi recovered successfully');
        } else {
          console.log('❌ Heidi failed to recover - stopping chaos test');
          break;
        }
      }
      
      // Log periodic status
      if (Date.now() % 10000 < 1000) {
        this.logSystemStatus();
      }
    }
  }

  /**
   * Check Heidi's health under chaos
   */
  async checkHeidiHealth() {
    if (!this.heidi) return false;
    
    try {
      const status = this.heidi.getStatus();
      
      // Check for critical conditions
      if (status.HEIDI_STATUS === 'SHUTDOWN') return false;
      if (status.drift_score > 0.9) return false;
      if (status.boot_phase === 0 && status.HEIDI_STATUS !== 'DORMANT') return false;
      
      return true;
    } catch (error) {
      console.log('Health check failed:', error.message);
      return false;
    }
  }

  /**
   * Attempt recovery from crash
   */
  async attemptRecovery() {
    console.log('🏥 Attempting recovery...');
    
    try {
      // Create new Heidi instance
      this.heidi = new HeidiSelfLaunchProtocol();
      
      // Reduce chaos temporarily for recovery
      this.temporaryChaosReduction();
      
      // Attempt relaunch
      const result = await this.heidi.launch('manual');
      
      // Restore chaos levels
      this.restoreChaosLevels();
      
      return result.success;
    } catch (error) {
      console.log('Recovery failed:', error.message);
      return false;
    }
  }

  /**
   * Monitor drift escalation
   */
  monitorDriftEscalation() {
    if (!this.heidi || !this.heidi.state) return;
    
    const currentDrift = this.heidi.state.drift_score || 0;
    
    if (currentDrift > 0.7) {
      this.runtimeStats.drift_escalations++;
      console.log(`📈 Drift escalation: ${currentDrift.toFixed(2)}`);
      
      // Trigger emergency response if drift is critical
      if (currentDrift > 0.9) {
        console.log('🚨 CRITICAL DRIFT - Triggering emergency response');
        this.triggerEmergencyResponse();
      }
    }
  }

  /**
   * Trigger emergency response to critical conditions
   */
  triggerEmergencyResponse() {
    console.log('🚨 EMERGENCY RESPONSE ACTIVATED');
    
    // Temporarily stop all chaos monkeys
    this.chaosMonkeys.forEach(monkey => {
      if (monkey.interval) {
        clearInterval(monkey.interval);
        monkey.interval = null;
      }
    });
    
    // Wait for system to stabilize
    setTimeout(() => {
      console.log('🔄 Restarting chaos monkeys at reduced intensity');
      this.startChaosEngine(); // Restart with normal intervals
    }, 5000);
  }

  /**
   * Chaos monkey actions
   */
  async corruptRandomMemory() {
    if (!this.heidi.state.memory_snapshots) {
      this.heidi.state.memory_snapshots = {};
    }
    
    const keys = Object.keys(this.heidi.state.memory_snapshots);
    if (keys.length === 0) return;
    
    const keyToCorrupt = keys[Math.floor(Math.random() * keys.length)];
    const snapshot = this.heidi.state.memory_snapshots[keyToCorrupt];
    
    if (snapshot) {
      // Partial corruption - flip some bits
      if (snapshot.data && typeof snapshot.data === 'string') {
        const data = snapshot.data;
        const corruptIndex = Math.floor(Math.random() * data.length);
        snapshot.data = data.substring(0, corruptIndex) + 
                       String.fromCharCode(data.charCodeAt(corruptIndex) ^ 0xFF) +
                       data.substring(corruptIndex + 1);
      }
    }
  }

  async simulateNetworkPartition() {
    // In a real system, this would affect network calls
    // For simulation, we'll just log it
    console.log('🌐 Network partition active for 3 seconds');
    
    // Temporarily disable external calls
    const originalCheck = this.heidi.checkNetwork;
    this.heidi.checkNetwork = () => Promise.resolve(false);
    
    // Restore after 3 seconds
    setTimeout(() => {
      this.heidi.checkNetwork = originalCheck;
      console.log('🌐 Network partition resolved');
    }, 3000);
  }

  temporaryChaosReduction() {
    console.log('🛡️  Reducing chaos for recovery...');
    
    // Increase intervals to reduce chaos frequency
    this.chaosMonkeys.forEach(monkey => {
      if (monkey.interval) {
        clearInterval(monkey.interval);
        const newInterval = (10000 + Math.random() * 10000); // 10-20 seconds
        monkey.interval = setInterval(() => {
          if (this.isRunning) {
            monkey.execute().catch(error => {
              console.log(`💥 Chaos monkey ${monkey.name} failed:`, error.message);
            });
          }
        }, newInterval);
      }
    });
  }

  restoreChaosLevels() {
    console.log('🌪️  Restoring normal chaos levels...');
    this.startChaosEngine();
  }

  logSystemStatus() {
    if (!this.heidi) return;
    
    const status = this.heidi.getStatus();
    const memUsage = process.memoryUsage();
    
    console.log(`📊 Status: ${status.HEIDI_STATUS} | Drift: ${(status.drift_score || 0).toFixed(2)} | Memory: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB`);
  }

  /**
   * Stop chaos and cleanup
   */
  async stopChaos() {
    console.log('🛑 Stopping chaos engine...');
    
    this.isRunning = false;
    
    // Stop all chaos monkeys
    this.chaosMonkeys.forEach(monkey => {
      if (monkey.interval) {
        clearInterval(monkey.interval);
      }
    });
    
    // Stop drift monitor
    if (this.driftMonitor) {
      clearInterval(this.driftMonitor);
    }
    
    // Shutdown Heidi
    if (this.heidi) {
      await this.heidi.shutdown();
    }
    
    console.log('✅ Chaos engine stopped');
  }

  /**
   * Print final chaos report
   */
  printFinalReport() {
    console.log('\n📊 CHAOS ENGINEERING REPORT');
    console.log('============================');
    console.log(`Uptime: ${(this.runtimeStats.uptime / 1000).toFixed(1)}s`);
    console.log(`Crashes: ${this.runtimeStats.crashes}`);
    console.log(`Recoveries: ${this.runtimeStats.recoveries}`);
    console.log(`Corruption Events: ${this.runtimeStats.corruption_events}`);
    console.log(`Drift Escalations: ${this.runtimeStats.drift_escalations}`);
    console.log(`Mean Time to Recovery: ${(this.runtimeStats.mean_time_to_recovery / 1000).toFixed(1)}s`);
    
    const survivalRate = this.runtimeStats.crashes === 0 ? 100 : 
                         Math.max(0, 100 - (this.runtimeStats.crashes * 20));
    
    console.log(`\n🎯 Survival Rate: ${survivalRate}%`);
    
    if (survivalRate >= 80) {
      console.log('🎉 Heidi demonstrates strong resilience under chaos!');
    } else if (survivalRate >= 60) {
      console.log('⚠️  Heidi shows moderate resilience - needs improvement');
    } else {
      console.log('❌ Heidi has poor resilience under chaos conditions');
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run chaos engineering if this file is executed directly
if (require.main === module) {
  const runtime = new ChaosEngineeringRuntime();
  const duration = parseInt(process.argv[2]) || 60000; // Default 60 seconds
  
  runtime.startUnderChaos(duration).catch(error => {
    console.error('💥 Chaos engineering runtime failed:', error);
    process.exit(1);
  });
}

module.exports = ChaosEngineeringRuntime;
