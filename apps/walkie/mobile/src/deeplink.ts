/**
 * Links the app accepts (pure; no React Native imports so it runs under Node tests):
 *   protoforgewalkie://join/<invite code>    from an invite QR's "Open in the Walkie app"
 *   protoforgewalkie://login/<ticket>        owner sign-in from `npm run owner-login`
 *   https://<server>/j/<invite code>         the invite QR itself, if the OS hands it to the app
 */
export type WalkieLink = { kind: 'join'; code: string } | { kind: 'login'; ticket: string };

const CODE = /^[A-Za-z0-9]{5}(-?[A-Za-z0-9]{5}){3}$/;
const TICKET = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function parseWalkieLink(url: string | null | undefined): WalkieLink | null {
  if (!url) return null;
  const custom = url.match(/^protoforgewalkie:\/\/(join|login)\/([^/?#\s]+)\/?(?:[?#].*)?$/i);
  if (custom) {
    const value = decodeURIComponent(custom[2]!);
    if (custom[1]!.toLowerCase() === 'join') return CODE.test(value) ? { kind: 'join', code: value.toUpperCase() } : null;
    return TICKET.test(value) ? { kind: 'login', ticket: value } : null;
  }
  const web = url.match(/^https:\/\/[^/\s]+\/j\/([A-Za-z0-9-]+)\/?(?:[?#].*)?$/);
  if (web && CODE.test(web[1]!)) return { kind: 'join', code: web[1]!.toUpperCase() };
  return null;
}
