// Check edge function logs for runtime errors
const https = require('https');

function getEdgeFunctionLogs() {
  return new Promise((resolve) => {
    // Get logs from Supabase
    const options = {
      hostname: 'api.supabase.com',
      port: 443,
      path: `/v1/projects/akbnfovjdcobifeupvbn/logs`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response);
        } catch (error) {
          resolve({ error: error.message, rawResponse: data });
        }
      });
    });
    
    req.on('error', (err) => {
      resolve({ error: err.message });
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ error: 'Request timeout' });
    });
    
    req.end();
  });
}

function analyzeLogs(logs) {
  console.log('🔍 ANALYZING EDGE FUNCTION LOGS');
  console.log('==============================');
  
  if (!logs || !logs.data || !Array.isArray(logs.data)) {
    console.log('❌ No logs data available or invalid format');
    return;
  }
  
  const recentLogs = logs.data.filter(log => {
    const logTime = new Date(log.timestamp);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return logTime > twentyFourHoursAgo;
  });
  
  console.log(`\n📊 LOGS ANALYSIS (Last 24 Hours):`);
  console.log(`Total logs: ${recentLogs.length}`);
  
  // Count by status codes
  const statusCounts = {};
  const errorCounts = {};
  const functionCounts = {};
  
  recentLogs.forEach(log => {
    const status = log.http_status_code || 'unknown';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    
    const func = log.function_name || 'unknown';
    functionCounts[func] = (functionCounts[func] || 0) + 1;
    
    if (status >= 400) {
      errorCounts[func] = (errorCounts[func] || 0) + 1;
    }
  });
  
  console.log('\n📈 STATUS CODE DISTRIBUTION:');
  Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
    const icon = status >= 400 ? '❌' : status >= 300 ? '⚠️' : '✅';
    console.log(`   ${icon} HTTP ${status}: ${count} requests`);
  });
  
  console.log('\n🔍 FUNCTION ACTIVITY:');
  Object.entries(functionCounts).sort((a, b) => b[1] - a[1]).forEach(([func, count]) => {
    const errors = errorCounts[func] || 0;
    const icon = errors > 0 ? '❌' : '✅';
    console.log(`   ${icon} ${func}: ${count} requests (${errors} errors)`);
  });
  
  // Show error details
  const errorLogs = recentLogs.filter(log => log.http_status_code >= 400);
  
  if (errorLogs.length > 0) {
    console.log('\n🚨 ERROR LOGS (Last 24 Hours):');
    errorLogs.slice(0, 10).forEach(log => {
      console.log(`   ❌ ${log.function_name}: HTTP ${log.http_status_code} - ${log.message || 'No message'}`);
      console.log(`      Time: ${log.timestamp}`);
      console.log(`      Method: ${log.method || 'Unknown'}`);
    });
    
    if (errorLogs.length > 10) {
      console.log(`   ... and ${errorLogs.length - 10} more errors`);
    }
  } else {
    console.log('\n✅ NO ERRORS FOUND IN LAST 24 HOURS');
  }
  
  // Check for specific functions with issues
  const problematicFunctions = Object.entries(errorCounts).filter(([func, count]) => count > 0);
  
  if (problematicFunctions.length > 0) {
    console.log('\n⚠️  FUNCTIONS WITH ERRORS:');
    problematicFunctions.forEach(([func, count]) => {
      console.log(`   - ${func}: ${count} errors`);
    });
  } else {
    console.log('\n✅ ALL FUNCTIONS OPERATING NORMALLY');
  }
  
  return {
    totalLogs: recentLogs.length,
    errorLogs: errorLogs.length,
    problematicFunctions: problematicFunctions.length,
    statusCounts,
    functionCounts
  };
}

// Alternative: Use Supabase CLI to get logs
function getEdgeFunctionLogsCLI() {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    
    exec('supabase functions logs --project-ref akbnfovjdcobifeupvbn --limit 100', (error, stdout, stderr) => {
      if (error) {
        resolve({ error: error.message, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function checkEdgeFunctionLogs() {
  console.log('🔍 CHECKING EDGE FUNCTION LOGS FOR RUNTIME ERRORS');
  console.log('================================================');
  
  try {
    // Try CLI method first
    const cliResult = await getEdgeFunctionLogsCLI();
    
    if (cliResult.error) {
      console.log('⚠️  CLI method failed, trying alternative...');
      
      // Try API method
      const apiResult = await getEdgeFunctionLogs();
      
      if (apiResult.error) {
        console.log('❌ Both CLI and API methods failed');
        console.log(`CLI Error: ${cliResult.error}`);
        console.log(`API Error: ${apiResult.error}`);
        return;
      }
      
      return analyzeLogs(apiResult);
    } else {
      console.log('✅ CLI method successful');
      console.log('\n📋 RECENT LOGS (Last 100 entries):');
      console.log(cliResult.stdout);
      
      // Parse CLI output for errors
      const lines = cliResult.stdout.split('\n');
      const errorLines = lines.filter(line => 
        line.includes('ERROR') || 
        line.includes('HTTP 4') || 
        line.includes('HTTP 5')
      );
      
      if (errorLines.length > 0) {
        console.log('\n🚨 POTENTIAL ERRORS FOUND:');
        errorLines.slice(0, 5).forEach(line => {
          console.log(`   ${line}`);
        });
      } else {
        console.log('\n✅ NO OBVIOUS ERRORS IN RECENT LOGS');
      }
      
      return {
        totalLogs: lines.length,
        errorLines: errorLines.length,
        cliOutput: cliResult.stdout
      };
    }
  } catch (error) {
    console.log(`❌ Log analysis failed: ${error.message}`);
  }
}

// Run the check
checkEdgeFunctionLogs().then(results => {
  console.log('\n✅ Edge function log check completed');
  
  // Recommendations
  console.log('\n📋 RECOMMENDATIONS:');
  
  if (results && results.problematicFunctions > 0) {
    console.log('⚠️  ACTIONS NEEDED:');
    console.log('   1. Investigate functions with errors');
    console.log('   2. Fix runtime issues in problematic functions');
    console.log('   3. Monitor error rates after fixes');
  } else {
    console.log('✅ SYSTEM HEALTHY:');
    console.log('   1. Continue monitoring logs');
    console.log('   2. Set up automated error alerts');
    console.log('   3. Monitor performance metrics');
  }
  
  // Function naming recommendation
  console.log('\n🔄 FUNCTION NAMING RECOMMENDATION:');
  console.log('Consider consolidating payment-processing and payment-processor:');
  console.log('   - Keep payment-processing for general payment operations');
  console.log('   - Use payment-processor for specific revenue processing');
  console.log('   - Or deprecate one to avoid confusion');
  
}).catch(error => {
  console.error('Edge function log check failed:', error.message);
});
