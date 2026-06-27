#!/usr/bin/env node

/**
 * ProtoForge Autonomous HQ Orchestration System - Main Entry Point
 * 
 * This is the complete implementation of your ProtoForge PAO system:
 * 
 * 15 specialized agents with strict boundaries
 * Event-driven communication system
 * 5-level autonomy with guardrails
 * Financial automation engine
 * Human-in-the-loop approval layer
 * Real-time dashboard interface
 * 
 * The system can:
 * - Design, fund, build, and operate a rotating cyberpunk container skyscraper
 * - Manage its own finances and operations
 * - Make strategic decisions with human oversight
 * - Scale from observation to full autonomy
 */

const ProtoForgeIntegration = require('./modules/protoforge-integration');
const ProtoForgeAutonomySystem = require('./modules/protoforge-autonomy-system');
const ProtoForgeFinancialEngine = require('./modules/protoforge-financial-engine');

class ProtoForgeMain {
  constructor() {
    this.integration = null;
    this.autonomySystem = null;
    this.financialEngine = null;
    this.initialized = false;
  }

  async initialize(initialCapital = 1000000) {
    console.log('🏗️  PROTOFORGE AUTONOMOUS HQ ORCHESTRATION SYSTEM');
    console.log('==================================================');
    console.log('Initializing the AI-run company that designs, funds, builds,');
    console.log('and operates a rotating cyberpunk container skyscraper...');
    console.log('');

    try {
      // Phase 1: Initialize Core Systems
      console.log('📡 Phase 1: Initializing Core Systems...');
      await this.initializeCoreSystems();

      // Phase 2: Initialize Financial Engine
      console.log('💰 Phase 2: Initializing Financial Engine...');
      await this.initializeFinancialEngine(initialCapital);

      // Phase 3: Initialize Autonomy System
      console.log('🤖 Phase 3: Initializing Autonomy System...');
      await this.initializeAutonomySystem();

      // Phase 4: Start ProtoForge Integration
      console.log('🚀 Phase 4: Starting ProtoForge Integration...');
      await this.startIntegration();

      // Phase 5: Run Demo Scenario
      console.log('🎯 Phase 5: Running Demo Scenario...');
      await this.runDemoScenario();

      console.log('');
      console.log('✅ ProtoForge PAO System Fully Operational!');
      console.log('🌐 Dashboard: http://localhost:3005/protohub-dashboard.html');
      console.log('📊 API: http://localhost:3005/api/status');
      console.log('🔧 Ready to build your rotating cyberpunk container skyscraper!');
      console.log('');

      this.initialized = true;

    } catch (error) {
      console.error('❌ Initialization failed:', error);
      throw error;
    }
  }

  async initializeCoreSystems() {
    // Initialize the main integration system
    this.integration = new ProtoForgeIntegration({
      autonomyLevel: 2, // Start with EXECUTE_WITH_APPROVAL
      enableHumanApproval: true,
      maxConcurrentTasks: 10
    });

    await this.integration.initialize();
    console.log('   ✅ Event system online');
    console.log('   ✅ Heidi Executive Orchestrator ready');
    console.log('   ✅ 15 specialized agents registered');
  }

  async initializeFinancialEngine(initialCapital) {
    // Initialize financial automation
    this.financialEngine = new ProtoForgeFinancialEngine({
      defaultCurrency: 'USD',
      reserveRequirement: 0.15,
      emergencyBuffer: 0.10,
      investmentAllocation: 0.20
    });

    await this.financialEngine.initialize(initialCapital);
    console.log(`   ✅ Treasury initialized with $${initialCapital.toLocaleString()}`);
    console.log('   ✅ Budget automation active');
    console.log('   ✅ Revenue tracking enabled');
  }

  async initializeAutonomySystem() {
    // Initialize autonomy system with guardrails
    this.autonomySystem = new ProtoForgeAutonomySystem({
      defaultLevel: 2,
      maxLevel: 4,
      trustDecayRate: 0.01,
      trustBuildRate: 0.05,
      criticalActionThreshold: 10000
    });

    // Register all agents with autonomy system
    const agentConfigs = {
      'architect_agent': {
        name: 'Architect Agent',
        type: 'STRATEGIC',
        initialLevel: 2,
        maxSpendingLimit: 50000,
        canModifyStructure: true
      },
      'energy_system_agent': {
        name: 'Energy Systems Agent',
        type: 'STRATEGIC',
        initialLevel: 2,
        maxSpendingLimit: 100000,
        canModifyStructure: false
      },
      'ai_systems_agent': {
        name: 'AI Systems Agent',
        type: 'STRATEGIC',
        initialLevel: 3,
        maxSpendingLimit: 75000,
        canModifyStructure: false
      },
      'procurement_agent': {
        name: 'Procurement Agent',
        type: 'EXECUTION',
        initialLevel: 2,
        maxSpendingLimit: 250000,
        canModifyStructure: false
      },
      'construction_agent': {
        name: 'Construction Agent',
        type: 'EXECUTION',
        initialLevel: 2,
        maxSpendingLimit: 500000,
        canModifyStructure: true
      },
      'fabrication_agent': {
        name: 'Fabrication Agent',
        type: 'EXECUTION',
        initialLevel: 2,
        maxSpendingLimit: 100000,
        canModifyStructure: false
      },
      'finance_agent': {
        name: 'Finance Agent',
        type: 'BUSINESS',
        initialLevel: 3,
        maxSpendingLimit: 1000000,
        canModifyStructure: false
      },
      'funding_agent': {
        name: 'Funding Agent',
        type: 'BUSINESS',
        initialLevel: 2,
        maxSpendingLimit: 50000,
        canModifyStructure: false
      },
      'revenue_agent': {
        name: 'Revenue Agent',
        type: 'BUSINESS',
        initialLevel: 2,
        maxSpendingLimit: 25000,
        canModifyStructure: false
      }
    };

    // Register agents
    for (const [agentId, config] of Object.entries(agentConfigs)) {
      this.autonomySystem.registerAgent(agentId, config);
    }

    // Start background processes
    this.autonomySystem.startBackgroundProcesses();

    console.log('   ✅ Autonomy levels configured');
    console.log('   ✅ Guardrails activated');
    console.log('   ✅ Trust scoring enabled');
  }

  async startIntegration() {
    // Connect all systems
    this.integration.autonomySystem = this.autonomySystem;
    this.integration.financialEngine = this.financialEngine;

    // Set up cross-system event handlers
    this.setupCrossSystemEvents();

    console.log('   ✅ Systems integrated');
    console.log('   ✅ Communication channels established');
    console.log('   ✅ Monitoring active');
  }

  setupCrossSystemEvents() {
    // Financial events to autonomy system
    this.financialEngine.on('financial_alert', (alert) => {
      console.log(`🚨 Financial Alert: ${alert.message}`);
      
      // Escalate if needed
      if (alert.severity === 'critical') {
        this.autonomySystem.requestApproval('financial_engine', {
          type: 'financial_emergency',
          alert
        }, {}, 'Critical financial issue detected');
      }
    });

    // Autonomy events to integration
    this.autonomySystem.on('approval_required', (request) => {
      console.log(`👤 Human approval required: ${request.agentId} - ${request.action.type}`);
      
      // In a real system, this would trigger UI notifications
      // For now, we'll auto-approve low-risk actions
      if (request.action.value < 1000) {
        setTimeout(() => {
          this.autonomySystem.handleApprovalResponse(request.id, true, {
            approved_by: 'auto_low_risk',
            reason: 'Low risk auto-approval'
          });
        }, 1000);
      }
    });

    // Integration events to financial engine
    this.integration.heidi.on('taskCompleted', (data) => {
      // Track costs and benefits of completed tasks
      if (data.task.cost) {
        this.financialEngine.recordExpense('operational', 'task_execution', data.task.cost, `Task: ${data.task.type}`);
      }
      
      if (data.task.revenue) {
        this.financialEngine.recordRevenue('task_revenue', data.task.revenue, {
          taskId: data.task.id,
          taskType: data.task.type
        });
      }
    });
  }

  async runDemoScenario() {
    console.log('   🏗️  Demo: Designing container module...');
    const designTask = await this.integration.submitTask({
      type: 'design_container_module',
      payload: {
        moduleType: 'residential',
        dimensions: { length: 12, width: 2.5, height: 2.7 },
        requirements: {
          power: true,
          data: true,
          hvac: true,
          rotation: true
        }
      },
      priority: 'high'
    });

    console.log('   ⚡ Demo: Designing power system...');
    const powerTask = await this.integration.submitTask({
      type: 'design_power_system',
      payload: {
        facilitySize: 1000,
        demandProfile: {
          average: 50000, // 50kW
          peak: 75000,   // 75kW
          critical: 25000 // 25kW
        },
        renewableTarget: 0.8 // 80% renewable
      },
      priority: 'high'
    });

    console.log('   💰 Demo: Creating budget...');
    const budget = this.financialEngine.createBudget('construction_phase_1', 500000, [
      { name: 'materials', type: 'percentage', percentage: 40 },
      { name: 'labor', type: 'percentage', percentage: 35 },
      { name: 'equipment', type: 'percentage', percentage: 15 },
      { name: 'contingency', type: 'percentage', percentage: 10 }
    ], {
      materials: 1,
      labor: 2,
      equipment: 3,
      contingency: 4
    });

    console.log('   📊 Demo: Adding revenue stream...');
    const revenueStream = this.financialEngine.addRevenueStream(
      'container_leasing',
      'recurring',
      15000, // $15k/month
      'monthly'
    );

    console.log('   🔍 Demo: Finding funding opportunities...');
    const grantOpportunity = this.financialEngine.addFundingOpportunity(
      'grant',
      250000, // $250k
      0.3,    // 30% probability
      90      // 90 days to decision
    );

    // Wait a bit for processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('   ✅ Demo scenario completed - check dashboard for results');
  }

  getSystemStatus() {
    if (!this.initialized) {
      return { status: 'not_initialized' };
    }

    return {
      status: 'operational',
      uptime: Date.now() - (this.integration?.startTime || Date.now()),
      integration: this.integration.getSystemStatus(),
      autonomy: this.autonomySystem.getSystemStatus(),
      financial: this.financialEngine.getFinancialStatus(),
      capabilities: [
        'autonomous_architectural_design',
        'intelligent_financial_management',
        'automated_construction_coordination',
        'dynamic_resource_allocation',
        'human_in_the_loop_oversight',
        'scalable_autonomy_levels'
      ]
    };
  }

  async shutdown() {
    console.log('🛑 Shutting down ProtoForge PAO System...');

    try {
      if (this.integration) {
        await this.integration.shutdown();
      }

      console.log('✅ ProtoForge PAO System shutdown complete');
    } catch (error) {
      console.error('❌ Shutdown error:', error);
      throw error;
    }
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const protoforge = new ProtoForgeMain();

  switch (command) {
    case 'start': {
      const initialCapital = parseInt(args[1]) || 1000000;
      await protoforge.initialize(initialCapital);

      // Start lightweight HTTP server for health checks
      const http = require('http');
      const port = process.env.PORT || 3002;
      const server = http.createServer((req, res) => {
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'UP',
            service: 'hydi-protoforge',
            initialized: protoforge.initialized,
            timestamp: new Date().toISOString()
          }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
        }
      });
      server.listen(port, () => {
        console.log(`🌐 Health server listening on port ${port}`);
      });

      // Keep running
      console.log('🔄 ProtoForge PAO System running. Press Ctrl+C to stop.');
      process.on('SIGINT', async () => {
        console.log('\n🛑 Received interrupt signal...');
        server.close();
        await protoforge.shutdown();
        process.exit(0);
      });

      // Prevent exit
      await new Promise(() => {});
      break;
    }

    case 'status':
      if (!protoforge.initialized) {
        console.log('❌ ProtoForge not initialized. Run "node protoforge-main.js start" first.');
      } else {
        const status = protoforge.getSystemStatus();
        console.log('📊 ProtoForge PAO System Status:');
        console.log(JSON.stringify(status, null, 2));
      }
      break;

    case 'demo':
      console.log('🎯 Running demo scenario...');
      await protoforge.initialize(1000000);
      await protoforge.runDemoScenario();
      break;

    case 'help':
      console.log('🏗️  ProtoForge Autonomous HQ Orchestration System');
      console.log('');
      console.log('Commands:');
      console.log('  start [capital]  - Initialize and start the system');
      console.log('  status          - Show system status');
      console.log('  demo            - Run demo scenario');
      console.log('  help            - Show this help');
      console.log('');
      console.log('Examples:');
      console.log('  node protoforge-main.js start 1000000');
      console.log('  node protoforge-main.js status');
      console.log('  node protoforge-main.js demo');
      break;

    default:
      console.log('❌ Unknown command. Use "help" for available commands.');
      process.exit(1);
  }
}

// Export for use as module
module.exports = ProtoForgeMain;

// Run CLI if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
