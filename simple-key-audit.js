// Simple key audit - just read and show what's there
const fs = require('fs');
const { exec } = require('child_process');

function runSimpleAudit() {
  console.log('🔍 SIMPLE KEY AUDIT');
  console.log('==================');
  
  // Read .env file directly
  console.log('\n📋 LOCAL .env CONTENTS:');
  console.log('======================');
  
  try {
    const envContent = fs.readFileSync('.env', 'utf8');
    const lines = envContent.split('\n');
    
    const keys = {};
    lines.forEach(line => {
      if (line.startsWith('#') || line.trim() === '') return;
      
      const equalIndex = line.indexOf('=');
      if (equalIndex > 0) {
        const key = line.substring(0, equalIndex).trim();
        let value = line.substring(equalIndex + 1).trim();
        
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        
        keys[key] = value;
        
        // Show status
        if (value === '[REDACTED]') {
          console.log(`❌ ${key}: REDACTED`);
        } else if (value === '') {
          console.log(`❌ ${key}: EMPTY`);
        } else {
          const preview = value.length > 20 ? value.substring(0, 20) + '...' : value;
          console.log(`✅ ${key}: ${preview}`);
        }
      }
    });
    
    console.log('\n🌐 VERCEL ENVIRONMENT CHECK:');
    console.log('==========================');
    
    // Check Vercel environment
    exec('vercel env ls production', (error, stdout, stderr) => {
      if (error) {
        console.log(`❌ Vercel CLI Error: ${error.message}`);
        return;
      }
      
      if (stderr) {
        console.log(`❌ Vercel Error: ${stderr}`);
        return;
      }
      
      console.log('✅ Vercel CLI: Connected');
      
      const lines = stdout.split('\n');
      const vercelKeys = lines
        .filter(line => line.trim() && !line.startsWith('>') && !line.includes('Environment Variables found'))
        .map(line => {
          const match = line.match(/^\s*(\w+)\s+/);
          return match ? match[1] : null;
        })
        .filter(Boolean);
      
      console.log(`✅ Vercel Environment Variables: ${vercelKeys.length}`);
      
      const criticalKeys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'STRIPE_SECRET_KEY', 'KEEPER_BREAK_GLASS_TOKEN'];
      
      console.log('\n🔑 CRITICAL KEYS STATUS:');
      console.log('======================');
      
      criticalKeys.forEach(key => {
        const localStatus = keys[key] ? (keys[key] === '[REDACTED]' ? 'REDACTED' : 'PRESENT') : 'MISSING';
        const vercelStatus = vercelKeys.includes(key) ? 'PRESENT' : 'MISSING';
        
        console.log(`${key}:`);
        console.log(`  Local: ${localStatus}`);
        console.log(`  Vercel: ${vercelStatus}`);
        
        if (localStatus === 'PRESENT' && vercelStatus === 'PRESENT') {
          console.log(`  ✅ SYNCHRONIZED`);
        } else if (localStatus === 'REDACTED' && vercelStatus === 'PRESENT') {
          console.log(`  ⚠️  LOCAL REDACTED (OK)`);
        } else if (localStatus === 'MISSING' && vercelStatus === 'PRESENT') {
          console.log(`  ⚠️  MISSING LOCALLY`);
        } else if (localStatus === 'PRESENT' && vercelStatus === 'MISSING') {
          console.log(`  ❌ MISSING IN VERCEL`);
        } else {
          console.log(`  ❌ MISSING BOTH`);
        }
        console.log('');
      });
      
      // Summary
      const localCriticalPresent = criticalKeys.filter(key => keys[key] && keys[key] !== '[REDACTED]').length;
      const vercelCriticalPresent = criticalKeys.filter(key => vercelKeys.includes(key)).length;
      
      console.log('📊 SUMMARY:');
      console.log('============');
      console.log(`Local Critical Keys Present: ${localCriticalPresent}/${criticalKeys.length}`);
      console.log(`Vercel Critical Keys Present: ${vercelCriticalPresent}/${criticalKeys.length}`);
      
      if (vercelCriticalPresent === criticalKeys.length) {
        console.log('\n🎯 RESULT: ✅ PRODUCTION KEYS CONFIGURED IN VERCEL');
        console.log('Local .env may have redacted values but production is ready.');
      } else {
        console.log('\n🚨 RESULT: ❌ CRITICAL KEYS MISSING FROM VERCEL');
      }
    });
    
  } catch (error) {
    console.log(`❌ Error reading .env: ${error.message}`);
  }
}

runSimpleAudit();
