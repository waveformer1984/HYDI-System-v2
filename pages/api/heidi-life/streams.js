/**
 * Read-only Heidi Life mock streams — opt-in via HEIDI_LIFE_MOCK_STREAMS=true.
 * No writes, no execution.
 */
import { listMockStreams } from '../../../lib/heidi-life/mock-streams.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  const payload = listMockStreams({ optIn: process.env.HEIDI_LIFE_MOCK_STREAMS === 'true' });
  return res.status(200).json({ ok: true, ...payload, ts: new Date().toISOString() });
}
