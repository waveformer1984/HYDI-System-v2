// Verify EscalationNotifier web-push channel end-to-end
require('./babel-register');

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { getEscalationNotifier, resetEscalationNotifier } = require('../lib/operational/EscalationNotifier');

async function main() {
  require('dotenv').config({ path: '.env.local' });

  const supabase = createClient(
    process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );

  // Create a real push subscription
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const p256dh = ecdh.getPublicKey().toString('base64url');
  const auth = crypto.randomBytes(16).toString('base64url');
  const endpoint = 'https://fcm.googleapis.com/fcm/send/escalation-test-' + Date.now();
  const deviceId = 'escalation-test-' + Date.now();

  const { error: insertError } = await supabase.from('push_subscriptions').insert({
    device_id: deviceId,
    endpoint, p256dh, auth,
    device_name: 'EscalationNotifier test',
    active: true,
  });

  if (insertError) {
    console.log('push_subscriptions insert failed:', insertError.message);
    process.exit(1);
  }
  console.log('Test subscription created (device:', deviceId + ')');

  // Fire through EscalationNotifier
  resetEscalationNotifier();
  const notifier = getEscalationNotifier(supabase);
  const result = await notifier.notify({
    category: 'stuck_job',
    severity: 'warning',
    title: 'Test escalation through EscalationNotifier',
    body: 'This push was sent through the EscalationNotifier web-push channel.',
    actionRequired: 'No action needed — this is a test',
  });

  console.log('');
  console.log('EscalationNotifier result:');
  console.log('  sent:', result.sent);
  console.log('  channels:', result.channels.join(', '));
  console.log('  error:', result.error || 'none');

  // Clean up
  await supabase.from('push_subscriptions').delete().eq('device_id', deviceId);
  console.log('Test subscription cleaned up');

  if (result.channels.includes('web-push')) {
    console.log('');
    console.log('ESCALATION NOTIFIER WEB-PUSH: OPERATIONAL');
    process.exit(0);
  } else {
    console.log('');
    console.log('ESCALATION NOTIFIER WEB-PUSH: NOT FIRING');
    process.exit(1);
  }
}

main().catch(e => {
  console.log('Fatal error:', e.message);
  process.exit(1);
});
