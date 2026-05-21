// Production Deployment Automation
require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class ProductionDeployment {
  constructor() {
    this.workDir = process.cwd();
    this.deploymentLog = [];
    this.deploymentSteps = [
      { name: 'Environment Validation', step: () => this.validateEnvironment() },
      { name: 'Schema Validation', step: () => this.validateSchema() },
      { name: 'Dependency Check', step: () => this.checkDependencies() },
      { name: 'Build Verification', step: () => this.verifyBuild() },
      { name: 'Health Check', step: () => this.runHealthCheck() },
      { name: 'Load Test', step: () => this.runLoadTest() },
      { name: 'Chaos Test', step: () => this.runChaosTest() },
      { name: 'Final Validation', step: () => this.finalValidation() }
    ];
  }

  async runProductionDeployment() {
    console.log('=== PRODUCTION DEPLOYMENT AUTOMATION ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
    
    const deploymentResults = {
      startTime: new Date().toISOString(),
      endTime: null,
      duration: null,
      steps: {},
      overall: { success: false, errors: [] }
    };
    
    try {
      for (const step of this.deploymentSteps) {
        console.log(`\n--- ${step.name} ---`);
        
        const stepStartTime = Date.now();
        
        try {
          const result = await step.step();
          const stepDuration = Date.now() - stepStartTime;
          
          deploymentResults.steps[step.name] = {
            success: true,
            duration: stepDuration,
            result
          };
          
          console.log(`${step.name}: PASSED (${stepDuration}ms)`);
          
          if (result && result.details) {
            console.log(`Details: ${result.details}`);
          }
          
        } catch (error) {
          const stepDuration = Date.now() - stepStartTime;
          
          deploymentResults.steps[step.name] = {
            success: false,
            duration: stepDuration,
            error: error.message
          };
          
          console.log(`${step.name}: FAILED (${stepDuration}ms)`);
          console.log(`Error: ${error.message}`);
          
          deploymentResults.overall.errors.push(`${step.name}: ${error.message}`);
          
          // For critical failures, stop deployment
          if (this.isCriticalStep(step.name)) {
            console.log(`Critical step failed - stopping deployment`);
            throw new Error(`Deployment stopped at ${step.name}: ${error.message}`);
          }
        }
      }
      
      deploymentResults.endTime = new Date().toISOString();
      deploymentResults.duration = Date.now() - Date.parse(deploymentResults.startTime);
      deploymentResults.overall.success = deploymentResults.overall.errors.length === 0;
      
      this.printDeploymentReport(deploymentResults);
      
      return deploymentResults;
      
    } catch (error) {
      deploymentResults.endTime = new Date().toISOString();
      deploymentResults.duration = Date.now() - Date.parse(deploymentResults.startTime);
      deploymentResults.overall.success = false;
      deploymentResults.overall.errors.push(`Deployment failed: ${error.message}`);
      
      console.log(`\nDEPLOYMENT FAILED: ${error.message}`);
      this.printDeploymentReport(deploymentResults);
      
      return deploymentResults;
    }
  }

  isCriticalStep(stepName) {
    const criticalSteps = [
      'Environment Validation',
      'Schema Validation',
      'Health Check'
    ];
    
    return criticalSteps.includes(stepName);
  }

  async validateEnvironment() {
    console.log('Validating production environment...');
    
    const requiredEnvVars = [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_ANON_KEY',
      'NODE_ENV'
    ];
    
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      throw new Error(`Missing environment variables: ${missingVars.join(', ')}`);
    }
    
    // Validate environment values
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`NODE_ENV must be 'production', got '${process.env.NODE_ENV}'`);
    }
    
    if (!process.env.SUPABASE_URL.includes('supabase.co')) {
      throw new Error('SUPABASE_URL must be a valid Supabase URL');
    }
    
    return {
      success: true,
      details: `Environment validated with ${requiredVars.length} variables`
    };
  }

  async validateSchema() {
    console.log('Validating database schema...');
    
    try {
      const { CompleteEventPipeline } = require('./complete-event-pipeline');
      const pipeline = new CompleteEventPipeline();
      
      // Test schema with enhanced pre-flight check
      const { EnhancedPreFlightCheck } = require('./enhanced-preflight-check');
      const check = new EnhancedPreFlightCheck();
      
      const results = await check.runEnhancedCheck();
      
      if (!results.overall.passed) {
        throw new Error('Schema validation failed');
      }
      
      return {
        success: true,
        details: 'Schema validation passed',
        methods: Object.values(results).filter(r => r.name).filter(r => r.passed).length
      };
      
    } catch (error) {
      throw new Error(`Schema validation failed: ${error.message}`);
    }
  }

  async checkDependencies() {
    console.log('Checking dependencies...');
    
    try {
      // Check Node.js version
      const nodeVersion = process.version;
      const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
      
      if (majorVersion < 18) {
        throw new Error(`Node.js version too old: ${nodeVersion} (requires >= 18.0.0)`);
      }
      
      // Check package.json exists
      const packageJsonPath = path.join(this.workDir, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        throw new Error('package.json not found');
      }
      
      // Check required files exist
      const requiredFiles = [
        'production-orchestrator.js',
        'complete-event-pipeline.js',
        'side-effect-guards.js',
        'enhanced-preflight-check.js',
        '.env.production'
      ];
      
      const missingFiles = requiredFiles.filter(file => !fs.existsSync(path.join(this.workDir, file)));
      
      if (missingFiles.length > 0) {
        throw new Error(`Missing required files: ${missingFiles.join(', ')}`);
      }
      
      // Check if npm packages are installed
      try {
        execSync('npm list --depth=0', { cwd: this.workDir, stdio: 'pipe' });
      } catch (error) {
        throw new Error('npm packages not installed or corrupted');
      }
      
      return {
        success: true,
        details: `Dependencies validated - Node.js ${nodeVersion}, ${requiredFiles.length} files checked`
      };
      
    } catch (error) {
      throw new Error(`Dependency check failed: ${error.message}`);
    }
  }

  async verifyBuild() {
    console.log('Verifying build...');
    
    try {
      // Test orchestrator startup
      const { ProductionOrchestrator } = require('./production-orchestrator');
      const orchestrator = new ProductionOrchestrator();
      
      // Quick health check
      const health = await orchestrator.healthCheck();
      
      if (health.status !== 'healthy') {
        throw new Error('Orchestrator health check failed');
      }
      
      return {
        success: true,
        details: 'Build verification passed',
        health
      };
      
    } catch (error) {
      throw new Error(`Build verification failed: ${error.message}`);
    }
  }

  async runHealthCheck() {
    console.log('Running comprehensive health check...');
    
    try {
      const { ProductionOrchestrator } = require('./production-orchestrator');
      const orchestrator = new ProductionOrchestrator();
      
      const health = await orchestrator.healthCheck();
      
      if (health.status !== 'healthy') {
        throw new Error(`System not healthy: ${JSON.stringify(health.components)}`);
      }
      
      return {
        success: true,
        details: 'System is healthy',
        health
      };
      
    } catch (error) {
      throw new Error(`Health check failed: ${error.message}`);
    }
  }

  async runLoadTest() {
    console.log('Running load test...');
    
    try {
      const { PerformanceBenchmarks } = require('./performance-benchmarks');
      const benchmarks = new PerformanceBenchmarks();
      
      // Run warm throughput test
      const result = await benchmarks.benchmarkWarmThroughput();
      
      if (!result.success) {
        throw new Error(`Load test failed: ${result.error}`);
      }
      
      // Check if performance is acceptable
      const avgTime = result.details.avg_time_ms;
      const threshold = 100; // 100ms threshold
      
      if (avgTime > threshold) {
        throw new Error(`Load test failed: avg time ${avgTime}ms exceeds threshold ${threshold}ms`);
      }
      
      return {
        success: true,
        details: `Load test passed - avg time: ${avgTime}ms`,
        result
      };
      
    } catch (error) {
      throw new Error(`Load test failed: ${error.message}`);
    }
  }

  async runChaosTest() {
    console.log('Running chaos test...');
    
    try {
      const { ChaosEngine } = require('./chaos-engine');
      const chaos = new ChaosEngine();
      
      // Run memory pressure test
      const memoryResult = await chaos.testMemoryPressure();
      
      if (!memoryResult.passed) {
        throw new Error(`Chaos test failed: memory pressure test failed`);
      }
      
      // Run partial outage simulation (shorter for deployment)
      const outageResult = await chaos.simulatePartialOutage(5000); // 5 seconds
      
      if (!outageResult.bufferTest.passed) {
        throw new Error(`Chaos test failed: partial outage test failed`);
      }
      
      return {
        success: true,
        details: 'Chaos test passed',
        memory: memoryResult,
        outage: outageResult
      };
      
    } catch (error) {
      throw new Error(`Chaos test failed: ${error.message}`);
    }
  }

  async finalValidation() {
    console.log('Running final validation...');
    
    try {
      // Test complete pipeline
      const { CompleteEventPipeline } = require('./complete-event-pipeline');
      const pipeline = new CompleteEventPipeline();
      
      const testResult = await pipeline.testCompletePipeline();
      
      if (!testResult.success) {
        throw new Error(`Final validation failed: pipeline test failed`);
      }
      
      // Test production readiness
      const { ProductionReadinessTest } = require('./production-readiness-test');
      const readiness = new ProductionReadinessTest();
      
      readiness.runAllTests();
      
      return {
        success: true,
        details: 'Final validation passed',
        pipeline: testResult,
        readiness: 'processed'
      };
      
    } catch (error) {
      throw new Error(`Final validation failed: ${error.message}`);
    }
  }

  printDeploymentReport(results) {
    console.log('\n=== PRODUCTION DEPLOYMENT REPORT ===');
    console.log(`Start Time: ${results.startTime}`);
    console.log(`End Time: ${results.endTime}`);
    console.log(`Duration: ${results.duration}ms`);
    
    const totalSteps = Object.keys(results.steps).length;
    const passedSteps = Object.values(results.steps).filter(s => s.success).length;
    
    console.log(`\nSteps: ${passedSteps}/${totalSteps} passed`);
    
    console.log('\n=== STEP RESULTS ===');
    
    Object.entries(results.steps).forEach(([name, result]) => {
      const status = result.success ? 'PASS' : 'FAIL';
      const duration = result.duration ? ` (${result.duration}ms)` : '';
      
      console.log(`${status}: ${name}${duration}`);
      
      if (!result.success && result.error) {
        console.log(`  Error: ${result.error}`);
      }
      
      if (result.success && result.details) {
        console.log(`  Details: ${result.details}`);
      }
    });
    
    console.log('\n=== OVERALL RESULT ===');
    
    if (results.overall.success) {
      console.log('STATUS: DEPLOYMENT SUCCESSFUL');
      console.log('System is ready for production');
      
      console.log('\n=== NEXT STEPS ===');
      console.log('1. Monitor system performance');
      console.log('2. Set up alerting');
      console.log('3. Configure backup and recovery');
      
    } else {
      console.log('STATUS: DEPLOYMENT FAILED');
      console.log('System is not ready for production');
      
      if (results.overall.errors.length > 0) {
        console.log('\n=== ERRORS ===');
        results.overall.errors.forEach(error => {
          console.log(`- ${error}`);
        });
      }
      
      console.log('\n=== RECOMMENDATIONS ===');
      console.log('1. Fix failed steps');
      console.log('2. Re-run deployment');
      console.log('3. Address any blocking issues');
    }
  }

  // Quick deployment check
  async quickCheck() {
    console.log('=== QUICK DEPLOYMENT CHECK ===');
    
    const checks = [
      { name: 'Environment', check: () => this.validateEnvironment() },
      { name: 'Dependencies', check: () => this.checkDependencies() },
      { name: 'Health', check: () => this.runHealthCheck() }
    ];
    
    const results = {
      passed: 0,
      failed: 0,
      details: []
    };
    
    for (const check of checks) {
      try {
        await check.check();
        results.passed++;
        console.log(`${check.name}: PASS`);
      } catch (error) {
        results.failed++;
        console.log(`${check.name}: FAIL - ${error.message}`);
        results.details.push(`${check.name}: ${error.message}`);
      }
    }
    
    console.log(`\nQuick Check: ${results.passed}/${results.passed + results.failed} passed`);
    
    if (results.failed === 0) {
      console.log('STATUS: READY FOR DEPLOYMENT');
    } else {
      console.log('STATUS: NOT READY FOR DEPLOYMENT');
      console.log('\nIssues:');
      results.details.forEach(issue => {
        console.log(`- ${issue}`);
      });
    }
    
    return results;
  }
}

// CLI interface
if (require.main === module) {
  const deployment = new ProductionDeployment();
  
  const command = process.argv[2] || 'quick';
  
  (async () => {
    switch (command) {
      case 'deploy':
        await deployment.runProductionDeployment();
        break;
        
      case 'quick':
        await deployment.quickCheck();
        break;
        
      case 'validate':
        await deployment.validateEnvironment();
        break;
        
      case 'schema':
        await deployment.validateSchema();
        break;
        
      case 'health':
        await deployment.runHealthCheck();
        break;
        
      default:
        console.log('Usage: node production-deployment.js [deploy|quick|validate|schema|health]');
    }
  })().catch(console.error);
}

module.exports = { ProductionDeployment };
