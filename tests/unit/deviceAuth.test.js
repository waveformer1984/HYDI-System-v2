'use strict';

const {
  generateDeviceSecret,
  deriveSigningKey,
  signDeviceToken,
  verifyDeviceTokenSignature,
  verifyDeviceRequest,
} = require('../../lib/auth/deviceAuth');

describe('deviceAuth signature round-trip', () => {
  it('generates a 64-hex-char secret', () => {
    const secret = generateDeviceSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives a stable signing key from a raw secret', () => {
    const secret = generateDeviceSecret();
    expect(deriveSigningKey(secret)).toBe(deriveSigningKey(secret));
    expect(deriveSigningKey(secret)).not.toBe(secret);
  });

  it('accepts a token signed with the matching signing key', () => {
    const secret = generateDeviceSecret();
    const signingKey = deriveSigningKey(secret);
    const token = signDeviceToken('device-abc', signingKey);
    const result = verifyDeviceTokenSignature(token, signingKey);
    expect(result.valid).toBe(true);
    expect(result.deviceId).toBe('device-abc');
  });

  it('rejects a token signed with a different device secret', () => {
    const signingKeyA = deriveSigningKey(generateDeviceSecret());
    const signingKeyB = deriveSigningKey(generateDeviceSecret());
    const token = signDeviceToken('device-abc', signingKeyA);
    const result = verifyDeviceTokenSignature(token, signingKeyB);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('signature mismatch');
  });

  it('rejects a malformed token', () => {
    const result = verifyDeviceTokenSignature('not-a-real-token', 'key');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('malformed token');
  });

  it('rejects a missing token', () => {
    const result = verifyDeviceTokenSignature(undefined, 'key');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing token');
  });

  it('rejects an expired token (clock skew beyond the 5-minute window)', () => {
    const secret = generateDeviceSecret();
    const signingKey = deriveSigningKey(secret);
    const staleTs = Date.now() - 10 * 60 * 1000;
    const { createHmac } = require('crypto');
    const payload = `${staleTs}:req1:device-abc`;
    const sig = createHmac('sha256', signingKey).update(payload).digest('hex');
    const token = `${staleTs}.req1.device-abc.${sig}`;
    const result = verifyDeviceTokenSignature(token, signingKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/expired/);
  });
});

describe('verifyDeviceRequest (mock Supabase)', () => {
  function mockSupabase(deviceRow) {
    return {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: deviceRow, error: null }),
                };
              },
            };
          },
        };
      },
    };
  }

  it('resolves the device role for an approved device with a valid signature', async () => {
    const secret = generateDeviceSecret();
    const signingKey = deriveSigningKey(secret);
    const supabase = mockSupabase({
      device_id: 'phone-1', role: 'operator', status: 'approved', secret_hash: signingKey,
    });
    const token = signDeviceToken('phone-1', signingKey);

    const result = await verifyDeviceRequest(supabase, token);
    expect(result.valid).toBe(true);
    expect(result.role).toBe('operator');
  });

  it('rejects a revoked device even with a valid signature', async () => {
    const secret = generateDeviceSecret();
    const signingKey = deriveSigningKey(secret);
    const supabase = mockSupabase({
      device_id: 'phone-1', role: 'operator', status: 'revoked', secret_hash: signingKey,
    });
    const token = signDeviceToken('phone-1', signingKey);

    const result = await verifyDeviceRequest(supabase, token);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('device revoked');
  });

  it('rejects a pending (not yet approved) device', async () => {
    const secret = generateDeviceSecret();
    const signingKey = deriveSigningKey(secret);
    const supabase = mockSupabase({
      device_id: 'phone-1', role: 'viewer', status: 'pending', secret_hash: signingKey,
    });
    const token = signDeviceToken('phone-1', signingKey);

    const result = await verifyDeviceRequest(supabase, token);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('device not approved');
  });

  it('rejects an unknown device id', async () => {
    const supabase = mockSupabase(null);
    const token = signDeviceToken('ghost-device', 'irrelevant-key');

    const result = await verifyDeviceRequest(supabase, token);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('unknown device');
  });
});
