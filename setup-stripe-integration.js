/**
 * Stripe Integration Setup
 * Complete setup for Stripe webhook processing and service provisioning
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class StripeIntegrationSetup {
  constructor() {
    this.setupSteps = [
      'checkEnvironment',
      'runDatabaseMigration', 
      'startWebhookServer',
      'startStripeListener',
      'testWebhookIntegration',
      'startPerformanceMonitor'
    ];
  }
  
  async runCompleteSetup() {
    console.log('=== STRIPE INTEGRATION COMPLETE SETUP ===\n');
    
    for (const step of this.setupSteps) {
      try {
        console.log(`Step: ${step}`);
        await this[step]();
        console.log(`   ${step} - SUCCESS\n`);
      } catch (err) {
        console.error(`   ${step} - FAILED: ${err.message}\n`);
        throw err;
      }
    }
    
    console.log('=== STRIPE INTEGRATION SETUP COMPLETE ===');
    console.log('Revenue pipeline is now fully operational!');
  }
  
  async checkEnvironment() {
    const requiredVars = [
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET_01',
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY'
    ];
    
    const missing = requiredVars.filter(varName => !process.env[varName]);
    
    if (missing.length > 0) {
      throw new Error(`Missing environment variables: ${missing.join(', ')}`);
    }
    
    console.log('Environment variables verified');
  }
  
  async runDatabaseMigration() {
    console.log('Running Stripe integration schema migration...');
    
    // This would typically be run in Supabase dashboard
    console.log('Please run stripe-integration-schema.sql in Supabase dashboard');
    console.log('https://supabase.com/dashboard/project/wufhlhrbskacneneylqa/sql');
  }
  
  async startWebhookServer() {
    console.log('Starting Stripe webhook server...');
    
    return new Promise((resolve, reject) => {
      const server = spawn('node', ['stripe-webhook-server.js'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd()
      });
      
      server.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`Webhook Server: ${output.trim()}`);
        
        if (output.includes('running on port')) {
          resolve(server);
        }
      });
      
      server.stderr.on('data', (data) => {
        console.error(`Webhook Server Error: ${data.toString()}`);
      });
      
      server.on('error', (err) => {
        reject(err);
      });
      
      // Timeout after 10 seconds
      setTimeout(() => {
        reject(new Error('Webhook server failed to start within 10 seconds'));
      }, 10000);
    });
  }
  
  async startStripeListener() {
    console.log('Starting Stripe CLI listener...');
    console.log('Run this command in a separate terminal:');
    console.log('stripe listen --forward-to localhost:3000/api/webhooks/stripe');
    console.log('');
    console.log('Press Enter when Stripe listener is running...');
    
    // Wait for user confirmation
    return new Promise((resolve) => {
      process.stdin.once('data', () => {
        resolve();
      });
    });
  }
  
  async testWebhookIntegration() {
    console.log('Testing Stripe webhook integration...');
    
    return new Promise((resolve, reject) => {
      const stripe = spawn('stripe', ['trigger', 'checkout.session.completed'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd()
      });
      
      let output = '';
      
      stripe.stdout.on('data', (data) => {
        output += data.toString();
        console.log(`Stripe CLI: ${data.toString().trim()}`);
      });
      
      stripe.stderr.on('data', (data) => {
        console.error(`Stripe CLI Error: ${data.toString()}`);
      });
      
      stripe.on('close', (code) => {
        if (code === 0) {
          console.log('Stripe webhook test triggered successfully');
          console.log('Check your performance monitor for the new lead!');
          resolve();
        } else {
          reject(new Error(`Stripe CLI exited with code ${code}`));
        }
      });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        reject(new Error('Stripe webhook test timed out'));
      }, 30000);
    });
  }
  
  async startPerformanceMonitor() {
    console.log('Starting performance monitor...');
    
    return new Promise((resolve, reject) => {
      const monitor = spawn('node', ['performance-monitor.js'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd()
      });
      
      monitor.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`Performance Monitor: ${output.trim()}`);
        
        if (output.includes('Performance Monitor started')) {
          resolve(monitor);
        }
      });
      
      monitor.stderr.on('data', (data) => {
        console.error(`Performance Monitor Error: ${data.toString()}`);
      });
      
      monitor.on('error', (err) => {
        reject(err);
      });
      
      // Timeout after 10 seconds
      setTimeout(() => {
        reject(new Error('Performance monitor failed to start within 10 seconds'));
      }, 10000);
    });
  }
  
  generateSetupInstructions() {
    const instructions = `
=== STRIPE INTEGRATION SETUP INSTRUCTIONS ===

1. PREPARE ENVIRONMENT
   Ensure these environment variables are set:
   - STRIPE_SECRET_KEY (sk_test_... or sk_live_...)
   - STRIPE_WEBHOOK_SECRET_01
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY

2. RUN DATABASE MIGRATION
   Execute stripe-integration-schema.sql in Supabase dashboard:
   https://supabase.com/dashboard/project/wufhlhrbskacneneylqa/sql

3. START WEBHOOK SERVER
   node stripe-webhook-server.js

4. START STRIPE LISTENER
   In a separate terminal:
   stripe listen --forward-to localhost:3000/api/webhooks/stripe

5. TEST INTEGRATION
   stripe trigger checkout.session.completed

6. START MONITORING
   node performance-monitor.js

7. VERIFY REVENUE PIPELINE
   Check that leads are created when Stripe events are triggered
   Verify services are provisioned through the Agent Bus
   Monitor revenue metrics in the performance dashboard

=== TROUBLESHOOTING ===

If Stripe CLI is not installed:
   npm install -g stripe-cli

If webhook signature verification fails:
   Check that STRIPE_WEBHOOK_SECRET_01 matches the CLI output
   Ensure the webhook server is receiving raw JSON

If services are not provisioned:
   Check the Agent Bus logs for provisioning messages
   Verify the Service Provisioner is initialized

If revenue is not tracked:
   Check the revenue_tracking table in Supabase
   Verify Stripe events are being processed correctly
`;
    
    return instructions;
  }
}

// Run setup if called directly
if (require.main === module) {
  const setup = new StripeIntegrationSetup();
  
  if (process.argv.includes('--help')) {
    console.log(setup.generateSetupInstructions());
    process.exit(0);
  }
  
  setup.runCompleteSetup()
    .then(() => {
      console.log('\nRevenue pipeline is now fully operational!');
      console.log('The Forge is ready to process real payments and provision services.');
    })
    .catch(err => {
      console.error('\nSetup failed:', err.message);
      console.log('\nFor detailed instructions, run: node setup-stripe-integration.js --help');
      process.exit(1);
    });
}

module.exports = StripeIntegrationSetup;
