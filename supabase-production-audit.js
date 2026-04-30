// Complete Supabase production audit
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

async function runCompleteAudit() {
  console.log('🔍 COMPLETE SUPABASE PRODUCTION AUDIT');
  console.log('===================================');
  
  const auditResults = {
    functions: {},
    policies: {},
    advisors: {},
    logs: {},
    overall: { go: false, blockers: [], warnings: [] }
  };
  
  // 1. Functions Audit
  console.log('\n📦 1. FUNCTIONS AUDIT');
  console.log('==================');
  
  try {
    const functionsResult = await runCommand('supabase functions list --project-ref akbnfovjdcobifeupvbn');
    
    if (functionsResult.success) {
      const functions = functionsResult.stdout.split('\n')
        .filter(line => line.trim() && !line.includes('Functions on project'))
        .map(line => {
          const parts = line.trim().split(/\s+/);
          return {
            name: parts[0] || 'Unknown',
            status: parts[1] || 'Unknown'
          };
        });
      
      auditResults.functions = {
        total: functions.length,
        deployed: functions.filter(f => f.status === 'deployed').length,
        list: functions
      };
      
      console.log(`✅ Functions: ${auditResults.functions.deployed}/${auditResults.functions.total} deployed`);
      functions.forEach(func => {
        console.log(`   ${func.name}: ${func.status}`);
      });
    } else {
      console.log(`❌ Functions audit failed: ${functionsResult.error}`);
      auditResults.overall.blockers.push('Functions audit failed');
    }
  } catch (error) {
    console.log(`❌ Functions audit error: ${error.message}`);
    auditResults.overall.blockers.push('Functions audit error');
  }
  
  // 2. RLS Policies Audit
  console.log('\n🛡️ 2. RLS POLICIES AUDIT');
  console.log('=====================');
  
  try {
    const policiesResult = await runCommand('supabase db advisors --linked --format json');
    
    if (policiesResult.success) {
      try {
        const advisors = JSON.parse(policiesResult.stdout);
        const rlsIssues = advisors.filter(adv => 
          adv.categories.includes('SECURITY') || 
          adv.name.includes('rls') ||
          adv.name.includes('policy')
        );
        
        const highPriorityIssues = advisors.filter(adv => adv.level === 'HIGH' || adv.level === 'ERROR');
        const mediumIssues = advisors.filter(adv => adv.level === 'WARN');
        
        auditResults.policies = {
          total: advisors.length,
          rlsIssues: rlsIssues.length,
          highPriority: highPriorityIssues.length,
          mediumPriority: mediumIssues.length,
          details: rlsIssues.slice(0, 5) // Show first 5 RLS issues
        };
        
        console.log(`📊 Total Advisor Issues: ${advisors.length}`);
        console.log(`🚨 High Priority: ${highPriorityIssues.length}`);
        console.log(`⚠️  Medium Priority: ${mediumIssues.length}`);
        console.log(`🔒 RLS Issues: ${rlsIssues.length}`);
        
        if (rlsIssues.length > 0) {
          console.log('\n🔒 Top RLS Issues:');
          auditResults.policies.details.forEach(issue => {
            console.log(`   ${issue.name}: ${issue.description.substring(0, 100)}...`);
          });
        }
        
        // Blockers for production
        if (highPriorityIssues.length > 0) {
          auditResults.overall.blockers.push(`${highPriorityIssues.length} high priority security issues`);
        }
        if (rlsIssues.length > 10) {
          auditResults.overall.blockers.push('Too many RLS policy issues (>10)');
        }
        
      } catch (parseError) {
        console.log('⚠️  Could not parse advisors JSON');
        auditResults.overall.warnings.push('Advisors JSON parsing failed');
      }
    } else {
      console.log(`❌ Policies audit failed: ${policiesResult.error}`);
      auditResults.overall.blockers.push('Policies audit failed');
    }
  } catch (error) {
    console.log(`❌ Policies audit error: ${error.message}`);
    auditResults.overall.blockers.push('Policies audit error');
  }
  
  // 3. Database Schema Audit
  console.log('\n🗄️ 3. DATABASE SCHEMA AUDIT');
  console.log('========================');
  
  try {
    const schemaResult = await runCommand('supabase db shell --command "SELECT table_name, row_security FROM information_schema.tables WHERE table_schema = \'public\' AND table_type = \'BASE TABLE\' ORDER BY table_name;"');
    
    if (schemaResult.success) {
      const tables = schemaResult.stdout.split('\n')
        .filter(line => line.trim() && !line.includes('table_name') && !line.includes('---'))
        .map(line => {
          const parts = line.trim().split(/\s*\|\s*/);
          return {
            name: parts[0]?.trim() || 'Unknown',
            rls: parts[1]?.trim() || 'Unknown'
          };
        });
      
      const rlsEnabled = tables.filter(t => t.rls === 'YES').length;
      const rlsDisabled = tables.filter(t => t.rls === 'NO').length;
      
      auditResults.schema = {
        total: tables.length,
        rlsEnabled,
        rlsDisabled,
        tables
      };
      
      console.log(`📊 Total Tables: ${tables.length}`);
      console.log(`✅ RLS Enabled: ${rlsEnabled}`);
      console.log(`❌ RLS Disabled: ${rlsDisabled}`);
      
      const criticalTables = ['users', 'payments', 'ledger', 'payouts', 'clients'];
      const criticalRlsDisabled = tables.filter(t => 
        criticalTables.includes(t.name.toLowerCase()) && t.rls === 'NO'
      );
      
      if (criticalRlsDisabled.length > 0) {
        console.log('\n🚨 CRITICAL TABLES WITHOUT RLS:');
        criticalRlsDisabled.forEach(table => {
          console.log(`   ❌ ${table.name}`);
        });
        auditResults.overall.blockers.push(`${criticalRlsDisabled.length} critical tables without RLS`);
      }
      
    } else {
      console.log(`❌ Schema audit failed: ${schemaResult.error}`);
      auditResults.overall.blockers.push('Schema audit failed');
    }
  } catch (error) {
    console.log(`❌ Schema audit error: ${error.message}`);
    auditResults.overall.blockers.push('Schema audit error');
  }
  
  // 4. Recent Logs Audit
  console.log('\n📋 4. RECENT LOGS AUDIT');
  console.log('====================');
  
  try {
    const logsResult = await runCommand('supabase logs list --project-ref akbnfovjdcobifeupvbn --limit 10');
    
    if (logsResult.success) {
      const logs = logsResult.stdout.split('\n')
        .filter(line => line.trim() && !line.includes('LOGS'))
        .slice(0, 5);
      
      auditResults.logs = {
        recent: logs.length,
        entries: logs
      };
      
      console.log(`📊 Recent Logs: ${logs.length} entries`);
      if (logs.length > 0) {
        console.log('Recent entries:');
        logs.forEach(log => {
          console.log(`   ${log.substring(0, 100)}...`);
        });
      }
      
      // Check for errors in logs
      const errorLogs = logs.filter(log => 
        log.toLowerCase().includes('error') || 
        log.toLowerCase().includes('failed') ||
        log.toLowerCase().includes('exception')
      );
      
      if (errorLogs.length > 2) {
        auditResults.overall.warnings.push(`${errorLogs.length} error entries in recent logs`);
      }
      
    } else {
      console.log(`❌ Logs audit failed: ${logsResult.error}`);
      auditResults.overall.warnings.push('Logs audit failed');
    }
  } catch (error) {
    console.log(`❌ Logs audit error: ${error.message}`);
    auditResults.overall.warnings.push('Logs audit error');
  }
  
  // 5. Final Assessment
  console.log('\n🎯 5. FINAL PRODUCTION READINESS ASSESSMENT');
  console.log('========================================');
  
  const totalBlockers = auditResults.overall.blockers.length;
  const totalWarnings = auditResults.overall.warnings.length;
  
  console.log(`\n📊 AUDIT SUMMARY:`);
  console.log(`   Blockers: ${totalBlockers}`);
  console.log(`   Warnings: ${totalWarnings}`);
  console.log(`   Functions: ${auditResults.functions?.deployed || 0}/${auditResults.functions?.total || 0}`);
  console.log(`   RLS Issues: ${auditResults.policies?.highPriority || 0} high priority`);
  console.log(`   Tables without RLS: ${auditResults.schema?.rlsDisabled || 0}`);
  
  if (totalBlockers === 0) {
    auditResults.overall.go = true;
    console.log('\n✅ PRODUCTION READY');
    console.log('   No critical blockers detected');
    console.log('   System is ready for Detailer Bot delivery');
  } else {
    auditResults.overall.go = false;
    console.log('\n❌ NOT PRODUCTION READY');
    console.log('   Critical blockers must be resolved:');
    auditResults.overall.blockers.forEach(blocker => {
      console.log(`   - ${blocker}`);
    });
  }
  
  if (totalWarnings > 0) {
    console.log('\n⚠️  WARNINGS (should be addressed):');
    auditResults.overall.warnings.forEach(warning => {
      console.log(`   - ${warning}`);
    });
  }
  
  // 6. Recommendations
  console.log('\n📋 RECOMMENDATIONS:');
  
  if (totalBlockers === 0) {
    console.log('✅ READY FOR:');
    console.log('   - Detailer Bot delivery');
    console.log('   - Customer-facing expansion');
    console.log('   - Production deployment');
  } else {
    console.log('🔧 IMMEDIATE ACTIONS REQUIRED:');
    console.log('   - Fix all critical blockers');
    console.log('   - Re-run audit after fixes');
    console.log('   - Address warnings before production');
  }
  
  return auditResults;
}

// Run the complete audit
runCompleteAudit().then(results => {
  console.log('\n✅ Complete Supabase audit finished');
  
  // Write audit report
  const report = {
    timestamp: new Date().toISOString(),
    results: results,
    recommendation: results.overall.go ? 'GO' : 'NO-GO'
  };
  
  fs.writeFileSync('supabase-production-audit-report.json', JSON.stringify(report, null, 2));
  console.log('\n📄 Audit report saved to: supabase-production-audit-report.json');
  
  process.exit(results.overall.go ? 0 : 1);
}).catch(error => {
  console.error('Complete audit failed:', error.message);
  process.exit(1);
});
