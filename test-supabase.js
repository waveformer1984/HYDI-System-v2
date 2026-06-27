// Load ONLY .env.local, not .env
const dotenv = require('dotenv');
const fs = require('fs');
const envPath = '.env.local';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const parsed = dotenv.parse(envContent);
  Object.assign(process.env, parsed);
  console.log('[DOTENV] Loaded from .env.local');
}

const { createClient } = require('@supabase/supabase-js');

console.log('SUPABASE_URL:', process.env.SUPABASE_URL);
console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 20) + '...');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  try {
    console.log('\n[TEST] Attempting to fetch from heidi_decision_bounds...');
    const { data, error } = await supabase
      .from('heidi_decision_bounds')
      .select('*')
      .limit(1);

    if (error) {
      console.error('[TEST] Error:', error);
    } else {
      console.log('[TEST] ✅ Success! Data:', JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error('[TEST] Exception:', err.message);
    console.error('[TEST] Stack:', err.stack);
  }

  process.exit(0);
})();
