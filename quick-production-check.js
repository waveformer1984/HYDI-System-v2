/**
 * Quick Production Verification - Focused on critical issues
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

class QuickProductionCheck {
  constructor() {
    this.results = { passed: [], failed: [], warnings: [] };
  }

  log(category, message, status = 'info') {
    const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : status === 'warn' ? '⚠️' : 'ℹ️';
    console.log(`${icon} [${category}] ${message}`);
    
    if (status === 'pass') this.results.passed.push(`${category}: ${message}`);
    else if (status === 'fail') this.results.failed.push(`${category}: ${message}`);
    else if (status === 'warn') this.results.warnings.push(`${category}: ${message}`);
  }

  async checkServiceKeyExposure() {
    console.log('\n🔒 SERVICE KEY SECURITY CHECK');
    
    const files = [
      'signup.html',
      'success.html', 
      'server.js',
      'api/checkout.js',
      'hydi-api-checkout.js'
    ];

    for (const file of files) {
      const filePath = path.join(__dirname, file);
      
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Check for service role key exposure
        if (content.includes(process.env.SUPABASE_SERVICE_ROLE_KEY)) {
          this.log('SECURITY', `Service role key exposed in ${file}`, 'fail');
        } else {
          this.log('SECURITY', `Service role key secure in ${file}`, 'pass');
        }
        
        // Check for stripe secret key exposure
        if (content.includes(process.env.STRIPE_SECRET_KEY)) {
          this.log('SECURITY', `Stripe secret key exposed in ${file}`, 'fail');
        } else {
          this.log('SECURITY', `Stripe secret key secure in ${file}`, 'pass');
        }
      }
    }
  }

  async checkWebhookSecurity() {
    console.log('\n🔐 WEBHOOK SECURITY VALIDATION');
    
    try {
      const webhookEndpoint = process.env.webhook_endpoint;
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      
      if (!webhookEndpoint) {
        this.log('WEBHOOK', 'Webhook endpoint not configured', 'fail');
        return;
      }

      if (!webhookSecret || !webhookSecret.startsWith('whsec_')) {
        this.log('WEBHOOK', 'Invalid webhook secret', 'fail');
        return;
      }

      this.log('WEBHOOK', 'Webhook endpoint configured', 'pass');
      this.log('WEBHOOK', 'Webhook secret properly formatted', 'pass');

      // Test webhook signature validation
      const testPayload = JSON.stringify({ test: true, type: 'test.created' });
      const testSignature = 'whsec_invalid_signature_test';
      
      const response = await fetch(webhookEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': testSignature
        },
        body: testPayload
      });

      // Should reject invalid signatures
      if (response.status === 401 || response.status === 403 || response.status === 400) {
        this.log('WEBHOOK', 'Webhook signature validation working', 'pass');
      } else {
        this.log('WEBHOOK', `Webhook not validating signatures (${response.status})`, 'fail');
      }
    } catch (error) {
      this.log('WEBHOOK', `Webhook check failed: ${error.message}`, 'fail');
    }
  }

  async checkEdgeFunctions() {
    console.log('\n🔥 EDGE FUNCTIONS HEALTH');
    
    const functions = [
      { name: 'stripe-webhook', method: 'POST', slug: 'stripe-webhook' },
      { name: 'events-stream', method: 'GET', slug: 'events-stream' },
      { name: 'monitoring-health', method: 'GET', slug: 'monitoring-health' },
      { name: 'stripe-transfer-payout', method: 'GET', slug: 'stripe-transfer-payout' }
    ];

    for (const func of functions) {
      try {
        const endpoint = `${process.env.SUPABASE_URL}/functions/v1/${func.slug}`;
        const options = {
          method: func.method,
          headers: {
            'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
          }
        };
        
        if (func.method === 'POST') {
          options.body = JSON.stringify({ healthCheck: true });
        }

        const response = await fetch(endpoint, options);
        
        if (response.ok || response.status === 400 || response.status === 405) {
          this.log('EDGE_FUNC', `${func.name}: Healthy (${response.status})`, 'pass');
        } else {
          this.log('EDGE_FUNC', `${func.name}: HTTP ${response.status}`, 'fail');
        }
      } catch (error) {
        this.log('EDGE_FUNC', `${func.name}: ${error.message}`, 'fail');
      }
    }
  }

  async checkPaymentConfiguration() {
    console.log('\n💳 PAYMENT CONFIGURATION');
    
    // Check Stripe keys
    if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_')) {
      this.log('PAYMENT', 'Stripe secret key configured', 'pass');
    } else {
      this.log('PAYMENT', 'Stripe secret key missing/invalid', 'fail');
    }

    // Check price IDs
    const priceIds = [
      'STRIPE_HYDI_STARTER_PRICE_ID',
      'STRIPE_HYDI_PRO_PRICE_ID', 
      'STRIPE_HYDI_ENTERPRISE_PRICE_ID'
    ];

    for (const priceIdKey of priceIds) {
      const priceId = process.env[priceIdKey];
      if (priceId && priceId.startsWith('price_')) {
        this.log('PAYMENT', `${priceIdKey}: Valid`, 'pass');
      } else {
        this.log('PAYMENT', `${priceIdKey}: Missing/invalid`, 'fail');
      }
    }

    // Test checkout API with proper timeout and error handling
    try {
      const checkoutUrl = process.env.CHECKOUT_URL || 'http://127.0.0.1:3001/api/checkout';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      
      let response;
      try {
        response = await fetch(checkoutUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tier: 'starter',
            email: 'healthcheck@hydi.local',
            company: 'hydi-test'
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        this.log('PAYMENT', 'Checkout API responding correctly', 'pass');
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        this.log('PAYMENT', 'Checkout API timeout (8s)', 'fail');
      } else {
        this.log('PAYMENT', `Checkout API failed: ${error.message}`, 'fail');
      }
    }
  }

  async checkEnvironmentSecurity() {
    console.log('\n🌍 ENVIRONMENT SECURITY');
    
    // Check for exposed keys in .env
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      
      // Check for placeholder values
      if (envContent.includes('YOUR/SLACK/WEBHOOK')) {
        this.log('ENV', 'Slack webhook URL needs configuration', 'warn');
      } else {
        this.log('ENV', 'Slack webhook configured', 'pass');
      }

      // Check for redacted values
      if (envContent.includes('[REDACTED]')) {
        this.log('ENV', 'Sensitive keys properly redacted', 'pass');
      }
    }

    // Check if running in production
    if (process.env.NODE_ENV === 'production') {
      this.log('ENV', 'Running in production mode', 'pass');
    } else {
      this.log('ENV', 'Not in production mode', 'warn');
    }
  }

  async runQuickCheck() {
    console.log('⚡ HYDI QUICK PRODUCTION CHECK');
    console.log('==============================');
    
    await this.checkServiceKeyExposure();
    await this.checkWebhookSecurity();
    await this.checkEdgeFunctions();
    await this.checkPaymentConfiguration();
    await this.checkEnvironmentSecurity();
    
    console.log('\n📊 QUICK CHECK SUMMARY');
    console.log('======================');
    
    console.log(`✅ Passed: ${this.results.passed.length}`);
    console.log(`❌ Failed: ${this.results.failed.length}`);
    console.log(`⚠️  Warnings: ${this.results.warnings.length}`);
    
    if (this.results.failed.length > 0) {
      console.log('\n❌ CRITICAL ISSUES TO FIX:');
      this.results.failed.forEach(failure => console.log(`  - ${failure}`));
    }
    
    if (this.results.warnings.length > 0) {
      console.log('\n⚠️  WARNINGS TO REVIEW:');
      this.results.warnings.forEach(warning => console.log(`  - ${warning}`));
    }
    
    const overallStatus = this.results.failed.length === 0 ? 'PASS' : 'FAIL';
    console.log(`\n🎯 OVERALL STATUS: ${overallStatus}`);
    
    if (overallStatus === 'PASS') {
      console.log('\n🚀 READY FOR TRAFFIC!');
    } else {
      console.log('\n🛠️  FIX CRITICAL ISSUES BEFORE SCALING');
    }
    
    return {
      status: overallStatus,
      passed: this.results.passed.length,
      failed: this.results.failed.length,
      warnings: this.results.warnings.length
    };
  }
}

// Run if called directly
if (require.main === module) {
  const checker = new QuickProductionCheck();
  checker.runQuickCheck()
    .then(result => {
      process.exit(result.status === 'PASS' ? 0 : 1);
    })
    .catch(error => {
      console.error('Quick check failed:', error);
      process.exit(1);
    });
}

module.exports = QuickProductionCheck;
