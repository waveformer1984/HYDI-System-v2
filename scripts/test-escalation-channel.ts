// Test the escalation notification channel
// Run: npx ts-node scripts/test-escalation-channel.ts

import { getEscalationNotifier } from '../lib/operational/EscalationNotifier';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  );

  const notifier = getEscalationNotifier(supabase);

  console.log('Firing test escalation notification...');
  const result = await notifier.sendTest();

  console.log('Test notification result:');
  console.log('  sent:', result.sent);
  console.log('  channels:', result.channels.join(', '));
  console.log('  error:', result.error || 'none');

  // Verify it was written to Supabase
  const { data, error } = await supabase
    .from('operator_escalations')
    .select('id, category, severity, title, body, created_at')
    .eq('category', 'test')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.log('Supabase verification failed:', error.message);
  } else if (data && data.length > 0) {
    console.log('Supabase verification: PASS');
    console.log('  Row ID:', data[0].id);
    console.log('  Title:', data[0].title);
    console.log('  Severity:', data[0].severity);
    console.log('  Created at:', data[0].created_at);
  } else {
    console.log('Supabase verification: No rows found');
  }

  if (result.sent && (!error) && data && data.length > 0) {
    console.log('\nESCALATION CHANNEL: OPERATIONAL');
    process.exit(0);
  } else {
    console.log('\nESCALATION CHANNEL: PARTIAL (check errors above)');
    process.exit(1);
  }
}

main().catch(e => {
  console.log('Fatal error:', e.message);
  process.exit(1);
});
