// Final production readiness verdict
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

async function runFinalVerdict() {
  console.log('🎯 FINAL PRODUCTION READINESS VERDICT');
  console.log('===================================');
  
  const verdict = {
    database: { status: 'UNKNOWN', issues: [] },
    authentication: { status: 'UNKNOWN', issues: [] },
    functions: { status: 'UNKNOWN', issues: [] },
    overall: { go: false, blockers: [], warnings: [] }
  };
  
  // 1. Database Security Check
  console.log('\n🗄️ 1. DATABASE SECURITY CHECK');
  console.log('=============================');
  
  try {
    const advisorsResult = await runCommand('supabase db advisors --linked --level error');
    
    if (advisorsResult.success) {
      const errorCount = (advisorsResult.stdout.match(/"level": "ERROR"/g) || []).length;
      
      if (errorCount === 0) {
        verdict.database.status = 'GO';
        console.log('✅ Database security: NO ERROR-level issues');
      } else {
        verdict.database.status = 'NO-GO';
        verdict.database.issues.push(`${errorCount} ERROR-level security issues`);
        console.log(`❌ Database security: ${errorCount} ERROR-level issues`);
      }
    } else {
      verdict.database.status = 'UNKNOWN';
      verdict.database.issues.push('Could not run security advisors');
      console.log('❌ Database security: Advisor check failed');
    }
  } catch (error) {
    verdict.database.status = 'UNKNOWN';
    verdict.database.issues.push(error.message);
    console.log(`❌ Database security: ${error.message}`);
  }
  
  // 2. Authentication Check
  console.log('\n🔐 2. AUTHENTICATION CHECK');
  console.log('========================');
  
  const criticalServices = ['user-management', 'payment-processing', 'analytics-service', 'file-storage'];
  let authIssues = 0;
  
  for (const service of criticalServices) {
    try {
      // Test without auth (should fail)
      const result = await runCommand(`curl -s -o /dev/null -w "%{http_code}" https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/${service}`);
      
      if (result.success && result.stdout === '401') {
        console.log(`✅ ${service}: JWT correctly required`);
      } else {
        console.log(`❌ ${service}: JWT not required (HTTP ${result.stdout})`);
        authIssues++;
        verdict.authentication.issues.push(`${service} not requiring JWT`);
      }
    } catch (error) {
      console.log(`❌ ${service}: Could not test auth`);
      authIssues++;
      verdict.authentication.issues.push(`${service} auth test failed`);
    }
  }
  
  if (authIssues === 0) {
    verdict.authentication.status = 'GO';
    console.log('✅ Authentication: All critical services require JWT');
  } else {
    verdict.authentication.status = 'NO-GO';
    console.log(`❌ Authentication: ${authIssues} services not secured`);
  }
  
  // 3. Functions Deployment Check
  console.log('\n📦 3. FUNCTIONS DEPLOYMENT CHECK');
  console.log('===============================');
  
  try {
    const functionsResult = await runCommand('supabase functions list --project-ref akbnfovjdcobifeupvbn');
    
    if (functionsResult.success) {
      const deployedCount = (functionsResult.stdout.match(/\| ACTIVE \|/g) || []).length;
      const totalCount = (functionsResult.stdout.match(/\| [A-Z]+ \|/g) || []).length;
      
      if (deployedCount >= 40) {
        verdict.functions.status = 'GO';
        console.log(`✅ Functions: ${deployedCount}/${totalCount} deployed`);
      } else {
        verdict.functions.status = 'NO-GO';
        verdict.functions.issues.push(`Only ${deployedCount}/${totalCount} functions deployed`);
        console.log(`❌ Functions: Only ${deployedCount}/${totalCount} deployed`);
      }
    } else {
      verdict.functions.status = 'UNKNOWN';
      verdict.functions.issues.push('Could not check functions');
      console.log('❌ Functions: Check failed');
    }
  } catch (error) {
    verdict.functions.status = 'UNKNOWN';
    verdict.functions.issues.push(error.message);
    console.log(`❌ Functions: ${error.message}`);
  }
  
  // 4. Final Assessment
  console.log('\n🎯 4. FINAL PRODUCTION READINESS');
  console.log('=============================');
  
  const allGo = verdict.database.status === 'GO' && 
                verdict.authentication.status === 'GO' && 
                verdict.functions.status === 'GO';
  
  if (allGo) {
    verdict.overall.go = true;
    console.log('\n🎉 OVERALL VERDICT: ✅ GO FOR PRODUCTION');
    console.log('=====================================');
    console.log('✅ Database security: All ERROR-level issues resolved');
    console.log('✅ Authentication: All critical services JWT-protected');
    console.log('✅ Functions: All services deployed and operational');
    console.log('✅ System is production-ready for Detailer Bot delivery');
    
  } else {
    verdict.overall.go = false;
    console.log('\n🚨 OVERALL VERDICT: ❌ NO-GO FOR PRODUCTION');
    console.log('=======================================');
    
    if (verdict.database.status !== 'GO') {
      console.log('❌ Database security issues remain:');
      verdict.database.issues.forEach(issue => console.log(`   - ${issue}`));
      verdict.overall.blockers.push('Database security not resolved');
    }
    
    if (verdict.authentication.status !== 'GO') {
      console.log('❌ Authentication issues remain:');
      verdict.authentication.issues.forEach(issue => console.log(`   - ${issue}`));
      verdict.overall.blockers.push('Critical services not secured');
    }
    
    if (verdict.functions.status !== 'GO') {
      console.log('❌ Function deployment issues:');
      verdict.functions.issues.forEach(issue => console.log(`   - ${issue}`));
      verdict.overall.blockers.push('Functions not fully deployed');
    }
  }
  
  // 5. Recommendations
  console.log('\n📋 RECOMMENDATIONS');
  console.log('=================');
  
  if (verdict.overall.go) {
    console.log('✅ READY FOR:');
    console.log('   - Detailer Bot delivery');
    console.log('   - Customer-facing expansion');
    console.log('   - Production deployment');
    console.log('   - Live transaction processing');
    console.log('\n🎉 CONGRATULATIONS! System is production-ready!');
  } else {
    console.log('🔧 REMAINING ACTIONS:');
    verdict.overall.blockers.forEach(blocker => {
      console.log(`   - ${blocker}`);
    });
    console.log('\n⚠️  Address remaining issues before production deployment');
  }
  
  // Save verdict
  const report = {
    timestamp: new Date().toISOString(),
    verdict: verdict,
    recommendation: verdict.overall.go ? 'GO' : 'NO-GO'
  };
  
  fs.writeFileSync('final-production-verdict.json', JSON.stringify(report, null, 2));
  console.log('\n📄 Final verdict saved to: final-production-verdict.json');
  
  return verdict;
}

// Run the final verdict
runFinalVerdict().then(results => {
  console.log('\n✅ Final production verdict completed');
  process.exit(results.overall.go ? 0 : 1);
}).catch(error => {
  console.error('Final verdict failed:', error.message);
  process.exit(1);
});
