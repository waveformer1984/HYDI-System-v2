#!/usr/bin/env node
/**
 * Validates webhook_task_hid.json before running the HID agent.
 * Run: node agents/hardware-controller/validate-hid-config.js
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'webhook_task_hid.json');

function validate() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('❌ webhook_task_hid.json not found at', CONFIG_PATH);
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (err) {
    console.error('❌ Failed to parse webhook_task_hid.json:', err.message);
    process.exit(1);
  }

  const REQUIRED_FIELDS = [
    'stripe_email',
    'stripe_password',
    'vercel_email',
    'vercel_password',
    'webhook_endpoint_url',
    'vercel_project',
  ];

  const missing = REQUIRED_FIELDS.filter(
    key => !config[key] || String(config[key]).includes('EDIT_THIS')
  );

  if (missing.length > 0) {
    console.error('❌ Config incomplete. Edit these fields in webhook_task_hid.json:');
    missing.forEach(f => console.error('   - ' + f));
    console.error('\nSee agents/hardware-controller/HID_SETUP.md for instructions.');
    process.exit(1);
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  ['stripe_email', 'vercel_email'].forEach(key => {
    if (!EMAIL_RE.test(config[key])) {
      console.error('❌ Invalid email for ' + key + ': ' + config[key]);
      process.exit(1);
    }
  });

  try {
    new URL(config.webhook_endpoint_url);
  } catch {
    console.error('❌ Invalid webhook_endpoint_url: ' + config.webhook_endpoint_url);
    process.exit(1);
  }

  const killSwitch =
    process.platform === 'win32' ? 'C:\\tmp\\STOP_HID' : '/tmp/STOP_HID';
  if (fs.existsSync(killSwitch)) {
    console.warn('⚠️  Kill switch is ARMED (' + killSwitch + '). Delete this file before running the agent.');
  }

  console.log('✅ HID config valid');
  console.log('   Stripe:  ' + config.stripe_email);
  console.log('   Vercel:  ' + config.vercel_email + ' / ' + config.vercel_project);
  console.log('   Webhook: ' + config.webhook_endpoint_url);
  console.log('   Mode:    ' + config.contract.mode + ' (human confirmation: ' + config.contract.requires_human_confirmation + ')');
}

validate();
