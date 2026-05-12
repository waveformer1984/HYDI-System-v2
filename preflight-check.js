require('dotenv').config({ path: '.env.production' });
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Final Pre-Flight Checklist
class PreFlightCheck {
  constructor() {
    this.checks = [];
    this.passed = 0;
    this.failed = 0;
    this.warnings = 0;
  }

  async runAllChecks() {
    console.log('=== HYDI PRE-FLIGHT CHECKLIST ===');
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log('');

    await this.checkEnvironment();
    await this.checkDatabase();
    await this.checkSecurity();
    await this.checkServices();
    await this.checkInfrastructure();
    
    this.printSummary();
    
    return this.failed === 0;
  }

  async checkEnvironment() {
    console.log('--- ENVIRONMENT CHECKS ---');
    
    // Check production environment
    this.check('NODE_ENV', process.env.NODE_ENV === 'production', 'NODE_ENV should be "production"');
    
    // Check required environment variables
    const requiredVars = [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_ANON_KEY',
      'PORT',
      'DASHBOARD_PORT'
    ];
    
    for (const varName of requiredVars) {
      this.check(varName, process.env[varName], `${varName} should be set`);
    }
    
    // Check CORS configuration
    this.check('CORS_ORIGIN', process.env.CORS_ORIGIN, 'CORS_ORIGIN should be configured');
    
    // Check operational settings
    this.check('CHAOS_MODE', process.env.CHAOS_MODE === 'NONE', 'CHAOS_MODE should be "NONE"');
    this.check('LOG_LEVEL', ['info', 'warn', 'error'].includes(process.env.LOG_LEVEL), 'LOG_LEVEL should be valid');
    
    console.log('');
  }

  async checkDatabase() {
    console.log('--- DATABASE CHECKS ---');
    
    try {
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      
      // Test connectivity
      const { data, error } = await supabase
        .from('hydi_events')
        .select('count')
        .limit(1);
      
      this.check('DB Connectivity', !error, `Database connectivity: ${error ? error.message : 'OK'}`);
      
      // Check table exists and is accessible
      if (!error) {
        this.check('Table Access', true, 'hydi_events table accessible');
      }
      
      // Test service role key permissions
      const { data: testData, error: testError } = await supabase
        .from('hydi_events')
        .select('*')
        .limit(1);
      
      this.check('Service Role Key', !testError, `Service role key: ${testError ? testError.message : 'Valid'}`);
      
      // Test anon key permissions (read-only)
      const anonSupabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY
      );
      
      const { data: anonData, error: anonError } = await anonSupabase
        .from('hydi_events')
        .select('*')
        .limit(1);
      
      // Anon key should be able to read (if RLS is properly configured)
      this.check('Anon Key', !anonError || anonError.message.includes('permission'), `Anon key: ${anonError ? anonError.message : 'Valid'}`);
      
    } catch (error) {
      this.check('DB Connection', false, `Database connection failed: ${error.message}`);
    }
    
    console.log('');
  }

  async checkSecurity() {
    console.log('--- SECURITY CHECKS ---');
    
    // Check for exposed service role key in frontend-accessible files
    const frontendFiles = ['ursula-dashboard.js'];
    
    for (const file of frontendFiles) {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf8');
        const hasServiceKey = content.includes('SUPABASE_SERVICE_ROLE_KEY');
        
        this.check(
          `Security: ${file}`, 
          !hasServiceKey, 
          `${file} should not use SERVICE_ROLE_KEY (security risk)`
        );
      }
    }
    
    // Check CORS domain restriction
    const corsOrigin = process.env.CORS_ORIGIN;
    const isRestricted = corsOrigin && corsOrigin !== '*' && corsOrigin !== 'http://localhost:*';
    
    this.check(
      'CORS Restriction', 
      isRestricted, 
      `CORS should be restricted to specific domain (current: ${corsOrigin})`
    );
    
    // Check rate limiting
    const rateLimitEnabled = process.env.RATE_LIMIT_ENABLED === 'true';
    this.check('Rate Limiting', rateLimitEnabled, 'Rate limiting should be enabled');
    
    console.log('');
  }

  async checkServices() {
    console.log('--- SERVICE CHECKS ---');
    
    // Check if required files exist
    const requiredFiles = [
      'protoforge-mock.js',
      'hydi-processor.js', 
      'ursula-dashboard.js',
      '.env.production'
    ];
    
    for (const file of requiredFiles) {
      this.check(`File: ${file}`, fs.existsSync(file), `${file} should exist`);
    }
    
    // Check package.json scripts
    try {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const hasScripts = packageJson.scripts && Object.keys(packageJson.scripts).length > 0;
      
      this.check('Package Scripts', hasScripts, 'package.json should have scripts defined');
      
    } catch (error) {
      this.check('Package JSON', false, 'package.json is missing or invalid');
    }
    
    // Check PM2 configuration
    this.check('PM2 Config', fs.existsSync('ecosystem.config.js'), 'ecosystem.config.js should exist');
    
    console.log('');
  }

  async checkInfrastructure() {
    console.log('--- INFRASTRUCTURE CHECKS ---');
    
    // Check log directory
    const logDir = '/var/log/hydi';
    const logDirExists = fs.existsSync(logDir) || process.env.NODE_ENV !== 'production';
    
    this.check('Log Directory', logDirExists, `Log directory should exist: ${logDir}`);
    
    // Check monitoring configuration
    const prometheusEnabled = process.env.PROMETHEUS_ENABLED === 'true';
    this.check('Prometheus', prometheusEnabled, 'Prometheus monitoring should be enabled');
    
    // Check kill switch configuration
    const killSwitchPath = process.env.FALLBACK_LOG_PATH;
    this.check('Kill Switch', !!killSwitchPath, `Kill switch path should be configured: ${killSwitchPath}`);
    
    // Check process management settings
    const pm2Instances = parseInt(process.env.PM2_INSTANCES);
    this.check('PM2 Instances', pm2Instances > 0, `PM2 instances should be > 0 (current: ${pm2Instances})`);
    
    console.log('');
  }

  check(name, condition, message) {
    const result = {
      name,
      passed: condition,
      message,
      timestamp: new Date().toISOString()
    };
    
    this.checks.push(result);
    
    if (condition) {
      console.log(`\u2705 ${name}: ${message}`);
      this.passed++;
    } else {
      console.log(`\u274c ${name}: ${message}`);
      this.failed++;
    }
  }

  printSummary() {
    console.log('=== PRE-FLIGHT SUMMARY ===');
    console.log(`Total Checks: ${this.checks.length}`);
    console.log(`\u2705 Passed: ${this.passed}`);
    console.log(`\u274c Failed: ${this.failed}`);
    console.log(`\u26a0\ufe0f Warnings: ${this.warnings}`);
    
    if (this.failed === 0) {
      console.log('\n\ud83d\ude80 ALL CHECKS PASSED - SYSTEM READY FOR DEPLOYMENT');
    } else {
      console.log('\n\u274c DEPLOYMENT BLOCKED - Fix failed checks before proceeding');
      
      console.log('\nFailed checks:');
      this.checks.filter(check => !check.passed).forEach(check => {
        console.log(`- ${check.name}: ${check.message}`);
      });
    }
    
    console.log('========================');
  }

  getResults() {
    return {
      checks: this.checks,
      summary: {
        total: this.checks.length,
        passed: this.passed,
        failed: this.failed,
        warnings: this.warnings,
        ready: this.failed === 0
      }
    };
  }
}

// CLI interface
if (require.main === module) {
  const preFlight = new PreFlightCheck();
  
  preFlight.runAllChecks().then(ready => {
    process.exit(ready ? 0 : 1);
  }).catch(error => {
    console.error('Pre-flight check failed:', error);
    process.exit(1);
  });
}

module.exports = { PreFlightCheck };
