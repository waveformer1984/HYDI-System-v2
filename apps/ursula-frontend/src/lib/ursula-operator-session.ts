import { headers, cookies } from 'next/headers';
import { isLocalRequest } from '@/lib/heidi-relay';
import { operatorSessionCookieOptions } from '@/lib/ursula-admin-auth';

/**
 * Sets the HttpOnly operator session cookie for same-origin browser fetches.
 * The value is an HMAC — never the raw URSULA_ADMIN_TOKEN.
 */
export async function ensureOperatorSessionCookie(): Promise<void> {
  const secret = process.env.URSULA_ADMIN_TOKEN;
  if (!secret) return;
  const h = await headers();
  const hdrs = new Headers();
  h.forEach((value, key) => hdrs.set(key, value));
  if (!isLocalRequest(hdrs)) return;
  const jar = await cookies();
  const { name, value, options } = operatorSessionCookieOptions(secret);
  if (jar.get(name)?.value === value) return;
  jar.set(name, value, options);
}
