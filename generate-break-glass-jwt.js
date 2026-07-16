// Generate JWT for break-glass testing
const { SignJWT } = require('jose');

async function generateBreakGlassJWT() {
  console.log('🔑 GENERATING BREAK-GLASS JWT');
  console.log('============================');
  
  try {
    if (!process.env.KEEPER_BREAK_GLASS_TOKEN) {
      throw new Error(
        'KEEPER_BREAK_GLASS_TOKEN is not set. The Edge Function this token is ' +
        'for (supabase/functions/keeper-break-glass) fails closed (503) with no ' +
        'configured secret, so a JWT signed with a fallback value here would ' +
        'never actually authenticate against it -- set the real secret instead.'
      );
    }
    const secret = new TextEncoder().encode(process.env.KEEPER_BREAK_GLASS_TOKEN);

    const payload = {
      sub: 'break-glass-operator',
      role: 'break-glass-operator',
      permissions: ['circuit:override'],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour expiry
    };
    
    const jwt = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .sign(secret);
    
    console.log('✅ JWT generated successfully');
    console.log('Token:', jwt);
    console.log('');
    console.log('📋 Use this token in your Authorization header:');
    console.log(`Authorization: Bearer ${jwt}`);
    
    // Save to environment file for testing
    const fs = require('fs');
    const envPath = '.env.test-jwt';
    fs.writeFileSync(envPath, `KEEPER_BREAK_GLASS_JWT=${jwt}\n`);
    console.log(`\n💾 Token saved to ${envPath}`);
    
    return jwt;
    
  } catch (error) {
    console.error('❌ JWT generation failed:', error.message);
    return null;
  }
}

// Test the JWT with the Edge Function
async function testJWT() {
  const jwt = await generateBreakGlassJWT();
  
  if (!jwt) {
    console.log('❌ Cannot test without JWT');
    return;
  }
  
  console.log('\n🧪 TESTING JWT WITH EDGE FUNCTION');
  console.log('=================================');
  
  const edgeFunctionUrl = 'https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/keeper-break-glass';
  
  try {
    const response = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        level: 3,
        ttl_minutes: 15,
        reason: 'JWT-based break-glass override test',
        requested_by: 'jwt_validation_drill'
      })
    });
    
    const result = await response.json();
    
    if (response.status === 200 && result.success) {
      console.log('✅ JWT authentication successful');
      console.log(`   Override applied: Level ${result.circuit_state.level}`);
      console.log(`   Expires: ${result.circuit_state.expires_at}`);
      console.log(`   Audit ID: ${result.audit_id}`);
    } else {
      console.log('❌ JWT authentication failed');
      console.log('   Status:', response.status);
      console.log('   Error:', result.message);
      if (result.error) {
        console.log('   Details:', result.error);
      }
    }
    
  } catch (error) {
    console.error('❌ JWT test failed:', error.message);
  }
}

testJWT();
