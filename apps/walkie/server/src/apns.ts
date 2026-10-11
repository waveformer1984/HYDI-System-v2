import http2 from 'node:http2';
import { SignJWT, importPKCS8, type CryptoKey } from 'jose';
import type { ApnsEnvironment } from './store/types.js';

export interface ApnsConfig {
  /** Contents of the AuthKey_<KEYID>.p8 file (PKCS#8 PEM). Server-side secret. */
  keyPem: string;
  keyId: string;
  teamId: string;
  /** The iOS app's bundle id; PushToTalk pushes use topic `<bundleId>.voip-ptt`. */
  bundleId: string;
  /** Overrides for tests: e.g. http://127.0.0.1:9999 (cleartext HTTP/2). */
  sandboxOrigin?: string;
  productionOrigin?: string;
}

export type PushOutcome =
  | { ok: true; status: number; apnsId?: string }
  | { ok: false; status: number; reason: string; /** The token is dead and must be forgotten. */ unregistered: boolean };

export interface PushSender {
  sendPushToTalk(token: string, environment: ApnsEnvironment, payload: Record<string, unknown>): Promise<PushOutcome>;
  close(): Promise<void>;
}

const DEFAULT_ORIGIN: Record<ApnsEnvironment, string> = {
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
};

// APNs rejects provider tokens older than an hour and throttles refreshing
// more often than every 20 minutes.
const TOKEN_REFRESH_MS = 40 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Minimal APNs client for PushToTalk notifications, using token-based
 * (.p8, ES256) authentication over one reused HTTP/2 session per host.
 * Headers follow Apple's "Creating a Push to Talk app": push type
 * `pushtotalk`, topic `<bundleId>.voip-ptt`, priority 10, expiration 0.
 */
export class ApnsClient implements PushSender {
  private key?: CryptoKey;
  private jwt?: { value: string; at: number };
  private sessions = new Map<string, http2.ClientHttp2Session>();

  constructor(
    private readonly cfg: ApnsConfig,
    private readonly now: () => number = Date.now,
  ) {}

  private async providerToken(): Promise<string> {
    if (this.jwt && this.now() - this.jwt.at < TOKEN_REFRESH_MS) return this.jwt.value;
    this.key ??= await importPKCS8(this.cfg.keyPem, 'ES256');
    const iat = Math.floor(this.now() / 1000);
    const value = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: this.cfg.keyId }).setIssuer(this.cfg.teamId).setIssuedAt(iat).sign(this.key);
    this.jwt = { value, at: this.now() };
    return value;
  }

  private session(origin: string): http2.ClientHttp2Session {
    const cur = this.sessions.get(origin);
    if (cur && !cur.closed && !cur.destroyed) return cur;
    const s = http2.connect(origin);
    s.on('error', () => this.sessions.delete(origin));
    s.on('close', () => this.sessions.delete(origin));
    s.on('goaway', () => this.sessions.delete(origin));
    s.unref();
    this.sessions.set(origin, s);
    return s;
  }

  async sendPushToTalk(token: string, environment: ApnsEnvironment, payload: Record<string, unknown>): Promise<PushOutcome> {
    const origin = environment === 'production' ? (this.cfg.productionOrigin ?? DEFAULT_ORIGIN.production) : (this.cfg.sandboxOrigin ?? DEFAULT_ORIGIN.sandbox);
    const jwt = await this.providerToken();
    const body = JSON.stringify(payload);
    return new Promise<PushOutcome>((resolve) => {
      let req: http2.ClientHttp2Stream;
      try {
        req = this.session(origin).request({
          ':method': 'POST',
          ':path': `/3/device/${token}`,
          authorization: `bearer ${jwt}`,
          'apns-push-type': 'pushtotalk',
          'apns-topic': `${this.cfg.bundleId}.voip-ptt`,
          'apns-priority': '10',
          'apns-expiration': '0',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        });
      } catch (err) {
        resolve({ ok: false, status: 0, reason: err instanceof Error ? err.message : 'connect failed', unregistered: false });
        return;
      }
      req.setTimeout(REQUEST_TIMEOUT_MS, () => req.close(http2.constants.NGHTTP2_CANCEL));
      let status = 0;
      let apnsId: string | undefined;
      let data = '';
      req.on('response', (h) => {
        status = Number(h[':status']);
        apnsId = typeof h['apns-id'] === 'string' ? h['apns-id'] : undefined;
      });
      req.setEncoding('utf8');
      req.on('data', (c: string) => (data += c));
      req.on('end', () => {
        if (status === 200) return resolve({ ok: true, status, apnsId });
        let reason = 'Unknown';
        try {
          reason = String((JSON.parse(data) as { reason?: string }).reason ?? reason);
        } catch {
          /* empty or non-JSON body */
        }
        // 410 Unregistered, or 400 BadDeviceToken / DeviceTokenNotForTopic:
        // the token will never work again.
        const unregistered = status === 410 || (status === 400 && (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic'));
        resolve({ ok: false, status, reason, unregistered });
      });
      req.on('error', (err) => resolve({ ok: false, status, reason: err.message, unregistered: false }));
      req.end(body);
    });
  }

  async close() {
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
  }
}
