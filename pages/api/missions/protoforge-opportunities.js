/**
 * Local mount of api/missions/protoforge-opportunities.js.
 *
 * The canonical handler lives in /api (Vercel serverless surface). This
 * pages/api route re-exports it so `next dev` — the local HYDI runtime —
 * serves the same endpoint. Read-only GET returns the latest persisted
 * mission run + opportunity queue; POST actions keep their service-token
 * guard. No new logic here — see the canonical file.
 */

import handler from '../../../api/missions/protoforge-opportunities.js';

export default handler;
