const dotenv = require('dotenv');
const fs = require('fs');
const envPath = '.env.local';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const parsed = dotenv.parse(envContent);
  Object.assign(process.env, parsed);
}

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const { data, error } = await supabase
    .from('heidi_decision_bounds')
    .update({
      lease_holder: null,
      lease_expires: null
    })
    .eq('lease_holder', 'frank')
    .select();

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('✅ Lease cleared:', JSON.stringify(data, null, 2));
  }
  process.exit(0);
})();
