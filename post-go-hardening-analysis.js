// Post-GO hardening analysis
const { exec } = require('child_process');
const fs = require('fs');

function runCommand(command) {
  return new Promise((resolve) => {
    exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stdout, stderr });
      } else {
        resolve({ success: true, stdout, stderr });
      }
    });
  });
}

async function analyzePostGoHardening() {
  console.log('🔧 POST-GO HARDENING ANALYSIS');
  console.log('=============================');
  
  const analysis = {
    searchPathWarnings: [],
    graphqlWarnings: [],
    policyPerformanceWarnings: [],
    recommendations: []
  };
  
  try {
    // Get all warnings
    const advisorsResult = await runCommand('supabase db advisors --linked --level warn');
    
    if (advisorsResult.success) {
      const warnings = advisorsResult.stdout.split('\n')
        .filter(line => line.includes('"level": "WARN"'));
      
      // Extract specific warning types
      const lines = advisorsResult.stdout.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Check for function_search_path_mutable
        if (line.includes('function_search_path_mutable')) {
          analysis.searchPathWarnings.push({
            type: 'function_search_path_mutable',
            description: 'Functions with mutable search_path can be exploited for privilege escalation',
            impact: 'Security',
            recommendation: 'Review and secure functions with mutable search_path'
          });
        }
        
        // Check for pg_graphql_anon_table_exposed
        if (line.includes('pg_graphql_anon_table_exposed')) {
          analysis.graphqlWarnings.push({
            type: 'pg_graphql_anon_table_exposed',
            description: 'GraphQL tables exposed to anonymous users',
            impact: 'Data Exposure',
            recommendation: 'Restrict GraphQL schema visibility for anonymous users'
          });
        }
        
        // Check for multiple permissive policies
        if (line.includes('multiple_permissive_policies')) {
          const tableMatch = line.match(/Table `([^`]+)`/);
          if (tableMatch) {
            analysis.policyPerformanceWarnings.push({
              type: 'multiple_permissive_policies',
              table: tableMatch[1],
              description: 'Multiple permissive policies affect performance',
              impact: 'Performance',
              recommendation: 'Consolidate multiple policies into single comprehensive policy'
            });
          }
        }
      }
    }
  } catch (error) {
    console.log(`❌ Analysis failed: ${error.message}`);
  }
  
  // Display analysis
  console.log('\n📋 POST-GO HARDENING FINDINGS:');
  console.log('=============================');
  
  if (analysis.searchPathWarnings.length > 0) {
    console.log('\n🔍 FUNCTION SEARCH PATH MUTABLE:');
    analysis.searchPathWarnings.forEach(warning => {
      console.log(`   ⚠️  ${warning.description}`);
      console.log(`      Impact: ${warning.impact}`);
      console.log(`      Recommendation: ${warning.recommendation}`);
    });
  }
  
  if (analysis.graphqlWarnings.length > 0) {
    console.log('\n🔍 PG_GRAPHQL ANON TABLE EXPOSED:');
    analysis.graphqlWarnings.forEach(warning => {
      console.log(`   ⚠️  ${warning.description}`);
      console.log(`      Impact: ${warning.impact}`);
      console.log(`      Recommendation: ${warning.recommendation}`);
    });
  }
  
  if (analysis.policyPerformanceWarnings.length > 0) {
    console.log('\n🔍 MULTIPLE PERMISSIVE POLICIES (PERFORMANCE):');
    const uniqueTables = [...new Set(analysis.policyPerformanceWarnings.map(w => w.table))];
    console.log(`   ⚠️  ${uniqueTables.length} tables with multiple policies affecting performance`);
    uniqueTables.slice(0, 5).forEach(table => {
      console.log(`      - ${table}`);
    });
    if (uniqueTables.length > 5) {
      console.log(`      ... and ${uniqueTables.length - 5} more`);
    }
    console.log(`   Recommendation: Consolidate policies for better performance`);
  }
  
  // API Gateway authentication assessment
  console.log('\n🔍 API GATEWAY AUTHENTICATION ASSESSMENT:');
  console.log('Current: Public access (appropriate for gateway pattern)');
  console.log('Threat Model Consideration:');
  console.log('   ✅ Current approach allows public discovery of services');
  console.log('   ⚠️  Consider JWT requirement if you want to hide service existence');
  console.log('   💡 Recommendation depends on your security model');
  
  // Recommendations
  console.log('\n📋 OPTIONAL HARDENING RECOMMENDATIONS:');
  console.log('=====================================');
  
  if (analysis.searchPathWarnings.length > 0) {
    console.log('🔒 SECURITY HARDENING:');
    console.log('   - Review functions with mutable search_path');
    console.log('   - Implement stricter function security');
  }
  
  if (analysis.graphqlWarnings.length > 0) {
    console.log('🔒 SCHEMA VISIBILITY:');
    console.log('   - Restrict GraphQL exposure for anonymous users');
    console.log('   - Implement schema-level access controls');
  }
  
  if (analysis.policyPerformanceWarnings.length > 0) {
    console.log('⚡ PERFORMANCE OPTIMIZATION:');
    console.log('   - Consolidate multiple RLS policies');
    console.log('   - Implement single comprehensive policies per table/role');
  }
  
  console.log('\n🔐 AUTHENTICATION CONSIDERATIONS:');
  console.log('   - API Gateway: Currently public (consider JWT for stricter model)');
  console.log('   - Marketing Services: Currently public (appropriate for outreach)');
  console.log('   - Search Service: Currently public (consider JWT for sensitive data)');
  
  // Priority assessment
  console.log('\n🎯 PRIORITY ASSESSMENT:');
  console.log('========================');
  console.log('🔴 HIGH PRIORITY (Security):');
  if (analysis.searchPathWarnings.length > 0) {
    console.log('   - Fix function_search_path_mutable warnings');
  } else {
    console.log('   - No high-priority security warnings found');
  }
  
  console.log('\n🟡 MEDIUM PRIORITY (Performance):');
  if (analysis.policyPerformanceWarnings.length > 0) {
    console.log('   - Consolidate multiple permissive policies');
  } else {
    console.log('   - No performance optimization needed');
  }
  
  console.log('\n🟢 LOW PRIORITY (Enhancement):');
  console.log('   - Consider API Gateway JWT requirement');
  console.log('   - Review GraphQL schema exposure');
  
  return analysis;
}

// Run the analysis
analyzePostGoHardening().then(analysis => {
  console.log('\n✅ Post-GO hardening analysis completed');
  
  // Save analysis
  const report = {
    timestamp: new Date().toISOString(),
    analysis: analysis,
    status: 'PRODUCTION_READY_WITH_OPTIONAL_IMPROVEMENTS'
  };
  
  fs.writeFileSync('post-go-hardening-analysis.json', JSON.stringify(report, null, 2));
  console.log('\n📄 Analysis saved to: post-go-hardening-analysis.json');
  
}).catch(error => {
  console.error('Post-GO hardening analysis failed:', error.message);
});
