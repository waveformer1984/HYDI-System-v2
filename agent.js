const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function runAgent() {
    console.log("?? HYDI Agent: Authenticating...");
    const { data, error } = await supabase.from('_test_connection').select('*').limit(1);
    
    if (error && error.code === 'PGRST301') {
        console.log("? IDENTITY RESTORED: Connected to Supabase successfully.");
    } else if (error) {
        console.error("? STILL IN CRISIS:", error.message);
    } else {
        console.log("? SYSTEM ONLINE: Real-time connection established.");
    }
}
runAgent();
