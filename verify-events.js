require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function verifyEvents() {
  const eventIds = [
    'eae26698-94ce-4e5f-83b7-957f7f5d72c3',
    '27ee85f9-f329-4e75-adfc-ba561fccb2f0',
    '25663e31-aba2-4ee0-a511-9f562da8aa12', 
    '64e77f15-e9dc-47ca-8b54-07b95afaf1d4'
  ];

  const { data, error } = await supabase
    .from('hydi_events')
    .select('*')
    .in('event_id', eventIds)
    .order('created_at', { ascending: false });

  console.log('Found events:', data?.length || 0);
  data?.forEach(e => {
    console.log(`- ${e.type}: ${e.event_id} | Source: ${e.source}`);
  });
  console.log('ERROR:', error);
}

verifyEvents();
