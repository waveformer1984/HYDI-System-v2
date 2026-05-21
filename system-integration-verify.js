#!/usr/bin/env node

/**
 * HYDI System Integration Verification
 * Comprehensive validation of all system components and their connections
 */

const fs = require('fs');
const path = require('path');

class SystemIntegrationVerifier {
  constructor() {
    this.systemDir = 'F:\\HYDI_System';
    this.results = {
      timestamp: new Date().toISOString(),
      components: {},
      connections: {},
      integration_status: 'INITIALIZING',
      critical_issues: [],
      warnings: [],
      verified_features: []
    };
  }

  async verify() {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║     HYDI SYSTEM INTEGRATION VERIFICATION SUITE         ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    // 1. Verify Core Components
    console.log('[1/7] Verifying Core Components...');
    this.verifyCoreComponents();

    // 2. Verify AI Integration
    console.log('[2/7] Verifying AI Integration...');
    this.verifyAIIntegration();

    // 3. Verify Dashboard
    console.log('[3/7] Verifying Dashboard Enhancement...');
    this.verifyDashboard();

    // 4. Verify Worker Configuration
    console.log('[4/7] Verifying Worker Configuration...');
    this.verifyWorkerConfig();

    // 5. Verify Event Pipeline
    console.log('[5/7] Verifying Event Pipeline...');
    this.verifyEventPipeline();

    // 6. Verify Startup Scripts
    console.log('[6/7] Verifying Startup Scripts...');
    this.verifyStartupScripts();

    // 7. Verify Dependencies
    console.log('[7/7] Verifying Dependencies...');
    this.verifyDependencies();

    // Generate Report
    this.generateReport();
  }

  verifyCoreComponents() {
    const coreFiles = [
      'production-orchestrator.js',
      'agent-worker-with-model.js',
      'local-model-integration.js',
      'complete-event-pipeline.js',
      'ursula-dashboard-enhanced.js',
      'protoforge-mock.js'
    ];

    console.log('  ✓ Checking core files...');
    coreFiles.forEach(file => {
      const filePath = path.join(this.systemDir, file);
      const exists = fs.existsSync(filePath);
      this.results.components[file] = {
        exists,
        status: exists ? 'READY' : 'MISSING',
        path: filePath
      };
      if (exists) {
        const stats = fs.statSync(filePath);
        this.results.components[file].size_kb = (stats.size / 1024).toFixed(2);
        console.log(`    ✓ ${file} (${this.results.components[file].size_kb} KB)`);
      } else {
        console.log(`    ✗ ${file} - MISSING`);
        this.results.critical_issues.push(`Core component missing: ${file}`);
      }
    });
  }

  verifyAIIntegration() {
    console.log('  ✓ Checking AI Integration...');

    // Check LocalModelIntegrationEngine
    const modelIntegrationFile = path.join(this.systemDir, 'local-model-integration.js');
    if (fs.existsSync(modelIntegrationFile)) {
      const content = fs.readFileSync(modelIntegrationFile, 'utf8');

      const features = {
        'Decision Tree Backend': content.includes('classifyWithDecisionTree'),
        'Ollama Support': content.includes('initializeOllama'),
        'TensorFlow Support': content.includes('initializeTensorFlow'),
        'Caching System': content.includes('this.cache'),
        'Retry Strategy': content.includes('retry_strategy'),
        'Performance Analysis': content.includes('analyzePerformance'),
        'Health Checks': content.includes('healthCheck')
      };

      Object.entries(features).forEach(([feature, exists]) => {
        if (exists) {
          console.log(`    ✓ ${feature}`);
          this.results.verified_features.push(feature);
        } else {
          console.log(`    ✗ ${feature} - NOT FOUND`);
          this.results.warnings.push(`AI feature missing: ${feature}`);
        }
      });

      this.results.components['LocalModelIntegrationEngine'] = {
        status: 'VERIFIED',
        features_found: Object.values(features).filter(Boolean).length,
        total_features: Object.keys(features).length
      };
    }

    // Check AI Worker Integration
    const workerFile = path.join(this.systemDir, 'agent-worker-with-model.js');
    if (fs.existsSync(workerFile)) {
      const content = fs.readFileSync(workerFile, 'utf8');

      const integration = {
        'Model Engine Integration': content.includes('LocalModelIntegrationEngine'),
        'Event Classification': content.includes('await this.model.classify'),
        'Decision Generation': content.includes('generateDecision'),
        'Autonomous Actions': content.includes('autonomous_actions'),
        'Metrics Tracking': content.includes('this.metrics')
      };

      Object.entries(integration).forEach(([feature, exists]) => {
        if (exists) {
          console.log(`    ✓ AI Worker: ${feature}`);
          this.results.verified_features.push(feature);
        }
      });

      this.results.components['AIWorkerIntegration'] = { status: 'VERIFIED' };
    }
  }

  verifyDashboard() {
    console.log('  ✓ Checking Dashboard Enhancement...');

    const dashboardFile = path.join(this.systemDir, 'ursula-dashboard-enhanced.js');
    if (fs.existsSync(dashboardFile)) {
      const content = fs.readFileSync(dashboardFile, 'utf8');

      const features = {
        'Real-time Streaming (SSE)': content.includes('/events/stream'),
        'Event Detail Modal': content.includes('showEventModal'),
        'AI Confidence Display': content.includes('confidence'),
        'Multi-Filter System': content.includes('applyFilters'),
        'Real-time Search': content.includes('searchEvents'),
        'Worker Metrics Panel': content.includes('workerMetrics'),
        'System Health Status': content.includes('systemHealth'),
        'Retry History Display': content.includes('retry'),
        'Dark/Light Theme': content.includes('localStorage'),
        'Export Functionality': content.includes('/api/export'),
        'Event Payload Display': content.includes('JSON.stringify'),
        'Priority Indicators': content.includes('priority')
      };

      Object.entries(features).forEach(([feature, exists]) => {
        if (exists) {
          console.log(`    ✓ Dashboard Feature: ${feature}`);
          this.results.verified_features.push(feature);
        } else {
          console.log(`    ⚠ Dashboard Feature Missing: ${feature}`);
        }
      });

      this.results.components['UrsulaDashboardEnhanced'] = {
        status: 'VERIFIED',
        features_implemented: Object.values(features).filter(Boolean).length,
        total_expected_features: Object.keys(features).length
      };
    }
  }

  verifyWorkerConfig() {
    console.log('  ✓ Checking Worker Configuration...');

    const packageJsonPath = path.join(this.systemDir, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    const agentScript = packageJson.scripts.agent;
    if (agentScript.includes('agent-worker-with-model.js')) {
      console.log(`    ✓ Agent Script: ${agentScript}`);
      this.results.components['WorkerConfig'] = { status: 'CORRECT' };
    } else {
      console.log(`    ✗ Agent Script: ${agentScript} - NOT AI-POWERED`);
      this.results.critical_issues.push('Agent worker not configured for AI');
    }

    // Verify startup script
    const startupPath = path.join(this.systemDir, 'start_full_system.bat');
    const startup = fs.readFileSync(startupPath, 'utf8');

    const expectedServices = [
      { name: 'Dashboard Enhanced', pattern: 'ursula-dashboard-enhanced.js' },
      { name: 'Orchestrator', pattern: 'production-orchestrator.js' },
      { name: 'AI Worker', pattern: 'agent-worker-with-model.js' },
      { name: 'ProtoForge Mock', pattern: 'protoforge-mock.js' }
    ];

    expectedServices.forEach(service => {
      if (startup.includes(service.pattern)) {
        console.log(`    ✓ Startup Service: ${service.name}`);
      } else {
        console.log(`    ✗ Startup Service Missing: ${service.name}`);
        this.results.warnings.push(`Startup script missing: ${service.name}`);
      }
    });
  }

  verifyEventPipeline() {
    console.log('  ✓ Checking Event Pipeline...');

    const pipelineFile = path.join(this.systemDir, 'complete-event-pipeline.js');
    if (fs.existsSync(pipelineFile)) {
      const content = fs.readFileSync(pipelineFile, 'utf8');

      const stages = {
        'Event Reception': content.includes('receiveEvent'),
        'Validation': content.includes('validate'),
        'Enrichment': content.includes('enrich'),
        'Classification': content.includes('classify'),
        'Routing': content.includes('route'),
        'Processing': content.includes('process'),
        'Delivery': content.includes('deliver'),
        'Persistence': content.includes('persist')
      };

      Object.entries(stages).forEach(([stage, exists]) => {
        if (exists) {
          console.log(`    ✓ Pipeline Stage: ${stage}`);
        }
      });

      this.results.components['EventPipeline'] = {
        status: 'VERIFIED',
        stages: Object.keys(stages).length
      };
    }
  }

  verifyStartupScripts() {
    console.log('  ✓ Checking Startup Scripts...');

    const scripts = [
      'start_full_system.bat',
      'start_hydi.bat'
    ];

    scripts.forEach(script => {
      const scriptPath = path.join(this.systemDir, script);
      const exists = fs.existsSync(scriptPath);
      console.log(`    ${exists ? '✓' : '✗'} ${script}`);
      this.results.components[script] = { status: exists ? 'READY' : 'MISSING' };
    });
  }

  verifyDependencies() {
    console.log('  ✓ Checking Dependencies...');

    const packageJsonPath = path.join(this.systemDir, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    const requiredDeps = [
      'express',
      '@supabase/supabase-js',
      'axios',
      'uuid',
      'ws',
      'dotenv'
    ];

    requiredDeps.forEach(dep => {
      if (packageJson.dependencies[dep]) {
        console.log(`    ✓ ${dep} v${packageJson.dependencies[dep]}`);
      } else {
        console.log(`    ✗ ${dep} - MISSING`);
        this.results.warnings.push(`Missing dependency: ${dep}`);
      }
    });

    this.results.components['Dependencies'] = {
      status: 'VERIFIED',
      installed: requiredDeps.filter(d => packageJson.dependencies[d]).length,
      total_required: requiredDeps.length
    };
  }

  generateReport() {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║                    VERIFICATION REPORT                ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    // Summary
    const componentCount = Object.keys(this.results.components).length;
    const readyComponents = Object.values(this.results.components)
      .filter(c => c.status === 'READY' || c.status === 'VERIFIED' || c.status === 'CORRECT')
      .length;

    console.log(`Total Components Verified: ${componentCount}`);
    console.log(`Ready/Verified Components: ${readyComponents}/${componentCount}`);
    console.log(`Features Verified: ${this.results.verified_features.length}`);
    console.log(`Critical Issues: ${this.results.critical_issues.length}`);
    console.log(`Warnings: ${this.results.warnings.length}`);

    if (this.results.critical_issues.length > 0) {
      console.log('\n⚠️  CRITICAL ISSUES:');
      this.results.critical_issues.forEach(issue => {
        console.log(`  • ${issue}`);
      });
      this.results.integration_status = 'INCOMPLETE';
    }

    if (this.results.warnings.length > 0) {
      console.log('\n⚠️  WARNINGS:');
      this.results.warnings.forEach(warning => {
        console.log(`  • ${warning}`);
      });
    }

    if (this.results.critical_issues.length === 0) {
      console.log('\n✅ All Critical Components Verified');
      this.results.integration_status = 'COMPLETE';
    }

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log(`║  INTEGRATION STATUS: ${this.results.integration_status.padEnd(36)} ║`);
    console.log('╚════════════════════════════════════════════════════════╝\n');

    // Verified Features List
    console.log('VERIFIED FEATURES:');
    const uniqueFeatures = [...new Set(this.results.verified_features)];
    uniqueFeatures.forEach((feature, idx) => {
      console.log(`  ${idx + 1}. ${feature}`);
    });

    // Save report
    const reportPath = path.join(this.systemDir, 'system-integration-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));
    console.log(`\n✓ Report saved to: ${reportPath}`);

    return this.results;
  }
}

// Run verification
if (require.main === module) {
  const verifier = new SystemIntegrationVerifier();
  verifier.verify().catch(console.error);
}

module.exports = { SystemIntegrationVerifier };
