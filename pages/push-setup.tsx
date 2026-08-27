import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
);

export default function PushSubscriptionPage() {
  const [status, setStatus] = useState<string>('Idle');
  const [subscribed, setSubscribed] = useState(false);
  const [endpoint, setEndpoint] = useState<string>('');
  const [vapidKey, setVapidKey] = useState<string>('');

  useEffect(() => {
    // Check if already subscribed
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration('/sw.js').then(reg => {
        if (reg) {
          reg.pushManager.getSubscription().then(sub => {
            if (sub) {
              setSubscribed(true);
              setEndpoint(sub.endpoint);
              setStatus('Already subscribed');
            }
          });
        }
      });
    }

    // Fetch the VAPID public key from the API
    fetch('/api/operations/vapid-public-key')
      .then(r => r.json())
      .then(data => {
        if (data.publicKey) setVapidKey(data.publicKey);
      })
      .catch(() => { });
  }, []);

  async function subscribe() {
    setStatus('Registering service worker...');
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      setStatus('Subscribing to push...');
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });

      setStatus('Saving subscription to server...');
      const deviceId = 'browser-' + Date.now();
      const { error } = await supabase.from('push_subscriptions').insert({
        device_id: deviceId,
        endpoint: sub.endpoint,
        p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')!))),
        auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')!))),
        device_name: navigator.userAgent.substring(0, 100),
        active: true,
      });

      if (error) {
        setStatus('Save failed: ' + error.message);
        return;
      }

      setSubscribed(true);
      setEndpoint(sub.endpoint);
      setStatus('Subscribed successfully! Device ID: ' + deviceId);
    } catch (err) {
      setStatus('Subscription failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  }

  async function sendTestPush() {
    setStatus('Sending test push notification...');
    try {
      const response = await fetch('/api/operations/test-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (data.success) {
        setStatus('Test push sent! Channels: ' + (data.channels || []).join(', '));
      } else {
        setStatus('Test push failed: ' + (data.error || 'Unknown'));
      }
    } catch (err) {
      setStatus('Test push failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: '50px auto', fontFamily: 'monospace' }}>
      <h1>HYDI Push Notification Setup</h1>
      <p>This page registers your browser for VAPID web-push notifications.</p>
      <p>Once subscribed, escalation notifications from the StuckJobDetector and other autonomous operations will be pushed to this browser in real time.</p>

      <div style={{ marginTop: 20, padding: 15, background: '#f5f5f5', borderRadius: 8 }}>
        <strong>Status:</strong> {status}
      </div>

      {vapidKey && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#666' }}>
          VAPID public key: {vapidKey.substring(0, 30)}...
        </div>
      )}

      <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
        {!subscribed ? (
          <button
            onClick={subscribe}
            disabled={!vapidKey}
            style={{ padding: '10px 20px', fontSize: 16, cursor: 'pointer' }}
          >
            Subscribe to Push Notifications
          </button>
        ) : (
          <button
            onClick={sendTestPush}
            style={{ padding: '10px 20px', fontSize: 16, cursor: 'pointer', background: '#4CAF50', color: 'white' }}
          >
            Send Test Push Notification
          </button>
        )}
      </div>

      {subscribed && (
        <div style={{ marginTop: 15, fontSize: 12, color: '#666' }}>
          <strong>Endpoint:</strong> {endpoint.substring(0, 80)}...
        </div>
      )}
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
