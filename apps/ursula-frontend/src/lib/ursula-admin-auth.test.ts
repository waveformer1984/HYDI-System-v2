// @vitest-environment node
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  bearerMatches, cookieMatches, requireUrsulaAdmin, operatorSessionCookieOptions,
} from './ursula-admin-auth';

describe('ursula-admin-auth', () => {
  beforeEach(() => {
    process.env.URSULA_ADMIN_TOKEN = 'test-operator-secret-value';
  });
  afterEach(() => {
    delete process.env.URSULA_ADMIN_TOKEN;
  });

  it('accepts a valid Bearer token', () => {
    const h = new Headers({ authorization: 'Bearer test-operator-secret-value' });
    expect(bearerMatches(h, process.env.URSULA_ADMIN_TOKEN!)).toBe(true);
    expect(requireUrsulaAdmin(h)).toBeNull();
  });

  it('refuses without Bearer or cookie', () => {
    const h = new Headers({ host: '127.0.0.1:3100' });
    const res = requireUrsulaAdmin(h);
    expect(res?.status).toBe(401);
  });

  it('returns 503 when URSULA_ADMIN_TOKEN is unset', () => {
    delete process.env.URSULA_ADMIN_TOKEN;
    const h = new Headers({ authorization: 'Bearer x' });
    expect(requireUrsulaAdmin(h)?.status).toBe(503);
  });

  it('accepts the signed operator session cookie', () => {
    const secret = process.env.URSULA_ADMIN_TOKEN!;
    const h = new Headers();
    const { value } = operatorSessionCookieOptions(secret);
    h.set('cookie', `ursula_operator_session=${value}`);
    expect(cookieMatches(h.get('cookie'), secret)).toBe(true);
  });
});
