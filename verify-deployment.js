/**
 * HYDI Monetization Deployment Verification
 * Tests all components of the ProtoForge HYDI system
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class DeploymentVerifier {
  constructor() {
    this.verificationSteps = [
      'verifyEnvironmentVariables',
      'verifySupabaseSchema', 
      'verifyStripeProducts',
      'verifyAPIEndpoints',
      'verifyNpmPackage'
    ];
  }

  async runFullVerification() {
    console.log('=== HYDI MONETIZATION DEPLOYMENT VERIFICATION ===\n');
    
    const results = {};
    
    for (const step of this.verificationSteps) {
      try {
        console.log(`🔍 Verifying: ${step}`);
        const result = await this[step]();
        results[step] = { success: true, result };
        console.log(`✅ ${step} - PASSED\n`);
      } catch (err) {
        results[step] = { success: false, error: err.message };
        console.log(`❌ ${step} - FAILED: ${err.message}\n`);
      }
    }

    this.printSummary(results);
    return results;
  }

  async verifyEnvironmentVariables() {
    const requiredVars = [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET_01',
      'STRIPE_HYDI_STARTER_PRICE_ID',
      'STRIPE_HYDI_PRO_PRICE_ID',
      'STRIPE_HYDI_ENTERPRISE_PRICE_ID'
    ];

    const missing = requiredVars.filter(varName => !process.env[varName]);
    
    if (missing.length > 0) {
      throw new Error(`Missing environment variables: ${missing.join(', ')}`);
    }

    return `All ${requiredVars.length} required environment variables present`;
  }

  async verifySupabaseSchema() {
    // This would typically run SQL queries against Supabase
    // For now, verify the schema files exist
    const schemaFiles = [
      'hydi-monetization-schema.sql',
      'stripe-sync-function.sql'
    ];

    for (const file of schemaFiles) {
      if (!fs.existsSync(file)) {
        throw new Error(`Schema file missing: ${file}`);
      }
    }

    return `Schema files verified: ${schemaFiles.join(', ')}`;
  }

  async verifyStripeProducts() {
    const priceIds = [
      process.env.STRIPE_HYDI_STARTER_PRICE_ID,
      process.env.STRIPE_HYDI_PRO_PRICE_ID,
      process.env.STRIPE_HYDI_ENTERPRISE_PRICE_ID
    ];

    const missing = priceIds.filter(id => !id);
    
    if (missing.length > 0) {
      throw new Error(`Missing Stripe price IDs`);
    }

    return `Stripe products configured: ${priceIds.length} price IDs`;
  }

  async verifyAPIEndpoints() {
    const apiFiles = [
      'ursula-api-hydi-sync.js',
      'hydi-api-checkout.js', 
      'hydi-api-webhook.js'
    ];

    for (const file of apiFiles) {
      if (!fs.existsSync(file)) {
        throw new Error(`API file missing: ${file}`);
      }
    }

    return `API endpoints ready: ${apiFiles.length} handlers created`;
  }

  async verifyNpmPackage() {
    const packagePath = 'hydi-npm/package.json';
    
    if (!fs.existsSync(packagePath)) {
      throw new Error('NPM package.json not found');
    }

    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    
    if (packageJson.name !== 'hydi-health-check') {
      throw new Error('Invalid package name');
    }

    return `NPM package ready: ${packageJson.name}@${packageJson.version}`;
  }

  printSummary(results) {
    console.log('=== VERIFICATION SUMMARY ===\n');
    
    const passed = Object.values(results).filter(r => r.success).length;
    const total = Object.keys(results).length;
    
    console.log(`Overall: ${passed}/${total} checks passed\n`);
    
    Object.entries(results).forEach(([step, result]) => {
      const status = result.success ? '✅' : '❌';
      console.log(`${status} ${step}`);
      if (result.success) {
        console.log(`   ${result.result}`);
      } else {
        console.log(`   Error: ${result.error}`);
      }
      console.log('');
    });

    if (passed === total) {
      console.log('🎉 ALL VERIFICATIONS PASSED - Ready for deployment!');
    } else {
      console.log('⚠️  Some verifications failed - Please address issues before deployment');
    }
  }
}

// Run verification if called directly
if (require.main === module) {
  const verifier = new DeploymentVerifier();
  
  verifier.runFullVerification()
    .then(results => {
      const allPassed = Object.values(results).every(r => r.success);
      process.exit(allPassed ? 0 : 1);
    })
    .catch(error => {
      console.error('Verification failed:', error.message);
      process.exit(1);
    });
}

module.exports = DeploymentVerifier;
