/**
 * Next.js proxy (formerly "middleware"): the public-ingress gate.
 *
 * Requests from this PC, the LAN or the tailnet pass through untouched.
 * Requests from the public internet (an ngrok tunnel, Tailscale Funnel,
 * any port forward) reach only the customer/Stripe allowlist in
 * lib/security/ingressGate.js. Everything else, including the operator
 * dashboard, chat, status, approvals and operator APIs, answers 404, so
 * a public URL never exposes HYDI itself. See docs/SECURITY_INGRESS.md.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { decideIngress } from './lib/security/ingressGate.js';

export function proxy(req: NextRequest) {
  const decision = decideIngress({ pathname: req.nextUrl.pathname, headers: req.headers });
  if (decision.allow) return NextResponse.next();
  return new NextResponse(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export const config = {
  // Static build assets are public and immutable; skip the gate for them.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
