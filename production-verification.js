/**
 * HYDI Production Verification Suite
 * Comprehensive checks before traffic scaling
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

class ProductionVerification {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    this.results = {
      passed: [],
      failed: [],
      warnings: []
    };
  }

  log(category, message, status = 'info') {
    const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : status === 'warn' ? '⚠️' : 'ℹ️';
    console.log(`${icon} [${category}] ${message}`);
    
    if (status === 'pass') this.results.passed.push(`${category}: ${message}`);
    else if (status === 'fail') this.results.failed.push(`${category}: ${message}`);
    else if (status === 'warn') this.results.warnings.push(`${category}: ${message}`);
  }

  async checkEdgeFunctions() {
    console.log('\n🔥 EDGE FUNCTIONS HEALTH CHECK');
    
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
        
        if (response.ok || response.status === 400) {
          this.log('EDGE_FUNC', `${func.name}: Healthy (${response.status})`, 'pass');
        } else {
          this.log('EDGE_FUNC', `${func.name}: HTTP ${response.status}`, 'fail');
        }
      } catch (error) {
        this.log('EDGE_FUNC', `${func.name}: ${error.message}`, 'fail');
      }
    }
  }

  async checkRecentLogs() {
    console.log('\n📋 RECENT LOGS ANALYSIS');
    
    try {
      // Check Supabase logs for edge functions
      const { data: logs, error } = await this.supabase
        .from('logs')
        .select('*')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        this.log('LOGS', `Failed to fetch logs: ${error.message}`, 'fail');
        return;
      }

      const errorLogs = logs?.filter(log => 
        log.level === 'error' || 
        log.message.includes('stripe') || 
        log.message.includes('payment')
      ) || [];

      if (errorLogs.length === 0) {
        this.log('LOGS', 'No payment/provisioning errors in last 24h', 'pass');
      } else {
        this.log('LOGS', `${errorLogs.length} payment/provisioning errors found`, 'warn');
        errorLogs.forEach(log => {
          this.log('LOGS', `Error: ${log.message}`, 'warn');
        });
      }
    } catch (error) {
      this.log('LOGS', `Log analysis failed: ${error.message}`, 'fail');
    }
  }

  async checkSecurity() {
    console.log('\n🔒 SECURITY AUDIT');
    
    // Check 1: Service role key exposure
    try {
      const files = [
        'signup.html',
        'success.html',
        'server.js',
        'api/checkout.js'
      ];

      for (const file of files) {
        const fs = require('fs');
        const path = require('path');
        const filePath = path.join(__dirname, file);
        
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          if (content.includes(process.env.SUPABASE_SERVICE_ROLE_KEY)) {
            this.log('SECURITY', `Service role key exposed in ${file}`, 'fail');
          } else {
            this.log('SECURITY', `Service role key secure in ${file}`, 'pass');
          }
        }
      }
    } catch (error) {
      this.log('SECURITY', `Security check failed: ${error.message}`, 'fail');
    }

    // Check 2: RLS policies
    try {
      const { data: tables, error } = await this.supabase
        .from('pg_tables')
        .select('tablename')
        .eq('schemaname', 'public');

      if (error) {
        this.log('SECURITY', `Failed to check tables: ${error.message}`, 'fail');
        return;
      }

      const criticalTables = ['users', 'subscriptions', 'payments', 'customers'];
      
      for (const table of criticalTables) {
        const { data: policies, error: policyError } = await this.supabase
          .rpc('get_policies_for_table', { table_name: table });

        if (policyError || !policies || policies.length === 0) {
          this.log('SECURITY', `Missing RLS policies for table: ${table}`, 'fail');
        } else {
          this.log('SECURITY', `RLS policies exist for: ${table}`, 'pass');
        }
      }
    } catch (error) {
      this.log('SECURITY', `RLS check failed: ${error.message}`, 'fail');
    }
  }

  async checkPerformance() {
    console.log('\n⚡ PERFORMANCE ANALYSIS');
    
    try {
      // Check 1: Database size and query performance
      const { data: dbStats, error } = await this.supabase
        .rpc('get_database_stats');

      if (error) {
        this.log('PERF', `Failed to get DB stats: ${error.message}`, 'warn');
      } else {
        this.log('PERF', `Database size: ${dbStats?.size_mb || 'Unknown'}MB`, 'info');
      }

      // Check 2: Index analysis
      const { data: indexes, error: idxError } = await this.supabase
        .from('pg_indexes')
        .select('*')
        .eq('schemaname', 'public');

      if (idxError) {
        this.log('PERF', `Failed to check indexes: ${idxError.message}`, 'fail');
      } else {
        const indexCount = indexes?.length || 0;
        if (indexCount < 5) {
          this.log('PERF', `Low index count: ${indexCount} (may need optimization)`, 'warn');
        } else {
          this.log('PERF', `Adequate indexing: ${indexCount} indexes`, 'pass');
        }
      }

      // Check 3: Recent slow queries
      const { data: slowQueries, error: slowError } = await this.supabase
        .from('pg_stat_statements')
        .select('*')
        .gt('mean_exec_time', 1000)
        .limit(10);

      if (slowError) {
        this.log('PERF', `Failed to check slow queries: ${slowError.message}`, 'warn');
      } else if (slowQueries && slowQueries.length > 0) {
        this.log('PERF', `${slowQueries.length} slow queries detected (>1s)`, 'warn');
      } else {
        this.log('PERF', 'No slow queries detected', 'pass');
      }
    } catch (error) {
      this.log('PERF', `Performance check failed: ${error.message}`, 'fail');
    }
  }

  async checkWebhookSecurity() {
    console.log('\n🔐 WEBHOOK SECURITY VALIDATION');
    
    try {
      // Check 1: Stripe webhook endpoint configuration
      const webhookEndpoint = process.env.webhook_endpoint;
      if (!webhookEndpoint) {
        this.log('WEBHOOK', 'Webhook endpoint not configured', 'fail');
        return;
      }

      // Test webhook with invalid signature
      const testPayload = JSON.stringify({ test: true });
      const testSignature = 'whsec_invalid_signature';
      
      const response = await fetch(webhookEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': testSignature
        },
        body: testPayload
      });

      if (response.status === 401 || response.status === 403) {
        this.log('WEBHOOK', 'Webhook signature validation working', 'pass');
      } else {
        this.log('WEBHOOK', `Webhook signature validation may be broken (${response.status})`, 'fail');
      }

      // Check 2: Webhook secret configured
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (webhookSecret && webhookSecret.startsWith('whsec_')) {
        this.log('WEBHOOK', 'Stripe webhook secret configured', 'pass');
      } else {
        this.log('WEBHOOK', 'Invalid or missing webhook secret', 'fail');
      }
    } catch (error) {
      this.log('WEBHOOK', `Webhook security check failed: ${error.message}`, 'fail');
    }
  }

  async checkProvisioningReliability() {
    console.log('\n🔄 PROVISIONING RELIABILITY');
    
    try {
      // Check 1: Duplicate webhook handling
      const { data: duplicateEvents, error } = await this.supabase
        .from('webhook_events')
        .select('stripe_event_id, count')
        .group('stripe_event_id')
        .having('count > 1')
        .limit(10);

      if (error) {
        this.log('PROVISION', `Failed to check duplicates: ${error.message}`, 'fail');
      } else if (duplicateEvents && duplicateEvents.length > 0) {
        this.log('PROVISION', `${duplicateEvents.length} duplicate webhook events found`, 'warn');
      } else {
        this.log('PROVISION', 'No duplicate webhook events detected', 'pass');
      }

      // Check 2: Idempotency in customer creation
      const { data: customers, error: custError } = await this.supabase
        .from('customers')
        .select('stripe_customer_id, email')
        .group('stripe_customer_id, email')
        .having('count(*) > 1');

      if (custError) {
        this.log('PROVISION', `Failed to check customer duplicates: ${custError.message}`, 'fail');
      } else if (customers && customers.length > 0) {
        this.log('PROVISION', `${customers.length} duplicate customer records found`, 'warn');
      } else {
        this.log('PROVISION', 'Customer records are unique', 'pass');
      }

      // Check 3: Recent provisioning success rate
      const { data: recentProvisions, error: provError } = await this.supabase
        .from('provisioning_logs')
        .select('status, count')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .group('status');

      if (provError) {
        this.log('PROVISION', 'Unable to check provisioning success rate', 'warn');
      } else {
        const total = recentProvisions?.reduce((sum, item) => sum + item.count, 0) || 0;
        const success = recentProvisions?.find(item => item.status === 'success')?.count || 0;
        const successRate = total > 0 ? (success / total * 100).toFixed(1) : 0;
        
        if (successRate >= 95) {
          this.log('PROVISION', `Provisioning success rate: ${successRate}%`, 'pass');
        } else {
          this.log('PROVISION', `Low provisioning success rate: ${successRate}%`, 'fail');
        }
      }
    } catch (error) {
      this.log('PROVISION', `Provisioning check failed: ${error.message}`, 'fail');
    }
  }

  async runAllChecks() {
    console.log('🚀 HYDI PRODUCTION VERIFICATION SUITE');
    console.log('=====================================');
    
    await this.checkEdgeFunctions();
    await this.checkRecentLogs();
    await this.checkSecurity();
    await this.checkPerformance();
    await this.checkWebhookSecurity();
    await this.checkProvisioningReliability();
    
    console.log('\n📊 VERIFICATION SUMMARY');
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
    
    return {
      status: overallStatus,
      passed: this.results.passed.length,
      failed: this.results.failed.length,
      warnings: this.results.warnings.length,
      details: this.results
    };
  }
}

// Run if called directly
if (require.main === module) {
  const verifier = new ProductionVerification();
  verifier.runAllChecks()
    .then(result => {
      process.exit(result.status === 'PASS' ? 0 : 1);
    })
    .catch(error => {
      console.error('Verification suite failed:', error);
      process.exit(1);
    });
}

module.exports = ProductionVerification;
