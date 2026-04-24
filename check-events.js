const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkEvents() {
    const { data } = await supabase
        .from('event_bus_events')
        .select('*')
        .order('id', { ascending: false })
        .limit(5);
    
    console.log('📡 Recent Events:');
    data.forEach(e => {
        console.log(`   ${e.topic}: ${e.event_name}`);
    });
}

checkEvents();
