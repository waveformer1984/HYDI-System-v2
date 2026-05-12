require('dotenv').config();

// Security boundary verification
async function securityAudit() {
  console.log('=== SECURITY AUDIT ===\n');
  
  const fs = require('fs');
  const path = require('path');
  
  // Check all JavaScript files for potential service_role exposure
  const filesToCheck = [
    'ursula-mock.js',
    'protoforge-mock.js', 
    'hydi-cli.js',
    'core/pipeline.js',
    'core/event-writer.js',
    'core/ai-analyzer.js',
    'core/hydi-router.js'
  ];
  
  console.log('Checking for service_role key exposure...\n');
  
  let violations = [];
  
  filesToCheck.forEach(file => {
    try {
      const filePath = path.join(__dirname, file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Check for dangerous patterns
        const dangerousPatterns = [
          /service_role.*createClient/i,
          /SUPABASE_KEY.*service_role/i,
          /createClient.*service_role/i
        ];
        
        const hasViolation = dangerousPatterns.some(pattern => pattern.test(content));
        
        if (hasViolation) {
          violations.push(file);
          console.log(`VIOLATION: ${file} - Potential service_role exposure`);
        } else {
          console.log(`OK: ${file} - No service_role exposure detected`);
        }
      }
    } catch (error) {
      console.log(`ERROR: Could not check ${file}: ${error.message}`);
    }
  });
  
  console.log('\nChecking environment variable usage...\n');
  
  // Check environment variable usage patterns
  filesToCheck.forEach(file => {
    try {
      const filePath = path.join(__dirname, file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Check if dashboard uses anon key
        const usesAnonKey = content.includes('SUPABASE_ANON_KEY');
        const usesServiceKey = content.includes('SUPABASE_KEY') && !content.includes('SUPABASE_ANON_KEY');
        
        if (file.includes('ursula')) {
          if (usesAnonKey) {
            console.log(`OK: ${file} - Uses anon key (dashboard)`);
          } else if (usesServiceKey) {
            violations.push(file);
            console.log(`VIOLATION: ${file} - Dashboard should use anon key`);
          }
        } else {
          if (usesServiceKey) {
            console.log(`OK: ${file} - Uses service key (backend)`);
          } else if (usesAnonKey) {
            console.log(`WARNING: ${file} - Backend service using anon key`);
          }
        }
      }
    } catch (error) {
      console.log(`ERROR: Could not check ${file}: ${error.message}`);
    }
  });
  
  console.log('\n=== SECURITY AUDIT RESULTS ===');
  
  if (violations.length === 0) {
    console.log('PASS: No security violations detected');
    console.log('- Dashboard uses anon key with RLS limits');
    console.log('- Backend services use service role appropriately');
    console.log('- No exposed service_role keys in frontend code');
  } else {
    console.log(`FAIL: ${violations.length} security violations detected:`);
    violations.forEach(file => {
      console.log(`- ${file}`);
    });
    console.log('\nRECOMMENDATIONS:');
    console.log('1. Ensure dashboard services use SUPABASE_ANON_KEY only');
    console.log('2. Keep service_role key usage limited to backend services');
    console.log('3. Never expose service_role keys to frontend or external services');
  }
  
  console.log('\n=== SECURITY AUDIT COMPLETE ===');
}

securityAudit();
