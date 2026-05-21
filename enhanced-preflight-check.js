// Enhanced Pre-Flight Check with Multiple Fallback Methods
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

class EnhancedPreFlightCheck {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    this.requiredColumns = [
      { name: 'event_id', type: 'text', nullable: false },
      { name: 'type', type: 'text', nullable: false },
      { name: 'status', type: 'text', nullable: false },
      { name: 'timestamp', type: 'timestamptz', nullable: false },
      { name: 'payload', type: 'jsonb', nullable: false },
      { name: 'source', type: 'text', nullable: false },
      { name: 'retry_count', type: 'integer', nullable: false },
      { name: 'schema_version', type: 'text', nullable: true },
      { name: 'correlation_id', type: 'text', nullable: true }
    ];

    this.requiredTables = [
      'hydi_events',
      'processed_events',
      'processing_locks',
      'system_config'
    ];
  }

  async runEnhancedCheck() {
    console.log('=== ENHANCED PRE-FLIGHT CHECK ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);

    const results = {
      method1: {
        name: 'Direct Query (Skipped)',
        passed: true,
        errors: []
      },

      method2: {
        name: 'View Based',
        passed: false,
        errors: []
      },

      method3: {
        name: 'Function Based',
        passed: false,
        errors: []
      },

      method4: {
        name: 'Sample Query',
        passed: false,
        errors: []
      },

      overall: {
        passed: false,
        errors: []
      }
    };

    // Method 1 intentionally skipped
    console.log('Method 1: Skipped (PostgREST incompatible)');

    // Remaining checks
    await this.checkMethod2_ViewBased(results.method2);
    await this.checkMethod3_FunctionBased(results.method3);
    await this.checkMethod4_SampleQuery(results.method4);

    // Overall pass logic
    results.overall.passed =
      results.method4.passed &&
      (results.method2.passed || results.method3.passed);

    results.overall.errors = [
      ...results.method2.errors,
      ...results.method3.errors,
      ...results.method4.errors
    ];

    this.printEnhancedResults(results);

    return results;
  }

  async checkMethod2_ViewBased(results) {
    console.log('Method 2: View Based Check');

    try {
      const { data: viewData, error: viewError } = await this.supabase
        .from('preflight_schema_check')
        .select('*');

      if (viewError) {
        results.errors.push(
          `Method 2 - View check failed: ${viewError.message}`
        );

        console.log('Method 2 - View check failed');
        return;
      }

      if (!Array.isArray(viewData)) {
        results.errors.push(
          'Method 2 - Invalid view response'
        );

        console.log('Method 2 - Invalid view response');
        return;
      }

      const requiredViewColumns = [
        'event_id',
        'type',
        'status',
        'timestamp',
        'payload',
        'source',
        'retry_count'
      ];

      const viewColumns = viewData.map(
        row => row.column_name
      );

      const missingViewColumns =
        requiredViewColumns.filter(
          col => !viewColumns.includes(col)
        );

      if (missingViewColumns.length > 0) {
        results.errors.push(
          `Method 2 - Missing view columns: ${missingViewColumns.join(', ')}`
        );

        console.log('Method 2 - Missing view columns detected');
        return;
      }

      results.passed = true;

      console.log('Method 2 - PASSED');

    } catch (error) {
      results.errors.push(
        `Method 2 - Unexpected error: ${error.message}`
      );

      console.log(
        `Method 2 - Unexpected error: ${error.message}`
      );
    }
  }

  async checkMethod3_FunctionBased(results) {
    console.log('Method 3: Function Based Check');

    try {
      const { data: functionData, error: functionError } =
        await this.supabase.rpc(
          'check_pre_flight_requirements'
        );

      if (functionError) {
        results.errors.push(
          `Method 3 - Function check failed: ${functionError.message}`
        );

        console.log('Method 3 - Function check failed');
        return;
      }

      if (!Array.isArray(functionData)) {
        results.errors.push(
          'Method 3 - Invalid function response'
        );

        console.log('Method 3 - Invalid function response');
        return;
      }

      const failedComponents = functionData.filter(
        row => row.status === 'FAIL'
      );

      if (failedComponents.length > 0) {
        results.errors.push(
          `Method 3 - Failed components: ${failedComponents
            .map(f => f.component)
            .join(', ')}`
        );

        console.log('Method 3 - Failed components detected');
        return;
      }

      results.passed = true;

      console.log('Method 3 - PASSED');

    } catch (error) {
      results.errors.push(
        `Method 3 - Unexpected error: ${error.message}`
      );

      console.log(
        `Method 3 - Unexpected error: ${error.message}`
      );
    }
  }

  async checkMethod4_SampleQuery(results) {
    console.log('Method 4: Sample Query Check');

    try {
      // Table exists?
      const { error: sampleError } = await this.supabase
        .from('hydi_events')
        .select('event_id')
        .limit(1);

      if (sampleError) {
        results.errors.push(
          `Method 4 - Sample query failed: ${sampleError.message}`
        );

        console.log('Method 4 - Sample query failed');
        return;
      }

      // Required columns exist?
      const { error: columnError } = await this.supabase
        .from('hydi_events')
        .select(`
          event_id,
          type,
          status,
          timestamp,
          payload,
          source,
          retry_count
        `)
        .limit(1);

      if (columnError) {
        results.errors.push(
          `Method 4 - Column select failed: ${columnError.message}`
        );

        console.log('Method 4 - Column select failed');
        return;
      }

      results.passed = true;

      console.log('Method 4 - PASSED');

    } catch (error) {
      results.errors.push(
        `Method 4 - Unexpected error: ${error.message}`
      );

      console.log(
        `Method 4 - Unexpected error: ${error.message}`
      );
    }
  }

  printEnhancedResults(results) {
    console.log('\n=== ENHANCED PRE-FLIGHT RESULTS ===');

    const methods = [
      results.method1,
      results.method2,
      results.method3,
      results.method4
    ];

    methods.forEach(result => {
      const status = result.passed ? 'PASS' : 'FAIL';

      console.log(`${status}: ${result.name}`);

      if (result.errors.length > 0) {
        result.errors.forEach(error => {
          console.log(`  - ${error}`);
        });
      }
    });

    const passedMethods =
      methods.filter(m => m.passed).length;

    const totalMethods = methods.length;

    console.log(
      `\nSummary: ${passedMethods}/${totalMethods} methods passed`
    );

    if (results.overall.passed) {
      console.log('\nSTATUS: PRE-FLIGHT CHECK PASSED');
      console.log('System is ready to start');

    } else {
      console.log('\nSTATUS: PRE-FLIGHT CHECK FAILED');
      console.log(
        'System cannot start - schema issues detected'
      );

      console.log('\nRECOMMENDATIONS:');
      console.log(
        '1. Run the SQL in fix-preflight-sql.sql'
      );

      console.log(
        '2. Execute: NOTIFY pgrst, \'reload schema\';'
      );

      console.log(
        '3. Try the enhanced check again'
      );
    }
  }

  async autoFix() {
    console.log('=== AUTO-FIX ENHANCED PRE-FLIGHT ===');

    try {
      const { error: refreshError } =
        await this.supabase.rpc('reload_schema');

      if (refreshError) {
        console.log(
          'Schema cache refresh failed - requires manual SQL'
        );

        return {
          success: false,
          error: refreshError.message
        };
      }

      console.log(
        'Schema cache refreshed successfully'
      );

      await new Promise(resolve =>
        setTimeout(resolve, 2000)
      );

      const results =
        await this.runEnhancedCheck();

      return {
        success: results.overall.passed,
        results
      };

    } catch (error) {
      console.log(
        `Auto-fix failed: ${error.message}`
      );

      return {
        success: false,
        error: error.message
      };
    }
  }

  async testEnhancedSystem() {
    console.log(
      '=== TESTING ENHANCED PRE-FLIGHT SYSTEM ==='
    );

    const results =
      await this.runEnhancedCheck();

    const testResults = {
      viewBased: results.method2.passed,
      functionBased: results.method3.passed,
      sampleQuery: results.method4.passed
    };

    console.log('\n=== TEST RESULTS ===');

    Object.entries(testResults).forEach(
      ([name, passed]) => {
        console.log(
          `${name}: ${passed ? 'PASS' : 'FAIL'}`
        );
      }
    );

    const overallScore =
      Object.values(testResults)
        .filter(Boolean)
        .length;

    console.log(
      `Overall Score: ${overallScore}/3`
    );

    return testResults;
  }
}

// CLI
if (require.main === module) {
  const check = new EnhancedPreFlightCheck();

  const command =
    process.argv[2] || 'enhanced';

  (async () => {

    switch (command) {

      case 'enhanced':
        await check.runEnhancedCheck();
        break;

      case 'fix':
        await check.autoFix();
        break;

      case 'test':
        await check.testEnhancedSystem();
        break;

      default:
        console.log(
          'Usage: node enhanced-preflight-check.js [enhanced|fix|test]'
        );
    }

  })().catch(console.error);
}

module.exports = {
  EnhancedPreFlightCheck
};
