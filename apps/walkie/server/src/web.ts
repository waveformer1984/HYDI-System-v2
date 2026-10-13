import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Config } from './config.js';

/**
 * The browser walkie-talkie that invite QR codes open (`/j/<code>`). Built
 * into web/dist by `npm run build:web`; until it is built the routes answer
 * 503 instead of failing at startup.
 */
const DIST = new URL('../web/dist/', import.meta.url);

function load(name: string): Buffer | null {
  try {
    return readFileSync(new URL(name, DIST));
  } catch {
    return null;
  }
}

export function registerWebClient(app: FastifyInstance, config: Config) {
  const html = load('index.html');
  const js = load('app.js');
  // Mostly the LiveKit SDK (~600 KB raw): send it gzipped to phones on mobile data.
  const jsGz = js ? gzipSync(js, { level: 9 }) : null;

  // The page talks to this server and to LiveKit (signalling over wss, plus
  // https for LiveKit Cloud's region lookup). ws:/http: only for a dev LiveKit.
  const insecureLivekit = config.livekit.url.startsWith('ws://') ? ' ws: http:' : '';
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "media-src 'self' blob:",
    `connect-src 'self' https: wss:${insecureLivekit}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  const securityHeaders = (reply: FastifyReply) =>
    reply
      .header('content-security-policy', csp)
      // The invite code is in the URL: never leak it to another site.
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff')
      .header('permissions-policy', 'microphone=(self), camera=(), geolocation=()')
      .header('cache-control', 'no-store');

  const page = async (_req: unknown, reply: FastifyReply) => {
    securityHeaders(reply);
    if (!html) return reply.status(503).type('text/plain').send('The web client has not been built (npm run build:web).');
    return reply.type('text/html; charset=utf-8').send(html);
  };

  app.get('/j/:code', page); // invite link from a QR code
  app.get('/w', page); // a returning guest's channels

  app.get('/web/app.js', async (req, reply) => {
    securityHeaders(reply);
    if (!js) return reply.status(503).type('text/plain').send('not built');
    reply.type('text/javascript; charset=utf-8').header('cache-control', 'no-cache').header('vary', 'accept-encoding');
    if (jsGz && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) return reply.header('content-encoding', 'gzip').send(jsGz);
    return reply.send(js);
  });
}
