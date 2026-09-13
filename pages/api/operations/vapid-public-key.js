// Returns the VAPID public key for browser push subscription.
// The public key is safe to expose to the browser — it's designed for that.
// The private key is never exposed.

export default function handler(req, res) {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return res.status(503).json({ error: 'VAPID keys not configured' });
  }
  return res.status(200).json({ publicKey });
}
