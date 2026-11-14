import type { NextRequest } from 'next/server';
import { refuseUnlessUrsulaLocal } from '@/lib/ursula-csrf';
import { requireUrsulaAdmin } from '@/lib/ursula-admin-auth';

/** Loopback bind + Ursula admin token (Bearer or HttpOnly session cookie) + optional CSRF. */
export function refuseUnlessUrsulaOperator(req: NextRequest, { requireCsrf = true } = {}) {
  const local = refuseUnlessUrsulaLocal(req, { requireCsrf });
  if (local) return local;
  return requireUrsulaAdmin(req.headers);
}
