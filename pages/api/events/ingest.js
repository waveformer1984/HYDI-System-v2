// See pages/api/health.js for why this bridge exists. The ingestion sink is
// the write-side counterpart to ./stream.js and is the endpoint ProtoForge's
// Ursula HYDIEventBridge posts to, so it must be reachable under
// next dev/start — not just as a Vercel function.
export { default } from '../../../api/events/ingest.js';
