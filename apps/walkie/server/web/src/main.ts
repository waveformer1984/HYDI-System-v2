/**
 * Browser walkie-talkie. Entry points:
 *   /j/<code>          an invite QR: preview → name → join → talk
 *   /w                 my channels (returning guests, and the owner)
 *   /w#login=<ticket>  owner sign-in QR from `npm run owner-login`
 *   /w?c=<channelId>   a channel
 * All text from the server is inserted with textContent, never as HTML.
 */
import QRCode from 'qrcode';
import { displayStatus, type DisplayStatus, type Notice } from '../../../mobile/src/ptt/machine';
import { api, ApiError, clearSession, lastName, loadSession, saveName, saveSession, type ChannelSummary } from './api';
import { ChannelSession } from './talk';

const STATUS: Record<DisplayStatus, string> = {
  listening: 'Listening',
  receiving: 'Receiving',
  requesting: 'Requesting the turn…',
  speaking: 'You are transmitting',
  busy: 'Busy — someone else is talking',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected',
  mic_denied: 'Microphone access is off',
};
const NOTICE: Record<Notice, string> = {
  not_connected: 'Not connected yet — wait for "Listening".',
  mic_denied: 'Allow the microphone for this site to talk (you can still listen).',
  busy: 'Someone else is talking. Try again when they finish.',
  rate_limited: 'Too many presses — wait a moment.',
  turn_ended: 'Your turn ended.',
  max_duration: 'Maximum talk time reached.',
  request_failed: 'Could not get the turn. Check your connection.',
  connection_lost: 'Connection lost.',
};
const ERRORS: Record<string, string> = {
  invite_invalid: 'This invite has expired, was already used, or does not exist. Ask for a new QR code.',
  channel_full: 'This channel is full.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  network: 'Could not reach the walkie server. Check your connection.',
  invalid_ticket: 'This sign-in code has expired or was already used. Run owner-login again.',
  unauthenticated: 'Guest joining is turned off on this server.',
  guest_not_allowed: 'Guests cannot create channels.',
};
const errText = (err: unknown) => (err instanceof ApiError ? (ERRORS[err.code] ?? `Something went wrong (${err.code}).`) : 'Something went wrong.');

// ---- tiny DOM helpers (text only) ----
type Child = Node | string | null | false | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<Record<string, unknown>> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}
const root = document.getElementById('app')!;
const present = (nodes: Child[]) => nodes.filter((n): n is Node | string => Boolean(n));
const show = (...nodes: Child[]) => root.replaceChildren(...present(nodes));

let current: ChannelSession | null = null;
let wakeLock: { release(): Promise<void> } | null = null;
let cleanups: Array<() => void> = [];
function leaveChannel() {
  current?.close();
  current = null;
  for (const c of cleanups) c();
  cleanups = [];
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
}
const go = (url: string) => {
  history.pushState(null, '', url);
  void route();
};
window.addEventListener('popstate', () => void route());

// ---- views ----

async function joinView(code: string) {
  const err = h('p', { class: 'error' });
  let preview;
  try {
    preview = await api.preview(code);
  } catch (e) {
    const s = loadSession();
    return show(
      h('h1', {}, 'Walkie'),
      h('div', { class: 'card' }, h('p', { class: 'error' }, errText(e)), s ? h('button', { onclick: () => go('/w') }, 'Go to my channels') : null),
    );
  }
  const name = h('input', { placeholder: 'Your name', maxlength: '40', autocomplete: 'nickname', value: lastName() });
  const joinBtn = h('button', {}, 'Join and talk');
  const join = async () => {
    const displayName = name.value.trim();
    if (!displayName) return name.focus();
    joinBtn.setAttribute('disabled', '');
    err.textContent = '';
    try {
      saveName(displayName);
      const r = await api.join(code, displayName);
      if (r.session) saveSession({ ...r.session, userId: r.userId, kind: 'guest' });
      history.replaceState(null, '', `/w?c=${r.channel.id}`);
      // Still inside the tap: unlock audio and ask for the microphone now.
      await channelView(r.channel.id, true);
    } catch (e) {
      err.textContent = errText(e);
      joinBtn.removeAttribute('disabled');
    }
  };
  joinBtn.addEventListener('click', () => void join());
  name.addEventListener('keydown', (e) => e.key === 'Enter' && void join());
  show(
    h('h1', {}, 'Walkie invite'),
    h(
      'div',
      { class: 'card' },
      h('p', {}, preview.ownerName ? `${preview.ownerName} invited you to ` : 'You are invited to ', h('strong', {}, preview.channelName)),
      h('p', { class: 'muted' }, 'Hold the big button to talk; let go to listen. Nothing is recorded.'),
      loadSession() ? null : name,
      joinBtn,
      err,
    ),
    h(
      'div',
      { class: 'card' },
      h('p', { class: 'muted' }, 'Have the ProtoForge Walkie app? It also works with the screen locked.'),
      h('a', { class: 'button secondary', href: `protoforgewalkie://join/${encodeURIComponent(code)}` }, 'Open in the Walkie app'),
    ),
  );
  if (!loadSession()) name.focus();
}

async function ownerLogin(ticket: string) {
  show(h('p', { class: 'muted' }, 'Signing in…'));
  try {
    const r = await api.exchange(ticket);
    saveSession({ ...r.session, userId: r.userId, kind: 'owner' });
    history.replaceState(null, '', '/w');
    return homeView();
  } catch (e) {
    history.replaceState(null, '', '/w');
    show(
      h('h1', {}, 'Walkie'),
      h('div', { class: 'card' }, h('p', { class: 'error' }, errText(e))),
      h('a', { class: 'button secondary', href: `protoforgewalkie://login/${encodeURIComponent(ticket)}` }, 'Try in the Walkie app instead'),
    );
  }
}

async function homeView(inviteFor?: string) {
  const s = loadSession();
  if (!s) {
    return show(h('h1', {}, 'Walkie'), h('div', { class: 'card' }, h('p', {}, 'Scan an invite QR code from the channel owner to join.')));
  }
  let me, list: ChannelSummary[];
  try {
    [me, { channels: list }] = await Promise.all([api.me(), api.channels()]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      clearSession();
      return homeView();
    }
    return show(h('h1', {}, 'Walkie'), h('p', { class: 'error' }, errText(e)), h('button', { onclick: () => void homeView() }, 'Retry'));
  }
  const err = h('p', { class: 'error' });
  const invitePanel = h('div', { class: 'card hidden' });

  const showInvite = async (c: ChannelSummary) => {
    err.textContent = '';
    try {
      const inv = await api.createInvite(c.id);
      const img = h('img', { alt: 'Invite QR code', src: await QRCode.toDataURL(inv.qrUrl, { margin: 1, width: 600, errorCorrectionLevel: 'M' }) });
      const hours = Math.max(1, Math.round((inv.expiresAt - Date.now()) / 3_600_000));
      invitePanel.replaceChildren(
        ...present([
        h('h2', {}, `Invite to ${c.name}`),
        h('div', { class: 'qr' }, img),
        h('p', { class: 'muted' }, `Let them scan this with their phone camera. Works once, for ${hours} h.`),
        inv.joinUrl ? null : h('p', { class: 'error' }, 'PUBLIC_BASE_URL is not set on the server: this code only opens the Walkie app.'),
        h('p', { class: 'code' }, inv.code),
        navigator.share
          ? h('button', { class: 'secondary', onclick: () => void navigator.share({ title: 'Walkie invite', text: `Join "${c.name}" on Walkie`, url: inv.qrUrl }).catch(() => {}) }, 'Share link instead')
          : null,
        h('button', { class: 'link', onclick: () => invitePanel.classList.add('hidden') }, 'Close'),
        ]),
      );
      invitePanel.classList.remove('hidden');
      invitePanel.scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
      err.textContent = errText(e);
    }
  };

  const rows = list.map((c) =>
    h(
      'div',
      { class: 'channel' },
      h('button', { class: 'secondary', style: 'flex:1;text-align:left', onclick: () => go(`/w?c=${c.id}`) }, c.name),
      c.role === 'owner' ? h('button', { onclick: () => void showInvite(c) }, 'Invite QR') : null,
    ),
  );

  let createCard: HTMLElement | null = null;
  if (!me.guest) {
    const name = h('input', { placeholder: 'New channel name', maxlength: '60' });
    const create = async () => {
      if (!name.value.trim()) return name.focus();
      try {
        const c = await api.createChannel(name.value.trim());
        // Re-render with the new channel, then open its invite QR.
        await homeView(c.id);
      } catch (e) {
        err.textContent = errText(e);
      }
    };
    name.addEventListener('keydown', (e) => e.key === 'Enter' && void create());
    createCard = h('div', { class: 'card' }, h('div', { class: 'row' }, name, h('button', { style: 'flex:0 0 auto;width:auto', onclick: () => void create() }, 'Create')));
  }

  const toInvite = inviteFor ? list.find((c) => c.id === inviteFor) : undefined;
  if (toInvite) queueMicrotask(() => void showInvite(toInvite));
  show(
    h('h1', {}, 'Walkie'),
    h('p', { class: 'muted' }, `Signed in as ${me.displayName ?? 'you'}${me.guest ? ' (guest)' : ''}`),
    h('div', { class: 'card' }, list.length ? null : h('p', { class: 'muted' }, me.guest ? 'You are not in any channel. Scan a new invite QR.' : 'No channels yet. Create one, then show its invite QR.'), ...rows),
    createCard,
    err,
    invitePanel,
    h(
      'button',
      {
        class: 'link',
        onclick: () => {
          if (me.guest && !confirm('Sign out? As a guest you will need a new invite QR to come back.')) return;
          clearSession();
          void homeView();
        },
      },
      'Sign out',
    ),
  );
}

async function channelView(channelId: string, fromTap = false) {
  if (!loadSession()) return homeView();
  leaveChannel();
  const names = new Map<string, string>();
  let title = 'Channel';
  const selfId = loadSession()!.userId;

  const status = h('div', { class: 'status' });
  const notice = h('div', { class: 'notice' });
  const people = h('div', { class: 'people' });
  const talk = h('button', { id: 'talk', 'aria-label': 'Hold to talk' }, 'Hold to talk');
  const sound = h('button', { class: 'secondary hidden' }, 'Tap to turn on sound');
  const ended = h('div', { class: 'card hidden' });
  const heading = h('h1', {}, title);

  const render = () => {
    const sess = current;
    if (!sess) return;
    const st = displayStatus(sess.state, selfId);
    const speakerId = sess.state.speaker?.userId;
    status.textContent = st === 'receiving' && speakerId ? `${names.get(speakerId) ?? 'Someone'} is talking` : STATUS[st];
    status.style.color = st === 'speaking' ? 'var(--speaking)' : st === 'receiving' ? 'var(--receiving)' : st === 'busy' || st === 'reconnecting' ? 'var(--busy)' : '';
    notice.textContent = sess.state.notice ? NOTICE[sess.state.notice] : '';
    talk.className = [sess.state.pressed && 'pressed', st === 'speaking' && 'speaking', st === 'receiving' && 'receiving'].filter(Boolean).join(' ');
    talk.textContent = st === 'speaking' ? 'Talking…' : 'Hold to talk';
    sound.classList.toggle('hidden', !sess.audioBlocked);
    people.replaceChildren(
      ...sess.presence.map((p) =>
        h('span', { class: `person on${p.speaking ? ' speaking' : ''}` }, p.identity === selfId ? `${names.get(p.identity) ?? p.name} (you)` : (names.get(p.identity) ?? p.name)),
      ),
    );
    if (sess.ended) {
      const why = sess.ended === 'removed' ? 'You are no longer in this channel.' : sess.ended === 'channel_gone' ? 'This channel was deleted.' : 'You were signed out.';
      ended.replaceChildren(h('p', {}, why), h('button', { onclick: () => go('/w') }, 'My channels'));
      ended.classList.remove('hidden');
      talk.setAttribute('disabled', '');
    }
  };

  // Press-and-hold on touch and mouse; Space on a keyboard.
  const down = (e: Event) => {
    e.preventDefault();
    if (current?.audioBlocked) void current.unlockAudio();
    current?.press();
  };
  const up = (e: Event) => {
    e.preventDefault();
    current?.release();
  };
  talk.addEventListener('pointerdown', (e) => {
    talk.setPointerCapture(e.pointerId);
    down(e);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) talk.addEventListener(ev, up);
  talk.addEventListener('contextmenu', (e) => e.preventDefault());
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || e.repeat || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.type === 'keydown') down(e);
    else up(e);
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  cleanups.push(() => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
  });
  sound.addEventListener('click', () => void current?.unlockAudio());

  show(
    h('div', { class: 'row' }, h('button', { class: 'link', style: 'flex:0 0 auto', onclick: () => go('/w') }, '‹ Channels'), h('span')),
    heading,
    people,
    status,
    talk,
    notice,
    sound,
    ended,
  );

  current = new ChannelSession(channelId, render);
  if (fromTap) {
    void current.unlockAudio();
    void current.primeMicrophone();
  } else {
    // Arrived by reload/link: the first press will unlock audio and ask for the mic.
    current.audioBlocked = true;
  }
  render();

  try {
    const d = await api.channel(channelId);
    title = d.name;
    heading.textContent = title;
    document.title = `${title} · Walkie`;
    for (const m of d.members) if (m.displayName) names.set(m.userId, m.displayName);
    render();
  } catch {
    /* the session reports removal on its own */
  }

  // Keep the screen on while in a channel (where supported).
  try {
    wakeLock = await (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null;
  } catch {
    wakeLock = null;
  }
}

// A hidden page must not keep transmitting.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') current?.release();
});

async function route() {
  leaveChannel();
  const path = location.pathname;
  const ticket = new URLSearchParams(location.hash.slice(1)).get('login');
  if (ticket) return ownerLogin(ticket);
  const join = path.match(/^\/j\/([A-Za-z0-9-]{20,32})\/?$/);
  if (join) return joinView(join[1]!);
  const c = new URLSearchParams(location.search).get('c');
  if (c && /^[0-9a-f-]{36}$/i.test(c)) return channelView(c);
  return homeView();
}

void route();
