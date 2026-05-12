// Self-Aware State Loop - HEIDI System Monitoring
require('dotenv').config();

class SelfAwareState {
  constructor() {
    this.heidi = null;
    this.eventPipeline = null;
    this.ursula = null;
    this.systemMap = null;
    
    this.state = {
      initialized: false,
      lastUpdate: null,
      systemHealth: {
        heidi: 'unknown',
        eventPipeline: 'unknown',
        ursula: 'unknown',
        knowledgeBase: 'unknown'
      },
      moduleStatus: new Map(),
      eventThroughput: {
        total: 0,
        perSecond: 0,
        lastMinute: 0,
        lastHour: 0
      },
      performance: {
        avgResponseTime: 0,
        totalResponseTime: 0,
        responseCount: 0
      },
      errors: [],
      alerts: []
    };
    
    this.monitoring = false;
    this.monitorInterval = 30000; // 30 seconds
    this.monitorTimer = null;
  }

  async initialize() {
    console.log('=== SELF-AWARE STATE LOOP INITIALIZATION ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      // Load system components
      await this.loadSystemComponents();
      
      // Initialize monitoring
      await this.initializeMonitoring();
      
      // Perform initial health check
      await this.performHealthCheck();
      
      this.state.initialized = true;
      this.state.lastUpdate = new Date().toISOString();
      
      console.log('=== SELF-AWARE STATE LOOP INITIALIZATION COMPLETE ===');
      
      return this.state;
      
    } catch (error) {
      console.log(`Self-aware state initialization failed: ${error.message}`);
      throw error;
    }
  }

  async loadSystemComponents() {
    console.log('Loading system components...');
    
    try {
      // Load HEIDI
      const { HeidiCore } = require('./heidi-core');
      this.heidi = new HeidiCore();
      
              await this.heidi.initialize();
      }
      
      console.log('HEIDI: loaded');
      
      // Load Event Pipeline
      const { EventPipeline } = require('./event-pipeline');
      this.eventPipeline = new EventPipeline();
      
      if (!this.eventPipeline.getState().initialized) {
        await this.eventPipeline.initialize();
      }
      
      console.log('Event Pipeline: loaded');
      
      // Load Ursula Compatibility
      const { UrsulaCompatibility } = require('./ursula-compatibility');
      this.ursula = new UrsulaCompatibility();
      
      if (!this.ursula.getStatus().initialized) {
        await this.ursula.initialize();
      }
      
      console.log('Ursula Compatibility: loaded');
      
      // Load System Map
      const fs = require('fs');
      const path = require('path');
      
      const mapPath = path.join(process.cwd(), 'system-map.json');
      
      if (fs.existsSync(mapPath)) {
        const mapData = fs.readFileSync(mapPath, 'utf8');
        this.systemMap = JSON.parse(mapData);
        console.log('System Map: loaded');
      } else {
        console.log('System Map: not found');
      }
      
    } catch (error) {
      console.log(`Failed to load system components: ${error.message}`);
      throw error;
    }
  }

  async initializeMonitoring() {
    console.log('Initializing monitoring...');
    
    this.monitoring = true;
    
    // Start monitoring loop
    this.monitorTimer = setInterval(() => {
      this.performMonitoringCycle().catch(error => {
        console.log(`Monitoring cycle error: ${error.message}`);
      });
    }, this.monitorInterval);
    
    console.log(`Monitoring started (interval: ${this.monitorInterval}ms)`);
  }

  async performMonitoringCycle() {
    if (!this.monitoring) return;
    
    try {
      // Update system health
      await this.updateSystemHealth();
      
      // Update module status
      await this.updateModuleStatus();
      
      // Update event throughput
      await this.updateEventThroughput();
      
      // Update performance metrics
      await this.updatePerformance();
      
      // Check for alerts
      await this.checkAlerts();
      
      this.state.lastUpdate = new Date().toISOString();
      
    } catch (error) {
      console.log(`Monitoring cycle error: ${error.message}`);
      this.state.errors.push({
        timestamp: new Date().toISOString(),
        error: error.message,
        component: 'monitoring'
      });
    }
  }

  async updateSystemHealth() {
    // Check HEIDI health
    if (this.heidi) {
      const heidiStatus = this.heidi.getStatus();
      
      this.state.systemHealth.heidi = heidiStatus.initialized ? 'healthy' : 'unhealthy';
      
      if (!heidiStatus.initialized) {
        this.state.alerts.push({
          timestamp: new Date().toISOString(),
          type: 'health',
          component: 'heidi',
          message: 'HEIDI not initialized',
          severity: 'warning'
        });
      }
    }
    
    // Check Event Pipeline health
    if (this.eventPipeline) {
      const pipelineState = this.eventPipeline.getState();
      
      this.state.systemHealth.eventPipeline = pipelineState.initialized ? 'healthy' : 'unhealthy';
      
      if (!pipelineState.initialized) {
        this.state.alerts.push({
          timestamp: new Date().toISOString(),
          type: 'health',
          component: 'event_pipeline',
          message: 'Event Pipeline not initialized',
          severity: 'warning'
        });
      }
    }
    
    // Check Ursula health
    if (this.ursula) {
      const ursulaStatus = this.ursula.getStatus();
      
      this.state.systemHealth.ursula = ursulaStatus.connected ? 'healthy' : 'degraded';
      
      if (ursulaStatus.fallbackMode) {
        this.state.alerts.push({
          timestamp: new Date().toISOString(),
          type: 'health',
          component: 'ursula',
          message: 'Ursula in fallback mode',
          severity: 'info'
        });
      }
    }
    
    // Check Knowledge Base health
    if (this.heidi) {
      const heidiStatus = this.heidi.getStatus();
      
      if (heidiStatus.knowledgeBase) {
        this.state.systemHealth.knowledgeBase = heidiStatus.knowledgeBase > 0 ? 'healthy' : 'degraded';
        
        if (heidiStatus.knowledgeBase === 0) {
          this.state.alerts.push({
            timestamp: new Date().toISOString(),
            type: 'health',
            component: 'knowledge_base',
            message: 'Knowledge base empty',
            severity: 'warning'
          });
        }
      }
    }
    
    // Overall system health
    const healthScores = Object.values(this.state.systemHealth).map(status => 
      status === 'healthy' ? 1 : status === 'degraded' ? 0.5 : 0
    );
    
    const avgHealth = healthScores.reduce((sum, score) => sum + score, 0) / healthScores.length;
    
    if (avgHealth < 0.8) {
      this.state.alerts.push({
        timestamp: new Date().toISOString(),
        type: 'health',
        component: 'system',
        message: `System health degraded (${(avgHealth * 100).toFixed(1)}%)`,
        severity: 'warning'
      });
    }
  }

  async updateModuleStatus() {
    if (this.systemMap && this.systemMap.modules) {
      // Update module status
      for (const [moduleName, moduleInfo] of Object.entries(this.systemMap.modules)) {
        this.state.moduleStatus.set(moduleName, {
          discovered: true,
          loaded: moduleInfo.loaded || false,
          size: moduleInfo.size,
          modified: moduleInfo.modified,
          lastChecked: new Date().toISOString()
        });
      }
    }
    
    // Check HEIDI module status
    if (this.heidi) {
      const heidiStatus = this.heidi.getStatus();
      
      this.state.moduleStatus.set('heidi', {
        discovered: true,
        loaded: heidiStatus.initialized,
        lastChecked: new Date().toISOString()
      });
    }
    
    // Check Event Pipeline module status
    if (this.eventPipeline) {
      const pipelineState = this.eventPipeline.getState();
      
      this.state.moduleStatus.set('event_pipeline', {
        discovered: true,
        loaded: pipelineState.initialized,
        lastChecked: new Date().toISOString()
      });
    }
    
    // Check Ursula module status
    if (this.ursula) {
      const ursulaStatus = this.ursula.getStatus();
      
      this.state.moduleStatus.set('ursula', {
        discovered: true,
        loaded: ursulaStatus.initialized,
        connected: ursulaStatus.connected,
        mode: ursulaStatus.mode,
        lastChecked: new Date().toISOString()
      });
    }
  }

  async updateEventThroughput() {
    const now = Date.now();
    const oneMinuteAgo = new Date(now - 60000);
    const oneHourAgo = new Date(now - 3600000);
    
    let lastMinuteCount = 0;
    let lastHourCount = 0;
    
    if (this.eventPipeline) {
      const eventStream = this.eventPipeline.getEventStream();
      
      for (const event of eventStream) {
        const eventTime = new Date(event.timestamp);
        
        if (eventTime > oneMinuteAgo) {
          lastMinuteCount++;
        }
        
        if (eventTime > oneHourAgo) {
          lastHourCount++;
        }
      }
    }
    
    this.state.eventThroughput.lastMinute = lastMinuteCount;
    this.state.eventThroughput.lastHour = lastHourCount;
    
    // Calculate per second rate (approximate)
    this.state.eventThroughput.perSecond = lastMinuteCount / 60;
    
    // Update total
    this.state.eventThroughput.total = this.eventPipeline ? 
      this.eventPipeline.getEventStream().length : 0;
  }

  async updatePerformance() {
    // Update performance metrics
    if (this.heidi) {
      const heidiStatus = this.heidi.getStatus();
      
      this.state.performance.responseCount = heidiStatus.responseCount;
      this.state.performance.avgResponseTime = heidiStatus.processing ? 100 : 0; // Placeholder
    }
    
    // Calculate average response time
    if (this.state.performance.responseCount > 0) {
      this.state.performance.avgResponseTime = 
        this.state.performance.totalResponseTime / this.state.performance.responseCount;
    }
  }

  async checkAlerts() {
    // Clean old alerts (older than 1 hour)
    const oneHourAgo = new Date(Date.now() - 3600000);
    
    this.state.alerts = this.state.alerts.filter(alert => 
      new Date(alert.timestamp) > oneHourAgo
    );
    
    // Check for critical alerts
    const criticalAlerts = this.state.alerts.filter(alert => alert.severity === 'error');
    
    if (criticalAlerts.length > 0) {
      console.log(`CRITICAL ALERTS: ${criticalAlerts.length}`);
      
      criticalAlerts.forEach(alert => {
        console.log(`  ${alert.type}: ${alert.message}`);
      });
    }
    
    // Check for warnings
    const warnings = this.state.alerts.filter(alert => alert.severity === 'warning');
    
    if (warnings.length > 0) {
      console.log(`WARNINGS: ${warnings.length}`);
      
      warnings.slice(-3).forEach(alert => {
        console.log(`  ${alert.type}: ${alert.message}`);
      });
    }
  }

  async performHealthCheck() {
    console.log('Performing health check...');
    
    const healthCheck = {
      timestamp: new Date().toISOString(),
      components: {},
      overall: 'unknown'
    };
    
    // Check each component
    if (this.heidi) {
      const heidiStatus = this.heidi.getStatus();
      healthCheck.components.heidi = {
        initialized: heidiStatus.initialized,
        connected: heidiStatus.connected,
        processing: heidiStatus.processing,
        lastActivity: heidiStatus.lastActivity
      };
    }
    
    if (this.eventPipeline) {
      const pipelineState = this.eventPipeline.getState();
      healthCheck.components.eventPipeline = {
        initialized: pipelineState.initialized,
        channels: pipelineState.channels,
        events: pipelineState.eventStreamSize,
        subscribers: pipelineState.subscribers
      };
    }
    
    if (this.ursula) {
      const ursulaStatus = this.ursula.getStatus();
      healthCheck.components.ursula = {
        initialized: ursulaStatus.initialized,
        connected: ursulaStatus.connected,
        mode: ursulaStatus.mode,
        fallbackMode: ursulaStatus.fallbackMode
      };
    }
    
    // Determine overall health
    const componentHealth = Object.values(healthCheck.components);
    const healthyComponents = componentHealth.filter(c => 
      c.initialized && (c.connected !== false)
    ).length;
    
    healthCheck.overall = healthyComponents === componentHealth.length ? 'healthy' : 'degraded';
    
    console.log(`Health Check: ${healthCheck.overall.toUpperCase()}`);
    console.log(`Components: ${healthyComponents}/${componentHealth.length} healthy`);
    
    return healthCheck;
  }

  async getStatus() {
    return {
      ...this.state,
      components: {
        heidi: this.heidi ? this.heidi.getStatus() : null,
        eventPipeline: this.eventPipeline ? this.eventPipeline.getState() : null,
        ursula: this.ursula ? this.ursula.getStatus() : null,
        systemMap: this.systemMap
      },
      timestamp: new Date().toISOString()
    };
  }

  async getSystemHealth() {
    return this.state.systemHealth;
  }

  async getModuleStatus() {
    return this.state.moduleStatus;
  }

  async getEventThroughput() {
    return this.state.eventThroughput;
  }

  async getPerformance() {
    return this.state.performance;
  }

  async getAlerts() {
    return this.state.alerts;
  }

  async stopMonitoring() {
    console.log('Stopping monitoring...');
    
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    
    this.monitoring = false;
    
    console.log('Monitoring stopped');
  }

  async startMonitoring() {
    console.log('Starting monitoring...');
    
    if (!this.monitoring) {
      await this.initializeMonitoring();
    }
    
    console.log('Monitoring resumed');
  }

  // Generate status report
  async generateStatusReport() {
    console.log('\n=== SELF-AWARE STATE STATUS REPORT ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    const status = await this.getStatus();
    
    console.log(`\n=== SYSTEM HEALTH ===`);
    Object.entries(status.components).forEach(([component, health]) => {
      const healthStatus = health ? 'HEALTHY' : 'UNHEALTHY';
      console.log(`${component}: ${healthStatus}`);
    });
    
    console.log(`\n=== MODULE STATUS ===`);
    Object.entries(status.moduleStatus).forEach(([module, moduleStatus]) => {
      const status = moduleStatus.loaded ? 'LOADED' : 'NOT LOADED';
      console.log(`${module}: ${status}`);
    });
    
    console.log(`\n=== EVENT THROUGHPUT ===`);
    console.log(`Total: ${status.eventThroughput.total}`);
    console.log(`Last Minute: ${status.eventThroughput.lastMinute}`);
    console.log(`Last Hour: ${status.eventThroughput.lastHour}`);
    console.log(`Per Second: ${status.eventThroughput.perSecond.toFixed(2)}`);
    
    console.log(`\n=== PERFORMANCE ===`);
    console.log(`Response Count: ${status.performance.responseCount}`);
    console.log(`Avg Response Time: ${status.performance.avgResponseTime.toFixed(2)}ms`);
    
    console.log(`\n=== ALERTS ===`);
    console.log(`Total: ${status.alerts.length}`);
    
    if (status.alerts.length > 0) {
      console.log('Recent alerts:');
      status.alerts.slice(-5).forEach(alert => {
        const severity = alert.severity.toUpperCase();
        console.log(`  ${severity}: ${alert.message} (${alert.timestamp})`);
      });
    }
    
    // Write status report to file
    const fs = require('fs');
    const path = require('path');
    
    const reportData = {
      timestamp: new Date().toISOString(),
      status,
      systemHealth: this.state.systemHealth,
      moduleStatus: this.state.moduleStatus,
      eventThroughput: this.state.eventThroughput,
      performance: this.state.performance,
      alerts: this.state.alerts
    };
    
    const reportPath = path.join(process.cwd(), 'HEIDI_STATUS.json');
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
    
    console.log(`\nStatus report saved to: ${reportPath}`);
    
    return reportData;
  }
}

// CLI interface
if (require.main === module) {
  const state = new SelfAwareState();
  
  const command = process.argv[2] || 'initialize';
  
  (async () => {
    switch (command) {
      case 'initialize':
        await state.initialize();
        break;
        
      case 'status':
        const status = await state.getStatus();
        console.log('Self-Aware State Status:', JSON.stringify(status, null, 2));
        break;
        
      case 'health':
        const health = await state.performHealthCheck();
        console.log('Health Check Results:', JSON.stringify(health, null, 2));
        break;
        
      case 'monitor':
        await state.startMonitoring();
        
        // Keep monitoring running
        process.on('SIGINT', () => {
          console.log('\nStopping monitoring...');
          state.stopMonitoring();
          process.exit(0);
        });
        
        break;
        
      case 'report':
        await state.generateStatusReport();
        break;
        
      default:
        console.log('Usage: node self-aware-state.js [initialize|status|health|monitor|report]');
    }
  })();
}

module.exports = { SelfAwareState };
